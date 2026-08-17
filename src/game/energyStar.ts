// The Energy Star system (Section 3): every pre-fight stage gets a fresh
// 100. Actions spend it; sleeping ends the stage and banks whatever's
// left as HP buffer. The full training-camp cycle (which stage comes
// next) isn't wired up yet — for now, sleeping just refills to 100 so
// the resource loop itself is testable on its own.

export const MAX_ENERGY = 100;

export class EnergyStar {
  private value = MAX_ENERGY;
  private cap = MAX_ENERGY;

  get remaining(): number {
    return this.value;
  }

  /** The refill amount the last sleep() used (e.g. 110 with the Airport vacation bonus). */
  get maxValue(): number {
    return this.cap;
  }

  canAfford(cost: number): boolean {
    return this.value >= cost;
  }

  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.value -= cost;
    return true;
  }

  /** Ends the stage: returns the leftover amount to bank as HP buffer, then refills to cap. */
  sleep(cap: number = MAX_ENERGY): number {
    const leftover = this.value;
    this.cap = cap;
    this.value = cap;
    return leftover;
  }
}
