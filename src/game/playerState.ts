// Persistent player stats (Section 5 & 7): Fame, Image, Money, HP,
// training bonuses, and per-NPC relationship scores.

import type { BuzzerPostResult } from "./buzzer";
import type { MeetupLocationId, MeetupType } from "./npc";

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

// A tweet actually sent (Buzzer, Section 5): kept for the phone's feed —
// only the last 10 (newest first), oldest dropped as new ones come in.
// Blocked posts never make it here; only real ones.
export interface BuzzerPostRecord {
  text: string;
  result: BuzzerPostResult;
}
const BUZZER_HISTORY_LIMIT = 10;

// A photo (Imagestar, Section 5): "photoshoot" comes from Press Building's
// Photo Shoot event; "selfie" will come from NPC dialogue once that system
// exists. Taken photos sit in availablePhotos until the player actually
// posts them (their own deliberate action, same as Buzzer's compose+post),
// at which point they move to imagestarPosts — the full, uncapped career feed.
export interface Photo {
  id: string;
  caption: string;
  source: "photoshoot" | "selfie";
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
  // NPC Dialogue Actions: "Invite to Next Fight" — once per scheduled
  // fight per NPC, keyed by NPC id. Cleared alongside fightScheduled/
  // cashAdvanceTaken whenever a fresh camp starts back at "No Fight
  // Scheduled" (see sleepAtBed/resolveOvernightStay).
  fightInvites: Record<string, boolean>;
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
  // Airport "Go on Vacation" (Section 5): only biddable right after a
  // fight. No Fight system exists yet to ever set this true, so the
  // station stays locked until then — see openVacationMenu in main.ts.
  justFinishedFight: boolean;
  // Set by vacation to 2 (one per Private Life stage in the camp it was
  // booked for). Each sleepAtBed() call that lands on a Private Life stage
  // consumes one use and refills Energy Star to 110 instead of 100.
  vacationEnergyBonusUses: number;
  // Mall (Section 5): mostly cosmetic, money-only purchases. Vehicle/Pet
  // are one-time owned collectibles; gifts are bought here but given away
  // once the NPC/romance system exists to receive them.
  vehicleOwned: string | null;
  petOwned: string | null;
  // Mall Gift Shop inventory (Section 5 + Marriage System), keyed by gift
  // id ("flowers"/"jewelry"/"ring") — Give a Gift lists whichever of these
  // are owned; giving the Engagement Ring asks to Propose instead of
  // handing it straight over.
  giftInventory: Record<string, number>;
  // Phone app feeds (Section 5).
  buzzerHistory: BuzzerPostRecord[]; // newest first, capped at BUZZER_HISTORY_LIMIT
  availablePhotos: Photo[]; // taken but not yet posted to Imagestar
  imagestarPosts: Photo[]; // posted — the full career feed, uncapped
  // NPC relationship scores (NPC Dialogue spec), keyed by NPC id. Tier is
  // derived from the score, not stored directly — see getRelationshipTier.
  contacts: Record<string, number>;
  // Romance System (v4): a SEPARATE meter from the Relationship score
  // above, keyed by NPC id — only meaningful for romance-eligible NPCs.
  // Builds from positive Flirty topic picks and flirty texts; gates
  // whether "Ask Her Out" can succeed.
  romanceScores: Record<string, number>;
  // Romance System: set permanently once "Ask Her Out" succeeds, keyed by
  // NPC id. Unlocks "Date" as a Meetup type going forward — does not
  // itself schedule anything.
  dating: Record<string, boolean>;
  // Marriage System: set permanently once a Propose succeeds, keyed by
  // NPC id. She leaves her regular location for good and appears at the
  // player's home instead — every other romance-eligible NPC becomes
  // off-limits for Flirty/Dating while any entry here is true.
  married: Record<string, boolean>;
  // "Actions" → Exchange Number (NPC Dialogue spec, Section 3): permanent
  // once successful, keyed by NPC id — unlocks the Contacts app + Phone
  // meetups for that NPC.
  exchangedNumbers: Record<string, boolean>;
  // Meetup System (NPC Dialogue spec): successful DATES completed at
  // locations OTHER than Home, keyed by NPC id — Home's per-NPC Date
  // unlock can require a minimum count of these first. Regular Meetups
  // don't count.
  dateCounts: Record<string, number>;
  // Overnight Stay's morning-after commute, keyed by NPC id: 0 = asleep at
  // home, 1 = in transit (present nowhere). Advances by one on each
  // building the player enters (see advanceOvernightCommute) until she's
  // back to normal, at which point the entry is deleted. Also cleared
  // outright on any phase advance.
  overnightCommuteStep: Record<string, number>;
  // Meetup System: an arranged-but-not-yet-visited (or in-progress) visit.
  // She physically appears as a station at this location on the player's
  // NEXT entry (not the current visit, if already inside), and stays
  // visible there for the whole visit — cleared only once the visit
  // actually ends (End Meetup/Date, or a confirmed door-exit). Only one
  // meetup can be pending/active at a time.
  activeMeetup: { npcId: string; location: MeetupLocationId; type: MeetupType } | null;
}

/** Adds a sent tweet to the Buzzer feed, dropping the oldest once past the cap. */
export function addBuzzerPost(state: PlayerState, record: BuzzerPostRecord) {
  state.buzzerHistory = [record, ...state.buzzerHistory].slice(0, BUZZER_HISTORY_LIMIT);
}

function freshStat(): StatProgress {
  return { bonus: 0, trained: false };
}

export function createPlayerState(): PlayerState {
  return {
    fame: 0,
    image: 0,
    money: 50000, // dev/testing starting budget — revisit before this ships as the real v1 economy
    hp: 100,
    training: { power: freshStat(), speed: freshStat(), endurance: freshStat(), chin: freshStat() },
    managerLevel: 1,
    coachLevel: 1,
    cutmanLevel: 1,
    gymLevels: { weightArea: 1, power: 1, speed: 1, endurance: 1 },
    fightScheduled: false,
    cashAdvanceTaken: false,
    fightInvites: {},
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
    justFinishedFight: false,
    vacationEnergyBonusUses: 0,
    vehicleOwned: null,
    petOwned: null,
    giftInventory: {},
    buzzerHistory: [],
    availablePhotos: [],
    imagestarPosts: [],
    contacts: {},
    romanceScores: {},
    dating: {},
    married: {},
    exchangedNumbers: {},
    dateCounts: {},
    overnightCommuteStep: {},
    activeMeetup: null,
  };
}
