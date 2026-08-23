// Social Battery (NPC Dialogue spec, Section 3): a resource separate from
// Energy Star that only gates the "Talk" topic-menu system (20 per topic
// picked). Resets fresh to 100 on the same cadence as Energy Star — every
// camp-phase advance — but is otherwise fully independent: it doesn't
// affect (and isn't affected by) any Energy-Star-costed NPC action.
//
// Reads/writes playerState.socialBattery directly rather than keeping its
// own private field, so playerState stays the single serializable source
// of truth for all persistent game state.

import type { PlayerState } from "./playerState";

const MAX_SOCIAL_BATTERY = 100;

export class SocialBattery {
  private state: PlayerState;

  constructor(state: PlayerState) {
    this.state = state;
  }

  get remaining(): number {
    return this.state.socialBattery;
  }

  canAfford(cost: number): boolean {
    return this.state.socialBattery >= cost;
  }

  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.state.socialBattery -= cost;
    return true;
  }

  /** Dev-tool only — direct override, bypassing spend/canAfford. */
  set(value: number): void {
    this.state.socialBattery = value;
  }

  /** Called on every camp-phase advance, same cadence as Energy Star's sleep(). */
  reset(): void {
    this.state.socialBattery = MAX_SOCIAL_BATTERY;
  }
}
