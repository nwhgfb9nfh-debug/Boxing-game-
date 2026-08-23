// The Energy Star system (Section 3): every pre-fight stage gets a fresh
// 100. Actions spend it; sleeping ends the stage and banks whatever's
// left as HP buffer. The full training-camp cycle (which stage comes
// next) isn't wired up yet — for now, sleeping just refills to 100 so
// the resource loop itself is testable on its own.
//
// Reads/writes playerState.energyRemaining/energyCap directly rather than
// keeping its own private fields, so playerState stays the single
// serializable source of truth for all persistent game state.

import type { PlayerState } from "./playerState";

export const MAX_ENERGY = 100;

export class EnergyStar {
  private state: PlayerState;

  constructor(state: PlayerState) {
    this.state = state;
  }

  get remaining(): number {
    return this.state.energyRemaining;
  }

  /** The refill amount the last sleep() used (e.g. 110 with the Airport vacation bonus). */
  get maxValue(): number {
    return this.state.energyCap;
  }

  canAfford(cost: number): boolean {
    return this.state.energyRemaining >= cost;
  }

  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.state.energyRemaining -= cost;
    return true;
  }

  /** Ends the stage: returns the leftover amount to bank as HP buffer, then refills to cap. */
  sleep(cap: number = MAX_ENERGY): number {
    const leftover = this.state.energyRemaining;
    this.state.energyCap = cap;
    this.state.energyRemaining = cap;
    return leftover;
  }
}
