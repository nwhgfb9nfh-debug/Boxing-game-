// Persistent player stats (Section 5 & 7): Fame, Image, Money, HP, and
// training bonuses. Relationship-per-NPC isn't here yet — that needs
// contacts, which come with the meetup/new-people actions in a later
// Private Life piece.

export interface TrainingStats {
  power: number; // Heavy Bag
  speed: number; // Reflex Dots
  endurance: number; // Jump Rope
  chin: number; // Sparring — stays 0 until the Fight system exists
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
}

export function createPlayerState(): PlayerState {
  return {
    fame: 0,
    image: 0,
    money: 0,
    hp: 100,
    training: { power: 0, speed: 0, endurance: 0, chin: 0 },
  };
}
