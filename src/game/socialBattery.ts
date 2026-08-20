// Social Battery (NPC Dialogue spec, Section 3): a resource separate from
// Energy Star that only gates the "Talk" topic-menu system (20 per topic
// picked). Resets fresh to 100 on the same cadence as Energy Star — every
// camp-phase advance — but is otherwise fully independent: it doesn't
// affect (and isn't affected by) any Energy-Star-costed NPC action.

const MAX_SOCIAL_BATTERY = 100;

export class SocialBattery {
  private value = MAX_SOCIAL_BATTERY;

  get remaining(): number {
    return this.value;
  }

  canAfford(cost: number): boolean {
    return this.value >= cost;
  }

  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.value -= cost;
    return true;
  }

  /** Called on every camp-phase advance, same cadence as Energy Star's sleep(). */
  reset(): void {
    this.value = MAX_SOCIAL_BATTERY;
  }
}
