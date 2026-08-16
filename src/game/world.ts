// The town is one straight street, 6 frames long (Section 12 of the spec).
// Each frame has a required building on the right side of the road and a
// flavor building on the left. v1 renders these as labeled placeholder
// blocks; entry/interiors come in a later piece.

export interface BuildingDef {
  name: string;
  locked?: boolean;
}

export interface FrameDef {
  index: number;
  right: BuildingDef;
  left: BuildingDef | null;
}

export const FRAME_WIDTH = 900;

export const FRAMES: FrameDef[] = [
  {
    index: 0,
    right: { name: "Apartment" },
    left: { name: "Buyable Houses", locked: true },
  },
  {
    index: 1,
    right: { name: "Office" },
    left: { name: "Mall" },
  },
  {
    index: 2,
    right: { name: "Gym" },
    left: { name: "Diner" },
  },
  {
    index: 3,
    right: { name: "Lounge" },
    left: { name: "Beach" },
  },
  {
    index: 4,
    right: { name: "Press Building" },
    left: { name: "Airport" },
  },
  {
    index: 5,
    right: { name: "Arena" },
    left: null,
  },
];

export const WORLD_WIDTH = FRAME_WIDTH * FRAMES.length;

export function frameAt(worldX: number): FrameDef {
  const idx = Math.min(
    FRAMES.length - 1,
    Math.max(0, Math.floor(worldX / FRAME_WIDTH)),
  );
  return FRAMES[idx];
}
