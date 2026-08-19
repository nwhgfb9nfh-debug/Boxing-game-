// Buzzer (Section 5, Twitter/X-style app) — per the design spec, real replies
// need a backend holding an AI API key: moderation + generation happen
// server-side, never in client code. This build has no backend (it ships
// as a static Artifact with no server), so this module is a placeholder:
// all the real game logic (Fame tier -> reply count, Image tier -> sentiment
// mix, fixed vs. rotating vs. varying accounts) is implemented for real,
// but the reply TEXT comes from a local canned-line bank instead of a
// live AI call. Swap generateBuzzerReplies' internals for a real backend
// call when one exists — the function signature/behavior can stay the same.

export interface BuzzerReply {
  handle: string;
  text: string;
}

export interface BuzzerPostResult {
  blocked: boolean;
  blockedReason?: string;
  replies: BuzzerReply[];
}

// ---- Moderation (Section 4) --------------------------------------------
// Real moderation needs the same backend as generation. This is a minimal
// stand-in — a short list of clearly-over-the-line terms — not a real
// classifier. Ordinary profanity/slang is deliberately NOT blocked here,
// matching the spec ("ass" and similar should pass).
const MODERATION_BLOCKLIST = ["kill you", "i'll kill", "rape", "terrorist", "bomb threat"];

function passesModeration(text: string): boolean {
  const lower = text.toLowerCase();
  return !MODERATION_BLOCKLIST.some((term) => lower.includes(term));
}

// ---- Fame tier -> reply count (Section 2) ------------------------------
const FAME_TIERS: { min: number; replyCount: number }[] = [
  { min: 0, replyCount: 0 },
  { min: 10, replyCount: 1 },
  { min: 30, replyCount: 3 },
  { min: 60, replyCount: 5 },
  { min: 100, replyCount: 6 },
];

function getReplyCount(fame: number): number {
  let count = 0;
  for (const tier of FAME_TIERS) if (fame >= tier.min) count = tier.replyCount;
  return count;
}

const STAGE2_EMOJIS = ["💪", "🙏", "👍", "😍", "🤫", "😩", "😂", "🥲", "🫠", "🤥", "🔥", "💯"];

// ---- Image tier -> sentiment mix (Section 3) ---------------------------
// Sentiment scale: -3 very negative ... 0 neutral ... +3 as positive as
// authentically possible. Each tier's 3-value pattern matches the spec's
// literal 3-reply mix; for the 4 image-dependent slots at Stage 5 it cycles
// (repeats the first value) rather than inventing a new 4-value table.
const IMAGE_TIERS: { min: number; pattern: [number, number, number] }[] = [
  { min: 0, pattern: [-3, -3, -1] }, // Bad: mostly very negative + one negative-but-not-mean
  { min: 20, pattern: [0, -1, -2] }, // Slightly better: neutral, slightly negative, negative
  { min: 40, pattern: [1, 0, -1] }, // Better: slightly positive, neutral, slightly negative
  { min: 60, pattern: [0, 1, 2] }, // Even better: neutral, slightly positive, positive
  { min: 80, pattern: [3, 3, 3] }, // Great/Perfect: as positive as authentically possible
];

function getImagePattern(image: number): [number, number, number] {
  let pattern = IMAGE_TIERS[0].pattern;
  for (const tier of IMAGE_TIERS) if (image >= tier.min) pattern = tier.pattern;
  return pattern;
}

// ---- Personas (Section 2) -----------------------------------------------
type PersonaId = "blacktwitter" | "newspage" | "neutral" | "fanpage" | "hater" | "legend";

interface Persona {
  id: PersonaId;
  accountMode: "varies" | "fixed" | "rotate3";
  fixedHandle?: string;
  rotatingHandles?: [string, string, string];
  sentimentMode: "followsImage" | "alwaysPositive" | "alwaysNegative";
}

const PERSONAS: Record<PersonaId, Persona> = {
  blacktwitter: { id: "blacktwitter", accountMode: "varies", sentimentMode: "followsImage" },
  newspage: { id: "newspage", accountMode: "fixed", fixedHandle: "@RingReportDaily", sentimentMode: "followsImage" },
  neutral: { id: "neutral", accountMode: "varies", sentimentMode: "followsImage" },
  fanpage: { id: "fanpage", accountMode: "fixed", fixedHandle: "@BigDawgFanClub", sentimentMode: "alwaysPositive" },
  hater: { id: "hater", accountMode: "varies", sentimentMode: "alwaysNegative" },
  legend: {
    id: "legend",
    accountMode: "rotate3",
    rotatingHandles: ["@IronJawLegacy", "@OldSchoolChamp", "@TheRealVet"],
    sentimentMode: "followsImage",
  },
};

// Which personas are active at each reply count, in spec's addition order.
const PERSONAS_BY_COUNT: Record<number, PersonaId[]> = {
  3: ["blacktwitter", "newspage", "neutral"],
  5: ["blacktwitter", "newspage", "neutral", "fanpage", "hater"],
  6: ["blacktwitter", "newspage", "neutral", "fanpage", "hater", "legend"],
};

// ---- Handle generation for "varies" accounts -----------------------------
const HANDLE_WORDS: Record<"blacktwitter" | "neutral" | "hater" | "stage2", string[]> = {
  blacktwitter: ["yungKO", "realTalkRingside", "chiTownFightFan", "ATLboxinghead", "dmvFightNight", "boxinauntie"],
  neutral: ["dave_watches_box", "sarah_sportsfan", "just_mike_here", "kelly_ringside", "tom_from_ohio"],
  hater: ["notImpressed99", "overratedwatch", "hypemachine_no", "skepticalfan_", "sameoldstory"],
  stage2: ["fan_2481", "boxwatcher77", "ringsidekid", "just_here_lol", "casualboxingfan"],
};

function randomHandle(pool: string[]): string {
  const base = pool[Math.floor(Math.random() * pool.length)];
  return `@${base}${Math.floor(Math.random() * 900 + 100)}`;
}

function resolveHandle(persona: Persona): string {
  if (persona.accountMode === "fixed") return persona.fixedHandle!;
  if (persona.accountMode === "rotate3") {
    return persona.rotatingHandles![Math.floor(Math.random() * 3)];
  }
  const pool = persona.id === "blacktwitter" ? HANDLE_WORDS.blacktwitter
    : persona.id === "hater" ? HANDLE_WORDS.hater
    : HANDLE_WORDS.neutral;
  return randomHandle(pool);
}

// ---- Canned reply lines, bucketed by persona + sentiment bucket ---------
// Generic/topic-agnostic — the honest limitation of not having a real AI
// call: these react to "a post" in character, not to its actual content.
type SentimentBucket = "very-negative" | "negative" | "neutral" | "positive" | "very-positive";

function bucketFor(sentiment: number): SentimentBucket {
  if (sentiment <= -2) return "very-negative";
  if (sentiment === -1) return "negative";
  if (sentiment === 0) return "neutral";
  if (sentiment <= 2) return "positive";
  return "very-positive";
}

const REPLY_LINES: Record<PersonaId, Record<SentimentBucket, string[]>> = {
  blacktwitter: {
    "very-negative": ["nah this ain't it chief 💀", "grown ass man btw...", "sit down for real"],
    negative: ["eh, I seen better ngl", "not really feeling this one"],
    neutral: ["aight I see it", "cool cool, noted"],
    positive: ["ok that's actually kinda hard ngl", "respect for that one"],
    "very-positive": ["THIS IS THE MOVE 🔥🔥", "champ mentality fr, love to see it"],
  },
  newspage: {
    "very-negative": ["Questionable messaging from the challenger ahead of camp.", "This won't play well with the boxing media."],
    negative: ["A curious statement, to say the least.", "Sources close to the camp are unimpressed."],
    neutral: ["Noted for the record.", "Update from camp."],
    positive: ["A confident statement from the challenger.", "Promising signs ahead of the bout."],
    "very-positive": ["A statement that will resonate with fans everywhere.", "Championship mentality on full display."],
  },
  neutral: {
    "very-negative": ["yikes, not a fan of this one", "kinda cringe not gonna lie"],
    negative: ["eh, could've been worded better", "not really my thing"],
    neutral: ["ok, saw this", "huh, interesting I guess"],
    positive: ["that's pretty cool actually", "nice, good to see"],
    "very-positive": ["love this so much!!", "this made my day honestly"],
  },
  fanpage: {
    "very-negative": ["Still rocking with you champ! 💪", "We believe in you no matter what!"],
    negative: ["We got your back regardless!", "Keep pushing, we're behind you!"],
    neutral: ["Let's go champ! 🔥", "Proud of you as always!"],
    positive: ["LET'S GOOO! 🔥🔥", "This is why we love you champ!"],
    "very-positive": ["ABSOLUTE LEGEND IN THE MAKING 🐐🔥", "BEST IN THE WORLD, NO CAP!"],
  },
  hater: {
    "very-negative": ["mans really said that lol", "embarrassing honestly"],
    negative: ["not surprised, another L take", "here we go again..."],
    neutral: ["ok and?", "nobody asked"],
    positive: ["ok and?", "nobody asked"],
    "very-positive": ["ok and?", "nobody asked"],
  },
  legend: {
    "very-negative": ["Back in my day we let the fists do the talking, kid.", "This generation talks too much."],
    negative: ["Save it for the ring, champ.", "Words don't win fights."],
    neutral: ["Interesting take from the youngster.", "We'll see how it holds up."],
    positive: ["I like the confidence. Backing it up is the hard part.", "Reminds me of my prime, not gonna lie."],
    "very-positive": ["Now THAT'S a champion's mentality.", "Respect. The old guard approves."],
  },
};

function pickLine(personaId: PersonaId, sentiment: number): string {
  const lines = REPLY_LINES[personaId][bucketFor(sentiment)];
  return lines[Math.floor(Math.random() * lines.length)];
}

// ---- Main entry point -----------------------------------------------------
export function generateBuzzerReplies(fame: number, image: number, postText: string): BuzzerPostResult {
  if (!passesModeration(postText)) {
    return { blocked: true, blockedReason: "That one didn't make it past your PR team.", replies: [] };
  }

  const replyCount = getReplyCount(fame);
  if (replyCount === 0) return { blocked: false, replies: [] };

  if (replyCount === 1) {
    const emoji = STAGE2_EMOJIS[Math.floor(Math.random() * STAGE2_EMOJIS.length)];
    return { blocked: false, replies: [{ handle: randomHandle(HANDLE_WORDS.stage2), text: emoji }] };
  }

  const pattern = getImagePattern(image);
  let imageDependentIndex = 0;
  const replies = PERSONAS_BY_COUNT[replyCount].map((id) => {
    const persona = PERSONAS[id];
    let sentiment: number;
    if (persona.sentimentMode === "alwaysPositive") sentiment = 3;
    else if (persona.sentimentMode === "alwaysNegative") sentiment = -3;
    else {
      sentiment = pattern[imageDependentIndex % pattern.length];
      imageDependentIndex += 1;
    }
    return { handle: resolveHandle(persona), text: pickLine(id, sentiment) };
  });

  return { blocked: false, replies };
}
