import type { LotInstance } from "./world";

// Placeholder interior: a walled room the player free-roams with the
// virtual joystick (Section 12's second control scheme). No furniture or
// interactions yet — that comes with each system (Training, Private
// Life, ...) as it's wired in on top of this. Walking into the door
// (bottom-center, the same spot you walked in from) exits back to the
// street automatically, the same way approaching any other interactive
// point on the street surfaces its action.

const PLAYER_SPEED = 260; // px/sec
const PLAYER_RADIUS = 12;
const DOOR_HALF_WIDTH = 45;

// Margin just for the HUD pill up top and the walls themselves — the
// joystick now overlays the room (semi-transparent) instead of pushing it
// out of the way, so the play area stays as large and visible as possible.
const MARGIN_TOP = 90;
const MARGIN_BOTTOM = 40;
const MARGIN_SIDE = 30;

export class InteriorScene {
  private lot: LotInstance;
  private px = 0.5; // normalized position within the room, 0..1
  private py = 0.7; // start a bit above the door so walking in doesn't instantly trigger an exit

  constructor(lot: LotInstance) {
    this.lot = lot;
  }

  private roomBounds(width: number, height: number) {
    return {
      left: MARGIN_SIDE,
      right: width - MARGIN_SIDE,
      top: MARGIN_TOP,
      bottom: height - MARGIN_BOTTOM,
    };
  }

  /** Returns true the frame the player walks into the door — caller should exit the building. */
  update(dt: number, vector: { x: number; y: number }, width: number, height: number): boolean {
    // Locked buildings still need to be walkable so the player can reach
    // the door — there's no other way out now that Exit isn't a button.
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
    return atDoor;
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const locked = !!this.lot.building.locked;
    const bounds = this.roomBounds(width, height);

    ctx.save();
    ctx.fillStyle = "#171a21";
    ctx.fillRect(0, 0, width, height);

    // Floor
    ctx.fillStyle = locked ? "#1c1e24" : "#241d38";
    ctx.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);

    // Walls
    ctx.strokeStyle = locked ? "#3a3d45" : "#4a3d6b";
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

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px sans-serif";
    ctx.fillText(this.lot.building.name, width / 2, bounds.top - 36);

    if (locked) {
      ctx.font = "16px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText("🔒 Locked — purchase not available yet", width / 2, bounds.top + 34);
    }

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
