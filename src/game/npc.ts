// NPC Dialogue system (NPC Dialogue & Office Reception spec, v2): a
// reusable relationship + topic-rating engine meant for every dialogue-
// capable NPC in the game, not just Office Reception.
//
// Small Talk and Personal are the only real categories right now.
// Flirty/Playful is planned but not built, so it has no code path at all —
// once it exists it must be completely hidden (not just locked) for
// friend-only NPCs, but for now it simply doesn't exist yet.

export type RelationshipTier = "stranger" | "acquaintance" | "friend" | "close";
export type TalkCategory = "smalltalk" | "personal";
// The spec's +/0/− topic symbols.
export type TopicRating = "positive" | "neutral" | "negative";

export interface TalkTopicDef {
  id: string;
  label: string;
  // Rating per relationship tier — a topic can flip from negative to
  // positive as trust builds. Personal topics are only ever reachable at
  // Acquaintance+ (the category itself is gated), so they don't need a
  // Stranger-tier entry.
  ratingByTier: Partial<Record<RelationshipTier, TopicRating>>;
}

export interface NpcDef {
  id: string;
  name: string;
  portrait: string; // emoji placeholder, or a data:/http image URL
  romanceEligible: boolean;
  greetings: Record<RelationshipTier, string>;
  smallTalkTopics: TalkTopicDef[];
  personalTopics: TalkTopicDef[];
  // False for an NPC whose portrait/greeting exists but whose Talk content
  // hasn't been written yet — "Talk" shows a placeholder instead of the
  // category/topic menus. Defaults to true (content is written).
  dialogueWritten?: boolean;
}

// Placeholder thresholds — easy to retune once relationship pacing is tested.
const TIER_THRESHOLDS: { min: number; tier: RelationshipTier }[] = [
  { min: 0, tier: "stranger" },
  { min: 20, tier: "acquaintance" },
  { min: 50, tier: "friend" },
  { min: 90, tier: "close" },
];

export function getRelationshipTier(score: number): RelationshipTier {
  let tier: RelationshipTier = "stranger";
  for (const t of TIER_THRESHOLDS) if (score >= t.min) tier = t.tier;
  return tier;
}

const TIER_ORDER: RelationshipTier[] = ["stranger", "acquaintance", "friend", "close"];

// Personal unlocks at Acquaintance tier for every NPC (spec Section 2) — a
// fixed engine rule, not per-NPC data. Small Talk is always available from
// Stranger onward.
export function isCategoryUnlocked(category: TalkCategory, tier: RelationshipTier): boolean {
  if (category === "smalltalk") return true;
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf("acquaintance");
}

// Placeholder magnitudes for the +/0/− symbols — the spec only specifies
// the readout format ("+X Relationship"/"−X Relationship"), not the exact
// values, so these are a reasonable default, easy to retune.
const RATING_DELTA: Record<TopicRating, number> = {
  positive: 8,
  neutral: 0,
  negative: -5,
};

export function getTopicRating(topic: TalkTopicDef, tier: RelationshipTier): TopicRating {
  return topic.ratingByTier[tier] ?? "neutral";
}

export function getTopicDelta(topic: TalkTopicDef, tier: RelationshipTier): number {
  return RATING_DELTA[getTopicRating(topic, tier)];
}

// No written NPC dialogue lines per topic (per spec) — just the plain
// relationship readout.
export function formatTopicResult(delta: number): string {
  if (delta > 0) return `+${delta} Relationship`;
  if (delta < 0) return `−${Math.abs(delta)} Relationship`;
  return "No change.";
}
