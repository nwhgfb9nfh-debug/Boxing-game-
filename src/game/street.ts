import { FRAMES, FRAME_WIDTH, WORLD_WIDTH, frameAt, type BuildingDef } from "./world";
import type { DriveControls } from "../ui/controls";

const MAX_SPEED = 420; // world px/sec
const ACCEL = 900; // px/sec^2 while gas held
const DECEL = 1400; // px/sec^2 while gas released
const STOPPED_EPS = 4;

const ROAD_HALF_HEIGHT = 90;
const BUILDING_DEPTH = 140;
const BUILDING_MARGIN = 24;

export class StreetScene {
  private worldX = FRAME_WIDTH / 2; // start in front of the Apartment (frame 0)
  private facing: 1 | -1 = 1;
  private speed = 0; // signed, world px/sec (sign matches facing when moving)

  private controls: DriveControls;

  constructor(controls: DriveControls) {
    this.controls = controls;
    controls.onUTurn(() => {
      if (Math.abs(this.speed) < STOPPED_EPS) {
        this.facing = this.facing === 1 ? -1 : 1;
      }
    });
  }

  update(dt: number) {
    const gasHeld = this.controls.isGasHeld();

    if (gasHeld) {
      const target = MAX_SPEED * this.facing;
      const diff = target - this.speed;
      const step = ACCEL * dt;
      this.speed += Math.sign(diff) * Math.min(Math.abs(diff), step);
    } else if (Math.abs(this.speed) > 0) {
      const step = DECEL * dt;
      if (Math.abs(this.speed) <= step) this.speed = 0;
      else this.speed -= Math.sign(this.speed) * step;
    }

    this.worldX += this.speed * dt;
    const margin = 80;
    this.worldX = Math.max(margin, Math.min(WORLD_WIDTH - margin, this.worldX));

    this.controls.setUTurnEnabled(Math.abs(this.speed) < STOPPED_EPS);
  }

  getCurrentFrameLabel(): string {
    const f = frameAt(this.worldX);
    return `Frame ${f.index + 1}/${FRAMES.length}`;
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.save();
    ctx.fillStyle = "#171a21";
    ctx.fillRect(0, 0, width, height);

    const camX = Math.max(
      width / 2,
      Math.min(WORLD_WIDTH - width / 2, this.worldX),
    );
    const roadY = height / 2;
    const toScreenX = (wx: number) => wx - camX + width / 2;

    // Sidewalks / ground either side of the road
    ctx.fillStyle = "#2a2f3a";
    ctx.fillRect(0, 0, width, roadY - ROAD_HALF_HEIGHT);
    ctx.fillRect(0, roadY + ROAD_HALF_HEIGHT, width, height - (roadY + ROAD_HALF_HEIGHT));

    // Road
    ctx.fillStyle = "#3a3f4b";
    ctx.fillRect(0, roadY - ROAD_HALF_HEIGHT, width, ROAD_HALF_HEIGHT * 2);

    // Lane dashes
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 4;
    ctx.setLineDash([28, 22]);
    ctx.beginPath();
    ctx.moveTo(0, roadY);
    ctx.lineTo(width, roadY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Buildings per frame
    for (const frame of FRAMES) {
      const frameLeftWorld = frame.index * FRAME_WIDTH;
      const frameCenterWorld = frameLeftWorld + FRAME_WIDTH / 2;
      const sx = toScreenX(frameCenterWorld);
      if (sx < -FRAME_WIDTH / 2 - 100 || sx > width + FRAME_WIDTH / 2 + 100) continue;

      drawBuilding(
        ctx,
        frame.right,
        sx,
        roadY - ROAD_HALF_HEIGHT - BUILDING_MARGIN,
        FRAME_WIDTH - 40,
        BUILDING_DEPTH,
        "up",
        frame.index === 0,
      );
      if (frame.left) {
        drawBuilding(
          ctx,
          frame.left,
          sx,
          roadY + ROAD_HALF_HEIGHT + BUILDING_MARGIN,
          FRAME_WIDTH - 40,
          BUILDING_DEPTH,
          "down",
        );
      }

      // Frame divider
      const dividerX = toScreenX(frameLeftWorld);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(dividerX, roadY - ROAD_HALF_HEIGHT - BUILDING_MARGIN - BUILDING_DEPTH);
      ctx.lineTo(dividerX, roadY + ROAD_HALF_HEIGHT + BUILDING_MARGIN + BUILDING_DEPTH);
      ctx.stroke();
    }

    // Player (top-down bike placeholder)
    const px = toScreenX(this.worldX);
    ctx.save();
    ctx.translate(px, roadY);
    ctx.scale(this.facing, 1);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(-18, -9, 36, 18);
    ctx.fillStyle = "#111";
    ctx.fillRect(10, -11, 8, 22);
    ctx.restore();

    ctx.restore();
  }
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  building: BuildingDef,
  centerX: number,
  edgeY: number,
  w: number,
  depth: number,
  dir: "up" | "down",
  isStart = false,
) {
  const top = dir === "up" ? edgeY - depth : edgeY;
  const x = centerX - w / 2;

  ctx.fillStyle = building.locked ? "#3d3d3d" : isStart ? "#4a6fa5" : "#5a4a7a";
  ctx.fillRect(x, top, w, depth);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, top, w, depth);

  ctx.fillStyle = "#fff";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(building.name, centerX, top + depth / 2);

  if (building.locked) {
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("LOCKED", centerX, top + depth / 2 + 26);
  }
}
