// The town is one straight street, 6 frames long (Section 12 of the spec).
// Each standard frame has a required (loop-progression) building and a
// flavor building. Required buildings always sit on the right-hand side of
// the road *relative to the forward direction of travel* (start -> Arena,
// i.e. increasing world X) so the player never needs a U-turn to reach one.
// In screen space (x right, y down) that means: required -> south/bottom
// row, flavor -> north/top row. v1 renders these as labeled placeholder
// blocks; entry/interiors come in a later piece.
//
// Frame 0 is the housing frame: a special 3-per-row layout of six
// purchasable homes instead of the usual required/flavor + filler pattern.

export type LotKind = "building" | "path";

export interface BuildingDef {
  name: string;
  kind?: LotKind; // "building" (default) or "path" (Beach: a walkway, not a structure)
  locked?: boolean;
}

// A specific enterable building/path placed in the world, used for
// proximity detection and entering (Section 12 town nav, piece 2+).
export interface LotInstance {
  building: BuildingDef;
  worldX: number; // lot center, world space
  row: "top" | "bottom";
}

export interface StandardFrameDef {
  kind: "standard";
  index: number;
  required: BuildingDef; // right-hand side driving toward the Arena; renders on bottom row
  flavor: BuildingDef | null; // left-hand side; renders on top row
}

export interface HousingFrameDef {
  kind: "housing";
  index: number;
  bottom: [BuildingDef, BuildingDef, BuildingDef]; // left, middle, right
  top: [BuildingDef, BuildingDef, BuildingDef]; // left, middle, right — top-left sits directly across from bottom-left
}

export type FrameDef = StandardFrameDef | HousingFrameDef;

export const FRAME_WIDTH = 900;

// Frame 5 (Arena) is not a normal lot frame either — it's the literal end
// of the road, handled as a special terminus by the renderer. See ARENA_*.
export const FRAMES: FrameDef[] = [
  {
    kind: "housing",
    index: 0,
    bottom: [
      { name: "Trailer" }, // start location — already owned
      { name: "Apartment", locked: true },
      { name: "Penthouse Apartment", locked: true },
    ],
    top: [
      { name: "Mansion", locked: true },
      { name: "Suburban House", locked: true },
      { name: "Townhouse", locked: true },
    ],
  },
  {
    kind: "standard",
    index: 1,
    required: { name: "Office" },
    flavor: { name: "Mall" },
  },
  {
    kind: "standard",
    index: 2,
    required: { name: "Gym" },
    flavor: { name: "Diner" },
  },
  {
    kind: "standard",
    index: 3,
    required: { name: "Lounge" },
    flavor: { name: "Beach", kind: "path" },
  },
  {
    kind: "standard",
    index: 4,
    required: { name: "Press Building" },
    flavor: { name: "Airport" },
  },
];

export const ARENA: BuildingDef = { name: "Arena" };
export const ARENA_FRAME_INDEX = 5;
export const TOTAL_FRAMES = ARENA_FRAME_INDEX + 1;

export const WORLD_WIDTH = FRAME_WIDTH * TOTAL_FRAMES;

// Depth (along the road) of the Arena's facade zone at the very end of the
// world, and how far in front of it the road/plaza stops.
export const ARENA_FACADE_DEPTH = 260;
export const ARENA_PLAZA_STOP = WORLD_WIDTH - ARENA_FACADE_DEPTH - 60;

// Lot layout within a standard (non-housing, non-Arena) frame's row:
// filler, filler, MAIN, filler, filler — so a real building is flanked by
// decorative, non-enterable buildings instead of spanning the whole frame.
export const LOTS_PER_ROW = 5;
export const MAIN_LOT_INDEX = 2;
export const LOT_WIDTH = FRAME_WIDTH / LOTS_PER_ROW;

// The housing frame instead uses exactly 3 full-width lots per row, no filler.
export const HOUSING_LOTS_PER_ROW = 3;
export const HOUSING_LOT_WIDTH = FRAME_WIDTH / HOUSING_LOTS_PER_ROW;

// Player starts on the road in front of the Trailer (housing frame, bottom-left lot).
export const START_WORLD_X = HOUSING_LOT_WIDTH * 0.5;

// How close (world px) the player must stop to a lot to be able to enter it.
export const ENTRY_PROXIMITY = 90;

function computeEnterableLots(): LotInstance[] {
  const lots: LotInstance[] = [];

  for (const frame of FRAMES) {
    const frameLeftWorld = frame.index * FRAME_WIDTH;

    if (frame.kind === "housing") {
      for (let i = 0; i < HOUSING_LOTS_PER_ROW; i++) {
        const cx = frameLeftWorld + (i + 0.5) * HOUSING_LOT_WIDTH;
        lots.push({ building: frame.top[i], worldX: cx, row: "top" });
        lots.push({ building: frame.bottom[i], worldX: cx, row: "bottom" });
      }
    } else {
      const cx = frameLeftWorld + (MAIN_LOT_INDEX + 0.5) * LOT_WIDTH;
      if (frame.flavor) lots.push({ building: frame.flavor, worldX: cx, row: "top" });
      lots.push({ building: frame.required, worldX: cx, row: "bottom" });
    }
  }

  // The Arena's entry point is the plaza right in front of its doors —
  // exactly where the road forces the player to stop.
  lots.push({ building: ARENA, worldX: ARENA_PLAZA_STOP, row: "bottom" });

  return lots;
}

export const ENTERABLE_LOTS: LotInstance[] = computeEnterableLots();

export function nearbyLots(worldX: number): LotInstance[] {
  return ENTERABLE_LOTS.filter((lot) => Math.abs(lot.worldX - worldX) <= ENTRY_PROXIMITY);
}

// Right-hand-drive convention (matches the lane the car actually drives
// in): facing toward the Arena (+1) puts the right-hand side on the
// bottom row; facing back toward the housing frame (-1) puts it on top.
export function rowForFacing(facing: 1 | -1): "top" | "bottom" {
  return facing === 1 ? "bottom" : "top";
}

export function frameAt(worldX: number): { index: number; label: string } {
  const idx = Math.min(
    TOTAL_FRAMES - 1,
    Math.max(0, Math.floor(worldX / FRAME_WIDTH)),
  );
  if (idx === ARENA_FRAME_INDEX) return { index: idx, label: "Arena" };
  if (idx === 0) return { index: idx, label: "Housing" };
  return { index: idx, label: `Frame ${idx + 1}/${TOTAL_FRAMES}` };
}
