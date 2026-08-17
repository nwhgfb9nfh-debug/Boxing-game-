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

// A signed sponsorship deal (Section 5): pays out per fight for a fixed
// contract length instead of a lump sum. fightsRemaining only ticks down
// once the Fight system can report a completed bout — until then it just
// sits at the value the contract was signed for.
export interface SponsorshipContract {
  dealId: string;
  fightsRemaining: number;
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
  // Office reception (Section 5): coach/cutman levels are cumulative
  // (buying Lvl 3 keeps Lvl 1/2 unlocked). managerLevel is exclusive —
  // only one manager is on staff at a time, and hiring a different tier
  // replaces it, which is also what gates Office elevator floor access
  // (see openElevatorMenu/openManagerDeskMenu in main.ts).
  managerLevel: number;
  coachLevel: number;
  cutmanLevel: number;
  gymLevels: GymLevels;
  // Manager's Office desk (Section 5): a real fight-scheduling/purse system
  // doesn't exist yet (needs Promotion/Fight), so these are placeholders —
  // fightScheduled just gates Cash Advance and re-selecting Set Next Fight.
  fightScheduled: boolean;
  cashAdvanceTaken: boolean;
  sponsorships: SponsorshipContract[];
  // Manager Lvl 2+'s "Invest in Portfolio" — a placeholder money sink until
  // a real returns system exists.
  portfolioInvested: number;
  // Press Building Promotion-camp events (Section 6): real spec content,
  // but held to one completion each until a fight-camp cycle exists to
  // reset them. Graphics (poses, destinations) are text placeholders.
  pressConferenceDone: boolean;
  photoShootDone: boolean;
  faceOffDone: boolean;
  fanEventDone: boolean;
  selectedPose: number | null;
  fanEventDestination: string | null;
  fightPrediction: string | null;
  // Starts at 1.0x; Emotional answers at Press Conference/Face-Off add 0.1.
  // Inert until a real purse/Fight system exists to apply it.
  purseMultiplier: number;
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
    fightScheduled: false,
    cashAdvanceTaken: false,
    sponsorships: [],
    portfolioInvested: 0,
    pressConferenceDone: false,
    photoShootDone: false,
    faceOffDone: false,
    fanEventDone: false,
    selectedPose: null,
    fanEventDestination: null,
    fightPrediction: null,
    purseMultiplier: 1.0,
  };
}
