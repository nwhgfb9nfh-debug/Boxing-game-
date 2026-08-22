// NPC Dialogue system (NPC Dialogue & Office Reception spec, v4): a
// reusable relationship + topic-rating engine meant for every dialogue-
// capable NPC in the game, not just Office Reception.
//
// Four Talk categories exist: Small Talk (T1+), Personal (T2+), Heart to
// Heart (T3+, every NPC regardless of romance status), and Flirty (T3+,
// romance-eligible NPCs only — Compliment/Charm sub-categories). A
// friend-only NPC simply never has the Flirty category appear at all,
// rather than showing it locked.
//
// "Actions" is a separate top-level menu (Exchange Number, Give a Gift,
// Ask Her Out) — Energy-Star-costed relationship progression, not
// conversation, and always visible from Tier 1 (the outcome varies by
// NPC/tier, not the menu's presence).
//
// The Romance System (v4, new): "romance-eligible" does NOT mean "always
// in a romance." Every romance-eligible NPC tracks TWO independent
// values: the Relationship bar (the tier system below, built through any
// category) and a separate Romance meter (built only from positive Flirty
// topic picks in-person and flirty text messages via Phone). Reaching
// Tier 3 alone does not grant romantic access — Ask Her Out only succeeds
// once the Romance meter clears a per-NPC threshold, and success sets a
// permanent `Dating` flag (playerState.dating) that unlocks "Date" as a
// Meetup type going forward.

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
  // Marriage System: routes this pick to the bespoke family/kids reveal
  // (see formatFamilyReveal) instead of the generic rating delta above —
  // purely informational, no Relationship/Romance change either way, and
  // repeatable any time it's unlocked.
  special?: "family-reveal";
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

export interface AskHerOutResult {
  success: boolean;
  message: string;
}

export interface ProposeResult {
  success: boolean;
  message: string;
}

// Exchange Number/Give a Gift/Ask Her Out/Propose outcomes are bespoke per
// NPC (success conditions, reaction flavor), not a generic ratings table
// like Talk topics — each written NPC supplies her own rules.
export interface NpcActionRules {
  exchangeNumber: (tier: RelationshipTier, score: number) => ExchangeNumberResult;
  giftReaction: (tier: RelationshipTier) => GiftResult;
  // Only ever called for romance-eligible NPCs. romanceScore is the
  // player's current Romance meter value with her.
  askHerOut: (romanceScore: number) => AskHerOutResult;
  // Marriage System: only ever called for romance-eligible NPCs who are
  // already Dating. No penalty on failure ("Too soon") — the ring isn't
  // consumed unless she says yes.
  propose: (relationshipScore: number, romanceScore: number, dateCount: number) => ProposeResult;
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
  // Home-as-Date unlock (Meetup System spec) — per-NPC, e.g. a minimum
  // number of successful Dates elsewhere plus a relationship tier.
  // Omitted means Home isn't designed as a Date location for her yet.
  homeDateUnlock?: (dateCount: number, tier: RelationshipTier) => boolean;
  // Home-as-Regular-Meetup has its own separate, simpler unlock — omitted
  // means not yet designed (shown the same placeholder as Beach/Lounge).
  homeRegularUnlock?: (dateCount: number, tier: RelationshipTier) => boolean;
  // Marriage System: how many kids (if any) she already has, and how many
  // she wants total — this is the number the player will actually get once
  // married to her. Romance-eligible NPCs only; revealed via the Personal
  // → Family topic (special: "family-reveal") once relationship clears
  // revealTier, and stays fixed regardless of what the player later says.
  familyInfo?: {
    kidsHas: number;
    kidsWants: number;
    revealTier: RelationshipTier;
  };
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

// Positive Flirty picks (Compliment/Charm) also build the Romance meter,
// separately from the Relationship delta above — placeholder magnitude,
// only ever applied for positive ratings (spec: "builds from positive
// Flirty topic selections").
export const FLIRTY_ROMANCE_DELTA = 6;

// No written NPC dialogue lines per topic (per spec) — just the plain
// relationship readout.
export function formatTopicResult(delta: number): string {
  if (delta > 0) return `+${delta} Relationship`;
  if (delta < 0) return `−${Math.abs(delta)} Relationship`;
  return "No change.";
}

export function formatRomanceResult(delta: number): string {
  if (delta > 0) return `+${delta} Romance`;
  if (delta < 0) return `−${Math.abs(delta)} Romance`;
  return "No change.";
}

// Marriage System: the Personal → Family topic's special reveal (see
// TalkTopicDef.special) — below revealTier she deflects, at/above it she
// tells the player exactly how many kids she wants (the number they'll
// get once married to her).
export function formatFamilyReveal(info: NonNullable<NpcDef["familyInfo"]>, tier: RelationshipTier): string {
  if (!tierAtLeast(tier, info.revealTier)) {
    return 'She waves it off. "Let\'s not get into that — not yet, anyway."';
  }
  const hasText = info.kidsHas === 0 ? "no kids yet" : `${info.kidsHas} kid${info.kidsHas === 1 ? "" : "s"} already`;
  const wantsText = `wants ${info.kidsWants} kid${info.kidsWants === 1 ? "" : "s"} total, someday`;
  return `She opens up a little: ${hasText}, and ${wantsText}.`;
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
// no categories/tiers. The set is assigned by NPC TYPE (romance-eligible
// vs. friend-only), NOT by Dating status — a romance-eligible NPC gets
// the Romance set from the moment texting unlocks, since flirty texting
// is itself one of the ways the Romance meter builds up.
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
  { id: "day", label: "Ask How Their Day's Going" },
  { id: "selfie", label: "Send a Selfie" },
  { id: "flirty", label: "Flirty Text" },
];

// Flat, reusable bump — spec doesn't specify a value ("low-content-cost
// system, not authored per-NPC"), so this is a placeholder default.
export const TEXT_TALK_DELTA = 3;
// "Flirty Text" additionally builds the Romance meter — placeholder value.
export const TEXT_TALK_ROMANCE_DELTA = 3;

// Meetup System (NPC Dialogue system spec v4): reached from a Contact's
// "Initiate Meetup". Each location defines ONE shared option set used
// identically by every NPC met there (unlike in-person Talk, which is
// authored per-NPC).
//
// Meetups split into two formal types, chosen when arranging by Phone:
// Regular Meetup (always available, purely platonic, regularGeneral
// options) and Date (only selectable once Dating is true, dateConnect
// options — a boldness/intimacy scale, location-themed). Give a Gift is
// always a separate action from the 4-option list, boosting Relationship
// on a Regular Meetup or Romance on a Date.
//
// The spec describes this as "player drives there" — this build doesn't
// simulate an actual drive from the Phone (a much bigger scene-transition
// feature); arranging pays the Energy cost and she then physically waits
// at that location's building until the player visits and the visit is
// resolved there in person.
export type MeetupLocationId = "home" | "diner" | "beach" | "lounge";
export type MeetupType = "regular" | "date";

export interface MeetupOptionDef {
  id: string;
  label: string;
  // Overnight Stay triggers a full phase advance instead of a flat
  // Romance bump — flagged so the caller can branch on it. Home's Date
  // scale only.
  special?: "overnight-stay";
}

export interface MeetupLocationDef {
  id: MeetupLocationId;
  label: string;
  // Empty arrays mean this location isn't designed yet (Beach/Lounge) —
  // shows the same "not yet designed" placeholder Carol used before her
  // Talk content existed.
  regularGeneral: MeetupOptionDef[];
  dateConnect: MeetupOptionDef[];
}

export const MEETUP_ENERGY_COST = 40;
// Flat, reusable bump for a picked Connect option — the spec doesn't give
// per-option ratings the way Talk topics have, so this is a placeholder
// default, easy to retune. Regular Meetup boosts Relationship; Date boosts
// Romance (except Overnight Stay, which resolves separately).
export const MEETUP_CONNECT_DELTA = 10;
// "A liked gift gives a noticeably stronger boost than a Talk topic would"
// (spec) — Talk's max positive is 8, so this placeholder sits above that.
export const MEETUP_GIFT_DELTA = 12;
// Penalty for ending a visit without ever using Connect — placeholder,
// applied to Relationship always, and additionally to Romance on a Date.
export const MEETUP_NO_CONNECT_PENALTY = -8;

export const MEETUP_LOCATIONS: MeetupLocationDef[] = [
  {
    id: "home",
    label: "Home",
    regularGeneral: [
      { id: "movie", label: "Watch a Movie" },
      { id: "meal", label: "Share a Meal" },
      { id: "deep-conversation", label: "Deep Conversation" },
      { id: "relax", label: "Just Relax Together" },
    ],
    dateConnect: [
      { id: "cuddle", label: "Cuddle Up" },
      { id: "set-mood", label: "Set the Mood" },
      { id: "share-deep", label: "Share Something Deep" },
      { id: "overnight", label: "Overnight Stay", special: "overnight-stay" },
    ],
  },
  {
    id: "diner",
    label: "Diner",
    regularGeneral: [
      { id: "drink", label: "Order a Drink" },
      { id: "catchup", label: "Catch Up" },
      { id: "talk-boxing", label: "Talk Boxing" },
      { id: "people-watch", label: "People Watch" },
    ],
    dateConnect: [
      { id: "toast", label: "Toast to the Evening" },
      { id: "compliment", label: "Compliment" },
      { id: "dessert", label: "Share a Dessert" },
      { id: "hold-hand", label: "Hold Hand" },
    ],
  },
  {
    id: "beach",
    label: "Beach",
    // Regular Meetup not yet designed per spec.
    regularGeneral: [],
    dateConnect: [
      { id: "sunset", label: "Watch the Sunset Together" },
      { id: "compliment", label: "Compliment Her" },
      { id: "deep-talk", label: "Deep Talk" },
      { id: "hold-hand", label: "Hold Hand" },
    ],
  },
  // Not yet designed per spec.
  { id: "lounge", label: "Lounge", regularGeneral: [], dateConnect: [] },
];

export function getMeetupLocation(id: MeetupLocationId): MeetupLocationDef {
  return MEETUP_LOCATIONS.find((l) => l.id === id)!;
}
