// The Core Loop (Section 2): every fight is preceded by a fixed camp
// cycle, always the same 9 stages regardless of opponent difficulty —
//   Training 1 -> Private Life 1 -> Training 2 -> Promotion 1 ->
//   Training 3 -> Private Life 2 -> Training 4 -> Promotion 2 -> FIGHT
// This module only tracks and advances the current stage (advanced by
// sleeping — see sleepAtBed in main.ts). It does not yet restrict which
// buildings/stations are usable per stage; that's a deliberate follow-up.
// Training's per-stage stat is informational for the same reason — Sparring
// (Chin) isn't playable yet, so Training 4 is a label only for now.

export type CampStageType = "training" | "privatelife" | "promotion" | "fight";

export interface CampStage {
  type: CampStageType;
  label: string;
  stat?: "power" | "speed" | "endurance" | "chin"; // only set for "training" stages
}

export const CAMP_SEQUENCE: CampStage[] = [
  { type: "training", label: "Training 1", stat: "power" },
  { type: "privatelife", label: "Private Life 1" },
  { type: "training", label: "Training 2", stat: "speed" },
  { type: "promotion", label: "Promotion 1" },
  { type: "training", label: "Training 3", stat: "endurance" },
  { type: "privatelife", label: "Private Life 2" },
  { type: "training", label: "Training 4", stat: "chin" },
  { type: "promotion", label: "Promotion 2" },
  { type: "fight", label: "FIGHT NIGHT" },
];

export class CampCycle {
  private index = 0;
  private camp = 1; // which fight camp / opponent cycle this is

  get current(): CampStage {
    return CAMP_SEQUENCE[this.index];
  }

  get campNumber(): number {
    return this.camp;
  }

  /** Ends the current stage and moves to the next one, looping into a new camp after FIGHT NIGHT. */
  advance(): CampStage {
    this.index += 1;
    if (this.index >= CAMP_SEQUENCE.length) {
      this.index = 0;
      this.camp += 1;
    }
    return this.current;
  }
}
