// The Core Loop (Section 2): every fight is preceded by a fixed camp
// cycle, always the same stages regardless of opponent difficulty —
//   No Fight Scheduled -> Training 1 -> Private Life 1 -> Training 2 ->
//   Promotion 1 -> Training 3 -> Private Life 2 -> Training 4 ->
//   Promotion 2 -> FIGHT
// "No Fight Scheduled" only ends once a fight is booked at the Manager
// Desk (see openManagerDeskMenu in main.ts) — sleeping before that just
// refills Energy/HP without advancing (see sleepAtBed). Every other stage
// advances on sleep as normal, looping into a new camp (and back to "No
// Fight Scheduled") after FIGHT NIGHT.

export type CampStageType = "nofight" | "training" | "privatelife" | "promotion" | "fight";

export interface CampStage {
  type: CampStageType;
  label: string;
  stat?: "power" | "speed" | "endurance" | "chin"; // only set for "training" stages
}

export const CAMP_SEQUENCE: CampStage[] = [
  { type: "nofight", label: "No Fight Scheduled" },
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

  get currentIndex(): number {
    return this.index;
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

  /** Debug-only: jump straight to any stage by index, skipping the stages between. Doesn't touch campNumber. */
  jumpTo(index: number): CampStage {
    this.index = Math.max(0, Math.min(CAMP_SEQUENCE.length - 1, index));
    return this.current;
  }
}
