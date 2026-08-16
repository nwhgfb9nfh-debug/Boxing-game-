// Persistent player stats (Section 5 & 7): Fame, Image, Money, HP, and
// training bonuses. Relationship-per-NPC isn't here yet — that needs
// contacts, which come with the meetup/new-people actions in a later
// Private Life piece.

// "trained" tracks whether a session was ever completed for this stat,
// independent of the bonus it earned — a session that scored all
// misses is still trained (bonus 0), which is different from never
// having attempted it at all ("Not trained yet").
export interface StatProgress {
  bonus: number;
  trained: boolean;
}

export interface TrainingStats {
  power: StatProgress; // Heavy Bag
  speed: StatProgress; // Reflex Dots
  endurance: StatProgress; // Jump Rope
  chin: StatProgress; // Sparring — stays untrained until the Fight system exists
}

// Gym upgrade tiers, bought at Reception (Section 5) — each section starts
// at Lvl 1 (the current gym) and can be upgraded to 2 or 3 for money.
// weightArea covers the Workout Clip content; power/speed/endurance mirror
// the three Training minigame stats.
export interface GymLevels {
  weightArea: number;
  power: number;
  speed: number;
  endurance: number;
}

export interface PlayerState {
  fame: number;
  image: number;
  money: number;
  // Starts at 100. Sleeping banks half of whatever Energy Star is left
  // into HP, so it can climb above 100 as pure fight-day insurance.
  // Training injuries / life-choice risk events (not implemented yet)
  // will be able to drop it below 100. Resets to 100 when a fight
  // starts (not implemented yet — no fight system).
  hp: number;
  training: TrainingStats;
  // Office reception (Section 5): staff levels all start at 1 (already on
  // staff), rising to 2 or 3 as higher tiers are hired for money.
  // managerLevel also gates which Office elevator floors are reachable.
  managerLevel: number;
  coachLevel: number;
  cutmanLevel: number;
  gymLevels: GymLevels;
}

function freshStat(): StatProgress {
  return { bonus: 0, trained: false };
}

export function createPlayerState(): PlayerState {
  return {
    fame: 0,
    image: 0,
    money: 0,
    hp: 100,
    training: { power: freshStat(), speed: freshStat(), endurance: freshStat(), chin: freshStat() },
    managerLevel: 1,
    coachLevel: 1,
    cutmanLevel: 1,
    gymLevels: { weightArea: 1, power: 1, speed: 1, endurance: 1 },
  };
}
