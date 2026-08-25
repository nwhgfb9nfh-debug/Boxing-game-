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

// Family System: a single child living with a married NPC — gender is
// rolled 50/50 the moment she arrives (see rollGender in main.ts); name
// starts as a placeholder until the player names her at her own station.
export interface Child {
  id: string;
  name: string;
  gender: "boy" | "girl";
  named: boolean;
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
  // Mall (Section 5): mostly cosmetic, money-only purchases. Gifts are
  // bought here but given away once the NPC/romance system exists to
  // receive them.
  // Vehicle Dealer (Section 5, updated): vehicles have real gameplay
  // mechanics, so the player can own several at once and switches which
  // one is "active" (driven) rather than replacing it.
  // standardVehicle is the Garage's default — walking out onto the street
  // from any house resets activeVehicle to it, unless the Garage's Drive
  // option was just used for that same visit (see main.ts's exitBuilding).
  vehiclesOwned: string[];
  activeVehicle: string | null;
  standardVehicle: string | null;
  // Pet Store (Section 5, updated): pets are Home fixtures, same treatment
  // as children — decorative, no active-companion behavior, no decay/
  // penalty for not interacting (see main.ts's Pet Supply interaction).
  // Dog/Cat are individually owned, one entry per pet — capacity gated by
  // the player's best-owned house (see dogCatCapacity in main.ts). name is
  // null until the player names it at Home (Dog/Cat only — a fresh pet
  // shows as "Unnamed Dog"/"Unnamed Cat" and only offers naming until it
  // has one; Fish/Snake/Bird/Rabbit are never named). Fish/Snake/Bird/
  // Rabbit are a single tank/cage per type, not bought individually — its
  // Stage (also housing-gated) determines which species are present (see
  // PET_TANK_META).
  dogsOwned: { breedId: string; name: string | null }[];
  catsOwned: { breedId: string; name: string | null }[];
  fishTankOwned: boolean;
  fishTankStage: number;
  snakeTankOwned: boolean;
  snakeTankStage: number;
  birdCageOwned: boolean;
  birdCageStage: number;
  rabbitCageOwned: boolean;
  rabbitCageStage: number;
  // Pet Supply (Section 5, updated): food/toys bought at the Mall, keyed
  // by category ("dog"/"cat"/"fish"/"snake"/"bird"/"rabbit") for food and
  // by item id ("tennis-ball"/"rubber-bone"/"toy-mouse"/"yarn-ball") for
  // toys — each a plain owned count, decremented on use, same pattern as
  // giftInventory below. Feeding/playing is purely cosmetic (the happy
  // reaction) — using a toy on the wrong species just consumes it with no
  // reaction, never anything worse.
  petFoodInventory: Record<string, number>;
  petToyInventory: Record<string, number>;
  // Clothing Store (Section 5, updated): each specific item (e.g.
  // "upper-3") is bought once and owned forever, like Vehicles/Pet
  // breeds — not consumed/stockpiled like gifts or pet supplies. Buying
  // one grants its imageGain permanently, same effect the old flat
  // 3-outfit version had, just distributed per item now.
  clothingOwned: string[];
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
  // Romance System: set permanently once Break Up or Divorce is confirmed
  // for this NPC, keyed by NPC id — blocks "Ask Her Out" (and
  // transitively "Propose", which requires Dating first) from ever
  // succeeding for her again. The romance system's terminal state.
  romanceEnded: Record<string, boolean>;
  // Marriage System: set permanently once a Propose succeeds, keyed by
  // NPC id. She leaves her regular location for good and appears at the
  // player's home instead — every other romance-eligible NPC becomes
  // off-limits for Flirty/Dating while any entry here is true.
  married: Record<string, boolean>;
  // Marriage System: set permanently once Divorce is confirmed, keyed by
  // NPC id — she disappears from the game entirely: no Office/Home
  // station, no Contacts entry, no Text/Meetup reachability. Distinct
  // from romanceEnded (Break Up alone keeps her around as a friend).
  divorced: Record<string, boolean>;
  // Family System: actual children living at home, keyed by mother's NPC
  // id, in arrival order. Any she already had come along the moment she
  // moves in (see resolveProposeAttempt); each new one is appended by
  // checkForNewKids every 3 full camp cycles after the wedding, up to her
  // familyInfo.kidsWants total. named starts false — the player names her
  // via the child's own station at Home (see openNameChildDialogue).
  children: Record<string, Child[]>;
  // Marriage System: the CampCycle.campNumber value at the moment she
  // married the player — the baseline "3 full cycles" counts from.
  marriageCampNumber: Record<string, number>;
  // Marriage System: cumulative % of every future fight's Purse owed in
  // child support from past divorces — 10% per child from that marriage,
  // permanent and stacking across every divorce over a career (2 kids =
  // +20%, etc.). Inert until a real Fight/Purse payout system exists to
  // actually apply it — same "placeholder, not wired up yet" status as
  // purseMultiplier above.
  divorceChildSupportPercent: number;
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
  // Engine state consolidation: EnergyStar/CampCycle/SocialBattery (see
  // game/energyStar.ts, game/campCycle.ts, game/socialBattery.ts) read and
  // write these fields directly instead of keeping their own private
  // state, so playerState stays the single serializable source of truth
  // for everything persistent — no separate serialize()/restore() needed
  // for those systems later.
  // Energy Star: current value and the cap it was last refilled to (the
  // cap itself moves — e.g. 110 with the Airport vacation bonus).
  energyRemaining: number;
  energyCap: number;
  // Camp Cycle: index into CAMP_SEQUENCE (game/campCycle.ts) for the
  // current stage, and which fight camp / opponent cycle this is.
  campStageIndex: number;
  campNumber: number;
  // Social Battery: current value (separate resource from Energy Star,
  // only gates the Talk topic-menu system).
  socialBattery: number;
  // Which one-time-per-phase station ids have already been used this
  // camp phase (e.g. "order", "bar-drink") — cleared on every phase
  // advance. An array, not a Set, so it stays plain-JSON-serializable.
  usedThisPhase: string[];
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
    vehiclesOwned: [],
    activeVehicle: null,
    standardVehicle: null,
    dogsOwned: [],
    catsOwned: [],
    fishTankOwned: false,
    fishTankStage: 0,
    snakeTankOwned: false,
    snakeTankStage: 0,
    birdCageOwned: false,
    birdCageStage: 0,
    rabbitCageOwned: false,
    rabbitCageStage: 0,
    petFoodInventory: {},
    petToyInventory: {},
    clothingOwned: [],
    giftInventory: {},
    buzzerHistory: [],
    availablePhotos: [],
    imagestarPosts: [],
    contacts: {},
    romanceScores: {},
    dating: {},
    romanceEnded: {},
    married: {},
    divorced: {},
    children: {},
    marriageCampNumber: {},
    divorceChildSupportPercent: 0,
    exchangedNumbers: {},
    dateCounts: {},
    overnightCommuteStep: {},
    activeMeetup: null,
    energyRemaining: 100,
    energyCap: 100,
    campStageIndex: 0,
    campNumber: 1,
    socialBattery: 100,
    usedThisPhase: [],
  };
}
