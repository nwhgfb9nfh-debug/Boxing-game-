import type { LotInstance } from "./world";

// Placeholder interior: a walled room the player free-roams with the
// virtual joystick (Section 12's second control scheme). Walking into the
// door (bottom-center, the same spot you walked in from) exits back to the
// street automatically, the same way approaching any other interactive
// point on the street surfaces its action. Some buildings also place
// "stations" in the room — walk up to one (e.g. the Gym's Heavy Bag) and
// its prompt surfaces the same way.
//
// Only ever constructed for unlocked buildings — locked ones short-circuit
// to a toast message on the street instead (see main.ts / buildingUI.ts).

export interface Station {
  id: string;
  label: string;
  nx: number; // normalized position within the room, 0..1
  ny: number;
  // "npc" renders as a small player-scale circle instead of the big
  // equipment ellipse — for dialogue-capable NPCs like Priya.
  kind?: "npc";
  // Overrides STATION_RADIUS — for a station standing behind a blocking
  // Decoration (a desk), where the default radius wouldn't reach across it.
  radius?: number;
  // For NPCs stationed behind a blocking Decoration (id-matched below): the
  // proximity check (and the prompt trigger) uses a point pinned to that
  // Decoration's near edge instead of nx/ny, so the player has to actually
  // be pressed up against the barrier — not just generally nearby, which
  // let you trigger it from well past the entrance on short viewports
  // where a fixed-fraction approach point collapsed too close to the door.
  // Computed in px each frame from the Decoration's real edge, so it stays
  // exact regardless of room/viewport size. The marker itself still
  // renders at nx/ny.
  approachDecorationId?: string;
  // Which edge of the approachDecorationId Decoration the player has to be
  // pressed against — "south" (default) matches Reception's desk; "east"
  // is for a desk segment approached from its right side instead (e.g.
  // Vinnie's L-shaped desk). Ignored without approachDecorationId.
  approachSide?: "south" | "east" | "west" | "north";
}

// A rectangle drawn in the room (e.g. Office's reception desk). Purely
// visual unless blocking is set, in which case the player collides with
// it from any side (unlike BlockedZone, not anchored to an outer wall).
export interface Decoration {
  id?: string; // referenced by Station.approachDecorationId
  nx: number; // center, normalized
  ny: number;
  width: number; // px
  height: number; // px
  color?: string;
  blocking?: boolean;
}

// A rectangular sub-area of the room (e.g. Lounge's VIP corner) the player
// can't walk into until isAllowed() says so — re-checked every frame, so
// stepping away from an NPC gate and getting waved through opens it live.
// Always anchored to at least one outer wall (ny0=0 for the top wall,
// nx1=1 for the right wall) since the collision check only resolves the
// two inner edges.
export interface BlockedZone {
  nx0: number;
  ny0: number;
  nx1: number;
  ny1: number;
  isAllowed: () => boolean;
  label: string;
}

const PLAYER_SPEED = 260; // px/sec
const PLAYER_RADIUS = 12;
const DOOR_HALF_WIDTH = 45;
const STATION_RADIUS = 55;

// Margin just for the HUD pill up top and the walls themselves — the
// joystick floats wherever the player touches, so nothing needs to be
// reserved for it and the play area stays as large as possible.
const MARGIN_TOP = 90;
const MARGIN_BOTTOM = 40;
const MARGIN_SIDE = 30;

export interface InteriorUpdateResult {
  atDoor: boolean;
  nearStation: Station | null;
}

export class InteriorScene {
  private lot: LotInstance;
  private stations: Station[];
  private blockedZone?: BlockedZone;
  private decorations: Decoration[];
  private hasDoor: boolean;
  private px = 0.5; // normalized position within the room, 0..1
  private py: number;

  constructor(
    lot: LotInstance,
    stations: Station[] = [],
    blockedZone?: BlockedZone,
    decorations: Decoration[] = [],
    // False for a room entered/exited only via a station (e.g. Office
    // floors, elevator-only — no ground-level door to walk out through).
    // No door notch is drawn and walking to the bottom wall does nothing.
    hasDoor: boolean = true,
  ) {
    this.lot = lot;
    this.stations = stations;
    this.blockedZone = blockedZone;
    this.decorations = decorations;
    this.hasDoor = hasDoor;
    if (hasDoor) {
      // Spawn just above the door.
      this.py = 0.88;
    } else {
      // Door-less rooms (e.g. Office floors) are only ever entered by
      // riding their "elevator" station — arrive right in front of it
      // instead of some generic center point.
      const elevatorStation = stations.find((s) => s.id === "elevator");
      if (elevatorStation) {
        this.px = elevatorStation.nx;
        this.py = Math.min(0.95, elevatorStation.ny + 0.12);
      } else {
        this.py = 0.5;
      }
    }
  }

  /** Whether this room's station list (fixed at construction) includes the given id. */
  hasStation(id: string): boolean {
    return this.stations.some((s) => s.id === id);
  }

  private roomBounds(width: number, height: number) {
    return {
      left: MARGIN_SIDE,
      right: width - MARGIN_SIDE,
      top: MARGIN_TOP,
      bottom: height - MARGIN_BOTTOM,
    };
  }

  update(dt: number, vector: { x: number; y: number }, width: number, height: number): InteriorUpdateResult {
    const bounds = this.roomBounds(width, height);
    const roomW = bounds.right - bounds.left;
    const roomH = bounds.bottom - bounds.top;

    let x = bounds.left + this.px * roomW + vector.x * PLAYER_SPEED * dt;
    let y = bounds.top + this.py * roomH + vector.y * PLAYER_SPEED * dt;

    x = Math.max(bounds.left + PLAYER_RADIUS, Math.min(bounds.right - PLAYER_RADIUS, x));
    y = Math.max(bounds.top + PLAYER_RADIUS, Math.min(bounds.bottom - PLAYER_RADIUS, y));

    if (this.blockedZone && !this.blockedZone.isAllowed()) {
      const z = this.blockedZone;
      const zoneLeft = bounds.left + z.nx0 * roomW;
      const zoneBottom = bounds.top + z.ny1 * roomH;
      const insideZone = x + PLAYER_RADIUS > zoneLeft && y - PLAYER_RADIUS < zoneBottom;
      if (insideZone) {
        // Push back out along whichever edge is closer, so approaching
        // from either side just stops the player at the boundary.
        const pushLeft = x + PLAYER_RADIUS - zoneLeft;
        const pushDown = zoneBottom - (y - PLAYER_RADIUS);
        if (pushLeft < pushDown) x = zoneLeft - PLAYER_RADIUS;
        else y = zoneBottom + PLAYER_RADIUS;
      }
    }

    // Blocking decorations (e.g. Office's reception desk) — a free-standing
    // rectangle, not anchored to a wall, so all 4 edges need resolving.
    // Push out along whichever edge requires the smallest correction.
    for (const d of this.decorations) {
      if (!d.blocking) continue;
      const dx = bounds.left + d.nx * roomW;
      const dy = bounds.top + d.ny * roomH;
      const left = dx - d.width / 2 - PLAYER_RADIUS;
      const right = dx + d.width / 2 + PLAYER_RADIUS;
      const top = dy - d.height / 2 - PLAYER_RADIUS;
      const bottom = dy + d.height / 2 + PLAYER_RADIUS;
      if (x > left && x < right && y > top && y < bottom) {
        const pushLeft = x - left;
        const pushRight = right - x;
        const pushTop = y - top;
        const pushBottom = bottom - y;
        const minPush = Math.min(pushLeft, pushRight, pushTop, pushBottom);
        if (minPush === pushLeft) x = left;
        else if (minPush === pushRight) x = right;
        else if (minPush === pushTop) y = top;
        else y = bottom;
      }
    }

    this.px = (x - bounds.left) / roomW;
    this.py = (y - bounds.top) / roomH;

    const doorCenterX = bounds.left + roomW / 2;
    const atDoor =
      this.hasDoor && y >= bounds.bottom - PLAYER_RADIUS - 6 && Math.abs(x - doorCenterX) <= DOOR_HALF_WIDTH;

    let nearStation: Station | null = null;
    for (const s of this.stations) {
      let sx: number;
      let sy: number;
      const approachDecoration = s.approachDecorationId
        ? this.decorations.find((d) => d.id === s.approachDecorationId)
        : undefined;
      if (approachDecoration) {
        // Pinned to the decoration's near edge (south by default, or
        // whichever side approachSide names), in the station's own
        // perpendicular column/row — the exact spot the player's collision
        // stops them at when walking up to touch it, so the trigger radius
        // can stay tight without ever being unreachable.
        const dCenterX = bounds.left + approachDecoration.nx * roomW;
        const dCenterY = bounds.top + approachDecoration.ny * roomH;
        const side = s.approachSide ?? "south";
        if (side === "east") {
          sx = dCenterX + approachDecoration.width / 2 + PLAYER_RADIUS;
          sy = bounds.top + s.ny * roomH;
        } else if (side === "west") {
          sx = dCenterX - approachDecoration.width / 2 - PLAYER_RADIUS;
          sy = bounds.top + s.ny * roomH;
        } else if (side === "north") {
          sx = bounds.left + s.nx * roomW;
          sy = dCenterY - approachDecoration.height / 2 - PLAYER_RADIUS;
        } else {
          sx = bounds.left + s.nx * roomW;
          sy = dCenterY + approachDecoration.height / 2 + PLAYER_RADIUS;
        }
      } else {
        sx = bounds.left + s.nx * roomW;
        sy = bounds.top + s.ny * roomH;
      }
      if (Math.hypot(x - sx, y - sy) <= (s.radius ?? STATION_RADIUS)) {
        nearStation = s;
        break;
      }
    }

    return { atDoor, nearStation };
  }

  getStationScreenPos(station: Station, width: number, height: number): { x: number; y: number } {
    const bounds = this.roomBounds(width, height);
    return {
      x: bounds.left + station.nx * (bounds.right - bounds.left),
      y: bounds.top + station.ny * (bounds.bottom - bounds.top),
    };
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const bounds = this.roomBounds(width, height);

    ctx.save();
    ctx.fillStyle = "#171a21";
    ctx.fillRect(0, 0, width, height);

    // Floor
    ctx.fillStyle = "#241d38";
    ctx.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);

    // Walls
    ctx.strokeStyle = "#4a3d6b";
    ctx.lineWidth = 8;
    ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);

    // Blocked sub-area (e.g. Lounge's VIP corner) — tinted gold, brighter
    // once isAllowed() is true so it visibly opens up without a scene change.
    if (this.blockedZone) {
      const z = this.blockedZone;
      const zx = bounds.left + z.nx0 * (bounds.right - bounds.left);
      const zy = bounds.top + z.ny0 * (bounds.bottom - bounds.top);
      const zw = (z.nx1 - z.nx0) * (bounds.right - bounds.left);
      const zh = (z.ny1 - z.ny0) * (bounds.bottom - bounds.top);
      const allowed = z.isAllowed();
      ctx.fillStyle = allowed ? "rgba(212, 175, 55, 0.18)" : "rgba(212, 175, 55, 0.10)";
      ctx.fillRect(zx, zy, zw, zh);
      ctx.strokeStyle = allowed ? "rgba(212, 175, 55, 0.65)" : "rgba(212, 175, 55, 0.35)";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.strokeRect(zx, zy, zw, zh);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(z.label.toUpperCase(), zx + zw / 2, zy + 8);
    }

    // Decorations (e.g. Office's reception desk) — plain rectangles, purely visual.
    for (const d of this.decorations) {
      const dx = bounds.left + d.nx * (bounds.right - bounds.left);
      const dy = bounds.top + d.ny * (bounds.bottom - bounds.top);
      ctx.fillStyle = d.color ?? "#4a3d2a";
      ctx.fillRect(dx - d.width / 2, dy - d.height / 2, d.width, d.height);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 2;
      ctx.strokeRect(dx - d.width / 2, dy - d.height / 2, d.width, d.height);
    }

    // Door notch at the bottom center — walk here to leave. Skipped
    // entirely for door-less rooms (Office floors — Elevator only).
    if (this.hasDoor) {
      const doorW = DOOR_HALF_WIDTH * 2 - 10;
      ctx.strokeStyle = "#171a21";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(width / 2 - doorW / 2, bounds.bottom);
      ctx.lineTo(width / 2 + doorW / 2, bounds.bottom);
      ctx.stroke();
    }

    // Station markers
    for (const s of this.stations) {
      const pos = this.getStationScreenPos(s, width, height);
      let labelOffset: number;
      if (s.kind === "npc") {
        // Player-scale circle, not the big equipment ellipse — reads as
        // "a person standing here" rather than a giant blob.
        ctx.fillStyle = "#c98a5a";
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, PLAYER_RADIUS + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 2;
        ctx.stroke();
        labelOffset = PLAYER_RADIUS + 20;
      } else {
        ctx.fillStyle = "#8a6a3a";
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y, 30, 44, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 2;
        ctx.stroke();
        labelOffset = 60;
      }
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.label, pos.x, pos.y + labelOffset);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px sans-serif";
    ctx.fillText(this.lot.building.name, width / 2, bounds.top - 36);

    ctx.font = "12px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    if (this.hasDoor) {
      ctx.fillText("EXIT ▼", width / 2, bounds.bottom - 18);
    } else {
      // Door-less room (e.g. Office floors) — the exit is whichever
      // station actually leaves (the elevator), not the bottom wall.
      const exitStation = this.stations.find((s) => s.id === "elevator");
      if (exitStation) {
        const pos = this.getStationScreenPos(exitStation, width, height);
        ctx.fillText("EXIT", pos.x, pos.y - 42);
      }
    }

    // Player (top-down placeholder)
    const px = bounds.left + this.px * (bounds.right - bounds.left);
    const py = bounds.top + this.py * (bounds.bottom - bounds.top);
    ctx.fillStyle = "#3fd0c9";
    ctx.beginPath();
    ctx.arc(px, py, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }
}
