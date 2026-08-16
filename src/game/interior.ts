import type { LotInstance } from "./world";

// Placeholder interior: a plain room with the building's name. Free-roam
// joystick movement inside it comes in the next piece — for now this just
// proves the enter/exit transition works.

export function renderInterior(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lot: LotInstance,
) {
  const locked = !!lot.building.locked;

  ctx.save();
  ctx.fillStyle = locked ? "#23262d" : "#2c2440";
  ctx.fillRect(0, 0, width, height);

  // Floor
  ctx.fillStyle = locked ? "#1a1c21" : "#241d38";
  ctx.fillRect(0, height * 0.6, width, height * 0.4);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#fff";
  ctx.font = "bold 30px sans-serif";
  ctx.fillText(lot.building.name, width / 2, height * 0.38);

  if (locked) {
    ctx.font = "18px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("🔒 Locked — purchase not available yet", width / 2, height * 0.47);
  } else {
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText("Placeholder interior — coming soon", width / 2, height * 0.47);
  }

  ctx.restore();
}
