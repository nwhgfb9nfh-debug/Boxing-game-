import type { LotInstance } from "./world";

// Placeholder interior: a walled room the player free-roams with the
// virtual joystick (Section 12's second control scheme). No furniture or
// interactions yet — that comes with each system (Training, Private
// Life, ...) as it's wired in on top of this.

const PLAYER_SPEED = 260; // px/sec
const PLAYER_RADIUS = 12;

// Margins carve out room for the HUD pill up top and the joystick/EXIT
// button down below, so the walkable area never sits under the UI.
const MARGIN_TOP = 90;
const MARGIN_BOTTOM = 170;
const MARGIN_SIDE = 30;

export class InteriorScene {
  private lot: LotInstance;
  private px = 0.5; // normalized position within the room, 0..1
  private py = 0.85; // start near the bottom (the door)

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

  update(dt: number, vector: { x: number; y: number }, width: number, height: number) {
    if (this.lot.building.locked) return; // nothing to walk around in a locked placeholder

    const bounds = this.roomBounds(width, height);
    const roomW = bounds.right - bounds.left;
    const roomH = bounds.bottom - bounds.top;

    let x = bounds.left + this.px * roomW + vector.x * PLAYER_SPEED * dt;
    let y = bounds.top + this.py * roomH + vector.y * PLAYER_SPEED * dt;

    x = Math.max(bounds.left + PLAYER_RADIUS, Math.min(bounds.right - PLAYER_RADIUS, x));
    y = Math.max(bounds.top + PLAYER_RADIUS, Math.min(bounds.bottom - PLAYER_RADIUS, y));

    this.px = (x - bounds.left) / roomW;
    this.py = (y - bounds.top) / roomH;
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

    // Door notch at the bottom center, matching where the player enters/exits
    const doorW = 70;
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
      ctx.fillText("🔒 Locked — purchase not available yet", width / 2, bounds.top + (bounds.bottom - bounds.top) / 2);
      ctx.restore();
      return;
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

    ctx.font = "14px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("Placeholder interior — free-roam works, nothing to do yet", width / 2, bounds.bottom + 30);

    ctx.restore();
  }
}
