import {
  FRAMES,
  FRAME_WIDTH,
  WORLD_WIDTH,
  ARENA,
  ARENA_FRAME_INDEX,
  ARENA_FACADE_DEPTH,
  ARENA_PLAZA_STOP,
  LOTS_PER_ROW,
  MAIN_LOT_INDEX,
  LOT_WIDTH,
  HOUSING_LOTS_PER_ROW,
  HOUSING_LOT_WIDTH,
  START_WORLD_X,
  frameAt,
  type BuildingDef,
  type LotInstance,
} from "./world";
import type { DriveControls } from "../ui/controls";
import {
  ROAD_TEXTURE_DATA_URI,
  ROAD_TEXTURE_WIDTH,
  ROAD_TEXTURE_HEIGHT,
  ROAD_TEXTURE_ROAD_TOP,
  ROAD_TEXTURE_ROAD_BOTTOM,
} from "../assets/roadTexture";
import {
  TRAILER_LOT_DATA_URI,
  TRAILER_LOT_WIDTH,
  TRAILER_LOT_HEIGHT,
  TRAILER_LOT_GROUND_STRIP_TOP,
  TRAILER_LOT_GROUND_STRIP_HEIGHT,
} from "../assets/trailerLot";
import {
  APARTMENT_LOT_DATA_URI,
  APARTMENT_LOT_WIDTH,
  APARTMENT_LOT_HEIGHT,
  APARTMENT_LOT_GROUND_STRIP_TOP,
  APARTMENT_LOT_GROUND_STRIP_HEIGHT,
} from "../assets/apartmentLot";

// Loaded once at module scope — decoding is async, so render() falls back
// to the old flat-color road/sidewalk (see the `roadImage.complete` check
// below) until it's ready, rather than risk a blank frame.
const roadImage = new Image();
roadImage.src = ROAD_TEXTURE_DATA_URI;

// Same async-load pattern as roadImage — drawBuilding() falls back to the
// old flat-color fill for these ground-image lots until each decodes.
const trailerLotImage = new Image();
trailerLotImage.src = TRAILER_LOT_DATA_URI;
const apartmentLotImage = new Image();
apartmentLotImage.src = APARTMENT_LOT_DATA_URI;

// Ground-image lots (Trailer, Apartment): the photo is a whole small lot,
// not a single building icon, so it's drawn as ground rather than a
// labeled/bordered box — see drawGroundImageLot(). Keyed by building name.
interface GroundImageLot {
  image: HTMLImageElement;
  imageWidth: number;
  imageHeight: number;
  groundStripTop: number;
  groundStripHeight: number;
  touchesRight?: boolean; // extends its drawn rect across the lot gap on its east side
  touchesLeft?: boolean; // extends its drawn rect across the lot gap on its west side
}

const GROUND_IMAGE_LOTS: Record<string, GroundImageLot> = {
  Trailer: {
    image: trailerLotImage,
    imageWidth: TRAILER_LOT_WIDTH,
    imageHeight: TRAILER_LOT_HEIGHT,
    groundStripTop: TRAILER_LOT_GROUND_STRIP_TOP,
    groundStripHeight: TRAILER_LOT_GROUND_STRIP_HEIGHT,
    touchesRight: true, // touches the Apartment lot next door, no gap
  },
  Apartment: {
    image: apartmentLotImage,
    imageWidth: APARTMENT_LOT_WIDTH,
    imageHeight: APARTMENT_LOT_HEIGHT,
    groundStripTop: APARTMENT_LOT_GROUND_STRIP_TOP,
    groundStripHeight: APARTMENT_LOT_GROUND_STRIP_HEIGHT,
    touchesLeft: true, // touches the Trailer lot next door, no gap
  },
};

const MAX_SPEED = 420; // world px/sec, before any Speed Boost multiplier
const ACCEL = 900; // px/sec^2 while gas or reverse held
const DECEL = 1400; // px/sec^2 while released
const STOPPED_EPS = 4;
const START_MARGIN = 80;

// Autopilot skillset (Section 5): rather than teleporting straight there,
// the car starts this far back from the destination (in the direction
// it'll be facing on arrival) and drives itself the rest of the way over
// AUTOPILOT_DURATION seconds, easing to a stop right at the door — a
// short, visible arrival beat instead of an instant cut.
const AUTOPILOT_ARRIVAL_DISTANCE = 400; // world px
const AUTOPILOT_DURATION = 1; // seconds

// The asphalt band was rendering roughly 4x as deep as the sidewalk
// (visually too thick) — halved to bring it to roughly 2x, the reported
// correct proportion. LANE_OFFSET keeps the same 0.5 ratio to
// ROAD_HALF_HEIGHT it always had, so the car still sits safely inside the
// (now narrower) lane instead of drifting toward the new edge.
const ROAD_HALF_HEIGHT = 45;
const LANE_OFFSET = 22; // right-hand-drive: car sits in its half of the road, not straddling the centerline
const UTURN_DURATION = 0.8; // seconds for a real turn-around, not an instant flip

const BUILDING_DEPTH = 140;
const BUILDING_MARGIN = 24;
const LOT_GAP = 14; // gap between neighboring lots so buildings read as separate

// The sidewalk band's scale is pinned to the depth it has always rendered
// at (as if ROAD_HALF_HEIGHT were still its original 90) — decoupled from
// the current ROAD_HALF_HEIGHT so shrinking the road doesn't also shrink
// the sidewalk. See drawRoadSurface(), which draws the sidewalk and road
// bands as separate, independently-scaled strips of the same photo.
const ORIGINAL_ROAD_HALF_HEIGHT = 90;
const SIDEWALK_SCALE =
  (ORIGINAL_ROAD_HALF_HEIGHT * 2) / (ROAD_TEXTURE_ROAD_BOTTOM - ROAD_TEXTURE_ROAD_TOP);
const ROAD_SCALE = (ROAD_HALF_HEIGHT * 2) / (ROAD_TEXTURE_ROAD_BOTTOM - ROAD_TEXTURE_ROAD_TOP);
// The Trailer/Apartment ground-image lots key off this to line their edge
// up with the sidewalk's outer edge — unaffected by the road resize.
const SIDEWALK_NORTH_DEPTH = ROAD_TEXTURE_ROAD_TOP * SIDEWALK_SCALE;
const SIDEWALK_SOUTH_DEPTH = (ROAD_TEXTURE_HEIGHT - ROAD_TEXTURE_ROAD_BOTTOM) * SIDEWALK_SCALE;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export class StreetScene {
  private worldX = START_WORLD_X;
  private facing: 1 | -1 = 1;
  private speed = 0; // signed, world px/sec (sign matches facing when moving)

  private isUTurning = false;
  private uturnT = 0;
  private uturnFromFacing: 1 | -1 = 1;
  private uturnToFacing: 1 | -1 = -1;

  private isAutopiloting = false;
  private autopilotT = 0;
  private autopilotFromX = 0;
  private autopilotToX = 0;

  // Vehicle Dealer skillsets (Section 5): Speed Boost raises top speed;
  // Reverse Driving unlocks the hold-to-back-up control (see the REVERSE
  // button in DriveControls) — its own top speed is reverseRatio * this
  // vehicle's forward top speed, so a higher-tier car backs up faster too
  // (0 means no Reverse Driving skillset, hiding the button entirely);
  // Autopilot unlocks the destination-drive button. Set via
  // setPerformance() whenever the active vehicle changes; all default to
  // no bonus (a Tier 1 car, or no car at all).
  private speedMultiplier = 1;
  private reverseRatio = 0;

  private controls: DriveControls;

  constructor(controls: DriveControls) {
    this.controls = controls;
    controls.onUTurn(() => {
      if (this.isUTurning) return;
      if (Math.abs(this.speed) < STOPPED_EPS) {
        this.isUTurning = true;
        this.uturnT = 0;
        this.uturnFromFacing = this.facing;
        this.uturnToFacing = this.facing === 1 ? -1 : 1;
      }
    });
  }

  /** Vehicle Dealer (Section 5): applies the active vehicle's skillsets. Called on purchase/switch. */
  setPerformance(speedMultiplier: number, reverseRatio: number, autopilotCapable: boolean) {
    this.speedMultiplier = speedMultiplier;
    this.reverseRatio = reverseRatio;
    this.controls.setReverseVisible(reverseRatio > 0);
    this.controls.setAutopilotVisible(autopilotCapable);
  }

  /**
   * Vehicle Dealer Autopilot skillset: drives itself to a destination
   * instead of the player driving there. Starts AUTOPILOT_ARRIVAL_DISTANCE
   * back from the lot, already facing the direction that makes its row the
   * enterable (right-hand) side, and eases to a stop right at the door
   * over AUTOPILOT_DURATION seconds — a short arrival beat rather than an
   * instant cut, so the building is enterable the moment it finishes
   * without needing a follow-up U-turn.
   */
  autopilotTo(lot: LotInstance) {
    const facing: 1 | -1 = lot.row === "bottom" ? 1 : -1;
    const toX = Math.max(START_MARGIN, Math.min(ARENA_PLAZA_STOP, lot.worldX));
    const fromX = Math.max(START_MARGIN, Math.min(ARENA_PLAZA_STOP, toX - AUTOPILOT_ARRIVAL_DISTANCE * facing));
    this.isUTurning = false;
    this.speed = 0;
    this.facing = facing;
    this.worldX = fromX;
    this.isAutopiloting = true;
    this.autopilotT = 0;
    this.autopilotFromX = fromX;
    this.autopilotToX = toX;
  }

  update(dt: number) {
    if (this.isAutopiloting) {
      this.autopilotT = Math.min(1, this.autopilotT + dt / AUTOPILOT_DURATION);
      const eased = smoothstep(this.autopilotT);
      this.worldX = this.autopilotFromX + (this.autopilotToX - this.autopilotFromX) * eased;
      if (this.autopilotT >= 1) {
        this.isAutopiloting = false;
        this.worldX = this.autopilotToX;
        this.speed = 0;
      }
      this.controls.setUTurnEnabled(false);
      this.controls.setGasEnabled(false);
      this.controls.setReverseEnabled(false);
      this.controls.setAutopilotEnabled(false);
      return;
    }

    if (this.isUTurning) {
      // Faster cars spin around faster too — U-turn duration scales
      // inversely with Speed Boost (a Tier 1 car with no boost still takes
      // the full baseline time; the Supercar's 2.4x speed multiplier makes
      // its turn-around correspondingly quicker).
      this.uturnT += dt / (UTURN_DURATION / this.speedMultiplier);
      if (this.uturnT >= 1) {
        this.uturnT = 1;
        this.facing = this.uturnToFacing;
        this.isUTurning = false;
      }
      this.controls.setUTurnEnabled(false);
      this.controls.setGasEnabled(false);
      this.controls.setReverseEnabled(false);
      this.controls.setAutopilotEnabled(false);
      return;
    }

    const gasHeld = this.controls.isGasHeld();
    const reverseHeld = !gasHeld && this.reverseRatio > 0 && this.controls.isReverseHeld();

    if (gasHeld) {
      const target = MAX_SPEED * this.speedMultiplier * this.facing;
      const diff = target - this.speed;
      const step = ACCEL * dt;
      this.speed += Math.sign(diff) * Math.min(Math.abs(diff), step);
    } else if (reverseHeld) {
      // Backs straight up opposite the way the car is facing, without
      // flipping facing — a shorter, cheaper repositioning move than a
      // full U-turn-and-drive-back. Top reverse speed is a fraction of
      // this vehicle's own forward top speed (see reverseRatio above).
      const target = -(MAX_SPEED * this.speedMultiplier * this.reverseRatio) * this.facing;
      const diff = target - this.speed;
      const step = ACCEL * dt;
      this.speed += Math.sign(diff) * Math.min(Math.abs(diff), step);
    } else if (Math.abs(this.speed) > 0) {
      const step = DECEL * dt;
      if (Math.abs(this.speed) <= step) this.speed = 0;
      else this.speed -= Math.sign(this.speed) * step;
    }

    this.worldX += this.speed * dt;
    // The road dead-ends at the housing frame on one side and the Arena
    // plaza on the other — you drive up to the Arena's doors, not past them.
    const clamped = Math.max(START_MARGIN, Math.min(ARENA_PLAZA_STOP, this.worldX));
    if (clamped !== this.worldX) this.speed = 0;
    this.worldX = clamped;

    const stopped = Math.abs(this.speed) < STOPPED_EPS;
    this.controls.setUTurnEnabled(stopped);
    this.controls.setGasEnabled(true);
    this.controls.setReverseEnabled(true);
    this.controls.setAutopilotEnabled(stopped);
  }

  private laneOffsetForFacing(facing: 1 | -1): number {
    // Right-hand-drive convention: your lane is on your right relative to
    // your direction of travel. Facing +1 (toward the Arena) -> right hand
    // points south (bottom row) -> positive Y offset. Facing -1 -> north lane.
    return facing === 1 ? LANE_OFFSET : -LANE_OFFSET;
  }

  private currentLaneOffset(): number {
    if (!this.isUTurning) return this.laneOffsetForFacing(this.facing);
    const from = this.laneOffsetForFacing(this.uturnFromFacing);
    const to = this.laneOffsetForFacing(this.uturnToFacing);
    return from + (to - from) * smoothstep(this.uturnT);
  }

  private currentAngle(): number {
    const fromAngle = this.uturnFromFacing === 1 ? 0 : Math.PI;
    if (!this.isUTurning) return this.facing === 1 ? 0 : Math.PI;
    return fromAngle + Math.PI * smoothstep(this.uturnT);
  }

  getCurrentFrameLabel(): string {
    return frameAt(this.worldX).label;
  }

  getWorldX(): number {
    return this.worldX;
  }

  getFacing(): 1 | -1 {
    return this.facing;
  }

  isStopped(): boolean {
    return !this.isUTurning && !this.isAutopiloting && Math.abs(this.speed) < STOPPED_EPS;
  }

  // Screen-space point at a lot's entrance (where it meets the road), so
  // UI like the ENTER button can be anchored to the actual building.
  getEntranceScreenPos(lot: LotInstance, width: number, height: number): { x: number; y: number } {
    const camX = Math.max(width / 2, Math.min(WORLD_WIDTH - width / 2, this.worldX));
    const roadY = height / 2;
    const x = lot.worldX - camX + width / 2;

    if (lot.building === ARENA) return { x, y: roadY };

    const y =
      lot.row === "bottom"
        ? roadY + ROAD_HALF_HEIGHT + BUILDING_MARGIN
        : roadY - ROAD_HALF_HEIGHT - BUILDING_MARGIN;
    return { x, y };
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

    const topEdgeY = roadY - ROAD_HALF_HEIGHT - BUILDING_MARGIN; // flavor row (north)
    const bottomEdgeY = roadY + ROAD_HALF_HEIGHT + BUILDING_MARGIN; // required row (south)

    // Layer order: ground → building lots → sidewalk → road → player/UI.
    // Generic ground first (the same sidewalk-tone backdrop every frame has
    // always had beyond its buildings), then the building lots on top of
    // that, then the sidewalk/road texture last of all, so nothing in the
    // lot layer — e.g. the Trailer's ground-texture lot reaching for the
    // sidewalk's edge — can ever paint over the sidewalk or road.
    ctx.fillStyle = SIDEWALK_FALLBACK_COLOR;
    ctx.fillRect(0, 0, width, roadY - ROAD_HALF_HEIGHT);
    ctx.fillRect(0, roadY + ROAD_HALF_HEIGHT, width, height - (roadY + ROAD_HALF_HEIGHT));
    for (const frame of FRAMES) {
      const frameLeftWorld = frame.index * FRAME_WIDTH;

      if (frame.kind === "housing") {
        for (let lot = 0; lot < HOUSING_LOTS_PER_ROW; lot++) {
          const lotCenterWorld = frameLeftWorld + (lot + 0.5) * HOUSING_LOT_WIDTH;
          const sx = toScreenX(lotCenterWorld);
          if (sx < -HOUSING_LOT_WIDTH || sx > width + HOUSING_LOT_WIDTH) continue;

          const lotW = HOUSING_LOT_WIDTH - LOT_GAP;
          drawBuilding(ctx, frame.top[lot], sx, topEdgeY, lotW, BUILDING_DEPTH, "up", height);
          drawBuilding(
            ctx,
            frame.bottom[lot],
            sx,
            bottomEdgeY,
            lotW,
            BUILDING_DEPTH,
            "down",
            height,
            lot === 0, // bottom-left: Trailer, the start location
          );
        }
      } else {
        for (let lot = 0; lot < LOTS_PER_ROW; lot++) {
          const lotCenterWorld = frameLeftWorld + (lot + 0.5) * LOT_WIDTH;
          const sx = toScreenX(lotCenterWorld);
          if (sx < -LOT_WIDTH || sx > width + LOT_WIDTH) continue;

          const lotW = LOT_WIDTH - LOT_GAP;
          const isMain = lot === MAIN_LOT_INDEX;

          drawLot(ctx, isMain ? frame.flavor : null, sx, topEdgeY, lotW, "up", height, seedFor(frame.index, 0, lot));
          drawLot(
            ctx,
            isMain ? frame.required : null,
            sx,
            bottomEdgeY,
            lotW,
            "down",
            height,
            seedFor(frame.index, 1, lot),
          );
        }
      }

      const dividerX = toScreenX(frameLeftWorld);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(dividerX, topEdgeY - BUILDING_DEPTH);
      ctx.lineTo(dividerX, bottomEdgeY + BUILDING_DEPTH);
      ctx.stroke();
    }

    // Road + flanking sidewalk strip — real texture (see roadTexture.ts),
    // tiled left-to-right; see drawRoadSurface for the fallback while it
    // loads and the scale-to-ROAD_HALF_HEIGHT math. Drawn after every lot
    // above so it always sits on top of them (see the layer-order note).
    drawRoadSurface(ctx, width, roadY, camX, toScreenX);

    // Arena terminus: parking lots flanking the road, then the arena
    // facade spanning the full width of the road at the literal dead end.
    drawArenaTerminus(ctx, toScreenX, width, roadY, topEdgeY, bottomEdgeY);

    // Player (top-down bike placeholder), in its lane, rotating through a
    // real turn-around rather than an instant flip.
    const px = toScreenX(this.worldX);
    const py = roadY + this.currentLaneOffset();
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(this.currentAngle());
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(-18, -9, 36, 18);
    ctx.fillStyle = "#111";
    ctx.fillRect(10, -11, 8, 22);
    ctx.restore();

    ctx.restore();
  }
}

function seedFor(frameIndex: number, row: number, lot: number): number {
  return frameIndex * 97 + row * 31 + lot * 7;
}

function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const FILLER_COLORS = ["#4a4f5c", "#3f4a52", "#4f4640", "#454050", "#3d4a3f"];

// Blended from the road texture's own sidewalk tone (see roadTexture.ts) —
// the generic ground fill painted before every lot layer in render() (grass
// then overwrites the Housing frame's own strip of it), and also what
// backs the real sidewalk texture if it hasn't decoded yet.
const SIDEWALK_FALLBACK_COLOR = "#8c8b8a";

/**
 * Draws the road + flanking sidewalk strip using the real texture (see
 * assets/roadTexture.ts). The sidewalk and road bands are cropped from the
 * source photo and drawn as two independently-scaled strips (SIDEWALK_SCALE
 * vs ROAD_SCALE) rather than one uniform scale for the whole image, so the
 * road can be resized (ROAD_HALF_HEIGHT) without also resizing the
 * sidewalk. Falls back to the original flat-color road/dashes if the image
 * hasn't finished decoding yet (module load is async).
 */
function drawRoadSurface(
  ctx: CanvasRenderingContext2D,
  width: number,
  roadY: number,
  camX: number,
  toScreenX: (wx: number) => number,
) {
  // The sidewalk-tone ground fill (SIDEWALK_FALLBACK_COLOR) is already
  // painted for the full canvas in render(), before the building-lot
  // layer — this function only has to add the sidewalk + road bands on
  // top of that.
  if (!roadImage.complete || roadImage.naturalWidth === 0) {
    // Not decoded yet — keep the original flat road + dashed centerline
    // instead of a gap while roadImage finishes loading.
    ctx.fillStyle = "#3a3f4b";
    ctx.fillRect(0, roadY - ROAD_HALF_HEIGHT, width, ROAD_HALF_HEIGHT * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 4;
    ctx.setLineDash([28, 22]);
    ctx.beginPath();
    ctx.moveTo(0, roadY);
    ctx.lineTo(width, roadY);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  const roadBandSourceHeight = ROAD_TEXTURE_ROAD_BOTTOM - ROAD_TEXTURE_ROAD_TOP;
  const southSidewalkSourceHeight = ROAD_TEXTURE_HEIGHT - ROAD_TEXTURE_ROAD_BOTTOM;

  drawTexturedBand(
    ctx,
    width,
    camX,
    toScreenX,
    0,
    ROAD_TEXTURE_ROAD_TOP,
    roadY - ROAD_HALF_HEIGHT - SIDEWALK_NORTH_DEPTH,
    SIDEWALK_SCALE,
  );
  drawTexturedBand(
    ctx,
    width,
    camX,
    toScreenX,
    ROAD_TEXTURE_ROAD_TOP,
    roadBandSourceHeight,
    roadY - ROAD_HALF_HEIGHT,
    ROAD_SCALE,
  );
  drawTexturedBand(
    ctx,
    width,
    camX,
    toScreenX,
    ROAD_TEXTURE_ROAD_BOTTOM,
    southSidewalkSourceHeight,
    roadY + ROAD_HALF_HEIGHT,
    SIDEWALK_SCALE,
  );
}

// Tiles one horizontal slice of the road texture (source rows [sy, sy+sh))
// left-to-right, world-locked (like the buildings) so it scrolls with the
// world instead of sitting screen-fixed, at its own independent scale.
function drawTexturedBand(
  ctx: CanvasRenderingContext2D,
  width: number,
  camX: number,
  toScreenX: (wx: number) => number,
  sy: number,
  sh: number,
  destTop: number,
  scale: number,
) {
  const tileW = ROAD_TEXTURE_WIDTH * scale;
  const destH = sh * scale;
  const worldLeft = camX - width / 2;
  const firstTileIndex = Math.floor(worldLeft / tileW) - 1;
  for (let i = firstTileIndex; ; i++) {
    const screenX = toScreenX(i * tileW);
    if (screenX > width) break;
    ctx.drawImage(roadImage, 0, sy, ROAD_TEXTURE_WIDTH, sh, screenX, destTop, tileW, destH);
  }
}

function drawLot(
  ctx: CanvasRenderingContext2D,
  building: BuildingDef | null,
  centerX: number,
  edgeY: number,
  w: number,
  dir: "up" | "down",
  canvasHeight: number,
  seed: number,
  isStart = false,
) {
  if (building && building.kind === "path") {
    drawPath(ctx, building, centerX, edgeY, w, dir);
    return;
  }
  if (building) {
    drawBuilding(ctx, building, centerX, edgeY, w, BUILDING_DEPTH, dir, canvasHeight, isStart);
    return;
  }
  drawFillerBuilding(ctx, centerX, edgeY, w, dir, seed);
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  building: BuildingDef,
  centerX: number,
  edgeY: number,
  w: number,
  depth: number,
  dir: "up" | "down",
  canvasHeight: number,
  isStart = false,
) {
  const top = dir === "up" ? edgeY - depth : edgeY;
  const x = centerX - w / 2;

  const groundLot = GROUND_IMAGE_LOTS[building.name];
  const useGroundImage = !!groundLot && groundLot.image.complete && groundLot.image.naturalWidth > 0;

  if (useGroundImage) {
    // No LOCKED overlay here — the ground photo is the whole lot, not a
    // labeled card, and the purchase gate is already enforced on entry
    // (main.ts) regardless of any on-lot text.
    drawGroundImageLot(ctx, groundLot, x, w, top, canvasHeight);
    return;
  }

  ctx.fillStyle = building.locked ? "#3d3d3d" : isStart ? "#4a6fa5" : "#5a4a7a";
  ctx.fillRect(x, top, w, depth);
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, top, w, depth);

  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  wrapText(ctx, building.name, centerX, top + depth / 2, w - 12);

  if (building.locked) {
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("LOCKED", centerX, top + depth / 2 + 34);
  }
}

/**
 * Ground-image lots (Trailer, Apartment, ...): the photo is a whole small
 * lot, not one building icon, so it's drawn as ground — no border, no name
 * label. South row only (every entry in GROUND_IMAGE_LOTS is dir="down" —
 * SIDEWALK_SOUTH_DEPTH and "extend down to canvasHeight" both assume that).
 * None of this touches the ENTER trigger, which keys off the original
 * edgeY/w the caller (drawBuilding) received — this only moves pixels
 * drawn on top of it.
 */
function drawGroundImageLot(
  ctx: CanvasRenderingContext2D,
  lot: GroundImageLot,
  x: number,
  w: number,
  top: number,
  canvasHeight: number,
) {
  // Extend the drawn rect across half the lot gap on whichever side this
  // lot touches its ground-image neighbor, so there's no gray strip
  // between them (their outer, non-touching edges are untouched, so the
  // gap toward every other neighbor is unchanged).
  let drawX = x;
  let drawWidth = w;
  if (lot.touchesLeft) {
    drawX -= LOT_GAP / 2;
    drawWidth += LOT_GAP / 2;
  }
  if (lot.touchesRight) {
    drawWidth += LOT_GAP / 2;
  }

  const roadTop = top - SIDEWALK_SOUTH_DEPTH;
  const imgDepth = canvasHeight - roadTop;

  // Scale by width only — never shrink the buildings in the photo — and
  // draw the whole photo at that size. If the box is shorter than the
  // photo at that scale, the bottom is clipped (never the sides, since the
  // photo is scaled to exactly match the lot's width) rather than shrinking
  // anything; if the box is taller, the leftover depth below the photo is
  // filled by repeating a building-free ground strip sampled from the
  // photo itself, instead of a flat-color or blank gap.
  const scale = drawWidth / lot.imageWidth;
  const drawH = lot.imageHeight * scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(drawX, roadTop, drawWidth, imgDepth);
  ctx.clip();
  ctx.drawImage(lot.image, drawX, roadTop, drawWidth, drawH);

  const stripDrawH = lot.groundStripHeight * scale;
  for (let cursorY = roadTop + drawH; cursorY < roadTop + imgDepth; cursorY += stripDrawH) {
    ctx.drawImage(
      lot.image,
      0,
      lot.groundStripTop,
      lot.imageWidth,
      lot.groundStripHeight,
      drawX,
      cursorY,
      drawWidth,
      stripDrawH,
    );
  }
  ctx.restore();
}

function drawFillerBuilding(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  edgeY: number,
  w: number,
  dir: "up" | "down",
  seed: number,
) {
  const heightScale = 0.55 + hash01(seed) * 0.45;
  const depth = BUILDING_DEPTH * heightScale;
  const top = dir === "up" ? edgeY - depth : edgeY;
  const x = centerX - w / 2;
  const color = FILLER_COLORS[Math.floor(hash01(seed + 0.37) * FILLER_COLORS.length)];

  ctx.fillStyle = color;
  ctx.fillRect(x, top, w, depth);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, top, w, depth);

  // A couple of window dots for texture, still just placeholder shapes.
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  const rows = Math.max(1, Math.floor(depth / 32));
  for (let r = 0; r < rows; r++) {
    const wy = top + 14 + r * 26;
    ctx.fillRect(x + w * 0.28 - 3, wy, 6, 6);
    ctx.fillRect(x + w * 0.68 - 3, wy, 6, 6);
  }
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  building: BuildingDef,
  centerX: number,
  edgeY: number,
  w: number,
  dir: "up" | "down",
) {
  // The Beach isn't a building — it's a sandy walkway leading off the road.
  const depth = BUILDING_DEPTH * 0.9;
  const top = dir === "up" ? edgeY - depth : edgeY;
  const bottom = dir === "up" ? edgeY : edgeY + depth;
  const pathW = w * 0.55;
  const x = centerX - pathW / 2;

  ctx.fillStyle = "#d8c48a";
  ctx.beginPath();
  ctx.moveTo(x, dir === "up" ? bottom : top);
  ctx.lineTo(x + pathW, dir === "up" ? bottom : top);
  ctx.lineTo(centerX + pathW * 0.3, dir === "up" ? top : bottom);
  ctx.lineTo(centerX - pathW * 0.3, dir === "up" ? top : bottom);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 10]);
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const yy = top + depth * t;
    ctx.beginPath();
    ctx.moveTo(x + pathW * (0.5 - 0.5 * (1 - t) * 0.5), yy);
    ctx.lineTo(x + pathW * (0.5 + 0.5 * (1 - t) * 0.5), yy);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.fillStyle = "#3a3020";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(building.name, centerX, dir === "up" ? top - 14 : bottom + 14);
}

function drawArenaTerminus(
  ctx: CanvasRenderingContext2D,
  toScreenX: (wx: number) => number,
  width: number,
  roadY: number,
  topEdgeY: number,
  bottomEdgeY: number,
) {
  const zoneStartWorld = ARENA_FRAME_INDEX * FRAME_WIDTH;
  const facadeStartWorld = WORLD_WIDTH - ARENA_FACADE_DEPTH;

  const parkingLeftSx = toScreenX(zoneStartWorld);
  const facadeSx = toScreenX(facadeStartWorld);
  const endSx = toScreenX(WORLD_WIDTH);

  if (facadeSx > -50 && parkingLeftSx < width + 50) {
    // Parking lots flanking the road on the approach to the Arena.
    drawParkingLot(ctx, parkingLeftSx, facadeSx, topEdgeY - BUILDING_DEPTH, topEdgeY);
    drawParkingLot(ctx, parkingLeftSx, facadeSx, bottomEdgeY, bottomEdgeY + BUILDING_DEPTH);
  }

  if (endSx > -50 && facadeSx < width + 50) {
    // The Arena itself: a facade spanning the full width of the road,
    // the literal dead end of the street.
    const top = topEdgeY - BUILDING_DEPTH * 1.3;
    const bottom = bottomEdgeY + BUILDING_DEPTH * 1.3;
    const x = facadeSx;
    const w = Math.max(4, endSx - facadeSx);

    const grad = ctx.createLinearGradient(x, top, x, bottom);
    grad.addColorStop(0, "#8a1f2b");
    grad.addColorStop(1, "#5a1420");
    ctx.fillStyle = grad;
    ctx.fillRect(x, top, w, bottom - top);
    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, top, w, bottom - top);

    ctx.fillStyle = "#ffd23f";
    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ARENA.name.toUpperCase(), x + w / 2, top + (bottom - top) / 2 - 20);

    // Entrance doors at road level
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(x + w / 2 - 34, roadY - 30, 68, 60);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + w / 2 - 34, roadY - 30, 68, 60);
  }
}

function drawParkingLot(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y1: number,
  y2: number,
) {
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0) return;
  ctx.fillStyle = "#4b4e55";
  ctx.fillRect(x1, y1, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  const stripes = Math.max(1, Math.floor(w / 60));
  for (let i = 1; i < stripes; i++) {
    const sx = x1 + (w / stripes) * i;
    ctx.beginPath();
    ctx.moveTo(sx, y1 + h * 0.15);
    ctx.lineTo(sx, y1 + h * 0.85);
    ctx.stroke();
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const lineHeight = 18;
  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
}
