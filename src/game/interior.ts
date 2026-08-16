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
  private px = 0.5; // normalized position within the room, 0..1
  private py = 0.88; // spawn right above the door — just far enough that walking in doesn't instantly trigger an exit

  constructor(lot: LotInstance, stations: Station[] = []) {
    this.lot = lot;
    this.stations = stations;
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

    this.px = (x - bounds.left) / roomW;
    this.py = (y - bounds.top) / roomH;

    const doorCenterX = bounds.left + roomW / 2;
    const atDoor =
      y >= bounds.bottom - PLAYER_RADIUS - 6 && Math.abs(x - doorCenterX) <= DOOR_HALF_WIDTH;

    let nearStation: Station | null = null;
    for (const s of this.stations) {
      const sx = bounds.left + s.nx * roomW;
      const sy = bounds.top + s.ny * roomH;
      if (Math.hypot(x - sx, y - sy) <= STATION_RADIUS) {
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

    // Door notch at the bottom center — walk here to leave
    const doorW = DOOR_HALF_WIDTH * 2 - 10;
    ctx.strokeStyle = "#171a21";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(width / 2 - doorW / 2, bounds.bottom);
    ctx.lineTo(width / 2 + doorW / 2, bounds.bottom);
    ctx.stroke();

    // Station markers
    for (const s of this.stations) {
      const pos = this.getStationScreenPos(s, width, height);
      ctx.fillStyle = "#8a6a3a";
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y, 30, 44, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.label, pos.x, pos.y + 60);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px sans-serif";
    ctx.fillText(this.lot.building.name, width / 2, bounds.top - 36);

    ctx.font = "12px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText("EXIT ▼", width / 2, bounds.bottom - 18);

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
