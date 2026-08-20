// NPC Dialogue system (NPC Dialogue & Office Reception spec): a reusable
// relationship + topic-reaction engine meant for every dialogue-capable NPC
// in the game, not just Office Reception. The same shapes/helpers here are
// meant to be reused as-is when Diner/Beach/Lounge/Mall meetups come online.

export type RelationshipTier = "stranger" | "acquaintance" | "friend" | "close";
export type TalkTopic = "genuine" | "flirty" | "cocky" | "smalltalk";
export type TopicReaction = "positive" | "neutral" | "negative";

export interface NpcDef {
  id: string;
  name: string;
  portrait: string; // emoji placeholder — no real art pipeline yet
  romanceEligible: boolean;
  greetings: Record<RelationshipTier, string>;
  topicReactions: Record<TalkTopic, TopicReaction>;
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

// Placeholder deltas for how much a Talk pick moves the relationship score.
// Not specified in the spec — a reasonable default, easy to retune.
export const REACTION_DELTA: Record<TopicReaction, number> = {
  positive: 8,
  neutral: 2,
  negative: -5,
};

export const TALK_TOPICS: { id: TalkTopic; label: string }[] = [
  { id: "genuine", label: "Genuine / Respectful" },
  { id: "flirty", label: "Playful / Flirty" },
  { id: "cocky", label: "Cocky / Confident" },
  { id: "smalltalk", label: "Small Talk" },
];

// One small reusable line pool per topic+reaction — shared by every NPC,
// never unique per NPC (per spec). Kept gender-neutral in phrasing.
const RESPONSE_LINES: Record<TalkTopic, Record<TopicReaction, string[]>> = {
  genuine: {
    positive: ["That lands. \"I appreciate you saying that.\"", "A genuine nod. \"Yeah — thank you.\""],
    neutral: ["\"Sure, I hear you.\"", "A polite nod, nothing more."],
    negative: ["\"...Right.\" A flicker of skepticism.", "Doesn't quite land. \"If you say so.\""],
  },
  flirty: {
    positive: ["A small smile creeps in. \"Careful, that almost worked.\"", "\"Okay, that was smooth.\""],
    neutral: ["An amused eye-roll. \"Nice try.\"", "\"Mm-hm. Sure.\""],
    negative: ["A flat look. \"Not the time.\"", "\"...Moving on.\""],
  },
  cocky: {
    positive: ["\"Ha! I like the confidence.\"", "A grin. \"Okay, big talk. Let's see it.\""],
    neutral: ["\"Sure, champ.\" Unbothered.", "A shrug. \"If you say so.\""],
    negative: ["An unimpressed stare. \"Wow. Okay.\"", "\"...That's a lot.\" Not a compliment."],
  },
  smalltalk: {
    positive: ["Easy conversation. \"Yeah, exactly.\"", "A relaxed nod. \"Same, honestly.\""],
    neutral: ["\"Yeah, I guess.\" Polite, brief.", "A small nod, nothing more."],
    negative: ["Distracted, barely listening.", "\"Mm.\" Already looking elsewhere."],
  },
};

export function pickResponseLine(topic: TalkTopic, reaction: TopicReaction): string {
  const pool = RESPONSE_LINES[topic][reaction];
  return pool[Math.floor(Math.random() * pool.length)];
}
