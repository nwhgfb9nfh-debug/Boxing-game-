// Fight System — opponent roster (Stage 1). No real BCA ranking/roster
// system exists yet (the Phone's BCA tab is still a placeholder — see
// phoneUI.ts), so this is a small fixed ladder: one opponent per tier,
// picked by the camp number the fight falls in. Placeholder names/stats,
// same "mechanics before art" convention as everything else in this
// project — easy to expand into a real roster later without touching the
// Fight scene itself, which only ever consumes the Opponent shape below.

export type OpponentTier = "journeyman" | "prospect" | "contender" | "ranked" | "champion";

// Swipe directions for the memory-combo system (Punch-Out-style ↑↓←→).
export type Direction = "up" | "down" | "left" | "right";

export interface Opponent {
  id: string;
  name: string;
  tier: OpponentTier;
  icon: string; // placeholder portrait — an emoji, no real art yet
  rounds: number; // Journeyman 4 / Prospect 6 / Contender 8 / Ranked 10 / Champion 12
  hp: number; // this opponent's health pool for the fight
  power: number; // base damage on a fully-unblocked hit against the player, before Chin reduction
  recovery: number; // HP regenerated between rounds
  purse: number; // base purse for going the distance with (or beating) this opponent
  // Fight System — Power Punch bonus: flat damage on a green-zone hit,
  // opponent-defined rather than derived from the player's Power stat
  // (same "roster decides it" pattern as `power` above). Placeholder —
  // roughly 20% of the opponent's own hp for now, real numbers come once
  // the full roster is scripted.
  powerPunchDamage: number;
  // 2-3 fixed combos, drawn from randomly on the player's Defense turns —
  // learnable per opponent rather than fully random, per spec.
  signatureCombos: Direction[][];
}

const TIER_ROUNDS: Record<OpponentTier, number> = {
  journeyman: 4,
  prospect: 6,
  contender: 8,
  ranked: 10,
  champion: 12,
};

export const OPPONENT_ROSTER: Opponent[] = [
  {
    id: "duke-marino",
    name: "Duke Marino",
    tier: "journeyman",
    icon: "🥊",
    rounds: TIER_ROUNDS.journeyman,
    hp: 70,
    power: 10,
    recovery: 6,
    purse: 5000,
    powerPunchDamage: 14,
    signatureCombos: [
      ["left", "right"],
      ["up", "left", "right"],
      ["down", "down", "up"],
    ],
  },
  {
    id: "ricky-suarez",
    name: "Ricky Suarez",
    tier: "prospect",
    icon: "🥷",
    rounds: TIER_ROUNDS.prospect,
    hp: 90,
    power: 14,
    recovery: 7,
    purse: 12000,
    powerPunchDamage: 18,
    signatureCombos: [
      ["left", "left", "right"],
      ["up", "down", "left"],
      ["right", "up", "right", "down"],
    ],
  },
  {
    id: "big-tommy-okafor",
    name: "Big Tommy Okafor",
    tier: "contender",
    icon: "😤",
    rounds: TIER_ROUNDS.contender,
    hp: 110,
    power: 18,
    recovery: 8,
    purse: 25000,
    powerPunchDamage: 22,
    signatureCombos: [
      ["down", "up", "left", "right"],
      ["right", "right", "up"],
      ["left", "down", "right", "up"],
    ],
  },
  {
    id: "viktor-kalashnik",
    name: "Viktor Kalashnik",
    tier: "ranked",
    icon: "🧊",
    rounds: TIER_ROUNDS.ranked,
    hp: 130,
    power: 22,
    recovery: 9,
    purse: 50000,
    powerPunchDamage: 26,
    signatureCombos: [
      ["up", "left", "down", "right"],
      ["right", "left", "right", "up"],
      ["down", "down", "left", "up"],
    ],
  },
  {
    id: "the-mongoose-jefferson",
    name: '"The Mongoose" Jefferson',
    tier: "champion",
    icon: "👑",
    rounds: TIER_ROUNDS.champion,
    hp: 150,
    power: 28,
    recovery: 10,
    purse: 100000,
    powerPunchDamage: 30,
    signatureCombos: [
      ["left", "up", "right", "down"],
      ["right", "right", "left", "up"],
      ["down", "left", "down", "right", "up"],
    ],
  },
];

/** Picks the fixed-ladder opponent for the given camp — camp 1 is the Journeyman, camp 5+ stays on the Champion. */
export function getOpponentForCamp(campNumber: number): Opponent {
  const index = Math.min(Math.max(campNumber - 1, 0), OPPONENT_ROSTER.length - 1);
  return OPPONENT_ROSTER[index];
}
