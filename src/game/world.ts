// The town is one straight street, 6 frames long (Section 12 of the spec).
// Each frame has a required (loop-progression) building and a flavor
// building. Required buildings always sit on the right-hand side of the
// road *relative to the forward direction of travel* (Apartment -> Arena,
// i.e. increasing world X) so the player never needs a U-turn to reach one.
// In screen space (x right, y down) that means: required -> south/bottom
// row, flavor -> north/top row. v1 renders these as labeled placeholder
// blocks; entry/interiors come in a later piece.

export type LotKind = "building" | "path";

export interface BuildingDef {
  name: string;
  kind?: LotKind; // "building" (default) or "path" (Beach: a walkway, not a structure)
  locked?: boolean;
}

export interface FrameDef {
  index: number;
  required: BuildingDef; // right-hand side driving Apartment -> Arena; renders on bottom row
  flavor: BuildingDef | null; // left-hand side; renders on top row
}

export const FRAME_WIDTH = 900;

// Frame 5 (Arena) is not a normal lot frame — it's the literal end of the
// road, handled as a special terminus by the renderer. See ARENA_* below.
export const FRAMES: FrameDef[] = [
  {
    index: 0,
    required: { name: "Apartment" },
    flavor: { name: "Buyable Houses", locked: true },
  },
  {
    index: 1,
    required: { name: "Office" },
    flavor: { name: "Mall" },
  },
  {
    index: 2,
    required: { name: "Gym" },
    flavor: { name: "Diner" },
  },
  {
    index: 3,
    required: { name: "Lounge" },
    flavor: { name: "Beach", kind: "path" },
  },
  {
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

// Lot layout within a normal (non-Arena) frame's row: filler, filler,
// MAIN, filler, filler — so a real building is flanked by decorative,
// non-enterable buildings instead of spanning the whole frame.
export const LOTS_PER_ROW = 5;
export const MAIN_LOT_INDEX = 2;
export const LOT_WIDTH = FRAME_WIDTH / LOTS_PER_ROW;

export function frameAt(worldX: number): { index: number; label: string } {
  const idx = Math.min(
    TOTAL_FRAMES - 1,
    Math.max(0, Math.floor(worldX / FRAME_WIDTH)),
  );
  if (idx === ARENA_FRAME_INDEX) return { index: idx, label: "Arena" };
  return { index: idx, label: `Frame ${idx + 1}/${TOTAL_FRAMES}` };
}
