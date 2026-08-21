// NPC Dialogue system (NPC Dialogue & Office Reception spec, v3): a
// reusable relationship + topic-rating engine meant for every dialogue-
// capable NPC in the game, not just Office Reception.
//
// Four Talk categories exist: Small Talk (T1+), Personal (T2+), Heart to
// Heart (T3+, every NPC regardless of romance status), and Flirty (T3+,
// romance-eligible NPCs only — Compliment/Charm sub-categories). A
// friend-only NPC simply never has the Flirty category appear at all,
// rather than showing it locked.
//
// "Actions" is a separate top-level menu (Exchange Number, Give a Gift) —
// Energy-Star-costed relationship progression, not conversation, and
// always visible from Tier 1 (the outcome varies by NPC/tier, not the
// menu's presence).

export type RelationshipTier = "stranger" | "acquaintance" | "friend" | "close";
export type TalkCategory = "smalltalk" | "personal" | "hearttoheart" | "flirty";
export type FlirtySubcategory = "compliment" | "charm";
// The spec's +/0/− topic symbols.
export type TopicRating = "positive" | "neutral" | "negative";

export interface TalkTopicDef {
  id: string;
  label: string;
  // Rating per relationship tier — a topic can flip from negative to
  // positive as trust builds. Topics only reachable from a later tier
  // (Personal from T2, Heart to Heart/Flirty from T3) don't need earlier
  // entries.
  ratingByTier: Partial<Record<RelationshipTier, TopicRating>>;
}

export interface ExchangeNumberResult {
  success: boolean;
  delta: number;
  message: string;
}

export interface GiftResult {
  delta: number;
  message: string;
}

// Exchange Number/Give a Gift outcomes are bespoke per NPC (success
// conditions, reaction flavor), not a generic ratings table like Talk
// topics — each written NPC supplies her own rules.
export interface NpcActionRules {
  exchangeNumber: (tier: RelationshipTier, score: number) => ExchangeNumberResult;
  giftReaction: (tier: RelationshipTier) => GiftResult;
}

export interface NpcDef {
  id: string;
  name: string;
  portrait: string; // emoji placeholder, or a data:/http image URL
  romanceEligible: boolean;
  greetings: Record<RelationshipTier, string>;
  smallTalkTopics: TalkTopicDef[];
  personalTopics: TalkTopicDef[];
  heartToHeartTopics: TalkTopicDef[];
  flirtyComplimentTopics: TalkTopicDef[];
  flirtyCharmTopics: TalkTopicDef[];
  // Required whenever dialogueWritten isn't false — see below.
  actions?: NpcActionRules;
  // False for an NPC whose portrait/greeting exists but whose Talk/Actions
  // content hasn't been written yet — both show a placeholder instead of
  // the real menus. Defaults to true (content is written).
  dialogueWritten?: boolean;
  // Home meetup unlock condition (Meetup System spec) — per-NPC, not a
  // tier threshold alone. Omitted entirely means Home isn't designed for
  // her yet (shown the same "not yet designed" placeholder as Beach/Lounge).
  homeMeetupUnlock?: (meetupCount: number, tier: RelationshipTier) => boolean;
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
function tierAtLeast(tier: RelationshipTier, min: RelationshipTier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);
}

// Personal unlocks at Acquaintance (T2), Heart to Heart at Friend (T3) for
// every NPC, Flirty at Friend (T3) but romance-eligible NPCs only — fixed
// engine rules, not per-NPC data, per spec Section 2.
export function isCategoryUnlocked(category: TalkCategory, tier: RelationshipTier, romanceEligible: boolean): boolean {
  if (category === "smalltalk") return true;
  if (category === "personal") return tierAtLeast(tier, "acquaintance");
  if (category === "hearttoheart") return tierAtLeast(tier, "friend");
  return romanceEligible && tierAtLeast(tier, "friend");
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

const TIER_LABELS: Record<RelationshipTier, string> = {
  stranger: "Stranger",
  acquaintance: "Acquaintance",
  friend: "Friend",
  close: "Close",
};

export function tierLabel(tier: RelationshipTier): string {
  return TIER_LABELS[tier];
}

// Contacts app "Text" → "Talk" (NPC Dialogue system spec, Contacts App &
// Text-Talk section): a much simpler, flat system than in-person Talk —
// no categories/tiers, the same 4 fixed options for every NPC, varying
// only by whether that NPC is currently romanced (Close tier +
// romance-eligible — no separate romance-progression system exists yet,
// so tier stands in for it).
export interface TextTalkOption {
  id: string;
  label: string;
}

export const TEXT_TALK_NOT_ROMANCED: TextTalkOption[] = [
  { id: "say-hi", label: "Say Hi" },
  { id: "how-doing", label: "Ask How They're Doing" },
  { id: "funny", label: "Share Something Funny" },
  { id: "advice", label: "Ask for Advice" },
];

export const TEXT_TALK_ROMANCED: TextTalkOption[] = [
  { id: "morning", label: "Good Morning Text" },
  { id: "flirty", label: "Flirty Text" },
  { id: "day", label: "Ask How Their Day's Going" },
  { id: "selfie", label: "Send a Selfie" },
];

// Flat, reusable bump — spec doesn't specify a value ("low-content-cost
// system, not authored per-NPC"), so this is a placeholder default.
export const TEXT_TALK_DELTA = 3;

export function isRomanced(npc: NpcDef, tier: RelationshipTier): boolean {
  return npc.romanceEligible && tier === "close";
}

// Meetup System (NPC Dialogue system spec): reached from a Contact's
// "Initiate Meetup". Each location defines ONE shared option set used
// identically by every NPC met there (unlike in-person Talk, which is
// authored per-NPC) — General is available to everyone, Romance is an
// addition only ever shown for romance-eligible NPCs.
//
// The spec describes this as "player drives there" — this build doesn't
// simulate an actual drive from the Phone (a much bigger scene-transition
// feature), so a meetup plays out entirely inside the Phone UI: paying the
// Energy cost and picking an option stand in for the trip and the visit.
export type MeetupLocationId = "home" | "diner" | "beach" | "lounge";

export interface MeetupOptionDef {
  id: string;
  label: string;
  // Overnight Stay triggers a full phase advance instead of a flat
  // relationship bump — flagged so the caller can branch on it.
  special?: "overnight-stay";
  // Only selectable if the player currently owns a gift (Gift Shop).
  requiresGift?: boolean;
}

export interface MeetupLocationDef {
  id: MeetupLocationId;
  label: string;
  // Empty arrays mean this location isn't designed yet (Beach/Lounge) —
  // shows the same "not yet designed" placeholder Carol used before her
  // Talk content existed.
  general: MeetupOptionDef[];
  romance: MeetupOptionDef[];
}

export const MEETUP_ENERGY_COST = 40;
// Flat, reusable bump for a picked meetup option — the spec doesn't give
// per-option ratings the way Talk topics have, so this is a placeholder
// default, easy to retune.
export const MEETUP_OPTION_DELTA = 10;

export const MEETUP_LOCATIONS: MeetupLocationDef[] = [
  {
    id: "home",
    label: "Home",
    general: [
      { id: "movie", label: "Watch a Movie" },
      { id: "meal", label: "Share a Meal" },
      { id: "deep-conversation", label: "Deep Conversation" },
      { id: "relax", label: "Just Relax Together" },
    ],
    romance: [
      { id: "cuddle", label: "Cuddle Up" },
      { id: "set-mood", label: "Set the Mood" },
      { id: "share-deep", label: "Share Something Deep" },
      { id: "overnight", label: "Overnight Stay", special: "overnight-stay" },
    ],
  },
  {
    id: "diner",
    label: "Diner",
    general: [
      { id: "meal", label: "Share a Meal" },
      { id: "drink", label: "Order a Drink" },
      { id: "catchup", label: "Catch Up" },
      { id: "dessert", label: "Order Dessert" },
    ],
    romance: [
      { id: "laugh", label: "Make Her Laugh" },
      { id: "deep-talk", label: "Deep Talk" },
      { id: "compliment", label: "Compliment" },
      { id: "gift", label: "Gift", requiresGift: true },
    ],
  },
  // Not yet designed per spec.
  { id: "beach", label: "Beach", general: [], romance: [] },
  { id: "lounge", label: "Lounge", general: [], romance: [] },
];

export function getMeetupLocation(id: MeetupLocationId): MeetupLocationDef {
  return MEETUP_LOCATIONS.find((l) => l.id === id)!;
}
