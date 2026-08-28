import "./style.css";
import { createDriveControls } from "./ui/controls";
import { createBuildingUI } from "./ui/buildingUI";
import { createJoystick } from "./ui/joystick";
import { createActionButtons } from "./ui/actionButtons";
import { createTapZone } from "./ui/tapZone";
import { createPhoneUI, type PhoneApi, type HouseListing } from "./ui/phoneUI";
import { createActionMenu, type MenuData } from "./ui/actionMenu";
import { createDialogueBox, type DialogueOption, type DialogueData } from "./ui/dialogueBox";
import { createVehicleSheet, type VehicleSheetData } from "./ui/vehicleSheet";
import { StreetScene } from "./game/street";
import { InteriorScene, type Station, type BlockedZone, type Decoration } from "./game/interior";
import { HeavyBagScene } from "./game/heavyBag";
import { ReflexDotsScene } from "./game/reflexDots";
import { JumpRopeScene } from "./game/jumpRope";
import { createPlayerState, addBuzzerPost, type TrainingStats, type GymLevels, type Child } from "./game/playerState";
import { EnergyStar, MAX_ENERGY } from "./game/energyStar";
import { CampCycle, CAMP_SEQUENCE } from "./game/campCycle";
import { generateBuzzerReplies } from "./game/buzzer";
import { SocialBattery } from "./game/socialBattery";
import {
  PRIYA_PORTRAIT,
  CAROL_PORTRAIT,
  DEREK_PORTRAIT,
  VINNIE_PORTRAIT,
  ANGELA_PORTRAIT,
  MARCUS_PORTRAIT,
  KYLE_PORTRAIT,
  MARGARET_PORTRAIT,
  BIANCA_PORTRAIT,
  ROSA_PORTRAIT,
  KEVIN_PORTRAIT,
  MALIK_PORTRAIT,
  MEI_PORTRAIT,
  TYLER_PORTRAIT,
  SIMONE_PORTRAIT,
  CHRIS_PORTRAIT,
  TONY_PORTRAIT,
  DOROTHY_PORTRAIT,
  JASMINE_PORTRAIT,
} from "./assets/portraits";
import {
  type NpcDef,
  type NpcActionRules,
  type RelationshipTier,
  type TalkCategory,
  type TalkTopicDef,
  type FlirtySubcategory,
  getRelationshipTier,
  tierAtLeast,
  isCategoryUnlocked,
  getTopicDelta,
  formatTopicResult,
  formatRomanceResult,
  formatFamilyReveal,
  tierLabel,
  FLIRTY_ROMANCE_DELTA,
  TEXT_TALK_NOT_ROMANCED,
  TEXT_TALK_ROMANCED,
  TEXT_TALK_DELTA,
  TEXT_TALK_ROMANCE_DELTA,
  type MeetupLocationId,
  type MeetupType,
  type MeetupOptionDef,
  MEETUP_LOCATIONS,
  MEETUP_ENERGY_COST,
  MEETUP_CONNECT_DELTA,
  MEETUP_GIFT_DELTA,
  MEETUP_NO_CONNECT_PENALTY,
  getMeetupLocation,
  type GiftCategory,
  type GiftPreferences,
  type GiftReactionTone,
  type GiftResult,
  getGiftReactionTone,
  getGiftReactionDelta,
} from "./game/npc";
import { nearbyLots, rowForFacing, getHousingBuildings, ENTERABLE_LOTS, type LotInstance } from "./game/world";

const app = document.querySelector<HTMLDivElement>("#app")!;

const canvas = document.createElement("canvas");
app.appendChild(canvas);
const ctx = canvas.getContext("2d")!;

const hud = document.createElement("div");
hud.className = "hud";
const hudLabel = document.createElement("div");
hudLabel.className = "hud__label";
hud.appendChild(hudLabel);
app.appendChild(hud);

const controls = createDriveControls(app);
const buildingUI = createBuildingUI(app);
const joystick = createJoystick(app);
const actionButtons = createActionButtons(app);
const tapZone = createTapZone(app);
const street = new StreetScene(controls);
// Autopilot's REVERSE/🧭 AUTO buttons live inside DriveControls itself
// (visibility gated per-vehicle by applyVehiclePerformance further below);
// the click just needs to open the destination picker, which is main.ts's
// job, not StreetScene's.
controls.onAutopilot(() => openAutopilotMenu());

const playerState = createPlayerState();
// Vinnie's your manager from the very start — his number's already saved,
// no need to Exchange Number with him first (see VINNIE further below).
playerState.exchangedNumbers.vinnie = true;
const energy = new EnergyStar(playerState);
const campCycle = new CampCycle(playerState);
const socialBattery = new SocialBattery(playerState);
const dialogueBox = createDialogueBox(app);

// Camp stage (Section 2) — always visible, top-center below the frame/
// building label. Advances only when you sleep (see sleepAtBed).
const campHud = document.createElement("div");
campHud.className = "camp-hud";
const campPill = document.createElement("div");
campPill.className = "camp-hud__pill";
campHud.appendChild(campPill);
app.appendChild(campHud);

// Phase gating (Section 2): buildings stay enterable regardless of stage
// (future NPC dialogue lives there and doesn't cost energy), but any
// energy-costing action is locked unless its station matches the current
// stage. Training stations additionally need the stage's specific stat.
// Money-only actions (Reception, Mall, Sponsorships, Cash Advance,
// Invest in Portfolio, Vacation) are never phase-gated.
const TRAINING_STAT_BY_STATION: Record<string, "power" | "speed" | "endurance"> = {
  heavybag: "power",
  reflexdots: "speed",
  jumprope: "endurance",
};
const PRIVATE_LIFE_STATIONS = new Set([
  "workoutclip",
  "order",
  "sunbathe",
  "swim",
  "bar",
  "vip-bouncer",
  "bottle",
  "pressreception",
]);
const PROMOTION_STATIONS = new Set(["pressconf", "photostudio", "faceoff", "fanevent"]);

// Every energy-costing Private Life activity is once-per-phase — cleared
// in sleepAtBed whenever the stage advances. "bar", "pressreception", and
// "workoutclip" host multiple distinct activities each limited
// individually inside their own menu builders (bar-drink/bar-round,
// press-podcast/press-tv, workoutclip-shoot/workoutclip-training), so
// they're excluded from the blanket per-station check below.
// Backed by playerState.usedThisPhase (a plain array, not a Set — stays
// JSON-serializable) rather than its own module-level Set.
function hasUsedThisPhase(activityId: string): boolean {
  return playerState.usedThisPhase.includes(activityId);
}
function markUsedThisPhase(activityId: string) {
  if (!hasUsedThisPhase(activityId)) playerState.usedThisPhase.push(activityId);
}
function clearUsedThisPhase() {
  playerState.usedThisPhase = [];
}
const MULTI_ACTIVITY_STATIONS = new Set(["bar", "pressreception", "workoutclip"]);

function requirePrivateLifePhase(): string | null {
  const stage = campCycle.current;
  if (stage.type !== "privatelife") {
    return `Only available during a Private Life phase (currently "${stage.label}").`;
  }
  return null;
}

/** Returns a lock message if this station's activity doesn't match the current camp stage or was already used this phase. */
function getStationPhaseLock(stationId: string): string | null {
  const stage = campCycle.current;
  const trainingStat = TRAINING_STAT_BY_STATION[stationId];
  if (trainingStat) {
    if (stage.type !== "training") {
      return `Closed — this is a Training station, but the current phase is "${stage.label}".`;
    }
    if (stage.stat !== trainingStat) {
      return `Closed — this phase trains ${stage.stat}, not ${trainingStat}.`;
    }
    return null;
  }
  if (PRIVATE_LIFE_STATIONS.has(stationId)) {
    const lock = requirePrivateLifePhase();
    if (lock) return lock;
    if (!MULTI_ACTIVITY_STATIONS.has(stationId) && hasUsedThisPhase(stationId)) {
      return "Already done this Private Life phase.";
    }
    return null;
  }
  if (PROMOTION_STATIONS.has(stationId)) {
    if (stage.type !== "promotion") {
      return `Closed — only available during a Promotion phase (currently "${stage.label}").`;
    }
    return null;
  }
  return null;
}

/** Sleeping is blocked (not just non-advancing) on the two stages you can't skip past by resting. */
function getBedLock(): string | null {
  const stage = campCycle.current;
  if (stage.type === "nofight" && !playerState.fightScheduled) {
    return "You need to schedule a fight before you can sleep — head to the Office.";
  }
  if (stage.type === "fight") {
    return "You can't sleep through fight night — head to the Arena.";
  }
  // Sleeping through a Meetup/Date she's actually present for (not just
  // arranged-but-unvisited elsewhere) would advance the whole phase with
  // her mid-visit — end it first instead (Overnight Stay is the one
  // meetup option that's SUPPOSED to advance the phase).
  if (playerState.activeMeetup && scene.type === "interior" && scene.interior.hasStation("meetup-npc")) {
    const label = playerState.activeMeetup.type === "date" ? "Date" : "Meetup";
    return `You're in the middle of a ${label} — end it before you sleep.`;
  }
  return null;
}

// Energy Star + HP (Section 3 & 7) — top-right, always visible outside minigames.
const statusHud = document.createElement("div");
statusHud.className = "status-hud";
const energyPill = document.createElement("div");
energyPill.className = "status-hud__pill status-hud__pill--energy";
const hpPill = document.createElement("div");
hpPill.className = "status-hud__pill status-hud__pill--hp";
const socialPill = document.createElement("div");
socialPill.className = "status-hud__pill status-hud__pill--social";
statusHud.appendChild(energyPill);
statusHud.appendChild(hpPill);
statusHud.appendChild(socialPill);
app.appendChild(statusHud);

// Money (Section 5) — its own HUD, top-left.
const moneyHud = document.createElement("div");
moneyHud.className = "money-hud";
const moneyPill = document.createElement("div");
moneyPill.className = "money-hud__pill";
moneyHud.appendChild(moneyPill);
app.appendChild(moneyHud);

// The Phone (Section 5) — only usable inside a building, not while
// driving. Home screen of apps: Contacts, Stats, Real Estate, Buzzer
// (Twitter), Imagestar (Instagram, not v1 yet).
function getHouseListings(): HouseListing[] {
  return getHousingBuildings().map((b) => ({ name: b.name, locked: !!b.locked, price: b.price }));
}

const phoneApi: PhoneApi = {
  getEnergy: () => energy.remaining,
  getFame: () => playerState.fame,
  getImage: () => playerState.image,
  getMoney: () => playerState.money,
  getHp: () => playerState.hp,
  getTraining: () => playerState.training,
  getHouses: getHouseListings,
  buyHouse: (name) => {
    const house = getHousingBuildings().find((h) => h.name === name);
    if (!house) return "Not found.";
    if (!house.locked) return `${name} is already owned.`;
    const price = house.price ?? 0;
    if (playerState.money < price) return `Not enough money — need $${price}.`;
    playerState.money -= price;
    house.locked = false;
    return `Purchased ${name}!`;
  },
  post: (text) => {
    if (!energy.spend(10)) {
      return { blocked: true, blockedReason: "Not enough energy to post.", replies: [] };
    }
    const result = generateBuzzerReplies(playerState.fame, playerState.image, text);
    // Fame stays a flat, fixed gain regardless of what the (fake) replies
    // say — the spec's game-state boundary: flavor text and stats never
    // talk to each other. No gain if the post was blocked.
    if (!result.blocked) {
      playerState.fame += 2;
      addBuzzerPost(playerState, { text, result });
    }
    return result;
  },
  getBuzzerHistory: () => playerState.buzzerHistory,
  getAvailablePhotos: () => playerState.availablePhotos,
  getImagestarPosts: () => playerState.imagestarPosts,
  postPhoto: (id) => {
    const idx = playerState.availablePhotos.findIndex((p) => p.id === id);
    if (idx === -1) return "Photo not found.";
    if (!energy.spend(10)) return "Not enough energy to post.";
    const [photo] = playerState.availablePhotos.splice(idx, 1);
    playerState.imagestarPosts = [photo, ...playerState.imagestarPosts];
    playerState.image += 3;
    return `Posted! Image +3 (now ${playerState.image}).`;
  },
  getContacts: () => {
    // Divorce: she's gone from the game entirely — no Contacts entry, no
    // Text/Meetup reachability, nothing.
    return ALL_NPCS.filter((npc) => playerState.exchangedNumbers[npc.id] && !playerState.divorced[npc.id]).map((npc) => {
      const score = getRelationshipScore(npc.id);
      const tier = getRelationshipTier(score);
      return {
        id: npc.id,
        name: npc.name,
        portrait: npc.portrait,
        tierLabel: tierLabel(tier),
        score,
        maxScore: 100,
        romanceEligible: npc.romanceEligible,
        // Hidden until she's actually being dated — a friend you haven't
        // asked out yet shouldn't show a Romance meter at all — and hidden
        // again while locked out (married elsewhere), same as before.
        romanceScore:
          npc.romanceEligible && !!playerState.dating[npc.id] && !isRomanceLockedOut(npc)
            ? getRomanceScore(npc.id)
            : undefined,
        romanceMax: 100,
        dating: !!playerState.dating[npc.id],
        locked: isNpcInCurrentBuilding(npc.id),
      };
    });
  },
  getTextTalkOptions: (npcId) => {
    const npc = getNpcById(npcId);
    if (!npc) return [];
    // Assigned by NPC type (romance-eligible vs. friend-only), not by
    // Dating status — flirty texting is itself one of the ways the
    // Romance meter builds up in the first place. Married-elsewhere locks
    // out the flirty variant same as the in-person Flirty category.
    return npc.romanceEligible && !isRomanceLockedOut(npc) ? TEXT_TALK_ROMANCED : TEXT_TALK_NOT_ROMANCED;
  },
  sendTextTalk: (npcId, optionId) => {
    if (isNpcInCurrentBuilding(npcId)) return "They're right here — talk to them in person instead.";
    bumpRelationship(npcId, TEXT_TALK_DELTA);
    let resultText = formatTopicResult(TEXT_TALK_DELTA);
    const npc = getNpcById(npcId);
    if (npc?.romanceEligible && !isRomanceLockedOut(npc) && optionId === "flirty") {
      bumpRomance(npcId, TEXT_TALK_ROMANCE_DELTA);
      resultText += ` / ${formatRomanceResult(TEXT_TALK_ROMANCE_DELTA)}`;
    }
    return resultText;
  },
  // Meetup System: "Initiate Meetup" only ARRANGES the visit from here —
  // she then physically appears as a station at that location on the
  // player's next visit there (see getActiveMeetupStation) and stays
  // there for the whole visit, where the actual Connect/Gift options play
  // out in person, same as any other NPC dialogue. Only one meetup can be
  // arranged/active at a time.
  getMeetupTypes: (npcId) => {
    const npc = getNpcById(npcId);
    if (!npc) return [];
    // Managers: while he's your currently-hired manager, Meetup doesn't
    // apply — he's already around at the Office constantly, no need to
    // schedule anything. Only once you've moved on to a different manager
    // tier, AND built real Friend-tier trust with him, does Regular
    // Meetup open up — re-hiring him closes it again.
    const isActiveManager = npc.managerTier !== undefined && playerState.managerLevel === npc.managerTier;
    const managerEligible =
      npc.managerTier === undefined ||
      (!isActiveManager && tierAtLeast(getRelationshipTier(getRelationshipScore(npcId)), "friend"));
    // Married to her — meetups aren't disabled outright (spec correction):
    // only the Home location is redundant (she already lives there — see
    // getMeetupLocations). Diner/Beach/Lounge stay fully available, both
    // Regular Meetup and Date.
    const types: { id: MeetupType; label: string; available: boolean; reason?: string }[] = [
      {
        id: "regular",
        label: "Regular Meetup",
        available: managerEligible,
        reason: isActiveManager
          ? "Just meet me at the Office."
          : npc.managerTier !== undefined && !managerEligible
            ? "You're not close enough yet."
            : undefined,
      },
    ];
    if (npc.romanceEligible) {
      const lockedOut = isRomanceLockedOut(npc);
      const dating = !lockedOut && !!playerState.dating[npcId];
      types.push({
        id: "date",
        label: "Date",
        available: dating,
        reason: playerState.romanceEnded[npcId]
          ? "It's over."
          : lockedOut
            ? "You're married."
            : dating
              ? undefined
              : "You're not dating yet.",
      });
    }
    return types;
  },
  getMeetupLocations: (npcId, type) => {
    const npc = getNpcById(npcId);
    if (!npc) return [];
    const meetupType = type as MeetupType;
    const tier = getRelationshipTier(getRelationshipScore(npcId));
    const dateCount = playerState.dateCounts[npcId] ?? 0;
    const active = playerState.activeMeetup;
    return MEETUP_LOCATIONS.map((loc) => {
      if (active) {
        const isThisOne = active.npcId === npcId && active.location === loc.id && active.type === meetupType;
        return {
          id: loc.id,
          label: loc.label,
          available: false,
          reason: isThisOne ? "Arranged — go find her there." : "You already have a meetup arranged.",
        };
      }
      if (loc.id === "home") {
        // She already lives here — "arranging" a Home visit doesn't mean
        // anything once she's your wife.
        if (playerState.married[npcId]) {
          return { id: loc.id, label: loc.label, available: false, reason: "She already lives here." };
        }
        if (meetupType === "date") {
          const hasContent = loc.dateConnect.length > 0;
          const unlockFn = npc.homeDateUnlock;
          const unlocked = hasContent && !!unlockFn && unlockFn(dateCount, tier);
          return {
            id: loc.id,
            label: loc.label,
            available: unlocked,
            reason: !hasContent || !unlockFn ? "Not yet designed." : unlocked ? undefined : "Not available yet.",
          };
        }
        // Regular Meetup at Home: purely platonic, same as every other
        // location — no per-NPC relationship gate, just needs content.
        const hasContent = loc.regularGeneral.length > 0;
        return {
          id: loc.id,
          label: loc.label,
          available: hasContent,
          reason: hasContent ? undefined : "Not yet designed.",
        };
      }
      const hasContent = meetupType === "date" ? loc.dateConnect.length > 0 : loc.regularGeneral.length > 0;
      return {
        id: loc.id,
        label: loc.label,
        available: hasContent,
        reason: hasContent ? undefined : "Not yet designed.",
      };
    });
  },
  payForMeetup: (npcId, type, locationId) => {
    if (isNpcInCurrentBuilding(npcId)) {
      return { ok: false, message: "They're right here — no need to set up a meetup." };
    }
    if (playerState.activeMeetup) return { ok: false, message: "You already have a meetup arranged." };
    const meetupType = type as MeetupType;
    const loc = getMeetupLocation(locationId as MeetupLocationId);
    const hasContent = meetupType === "date" ? loc.dateConnect.length > 0 : loc.regularGeneral.length > 0;
    if (!hasContent) return { ok: false, message: "Not yet designed." };
    if (!energy.spend(MEETUP_ENERGY_COST)) {
      return { ok: false, message: `Not enough energy — need ${MEETUP_ENERGY_COST}.` };
    }
    playerState.activeMeetup = { npcId, location: loc.id, type: meetupType };
    const typeLabel = meetupType === "date" ? "Date" : "meetup";
    return { ok: true, message: `Arranged! You'll find her at the ${loc.label} for your ${typeLabel} next time you visit.` };
  },
};

const phoneUI = createPhoneUI(app, phoneApi);

const phoneBtn = document.createElement("button");
phoneBtn.type = "button";
phoneBtn.className = "btn btn--phone";
phoneBtn.textContent = "📱";
app.appendChild(phoneBtn);
phoneBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  phoneUI.open();
});

// Shared overlay for every other Private Life location's action menu
// (Gym's Weight Area first; Diner/Beach/Office/Lounge/Press reuse this
// same instance as they come online — only one can be open at a time).
const locationMenu = createActionMenu(app);

// Vehicle Dealer's single-car info sheet (Section 5, updated) — its own
// overlay since it needs a picture/‹ › paging layout ActionMenu's flat
// button list doesn't support.
const vehicleSheet = createVehicleSheet(app);

// Dev-only: jump straight to any camp stage without playing through the
// ones before it. Not part of the real player experience — no polish.
const debugBtn = document.createElement("button");
debugBtn.type = "button";
debugBtn.className = "btn btn--debug";
debugBtn.textContent = "🛠";
app.appendChild(debugBtn);
debugBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  openDebugMenu();
});

// Dev-only stat editor — plain number inputs, no polish. Its own overlay
// (not the shared locationMenu) since MenuAction only renders buttons.
const debugStatsOverlay = document.createElement("div");
debugStatsOverlay.className = "action-menu-overlay";
debugStatsOverlay.style.display = "none";
const debugStatsPanel = document.createElement("div");
debugStatsPanel.className = "action-menu";
debugStatsOverlay.appendChild(debugStatsPanel);
app.appendChild(debugStatsOverlay);

interface DebugStatField {
  label: string;
  get: () => number;
  set: (n: number) => void;
}

function getDebugStatFields(): DebugStatField[] {
  return [
    { label: "Fame", get: () => playerState.fame, set: (n) => (playerState.fame = n) },
    { label: "Image", get: () => playerState.image, set: (n) => (playerState.image = n) },
    { label: "HP", get: () => playerState.hp, set: (n) => (playerState.hp = n) },
    { label: "Social Battery", get: () => socialBattery.remaining, set: (n) => socialBattery.set(n) },
    { label: "Money", get: () => playerState.money, set: (n) => (playerState.money = n) },
  ];
}

function renderDebugStats() {
  debugStatsPanel.innerHTML = "";

  const title = document.createElement("div");
  title.className = "action-menu__title";
  title.textContent = "🛠 Edit Stats";
  debugStatsPanel.appendChild(title);

  const list = document.createElement("div");
  list.className = "debug-stats__list";
  for (const field of getDebugStatFields()) {
    const row = document.createElement("div");
    row.className = "debug-stats__row";

    const label = document.createElement("span");
    label.className = "debug-stats__label";
    label.textContent = field.label;

    const input = document.createElement("input");
    input.type = "number";
    input.className = "debug-stats__input";
    input.value = String(field.get());

    const setBtn = document.createElement("button");
    setBtn.type = "button";
    setBtn.className = "debug-stats__set";
    setBtn.textContent = "Set";
    setBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const n = Number(input.value);
      if (Number.isFinite(n)) field.set(n);
      renderDebugStats();
    });

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(setBtn);
    list.appendChild(row);
  }
  debugStatsPanel.appendChild(list);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "action-menu__close";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    debugStatsOverlay.style.display = "none";
  });
  debugStatsPanel.appendChild(closeBtn);
}

function openDebugStatsPanel() {
  debugStatsOverlay.style.display = "flex";
  renderDebugStats();
}

// Dev-only: skips the grind to reach any romance/marriage state without
// playing through it — set an NPC's Relationship/Romance/Dating/Wife/Dates
// count directly instead of building them up for real. Same custom-overlay
// pattern as the plain stat editor above, plus an NPC picker row.
const debugRomanceOverlay = document.createElement("div");
debugRomanceOverlay.className = "action-menu-overlay";
debugRomanceOverlay.style.display = "none";
const debugRomancePanel = document.createElement("div");
debugRomancePanel.className = "action-menu";
debugRomanceOverlay.appendChild(debugRomancePanel);
app.appendChild(debugRomanceOverlay);

let debugRomanceNpcId: string | null = null;

function renderDebugRomance() {
  debugRomancePanel.innerHTML = "";

  const title = document.createElement("div");
  title.className = "action-menu__title";
  title.textContent = "🛠 Relationship Debug";
  debugRomancePanel.appendChild(title);

  const npcRow = document.createElement("div");
  npcRow.className = "debug-stats__npc-row";
  for (const npc of ALL_NPCS.filter((n) => n.romanceEligible)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `debug-stats__set${npc.id === debugRomanceNpcId ? " debug-stats__set--active" : ""}`;
    btn.textContent = npc.name;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      debugRomanceNpcId = npc.id;
      renderDebugRomance();
    });
    npcRow.appendChild(btn);
  }
  debugRomancePanel.appendChild(npcRow);

  const npc = debugRomanceNpcId ? getNpcById(debugRomanceNpcId) : undefined;
  const list = document.createElement("div");
  list.className = "debug-stats__list";

  if (!npc) {
    const hint = document.createElement("span");
    hint.className = "debug-stats__label";
    hint.textContent = "Pick an NPC above.";
    list.appendChild(hint);
  } else {
    const numberRow = (label: string, get: () => number, set: (n: number) => void) => {
      const row = document.createElement("div");
      row.className = "debug-stats__row";
      const labelEl = document.createElement("span");
      labelEl.className = "debug-stats__label";
      labelEl.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.className = "debug-stats__input";
      input.value = String(get());
      const setBtn = document.createElement("button");
      setBtn.type = "button";
      setBtn.className = "debug-stats__set";
      setBtn.textContent = "Set";
      setBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const n = Number(input.value);
        if (Number.isFinite(n)) set(n);
        rebuildCurrentInteriorScene();
        renderDebugRomance();
      });
      row.appendChild(labelEl);
      row.appendChild(input);
      row.appendChild(setBtn);
      list.appendChild(row);
    };

    const boolRow = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const row = document.createElement("div");
      row.className = "debug-stats__row";
      const labelEl = document.createElement("span");
      labelEl.className = "debug-stats__label";
      labelEl.textContent = label;
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "debug-stats__set";
      toggleBtn.textContent = get() ? "TRUE" : "FALSE";
      toggleBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        set(!get());
        rebuildCurrentInteriorScene();
        renderDebugRomance();
      });
      row.appendChild(labelEl);
      row.appendChild(toggleBtn);
      list.appendChild(row);
    };

    numberRow(
      "Relationship",
      () => getRelationshipScore(npc.id),
      (n) => (playerState.contacts[npc.id] = Math.max(0, n)),
    );
    numberRow(
      "Romance",
      () => getRomanceScore(npc.id),
      (n) => (playerState.romanceScores[npc.id] = Math.max(0, n)),
    );
    boolRow(
      "Dating",
      () => !!playerState.dating[npc.id],
      (v) => (playerState.dating[npc.id] = v),
    );
    boolRow(
      "Wife",
      () => !!playerState.married[npc.id],
      (v) => (playerState.married[npc.id] = v),
    );
    numberRow(
      "Dates Count",
      () => playerState.dateCounts[npc.id] ?? 0,
      (n) => (playerState.dateCounts[npc.id] = Math.max(0, n)),
    );
  }
  debugRomancePanel.appendChild(list);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "action-menu__close";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    debugRomanceOverlay.style.display = "none";
  });
  debugRomancePanel.appendChild(closeBtn);
}

function openDebugRomancePanel() {
  debugRomanceOverlay.style.display = "flex";
  renderDebugRomance();
}

function openDebugMenu() {
  locationMenu.open(() => ({
    title: "🛠 Debug: Jump to Stage",
    energyText: `Current: ${campCycle.current.label} (Camp ${campCycle.campNumber})`,
    // "After Fight" is excluded — its state (0 Energy, justFinishedFight)
    // only makes sense as a result of Simulate Fight at the Arena, and
    // reaching it that way is always one tap from FIGHT NIGHT anyway.
    actions: [
      {
        id: "edit-stats",
        label: "✏️ Edit Stats",
        cost: 0,
        costLabel: "›",
        run: () => {
          locationMenu.close();
          openDebugStatsPanel();
          return "";
        },
      },
      {
        id: "edit-romance",
        label: "💕 Relationship Debug",
        cost: 0,
        costLabel: "›",
        run: () => {
          locationMenu.close();
          openDebugRomancePanel();
          return "";
        },
      },
      {
        // Fast-forwards a FULL lap of CAMP_SEQUENCE back to "No Fight
        // Scheduled" — unlike jumping to an individual stage below (which
        // uses jumpTo and never touches campNumber), this goes through
        // campCycle.advance() same as a real sleep, so campNumber actually
        // increments and the same "camp just wrapped" checks run (fight
        // state reset, Kids System's checkForNewKids) — the fast way to
        // test anything gated on full cycles completing.
        id: "next-camp",
        label: "⏭ Jump to Next Camp",
        cost: 0,
        costLabel: "GO",
        run: () => {
          let stage = campCycle.current;
          do {
            stage = campCycle.advance();
          } while (stage.type !== "nofight");
          playerState.fightScheduled = false;
          playerState.cashAdvanceTaken = false;
          playerState.fightInvites = {};
          clearUsedThisPhase();
          socialBattery.reset();
          playerState.overnightCommuteStep = {};
          energy.sleep(MAX_ENERGY);
          const kidMessages = checkForNewKids();
          return `Jumped to Camp ${campCycle.campNumber} — ${stage.label}.${
            kidMessages.length ? " " + kidMessages.join(" ") : ""
          }`;
        },
      },
      ...CAMP_SEQUENCE.map((stage, i) => ({ stage, i }))
        .filter(({ stage }) => stage.type !== "afterfight")
        .map(({ stage, i }) => {
      const here = i === campCycle.currentIndex;
      return {
        id: `stage-${i}`,
        label: stage.label,
        cost: 0,
        costLabel: here ? "HERE" : "GO",
        disabled: here,
        run: () => {
          campCycle.jumpTo(i);
          // Every real stage but "No Fight Scheduled" is only reachable
          // after booking a fight — keep that true when jumping there directly.
          playerState.fightScheduled = stage.type !== "nofight";
          clearUsedThisPhase();
          socialBattery.reset();
          playerState.overnightCommuteStep = {};
          // Reset Energy to whatever a real sleep into this stage would
          // have left it at — same vacation-bonus formula as sleepAtBed,
          // consuming a use so repeated jumps into Private Life can't
          // reuse the same charge. Doesn't bank HP from the discarded
          // leftover — debug jump shouldn't hand out free HP.
          const useBonus = playerState.vacationEnergyBonusUses > 0 && stage.type === "privatelife";
          const cap = useBonus ? MAX_ENERGY + 10 : MAX_ENERGY;
          if (useBonus) playerState.vacationEnergyBonusUses -= 1;
          energy.sleep(cap);
          if (stage.type === "fight" && playerState.hp > 100) playerState.hp = 100;
          locationMenu.close();
          return "";
        },
      };
    }),
    ],
  }));
}

function openWeightAreaMenu() {
  locationMenu.open(() => {
    const shootUsed = hasUsedThisPhase("workoutclip-shoot");
    const trainUsed = hasUsedThisPhase("workoutclip-training");
    return {
      title: "🏋️ Weight Area",
      energyText: `Energy: ${energy.remaining}/100  ·  Fame: ${playerState.fame}  ·  Image: ${playerState.image}  ·  HP: ${playerState.hp}`,
      actions: [
        {
          id: "shoot-workout-content",
          label: "Shoot Workout Content",
          cost: 10,
          costLabel: shootUsed ? "DONE" : "10 EN",
          disabled: shootUsed,
          run: () => {
            if (shootUsed) return "Already done this Private Life phase.";
            if (!energy.spend(10)) return "Not enough energy to shoot content.";
            playerState.fame += 2;
            playerState.image += 2;
            markUsedThisPhase("workoutclip-shoot");
            return "Posted! Fame +2, Image +2.";
          },
        },
        {
          id: "weight-training",
          label: "Weight Training",
          cost: 15,
          costLabel: trainUsed ? "DONE" : "15 EN",
          disabled: trainUsed,
          run: () => {
            if (trainUsed) return "Already done this Private Life phase.";
            if (!energy.spend(15)) return "Not enough energy for weight training.";
            playerState.hp += 5;
            markUsedThisPhase("workoutclip-training");
            return `Solid session. HP +5 (now ${playerState.hp}).`;
          },
        },
      ],
    };
  });
}

function openDinerMenu() {
  locationMenu.open(() => {
    const used = hasUsedThisPhase("order");
    return {
      title: "🍔 Diner",
      energyText: `Energy: ${energy.remaining}/100  ·  HP: ${playerState.hp}`,
      actions: [
        {
          id: "order",
          label: "Order Menu",
          cost: 10,
          costLabel: used ? "DONE" : "10 EN",
          disabled: used,
          run: () => {
            if (used) return "Already done this Private Life phase.";
            if (!energy.spend(10)) return "Not enough energy to order.";
            playerState.hp += 5;
            markUsedThisPhase("order");
            return `Order's up! HP +5 (now ${playerState.hp}).`;
          },
        },
      ],
    };
  });
}

// Press Building (Section 6, Promotion): the room's other 4 stations are
// the real pre-fight Promotion-camp events from the spec, playable now as
// text/menu placeholders — poses and fan-event destinations are just
// labels until the real graphics/travel/autograph-minigame pieces exist.
// Each is single-use until a fight-camp cycle exists to reset it.
type Archetype = "respect" | "dismissive" | "disrespect" | "emotional";
const ARCHETYPES: { id: Archetype; label: string }[] = [
  { id: "respect", label: "Respect" },
  { id: "dismissive", label: "Dismissive" },
  { id: "disrespect", label: "Disrespect" },
  { id: "emotional", label: "Emotional" },
];

function applyArchetype(choice: Archetype): string {
  if (choice === "respect") {
    playerState.image += 3;
    return `Image +3 (now ${playerState.image}).`;
  }
  if (choice === "dismissive") {
    playerState.hp += 3;
    return `HP +3 (now ${playerState.hp}).`;
  }
  if (choice === "disrespect") {
    playerState.fame += 4;
    playerState.image -= 3;
    return `Fame +4, Image -3 (now Fame ${playerState.fame}, Image ${playerState.image}).`;
  }
  playerState.purseMultiplier += 0.1;
  return `Purse multiplier +0.1 (now ${playerState.purseMultiplier.toFixed(1)}x).`;
}

// Every event below follows the same shape: a "Start X" screen (closeable,
// spends the 50 Energy) that hands off to one or more choice screens
// (hideClose — once you've paid, the only way out is picking an option).
type PressConfStage = "start" | "q1" | "q2" | "q2-round";
let pressConfStage: PressConfStage = "start";

function buildPressConfStartMenu(): MenuData {
  return {
    title: "🎤 Press Conference",
    energyText: `Energy: ${energy.remaining}/100`,
    actions: [
      {
        id: "start",
        label: "Start Press Conference",
        cost: 50,
        run: () => {
          if (!energy.spend(50)) return "Not enough energy for a press conference.";
          pressConfStage = "q1";
          return "";
        },
      },
    ],
  };
}

function buildPressConfQ1Menu(): MenuData {
  return {
    title: "🎤 Press Conference — Q1",
    energyText: `"What do you think about your opponent?"`,
    hideClose: true,
    actions: ARCHETYPES.map((a) => ({
      id: `q1-${a.id}`,
      label: a.label,
      cost: 0,
      costLabel: "",
      run: () => {
        const msg = applyArchetype(a.id);
        pressConfStage = "q2";
        return msg;
      },
    })),
  };
}

function buildPressConfQ2Menu(): MenuData {
  return {
    title: "🎤 Press Conference — Q2",
    energyText: `"What's your prediction for the fight?"`,
    hideClose: true,
    actions: [
      {
        id: "no-prediction",
        label: "Give No Prediction",
        cost: 0,
        costLabel: "",
        run: () => {
          playerState.fame -= 2;
          playerState.hp += 3;
          playerState.fightPrediction = "No prediction given";
          playerState.pressConferenceDone = true;
          return "Fame -2, HP +3. Press conference done.";
        },
      },
      {
        id: "promise-victory",
        label: "Promise Victory",
        cost: 0,
        costLabel: "›",
        run: () => {
          pressConfStage = "q2-round";
          return "";
        },
      },
    ],
  };
}

const PREDICTION_OPTIONS: { id: string; label: string; value: string }[] = [
  { id: "r1", label: "KO — Round 1", value: "KO in Round 1" },
  { id: "r2", label: "KO — Round 2", value: "KO in Round 2" },
  { id: "r3", label: "KO — Round 3", value: "KO in Round 3" },
  { id: "r4", label: "KO — Round 4", value: "KO in Round 4" },
  { id: "decision", label: "Win by Decision", value: "Win by Decision" },
];

function buildPressConfRoundMenu(): MenuData {
  return {
    title: "🎤 Promise Victory",
    energyText: "Lock in your prediction:",
    hideClose: true,
    actions: PREDICTION_OPTIONS.map((opt) => ({
      id: opt.id,
      label: opt.label,
      cost: 0,
      costLabel: "",
      run: () => {
        playerState.fightPrediction = opt.value;
        playerState.pressConferenceDone = true;
        return `Prediction locked in: ${opt.value}. (Resolved once the Fight system exists.)`;
      },
    })),
  };
}

function buildPressConfMenu(): MenuData {
  if (playerState.pressConferenceDone) {
    return {
      title: "🎤 Press Conference",
      energyText: `Done — prediction: ${playerState.fightPrediction}`,
      actions: [],
    };
  }
  if (pressConfStage === "q1") return buildPressConfQ1Menu();
  if (pressConfStage === "q2") return buildPressConfQ2Menu();
  if (pressConfStage === "q2-round") return buildPressConfRoundMenu();
  return buildPressConfStartMenu();
}

function openPressConfMenu() {
  pressConfStage = "start";
  locationMenu.open(buildPressConfMenu);
}

type PhotoShootStage = "start" | "pick";
let photoShootStage: PhotoShootStage = "start";

function buildPhotoShootStartMenu(): MenuData {
  return {
    title: "📸 Photo Shoot",
    energyText: `Energy: ${energy.remaining}/100`,
    actions: [
      {
        id: "start",
        label: "Start Photo Shoot",
        cost: 50,
        run: () => {
          if (!energy.spend(50)) return "Not enough energy for a photo shoot.";
          photoShootStage = "pick";
          return "";
        },
      },
    ],
  };
}

function buildPhotoShootPickMenu(): MenuData {
  return {
    title: "📸 Pick a Pose",
    energyText: "",
    hideClose: true,
    actions: [1, 2, 3, 4, 5].map((n) => ({
      id: `pose-${n}`,
      label: `🖼️ Pose ${n} [image placeholder]`,
      cost: 0,
      costLabel: "",
      run: () => {
        playerState.selectedPose = n;
        playerState.photoShootDone = true;
        playerState.availablePhotos.push({ id: `pose-${n}-${Date.now()}`, caption: `Photo Shoot — Pose ${n}`, source: "photoshoot" });
        return `Pose ${n} selected! Available to post on Imagestar.`;
      },
    })),
  };
}

function buildPhotoShootMenu(): MenuData {
  if (playerState.photoShootDone) {
    return {
      title: "📸 Photo Shoot",
      energyText: `Pose ${playerState.selectedPose} selected.`,
      actions: [],
    };
  }
  return photoShootStage === "pick" ? buildPhotoShootPickMenu() : buildPhotoShootStartMenu();
}

function openPhotoShootMenu() {
  photoShootStage = "start";
  locationMenu.open(buildPhotoShootMenu);
}

type FaceOffStage = "start" | "pick";
let faceOffStage: FaceOffStage = "start";

function buildFaceOffStartMenu(): MenuData {
  return {
    title: "🥊 Face-Off",
    energyText: `Energy: ${energy.remaining}/100`,
    actions: [
      {
        id: "start",
        label: "Start Face-Off",
        cost: 50,
        run: () => {
          if (!energy.spend(50)) return "Not enough energy for a face-off.";
          faceOffStage = "pick";
          return "";
        },
      },
    ],
  };
}

function buildFaceOffPickMenu(): MenuData {
  return {
    title: "🥊 Face-Off — Choose Your Attitude",
    energyText: "",
    hideClose: true,
    actions: ARCHETYPES.map((a) => ({
      id: `faceoff-${a.id}`,
      label: a.label,
      cost: 0,
      costLabel: "",
      run: () => {
        const msg = applyArchetype(a.id);
        playerState.faceOffDone = true;
        return msg;
      },
    })),
  };
}

function buildFaceOffMenu(): MenuData {
  if (playerState.faceOffDone) {
    return { title: "🥊 Face-Off", energyText: "Already done for this camp.", actions: [] };
  }
  return faceOffStage === "pick" ? buildFaceOffPickMenu() : buildFaceOffStartMenu();
}

function openFaceOffMenu() {
  faceOffStage = "start";
  locationMenu.open(buildFaceOffMenu);
}

const FAN_EVENT_DESTINATIONS = ["Beach", "Lounge", "Gym", "Airport", "Mall"];

function buildFanEventMenu(): MenuData {
  if (playerState.fanEventDone) {
    return {
      title: "📣 Marketing Expert",
      energyText: `Fan event booked at the ${playerState.fanEventDestination}.`,
      actions: [],
    };
  }
  return {
    title: "📣 Marketing Expert",
    energyText: `Energy: ${energy.remaining}/100`,
    actions: [
      {
        id: "start-fan-event",
        label: "Start Fan Event",
        cost: 50,
        run: () => {
          if (!energy.spend(50)) return "Not enough energy to start a fan event.";
          const dest = FAN_EVENT_DESTINATIONS[Math.floor(Math.random() * FAN_EVENT_DESTINATIONS.length)];
          playerState.fanEventDestination = dest;
          playerState.fanEventDone = true;
          return `Your fan event is set for the ${dest}! (Head there once autograph signing is built.)`;
        },
      },
    ],
  };
}

function openFanEventMenu() {
  locationMenu.open(buildFanEventMenu);
}

// Lounge (Section 5): VIP is a corner of the same room (top-right),
// blocked off by an invisible rope until a bouncer NPC waves you through —
// see LOUNGE_VIP_ZONE and InteriorScene's BlockedZone collision. Exchange
// Numbers/Selfie with Celebrity land here later with the NPC system; Buy a
// Bottle is live now.
const VIP_FAME_REQUIREMENT = 20; // placeholder — spec says Fame-gated, no exact number given
const VIP_ENTRY_ENERGY = 10;
const VIP_ENTRY_HP_COST = 5; // spec: "guaranteed HP damage", flat per entry

// The zone unlocks for the rest of the current Private Life phase once
// asked in — same clock as every other once-per-phase activity below.
const LOUNGE_VIP_ZONE: BlockedZone = {
  nx0: 0.6,
  ny0: 0,
  nx1: 1,
  ny1: 0.42,
  isAllowed: () => hasUsedThisPhase("vip-bouncer"),
  label: "VIP",
};

function openVipBouncerMenu() {
  locationMenu.open(() => {
    const used = hasUsedThisPhase("vip-bouncer");
    const meetsFame = playerState.fame >= VIP_FAME_REQUIREMENT;
    return {
      title: "🕴️ VIP Bouncer",
      energyText: `Fame: ${playerState.fame}/${VIP_FAME_REQUIREMENT}  ·  Energy: ${energy.remaining}/100`,
      actions: [
        {
          id: "ask-in",
          label: "Ask to Enter VIP",
          cost: VIP_ENTRY_ENERGY,
          costLabel: used ? "DONE" : meetsFame ? `${VIP_ENTRY_ENERGY} EN` : "LOCKED",
          disabled: used || !meetsFame,
          run: () => {
            if (used) return "Already done this Private Life phase.";
            if (!meetsFame) {
              return `"Not without more Fame." Need ${VIP_FAME_REQUIREMENT} (have ${playerState.fame}).`;
            }
            if (!energy.spend(VIP_ENTRY_ENERGY)) return "Not enough energy.";
            playerState.hp -= VIP_ENTRY_HP_COST;
            markUsedThisPhase("vip-bouncer");
            return `"Go on in." HP -${VIP_ENTRY_HP_COST} (now ${playerState.hp}).`;
          },
        },
      ],
    };
  });
}

const BAR_DRINK = { energyCost: 10, hpCost: 3 };
const BAR_ROUND = { energyCost: 20, hpCost: 5, imageGain: 3 };

function openBarMenu() {
  locationMenu.open(() => {
    const drinkUsed = hasUsedThisPhase("bar-drink");
    const roundUsed = hasUsedThisPhase("bar-round");
    return {
      title: "🍸 Bar",
      energyText: `Energy: ${energy.remaining}/100  ·  HP: ${playerState.hp}  ·  Image: ${playerState.image}`,
      actions: [
        {
          id: "drink",
          label: "Take a Drink",
          cost: BAR_DRINK.energyCost,
          costLabel: drinkUsed ? "DONE" : `${BAR_DRINK.energyCost} EN`,
          disabled: drinkUsed,
          run: () => {
            if (!energy.spend(BAR_DRINK.energyCost)) return "Not enough energy for a drink.";
            if (playerState.hp < BAR_DRINK.hpCost) return "Not enough HP for a drink.";
            playerState.hp -= BAR_DRINK.hpCost;
            markUsedThisPhase("bar-drink");
            return `HP -${BAR_DRINK.hpCost} (now ${playerState.hp}).`;
          },
        },
        {
          id: "round",
          label: "Buy a Round",
          cost: BAR_ROUND.energyCost,
          costLabel: roundUsed ? "DONE" : `${BAR_ROUND.energyCost} EN`,
          disabled: roundUsed,
          run: () => {
            if (!energy.spend(BAR_ROUND.energyCost)) return "Not enough energy to buy a round.";
            if (playerState.hp < BAR_ROUND.hpCost) return "Not enough HP to buy a round.";
            playerState.hp -= BAR_ROUND.hpCost;
            playerState.image += BAR_ROUND.imageGain;
            markUsedThisPhase("bar-round");
            return `Image +${BAR_ROUND.imageGain}, HP -${BAR_ROUND.hpCost} (now Image ${playerState.image}, HP ${playerState.hp}).`;
          },
        },
      ],
    };
  });
}

const VIP_BOTTLE = { energyCost: 30, hpCost: 8, fameGain: 6 };

function openBottleMenu() {
  locationMenu.open(() => {
    const used = hasUsedThisPhase("bottle");
    return {
    title: "🍾 Buy a Bottle",
    energyText: `Energy: ${energy.remaining}/100  ·  HP: ${playerState.hp}  ·  Fame: ${playerState.fame}`,
    actions: [
      {
        id: "bottle",
        label: "Buy a Bottle",
        cost: VIP_BOTTLE.energyCost,
        costLabel: used ? "DONE" : `${VIP_BOTTLE.energyCost} EN`,
        disabled: used,
        run: () => {
          if (used) return "Already done this Private Life phase.";
          if (!energy.spend(VIP_BOTTLE.energyCost)) return "Not enough energy for a bottle.";
          if (playerState.hp < VIP_BOTTLE.hpCost) return "Not enough HP for a bottle.";
          playerState.hp -= VIP_BOTTLE.hpCost;
          playerState.fame += VIP_BOTTLE.fameGain;
          markUsedThisPhase("bottle");
          return `Fame +${VIP_BOTTLE.fameGain}, HP -${VIP_BOTTLE.hpCost} (now Fame ${playerState.fame}, HP ${playerState.hp}).`;
        },
      },
    ],
    };
  });
}

interface PressFormat {
  name: string;
  icon: string;
  energyCost: number;
  hpCost: number;
  professional: { fame: number; image: number };
  confrontational: { fame: number; image: number };
}
const PRESS_FORMATS: Record<"podcast" | "tv", PressFormat> = {
  podcast: {
    name: "Podcast",
    icon: "🎙️",
    energyCost: 15,
    hpCost: 5,
    professional: { fame: 2, image: 2 },
    confrontational: { fame: 5, image: -3 },
  },
  tv: {
    name: "TV Interview",
    icon: "📺",
    energyCost: 20,
    hpCost: 7,
    professional: { fame: 3, image: 3 },
    confrontational: { fame: 7, image: -4 },
  },
};

type PressReceptionView = "main" | "podcast" | "tv";
let pressReceptionView: PressReceptionView = "main";

function buildPressChoiceMenu(kind: "podcast" | "tv"): MenuData {
  const fmt = PRESS_FORMATS[kind];
  const runTone = (tone: "professional" | "confrontational") => () => {
    if (!energy.spend(fmt.energyCost)) return `Not enough energy for a ${fmt.name.toLowerCase()}.`;
    if (playerState.hp < fmt.hpCost) return "Not enough HP.";
    playerState.hp -= fmt.hpCost;
    const { fame, image } = fmt[tone];
    playerState.fame += fame;
    playerState.image += image;
    markUsedThisPhase(`press-${kind}`);
    return `Fame +${fame}, Image ${image >= 0 ? "+" : ""}${image}, HP -${fmt.hpCost}.`;
  };
  return {
    title: `${fmt.icon} ${fmt.name}`,
    energyText: `Energy: ${energy.remaining}/100  ·  HP: ${playerState.hp}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          pressReceptionView = "main";
          return "";
        },
      },
      { id: "professional", label: "Professional", cost: fmt.energyCost, run: runTone("professional") },
      { id: "confrontational", label: "Confrontational", cost: fmt.energyCost, run: runTone("confrontational") },
    ],
  };
}

function buildPressReceptionMenu(): MenuData {
  if (pressReceptionView === "podcast") return buildPressChoiceMenu("podcast");
  if (pressReceptionView === "tv") return buildPressChoiceMenu("tv");
  const podcastUsed = hasUsedThisPhase("press-podcast");
  const tvUsed = hasUsedThisPhase("press-tv");
  return {
    title: "🗞️ Press Reception",
    energyText: `Energy: ${energy.remaining}/100  ·  HP: ${playerState.hp}`,
    actions: [
      {
        id: "podcast",
        label: `${PRESS_FORMATS.podcast.icon} Podcast`,
        cost: 0,
        costLabel: podcastUsed ? "DONE" : "›",
        disabled: podcastUsed,
        run: () => {
          pressReceptionView = "podcast";
          return "";
        },
      },
      {
        id: "tv",
        label: `${PRESS_FORMATS.tv.icon} TV Interview`,
        cost: 0,
        costLabel: tvUsed ? "DONE" : "›",
        disabled: tvUsed,
        run: () => {
          pressReceptionView = "tv";
          return "";
        },
      },
    ],
  };
}

function openPressReceptionMenu() {
  pressReceptionView = "main";
  locationMenu.open(buildPressReceptionMenu);
}

function openSunbatheMenu() {
  locationMenu.open(() => {
    const used = hasUsedThisPhase("sunbathe");
    return {
      title: "☀️ Sunbathe",
      energyText: `Energy: ${energy.remaining}/100  ·  Image: ${playerState.image}`,
      actions: [
        {
          id: "sunbathe",
          label: "Sunbathe",
          cost: 10,
          costLabel: used ? "DONE" : "10 EN",
          disabled: used,
          run: () => {
            if (used) return "Already done this Private Life phase.";
            if (!energy.spend(10)) return "Not enough energy to sunbathe.";
            playerState.image += 3;
            markUsedThisPhase("sunbathe");
            return `Image +3 (now ${playerState.image}).`;
          },
        },
      ],
    };
  });
}

function openSwimMenu() {
  locationMenu.open(() => {
    const used = hasUsedThisPhase("swim");
    return {
      title: "🌊 Swim",
      energyText: `Energy: ${energy.remaining}/100  ·  HP: ${playerState.hp}`,
      actions: [
        {
          id: "swim",
          label: "Swim",
          cost: 10,
          costLabel: used ? "DONE" : "10 EN",
          disabled: used,
          run: () => {
            if (used) return "Already done this Private Life phase.";
            if (!energy.spend(10)) return "Not enough energy to swim.";
            playerState.hp += 3;
            markUsedThisPhase("swim");
            return `A little stamina boost. HP +3 (now ${playerState.hp}).`;
          },
        },
      ],
    };
  });
}

// Office reception (Section 5): each staff role (and each gym section) is
// already at Lvl 1 for free; Lvl 2/3 cost money. Manager level additionally
// gates which Office elevator floors are reachable.
interface StaffRole {
  id: "manager" | "coach" | "cutman";
  name: string;
  icon: string;
  prices: [number, number]; // price to reach Lvl 2, Lvl 3
}
const STAFF_ROLES: StaffRole[] = [
  { id: "manager", name: "Manager", icon: "💼", prices: [2000, 5000] },
  { id: "coach", name: "Coach", icon: "🥊", prices: [2000, 5000] },
  { id: "cutman", name: "Cutman", icon: "🩹", prices: [1500, 4000] },
];

function getStaffLevel(role: StaffRole["id"]): number {
  if (role === "manager") return playerState.managerLevel;
  if (role === "coach") return playerState.coachLevel;
  return playerState.cutmanLevel;
}

function setStaffLevel(role: StaffRole["id"], level: number) {
  if (role === "manager") {
    playerState.managerLevel = level;
    // Managers are added to Contacts the moment they're hired — no
    // Exchange Number needed for any of them — and stay there permanently
    // even after the player later switches to a different manager tier
    // (this only ever sets the flag true, never clears it).
    const managerNpc = OFFICE_FLOOR_MANAGER[level];
    if (managerNpc) playerState.exchangedNumbers[managerNpc.id] = true;
  } else if (role === "coach") playerState.coachLevel = level;
  else playerState.cutmanLevel = level;
}

interface GymCategory {
  id: keyof GymLevels;
  name: string;
  icon: string;
  prices: [number, number]; // price to reach Lvl 2, Lvl 3
}
const GYM_CATEGORIES: GymCategory[] = [
  { id: "weightArea", name: "Weight Area", icon: "🏋️", prices: [3000, 7000] },
  { id: "power", name: "Power", icon: "👊", prices: [3000, 7000] },
  { id: "speed", name: "Speed", icon: "⚡", prices: [3000, 7000] },
  { id: "endurance", name: "Endurance", icon: "🫁", prices: [3000, 7000] },
];

// Office is a multi-room building: Lobby (Reception + Elevator) -> Floor
// 1-3 (each floor's manager's office). Floor rooms reuse InteriorScene like
// any other room, but have no ground-level door — entered/exited only via
// their own "elevator" station, back down to the Lobby (see hasDoor: false
// on their InteriorScene construction, and the elevator-floor dispatch
// below). Station/decoration layout is generated by buildOfficeFloorRoom,
// defined further down after the floor NPCs themselves (Vinnie, Angela,
// Marcus, and their secretaries/assistants).

const CASH_ADVANCE_AMOUNT = 20000; // placeholder — deducted from the purse once the Fight/Promotion economy exists
const PORTFOLIO_INVEST_AMOUNT = 5000; // placeholder — returns arrive once a real investment system exists

interface SponsorshipDeal {
  id: string;
  name: string;
  perFightPayout: number; // paid out per completed fight while the contract is active
  contractFights: number; // deal length, in fights
}
const SPONSORSHIP_DEALS: SponsorshipDeal[] = [
  { id: "local-gym", name: "Local Gym Co-Sponsor", perFightPayout: 500, contractFights: 3 },
  { id: "sportswear", name: "Sportswear Brand", perFightPayout: 1500, contractFights: 5 },
  { id: "energy-drink", name: "Energy Drink Co.", perFightPayout: 3000, contractFights: 8 },
];

type ManagerDeskView =
  | "main"
  | "sponsorships"
  | "team"
  | "team-staff"
  | "team-staff-role"
  | "team-gym"
  | "team-gym-category"
  | "pr";
let managerDeskView: ManagerDeskView = "main";
let managerActiveStaffRole: StaffRole["id"] | null = null;
let managerActiveGymCategory: GymCategory["id"] | null = null;

function buildManagerDeskMenu(floor: number): MenuData {
  if (managerDeskView === "sponsorships") return buildSponsorshipsMenu();
  if (managerDeskView === "team") return buildTeamFacilitiesMenu();
  if (managerDeskView === "team-staff") {
    // Manager isn't offered here — hiring/promoting him stays at Reception
    // (see buildReceptionMenu), since he's what unlocks Office elevator
    // floor access in the first place.
    return buildStaffListMenu(
      STAFF_ROLES.filter((r) => r.id !== "manager"),
      (id) => {
        managerActiveStaffRole = id;
        managerDeskView = "team-staff-role";
      },
      () => {
        managerDeskView = "team";
      },
    );
  }
  if (managerDeskView === "team-staff-role" && managerActiveStaffRole) {
    return buildStaffRoleMenu(managerActiveStaffRole, () => {
      managerDeskView = "team-staff";
    });
  }
  if (managerDeskView === "team-gym") {
    return buildGymListMenu(
      (id) => {
        managerActiveGymCategory = id;
        managerDeskView = "team-gym-category";
      },
      () => {
        managerDeskView = "team";
      },
    );
  }
  if (managerDeskView === "team-gym-category" && managerActiveGymCategory) {
    return buildGymCategoryMenu(managerActiveGymCategory, () => {
      managerDeskView = "team-gym";
    });
  }
  if (managerDeskView === "pr") return buildPrFinanceMenu(floor);

  const actions: MenuData["actions"] = [
    {
      id: "set-next-fight",
      label: "Set Next Fight",
      cost: 100,
      costLabel: playerState.fightScheduled ? "SCHEDULED" : "100 EN",
      disabled: playerState.fightScheduled,
      run: () => {
        if (playerState.fightScheduled) return "You already have a fight scheduled.";
        if (!energy.spend(100)) return "Not enough energy to schedule a fight.";
        playerState.fightScheduled = true;
        return "Fight scheduled! Sleep to begin your training camp.";
      },
    },
    {
      id: "team",
      label: "Team & Facilities",
      cost: 0,
      costLabel: "›",
      run: () => {
        managerDeskView = "team";
        return "";
      },
    },
    {
      id: "pr-finance",
      label: "PR & Finance",
      cost: 0,
      costLabel: "›",
      run: () => {
        managerDeskView = "pr";
        return "";
      },
    },
    {
      id: "sponsorships",
      label: "Sponsorships",
      cost: 0,
      costLabel: "›",
      run: () => {
        managerDeskView = "sponsorships";
        return "";
      },
    },
  ];

  return {
    title: `🗄️ Manager Desk — Lvl ${floor}`,
    energyText: `Energy: ${energy.remaining}/100  ·  Money: $${playerState.money}`,
    actions,
  };
}

function buildTeamFacilitiesMenu(): MenuData {
  return {
    title: "🧰 Team & Facilities",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          managerDeskView = "main";
          return "";
        },
      },
      {
        id: "hire-staff",
        label: "Hire Staff",
        cost: 0,
        costLabel: "›",
        run: () => {
          managerDeskView = "team-staff";
          return "";
        },
      },
      {
        id: "upgrade-gym",
        label: "Upgrade Gym",
        cost: 0,
        costLabel: "›",
        run: () => {
          managerDeskView = "team-gym";
          return "";
        },
      },
    ],
  };
}

function buildPrFinanceMenu(floor: number): MenuData {
  const actions: MenuData["actions"] = [
    {
      id: "back",
      label: "‹ Back",
      cost: 0,
      costLabel: "",
      run: () => {
        managerDeskView = "main";
        return "";
      },
    },
    {
      id: "cash-advance",
      label: "Request Cash Advance",
      cost: 0,
      costLabel: !playerState.fightScheduled
        ? "NEED FIGHT"
        : playerState.cashAdvanceTaken
          ? "TAKEN"
          : `+$${CASH_ADVANCE_AMOUNT}`,
      disabled: !playerState.fightScheduled || playerState.cashAdvanceTaken,
      run: () => {
        if (!playerState.fightScheduled) return "Schedule a fight first.";
        if (playerState.cashAdvanceTaken) return "You've already taken an advance against this fight's purse.";
        playerState.money += CASH_ADVANCE_AMOUNT;
        playerState.cashAdvanceTaken = true;
        return `Advance granted: +$${CASH_ADVANCE_AMOUNT} (comes out of your purse after the fight).`;
      },
    },
    {
      id: "media-training",
      label: "Media Training",
      cost: 10,
      costLabel: requirePrivateLifePhase() ? "LOCKED" : hasUsedThisPhase("media-training") ? "DONE" : "10 EN",
      disabled: !!requirePrivateLifePhase() || hasUsedThisPhase("media-training"),
      run: () => {
        const lock = requirePrivateLifePhase();
        if (lock) return lock;
        if (!energy.spend(10)) return "Not enough energy for media training.";
        playerState.image += 2;
        markUsedThisPhase("media-training");
        return `Image +2 (now ${playerState.image}).`;
      },
    },
    {
      id: "charity-event",
      label: "Charity Event",
      cost: 15,
      costLabel: requirePrivateLifePhase() ? "LOCKED" : hasUsedThisPhase("charity-event") ? "DONE" : "15 EN",
      disabled: !!requirePrivateLifePhase() || hasUsedThisPhase("charity-event"),
      run: () => {
        const lock = requirePrivateLifePhase();
        if (lock) return lock;
        if (!energy.spend(15)) return "Not enough energy for a charity event.";
        if (playerState.hp < 5) return "Not enough HP for a charity event.";
        playerState.hp -= 5;
        playerState.image += 5;
        markUsedThisPhase("charity-event");
        return `Image +5 (now ${playerState.image}), HP -5 (now ${playerState.hp}).`;
      },
    },
  ];

  // Manager Lvl 2+ desk option.
  if (floor >= 2) {
    actions.push({
      id: "invest-portfolio",
      label: "Invest in Portfolio",
      cost: 0,
      costLabel: `-$${PORTFOLIO_INVEST_AMOUNT}`,
      disabled: playerState.money < PORTFOLIO_INVEST_AMOUNT,
      run: () => {
        if (playerState.money < PORTFOLIO_INVEST_AMOUNT) {
          return `Not enough money — need $${PORTFOLIO_INVEST_AMOUNT}, have $${playerState.money}.`;
        }
        playerState.money -= PORTFOLIO_INVEST_AMOUNT;
        playerState.portfolioInvested += PORTFOLIO_INVEST_AMOUNT;
        return `Invested $${PORTFOLIO_INVEST_AMOUNT} (total $${playerState.portfolioInvested}). Returns arrive once a real investment system exists.`;
      },
    });
  }

  // Manager Lvl 3 desk option.
  if (floor >= 3) {
    actions.push({
      id: "networking-event",
      label: "Networking Event",
      cost: 20,
      costLabel: requirePrivateLifePhase() ? "LOCKED" : hasUsedThisPhase("networking-event") ? "DONE" : "20 EN",
      disabled: !!requirePrivateLifePhase() || hasUsedThisPhase("networking-event"),
      run: () => {
        const lock = requirePrivateLifePhase();
        if (lock) return lock;
        if (!energy.spend(20)) return "Not enough energy for a networking event.";
        if (playerState.hp < 8) return "Not enough HP for a networking event.";
        playerState.hp -= 8;
        playerState.fame += 5;
        markUsedThisPhase("networking-event");
        return `Fame +5 (now ${playerState.fame}), HP -8 (now ${playerState.hp}).`;
      },
    });
  }

  return {
    title: "📣 PR & Finance",
    energyText: `Energy: ${energy.remaining}/100  ·  Money: $${playerState.money}`,
    actions,
  };
}

function buildSponsorshipsMenu(): MenuData {
  return {
    title: "🤝 Sponsorships",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          managerDeskView = "main";
          return "";
        },
      },
      ...SPONSORSHIP_DEALS.map((deal) => {
        const running = playerState.sponsorships.find((s) => s.dealId === deal.id);
        return {
          id: `sponsor-${deal.id}`,
          label: `${deal.name} — $${deal.perFightPayout}/fight × ${deal.contractFights}`,
          cost: 0,
          costLabel: running ? `${running.fightsRemaining} LEFT` : "SIGN",
          disabled: !!running,
          run: () => {
            if (running) return `${deal.name} is already running.`;
            playerState.sponsorships.push({ dealId: deal.id, fightsRemaining: deal.contractFights });
            return `Signed with ${deal.name}! $${deal.perFightPayout}/fight for the next ${deal.contractFights} fights.`;
          },
        };
      }),
    ],
  };
}

function openManagerDeskMenu(floor: number) {
  managerDeskView = "main";
  managerActiveStaffRole = null;
  managerActiveGymCategory = null;
  locationMenu.open(() => buildManagerDeskMenu(floor));
}

// Reception now only handles hiring/promoting the Manager himself — Coach
// and Cutman hiring moved to the Manager Desk's Team & Facilities menu
// (see buildTeamFacilitiesMenu) since only the Manager gates Office
// elevator floor access (see openElevatorMenu), so he's the one thing that
// has to stay reachable before a Manager Desk even exists to visit.
type ReceptionView = "main" | "manager";
let receptionView: ReceptionView = "main";

function buildReceptionMenu(): MenuData {
  if (receptionView === "manager") {
    return buildStaffRoleMenu("manager", () => {
      receptionView = "main";
    });
  }
  return {
    title: "🛎️ Reception",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "hire-manager",
        label: `💼 Hire Manager (Lvl ${playerState.managerLevel}/3)`,
        cost: 0,
        costLabel: "›",
        run: () => {
          receptionView = "manager";
          return "";
        },
      },
    ],
  };
}

// Shared by Reception (Manager only) and the Manager Desk's Team &
// Facilities menu (Coach/Cutman) — which roles are offered and where
// "Back" lands are both left to the caller.
function buildStaffListMenu(
  roles: StaffRole[],
  onSelectRole: (id: StaffRole["id"]) => void,
  onBack: () => void,
): MenuData {
  return {
    title: "👥 Hire Staff",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          onBack();
          return "";
        },
      },
      ...roles.map((role) => ({
        id: `role-${role.id}`,
        label: `${role.icon} ${role.name} (Lvl ${getStaffLevel(role.id)}/3)`,
        cost: 0,
        costLabel: "›",
        run: () => {
          onSelectRole(role.id);
          return "";
        },
      })),
    ],
  };
}

function buildStaffRoleMenu(roleId: StaffRole["id"], onBack: () => void): MenuData {
  const role = STAFF_ROLES.find((r) => r.id === roleId)!;
  // The Manager is exclusive — only one tier is on staff at a time, and
  // hiring a different one replaces him, locking the Office elevator floor
  // that matched his old tier until he's hired again (see openElevatorMenu).
  // Coach/Cutman are cumulative — once hired, a tier stays unlocked.
  const exclusive = role.id === "manager";
  return {
    title: `${role.icon} ${role.name}`,
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          onBack();
          return "";
        },
      },
      ...[1, 2, 3].map((level) => {
        const current = getStaffLevel(role.id);
        const owned = exclusive ? current === level : current >= level;
        const price = level === 1 ? 0 : role.prices[level - 2];
        return {
          id: `${role.id}-lvl${level}`,
          label: `${role.name} Lvl ${level}`,
          cost: 0,
          costLabel: owned ? (exclusive ? "ACTIVE" : "HIRED") : `$${price}`,
          disabled: owned,
          run: () => {
            if (owned) return `${role.name} Lvl ${level} already ${exclusive ? "active" : "hired"}.`;
            if (playerState.money < price) {
              return `Not enough money — need $${price}, have $${playerState.money}.`;
            }
            playerState.money -= price;
            setStaffLevel(role.id, level);
            return exclusive
              ? `${role.name} Lvl ${level} is now on staff.`
              : `${role.name} promoted to Lvl ${level}!`;
          },
        };
      }),
    ],
  };
}

// Shared by the Manager Desk's Team & Facilities menu — Upgrade Gym no
// longer lives at Reception.
function buildGymListMenu(onSelectCategory: (id: GymCategory["id"]) => void, onBack: () => void): MenuData {
  return {
    title: "🏋️ Upgrade Gym",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          onBack();
          return "";
        },
      },
      ...GYM_CATEGORIES.map((cat) => ({
        id: `cat-${cat.id}`,
        label: `${cat.icon} ${cat.name} (Lvl ${playerState.gymLevels[cat.id]}/3)`,
        cost: 0,
        costLabel: "›",
        run: () => {
          onSelectCategory(cat.id);
          return "";
        },
      })),
    ],
  };
}

function buildGymCategoryMenu(catId: GymCategory["id"], onBack: () => void): MenuData {
  const cat = GYM_CATEGORIES.find((c) => c.id === catId)!;
  return {
    title: `${cat.icon} ${cat.name}`,
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          onBack();
          return "";
        },
      },
      ...[1, 2, 3].map((level) => {
        const current = playerState.gymLevels[cat.id];
        const owned = current >= level;
        const price = level === 1 ? 0 : cat.prices[level - 2];
        return {
          id: `${cat.id}-lvl${level}`,
          label: `${cat.name} Lvl ${level}`,
          cost: 0,
          costLabel: owned ? "OWNED" : `$${price}`,
          disabled: owned,
          run: () => {
            if (owned) return `${cat.name} Lvl ${level} already owned.`;
            if (playerState.money < price) {
              return `Not enough money — need $${price}, have $${playerState.money}.`;
            }
            playerState.money -= price;
            playerState.gymLevels[cat.id] = level;
            return `${cat.name} upgraded to Lvl ${level}!`;
          },
        };
      }),
    ],
  };
}

// NPC Dialogue system (NPC Dialogue & Office Reception spec): a reusable
// engine, first wired up here for Office's two receptionists. Relationship
// score lives in playerState.contacts, keyed by NPC id.

// Mall Item Catalogues spec: delta/rules live in the shared engine
// (game/npc.ts's getGiftReactionTone/getGiftReactionDelta) — each NPC's
// own giftReaction just supplies her flavor text per tone, matching her
// GiftPreferences (favorite general category, Special Jewelry ranking,
// and for romance-eligible NPCs, her favorite/disliked Romantic item). A
// tone this NPC can never actually reach (e.g. Romantic for a friend-only
// NPC, since Romantic items are filtered out of her gift picker) doesn't
// need an entry — falls back to a generic line instead.
function buildGiftResult(
  prefs: GiftPreferences,
  category: GiftCategory,
  itemId: string,
  tier: RelationshipTier,
  messages: Partial<Record<GiftReactionTone, string>>,
): GiftResult {
  const tone = getGiftReactionTone(prefs, category, itemId, tier);
  return { delta: getGiftReactionDelta(tone), message: messages[tone] ?? "Thanks for this." };
}

const EXCHANGE_NUMBER_COST = 30;
const GIVE_GIFT_COST = 10;
const ASK_HER_OUT_COST = 20; // not given an explicit number in the spec's Actions list — placeholder
const PROPOSE_COST = 20; // same placeholder logic as Ask Her Out
// "Invite to Next Fight" — same placeholder logic, once per NPC per
// scheduled fight (see playerState.fightInvites).
const INVITE_TO_FIGHT_COST = 15;
const INVITE_TO_FIGHT_DELTA = 10;
// "Meaningful relationship progress within Tier 3" (spec) — not just
// entering Friend tier (score 50) — placeholder threshold, easy to retune.
const PRIYA_EXCHANGE_THRESHOLD = 70;
// Romance meter threshold for Ask Her Out to succeed — spec's own
// placeholder value, "will be retuned once real gameplay testing begins."
const PRIYA_ROMANCE_THRESHOLD = 5;
// Marriage System (placeholders, same "retune after playtesting" spirit):
// needs real Dates elsewhere, Close-tier Relationship, and a higher
// Romance bar than Ask Her Out required.
const PRIYA_PROPOSE_DATE_THRESHOLD = 4;
const PRIYA_PROPOSE_RELATIONSHIP_THRESHOLD = 90; // Close tier
const PRIYA_PROPOSE_ROMANCE_THRESHOLD = 15;
const PRIYA_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "practical",
  favoriteRomanticItemId: "necklace",
  dislikedRomanticItemId: "chocolates",
  specialJewelryRanking: ["custom-jewelry", "diamond-earrings", "luxury-watch"],
};

const PRIYA_ACTIONS: NpcActionRules = {
  exchangeNumber: (tier, score) => {
    if (tier === "stranger" || tier === "acquaintance") {
      return { success: false, delta: -5, message: 'She gives you a flat look. "Absolutely not."' };
    }
    if (tier === "friend" && score < PRIYA_EXCHANGE_THRESHOLD) {
      return { success: false, delta: -5, message: '"We\'re not there yet."' };
    }
    return { success: true, delta: 10, message: "She actually smiles and hands over her number." };
  },
  giftReaction: (tier, category, itemId) => {
    if (tier === "stranger" || tier === "acquaintance") {
      return { delta: -5, message: "She declines politely but firmly." };
    }
    return buildGiftResult(PRIYA_GIFT_PREFS, category, itemId, tier, {
      "romantic-favorite": '"...A necklace." She touches it, quietly thrown. "You paid attention."',
      "romantic-baseline": "She's genuinely touched.",
      "romantic-disliked": '"Chocolates. That\'s sweet." She smiles, though it doesn\'t quite reach her eyes.',
      "jewelry-rank1": '"...This is genuinely beautiful." For once, she\'s at a loss for words.',
      "jewelry-rank2": '"...This is a lot." She\'s stunned, in a good way.',
      "jewelry-rank3": '"It\'s lovely, thank you." Composed, but pleased.',
      "category-match": "Exactly her kind of practical — she's delighted.",
      "category-mismatch-neutral": '"Thanks." She sets it aside without much fuss.',
    });
  },
  askHerOut: (romanceScore) => {
    if (romanceScore >= PRIYA_ROMANCE_THRESHOLD) {
      return { success: true, message: "She smiles. \"Yeah — I'd like that.\"" };
    }
    return { success: false, message: '"...I don\'t think we\'re there yet."' };
  },
  propose: (relationshipScore, romanceScore, dateCount) => {
    if (
      dateCount >= PRIYA_PROPOSE_DATE_THRESHOLD &&
      relationshipScore >= PRIYA_PROPOSE_RELATIONSHIP_THRESHOLD &&
      romanceScore >= PRIYA_PROPOSE_ROMANCE_THRESHOLD
    ) {
      return { success: true, message: 'Her eyes well up. "...Yes. Yes, okay — yes."' };
    }
    return { success: false, message: '"...Too soon."' };
  },
};

const PRIYA: NpcDef = {
  id: "priya",
  name: "Priya Malhotra",
  portrait: PRIYA_PORTRAIT,
  romanceEligible: true,
  greetings: {
    stranger:
      "Welcome to the Meridian Business Park. I'm Priya Malhotra — I run the front desk here. If you're heading up to see one of the managers, I can point you to the elevator.",
    acquaintance: "Back again? Elevator's the same as always, in case you forgot.",
    friend: "Hey — good to see you. What's going on?",
    close: "There you are. I was hoping you'd stop by.",
  },
  smallTalkTopics: [
    {
      id: "weather",
      label: "Weather",
      ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" },
    },
    {
      id: "gossip",
      label: "Boxing World Gossip",
      ratingByTier: { stranger: "negative", acquaintance: "negative", friend: "positive", close: "positive" },
    },
    {
      id: "office",
      label: "The Office",
      ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" },
    },
    {
      id: "ask-day",
      label: "Ask About Her Day",
      ratingByTier: { stranger: "negative", acquaintance: "neutral", friend: "positive", close: "positive" },
    },
  ],
  personalTopics: [
    {
      id: "family",
      label: "Family",
      ratingByTier: { acquaintance: "negative", friend: "positive", close: "positive" },
      special: "family-reveal",
    },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    {
      id: "weekend",
      label: "Weekend Plans",
      ratingByTier: { acquaintance: "neutral", friend: "positive", close: "positive" },
    },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "neutral", close: "positive" } },
    { id: "vent", label: "Vent", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "check-in", label: "Check In On Her", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [
    { id: "looks", label: "Looks", ratingByTier: { friend: "negative", close: "positive" } },
    { id: "style", label: "Style", ratingByTier: { friend: "neutral", close: "positive" } },
    { id: "personality", label: "Personality", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "competence", label: "Competence", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyCharmTopics: [
    { id: "tease", label: "Playful Tease", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "bold-move", label: "Make a Bold Move", ratingByTier: { friend: "neutral", close: "positive" } },
    { id: "show-off", label: "Show Off", ratingByTier: { friend: "negative", close: "negative" } },
    { id: "line", label: "Drop a Line", ratingByTier: { friend: "negative", close: "neutral" } },
  ],
  actions: PRIYA_ACTIONS,
  // Requires BOTH 2 successful Dates elsewhere AND Tier 4 (Close) — date
  // count alone or tier alone isn't enough.
  homeDateUnlock: (dateCount, tier) => dateCount >= 2 && tier === "close",
  // Marriage System: no kids yet, wants just one — placeholder numbers,
  // easy to retune. Matches the Family topic's own rating map above
  // (reluctant at Acquaintance, opens up at Friend+).
  familyInfo: { kidsHas: 0, kidsWants: 1, revealTier: "friend" },
};

const CAROL_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "fun",
  specialJewelryRanking: ["custom-jewelry", "diamond-earrings", "luxury-watch"],
};

const CAROL_ACTIONS: NpcActionRules = {
  // Unlike Priya, succeeds starting at Acquaintance (T2) — no internal
  // sub-threshold, matching her simple/straightforward nature.
  exchangeNumber: (tier) => {
    if (tier === "stranger") {
      return { success: false, delta: -5, message: '"Oh — maybe once we know each other a bit better!"' };
    }
    return { success: true, delta: 10, message: "She beams and jots her number down without a second thought." };
  },
  // Well-received from Tier 1, as long as the item actually suits her —
  // Special Jewelry is the exception, still tier-gated the universal way.
  giftReaction: (tier, category, itemId) =>
    buildGiftResult(CAROL_GIFT_PREFS, category, itemId, tier, {
      "jewelry-rejected": '"Oh — that\'s much too much." She hands it right back, gently but firmly.',
      "jewelry-uncertain": '"Oh! That\'s... really generous." A little unsure what to make of it.',
      "jewelry-rank1": '"Oh my — this is stunning!" She\'s completely lit up.',
      "jewelry-rank2": '"Oh, you shouldn\'t have!" She\'s clearly delighted.',
      "jewelry-rank3": '"That\'s so sweet of you." Warm, if a touch more measured.',
      "category-match": 'She lights up. "Oh, you shouldn\'t have!"',
      "category-mismatch-neutral": '"Oh, thank you." She\'s pleasant about it either way.',
    }),
  // Never actually reachable — Carol isn't romance-eligible, so Ask Her
  // Out/Propose never appear in her Actions menu. Required by NpcActionRules.
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

const CAROL: NpcDef = {
  id: "carol",
  name: "Carol Jenkins",
  portrait: CAROL_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Hi there — welcome in. Let me know if you need anything.",
    acquaintance: "Hey, good to see you again.",
    friend: "Hey! How's it going?",
    close: "Hey you — good to see you.",
  },
  smallTalkTopics: [
    {
      id: "weather",
      label: "Weather",
      ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" },
    },
    {
      id: "gossip",
      label: "Boxing World Gossip",
      ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" },
    },
    {
      id: "office",
      label: "The Office",
      ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" },
    },
    {
      // Her one real dislike — too heavy/serious for her taste.
      id: "events",
      label: "Current Events",
      ratingByTier: { stranger: "negative", acquaintance: "negative", friend: "negative", close: "negative" },
    },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    // She's a genuine film fan.
    { id: "movies", label: "Movies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "positive", close: "positive" } },
    // Warm, but prefers redirecting toward positivity over dwelling on it.
    { id: "vent", label: "Vent", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "check-in", label: "Check In On Her", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: CAROL_ACTIONS,
};

// Same sub-threshold logic as Priya's Exchange Number — placeholder value,
// easy to retune once real gameplay testing begins.
const DEREK_EXCHANGE_THRESHOLD = 70;

const DEREK_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "practical",
  // Grumpy exception (Mall Item Catalogues spec) — unlike most NPCs, a
  // mismatched Fun/Practical gift genuinely annoys him instead of landing
  // as neutral/lower-positive.
  negativeOnCategoryMismatch: true,
  specialJewelryRanking: ["luxury-watch", "custom-jewelry", "diamond-earrings"],
};

const DEREK_ACTIONS: NpcActionRules = {
  // Doesn't hand out his number easily — fails outright before Tier 3,
  // then needs real progress within it too.
  exchangeNumber: (tier, score) => {
    if (tier === "stranger" || tier === "acquaintance") {
      return { success: false, delta: -5, message: '"Why would I give you that."' };
    }
    if (tier === "friend" && score < DEREK_EXCHANGE_THRESHOLD) {
      return { success: false, delta: -5, message: '"Yeah, no."' };
    }
    return { success: true, delta: 10, message: 'He shrugs and rattles off his number. "Whatever."' };
  },
  // Rejected at every tier below Friend.
  giftReaction: (tier, category, itemId) => {
    if (tier === "stranger" || tier === "acquaintance") {
      return { delta: -5, message: '"I don\'t want this." He hands it right back.' };
    }
    return buildGiftResult(DEREK_GIFT_PREFS, category, itemId, tier, {
      "jewelry-rank1": '"...Huh." He actually turns it over in his hands. "This is nice."',
      "jewelry-rank2": '"...Okay. This is actually decent." Almost impressed.',
      "jewelry-rank3": '"...Fine, I guess." Grudging, but not unkind.',
      "category-match": '"...Huh. Actually useful. Thanks."',
      "category-mismatch-negative": '"What am I supposed to do with this." He doesn\'t even pretend to be pleased.',
    });
  },
  // Never actually reachable — Derek isn't romance-eligible, so Ask Her
  // Out/Propose never appear in his Actions menu. Required by NpcActionRules.
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

const DEREK: NpcDef = {
  id: "derek",
  name: "Derek Holloway",
  portrait: DEREK_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "...Yeah?",
    acquaintance: "Oh. It's you again.",
    friend: "Hey. Slow day, as usual.",
    close: "Hey man. Good to see a face that isn't a manager's.",
  },
  smallTalkTopics: [
    // Flat dislikes — never warms, doesn't pretend otherwise.
    { id: "weather", label: "Weather", ratingByTier: { stranger: "negative", acquaintance: "negative", friend: "negative", close: "negative" } },
    { id: "gossip", label: "Boxing World Gossip", ratingByTier: { stranger: "negative", acquaintance: "negative", friend: "negative", close: "negative" } },
    // Loves to vent about it — his one standout positive.
    { id: "office", label: "The Office", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About His Day", ratingByTier: { stranger: "negative", acquaintance: "negative", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "negative", friend: "positive", close: "positive" } },
    // Stays flat — never warms, even close.
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "negative", friend: "neutral", close: "neutral" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "neutral", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "negative", close: "neutral" } },
    // His clear standout — matches his core trait.
    { id: "vent", label: "Vent", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "check-in", label: "Check In On Him", ratingByTier: { friend: "negative", close: "positive" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: DEREK_ACTIONS,
  // Doesn't care enough to show up before Tier 4 — genuinely doesn't give
  // a damn until he actually does.
  inviteToFightMinTier: "close",
};

// Manager NPCs (system spec, corrected): no Exchange Number, no Invite to
// Next Fight (both excluded — number's auto-saved on hire, he's always at
// fights anyway) — but Give a Gift IS available, same as any other NPC.
// exchangeNumber/askHerOut/propose are never actually reachable (no
// romance, and Exchange Number is hidden via hideExchangeNumber), but
// NpcActionRules still requires them.
const VINNIE_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "fun",
  specialJewelryRanking: ["luxury-watch", "diamond-earrings", "custom-jewelry"],
};
const VINNIE_ACTIONS: NpcActionRules = {
  exchangeNumber: () => ({ success: false, delta: 0, message: "" }),
  // Well-received from Tier 2 onward — flashy, appreciative personality.
  giftReaction: (tier, category, itemId) => {
    if (tier === "stranger") {
      return { delta: -5, message: '"Whoa, hey — we just met!" He waves it off, laughing.' };
    }
    return buildGiftResult(VINNIE_GIFT_PREFS, category, itemId, tier, {
      "jewelry-uncertain": '"Ha, generous! A little early for this, but hey." He\'s flattered anyway.',
      "jewelry-rank1": '"Whoa. Now THAT\'S a piece." He\'s already showing it off.',
      "jewelry-rank2": '"Now we\'re talking!" Genuinely thrilled.',
      "jewelry-rank3": '"Hey, I appreciate that." Pleased, low-key for him.',
      "category-match": '"Now THAT\'S a gift." He\'s grinning ear to ear.',
      "category-mismatch-neutral": '"Hey, appreciate it." Good-natured about it either way.',
    });
  },
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

const VINNIE: NpcDef = {
  id: "vinnie",
  name: "Vinnie Castellano",
  portrait: VINNIE_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Hey hey, come on in! Vinnie Castellano — I handle business on this floor. You're gonna want to hear what I've got.",
    acquaintance: "There he is! What can I do you for?",
    friend: "My guy! Come, sit, sit — what's the word?",
    close: "There's my guy. You know I always got your back.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "gossip", label: "Boxing World Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    // Loves talking up his own hustle.
    { id: "office", label: "The Office", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    // Loves talking about himself, his deals.
    { id: "ask-day", label: "Ask About His Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    // The one place his usual bravado drops — guarded until real trust.
    { id: "family", label: "Family", ratingByTier: { acquaintance: "negative", friend: "positive", close: "positive" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    // Loves flexing his weekend plans.
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  heartToHeartTopics: [
    // Thinks he's great at giving it.
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    // Self-focused, but doesn't dismiss you.
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "neutral", close: "neutral" } },
    // Relates easily, talks a lot himself.
    { id: "vent", label: "Vent", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "check-in", label: "Check In On Him", ratingByTier: { friend: "neutral", close: "neutral" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  // Manager NPC rules: no Exchange Number, no Invite to Next Fight — Give
  // a Gift still applies, so the Actions menu itself stays visible (see
  // VINNIE_ACTIONS).
  actions: VINNIE_ACTIONS,
  hideExchangeNumber: true,
  hideInviteToFight: true,
  managerTier: 1,
};

const ANGELA_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "practical",
  specialJewelryRanking: ["luxury-watch", "custom-jewelry", "diamond-earrings"],
};
const ANGELA_ACTIONS: NpcActionRules = {
  exchangeNumber: () => ({ success: false, delta: 0, message: "" }),
  // Well-received from Tier 2 onward, matching her guarded-but-fair nature.
  giftReaction: (tier, category, itemId) => {
    if (tier === "stranger") {
      return { delta: -5, message: '"That\'s not necessary." Polite, but keeps her distance.' };
    }
    return buildGiftResult(ANGELA_GIFT_PREFS, category, itemId, tier, {
      "jewelry-uncertain": '"That\'s a bit much for where we are." Composed, but taken aback.',
      "jewelry-rank1": '"...This is genuinely beautiful." She\'s quietly moved.',
      "jewelry-rank2": '"This is lovely, thank you." Genuinely pleased.',
      "jewelry-rank3": '"That\'s kind of you." Professional, but appreciative.',
      "category-match": '"This is actually useful. Thank you." Genuinely pleased.',
      "category-mismatch-neutral": '"Thank you." Polite, professional as ever.',
    });
  },
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

const ANGELA: NpcDef = {
  id: "angela",
  name: "Angela Whitfield",
  portrait: ANGELA_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Angela Whitfield. I run things on this floor — let's keep this efficient.",
    acquaintance: "Back again. What do you need?",
    friend: "Good to see you. Come in.",
    close: "Good to see you — really. Come sit.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    // Genuinely invested — it's literally her business.
    { id: "gossip", label: "Boxing World Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    // Professional, doesn't indulge in office chatter.
    { id: "office", label: "The Office", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "ask-day", label: "Ask About Her Day", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    // Private about family until real trust.
    { id: "family", label: "Family", ratingByTier: { acquaintance: "negative", friend: "positive", close: "positive" } },
    // Keeps personal life genuinely separate, even close.
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "negative", friend: "neutral", close: "neutral" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
  ],
  heartToHeartTopics: [
    // Genuinely good at this, real professional skill.
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    // Stays composed, doesn't emotionally engage deeply.
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "neutral", close: "neutral" } },
    // Not her style.
    { id: "vent", label: "Vent", ratingByTier: { friend: "neutral", close: "neutral" } },
    // Only once real trust is fully earned.
    { id: "check-in", label: "Check In On Her", ratingByTier: { friend: "neutral", close: "positive" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: ANGELA_ACTIONS,
  hideExchangeNumber: true,
  hideInviteToFight: true,
  managerTier: 2,
};

const MARCUS_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "fun",
  specialJewelryRanking: ["diamond-earrings", "luxury-watch", "custom-jewelry"],
};
const MARCUS_ACTIONS: NpcActionRules = {
  exchangeNumber: () => ({ success: false, delta: 0, message: "" }),
  // Well-received from Tier 1 — genuinely open, appreciates the gesture
  // without needing to be won over. Special Jewelry is the one exception,
  // still tier-gated the universal way.
  giftReaction: (tier, category, itemId) =>
    buildGiftResult(MARCUS_GIFT_PREFS, category, itemId, tier, {
      "jewelry-rejected": '"Whoa, hold on — way too soon for that." He laughs, waving it off good-naturedly.',
      "jewelry-uncertain": '"That\'s generous of you." Genuinely touched, if a little surprised.',
      "jewelry-rank1": '"Now that is a serious piece." He\'s genuinely impressed.',
      "jewelry-rank2": '"I appreciate that, truly." Warm, easy confidence.',
      "jewelry-rank3": '"That\'s kind of you, man." Gracious, as always.',
      "category-match": '"Now that\'s a gift." Genuinely pleased.',
      "category-mismatch-neutral": '"Appreciate it, man." Gracious about it either way.',
    }),
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

const MARCUS: NpcDef = {
  id: "marcus",
  name: "Marcus Diamond",
  portrait: MARCUS_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Marcus Diamond. Have a seat — let's talk about where this career's headed.",
    acquaintance: "There you are. Good to see you.",
    friend: "My guy! Come on in.",
    close: "There he is. You know my door's always open for you.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "gossip", label: "Boxing World Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    // Comfortable talking about his success, no false modesty.
    { id: "office", label: "The Office", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About His Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    // Matter-of-fact flex, not desperate like Vinnie's.
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  heartToHeartTopics: [
    // His wheelhouse, loves mentoring.
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    // Doesn't take it fully seriously until he really knows you.
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "neutral", close: "positive" } },
    // Not his style, stays neutral.
    { id: "vent", label: "Vent", ratingByTier: { friend: "neutral", close: "neutral" } },
    // Genuinely gracious with his attention.
    { id: "check-in", label: "Check In On Him", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: MARCUS_ACTIONS,
  hideExchangeNumber: true,
  hideInviteToFight: true,
  managerTier: 3,
};

const KYLE_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "fun",
  specialJewelryRanking: ["custom-jewelry", "diamond-earrings", "luxury-watch"],
};

const KYLE_ACTIONS: NpcActionRules = {
  // Easygoing, like Carol — succeeds from Tier 2, no internal sub-threshold.
  exchangeNumber: (tier) => {
    if (tier === "stranger") {
      return { success: false, delta: -5, message: '"Oh — maybe once we know each other a bit better!"' };
    }
    return { success: true, delta: 10, message: 'He beams and rattles off his number. "Anytime! Really!"' };
  },
  // Well-received from Tier 1 — eager to please. Special Jewelry is the
  // exception, still tier-gated the universal way.
  giftReaction: (tier, category, itemId) =>
    buildGiftResult(KYLE_GIFT_PREFS, category, itemId, tier, {
      "jewelry-rejected": '"Oh — this is way too much!" He looks almost panicked handing it back.',
      "jewelry-uncertain": '"Oh! Um — thank you?" Genuinely unsure what to do with it.',
      "jewelry-rank1": '"Wow — this is incredible!" He\'s beaming ear to ear.',
      "jewelry-rank2": '"For me? Wow, thank you so much!" He\'s thrilled.',
      "jewelry-rank3": '"Oh, thank you!" Happy, if a little more subdued.',
      "category-match": '"For me? Wow, thank you so much!" He\'s thrilled.',
      "category-mismatch-neutral": '"Oh — thanks!" He\'s pleased regardless.',
    }),
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

const KYLE: NpcDef = {
  id: "kyle",
  name: "Kyle Bennett",
  portrait: KYLE_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Oh — hi! Kyle Bennett, I keep things running for Angela. Let me know if you need anything!",
    acquaintance: "Hey, good to see you again!",
    friend: "Hey! Great to see you!",
    close: "Hey you! Always happy to see a friendly face around here.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "gossip", label: "Boxing World Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    // Wants to seem professional, doesn't gossip about work.
    { id: "office", label: "The Office", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "ask-day", label: "Ask About His Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    // Genuinely eager to help.
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "positive", close: "positive" } },
    // Happy to just listen.
    { id: "vent", label: "Vent", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "check-in", label: "Check In On Him", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: KYLE_ACTIONS,
  // Eager to be included.
  inviteToFightMinTier: "acquaintance",
};

const MARGARET_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "practical",
  specialJewelryRanking: ["luxury-watch", "custom-jewelry", "diamond-earrings"],
};

const MARGARET_ACTIONS: NpcActionRules = {
  // Guards her personal number much longer than her Gift/Invite openness
  // would suggest — succeeds only from Close (Tier 4).
  exchangeNumber: (tier) => {
    if (tier !== "close") {
      return { success: false, delta: -5, message: '"...Not yet. Ask me again once we know each other better."' };
    }
    return { success: true, delta: 10, message: 'She nods, satisfied. "Alright. You\'ve earned it." She writes it down.' };
  },
  // Well-received from Tier 2 onward.
  giftReaction: (tier, category, itemId) => {
    if (tier === "stranger") {
      return { delta: -5, message: '"Oh, that\'s not necessary." She sets it aside, polite but distant.' };
    }
    return buildGiftResult(MARGARET_GIFT_PREFS, category, itemId, tier, {
      "jewelry-uncertain": '"That\'s... a lot, for where we are." Polite, a little guarded.',
      "jewelry-rank1": '"...Well." She actually pauses. "This is beautiful."',
      "jewelry-rank2": '"Aren\'t you generous." Genuinely pleased, dry wit intact.',
      "jewelry-rank3": '"That\'s kind of you." Composed, appreciative.',
      "category-match": '"Well, aren\'t you thoughtful." She\'s genuinely pleased — practical, just like her.',
      "category-mismatch-neutral": '"That\'s kind of you." Polite, if a little bemused.',
    });
  },
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

const MARGARET: NpcDef = {
  id: "margaret",
  name: "Margaret Sinclair",
  portrait: MARGARET_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Margaret Sinclair. I keep this floor running for Marcus. What can I do for you?",
    acquaintance: "Back again. Good.",
    friend: "There you are. Come on in.",
    close: "There you are, dear. Sit — tell me what's going on.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    // Decades in the business, genuinely knows and enjoys it.
    { id: "gossip", label: "Boxing World Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    // Real stories and opinions from years there.
    { id: "office", label: "The Office", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    // Guarded with new faces.
    { id: "ask-day", label: "Ask About Her Day", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "negative", friend: "positive", close: "positive" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    // Stays private, not hostile.
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  heartToHeartTopics: [
    // Her wheelhouse, loves sharing hard-earned wisdom.
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    // Real trust takes time.
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "neutral", close: "positive" } },
    // "Seen it all" perspective, doesn't really engage in complaining.
    { id: "vent", label: "Vent", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "check-in", label: "Check In On Her", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: MARGARET_ACTIONS,
  inviteToFightMinTier: "acquaintance",
};

// Ask Her Out threshold, dramatically lower than Priya's 5 — barely any
// buildup needed.
const BIANCA_ROMANCE_THRESHOLD = 1;
// No numbers given for Propose beyond Ask Her Out/Home-Date — placeholders
// in the same "retune after playtesting" spirit as Priya's, just scaled
// down to match her lower-guarded characterization (Close tier still
// required for the Relationship bar since marriage is still a big step,
// but far less Romance buildup needed than Priya's 15).
const BIANCA_PROPOSE_DATE_THRESHOLD = 2;
const BIANCA_PROPOSE_RELATIONSHIP_THRESHOLD = 90; // Close tier
const BIANCA_PROPOSE_ROMANCE_THRESHOLD = 3;

const BIANCA_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "fun",
  favoriteRomanticItemId: "perfume",
  dislikedRomanticItemId: "chocolates",
  specialJewelryRanking: ["diamond-earrings", "luxury-watch", "custom-jewelry"],
};

const BIANCA_ACTIONS: NpcActionRules = {
  exchangeNumber: () => ({ success: true, delta: 10, message: '"Ooh, of course!" She hands over her number without a second thought.' }),
  giftReaction: (tier, category, itemId) =>
    buildGiftResult(BIANCA_GIFT_PREFS, category, itemId, tier, {
      "romantic-favorite": '"...You remembered." She actually looks caught off guard, just for a second.',
      "romantic-baseline": '"You didn\'t have to!" She\'s delighted regardless.',
      "romantic-disliked": '"Chocolates, aw." She smiles, already reaching for one.',
      "jewelry-rejected": '"Whoa, slow down!" She laughs it off, pushing it back gently.',
      "jewelry-uncertain": '"Oh! That\'s... a lot." Flattered, but taken aback.',
      "jewelry-rank1": '"Oh my god." For once, she\'s completely speechless.',
      "jewelry-rank2": '"Oh, wow." For once, she\'s the one at a loss for words.',
      "jewelry-rank3": '"Aw, it\'s gorgeous!" Delighted, plain and simple.',
      "category-match": '"Yes! You get me." She\'s thrilled.',
      "category-mismatch-neutral": '"Aw, thank you!" She\'s delighted regardless.',
    }),
  askHerOut: (romanceScore) => {
    if (romanceScore < BIANCA_ROMANCE_THRESHOLD) {
      return { success: false, message: '"Ha — a little more than that. But I like where your head\'s at."' };
    }
    return { success: true, message: '"Took you long enough." She grins.' };
  },
  propose: (relationshipScore, romanceScore, dateCount) => {
    if (
      dateCount >= BIANCA_PROPOSE_DATE_THRESHOLD &&
      relationshipScore >= BIANCA_PROPOSE_RELATIONSHIP_THRESHOLD &&
      romanceScore >= BIANCA_PROPOSE_ROMANCE_THRESHOLD
    ) {
      return { success: true, message: '"Yes! Yes, obviously yes!" She throws her arms around you.' };
    }
    return { success: false, message: '"...Too soon."' };
  },
};

const BIANCA: NpcDef = {
  id: "bianca",
  name: "Bianca Marchetti",
  portrait: BIANCA_PORTRAIT,
  romanceEligible: true,
  greetings: {
    stranger: "Well hello there. Bianca Marchetti — I keep things moving for Marcus. And who might you be?",
    acquaintance: "Hey you! Good to see you again.",
    friend: "There you are! I was hoping you'd stop by.",
    close: "There's my favorite visitor. Come here.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "gossip", label: "Boxing World Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "office", label: "The Office", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About Her Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    {
      id: "family",
      label: "Family",
      ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" },
      special: "family-reveal",
    },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "vent", label: "Vent", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "check-in", label: "Check In On Her", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [
    // Warm on Looks from the start, unlike Priya's guardedness there.
    { id: "looks", label: "Looks", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "style", label: "Style", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "personality", label: "Personality", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "competence", label: "Competence", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyCharmTopics: [
    { id: "tease", label: "Playful Tease", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "bold-move", label: "Make a Bold Move", ratingByTier: { friend: "positive", close: "positive" } },
    // Warm on Show Off and Drop a Line, unlike Priya's specific dislikes there.
    { id: "show-off", label: "Show Off", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "line", label: "Drop a Line", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  actions: BIANCA_ACTIONS,
  // 0 prior Dates required — available immediately once Dating: true,
  // unlike Priya's "2 Dates + Tier 4" requirement.
  homeDateUnlock: () => true,
  // No guardedness anywhere in her design — Home Dates (Overnight Stay
  // included) count toward Propose same as any other Date. No circularity
  // risk since her Home Date is already unlocked from the start.
  homeDatesCountTowardDates: true,
  familyInfo: { kidsHas: 0, kidsWants: 3, revealTier: "acquaintance" },
};

// --- Mall NPCs (Mall — NPC Dialogue Content spec) ---------------------
// Propose thresholds aren't given in that doc (only the Ask Her Out
// Romance threshold and the Home-as-Date unlock condition) — scaled
// against Priya/Bianca's existing thresholds as first-pass placeholders,
// same "easy to retune" status as everything else here.

const ROSA_ROMANCE_THRESHOLD = 3;
const ROSA_PROPOSE_DATE_THRESHOLD = 3;
const ROSA_PROPOSE_RELATIONSHIP_THRESHOLD = 90; // Close tier
const ROSA_PROPOSE_ROMANCE_THRESHOLD = 8;

const ROSA_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "fun",
  favoriteRomanticItemId: "bouquet",
  dislikedRomanticItemId: "necklace",
  specialJewelryRanking: ["custom-jewelry", "diamond-earrings", "luxury-watch"],
};

const ROSA_ACTIONS: NpcActionRules = {
  exchangeNumber: (tier) => {
    if (tier === "stranger") {
      return { success: false, delta: -5, message: '"Ohh, maybe once I know you a little better!" She laughs it off.' };
    }
    return { success: true, delta: 10, message: 'She grins and rattles off her number. "There — now text me sometime!"' };
  },
  giftReaction: (tier, category, itemId) =>
    buildGiftResult(ROSA_GIFT_PREFS, category, itemId, tier, {
      "romantic-favorite": '"Flowers! You know me." She\'s glowing.',
      "romantic-baseline": '"Oh my gosh, you didn\'t have to!" She\'s beaming.',
      "romantic-disliked": '"Oh, it\'s beautiful!" She\'s still genuinely happy, if a touch more reserved.',
      "jewelry-rejected": '"Whoa, that\'s way too much!" She laughs, gently pushing it back.',
      "jewelry-uncertain": '"Oh! That\'s so generous." Flattered, if a little unsure.',
      "jewelry-rank1": '"...Is this for me?" She\'s stunned.',
      "jewelry-rank2": '"Oh my gosh, it\'s gorgeous!" She\'s glowing.',
      "jewelry-rank3": '"Aw, it\'s so pretty!" Delighted, plain and simple.',
      "category-match": '"Yes! This is so fun!" She\'s thrilled.',
      "category-mismatch-neutral": '"Aw, thank you!" She\'s sweet about it regardless.',
    }),
  askHerOut: (romanceScore) => {
    if (romanceScore >= ROSA_ROMANCE_THRESHOLD) {
      return { success: true, message: 'Her face lights up. "I was hoping you\'d ask!"' };
    }
    return { success: false, message: '"Aw — I don\'t think we\'re quite there yet."' };
  },
  propose: (relationshipScore, romanceScore, dateCount) => {
    if (
      dateCount >= ROSA_PROPOSE_DATE_THRESHOLD &&
      relationshipScore >= ROSA_PROPOSE_RELATIONSHIP_THRESHOLD &&
      romanceScore >= ROSA_PROPOSE_ROMANCE_THRESHOLD
    ) {
      return { success: true, message: 'She gasps, hands over her mouth. "Yes! Yes, of course — yes!"' };
    }
    return { success: false, message: '"...Ask me again a little later, okay?"' };
  },
};

const ROSA: NpcDef = {
  id: "rosa",
  name: "Rosa Delgado",
  portrait: ROSA_PORTRAIT,
  romanceEligible: true,
  greetings: {
    stranger: "Hi there! Welcome to the Gift Shop — let me know if you need help finding anything!",
    acquaintance: "Hey, you're back! Good to see a familiar face.",
    friend: "There you are! I was hoping you'd stop by today.",
    close: "Hey you! Come here, I've been dying to talk to you.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "gossip", label: "Mall Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "jewelry", label: "Jewelry", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About Her Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "vent", label: "Vent", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "check-in", label: "Check In On Her", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [
    { id: "looks", label: "Looks", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "style", label: "Style", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "personality", label: "Personality", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "competence", label: "Competence", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyCharmTopics: [
    { id: "tease", label: "Playful Tease", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "bold-move", label: "Make a Bold Move", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "show-off", label: "Show Off", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "line", label: "Drop a Line", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  actions: ROSA_ACTIONS,
  homeDateUnlock: (dateCount, tier) => dateCount >= 1 && tierAtLeast(tier, "friend"),
};

const KEVIN_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "fun",
  specialJewelryRanking: ["luxury-watch", "custom-jewelry", "diamond-earrings"],
};

const KEVIN_ACTIONS: NpcActionRules = {
  exchangeNumber: (tier) => {
    if (tier === "stranger") {
      return { success: false, delta: -5, message: '"Ha, let\'s get to know each other a bit first, yeah?"' };
    }
    return { success: true, delta: 10, message: 'He nods easily. "Yeah, sure — here you go."' };
  },
  giftReaction: (tier, category, itemId) =>
    buildGiftResult(KEVIN_GIFT_PREFS, category, itemId, tier, {
      "jewelry-rejected": '"Whoa, man, that\'s too much." He hands it right back, easy about it.',
      "jewelry-uncertain": '"That\'s real generous, man." A little caught off guard.',
      "jewelry-rank1": '"Whoa. That\'s really something, man." Genuinely stunned.',
      "jewelry-rank2": '"Hey, that\'s awesome, man." Genuinely pleased.',
      "jewelry-rank3": '"Aw, thanks, man." Easygoing, appreciative.',
      "category-match": '"Hey, appreciate that, man. Didn\'t need to." He means it.',
      "category-mismatch-neutral": '"Aw, thanks, man." Easygoing about it either way.',
    }),
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

// If Rosa marries the player she leaves the Gift Shop for good — Kevin
// covers it full-time from then on, no more alternating (see
// isGiftShopStaffOnDuty).
const KEVIN: NpcDef = {
  id: "kevin",
  name: "Kevin Park",
  portrait: KEVIN_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Hey, welcome in. Let me know if you need a hand with anything.",
    acquaintance: "Hey, good to see you again.",
    friend: "Hey man, good to see you.",
    close: "Hey, man. Always good when you swing by.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "gossip", label: "Mall Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "jewelry", label: "Jewelry", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About His Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "vent", label: "Vent", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "check-in", label: "Check In On Him", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: KEVIN_ACTIONS,
  inviteToFightMinTier: "acquaintance",
};

const MALIK_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "practical",
  specialJewelryRanking: ["custom-jewelry", "luxury-watch", "diamond-earrings"],
};

const MALIK_ACTIONS: NpcActionRules = {
  exchangeNumber: (tier) => {
    if (tier === "stranger") {
      return { success: false, delta: -5, message: '"Let\'s talk shop a bit more first, yeah?"' };
    }
    return { success: true, delta: 10, message: 'He nods, writing his number down himself. "Good. Call if you need anything."' };
  },
  giftReaction: (tier, category, itemId) => {
    if (tier === "stranger") {
      return { delta: -5, message: '"That\'s kind, but I barely know you." He\'s polite but keeps his distance.' };
    }
    return buildGiftResult(MALIK_GIFT_PREFS, category, itemId, tier, {
      "jewelry-uncertain": '"That\'s a lot for where we are." Polite, a little guarded.',
      "jewelry-rank1": '"...Now that\'s fine work." He\'s genuinely impressed.',
      "jewelry-rank2": '"That\'s real thoughtful." Genuinely touched.',
      "jewelry-rank3": '"Appreciate it." Polite, if a little reserved.',
      "category-match": '"Now that\'s thoughtful — good craftsmanship, too." He looks genuinely touched.',
      "category-mismatch-neutral": '"Appreciate it." Polite, if a little indifferent.',
    });
  },
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

const MALIK: NpcDef = {
  id: "malik",
  name: "Malik Hassan",
  portrait: MALIK_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Welcome in — everything here's built to last, take your time looking around.",
    acquaintance: "Good to see you again. Come on in.",
    friend: "Hey, good to see you. Come, take a look at what just came in.",
    close: "There you are. Come on back, I want to show you something.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "gossip", label: "Mall Gossip", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "interior-design", label: "Interior Design", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About His Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    // Craftsmanship — genuinely lights up talking about it.
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "vent", label: "Vent", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "check-in", label: "Check In On Him", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: MALIK_ACTIONS,
  inviteToFightMinTier: "friend",
};

const MEI_ROMANCE_THRESHOLD = 4;
const MEI_PROPOSE_DATE_THRESHOLD = 4;
const MEI_PROPOSE_RELATIONSHIP_THRESHOLD = 90; // Close tier
const MEI_PROPOSE_ROMANCE_THRESHOLD = 15;

const MEI_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "fun",
  favoriteRomanticItemId: "bouquet",
  dislikedRomanticItemId: "necklace",
  specialJewelryRanking: ["custom-jewelry", "diamond-earrings", "luxury-watch"],
};

const MEI_ACTIONS: NpcActionRules = {
  exchangeNumber: (tier) => {
    if (tier === "stranger") {
      return { success: false, delta: -5, message: '"Oh — maybe once you\'ve been in a few more times!"' };
    }
    return {
      success: true,
      delta: 10,
      message: 'She scribbles her number on a receipt. "Here! Text me pictures if you get a pet!"',
    };
  },
  giftReaction: (tier, category, itemId) =>
    buildGiftResult(MEI_GIFT_PREFS, category, itemId, tier, {
      "romantic-favorite": '"Flowers?! You\'re the best." She\'s already looking for a vase.',
      "romantic-baseline": '"For me? Aw, that\'s so sweet!" She\'s genuinely delighted.',
      "romantic-disliked": '"Oh, pretty!" Happy, if a little more subdued than usual.',
      "jewelry-rejected": '"Oh! That\'s way too much!" She hands it back, laughing nervously.',
      "jewelry-uncertain": '"Oh wow, that\'s generous!" A little flustered.',
      "jewelry-rank1": '"...Whoa." She\'s at a genuine loss for words.',
      "jewelry-rank2": '"Oh my gosh, it\'s beautiful!" She\'s glowing.',
      "jewelry-rank3": '"Aw, it\'s so pretty!" Sweet, genuinely happy.',
      "category-match": '"Yes!! This is so fun!" She\'s thrilled.',
      "category-mismatch-neutral": '"Aw, thank you!" Sweet about it regardless.',
    }),
  askHerOut: (romanceScore) => {
    if (romanceScore >= MEI_ROMANCE_THRESHOLD) {
      return { success: true, message: 'She blinks, then smiles wide. "...Yeah. Yeah, I\'d really like that."' };
    }
    return { success: false, message: '"Oh! Um — I don\'t think I\'m ready for that yet."' };
  },
  propose: (relationshipScore, romanceScore, dateCount) => {
    if (
      dateCount >= MEI_PROPOSE_DATE_THRESHOLD &&
      relationshipScore >= MEI_PROPOSE_RELATIONSHIP_THRESHOLD &&
      romanceScore >= MEI_PROPOSE_ROMANCE_THRESHOLD
    ) {
      return { success: true, message: 'Her eyes well up. "Yes — a thousand times, yes."' };
    }
    return { success: false, message: '"...Too soon. But ask me again, okay?"' };
  },
};

const MEI: NpcDef = {
  id: "mei",
  name: "Mei Chen",
  portrait: MEI_PORTRAIT,
  romanceEligible: true,
  greetings: {
    stranger: "Oh — hi! Welcome to the Pet Store! Did you know a betta fish can recognize its owner's face?",
    acquaintance: "Hey, you're back! Come see, we got a new litter in this week.",
    friend: "Hi! I was just thinking about you, actually — perfect timing.",
    close: "Hey you. Come here, I want to show you something.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "gossip", label: "Mall Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "animals", label: "Animals", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About Her Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    // Animals — her actual passion, bordering on obsessive.
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "vent", label: "Vent", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "check-in", label: "Check In On Her", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [
    { id: "looks", label: "Looks", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "style", label: "Style", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "personality", label: "Personality", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "competence", label: "Competence", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyCharmTopics: [
    { id: "tease", label: "Playful Tease", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "bold-move", label: "Make a Bold Move", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "show-off", label: "Show Off", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "line", label: "Drop a Line", ratingByTier: { friend: "neutral", close: "neutral" } },
  ],
  actions: MEI_ACTIONS,
  homeDateUnlock: (dateCount, tier) => dateCount >= 2 && tier === "close",
};

const TYLER_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "fun",
  specialJewelryRanking: ["luxury-watch", "diamond-earrings", "custom-jewelry"],
};

const TYLER_ACTIONS: NpcActionRules = {
  exchangeNumber: (tier) => {
    if (tier === "stranger") {
      return { success: false, delta: -5, message: '"Eh, maybe once I know you a bit better, man."' };
    }
    return { success: true, delta: 10, message: 'He shrugs easily. "Sure, man, here you go."' };
  },
  giftReaction: (tier, category, itemId) =>
    buildGiftResult(TYLER_GIFT_PREFS, category, itemId, tier, {
      "jewelry-rejected": '"Whoa, man, too much." He hands it back, easygoing about it.',
      "jewelry-uncertain": '"That\'s real generous, man." A little caught off guard.',
      "jewelry-rank1": '"Whoa. That\'s really something, man." Genuinely stunned.',
      "jewelry-rank2": '"Hey, that\'s awesome, man." Genuinely pleased.',
      "jewelry-rank3": '"Aw, thanks, man." Easygoing, appreciative.',
      "category-match": '"Aw, didn\'t have to do that, man. Thanks." He\'s genuinely pleased.',
      "category-mismatch-neutral": '"Hey, thanks, man." Easygoing about it either way.',
    }),
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

// If Mei marries the player she leaves the Pet Store for good — Tyler
// becomes the sole permanent employee from then on.
const TYLER: NpcDef = {
  id: "tyler",
  name: "Tyler Brooks",
  portrait: TYLER_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Hey, welcome in. Dogs are around back if you want to say hi.",
    acquaintance: "Hey, good to see you.",
    friend: "Hey man, what's up.",
    close: "Hey, good to see you, man. Come hang out.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "gossip", label: "Mall Gossip", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    // Actually his thing, unlike idle mall chatter — matches his Hobbies rating below.
    { id: "animals", label: "Animals", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About His Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "vent", label: "Vent", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "check-in", label: "Check In On Him", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: TYLER_ACTIONS,
  inviteToFightMinTier: "acquaintance",
};

const SIMONE_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "fun",
  specialJewelryRanking: ["diamond-earrings", "custom-jewelry", "luxury-watch"],
};

const SIMONE_ACTIONS: NpcActionRules = {
  exchangeNumber: (tier) => {
    if (!tierAtLeast(tier, "friend")) {
      return { success: false, delta: -5, message: '"Oh, I don\'t really give my number out — not much of a texter!"' };
    }
    return { success: true, delta: 10, message: 'She smiles. "Alright, sure — for emergencies only, though!"' };
  },
  giftReaction: (tier, category, itemId) => {
    if (tier === "stranger") {
      return { delta: -5, message: '"Oh — that\'s very sweet, but I couldn\'t possibly." She\'s polite but firm.' };
    }
    return buildGiftResult(SIMONE_GIFT_PREFS, category, itemId, tier, {
      "jewelry-uncertain": '"Oh, that\'s awfully generous." Flattered, a little unsure.',
      "jewelry-rank1": '"Oh, wow — it\'s gorgeous!" She\'s genuinely dazzled.',
      "jewelry-rank2": '"That\'s so thoughtful of you!" She\'s genuinely touched.',
      "jewelry-rank3": '"Oh, that\'s so sweet." Pleasant, appreciative.',
      "category-match": '"That\'s so thoughtful of you!" She\'s genuinely touched.',
      "category-mismatch-neutral": '"Oh, that\'s kind." Pleasant, if not her usual taste.',
    });
  },
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

// Canonically already married in-world — the romance door is narratively
// closed, not just "not yet interested." No Flirty category at all,
// permanently hidden, same treatment as any friend-only NPC.
const SIMONE: NpcDef = {
  id: "simone",
  name: "Simone Reyes",
  portrait: SIMONE_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Hi, welcome in! Let me know if you want a hand putting something together.",
    acquaintance: "Hey, good to see you again!",
    friend: "Hey! Good to see you — come here, let me show you something.",
    close: "Hey you! Perfect timing, come here.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "gossip", label: "Mall Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "fashion", label: "Fashion", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About Her Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "vent", label: "Vent", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "check-in", label: "Check In On Her", ratingByTier: { friend: "neutral", close: "neutral" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: SIMONE_ACTIONS,
  inviteToFightMinTier: "friend",
};

const CHRIS_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "practical",
  specialJewelryRanking: ["luxury-watch", "custom-jewelry", "diamond-earrings"],
};

const CHRIS_ACTIONS: NpcActionRules = {
  exchangeNumber: (tier) => {
    if (tier === "stranger") {
      return { success: false, delta: -5, message: '"Ha, let\'s do a few more laps around the lot first."' };
    }
    return { success: true, delta: 10, message: 'He hands over a card with his cell scrawled on the back. "Anytime, champ."' };
  },
  giftReaction: (tier, category, itemId) =>
    buildGiftResult(CHRIS_GIFT_PREFS, category, itemId, tier, {
      "jewelry-rejected": '"Whoa, champ, slow down." He hands it back with a grin.',
      "jewelry-uncertain": '"That\'s a hell of a gesture." Impressed, a little thrown.',
      "jewelry-rank1": '"Now THAT\'S a piece." He\'s genuinely blown away.',
      "jewelry-rank2": '"Well, aren\'t you something." He\'s grinning, genuinely pleased.',
      "jewelry-rank3": '"Ha, that\'s real nice of you." Good-natured, appreciative.',
      "category-match": '"Well, aren\'t you something — a man who thinks practical." He\'s grinning, genuinely pleased.',
      "category-mismatch-neutral": '"Ha, appreciate it." Good-natured about it either way.',
    }),
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

const CHRIS: NpcDef = {
  id: "chris",
  name: "Chris Sullivan",
  portrait: CHRIS_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Hey there! Chris Sullivan — take a look around, let me know if anything catches your eye.",
    acquaintance: "Hey, good to see you again!",
    friend: "Hey, good to see you, man. Come on over.",
    close: "Hey! There he is. Good to see you.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "gossip", label: "Mall Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "cars", label: "Cars", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About His Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "vent", label: "Vent", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "check-in", label: "Check In On Him", ratingByTier: { friend: "neutral", close: "neutral" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: CHRIS_ACTIONS,
  inviteToFightMinTier: "acquaintance",
};

// --- Mall Shoppers (wandering cast, Phase 1) ---------------------------
// No camp-phase restriction given in the doc (unlike Derek, whose spec
// explicitly limits him to "No Fight Scheduled" for now) — these three are
// just always around, gated only by the same generic isNpcAway checks
// (married/divorced/meetup/overnight-commute) every other NPC gets.
// Propose thresholds for Jasmine aren't given (same gap as Rosa/Mei) —
// mirrors Rosa's exactly, since her Ask Her Out threshold and Home-Date
// unlock condition are identical.

const JASMINE_ROMANCE_THRESHOLD = 3;
const JASMINE_PROPOSE_DATE_THRESHOLD = 3;
const JASMINE_PROPOSE_RELATIONSHIP_THRESHOLD = 90; // Close tier
const JASMINE_PROPOSE_ROMANCE_THRESHOLD = 8;

const JASMINE_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "practical",
  favoriteRomanticItemId: "chocolates",
  dislikedRomanticItemId: "necklace",
  specialJewelryRanking: ["luxury-watch", "custom-jewelry", "diamond-earrings"],
};

const JASMINE_ACTIONS: NpcActionRules = {
  exchangeNumber: (tier) => {
    if (tier === "stranger") {
      return { success: false, delta: -5, message: '"Ha, let\'s see if you\'re actually normal first."' };
    }
    return { success: true, delta: 10, message: 'She hands over her phone to save your number. "There. Don\'t waste my time."' };
  },
  giftReaction: (tier, category, itemId) =>
    buildGiftResult(JASMINE_GIFT_PREFS, category, itemId, tier, {
      "romantic-favorite": '"...Chocolate. Okay, you get points for that." She\'s trying not to smile.',
      "romantic-baseline": '"Oh — that\'s really sweet of you." She seems genuinely touched.',
      "romantic-disliked": '"It\'s pretty." A little more reserved than usual, but she means it.',
      "jewelry-rejected": '"Whoa, slow down." She hands it back, no-nonsense but not unkind.',
      "jewelry-uncertain": '"That\'s... a lot, honestly." Flattered, a bit thrown.',
      "jewelry-rank1": '"...Okay, that\'s a lot." She\'s stunned, in a good way.',
      "jewelry-rank2": '"Oh — it\'s beautiful." Genuinely touched.',
      "jewelry-rank3": '"It\'s really pretty, thank you." Warm, no-nonsense as ever.',
      "category-match": '"Okay, actually useful. I like that." She\'s genuinely pleased.',
      "category-mismatch-neutral": '"Thanks." Polite, no-nonsense as ever.',
    }),
  askHerOut: (romanceScore) => {
    if (romanceScore >= JASMINE_ROMANCE_THRESHOLD) {
      return { success: true, message: '"...Yeah. Yeah, okay. Let\'s do that."' };
    }
    return { success: false, message: '"Slow down. We\'re not there yet."' };
  },
  propose: (relationshipScore, romanceScore, dateCount) => {
    if (
      dateCount >= JASMINE_PROPOSE_DATE_THRESHOLD &&
      relationshipScore >= JASMINE_PROPOSE_RELATIONSHIP_THRESHOLD &&
      romanceScore >= JASMINE_PROPOSE_ROMANCE_THRESHOLD
    ) {
      return { success: true, message: 'Her eyes go glassy for just a second. "...Yes. Okay. Yes."' };
    }
    return { success: false, message: '"Ask me again when you mean it more."' };
  },
};

// Mall Lobby wanderer, not tied to any one store — see getJasmineStation.
const JASMINE: NpcDef = {
  id: "jasmine",
  name: "Jasmine Mensah",
  portrait: JASMINE_PORTRAIT,
  romanceEligible: true,
  greetings: {
    stranger: "Oh, hey — sorry, just people-watching on my break. I'm Jasmine, by the way.",
    acquaintance: "Hey, good to see you again!",
    friend: "Hey you! Come sit, I've got a few minutes.",
    close: "Hey! Perfect timing, come here.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "gossip", label: "Mall Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "health", label: "Health", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About Her Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "vent", label: "Vent", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "check-in", label: "Check In On Her", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [
    { id: "looks", label: "Looks", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "style", label: "Style", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "personality", label: "Personality", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "competence", label: "Competence", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyCharmTopics: [
    { id: "tease", label: "Playful Tease", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "bold-move", label: "Make a Bold Move", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "show-off", label: "Show Off", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "line", label: "Drop a Line", ratingByTier: { friend: "neutral", close: "neutral" } },
  ],
  actions: JASMINE_ACTIONS,
  homeDateUnlock: (dateCount, tier) => dateCount >= 1 && tierAtLeast(tier, "friend"),
};

const DOROTHY_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "fun",
  specialJewelryRanking: ["diamond-earrings", "custom-jewelry", "luxury-watch"],
};

const DOROTHY_ACTIONS: NpcActionRules = {
  exchangeNumber: (tier) => {
    if (tier === "stranger") {
      return { success: false, delta: -5, message: '"Oh, maybe once I know you a bit better, dear."' };
    }
    return {
      success: true,
      delta: 10,
      message: 'She writes her number on a little notepad from her purse. "There you go, sweetheart."',
    };
  },
  giftReaction: (tier, category, itemId) =>
    buildGiftResult(DOROTHY_GIFT_PREFS, category, itemId, tier, {
      "jewelry-rejected": '"Oh, dear, that\'s much too much." She presses it back into your hands, kindly.',
      "jewelry-uncertain": '"Oh my, aren\'t you generous." Touched, a little flustered.',
      "jewelry-rank1": '"Oh my word." For a second, the sweet-old-lady act completely drops.',
      "jewelry-rank2": '"Oh, you shouldn\'t have!" She\'s clearly delighted — and a little too excited for a "sweet old lady."',
      "jewelry-rank3": '"Oh, isn\'t that lovely." Warm, genuinely pleased.',
      "category-match": '"Oh, you shouldn\'t have!" She\'s clearly delighted — and a little too excited for a "sweet old lady."',
      "category-mismatch-neutral": '"Oh, aren\'t you thoughtful." Warm about it regardless.',
    }),
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

// Wanders the Vehicle Dealer alongside Chris — see MALL_STORE_SHOPPERS.
const DOROTHY: NpcDef = {
  id: "dorothy",
  name: "Dorothy Mae Winters",
  portrait: DOROTHY_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Oh, hello dear! Just admiring the cars — don't let the cardigan fool you.",
    acquaintance: "Well hello again, sweetheart!",
    friend: "There you are! Come sit with me a minute.",
    close: "Oh, hello you! Come here, I want to tell you something.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "gossip", label: "Mall Gossip", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    // Her secret passion — this is the one topic where the sweet-old-lady
    // act drops and she genuinely lights up.
    { id: "cars", label: "Cars", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About Her Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    // Fast cars, same passion as above.
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "vent", label: "Vent", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "check-in", label: "Check In On Her", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: DOROTHY_ACTIONS,
  inviteToFightMinTier: "acquaintance",
};

const TONY_GIFT_PREFS: GiftPreferences = {
  favoriteGeneralCategory: "practical",
  specialJewelryRanking: ["luxury-watch", "custom-jewelry", "diamond-earrings"],
};

const TONY_ACTIONS: NpcActionRules = {
  exchangeNumber: (tier) => {
    if (tier === "stranger") {
      return { success: false, delta: -5, message: '"Eh, let\'s hang out a bit more first, man."' };
    }
    return { success: true, delta: 10, message: 'He shrugs, easy about it. "Yeah, sure, man. Here."' };
  },
  giftReaction: (tier, category, itemId) =>
    buildGiftResult(TONY_GIFT_PREFS, category, itemId, tier, {
      "jewelry-rejected": '"Whoa, man, too much." He hands it back, gentle for a guy his size.',
      "jewelry-uncertain": '"That\'s real generous, man." A little caught off guard.',
      "jewelry-rank1": '"Whoa." His tough-guy composure genuinely cracks for a second.',
      "jewelry-rank2": '"Hey, that\'s awesome, man." Big soft grin.',
      "jewelry-rank3": '"Aw, thanks, man." Easygoing, appreciative.',
      "category-match": '"Aw, man, didn\'t need to do that. Actually useful, too." He\'s got a big soft grin.',
      "category-mismatch-neutral": '"Hey, thanks, man." Easygoing about it either way.',
    }),
  askHerOut: () => ({ success: false, message: "" }),
  propose: () => ({ success: false, message: "" }),
};

// Wanders the Pet Store alongside Mei/Tyler — see MALL_STORE_SHOPPERS.
const TONY: NpcDef = {
  id: "tony",
  name: "Tony Santos",
  portrait: TONY_PORTRAIT,
  romanceEligible: false,
  greetings: {
    stranger: "Oh — hey. Just, uh, saying hi to the cats. They know me here.",
    acquaintance: "Hey, good to see you, man.",
    friend: "Hey man! Come here, you gotta see this kitten.",
    close: "Hey, good to see you, man. Come on.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "gossip", label: "Mall Gossip", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    // Cats specifically, not just animals in general — that's his thing.
    { id: "cats", label: "Cats", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "ask-day", label: "Ask About His Day", ratingByTier: { stranger: "positive", acquaintance: "positive", friend: "positive", close: "positive" } },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
  ],
  heartToHeartTopics: [
    { id: "advice", label: "Ask for Advice", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "worry", label: "Share a Worry", ratingByTier: { friend: "neutral", close: "neutral" } },
    { id: "vent", label: "Vent", ratingByTier: { friend: "positive", close: "positive" } },
    { id: "check-in", label: "Check In On Him", ratingByTier: { friend: "positive", close: "positive" } },
  ],
  flirtyComplimentTopics: [],
  flirtyCharmTopics: [],
  actions: TONY_ACTIONS,
  inviteToFightMinTier: "acquaintance",
};

// Manager Lvl 1/2/3 and, where designed, their secretary/second-assistant —
// used to lay out each Office floor (see buildOfficeFloorRoom) and to
// resolve which NPC a floor's manager desk belongs to at dispatch time.
// Vinnie has no support staff yet; Angela has Kyle; Marcus has both
// Margaret and Bianca — filling however many of the floor's 2 flanking
// desks are actually staffed, per the doc.
const OFFICE_FLOOR_MANAGER: Record<number, NpcDef> = { 1: VINNIE, 2: ANGELA, 3: MARCUS };
const OFFICE_FLOOR_STAFF: Record<number, NpcDef[]> = {
  1: [],
  2: [KYLE],
  3: [MARGARET, BIANCA],
};

function managerDeskOptions(floor: number): DialogueOption[] {
  return [
    {
      id: "manager-desk",
      label: "Manager Desk",
      onSelect: () => {
        dialogueBox.close();
        openManagerDeskMenu(floor);
      },
    },
  ];
}

// Registry of every dialogue-capable NPC — used by the Contacts app to look
// up whoever has had their number exchanged, regardless of which building
// they're physically found in.
const ALL_NPCS: NpcDef[] = [
  PRIYA,
  CAROL,
  DEREK,
  VINNIE,
  ANGELA,
  MARCUS,
  KYLE,
  MARGARET,
  BIANCA,
  ROSA,
  KEVIN,
  MALIK,
  MEI,
  TYLER,
  SIMONE,
  CHRIS,
  JASMINE,
  DOROTHY,
  TONY,
];
function getNpcById(id: string): NpcDef | undefined {
  return ALL_NPCS.find((n) => n.id === id);
}

// Which building each NPC is physically found in — Text/Initiate Meetup
// only make sense when you're not standing right in front of her, so
// they're locked whenever the player is currently inside that building.
const NPC_HOME_BUILDING: Record<string, string> = {
  priya: "Office",
  carol: "Office",
  derek: "Office",
  vinnie: "Office",
  angela: "Office",
  marcus: "Office",
  kyle: "Office",
  margaret: "Office",
  bianca: "Office",
  rosa: "Mall",
  kevin: "Mall",
  malik: "Mall",
  mei: "Mall",
  tyler: "Mall",
  simone: "Mall",
  chris: "Mall",
  jasmine: "Mall",
  dorothy: "Mall",
  tony: "Mall",
};
// Which Office floor an NPC's own station lives on, if any — derived from
// the same manager/staff layout used to build the floors themselves,
// rather than a separately hand-kept map that could drift out of sync.
function getNpcOfficeFloor(npcId: string): number | undefined {
  for (const floor of [1, 2, 3]) {
    if (OFFICE_FLOOR_MANAGER[floor]?.id === npcId) return floor;
    if (OFFICE_FLOOR_STAFF[floor]?.some((n) => n.id === npcId)) return floor;
  }
  return undefined;
}
// True whenever she's actually physically standing in the room the player
// is currently in — covers every way she can be present, not just her
// regular station: an active meetup/date visit, an overnight guest asleep
// the morning after, or (once married) any house. Text/Initiate Meetup
// only make sense when none of these are true.
function isNpcInCurrentBuilding(npcId: string): boolean {
  if (scene.type !== "interior") return false;
  const buildingName = scene.lot.building.name;
  if (playerState.married[npcId]) return HOUSE_NAMES.has(buildingName);
  if (playerState.activeMeetup?.npcId === npcId && scene.interior.hasStation("meetup-npc")) return true;
  if (playerState.overnightCommuteStep[npcId] === 0 && scene.interior.hasStation("overnight-guest")) return true;
  // Office-floor NPCs (managers and their staff) are on their own specific
  // floor, not just "somewhere in the Office" — standing in the Lobby or
  // another floor shouldn't lock Text for them.
  const officeFloor = getNpcOfficeFloor(npcId);
  if (officeFloor !== undefined) return buildingName === "Office" && scene.officeFloor === officeFloor;
  // Mall staff (Gift Shop/Pet Store/Furniture Store/Clothing Store/Vehicle
  // Dealer) are on their own specific store, not just "somewhere in the
  // Mall" — same idea as Office floors above.
  const mallStore = getNpcMallStore(npcId);
  if (mallStore !== undefined) return buildingName === "Mall" && scene.mallStore === mallStore;
  return buildingName === NPC_HOME_BUILDING[npcId] && !isNpcAway(npcId);
}

// Manager floors (1-3): no desks/dividers/decorations at all — just the
// Elevator (top-right, shared by every floor) and each floor's NPC(s)
// standing directly at a plain point, same bare station style Priya/
// Carol/Derek use downstairs.
const OFFICE_FLOOR_ELEVATOR: Station = { id: "elevator", label: "Elevator", nx: 0.88, ny: 0.12 };
function buildNpcStation(npc: NpcDef, nx: number, ny: number): Station {
  return { id: `office-desk-${npc.id}`, label: npc.name, nx, ny, kind: "npc" };
}
function buildOfficeFloorRoom(floor: number): { stations: Station[]; decorations: Decoration[] } {
  const stations: Station[] = [OFFICE_FLOOR_ELEVATOR];
  // Same "away from her spot" check the Lobby's reception uses (married/
  // divorced/active meetup/overnight commute) — without this, a romance-
  // eligible floor NPC (e.g. Bianca) never actually leaves her floor
  // station even mid-meetup or the morning after an Overnight Stay.
  const addIfPresent = (npc: NpcDef, nx: number, ny: number) => {
    if (!isNpcAway(npc.id)) stations.push(buildNpcStation(npc, nx, ny));
  };
  if (floor === 1) {
    addIfPresent(VINNIE, 0.4, 0.5);
  } else if (floor === 2) {
    addIfPresent(KYLE, 0.5, 0.3);
    addIfPresent(ANGELA, 0.4, 0.65);
  } else if (floor === 3) {
    addIfPresent(MARGARET, 0.5, 0.3);
    addIfPresent(MARCUS, 0.35, 0.65);
    addIfPresent(BIANCA, 0.55, 0.65);
  }
  return { stations, decorations: [] };
}

// Mall NPC spec: which staff belong to which store — Gift Shop and Pet
// Store both carry two, everyone else just one.
const MALL_STORE_STAFF: Record<string, NpcDef[]> = {
  giftshop: [ROSA, KEVIN],
  petstore: [MEI, TYLER],
  furniture: [MALIK],
  clothes: [SIMONE],
  vehicles: [CHRIS],
};
// Wandering shoppers (Mall NPC spec, Phase 1) — placed alongside a store's
// real staff but not staff themselves: no Gift-Shop-style alternation, no
// "if married, X takes over" replacement rule, just the same generic
// isNpcAway presence check every other NPC gets.
const MALL_STORE_SHOPPERS: Record<string, NpcDef[]> = {
  vehicles: [DOROTHY],
  petstore: [TONY],
};
function getNpcMallStore(npcId: string): string | undefined {
  for (const storeId of Object.keys(MALL_STORE_STAFF)) {
    if (MALL_STORE_STAFF[storeId].some((n) => n.id === npcId)) return storeId;
  }
  for (const storeId of Object.keys(MALL_STORE_SHOPPERS)) {
    if (MALL_STORE_SHOPPERS[storeId].some((n) => n.id === npcId)) return storeId;
  }
  return undefined;
}

// Gift Shop spec: Rosa and Kevin "alternate by camp phase, never work
// simultaneously" — the doc doesn't pin down which stage belongs to whom,
// so this splits CAMP_SEQUENCE by index parity (a simple, stable,
// debug-menu-testable rule): Rosa covers No Fight Scheduled/Private
// Life/Promotion/After Fight, Kevin covers the 4 Training stages plus
// FIGHT NIGHT. Once Rosa's married (or divorced) she's gone from the
// game for good, same as any other romance-eligible NPC — Kevin covers
// the shop full-time from then on, the alternation no longer applies.
function isGiftShopStaffOnDuty(npcId: string): boolean {
  if (playerState.married["rosa"] || playerState.divorced["rosa"]) {
    return npcId === "kevin";
  }
  const rosaOnDuty = campCycle.currentIndex % 2 === 0;
  return npcId === "rosa" ? rosaOnDuty : !rosaOnDuty;
}

function buildMallStaffStation(npc: NpcDef, nx: number, ny: number): Station {
  return { id: `mall-staff-${npc.id}`, label: npc.name, nx, ny, kind: "npc" };
}
// Up to 3 people share a store room now (Pet Store: Mei/Tyler + Tony) —
// spread evenly below the counter; a single-occupant store just uses the
// first slot.
const MALL_STAFF_POSITIONS: [number, number][] = [
  [0.25, 0.65],
  [0.5, 0.65],
  [0.75, 0.65],
];

// Mall Item Catalogues spec: shopping happens at whichever staff member is
// the store's actual shopkeeper — a small desk in the middle of the room,
// same visual as Office Reception (see MALL_SHOP_DESK) — not a separate
// walk-up counter. Pet Store specifically: Mei is the shopkeeper normally;
// Tyler just roams caring for the animals with no shop role at all, until
// Mei's gone for good (married/divorced), at which point he takes over the
// desk permanently. A temporary absence (a meetup, not marriage) doesn't
// hand it to him — the shop just has nobody at the desk that visit, same
// as Gift Shop's alternation gaps.
function isMallShopkeeper(storeId: string, npcId: string): boolean {
  if (storeId === "giftshop") return isGiftShopStaffOnDuty(npcId);
  if (storeId === "petstore") {
    if (npcId === "mei") return true;
    if (npcId === "tyler") return playerState.married["mei"] || playerState.divorced["mei"];
    return false;
  }
  return (MALL_STORE_STAFF[storeId] ?? []).some((n) => n.id === npcId);
}

// Extra dialogue option folded into the shopkeeper's own menu, same pattern
// as Reception's "Hire Manager"/the Manager Desk option. Every store now
// shops this way — no separate walk-up counter anywhere in the Mall.
const MALL_STORE_SHOP_OPENERS: Record<string, () => void> = {
  giftshop: openGiftShopMenu,
  petstore: openPetStoreMenu,
  furniture: openFurnitureMenu,
  clothes: openClothesMenu,
  vehicles: openVehicleMenu,
};
function mallShopOptions(storeId: string): DialogueOption[] {
  const opener = MALL_STORE_SHOP_OPENERS[storeId];
  if (!opener) return [];
  return [
    {
      id: "shop",
      label: "🛍 Shop",
      onSelect: () => {
        dialogueBox.close();
        opener();
      },
    },
  ];
}

// Desk decoration for every store's shopkeeper — centered in the room,
// same idea as Office Reception's desk (see OFFICE_DECORATIONS) just
// without the two-flanking-seats layout, since only one NPC is ever
// behind it at a time.
const MALL_SHOP_DESK_ID = "mall-shop-desk";
function mallShopDeskDecorations(): Decoration[] {
  return [{ id: MALL_SHOP_DESK_ID, nx: 0.5, ny: 0.4, width: 180, height: 36, blocking: true }];
}
function buildMallStoreRoom(storeId: string): { stations: Station[]; decorations: Decoration[] } {
  const npcsHere = [...(MALL_STORE_STAFF[storeId] ?? []), ...(MALL_STORE_SHOPPERS[storeId] ?? [])];
  const stations: Station[] = [...(MALL_STORE_STATIONS[storeId] ?? [])];
  let regularSlot = 0;
  npcsHere.forEach((npc) => {
    const onDuty = storeId === "giftshop" ? isGiftShopStaffOnDuty(npc.id) : true;
    if (!onDuty || isNpcAway(npc.id)) return;
    if (isMallShopkeeper(storeId, npc.id)) {
      // Standing right behind the desk, approached from the south like
      // Reception — only one shopkeeper is ever present at a time so this
      // doesn't need Reception's left/right split.
      stations.push({
        id: `mall-staff-${npc.id}`,
        label: npc.name,
        nx: 0.5,
        ny: 0.28,
        kind: "npc",
        radius: 24,
        approachDecorationId: MALL_SHOP_DESK_ID,
      });
    } else {
      const [nx, ny] = MALL_STAFF_POSITIONS[regularSlot] ?? MALL_STAFF_POSITIONS[MALL_STAFF_POSITIONS.length - 1];
      regularSlot += 1;
      stations.push(buildMallStaffStation(npc, nx, ny));
    }
  });
  return { stations, decorations: mallShopDeskDecorations() };
}

// Rebuilds whichever interior room is currently on screen — the generic
// per-building room, or (if the player is inside one) the specific Office
// floor/Mall store sub-room — so a state change that affects who's
// visible there (Divorce, a successful Propose) shows up immediately
// instead of only after the player leaves and re-enters. Mirrors each
// sub-room's own InteriorScene construction so it stays that same
// sub-room instead of silently resetting to the Lobby/Mall floor.
function rebuildCurrentInteriorScene() {
  if (scene.type !== "interior") return;
  if (scene.officeFloor !== undefined) {
    const room = buildOfficeFloorRoom(scene.officeFloor);
    scene = {
      type: "interior",
      lot: scene.lot,
      interior: new InteriorScene(scene.lot, room.stations, undefined, room.decorations, false),
      officeFloor: scene.officeFloor,
    };
  } else if (scene.mallStore !== undefined) {
    const room = buildMallStoreRoom(scene.mallStore);
    scene = {
      type: "interior",
      lot: scene.lot,
      interior: new InteriorScene(scene.lot, room.stations, undefined, room.decorations),
      mallStore: scene.mallStore,
    };
  } else {
    scene = { type: "interior", lot: scene.lot, interior: buildInteriorScene(scene.lot) };
  }
}

function getRelationshipScore(npcId: string): number {
  return playerState.contacts[npcId] ?? 0;
}

function bumpRelationship(npcId: string, delta: number) {
  playerState.contacts[npcId] = Math.max(0, getRelationshipScore(npcId) + delta);
}

function getRomanceScore(npcId: string): number {
  return playerState.romanceScores[npcId] ?? 0;
}

function bumpRomance(npcId: string, delta: number) {
  playerState.romanceScores[npcId] = Math.max(0, getRomanceScore(npcId) + delta);
}

// Marriage System: monogamy — once married to anyone, every other
// romance-eligible NPC becomes off-limits for Flirty/Date/Ask Her
// Out/Propose (platonic Talk/Regular Meetups stay fine).
function isPlayerMarried(): boolean {
  return Object.values(playerState.married).some(Boolean);
}
function isRomanceLockedOut(npc: NpcDef): boolean {
  if (!npc.romanceEligible) return false;
  // Break Up/Divorce: permanent, regardless of anyone's marriage status —
  // she's a non-romance character from here on, same as a friend-only NPC.
  if (playerState.romanceEnded[npc.id]) return true;
  return isPlayerMarried() && !playerState.married[npc.id];
}

// Marriage System: the moment you marry someone, every OTHER
// romance-eligible NPC's Romance score gets knocked down to 20 if it was
// higher (left untouched if it was already lower) — you don't get to keep
// a near-maxed Romance meter with someone else banked for whenever you
// eventually divorce. Her Contacts entry also hides the Romance bar
// entirely while locked out (see getContacts) and picks back up from
// wherever this leaves it once divorced.
function capOtherRomanceScoresOnMarriage(spouseId: string) {
  for (const npc of ALL_NPCS) {
    if (!npc.romanceEligible || npc.id === spouseId) continue;
    if (getRomanceScore(npc.id) > 20) playerState.romanceScores[npc.id] = 20;
  }
}

// Family System: 50/50 every time, independent per child.
function rollGender(): "boy" | "girl" {
  return Math.random() < 0.5 ? "boy" : "girl";
}

// Adds a new, not-yet-named child to motherId's household — she shows up
// as her own station at Home (see getChildStations) with a placeholder
// name until the player names her there (see openNameChildDialogue).
function spawnChild(motherId: string): Child {
  const gender = rollGender();
  const child: Child = {
    id: `${motherId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: gender === "boy" ? "Unnamed Baby Boy" : "Unnamed Baby Girl",
    gender,
    named: false,
  };
  playerState.children[motherId] = [...(playerState.children[motherId] ?? []), child];
  return child;
}

function findChildById(childId: string): { motherId: string; child: Child } | null {
  for (const motherId of Object.keys(playerState.children)) {
    const child = playerState.children[motherId].find((c) => c.id === childId);
    if (child) return { motherId, child };
  }
  return null;
}

let childNameDraft = "";

/** A brand-new, unnamed child's station opens straight into naming her instead of the normal greeting. */
function openChildDialogue(child: Child) {
  if (!child.named) {
    openNameChildDialogue(child);
    return;
  }
  dialogueBox.open(() => ({
    portrait: child.gender === "boy" ? "👦" : "👧",
    name: child.name,
    text: `${child.name} looks up at you and grins.`,
    options: [{ id: "leave", label: "Leave", onSelect: () => dialogueBox.close() }],
  }));
}

function openNameChildDialogue(child: Child) {
  childNameDraft = "";
  dialogueBox.open(() => ({
    portrait: child.gender === "boy" ? "👦" : "👧",
    name: "???",
    text: `It's a ${child.gender}! What do you want to name ${child.gender === "boy" ? "him" : "her"}?`,
    options: [],
    textInput: {
      value: childNameDraft,
      placeholder: "Enter a name",
      submitLabel: "Name",
      onChange: (v) => {
        childNameDraft = v;
      },
      onSubmit: () => {
        const trimmed = childNameDraft.trim();
        if (!trimmed) return;
        child.name = trimmed.slice(0, 20);
        child.named = true;
        dialogueBox.close();
        // Refresh so her station's label picks up the real name right away.
        if (scene.type === "interior") {
          scene = { type: "interior", lot: scene.lot, interior: buildInteriorScene(scene.lot) };
        }
      },
    },
  }));
}

// Marriage System: shared by both the regular Actions menu and the meetup
// dialogue (Propose is allowed at her regular location OR on a date). Ring
// is only spent on success — a "Too soon" decline costs nothing.
function resolveProposeAttempt(npc: NpcDef): string {
  const rules = npc.actions!;
  const result = rules.propose(getRelationshipScore(npc.id), getRomanceScore(npc.id), playerState.dateCounts[npc.id] ?? 0);
  if (result.success) {
    playerState.giftInventory.ring = getGiftCount("ring") - 1;
    playerState.married[npc.id] = true;
    // She brings any kid(s) she already had straight in with her, the day
    // she moves in — future ones (see checkForNewKids) count from here.
    const existingKids = npc.familyInfo?.kidsHas ?? 0;
    for (let i = 0; i < existingKids; i++) spawnChild(npc.id);
    playerState.marriageCampNumber[npc.id] = campCycle.campNumber;
    capOtherRomanceScoresOnMarriage(npc.id);
  }
  return result.message;
}

// Marriage System: called whenever a full camp cycle just completed (the
// game just wrapped back to "No Fight Scheduled") — one new kid arrives
// per married NPC for every 3 full cycles since the wedding, up to her
// familyInfo.kidsWants total. Returns a flavor line per NPC who just had
// one, for the caller to fold into its own toast/message.
function checkForNewKids(): string[] {
  const messages: string[] = [];
  for (const npcId of Object.keys(playerState.married)) {
    if (!playerState.married[npcId]) continue;
    const npc = getNpcById(npcId);
    const info = npc?.familyInfo;
    if (!npc || !info) continue;
    const baseline = playerState.marriageCampNumber[npcId] ?? campCycle.campNumber;
    const elapsedCycles = campCycle.campNumber - baseline;
    const wantedFromUnion = Math.max(0, info.kidsWants - info.kidsHas);
    const dueFromUnion = Math.min(Math.floor(elapsedCycles / 3), wantedFromUnion);
    let bornFromUnionSoFar = Math.max(0, (playerState.children[npcId]?.length ?? 0) - info.kidsHas);
    while (dueFromUnion > bornFromUnionSoFar) {
      spawnChild(npcId);
      bornFromUnionSoFar += 1;
      const total = playerState.children[npcId].length;
      messages.push(`👶 ${npc.name} welcomes a new baby! You two now have ${total} kid${total === 1 ? "" : "s"}.`);
    }
  }
  return messages;
}

type DialogueView =
  | "main"
  | "talk-categories"
  | "talk-flirty-sub"
  | "talk-topics"
  | "married-talk"
  | "talk-response"
  | "actions"
  | "actions-gift-picker"
  | "actions-askherout-confirm"
  | "actions-propose-confirm"
  | "actions-breakup-confirm"
  | "actions-divorce-confirm"
  | "actions-response"
  | "not-written";
let dialogueView: DialogueView = "main";
let activeNpc: NpcDef | null = null;
let activeCategory: TalkCategory | null = null;
let activeFlirtySub: FlirtySubcategory | null = null;
let lastTalkResult = "";
let lastActionResult = "";
// Divorce and a successful Propose both end the interaction outright — she's
// gone from the game (Propose: moved to Home) or off the market either way,
// so the response screen shouldn't be navigable back into "main" and let the
// player keep talking to her as if nothing happened. Set true right before
// showing the "actions-response" screen for exactly those two cases, and
// consumed (reset false) the moment Continue is pressed.
let lastActionEndsDialogue = false;

// "Hire Manager" is a shared business function, not tied to either
// receptionist specifically — Coach/Cutman hiring and Upgrade Gym have
// moved to the Manager Desk (see buildTeamFacilitiesMenu).
function receptionSharedOptions(): DialogueOption[] {
  return [
    {
      id: "hire-manager",
      label: "Hire Manager",
      onSelect: () => {
        dialogueBox.close();
        receptionView = "manager";
        locationMenu.open(buildReceptionMenu);
      },
    },
  ];
}

function buildDialogueMain(npc: NpcDef, extraOptions: DialogueOption[]): DialogueData {
  const tier = getRelationshipTier(getRelationshipScore(npc.id));
  // Office-specific: Carol acknowledges Priya's absence (Meetup System
  // spec's "consistency rule"), overriding her normal tiered greeting
  // while it's active — flavor depends on why Priya's away.
  const greeting = (() => {
    if (npc.id !== "carol") return npc.greetings[tier];
    const commuteStep = playerState.overnightCommuteStep["priya"];
    if (commuteStep !== undefined && commuteStep < 2) {
      return "Priya's late to work — I'm honestly surprised, that's not like her.";
    }
    if (playerState.activeMeetup?.npcId === "priya") {
      return "Priya stepped out for a bit — something personal, she said. Just me holding down the fort.";
    }
    return npc.greetings[tier];
  })();
  // Marriage System: a persistent, always-visible readout of how many
  // kids you two have so far, out of how many she wants total.
  const kidsNote =
    playerState.married[npc.id] && npc.familyInfo
      ? ` (Kids: ${playerState.children[npc.id]?.length ?? npc.familyInfo.kidsHas}/${npc.familyInfo.kidsWants})`
      : "";
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: greeting + kidsNote,
    options: [
      {
        id: "talk",
        label: "Talk",
        onSelect: () => {
          if (npc.dialogueWritten === false) {
            dialogueView = "not-written";
          } else {
            // Married Home Talk (replaces the normal tiered system at Home).
            dialogueView = playerState.married[npc.id] ? "married-talk" : "talk-categories";
          }
        },
      },
      ...(npc.hideActions
        ? []
        : [
            {
              id: "actions",
              label: "Actions",
              onSelect: () => {
                dialogueView = npc.dialogueWritten === false ? "not-written" : "actions";
              },
            },
          ]),
      ...extraOptions,
      { id: "leave", label: "Leave", onSelect: () => dialogueBox.close() },
    ],
  };
}

// "Talk" opens a category menu first (Small Talk always, Personal from
// Acquaintance, Heart to Heart from Friend for everyone, Flirty from
// Friend but romance-eligible NPCs only) — locked/ineligible categories
// are omitted entirely rather than shown disabled, per spec.
function buildDialogueTalkCategories(npc: NpcDef): DialogueData {
  const tier = getRelationshipTier(getRelationshipScore(npc.id));
  const categories: { id: TalkCategory; label: string }[] = [{ id: "smalltalk", label: "Small Talk" }];
  if (isCategoryUnlocked("personal", tier, npc.romanceEligible)) categories.push({ id: "personal", label: "Personal" });
  if (isCategoryUnlocked("hearttoheart", tier, npc.romanceEligible)) {
    categories.push({ id: "hearttoheart", label: "Heart to Heart" });
  }
  // Married to someone else — every other romance-eligible NPC loses
  // Flirty entirely, not just Ask Her Out/Propose/Date.
  if (isCategoryUnlocked("flirty", tier, npc.romanceEligible) && !isRomanceLockedOut(npc)) {
    categories.push({ id: "flirty", label: "Flirty" });
  }
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `Social Battery: ${socialBattery.remaining}/100`,
    options: [
      ...categories.map((c) => ({
        id: c.id,
        label: c.label,
        onSelect: () => {
          activeCategory = c.id;
          dialogueView = c.id === "flirty" ? "talk-flirty-sub" : "talk-topics";
        },
      })),
      {
        id: "back",
        label: "‹ Back",
        onSelect: () => {
          dialogueView = "main";
        },
      },
    ],
  };
}

// Flirty's own sub-menu (Compliment/Charm) — only ever reached for
// romance-eligible NPCs, since Flirty itself is hidden otherwise.
function buildDialogueFlirtySub(npc: NpcDef): DialogueData {
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `Social Battery: ${socialBattery.remaining}/100`,
    options: [
      {
        id: "compliment",
        label: "Compliment",
        onSelect: () => {
          activeFlirtySub = "compliment";
          dialogueView = "talk-topics";
        },
      },
      {
        id: "charm",
        label: "Charm",
        onSelect: () => {
          activeFlirtySub = "charm";
          dialogueView = "talk-topics";
        },
      },
      {
        id: "back",
        label: "‹ Back",
        onSelect: () => {
          dialogueView = "talk-categories";
        },
      },
    ],
  };
}

function topicsForActiveCategory(npc: NpcDef): TalkTopicDef[] {
  if (activeCategory === "personal") return npc.personalTopics;
  if (activeCategory === "hearttoheart") return npc.heartToHeartTopics;
  if (activeCategory === "flirty") return activeFlirtySub === "charm" ? npc.flirtyCharmTopics : npc.flirtyComplimentTopics;
  return npc.smallTalkTopics;
}

function buildDialogueTalkTopics(npc: NpcDef): DialogueData {
  const tier = getRelationshipTier(getRelationshipScore(npc.id));
  const topics = topicsForActiveCategory(npc);
  const affordable = socialBattery.canAfford(20);
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `Social Battery: ${socialBattery.remaining}/100`,
    options: [
      ...topics.map((topic) => ({
        id: topic.id,
        label: topic.label,
        costLabel: "20 SB",
        disabled: !affordable,
        onSelect: () => {
          if (!socialBattery.spend(20)) return;
          if (topic.special === "family-reveal" && npc.familyInfo) {
            // Marriage System: purely informational — no Relationship/
            // Romance change, and can be asked again any time it's unlocked.
            lastTalkResult = formatFamilyReveal(npc.familyInfo, tier);
            dialogueView = "talk-response";
            return;
          }
          const delta = getTopicDelta(topic, tier);
          bumpRelationship(npc.id, delta);
          let resultText = formatTopicResult(delta);
          // Positive Flirty picks (Compliment/Charm) also build the
          // Romance meter, separate from the Relationship bar above.
          if (activeCategory === "flirty" && delta > 0) {
            bumpRomance(npc.id, FLIRTY_ROMANCE_DELTA);
            resultText += ` / ${formatRomanceResult(FLIRTY_ROMANCE_DELTA)}`;
          }
          lastTalkResult = resultText;
          dialogueView = "talk-response";
        },
      })),
      {
        id: "back",
        label: "‹ Back",
        onSelect: () => {
          dialogueView = activeCategory === "flirty" ? "talk-flirty-sub" : "talk-categories";
        },
      },
    ],
  };
}

// Married Home Talk: once married, the tiered Small Talk/Personal/Heart to
// Heart/Flirty structure at Home stops applying — the relationship's
// already at its peak, nothing left to build toward — and Talk becomes
// this flat, always-available set instead (no tier gating, same flat SB
// cost as any other topic pick).
const MARRIED_TALK_DELTA = 8;
const MARRIED_TALK_TOPICS: { id: string; label: string }[] = [
  { id: "day", label: "Talk About Your Day" },
  { id: "advice", label: "Ask for Her Advice" },
  { id: "checkin", label: "Check In On Her" },
  { id: "romantic", label: "Be Romantic" },
];

function buildDialogueMarriedTalk(npc: NpcDef): DialogueData {
  const affordable = socialBattery.canAfford(20);
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `Social Battery: ${socialBattery.remaining}/100`,
    options: [
      ...MARRIED_TALK_TOPICS.map((topic) => ({
        id: topic.id,
        label: topic.label,
        costLabel: "20 SB",
        disabled: !affordable,
        onSelect: () => {
          if (!socialBattery.spend(20)) return;
          bumpRelationship(npc.id, MARRIED_TALK_DELTA);
          lastTalkResult = formatTopicResult(MARRIED_TALK_DELTA);
          dialogueView = "talk-response";
        },
      })),
      {
        id: "back",
        label: "‹ Back",
        onSelect: () => {
          dialogueView = "main";
        },
      },
    ],
  };
}

function buildDialogueTalkResponse(npc: NpcDef): DialogueData {
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: lastTalkResult,
    options: [
      {
        id: "continue",
        label: "Continue",
        onSelect: () => {
          dialogueView = "main";
        },
      },
    ],
  };
}

// Shared by the normal Actions menu and Married Home Actions — same
// button/behavior either way.
function buildInviteToFightOption(npc: NpcDef): DialogueOption {
  const tier = getRelationshipTier(getRelationshipScore(npc.id));
  const tooEarly = !!npc.inviteToFightMinTier && !tierAtLeast(tier, npc.inviteToFightMinTier);
  return {
    id: "invite-fight",
    label: "Invite to Next Fight",
    costLabel: tooEarly
      ? "NOT INTERESTED"
      : playerState.fightInvites[npc.id]
        ? "INVITED"
        : !playerState.fightScheduled
          ? "NO FIGHT"
          : `${INVITE_TO_FIGHT_COST} EN`,
    disabled:
      tooEarly ||
      !!playerState.fightInvites[npc.id] ||
      !playerState.fightScheduled ||
      !energy.canAfford(INVITE_TO_FIGHT_COST),
    onSelect: () => {
      if (tooEarly || playerState.fightInvites[npc.id] || !playerState.fightScheduled) return;
      if (!energy.spend(INVITE_TO_FIGHT_COST)) return;
      playerState.fightInvites[npc.id] = true;
      bumpRelationship(npc.id, INVITE_TO_FIGHT_DELTA);
      // Pronoun-free — this button's shared by every NPC, not just the
      // romance-eligible ones.
      lastActionResult = `"I'll be there." (${formatTopicResult(INVITE_TO_FIGHT_DELTA)})`;
      dialogueView = "actions-response";
    },
  };
}

// Married Home Actions (replaces the normal Actions menu at Home once
// married): Exchange Number/Ask Her Out/Propose are all moot by now, so
// this is its own flat set instead.
const INVEST_BUSINESS_COST = 2000;
const INVEST_BUSINESS_DELTA = 15;
const HAVE_DRINK_COST = 15;
const HAVE_DRINK_DELTA = 8;

function buildMarriedHomeActions(npc: NpcDef): DialogueData {
  const hasGift = totalGiftsOwned() > 0;
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `Energy: ${energy.remaining}/100  ·  Money: $${playerState.money}  ·  Gifts owned: ${totalGiftsOwned()}`,
    options: [
      {
        id: "gift",
        label: "Gift",
        costLabel: hasGift ? undefined : "NO GIFTS",
        disabled: !hasGift,
        onSelect: () => {
          if (!hasGift) return;
          dialogueView = "actions-gift-picker";
        },
      },
      {
        id: "invest-business",
        label: "Invest in her Business",
        costLabel: `$${INVEST_BUSINESS_COST}`,
        disabled: playerState.money < INVEST_BUSINESS_COST,
        onSelect: () => {
          if (playerState.money < INVEST_BUSINESS_COST) return;
          playerState.money -= INVEST_BUSINESS_COST;
          bumpRelationship(npc.id, INVEST_BUSINESS_DELTA);
          lastActionResult = `She's moved by your support. "This means so much." (${formatTopicResult(INVEST_BUSINESS_DELTA)})`;
          dialogueView = "actions-response";
        },
      },
      {
        id: "have-drink",
        label: "Have a Drink Together",
        costLabel: `${HAVE_DRINK_COST} EN`,
        disabled: !energy.canAfford(HAVE_DRINK_COST),
        onSelect: () => {
          if (!energy.spend(HAVE_DRINK_COST)) return;
          bumpRelationship(npc.id, HAVE_DRINK_DELTA);
          lastActionResult = `You two unwind together after a long day. (${formatTopicResult(HAVE_DRINK_DELTA)})`;
          dialogueView = "actions-response";
        },
      },
      {
        id: "divorce",
        label: "Divorce",
        onSelect: () => {
          dialogueView = "actions-divorce-confirm";
        },
      },
      {
        id: "back",
        label: "‹ Back",
        onSelect: () => {
          dialogueView = "main";
        },
      },
    ],
  };
}

// "Actions" — Energy-Star-costed relationship progression, separate from
// Talk's Social-Battery-gated topics. Always visible from Tier 1; outcomes
// (success/reaction) come from the NPC's own actions rules.
function buildDialogueActions(npc: NpcDef): DialogueData {
  if (playerState.married[npc.id]) return buildMarriedHomeActions(npc);
  const score = getRelationshipScore(npc.id);
  const tier = getRelationshipTier(score);
  const rules = npc.actions!;
  const hasNumber = !!playerState.exchangedNumbers[npc.id];
  const affordExchange = energy.canAfford(EXCHANGE_NUMBER_COST);
  const hasGift = totalGiftsOwned() > 0;
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `Energy: ${energy.remaining}/100  ·  Gifts owned: ${totalGiftsOwned()}`,
    options: [
      ...(npc.hideExchangeNumber
        ? []
        : [
            {
              id: "exchange-number",
              label: "Exchange Number",
              costLabel: hasNumber ? "HAVE IT" : `${EXCHANGE_NUMBER_COST} EN`,
              disabled: hasNumber || !affordExchange,
              onSelect: () => {
                if (hasNumber || !energy.spend(EXCHANGE_NUMBER_COST)) return;
                const result = rules.exchangeNumber(tier, score);
                bumpRelationship(npc.id, result.delta);
                if (result.success) playerState.exchangedNumbers[npc.id] = true;
                lastActionResult = `${result.message} (${formatTopicResult(result.delta)})`;
                dialogueView = "actions-response";
              },
            },
          ]),
      {
        id: "give-gift",
        label: "Give a Gift",
        costLabel: hasGift ? undefined : "NO GIFTS",
        disabled: !hasGift,
        onSelect: () => {
          if (!hasGift) return;
          dialogueView = "actions-gift-picker";
        },
      },
      ...(npc.hideInviteToFight ? [] : [buildInviteToFightOption(npc)]),
      ...(npc.romanceEligible && !isRomanceLockedOut(npc)
        ? [
            {
              id: "ask-her-out",
              label: "Ask Her Out",
              costLabel: playerState.romanceEnded[npc.id]
                ? "OVER"
                : playerState.dating[npc.id]
                  ? "DATING"
                  : `${ASK_HER_OUT_COST} EN`,
              disabled:
                !!playerState.romanceEnded[npc.id] ||
                !!playerState.dating[npc.id] ||
                !energy.canAfford(ASK_HER_OUT_COST),
              onSelect: () => {
                if (playerState.romanceEnded[npc.id] || playerState.dating[npc.id] || !energy.canAfford(ASK_HER_OUT_COST))
                  return;
                dialogueView = "actions-askherout-confirm";
              },
            },
          ]
        : []),
      // Break Up: only ever shown while actually Dating her — unlike every
      // other Action here, it's not visible before that at all. Also hidden
      // once married to someone ELSE (isRomanceLockedOut) — there's nothing
      // to break up when the relationship already got silently demoted to
      // friend status by the marriage; she stays a friend either way.
      ...(playerState.dating[npc.id] && !isRomanceLockedOut(npc)
        ? [
            {
              id: "break-up",
              label: "Break Up",
              onSelect: () => {
                dialogueView = "actions-breakup-confirm";
              },
            },
          ]
        : []),
      {
        id: "back",
        label: "‹ Back",
        onSelect: () => {
          dialogueView = "main";
        },
      },
    ],
  };
}

// Marriage System: the Engagement Ring is just another entry in this list
// — picking it doesn't hand it over immediately like a normal gift, it
// opens a Yes/No propose confirmation instead (buildDialogueActionsProposeConfirm).
function buildDialogueActionsGiftPicker(npc: NpcDef): DialogueData {
  const tier = getRelationshipTier(getRelationshipScore(npc.id));
  const canProposeHere = npc.romanceEligible && !isRomanceLockedOut(npc) && !playerState.married[npc.id];
  const owned = GIFT_CATALOG.filter((g) => getGiftCount(g.id) > 0 && isGiftGivableToNpc(npc, g, canProposeHere));
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `Energy: ${energy.remaining}/100 — which gift?`,
    // Grid, not a list — up to all 16 catalog items can be owned at once
    // for a romance-eligible NPC, which doesn't fit a one-per-row list.
    optionsLayout: "grid",
    options: [
      ...owned.map((g) => ({
        id: g.id,
        icon: g.icon,
        label: `${g.name} (${getGiftCount(g.id)})`,
        costLabel: g.isRing ? undefined : `${GIVE_GIFT_COST} EN`,
        disabled: !g.isRing && !energy.canAfford(GIVE_GIFT_COST),
        onSelect: () => {
          if (g.isRing) {
            dialogueView = "actions-propose-confirm";
            return;
          }
          if (!energy.spend(GIVE_GIFT_COST)) return;
          playerState.giftInventory[g.id] = getGiftCount(g.id) - 1;
          const result = npc.actions!.giftReaction(tier, g.category, g.id);
          bumpRelationship(npc.id, result.delta);
          lastActionResult = `${result.message} (${formatTopicResult(result.delta)})`;
          dialogueView = "actions-response";
        },
      })),
      {
        id: "back",
        icon: "↩️",
        label: "Back",
        onSelect: () => {
          dialogueView = "actions";
        },
      },
    ],
  };
}

// Confirms before the attempt happens (win or lose still costs the Energy
// and still counts as an attempt) rather than firing it straight off the
// Actions menu tap — same "are you sure" beat as Propose/Break Up/Divorce.
function buildDialogueActionsAskHerOutConfirm(npc: NpcDef): DialogueData {
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `Do you want to pursue romance with ${npc.name}?`,
    options: [
      {
        id: "yes",
        label: "Yes",
        costLabel: `${ASK_HER_OUT_COST} EN`,
        disabled: !energy.canAfford(ASK_HER_OUT_COST),
        onSelect: () => {
          if (!energy.spend(ASK_HER_OUT_COST)) return;
          const result = npc.actions!.askHerOut(getRomanceScore(npc.id));
          if (result.success) playerState.dating[npc.id] = true;
          lastActionResult = result.success
            ? `${result.message} 💕 You're dating now — her Romance meter is visible in Contacts.`
            : result.message;
          dialogueView = "actions-response";
        },
      },
      {
        id: "no",
        label: "No",
        onSelect: () => {
          dialogueView = "actions";
        },
      },
    ],
  };
}

function buildDialogueActionsProposeConfirm(npc: NpcDef): DialogueData {
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `Do you want to propose to ${npc.name}?`,
    options: [
      {
        id: "yes",
        label: "Yes",
        costLabel: `${PROPOSE_COST} EN`,
        disabled: !energy.canAfford(PROPOSE_COST),
        onSelect: () => {
          if (!energy.spend(PROPOSE_COST)) return;
          lastActionResult = resolveProposeAttempt(npc);
          if (playerState.married[npc.id]) {
            // She just said yes — she's moved to Home and off her regular
            // station this instant, not once the player happens to close
            // this dialogue and wander back later.
            lastActionEndsDialogue = true;
            rebuildCurrentInteriorScene();
          }
          dialogueView = "actions-response";
        },
      },
      {
        id: "no",
        label: "No",
        onSelect: () => {
          dialogueView = "actions-gift-picker";
        },
      },
    ],
  };
}

// Romance System's terminal state: no negotiation, no negative
// consequence beyond the permanent lock itself — "Are you sure? You
// won't be able to date her again" either way.
function buildDialogueActionsBreakupConfirm(npc: NpcDef): DialogueData {
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: "Are you sure? You won't be able to date her again.",
    options: [
      {
        id: "yes",
        label: "Yes",
        onSelect: () => {
          playerState.dating[npc.id] = false;
          playerState.romanceEnded[npc.id] = true;
          // Relationship resets to Tier 2 (Acquaintance) — she's a
          // non-romance character from here on, same as any friend-only
          // NPC, but not a total stranger again.
          playerState.contacts[npc.id] = 20;
          lastActionResult = `You and ${npc.name} have broken up. You're just friends now.`;
          dialogueView = "actions-response";
        },
      },
      {
        id: "no",
        label: "No",
        onSelect: () => {
          dialogueView = "actions";
        },
      },
    ],
  };
}

function buildDialogueActionsDivorceConfirm(npc: NpcDef): DialogueData {
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: "Are you sure? You won't be able to date her again.",
    options: [
      {
        id: "yes",
        label: "Yes",
        onSelect: () => {
          const kidCount = playerState.children[npc.id]?.length ?? 0;
          playerState.married[npc.id] = false;
          playerState.dating[npc.id] = false;
          playerState.romanceEnded[npc.id] = true;
          // She's gone from the game entirely — not just off the market
          // like Break Up leaves her (see isNpcAway/getContacts).
          playerState.divorced[npc.id] = true;
          delete playerState.children[npc.id];
          delete playerState.marriageCampNumber[npc.id];
          if (kidCount > 0) {
            playerState.divorceChildSupportPercent += kidCount * 10;
          }
          lastActionResult =
            `The divorce is final. ${npc.name} and the kids are gone for good.` +
            (kidCount > 0
              ? ` You now owe ${playerState.divorceChildSupportPercent}% of every future Purse in child support.`
              : "");
          // Gone this instant, not once the player happens to close this
          // dialogue — she shouldn't still be talkable as a wife in the
          // meantime.
          lastActionEndsDialogue = true;
          rebuildCurrentInteriorScene();
          dialogueView = "actions-response";
        },
      },
      {
        id: "no",
        label: "No",
        onSelect: () => {
          dialogueView = "actions";
        },
      },
    ],
  };
}

function buildDialogueActionsResponse(npc: NpcDef): DialogueData {
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: lastActionResult,
    options: [
      {
        id: "continue",
        label: "Continue",
        onSelect: () => {
          if (lastActionEndsDialogue) {
            lastActionEndsDialogue = false;
            dialogueBox.close();
            return;
          }
          dialogueView = "main";
        },
      },
    ],
  };
}

function buildDialogueNotWritten(npc: NpcDef): DialogueData {
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: "Dialogue not written yet.",
    options: [
      {
        id: "back",
        label: "‹ Back",
        onSelect: () => {
          dialogueView = "main";
        },
      },
    ],
  };
}

function openNpcDialogue(npc: NpcDef, extraOptions: DialogueOption[] = []) {
  activeNpc = npc;
  dialogueView = "main";
  activeCategory = null;
  activeFlirtySub = null;
  dialogueBox.open(() => {
    if (dialogueView === "talk-categories") return buildDialogueTalkCategories(activeNpc!);
    if (dialogueView === "talk-flirty-sub") return buildDialogueFlirtySub(activeNpc!);
    if (dialogueView === "talk-topics") return buildDialogueTalkTopics(activeNpc!);
    if (dialogueView === "married-talk") return buildDialogueMarriedTalk(activeNpc!);
    if (dialogueView === "talk-response") return buildDialogueTalkResponse(activeNpc!);
    if (dialogueView === "actions") return buildDialogueActions(activeNpc!);
    if (dialogueView === "actions-gift-picker") return buildDialogueActionsGiftPicker(activeNpc!);
    if (dialogueView === "actions-askherout-confirm") return buildDialogueActionsAskHerOutConfirm(activeNpc!);
    if (dialogueView === "actions-propose-confirm") return buildDialogueActionsProposeConfirm(activeNpc!);
    if (dialogueView === "actions-breakup-confirm") return buildDialogueActionsBreakupConfirm(activeNpc!);
    if (dialogueView === "actions-divorce-confirm") return buildDialogueActionsDivorceConfirm(activeNpc!);
    if (dialogueView === "actions-response") return buildDialogueActionsResponse(activeNpc!);
    if (dialogueView === "not-written") return buildDialogueNotWritten(activeNpc!);
    return buildDialogueMain(activeNpc!, extraOptions);
  });
}

// Meetup System (v4): the in-person side of an arranged Regular Meetup or
// Date. She stays visible in the scene for the whole visit — picking an
// option doesn't end it. Both types show the same "Connect" button,
// leading to that type's own 4-option list (Regular's General options or
// Date's boldness scale). Connect and Give a Gift are each single-use per
// visit; the visit itself only ends via "End Meetup"/"End Date" or a
// confirmed door-exit (see openEndMeetupConfirm) — both routed through
// endMeetupVisit.
type MeetupDialogueView = "main" | "connect-options" | "gift-options" | "propose-confirm" | "response";
let meetupDialogueView: MeetupDialogueView = "main";
let meetupConnectUsedThisVisit = false;
let meetupGiftUsedThisVisit = false;
let lastMeetupResult = "";
let lastMeetupWasOvernight = false;
// Marriage System: Propose is also allowed mid-meetup, not just from her
// regular location's Actions menu. A success ends the visit outright (like
// End Date) since there's nothing left to do — she's moving in.
let lastMeetupWasMarried = false;

function resolveMeetupProposePick(npc: NpcDef) {
  lastMeetupWasOvernight = false;
  meetupGiftUsedThisVisit = true; // proposing with the ring spends the visit's one Gift action, win or lose
  lastMeetupResult = resolveProposeAttempt(npc);
  lastMeetupWasMarried = !!playerState.married[npc.id];
  meetupDialogueView = "response";
}

function resolveConnectPick(npc: NpcDef, location: MeetupLocationId, type: MeetupType, option: MeetupOptionDef) {
  meetupConnectUsedThisVisit = true;
  lastMeetupWasOvernight = false;
  if (option.special === "overnight-stay") {
    lastMeetupWasOvernight = true;
    lastMeetupResult = resolveOvernightStay(npc.id);
  } else if (type === "date") {
    // Home doesn't normally count toward its own unlock — only "other
    // locations" do — unless this NPC opts in (see homeDatesCountTowardDates).
    if (location !== "home" || npc.homeDatesCountTowardDates) {
      playerState.dateCounts[npc.id] = (playerState.dateCounts[npc.id] ?? 0) + 1;
    }
    bumpRomance(npc.id, MEETUP_CONNECT_DELTA);
    lastMeetupResult = formatRomanceResult(MEETUP_CONNECT_DELTA);
  } else {
    bumpRelationship(npc.id, MEETUP_CONNECT_DELTA);
    lastMeetupResult = formatTopicResult(MEETUP_CONNECT_DELTA);
  }
  meetupDialogueView = "response";
}

function resolveGiftPick(npc: NpcDef, type: MeetupType, giftId: string) {
  if (getGiftCount(giftId) <= 0) return; // guarded by disabled, shouldn't happen
  playerState.giftInventory[giftId] = getGiftCount(giftId) - 1;
  meetupGiftUsedThisVisit = true;
  lastMeetupWasOvernight = false;
  if (type === "date") {
    bumpRomance(npc.id, MEETUP_GIFT_DELTA);
    lastMeetupResult = formatRomanceResult(MEETUP_GIFT_DELTA);
  } else {
    bumpRelationship(npc.id, MEETUP_GIFT_DELTA);
    lastMeetupResult = formatTopicResult(MEETUP_GIFT_DELTA);
  }
  meetupDialogueView = "response";
}

/** Ends the current visit outright — penalizes leaving without ever using Connect, clears the meetup, and exits the building. Shared by "End Meetup/Date" and a confirmed door-exit. */
function endMeetupVisit() {
  const meetup = playerState.activeMeetup;
  if (meetup && !meetupConnectUsedThisVisit) {
    bumpRelationship(meetup.npcId, MEETUP_NO_CONNECT_PENALTY);
    if (meetup.type === "date") bumpRomance(meetup.npcId, MEETUP_NO_CONNECT_PENALTY);
  }
  playerState.activeMeetup = null;
  meetupConnectUsedThisVisit = false;
  meetupGiftUsedThisVisit = false;
  dialogueBox.close();
  exitBuilding();
}

function buildMeetupDialogueMain(npc: NpcDef, type: MeetupType): DialogueData {
  const hasGift = totalGiftsOwned() > 0;
  const options: DialogueOption[] = [];

  if (!meetupConnectUsedThisVisit) {
    // Same "Connect" button either way, leading to that type's 4-option
    // list — Regular's General options and Date's boldness scale are both
    // reached the same way, just with different content underneath.
    options.push({
      id: "connect",
      label: "Connect",
      onSelect: () => {
        meetupDialogueView = "connect-options";
      },
    });
  }
  if (!meetupGiftUsedThisVisit) {
    // The Engagement Ring lives in this same list (see
    // buildMeetupDialogueGiftOptions) — picking it asks to Propose instead
    // of just handing it over, same as the regular Actions menu.
    options.push({
      id: "gift",
      label: "Give a Gift",
      costLabel: hasGift ? undefined : "NO GIFTS",
      disabled: !hasGift,
      onSelect: () => {
        meetupDialogueView = "gift-options";
      },
    });
  }
  options.push({
    id: "end",
    label: type === "date" ? "End Date" : "End Meetup",
    onSelect: () => endMeetupVisit(),
  });
  options.push({ id: "leave", label: "‹ Not Now", onSelect: () => dialogueBox.close() });

  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `${npc.name} is happy to see you.`,
    options,
  };
}

function buildMeetupDialogueGiftOptions(npc: NpcDef, type: MeetupType): DialogueData {
  const canProposeHere =
    npc.romanceEligible && !!playerState.dating[npc.id] && !playerState.married[npc.id] && !isRomanceLockedOut(npc);
  const owned = GIFT_CATALOG.filter((g) => getGiftCount(g.id) > 0 && isGiftGivableToNpc(npc, g, canProposeHere));
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `${npc.name} is happy to see you.`,
    optionsLayout: "grid",
    options: [
      ...owned.map((g) => ({
        id: g.id,
        icon: g.icon,
        label: `${g.name} (${getGiftCount(g.id)})`,
        onSelect: () => {
          if (g.isRing) {
            meetupDialogueView = "propose-confirm";
            return;
          }
          resolveGiftPick(npc, type, g.id);
        },
      })),
      {
        id: "back",
        icon: "↩️",
        label: "Back",
        onSelect: () => {
          meetupDialogueView = "main";
        },
      },
    ],
  };
}

function buildMeetupDialogueProposeConfirm(npc: NpcDef): DialogueData {
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `Do you want to propose to ${npc.name}?`,
    options: [
      { id: "yes", label: "Yes", onSelect: () => resolveMeetupProposePick(npc) },
      {
        id: "no",
        label: "No",
        onSelect: () => {
          meetupDialogueView = "gift-options";
        },
      },
    ],
  };
}

function buildMeetupDialogueConnectOptions(npc: NpcDef, location: MeetupLocationId, type: MeetupType): DialogueData {
  const loc = getMeetupLocation(location);
  const connectOptions = type === "date" ? loc.dateConnect : loc.regularGeneral;
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: `${npc.name} is happy to see you.`,
    options: [
      ...connectOptions.map((o) => ({
        id: o.id,
        label: o.label,
        onSelect: () => resolveConnectPick(npc, location, type, o),
      })),
      {
        id: "back",
        label: "‹ Back",
        onSelect: () => {
          meetupDialogueView = "main";
        },
      },
    ],
  };
}

function buildMeetupDialogueResponse(npc: NpcDef): DialogueData {
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: lastMeetupResult,
    options: [
      {
        id: "continue",
        label: "Continue",
        onSelect: () => {
          if (lastMeetupWasOvernight) {
            // Overnight Stay already advanced the phase itself — the visit
            // is over; rebuild the room so she shows up as the asleep
            // overnight guest instead of the meetup NPC.
            playerState.activeMeetup = null;
            meetupConnectUsedThisVisit = false;
            meetupGiftUsedThisVisit = false;
            dialogueBox.close();
            // Wake up in the bed area with her, same as a regular sleep.
            justSleptTogether = true;
            if (scene.type === "interior") {
              scene = { type: "interior", lot: scene.lot, interior: buildInteriorScene(scene.lot, "bed") };
            }
          } else if (lastMeetupWasMarried) {
            // She just said yes — nothing left to do at this visit. Ends the
            // meetup outright, same as a normal End Date, with no penalty.
            playerState.activeMeetup = null;
            meetupConnectUsedThisVisit = false;
            meetupGiftUsedThisVisit = false;
            dialogueBox.close();
            exitBuilding();
          } else {
            meetupDialogueView = "main";
          }
        },
      },
    ],
  };
}

function openMeetupDialogue(npc: NpcDef, location: MeetupLocationId, type: MeetupType) {
  meetupDialogueView = "main";
  dialogueBox.open(() => {
    if (meetupDialogueView === "connect-options") return buildMeetupDialogueConnectOptions(npc, location, type);
    if (meetupDialogueView === "gift-options") return buildMeetupDialogueGiftOptions(npc, type);
    if (meetupDialogueView === "propose-confirm") return buildMeetupDialogueProposeConfirm(npc);
    if (meetupDialogueView === "response") return buildMeetupDialogueResponse(npc);
    return buildMeetupDialogueMain(npc, type);
  });
}

/** "Do you want to end the Date/Meetup?" — triggered by walking to the door while a meetup's active in this room. */
function openEndMeetupConfirm() {
  const meetup = playerState.activeMeetup;
  if (!meetup) return;
  const npc = getNpcById(meetup.npcId);
  const label = meetup.type === "date" ? "Date" : "Meetup";
  dialogueBox.open(() => ({
    portrait: npc?.portrait ?? "🙂",
    name: npc?.name ?? "",
    text: `Do you want to end the ${label}?`,
    options: [
      { id: "yes", label: "Yes", onSelect: () => endMeetupVisit() },
      { id: "no", label: "No", onSelect: () => dialogueBox.close() },
    ],
  }));
}

function openElevatorMenu(lot: LotInstance) {
  locationMenu.open(() => ({
    title: "🛗 Elevator",
    energyText: `Manager Level: ${playerState.managerLevel}/3`,
    actions: [1, 2, 3].map((floor) => {
      // Exclusive manager tier — the elevator only reaches whichever floor
      // matches the manager currently on staff (see buildStaffRoleMenu).
      const unlocked = playerState.managerLevel === floor;
      return {
        id: `floor-${floor}`,
        label: `Floor ${floor} — Manager's Office`,
        cost: 0,
        costLabel: unlocked ? "GO" : "LOCKED",
        disabled: !unlocked,
        run: () => {
          if (!unlocked) return `Hire the Lvl ${floor} manager at Reception first.`;
          locationMenu.close();
          const room = buildOfficeFloorRoom(floor);
          scene = {
            type: "interior",
            lot,
            interior: new InteriorScene(lot, room.stations, undefined, room.decorations, false),
            officeFloor: floor,
          };
          return "";
        },
      };
    }),
  }));
}

function sleepAtBed(anchor: { x: number; y: number }) {
  // Callers must check getBedLock() first — "No Fight Scheduled" and
  // "FIGHT NIGHT" both block sleeping entirely (see the station dispatch),
  // so by the time this runs it's always safe to advance.
  //
  // The vacation bonus only pays off during a Private Life stage (Training/
  // Promotion/Fight Night can't use more than 100 anyway). It's a 2-use
  // counter — one per Private Life stage in the camp it was booked for —
  // consumed only when actually spent, not on some later stage boundary
  // (booking happens during After Fight, and the very next sleep always
  // lands on the new camp's "No Fight Scheduled", so clearing it there
  // would wipe it out before it ever got used).
  const peekedNextStage = CAMP_SEQUENCE[(campCycle.currentIndex + 1) % CAMP_SEQUENCE.length];
  const useBonus = playerState.vacationEnergyBonusUses > 0 && peekedNextStage.type === "privatelife";
  const cap = useBonus ? MAX_ENERGY + 10 : MAX_ENERGY;
  if (useBonus) playerState.vacationEnergyBonusUses -= 1;
  const leftover = energy.sleep(cap);
  const hpGain = Math.floor(leftover / 2);
  // Sleeping out of After Fight fully restores HP (cosmetic — you're 0/0
  // there, not banking a leftover-energy buffer like every other sleep).
  if (campCycle.current.type === "afterfight") playerState.hp = 100;
  else playerState.hp += hpGain;

  const nextStage = campCycle.advance();
  clearUsedThisPhase();
  socialBattery.reset();
  // Sleeping a second time (right on top of an Overnight Stay) uses up
  // whatever energy she left behind and sends her home before the player
  // wakes — she shouldn't still be standing there next morning. The
  // currently-rendered scene's station list was frozen at entry, so
  // clearing overnightCommuteStep alone doesn't make her vanish on screen
  // until the room is rebuilt (see the identical pattern where an Overnight
  // Stay meetup response rebuilds the room).
  playerState.overnightCommuteStep = {};
  // Wake up in the bed area, not standing at the door — and if married,
  // she wakes up right there with you (see justSleptTogether/
  // applyBedPositionIfJustSlept).
  justSleptTogether = true;
  if (scene.type === "interior") {
    scene = { type: "interior", lot: scene.lot, interior: buildInteriorScene(scene.lot, "bed") };
  }
  // HP banked above 100 is pure pre-fight insurance — it never carries
  // into the fight itself as extra usable HP.
  if (nextStage.type === "fight" && playerState.hp > 100) playerState.hp = 100;
  // A fresh camp starts back at "No Fight Scheduled" — clear last camp's fight state.
  let kidMessages: string[] = [];
  if (nextStage.type === "nofight") {
    playerState.fightScheduled = false;
    playerState.cashAdvanceTaken = false;
    playerState.fightInvites = {};
    kidMessages = checkForNewKids();
  }

  buildingUI.showToast(
    `😴 Slept. +${hpGain} HP (now ${playerState.hp}). Energy refilled to ${cap}/${MAX_ENERGY}${useBonus ? " (vacation bonus!)" : ""}. Next: ${nextStage.label}.${
      kidMessages.length ? " " + kidMessages.join(" ") : ""
    }`,
    anchor,
    "bottom",
  );
}

// Home meetup's Overnight Stay (Meetup System spec): triggers the same
// phase advance as sleepAtBed (duplicated rather than shared, matching
// this file's existing pattern across sleepAtBed/Simulate Fight/debug
// jump), then marks the NPC absent from her normal spot for the newly
// arrived phase only.
function resolveOvernightStay(npcId: string): string {
  const peekedNextStage = CAMP_SEQUENCE[(campCycle.currentIndex + 1) % CAMP_SEQUENCE.length];
  const useBonus = playerState.vacationEnergyBonusUses > 0 && peekedNextStage.type === "privatelife";
  const cap = useBonus ? MAX_ENERGY + 10 : MAX_ENERGY;
  if (useBonus) playerState.vacationEnergyBonusUses -= 1;
  const leftover = energy.sleep(cap);
  const hpGain = Math.floor(leftover / 2);
  if (campCycle.current.type === "afterfight") playerState.hp = 100;
  else playerState.hp += hpGain;

  const nextStage = campCycle.advance();
  clearUsedThisPhase();
  socialBattery.reset();
  playerState.overnightCommuteStep = {};
  if (nextStage.type === "fight" && playerState.hp > 100) playerState.hp = 100;
  let kidMessages: string[] = [];
  if (nextStage.type === "nofight") {
    playerState.fightScheduled = false;
    playerState.cashAdvanceTaken = false;
    playerState.fightInvites = {};
    kidMessages = checkForNewKids();
  }
  // Asleep at home — see advanceOvernightCommute for how this counts back
  // up to normal as the player enters buildings afterward.
  playerState.overnightCommuteStep[npcId] = 0;
  bumpRomance(npcId, MEETUP_CONNECT_DELTA);
  // Overnight Stay is a Date too — counts toward Propose for whichever
  // NPCs opt in (see homeDatesCountTowardDates).
  if (getNpcById(npcId)?.homeDatesCountTowardDates) {
    playerState.dateCounts[npcId] = (playerState.dateCounts[npcId] ?? 0) + 1;
  }

  return `You wake up together the next morning. Next: ${nextStage.label}. (${formatRomanceResult(MEETUP_CONNECT_DELTA)})${
    kidMessages.length ? " " + kidMessages.join(" ") : ""
  }`;
}

// Airport (Section 5): "Go on Vacation" — $1000, only available right
// after a fight (no Fight system exists yet to ever flip
// justFinishedFight true, so this stays locked for now — see
// playerState.ts). Booking it boosts the next sleep's Energy Star refill
// to 110 instead of 100.
const VACATION_COST = 1000;

function openVacationMenu() {
  locationMenu.open(() => {
    const available = playerState.justFinishedFight;
    return {
      title: "✈️ Go on Vacation",
      energyText: available
        ? `Money: $${playerState.money}`
        : "Available right after a fight (Fight system not built yet).",
      actions: [
        {
          id: "vacation",
          label: "Go on Vacation",
          cost: 0,
          costLabel: available ? `$${VACATION_COST}` : "LOCKED",
          disabled: !available,
          run: () => {
            if (!available) return "You can only go on vacation right after a fight.";
            if (playerState.money < VACATION_COST) {
              return `Not enough money — need $${VACATION_COST}, have $${playerState.money}.`;
            }
            playerState.money -= VACATION_COST;
            playerState.vacationEnergyBonusUses = 2;
            playerState.justFinishedFight = false;
            playerState.hp = 100;
            return "Vacation booked! HP restored to 100 (Energy stays 0 until you sleep). Both Private Life stages this camp will refill Energy to 110 instead of 100.";
          },
        },
      ],
    };
  });
}

// Arena (Section 8): no Fight system yet, so this is a placeholder that
// resolves FIGHT NIGHT — draining Energy to 0 (simulating the exhaustion
// of a real fight) and unlocking the Airport's Vacation for After Fight.
function openSimulateFightMenu() {
  locationMenu.open(() => {
    const isFightNight = campCycle.current.type === "fight";
    return {
      title: "🏟️ Simulate Fight",
      energyText: isFightNight
        ? "No real Fight system yet — this resolves the night and moves you into recovery."
        : `Not fight night yet (currently "${campCycle.current.label}").`,
      actions: [
        {
          id: "simulate",
          label: "Simulate Fight",
          cost: 0,
          costLabel: isFightNight ? "GO" : "N/A",
          disabled: !isFightNight,
          run: () => {
            if (!isFightNight) return "It's not fight night yet.";
            energy.spend(energy.remaining);
            playerState.hp = 0;
            playerState.justFinishedFight = true;
            const nextStage = campCycle.advance();
            clearUsedThisPhase();
            socialBattery.reset();
            playerState.overnightCommuteStep = {};
            return `Fight simulated! You're exhausted (0 Energy, 0 HP). Next: ${nextStage.label}.`;
          },
        },
      ],
    };
  });
}

// Mall (Section 5): mostly money-only, cosmetic — the spec flags the whole
// section "not v1" but it's being built now anyway. Vehicle/Pet are
// one-time owned collectibles with no stat effect yet; Clothes is a
// repeatable Image-for-money buy; Gift Shop stocks items with nowhere to
// go until the NPC/romance system exists; Furniture is browse-only per
// spec, purchases deferred to the Phone.
interface ShopItem {
  id: string;
  name: string;
  price: number;
}

// Vehicle Dealer (Section 5, updated): real gameplay mechanics, not just
// cosmetic. The player can own several vehicles at once — buying one adds
// it to vehiclesOwned and makes it active; an already-owned vehicle can be
// re-selected as active any time, no repurchase needed. Higher tiers stack
// skillsets rather than replacing the lower one.
type VehicleSkillset = "speed" | "reverse" | "autopilot";
interface VehicleDef {
  id: string;
  name: string;
  price: number;
  tier: 1 | 2 | 3 | 4;
  skillsets: VehicleSkillset[];
  // Emoji placeholder — no real car art yet, same convention as the Gift
  // Shop's item icons.
  image: string;
  blurb: string;
}
const VEHICLE_CATALOG: VehicleDef[] = [
  {
    id: "starter-sedan",
    name: "Starter Sedan",
    price: 500,
    tier: 1,
    skillsets: [],
    image: "🚗",
    blurb: "A dependable first car — nothing fancy, just four wheels and a full tank.",
  },
  {
    id: "compact-hatchback",
    name: "Compact Hatchback",
    price: 500,
    tier: 1,
    skillsets: [],
    image: "🚙",
    blurb: "Easy to park, easy on gas, easy on the wallet.",
  },
  {
    id: "sport-coupe",
    name: "Sport Coupe",
    price: 5000,
    tier: 2,
    skillsets: ["speed"],
    image: "🏎️",
    blurb: "Low, sleek, and built to leave the Starter Sedan in the dust.",
  },
  {
    id: "racing-convertible",
    name: "Racing Convertible",
    price: 5500,
    tier: 2,
    skillsets: ["speed"],
    image: "🚘",
    blurb: "Top down, engine loud — built for speed and showing off.",
  },
  {
    id: "pickup-truck",
    name: "Pickup Truck",
    price: 4000,
    tier: 2,
    skillsets: ["reverse"],
    image: "🛻",
    blurb: "Sturdy and practical, with room to haul and the muscle to back it up.",
  },
  {
    id: "suv",
    name: "SUV",
    price: 4500,
    tier: 2,
    skillsets: ["reverse"],
    image: "🚐",
    blurb: "Roomy, rugged, and confident backing out of any spot in town.",
  },
  {
    id: "muscle-car",
    name: "Muscle Car",
    price: 12000,
    tier: 3,
    skillsets: ["speed", "reverse"],
    image: "🚗💨",
    blurb: "A roaring engine under the hood — fast forward, fast in reverse.",
  },
  {
    id: "luxury-sedan",
    name: "Luxury Sedan",
    price: 13000,
    tier: 3,
    skillsets: ["speed", "reverse"],
    image: "🚘✨",
    blurb: "Refined power — the comfort of a sedan with a sports car's reflexes.",
  },
  {
    id: "supercar",
    name: "Supercar",
    price: 50000,
    tier: 4,
    skillsets: ["speed", "reverse", "autopilot"],
    image: "🏎️💨",
    blurb: "The absolute pinnacle — blistering speed, instant reverse, and it can be anywhere in town in an instant.",
  },
];

function skillsetLabel(s: VehicleSkillset): string {
  if (s === "speed") return "Speed Boost";
  if (s === "reverse") return "Reverse Driving";
  return "Autopilot";
}

// Exact per-skillset numbers are flagged "TBD" in the catalogue doc —
// picked as clearly-retunable placeholders, scaled by tier so the jump
// between tiers actually feels different behind the wheel rather than a
// flat "has it or doesn't" bonus. Speed Boost multiplies MAX_SPEED (420
// px/sec) by tier; Reverse Driving's top speed is a tier-based fraction of
// that same vehicle's forward top speed — the Supercar (tier 4) backs up
// exactly as fast as it drives forward, and tier 3 (Muscle Car/Luxury
// Sedan) is close behind at 90%.
const TIER_SPEED_MULTIPLIER: Record<VehicleDef["tier"], number> = { 1: 1, 2: 1.5, 3: 2.0, 4: 2.4 };
const TIER_REVERSE_RATIO: Record<VehicleDef["tier"], number> = { 1: 0, 2: 0.55, 3: 0.9, 4: 1 };

function activeVehicleDef(): VehicleDef | null {
  return VEHICLE_CATALOG.find((v) => v.id === playerState.activeVehicle) ?? null;
}

/** Re-applies the active vehicle's skillsets to the street scene (top speed, REVERSE/🧭 AUTO button visibility). Call whenever activeVehicle changes. */
function applyVehiclePerformance() {
  const v = activeVehicleDef();
  street.setPerformance(
    v?.skillsets.includes("speed") ? TIER_SPEED_MULTIPLIER[v.tier] : 1,
    v?.skillsets.includes("reverse") ? TIER_REVERSE_RATIO[v.tier] : 0,
    v?.skillsets.includes("autopilot") ?? false,
  );
}

function vehicleInfoText(v: VehicleDef): string {
  const lines = [v.blurb];
  if (v.skillsets.length === 0) {
    lines.push("No special skillset — a reliable way to get around town.");
  } else {
    if (v.skillsets.includes("speed")) lines.push(`Speed Boost: ${TIER_SPEED_MULTIPLIER[v.tier]}x top speed.`);
    if (v.skillsets.includes("reverse")) {
      lines.push(`Reverse Driving: backs up at ${Math.round(TIER_REVERSE_RATIO[v.tier] * 100)}% of forward speed.`);
    }
    if (v.skillsets.includes("autopilot")) {
      lines.push("Autopilot: drives itself straight to any unlocked building, arriving right at the door.");
    }
  }
  return lines.join("\n");
}

// Vehicle Dealer info sheet state (Section 5, updated): one car at a time
// instead of a flat list — ‹ › pages through VEHICLE_CATALOG, and buying
// walks through Buy? Yes/No, then (only on a successful purchase) a
// separate Set as Standard? Yes/No, matching the two questions asked
// separately elsewhere (see the Garage's own Drive vs. Set as Standard).
type VehicleDealerView = "browse" | "confirm-buy" | "confirm-standard";
let vehicleDealerIndex = 0;
let vehicleDealerView: VehicleDealerView = "browse";
let vehicleDealerMessage = "";

function openVehicleMenu() {
  vehicleDealerIndex = 0;
  vehicleDealerView = "browse";
  vehicleDealerMessage = "";
  vehicleSheet.open(buildVehicleSheet);
}

function buildVehicleSheet(): VehicleSheetData {
  const v = VEHICLE_CATALOG[vehicleDealerIndex];
  const owned = playerState.vehiclesOwned.includes(v.id);
  const isActive = playerState.activeVehicle === v.id;
  const isStandard = playerState.standardVehicle === v.id;

  if (vehicleDealerView === "confirm-buy") {
    return {
      title: v.name,
      image: v.image,
      infoText: `Buy the ${v.name} for $${v.price}?`,
      priceText: `$${v.price}`,
      message: vehicleDealerMessage || undefined,
      actions: [
        {
          id: "yes",
          label: "Yes",
          run: () => {
            if (playerState.money < v.price) {
              vehicleDealerMessage = `Not enough money — need $${v.price}, have $${playerState.money}.`;
              vehicleDealerView = "browse";
              return;
            }
            playerState.money -= v.price;
            playerState.vehiclesOwned.push(v.id);
            playerState.activeVehicle = v.id;
            applyVehiclePerformance();
            vehicleDealerMessage = "";
            vehicleDealerView = "confirm-standard";
          },
        },
        { id: "no", label: "No", run: () => { vehicleDealerView = "browse"; } },
      ],
      onPrev: null,
      onNext: null,
      onClose: () => vehicleSheet.close(),
    };
  }

  if (vehicleDealerView === "confirm-standard") {
    return {
      title: v.name,
      image: v.image,
      infoText: `🎉 Congratulations! You now own a brand new ${v.name}. Would you like to set this as your Standard Vehicle?`,
      priceText: "",
      actions: [
        {
          id: "yes",
          label: "Yes",
          run: () => {
            playerState.standardVehicle = v.id;
            vehicleDealerView = "browse";
          },
        },
        { id: "no", label: "No", run: () => { vehicleDealerView = "browse"; } },
      ],
      onPrev: null,
      onNext: null,
      onClose: () => vehicleSheet.close(),
    };
  }

  const badge = [isActive ? "DRIVING" : null, isStandard ? "STANDARD" : null].filter(Boolean).join(" · ");
  return {
    title: v.name,
    image: v.image,
    infoText: `Wallet: $${playerState.money}\n${vehicleInfoText(v)}`,
    priceText: owned ? badge || "OWNED" : `$${v.price}`,
    message: vehicleDealerMessage || undefined,
    actions: owned
      ? [
          {
            id: "drive",
            label: isActive ? "Driving" : "🚗 Drive",
            disabled: isActive,
            run: () => {
              playerState.activeVehicle = v.id;
              applyVehiclePerformance();
              vehicleDealerMessage = `Now driving the ${v.name}.`;
            },
          },
        ]
      : [
          {
            id: "buy",
            label: `💰 Buy — $${v.price}`,
            run: () => {
              vehicleDealerMessage = "";
              vehicleDealerView = "confirm-buy";
            },
          },
        ],
    onPrev: () => {
      vehicleDealerIndex = (vehicleDealerIndex - 1 + VEHICLE_CATALOG.length) % VEHICLE_CATALOG.length;
      vehicleDealerMessage = "";
    },
    onNext: () => {
      vehicleDealerIndex = (vehicleDealerIndex + 1) % VEHICLE_CATALOG.length;
      vehicleDealerMessage = "";
    },
    onClose: () => vehicleSheet.close(),
  };
}

/** Vehicle Dealer Autopilot skillset: drives itself to any unlocked building, arriving right at the door. */
function openAutopilotMenu() {
  const destinations = ENTERABLE_LOTS.filter((lot) => !lot.building.locked);
  locationMenu.open(() => ({
    title: "🧭 Autopilot",
    energyText: `Driving: ${activeVehicleDef()?.name ?? "None"}`,
    actions: destinations.map((lot) => ({
      id: `${lot.building.name}-${lot.row}`,
      label: lot.building.name,
      cost: 0,
      costLabel: "GO",
      run: () => {
        street.autopilotTo(lot);
        locationMenu.close();
        return `Autopilot engaged — arriving at ${lot.building.name}.`;
      },
    })),
  }));
}

// Garage (Section 5, updated): a Home station, not a Mall one — every
// owned vehicle lives here. Two-step menu (select a vehicle, then Drive or
// Set as Standard for it) mirrors the Manager Desk's drill-down menus
// elsewhere in this file. Drive exits straight to the street in that
// vehicle, no need to also walk to the door. Set as Standard does NOT
// exit — it just updates the default, leaving the player in the menu to
// either Drive (this car or another) or back out and walk Home's door,
// which applies whatever's now Standard (see exitBuilding).
let garageSelectedVehicleId: string | null = null;

function openGarageMenu() {
  garageSelectedVehicleId = null;
  locationMenu.open(buildGarageMenu);
}

function buildGarageMenu(): MenuData {
  const owned = VEHICLE_CATALOG.filter((v) => playerState.vehiclesOwned.includes(v.id));
  const standard = VEHICLE_CATALOG.find((v) => v.id === playerState.standardVehicle) ?? null;
  const active = activeVehicleDef();
  const statusText = `Standard: ${standard ? standard.name : "None"}  ·  Driving: ${active ? active.name : "None"}`;

  const selected = owned.find((v) => v.id === garageSelectedVehicleId) ?? null;
  if (selected) {
    const isActive = active?.id === selected.id;
    const isStandard = standard?.id === selected.id;
    return {
      title: `🏠 Garage — ${selected.name}`,
      energyText: statusText,
      actions: [
        {
          id: "back",
          label: "‹ Back",
          cost: 0,
          costLabel: "",
          run: () => {
            garageSelectedVehicleId = null;
            return "";
          },
        },
        {
          id: "drive",
          label: "🚗 Drive",
          cost: 0,
          costLabel: isActive ? "DRIVING" : "SELECT",
          disabled: isActive,
          run: () => {
            playerState.activeVehicle = selected.id;
            applyVehiclePerformance();
            garageSelectedVehicleId = null;
            locationMenu.close();
            returnToStreet();
            return "";
          },
        },
        {
          id: "standard",
          label: "⭐ Set as Standard",
          cost: 0,
          costLabel: isStandard ? "STANDARD" : "SELECT",
          disabled: isStandard,
          run: () => {
            // Unlike Drive, this doesn't exit to the street — just updates
            // the default. The player picks Drive next (for this car or
            // another) to actually go, or backs out and walks Home's door
            // to leave in whichever vehicle is now Standard.
            playerState.standardVehicle = selected.id;
            return `${selected.name} is now your standard vehicle.`;
          },
        },
      ],
    };
  }

  return {
    title: "🏠 Garage",
    energyText: owned.length === 0 ? "No vehicles owned yet — visit the Vehicle Dealer at the Mall." : statusText,
    actions: owned.map((v) => {
      const isActive = active?.id === v.id;
      const isStandard = standard?.id === v.id;
      const badge = [isActive ? "DRIVING" : null, isStandard ? "STD" : null].filter(Boolean).join(" · ");
      const skillsetText = v.skillsets.length ? ` (${v.skillsets.map(skillsetLabel).join(" + ")})` : "";
      return {
        id: v.id,
        label: `${v.name}${skillsetText}`,
        cost: 0,
        costLabel: badge || "›",
        run: () => {
          garageSelectedVehicleId = v.id;
          return "";
        },
      };
    }),
  };
}

// Clothing Store (Section 5, updated): Fight Night (Shorts, Gloves),
// Casual (Upper Body, Lower Body, Shoes), Formal (Suits, Shoes) — tap a
// top category, then a sub-category, which opens a 4-per-row icon grid
// (same layout as the Gift catalog) of that sub-category's whole catalog.
// Tapping a tile opens it in the same single-item info sheet as the
// Vehicle Dealer/Pet breeds (picture, info, price, Buy), with ‹ › paging
// through the rest of that sub-category. Each item is bought once and
// owned forever (not consumed) and grants its Image gain permanently,
// same effect the old flat 3-outfit version had, just distributed per
// item now. All names/prices/Image gains below are placeholders.
type ClothingTopCategory = "fightnight" | "casual" | "formal";
type ClothingSubCategory = "shorts" | "gloves" | "upper" | "lower" | "shoes-casual" | "suits" | "shoes-formal";

interface ClothingItem {
  id: string;
  name: string;
  price: number;
  image: string; // emoji placeholder — no real clothing art yet
  imageGain: number;
}

/** Generates `count` items by cycling baseTypes × colors (e.g. 8 types × 2 colors = 16) — enough variation to avoid a flat "Item 1, Item 2" list without hand-authoring dozens of unique concepts. */
function generateClothingItems(
  idPrefix: string,
  baseTypes: string[],
  colors: string[],
  count: number,
  priceForType: (typeIndex: number) => number,
  imageGainForType: (typeIndex: number) => number,
  iconForType: (type: string) => string,
): ClothingItem[] {
  const items: ClothingItem[] = [];
  for (let i = 0; i < count; i++) {
    const typeIndex = i % baseTypes.length;
    const type = baseTypes[typeIndex];
    const color = colors[Math.floor(i / baseTypes.length) % colors.length];
    items.push({
      id: `${idPrefix}-${i}`,
      name: `${color} ${type}`,
      price: priceForType(typeIndex),
      image: iconForType(type),
      imageGain: imageGainForType(typeIndex),
    });
  }
  return items;
}

const UPPER_BODY_TYPES = ["T-Shirt", "Hoodie", "Tank Top", "Jacket", "Sweater", "Polo Shirt", "Henley", "Flannel Shirt"];
const UPPER_BODY_ICONS: Record<string, string> = { Hoodie: "🧥", Jacket: "🧥", Sweater: "🧶", "Tank Top": "🎽" };
const LOWER_BODY_TYPES = ["Jeans", "Cargo Pants", "Sweatpants", "Shorts", "Chinos", "Joggers", "Corduroys", "Track Pants"];
const LOWER_BODY_ICONS: Record<string, string> = { Shorts: "🩳" };
const CASUAL_SHOE_TYPES = ["Sneakers", "Running Shoes", "Skate Shoes", "Canvas Shoes", "High-Tops", "Slip-Ons", "Sandals", "Boots"];
const CASUAL_SHOE_ICONS: Record<string, string> = { Sandals: "🩴", Boots: "🥾" };
const SUIT_TYPES = ["Two-Piece Suit", "Three-Piece Suit", "Tuxedo", "Blazer & Trousers Set"];
const FORMAL_SHOE_TYPES = ["Oxford Shoes", "Loafers"];
const SHORTS_TYPES = [
  "Classic Trunks",
  "Satin Trunks",
  "Split-Leg Trunks",
  "Kickboxing Shorts",
  "MMA Shorts",
  "Muay Thai Shorts",
  "Retro Trunks",
  "Championship Trunks",
];
const GLOVES_TYPES = [
  "Training Gloves",
  "Sparring Gloves",
  "Bag Gloves",
  "Competition Gloves",
  "Lace-Up Gloves",
  "Velcro Gloves",
  "MMA Gloves",
  "Pro Gloves",
];

const CLOTHING_CATALOG: Record<ClothingSubCategory, ClothingItem[]> = {
  upper: generateClothingItems(
    "upper",
    UPPER_BODY_TYPES,
    ["Black", "White"],
    16,
    (i) => 25 + i * 5,
    (i) => 1 + (i % 3),
    (t) => UPPER_BODY_ICONS[t] ?? "👕",
  ),
  lower: generateClothingItems(
    "lower",
    LOWER_BODY_TYPES,
    ["Black", "Blue"],
    16,
    (i) => 25 + i * 5,
    (i) => 1 + (i % 3),
    (t) => LOWER_BODY_ICONS[t] ?? "👖",
  ),
  "shoes-casual": generateClothingItems(
    "shoes-casual",
    CASUAL_SHOE_TYPES,
    ["White", "Black"],
    16,
    (i) => 30 + i * 6,
    (i) => 1 + (i % 3),
    (t) => CASUAL_SHOE_ICONS[t] ?? "👟",
  ),
  suits: generateClothingItems(
    "suits",
    SUIT_TYPES,
    ["Black", "Navy"],
    8,
    (i) => 300 + i * 150,
    (i) => 5 + i * 2,
    () => "🤵",
  ),
  "shoes-formal": generateClothingItems(
    "shoes-formal",
    FORMAL_SHOE_TYPES,
    ["Black", "Brown"],
    4,
    (i) => 150 + i * 80,
    (i) => 3 + i * 2,
    () => "👞",
  ),
  shorts: generateClothingItems(
    "shorts",
    SHORTS_TYPES,
    ["Red", "Black"],
    16,
    (i) => 50 + i * 10,
    (i) => 1 + (i % 3),
    () => "🩳",
  ),
  gloves: generateClothingItems(
    "gloves",
    GLOVES_TYPES,
    ["Red", "Black"],
    16,
    (i) => 60 + i * 10,
    (i) => 1 + (i % 3),
    () => "🥊",
  ),
};

const CLOTHING_SUB_LABELS: Record<ClothingSubCategory, string> = {
  shorts: "🩳 Shorts",
  gloves: "🥊 Gloves",
  upper: "👕 Upper Body",
  lower: "👖 Lower Body",
  "shoes-casual": "👟 Shoes",
  suits: "🤵 Suits",
  "shoes-formal": "👞 Shoes",
};
const CLOTHING_TOP_LABELS: Record<ClothingTopCategory, string> = {
  fightnight: "🥊 Fight Night",
  casual: "😎 Casual",
  formal: "🎩 Formal",
};
const CLOTHING_SUBCATEGORIES: Record<ClothingTopCategory, ClothingSubCategory[]> = {
  fightnight: ["shorts", "gloves"],
  casual: ["upper", "lower", "shoes-casual"],
  formal: ["suits", "shoes-formal"],
};

let clothingTopCategory: ClothingTopCategory | null = null;
let clothingSubCategory: ClothingSubCategory | null = null;

function openClothesMenu() {
  clothingTopCategory = null;
  clothingSubCategory = null;
  locationMenu.open(buildClothesMenu);
}

function buildClothesMenu(): MenuData {
  if (clothingSubCategory) return buildClothingGridMenu(clothingSubCategory);
  if (clothingTopCategory) return buildClothingSubCategoryMenu(clothingTopCategory);
  return buildClothingTopMenu();
}

function buildClothingTopMenu(): MenuData {
  return {
    title: "👗 Clothing Store",
    energyText: `Money: $${playerState.money}  ·  Image: ${playerState.image}`,
    actions: (Object.keys(CLOTHING_TOP_LABELS) as ClothingTopCategory[]).map((cat) => ({
      id: cat,
      label: CLOTHING_TOP_LABELS[cat],
      cost: 0,
      costLabel: "›",
      run: () => {
        clothingTopCategory = cat;
        return "";
      },
    })),
  };
}

function buildClothingSubCategoryMenu(top: ClothingTopCategory): MenuData {
  return {
    title: CLOTHING_TOP_LABELS[top],
    energyText: `Money: $${playerState.money}  ·  Image: ${playerState.image}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          clothingTopCategory = null;
          return "";
        },
      },
      ...CLOTHING_SUBCATEGORIES[top].map((sub) => ({
        id: sub,
        label: CLOTHING_SUB_LABELS[sub],
        cost: 0,
        costLabel: "›",
        run: () => {
          clothingSubCategory = sub;
          return "";
        },
      })),
    ],
  };
}

function buildClothingGridMenu(sub: ClothingSubCategory): MenuData {
  const items = CLOTHING_CATALOG[sub];
  return {
    title: CLOTHING_SUB_LABELS[sub],
    energyText: `Money: $${playerState.money}  ·  Image: ${playerState.image}`,
    layout: "grid",
    actions: [
      ...items.map((item, i) => {
        const owned = playerState.clothingOwned.includes(item.id);
        return {
          id: item.id,
          icon: item.image,
          label: item.name,
          cost: 0,
          costLabel: owned ? "OWNED" : `$${item.price}`,
          run: () => {
            openClothingItemSheet(sub, i);
            return "";
          },
        };
      }),
      {
        id: "back",
        icon: "↩️",
        label: "Back",
        cost: 0,
        costLabel: "",
        run: () => {
          clothingSubCategory = null;
          return "";
        },
      },
    ],
  };
}

let clothingSheetSub: ClothingSubCategory = "shorts";
let clothingSheetIndex = 0;
let clothingSheetMessage = "";
// Set right after a successful Buy — the sheet shows a Yes/No "wear it
// now?" prompt (same beat as the Vehicle Dealer's post-purchase "set as
// Standard?") before returning to browsing.
let clothingSheetConfirmingActivate = false;

// Fight Night's equip slot means "wear this in your next fight", not
// "put it on now" the way Casual/Formal's does — same underlying
// mechanic (one active item per sub-category), different wording so it
// doesn't imply the player is walking around in fight gear.
function isFightNightSub(sub: ClothingSubCategory): boolean {
  return CLOTHING_SUBCATEGORIES.fightnight.includes(sub);
}

function openClothingItemSheet(sub: ClothingSubCategory, index: number) {
  clothingSheetSub = sub;
  clothingSheetIndex = index;
  clothingSheetMessage = "";
  clothingSheetConfirmingActivate = false;
  vehicleSheet.open(buildClothingItemSheet);
}

function buildClothingItemSheet(): VehicleSheetData {
  const items = CLOTHING_CATALOG[clothingSheetSub];
  const item = items[clothingSheetIndex];
  const owned = playerState.clothingOwned.includes(item.id);

  if (clothingSheetConfirmingActivate) {
    return {
      title: item.name,
      image: item.image,
      infoText: isFightNightSub(clothingSheetSub)
        ? `🎉 Bought the ${item.name}! Set it as your gear for your next fight?`
        : `🎉 Bought the ${item.name}! Would you like to wear it now?`,
      priceText: "",
      actions: [
        {
          id: "yes",
          label: "Yes",
          run: () => {
            playerState.activeClothing[clothingSheetSub] = item.id;
            clothingSheetConfirmingActivate = false;
          },
        },
        {
          id: "no",
          label: "No",
          run: () => {
            clothingSheetConfirmingActivate = false;
          },
        },
      ],
      onPrev: null,
      onNext: null,
      onClose: () => {
        vehicleSheet.close();
        locationMenu.open(buildClothesMenu);
      },
    };
  }

  return {
    title: item.name,
    image: item.image,
    infoText: `Wallet: $${playerState.money}\n${CLOTHING_SUB_LABELS[clothingSheetSub]}\nImage +${item.imageGain} when purchased.`,
    priceText: owned ? "OWNED" : `$${item.price}`,
    message: clothingSheetMessage || undefined,
    actions: [
      {
        id: "buy",
        label: owned ? "✅ Owned" : `💰 Buy — $${item.price}`,
        disabled: owned,
        run: () => {
          if (playerState.money < item.price) {
            clothingSheetMessage = `Not enough money — need $${item.price}, have $${playerState.money}.`;
            return;
          }
          playerState.money -= item.price;
          playerState.clothingOwned.push(item.id);
          playerState.image += item.imageGain;
          clothingSheetMessage = "";
          clothingSheetConfirmingActivate = true;
        },
      },
    ],
    onPrev: () => {
      clothingSheetIndex = (clothingSheetIndex - 1 + items.length) % items.length;
      clothingSheetMessage = "";
    },
    onNext: () => {
      clothingSheetIndex = (clothingSheetIndex + 1) % items.length;
      clothingSheetMessage = "";
    },
    // Closing returns to the grid (still open behind this sheet) instead
    // of exiting the whole Clothing Store — re-opening forces a fresh
    // render so a just-bought item's OWNED badge actually shows, same fix
    // as the Pet Store's Dog/Cat carousel.
    onClose: () => {
      vehicleSheet.close();
      locationMenu.open(buildClothesMenu);
    },
  };
}

// Wardrobe (Section 5, updated): a Home station, not a Mall one — picks
// which OWNED item is equipped per Clothing Store sub-category. Same
// category/sub-category drill-down as the shop, but the leaf screen lists
// only owned items (plus a "None" tile to unequip) instead of the whole
// catalog, and taps set playerState.activeClothing instead of opening a
// purchase sheet.
let wardrobeTopCategory: ClothingTopCategory | null = null;
let wardrobeSubCategory: ClothingSubCategory | null = null;

function openWardrobeMenu() {
  wardrobeTopCategory = null;
  wardrobeSubCategory = null;
  locationMenu.open(buildWardrobeMenu);
}

function buildWardrobeMenu(): MenuData {
  if (wardrobeSubCategory) return buildWardrobeItemMenu(wardrobeSubCategory);
  if (wardrobeTopCategory) return buildWardrobeSubCategoryMenu(wardrobeTopCategory);
  return buildWardrobeTopMenu();
}

function buildWardrobeTopMenu(): MenuData {
  return {
    title: "🧺 Wardrobe",
    energyText: `Image: ${playerState.image}`,
    actions: (Object.keys(CLOTHING_TOP_LABELS) as ClothingTopCategory[]).map((cat) => ({
      id: cat,
      label: CLOTHING_TOP_LABELS[cat],
      cost: 0,
      costLabel: "›",
      run: () => {
        wardrobeTopCategory = cat;
        return "";
      },
    })),
  };
}

function equippedItemName(sub: ClothingSubCategory): string | null {
  const activeId = playerState.activeClothing[sub];
  if (!activeId) return null;
  return CLOTHING_CATALOG[sub].find((item) => item.id === activeId)?.name ?? null;
}

function buildWardrobeSubCategoryMenu(top: ClothingTopCategory): MenuData {
  return {
    title: CLOTHING_TOP_LABELS[top],
    energyText: `Image: ${playerState.image}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          wardrobeTopCategory = null;
          return "";
        },
      },
      ...CLOTHING_SUBCATEGORIES[top].map((sub) => ({
        id: sub,
        label: CLOTHING_SUB_LABELS[sub],
        cost: 0,
        costLabel: equippedItemName(sub) ?? "None equipped",
        run: () => {
          wardrobeSubCategory = sub;
          return "";
        },
      })),
    ],
  };
}

function buildWardrobeItemMenu(sub: ClothingSubCategory): MenuData {
  const owned = CLOTHING_CATALOG[sub].filter((item) => playerState.clothingOwned.includes(item.id));
  const activeId = playerState.activeClothing[sub] ?? null;
  const fightNight = isFightNightSub(sub);
  const activeLabel = equippedItemName(sub)
    ? (fightNight ? `Set for next fight: ${equippedItemName(sub)}` : `Wearing: ${equippedItemName(sub)}`)
    : (fightNight ? "Nothing set for next fight" : "Nothing equipped");
  return {
    title: CLOTHING_SUB_LABELS[sub],
    energyText: activeLabel,
    layout: "grid",
    actions: [
      {
        id: "none",
        icon: "🚫",
        label: "None",
        cost: 0,
        costLabel: activeId === null ? "ACTIVE" : "",
        disabled: activeId === null,
        run: () => {
          playerState.activeClothing[sub] = null;
          return fightNight ? "Cleared for next fight." : "Unequipped.";
        },
      },
      ...owned.map((item) => ({
        id: item.id,
        icon: item.image,
        label: item.name,
        cost: 0,
        costLabel: activeId === item.id ? "ACTIVE" : (fightNight ? "Set" : "Wear"),
        disabled: activeId === item.id,
        run: () => {
          playerState.activeClothing[sub] = item.id;
          return fightNight
            ? `Set the ${item.name} for your next fight.`
            : `Now wearing the ${item.name}.`;
        },
      })),
      {
        id: "back",
        icon: "↩️",
        label: "Back",
        cost: 0,
        costLabel: "",
        run: () => {
          wardrobeSubCategory = null;
          return "";
        },
      },
    ],
  };
}

// Mall Item Catalogues spec: 4 categories, 4 items each. Romantic/Special
// Jewelry are romance-eligible-only (see isGiftGivableToNpc) — Fun/
// Practical are fine for any NPC. The ring is just another Jewelry entry —
// what makes it special is handled where gifts are GIVEN (isRing routes to
// a Propose confirmation instead of an immediate hand-over), not here.
// Per-NPC favorite/disliked-item preferences and reaction tone/delta live
// in game/npc.ts (GiftPreferences/getGiftReactionTone) — each NPC's own
// giftReaction picks flavor text per tone.
interface GiftCatalogItem extends ShopItem {
  category: GiftCategory;
  isRing?: boolean;
  // Placeholder art — a real icon/image can replace this per item later,
  // same "emoji until real art exists" convention as NPC portraits.
  icon: string;
}
const GIFT_CATALOG: GiftCatalogItem[] = [
  { id: "bouquet", name: "Bouquet of Flowers", price: 20, category: "romantic", icon: "💐" },
  { id: "chocolates", name: "Box of Chocolates", price: 15, category: "romantic", icon: "🍫" },
  { id: "perfume", name: "Perfume", price: 50, category: "romantic", icon: "🧴" },
  { id: "necklace", name: "Silver Necklace", price: 100, category: "romantic", icon: "📿" },
  { id: "board-game", name: "Board Game", price: 30, category: "fun", icon: "🎲" },
  { id: "novelty-mug", name: "Novelty Mug", price: 12, category: "fun", icon: "☕" },
  { id: "video-game", name: "Video Game", price: 60, category: "fun", icon: "🎮" },
  { id: "concert-tickets", name: "Concert Tickets", price: 80, category: "fun", icon: "🎫" },
  { id: "umbrella", name: "Umbrella", price: 15, category: "practical", icon: "☂️" },
  { id: "wallet", name: "Wallet", price: 35, category: "practical", icon: "👛" },
  { id: "tool-kit", name: "Tool Kit", price: 45, category: "practical", icon: "🧰" },
  { id: "watch", name: "Watch", price: 70, category: "practical", icon: "⌚" },
  { id: "ring", name: "Engagement Ring", price: 2000, category: "jewelry", isRing: true, icon: "💍" },
  { id: "luxury-watch", name: "Luxury Watch", price: 800, category: "jewelry", icon: "🕰️" },
  { id: "custom-jewelry", name: "Custom Jewelry Piece", price: 500, category: "jewelry", icon: "💎" },
  { id: "diamond-earrings", name: "Diamond Earrings", price: 600, category: "jewelry", icon: "✨" },
];
const GIFT_CATEGORY_LABELS: Record<GiftCategory, string> = {
  romantic: "💐 Romantic",
  fun: "🎉 Fun",
  practical: "🔧 Practical",
  jewelry: "💎 Special Jewelry",
};
function getGiftCount(id: string): number {
  return playerState.giftInventory[id] ?? 0;
}
function totalGiftsOwned(): number {
  return Object.values(playerState.giftInventory).reduce((sum, n) => sum + n, 0);
}
// Romantic doesn't make sense to give a friend-only NPC — Fun/Practical
// are universal, and so is Special Jewelry now (every NPC has her own
// fixed 1st/2nd/3rd ranking of the 3 non-Ring pieces — see
// GiftPreferences.specialJewelryRanking). The Ring is the one Jewelry
// item that's still romance-only, since giving it always routes to
// Propose instead of a normal gift reaction. canProposeHere (isRing-only)
// is passed in since its exact definition differs slightly between the
// Actions-menu and Meetup gift pickers that both call this.
function isGiftGivableToNpc(npc: NpcDef, item: GiftCatalogItem, canProposeHere: boolean): boolean {
  if (item.isRing) return canProposeHere;
  if (item.category === "romantic") return npc.romanceEligible;
  return true;
}

// Gift Shop spec: bought at whichever staff member is currently the
// shopkeeper (see GIFT_SHOP_KEEPER/PET_STORE_KEEPER) — no separate counter
// station. A category picker first, then that category's 4 items, since a
// flat 16-item list doesn't fit this menu's plain list UI well.
let giftShopCategory: GiftCategory | null = null;
function openGiftShopMenu() {
  giftShopCategory = null;
  locationMenu.open(() => {
    const category = giftShopCategory;
    if (!category) {
      return {
        title: "🎁 Gift Shop",
        energyText: `Money: $${playerState.money}  ·  Gifts owned: ${totalGiftsOwned()}`,
        actions: (Object.keys(GIFT_CATEGORY_LABELS) as GiftCategory[]).map((cat) => ({
          id: cat,
          label: GIFT_CATEGORY_LABELS[cat],
          cost: 0,
          costLabel: "›",
          run: () => {
            giftShopCategory = cat;
            return "";
          },
        })),
      };
    }
    return {
      title: GIFT_CATEGORY_LABELS[category],
      energyText: `Money: $${playerState.money}  ·  Gifts owned: ${totalGiftsOwned()}`,
      actions: [
        ...GIFT_CATALOG.filter((g) => g.category === category).map((g) => ({
          id: g.id,
          label: g.name,
          cost: 0,
          costLabel: `$${g.price}`,
          run: () => {
            if (playerState.money < g.price) return `Not enough money — need $${g.price}, have $${playerState.money}.`;
            playerState.money -= g.price;
            playerState.giftInventory[g.id] = getGiftCount(g.id) + 1;
            return `Bought ${g.name}!`;
          },
        })),
        {
          id: "back",
          label: "‹ Back to Categories",
          cost: 0,
          costLabel: "",
          run: () => {
            giftShopCategory = null;
            return "";
          },
        },
      ],
    };
  });
}

// Pet Store (Section 5, updated): pets are Home fixtures, same treatment
// as children — decorative, no active-companion behavior, no maintenance/
// decay (see getPetStations/openPetSupplyDialogue further below for the
// in-house side). Two different purchase mechanics:
//  - Dog/Cat: individually selected (one specific breed per purchase),
//    own several up to a housing-gated capacity — same paged info-card
//    carousel as the Vehicle Dealer (reusing the same `vehicleSheet`
//    overlay; it was already fully generic, not vehicle-specific).
//  - Fish/Snake/Bird/Rabbit: a single tank/cage per type, never bought
//    individually — the player upgrades its Stage (1-4, also housing-
//    gated), and which species are present is derived from that Stage.
interface PetBreed {
  id: string;
  name: string;
  image: string; // emoji placeholder — no real pet art yet
}
interface PetSpecies {
  id: string;
  name: string;
  image: string;
}

const DOG_BREEDS: PetBreed[] = [
  { id: "bulldog", name: "Bulldog", image: "🐶" },
  { id: "labrador", name: "Labrador", image: "🐕" },
  { id: "rottweiler", name: "Rottweiler", image: "🐕‍🦺" },
  { id: "pitbull", name: "Pitbull", image: "🦮" },
];
const CAT_BREEDS: PetBreed[] = [
  { id: "tuxedo", name: "Tuxedo Cat", image: "🐱" },
  { id: "black", name: "Black Cat", image: "🐈‍⬛" },
  { id: "white", name: "White Cat", image: "🐈" },
  { id: "orange", name: "Orange Cat", image: "🐈" },
];
const DOG_PRICE = 450;
const CAT_PRICE = 350;

// Fish accumulates one species per stage; Snake/Bird/Rabbit only add their
// second species at Stage 3, staying flat across 1-2 and 3-4 — matches the
// catalogue doc's tables exactly.
const FISH_SPECIES: PetSpecies[] = [
  { id: "goldfish", name: "Goldfish", image: "🐟" },
  { id: "betta", name: "Betta", image: "🐠" },
  { id: "clownfish", name: "Clownfish", image: "🐡" },
  { id: "koi", name: "Koi", image: "🎏" },
];
const SNAKE_SPECIES: PetSpecies[] = [
  { id: "corn-snake", name: "Corn Snake", image: "🐍" },
  { id: "ball-python", name: "Ball Python", image: "🐍" },
];
const BIRD_SPECIES: PetSpecies[] = [
  { id: "parakeet", name: "Parakeet", image: "🦜" },
  { id: "cockatiel", name: "Cockatiel", image: "🐦" },
];
const RABBIT_SPECIES: PetSpecies[] = [
  { id: "white-rabbit", name: "White Rabbit", image: "🐇" },
  { id: "brown-rabbit", name: "Brown Rabbit", image: "🐰" },
];
function fishSpeciesAtStage(stage: number): PetSpecies[] {
  return FISH_SPECIES.slice(0, Math.max(0, Math.min(4, stage)));
}
function snakeSpeciesAtStage(stage: number): PetSpecies[] {
  return stage >= 3 ? SNAKE_SPECIES : SNAKE_SPECIES.slice(0, 1);
}
function birdSpeciesAtStage(stage: number): PetSpecies[] {
  return stage >= 3 ? BIRD_SPECIES : BIRD_SPECIES.slice(0, 1);
}
function rabbitSpeciesAtStage(stage: number): PetSpecies[] {
  return stage >= 3 ? RABBIT_SPECIES : RABBIT_SPECIES.slice(0, 1);
}

// Housing gates pet capacity — ranked by the player's single BEST owned
// house (not summed across every house owned), same "highest tier reached"
// model the rest of Section 5 uses. Tank/cage Stage caps at 4 from
// Townhouse on; Dog/Cat capacity keeps climbing through Suburban/Mansion.
const HOUSE_TIER_RANK: Record<string, number> = {
  Trailer: 0,
  Apartment: 1,
  "Penthouse Apartment": 2,
  Townhouse: 3,
  "Suburban House": 4,
  Mansion: 5,
};
const HOUSE_PET_TANK_STAGE: Record<string, number> = {
  Trailer: 1,
  Apartment: 2,
  "Penthouse Apartment": 3,
  Townhouse: 4,
  "Suburban House": 4,
  Mansion: 4,
};
const HOUSE_DOGCAT_CAPACITY: Record<string, number> = {
  Trailer: 0,
  Apartment: 0,
  "Penthouse Apartment": 1,
  Townhouse: 2,
  "Suburban House": 4,
  Mansion: 8,
};
function bestOwnedHouseName(): string {
  let best = "Trailer";
  let bestRank = -1;
  for (const h of getHousingBuildings()) {
    if (h.locked) continue;
    const rank = HOUSE_TIER_RANK[h.name] ?? -1;
    if (rank > bestRank) {
      bestRank = rank;
      best = h.name;
    }
  }
  return best;
}
function petTankCeiling(): number {
  return HOUSE_PET_TANK_STAGE[bestOwnedHouseName()] ?? 1;
}
function dogCatCapacity(): number {
  return HOUSE_DOGCAT_CAPACITY[bestOwnedHouseName()] ?? 0;
}

// Decay perk (Section 5, updated): once the planned Wife-neglect Romance
// decay system exists, only the player's single BEST-owned pet reduces
// it (no stacking across multiple pets). Exposed now as pure lookup
// infrastructure — there's no decay system yet to actually call it.
const PET_DECAY_REDUCTION: Record<"dog" | "cat" | "bird" | "rabbit" | "fish" | "snake", number> = {
  dog: 0.5,
  cat: 0.5,
  bird: 0.25,
  rabbit: 0.25,
  fish: 0.1,
  snake: 0.1,
};
function bestPetDecayReduction(): number {
  let best = 0;
  if (playerState.dogsOwned.length > 0) best = Math.max(best, PET_DECAY_REDUCTION.dog);
  if (playerState.catsOwned.length > 0) best = Math.max(best, PET_DECAY_REDUCTION.cat);
  if (playerState.birdCageOwned) best = Math.max(best, PET_DECAY_REDUCTION.bird);
  if (playerState.rabbitCageOwned) best = Math.max(best, PET_DECAY_REDUCTION.rabbit);
  if (playerState.fishTankOwned) best = Math.max(best, PET_DECAY_REDUCTION.fish);
  if (playerState.snakeTankOwned) best = Math.max(best, PET_DECAY_REDUCTION.snake);
  return best;
}

type PetTankType = "fish" | "snake" | "bird" | "rabbit";
interface PetTankMeta {
  label: string;
  icon: string;
  minStage: number; // Bird/Rabbit aren't purchasable at all below Stage 2 — no Stage 1 for them
  prices: Record<number, number>;
  speciesAtStage: (stage: number) => PetSpecies[];
  isOwned: () => boolean;
  currentStage: () => number;
  purchase: (stage: number) => void;
}
const PET_TANK_META: Record<PetTankType, PetTankMeta> = {
  fish: {
    label: "Fish Tank",
    icon: "🐟",
    minStage: 1,
    prices: { 1: 100, 2: 200, 3: 350, 4: 550 },
    speciesAtStage: fishSpeciesAtStage,
    isOwned: () => playerState.fishTankOwned,
    currentStage: () => playerState.fishTankStage,
    purchase: (stage) => {
      playerState.fishTankOwned = true;
      playerState.fishTankStage = stage;
    },
  },
  snake: {
    label: "Snake Tank",
    icon: "🐍",
    minStage: 1,
    prices: { 1: 150, 2: 280, 3: 450, 4: 700 },
    speciesAtStage: snakeSpeciesAtStage,
    isOwned: () => playerState.snakeTankOwned,
    currentStage: () => playerState.snakeTankStage,
    purchase: (stage) => {
      playerState.snakeTankOwned = true;
      playerState.snakeTankStage = stage;
    },
  },
  bird: {
    label: "Bird Cage",
    icon: "🦜",
    minStage: 2,
    prices: { 2: 200, 3: 350, 4: 550 },
    speciesAtStage: birdSpeciesAtStage,
    isOwned: () => playerState.birdCageOwned,
    currentStage: () => playerState.birdCageStage,
    purchase: (stage) => {
      playerState.birdCageOwned = true;
      playerState.birdCageStage = stage;
    },
  },
  rabbit: {
    label: "Rabbit Cage",
    icon: "🐇",
    minStage: 2,
    prices: { 2: 180, 3: 320, 4: 500 },
    speciesAtStage: rabbitSpeciesAtStage,
    isOwned: () => playerState.rabbitCageOwned,
    currentStage: () => playerState.rabbitCageStage,
    purchase: (stage) => {
      playerState.rabbitCageOwned = true;
      playerState.rabbitCageStage = stage;
    },
  },
};

// Pet Supply (Section 5, updated): food (one per animal category) and
// toys (species-restricted) bought here, used at Home. Buying is
// unlimited stockpiling, same as the Gift Shop — no per-visit cap.
type PetCategory = PetTankType | "dog" | "cat";
interface PetFoodItem {
  id: PetCategory;
  name: string;
  price: number;
  icon: string;
}
const PET_FOOD_CATALOG: PetFoodItem[] = [
  { id: "dog", name: "Dog Food", price: 20, icon: "🐶" },
  { id: "cat", name: "Cat Food", price: 20, icon: "🐱" },
  { id: "fish", name: "Fish Food", price: 10, icon: "🐟" },
  { id: "snake", name: "Snake Food", price: 15, icon: "🐍" },
  { id: "bird", name: "Bird Food", price: 12, icon: "🦜" },
  { id: "rabbit", name: "Rabbit Food", price: 12, icon: "🐇" },
];
interface PetToyItem {
  id: string;
  name: string;
  price: number;
  icon: string;
  for: "dog" | "cat";
}
// Tennis Ball/Rubber Bone are for dogs, Toy Mouse/Ball of Yarn for cats —
// using one on the wrong species just wastes it (see buildPetSupplyDialogue).
const PET_TOY_CATALOG: PetToyItem[] = [
  { id: "tennis-ball", name: "Tennis Ball", price: 15, icon: "🎾", for: "dog" },
  { id: "rubber-bone", name: "Rubber Bone", price: 15, icon: "🦴", for: "dog" },
  { id: "toy-mouse", name: "Toy Mouse", price: 12, icon: "🐭", for: "cat" },
  { id: "yarn-ball", name: "Ball of Yarn", price: 12, icon: "🧶", for: "cat" },
];

type PetStoreScreen = "main" | "pets" | "supply" | "supply-food" | "supply-toys";
let petStoreScreen: PetStoreScreen = "main";
let petStoreTankView: PetTankType | null = null;

function openPetStoreMenu() {
  petStoreScreen = "main";
  petStoreTankView = null;
  locationMenu.open(buildPetStoreMenu);
}

function petTankRowLabel(type: PetTankType): string {
  const meta = PET_TANK_META[type];
  if (!meta.isOwned()) return meta.minStage > petTankCeiling() ? "LOCKED" : "›";
  return `Stage ${meta.currentStage()}/4`;
}

function buildPetStoreMenu(): MenuData {
  if (petStoreScreen === "supply-food") return buildPetFoodMenu();
  if (petStoreScreen === "supply-toys") return buildPetToyMenu();
  if (petStoreScreen === "supply") return buildPetSupplyCategoryMenu();
  if (petStoreScreen === "pets") {
    if (petStoreTankView) return buildPetTankStageMenu(petStoreTankView);
    return buildPetsListMenu();
  }
  return buildPetStoreMainMenu();
}

function buildPetStoreMainMenu(): MenuData {
  const decayPerk = bestPetDecayReduction();
  return {
    title: "🐾 Pet Store",
    energyText:
      `Money: $${playerState.money}` +
      (decayPerk > 0 ? `  ·  Neglect-decay perk (once that system exists): -${Math.round(decayPerk * 100)}%` : ""),
    actions: [
      {
        id: "pets",
        label: "🐾 Pets",
        cost: 0,
        costLabel: "›",
        run: () => {
          petStoreScreen = "pets";
          return "";
        },
      },
      {
        id: "supply",
        label: "🎾 Pet Supply",
        cost: 0,
        costLabel: "›",
        run: () => {
          petStoreScreen = "supply";
          return "";
        },
      },
    ],
  };
}

function buildPetSupplyCategoryMenu(): MenuData {
  return {
    title: "🎾 Pet Supply",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          petStoreScreen = "main";
          return "";
        },
      },
      {
        id: "food",
        label: "🍖 Food",
        cost: 0,
        costLabel: "›",
        run: () => {
          petStoreScreen = "supply-food";
          return "";
        },
      },
      {
        id: "toys",
        label: "🧸 Toys",
        cost: 0,
        costLabel: "›",
        run: () => {
          petStoreScreen = "supply-toys";
          return "";
        },
      },
    ],
  };
}

function buildPetFoodMenu(): MenuData {
  return {
    title: "🍖 Pet Food",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          petStoreScreen = "supply";
          return "";
        },
      },
      ...PET_FOOD_CATALOG.map((f) => {
        const owned = playerState.petFoodInventory[f.id] ?? 0;
        return {
          id: f.id,
          label: `${f.icon} ${f.name}${owned > 0 ? ` (${owned})` : ""}`,
          cost: 0,
          costLabel: `$${f.price}`,
          run: () => {
            if (playerState.money < f.price) {
              return `Not enough money — need $${f.price}, have $${playerState.money}.`;
            }
            playerState.money -= f.price;
            playerState.petFoodInventory[f.id] = (playerState.petFoodInventory[f.id] ?? 0) + 1;
            return `Bought ${f.name}.`;
          },
        };
      }),
    ],
  };
}

function buildPetToyMenu(): MenuData {
  return {
    title: "🧸 Pet Toys",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          petStoreScreen = "supply";
          return "";
        },
      },
      ...PET_TOY_CATALOG.map((t) => {
        const owned = playerState.petToyInventory[t.id] ?? 0;
        return {
          id: t.id,
          label: `${t.icon} ${t.name}${owned > 0 ? ` (${owned})` : ""}`,
          cost: 0,
          costLabel: `$${t.price}`,
          run: () => {
            if (playerState.money < t.price) {
              return `Not enough money — need $${t.price}, have $${playerState.money}.`;
            }
            playerState.money -= t.price;
            playerState.petToyInventory[t.id] = (playerState.petToyInventory[t.id] ?? 0) + 1;
            return `Bought a ${t.name}.`;
          },
        };
      }),
    ],
  };
}

function buildPetsListMenu(): MenuData {
  const capacity = dogCatCapacity();
  const dogCatCount = playerState.dogsOwned.length + playerState.catsOwned.length;
  return {
    title: "🐾 Pets",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          petStoreScreen = "main";
          return "";
        },
      },
      {
        id: "dog",
        label: "🐶 Dogs",
        cost: 0,
        costLabel: capacity === 0 ? "LOCKED" : `${dogCatCount}/${capacity}`,
        disabled: capacity === 0,
        run: () => {
          // Deliberately doesn't close locationMenu — it stays open behind
          // the vehicle sheet (same overlay z-index, later in DOM order so
          // it paints on top) so Close on the sheet reveals the Pets list
          // again instead of exiting the whole shop (see buildPetBreedSheet).
          openPetBreedSheet("dog");
          return "";
        },
      },
      {
        id: "cat",
        label: "🐱 Cats",
        cost: 0,
        costLabel: capacity === 0 ? "LOCKED" : `${dogCatCount}/${capacity}`,
        disabled: capacity === 0,
        run: () => {
          openPetBreedSheet("cat");
          return "";
        },
      },
      ...(["fish", "snake", "bird", "rabbit"] as PetTankType[]).map((type) => ({
        id: type,
        label: `${PET_TANK_META[type].icon} ${PET_TANK_META[type].label}`,
        cost: 0,
        costLabel: petTankRowLabel(type),
        disabled: !PET_TANK_META[type].isOwned() && PET_TANK_META[type].minStage > petTankCeiling(),
        run: () => {
          petStoreTankView = type;
          return "";
        },
      })),
    ],
  };
}

function buildPetTankStageMenu(type: PetTankType): MenuData {
  const meta = PET_TANK_META[type];
  const ceiling = petTankCeiling();
  const owned = meta.isOwned();
  const currentStage = meta.currentStage();
  const stages: number[] = [];
  for (let s = meta.minStage; s <= 4; s++) stages.push(s);

  return {
    title: `${meta.icon} ${meta.label}`,
    energyText: `Money: $${playerState.money}  ·  Housing ceiling: Stage ${ceiling}/4`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          petStoreTankView = null;
          return "";
        },
      },
      ...stages.map((stage) => {
        const locked = stage > ceiling;
        const reached = owned && currentStage >= stage;
        const price = meta.prices[stage];
        const speciesNames = meta.speciesAtStage(stage)
          .map((s) => s.name)
          .join(" + ");
        return {
          id: `stage-${stage}`,
          label: `Stage ${stage} — ${speciesNames}`,
          cost: 0,
          costLabel: reached ? "OWNED" : locked ? "LOCKED" : `$${price}`,
          disabled: reached || locked,
          run: () => {
            if (reached) return "Already at this stage or better.";
            if (locked) return `Needs better housing — ceiling is Stage ${ceiling}.`;
            // Trailer only has room for one tank, Fish or Snake — the
            // restriction lifts on its own once the ceiling rises past
            // Stage 1 (Apartment+), so it only matters on a first purchase.
            if (!owned && (type === "fish" || type === "snake") && ceiling === 1) {
              const other = type === "fish" ? playerState.snakeTankOwned : playerState.fishTankOwned;
              if (other) return "Trailer only has room for one tank — Fish or Snake, not both.";
            }
            if (playerState.money < price) return `Not enough money — need $${price}, have $${playerState.money}.`;
            playerState.money -= price;
            meta.purchase(stage);
            return `${meta.label} upgraded — now home to ${speciesNames}!`;
          },
        };
      }),
    ],
  };
}

type PetBreedCategory = "dog" | "cat";
let petBreedCategory: PetBreedCategory = "dog";
let petBreedIndex = 0;
let petBreedMessage = "";

function openPetBreedSheet(category: PetBreedCategory) {
  petBreedCategory = category;
  petBreedIndex = 0;
  petBreedMessage = "";
  vehicleSheet.open(buildPetBreedSheet);
}

function buildPetBreedSheet(): VehicleSheetData {
  const breeds = petBreedCategory === "dog" ? DOG_BREEDS : CAT_BREEDS;
  const price = petBreedCategory === "dog" ? DOG_PRICE : CAT_PRICE;
  const owned = petBreedCategory === "dog" ? playerState.dogsOwned : playerState.catsOwned;
  const breed = breeds[petBreedIndex];
  const capacity = dogCatCapacity();
  const totalOwned = playerState.dogsOwned.length + playerState.catsOwned.length;
  const full = totalOwned >= capacity;
  const countOfThisBreed = owned.filter((p) => p.breedId === breed.id).length;

  return {
    title: breed.name,
    image: breed.image,
    infoText: `Wallet: $${playerState.money}\nHousehold pets: ${totalOwned}/${capacity}${countOfThisBreed > 0 ? `\nYou already have ${countOfThisBreed}.` : ""}`,
    priceText: `$${price}`,
    message: petBreedMessage || undefined,
    actions: [
      {
        id: "buy",
        label: full ? "🏠 Household Full" : `💰 Buy — $${price}`,
        disabled: full,
        run: () => {
          if (playerState.money < price) {
            petBreedMessage = `Not enough money — need $${price}, have $${playerState.money}.`;
            return;
          }
          playerState.money -= price;
          owned.push({ breedId: breed.id, name: null });
          petBreedMessage = `Adopted a ${breed.name}! Name it at Home to unlock feeding and playtime.`;
        },
      },
    ],
    onPrev: () => {
      petBreedIndex = (petBreedIndex - 1 + breeds.length) % breeds.length;
      petBreedMessage = "";
    },
    onNext: () => {
      petBreedIndex = (petBreedIndex + 1) % breeds.length;
      petBreedMessage = "";
    },
    // Closing returns to the Pets list (still open behind this sheet, see
    // the "dog"/"cat" rows above) instead of exiting the whole Pet Store —
    // re-opening forces a fresh render so a just-bought pet's updated
    // count actually shows instead of the stale pre-purchase numbers.
    onClose: () => {
      vehicleSheet.close();
      locationMenu.open(buildPetStoreMenu);
    },
  };
}

const FURNITURE_ITEMS: ShopItem[] = [
  { id: "sofa", name: "Sofa", price: 400 },
  { id: "bed-frame", name: "Bed Frame", price: 600 },
  { id: "tv-stand", name: "TV Stand", price: 300 },
];

function openFurnitureMenu() {
  locationMenu.open(() => ({
    title: "🛋️ Furniture Store",
    energyText: "Browsing only — purchases happen via the Phone once that's supported.",
    actions: FURNITURE_ITEMS.map((f) => ({
      id: f.id,
      label: f.name,
      cost: 0,
      costLabel: `$${f.price}`,
      disabled: true,
      run: () => "",
    })),
  }));
}

/**
 * Perfect = +2, Good = +1, everything else = +0 — banked into the matching
 * training stat. Marks the stat as trained regardless of the bonus earned,
 * so a session that scored all misses still reads "+0", not "Not trained
 * yet" — that label is reserved for a stat with no completed session at all.
 */
function applyTraining(stat: keyof TrainingStats, results: string[]) {
  let bonus = 0;
  for (const r of results) {
    if (r === "perfect") bonus += 2;
    else if (r === "good") bonus += 1;
  }
  playerState.training[stat].bonus += bonus;
  playerState.training[stat].trained = true;
}

tapZone.onTap((x, y) => {
  if (scene.type === "reflexdots") scene.game.handleTap(x, y);
  else if (scene.type === "jumprope") scene.game.handleTap(window.innerHeight);
});

// Stations placed inside specific buildings' interiors — walk up to one
// and its prompt surfaces the same way the street's ENTER prompt does.
// Every purchasable home (Real Estate App) gets the same bed — not just
// the starting Trailer.
const HOUSE_STATIONS: Station[] = [
  { id: "bed", label: "Sleep", nx: 0.5, ny: 0.3 },
  // Bottom-right corner of the room — walk up to enter the Garage menu.
  { id: "garage", label: "Garage", nx: 0.88, ny: 0.82 },
  // Top-left corner — mirrors the Garage's opposite-corner placement.
  { id: "wardrobe", label: "Wardrobe", nx: 0.12, ny: 0.18 },
];
const BED_STATION_ID = HOUSE_STATIONS[0].id;
// True for exactly one room-view: right after sleepAtBed/an Overnight Stay
// resolves, so whoever the player just slept with (spouse or an overnight
// guest) shows up next to the bed instead of her usual spot — cleared the
// next time the player enters ANY building (see enterBuilding), so leaving
// Home and walking back in puts her back at her regular spot.
let justSleptTogether = false;
const HOUSE_NAMES = new Set([
  "Trailer",
  "Apartment",
  "Penthouse Apartment",
  "Mansion",
  "Suburban House",
  "Townhouse",
]);

// Reception desk — sits between the player's approach and the two
// receptionists, purely visual (see Decoration in game/interior.ts).
const OFFICE_DECORATIONS: Decoration[] = [
  { id: "reception-desk", nx: 0.3, ny: 0.4, width: 200, height: 36, blocking: true },
  // Lobby seating, opposite the reception desk — purely visual, not
  // blocking (nothing to route around like the desk). Derek's station
  // sits right at the left one.
  { nx: 0.75, ny: 0.72, width: 50, height: 70, color: "#3a5a78" },
  { nx: 0.88, ny: 0.72, width: 50, height: 70, color: "#3a5a78" },
];

const STATIONS_BY_BUILDING: Record<string, Station[]> = {
  Trailer: HOUSE_STATIONS,
  Apartment: HOUSE_STATIONS,
  "Penthouse Apartment": HOUSE_STATIONS,
  Mansion: HOUSE_STATIONS,
  "Suburban House": HOUSE_STATIONS,
  Townhouse: HOUSE_STATIONS,
  Gym: [
    { id: "heavybag", label: "Heavy Bag", nx: 0.25, ny: 0.3 },
    { id: "reflexdots", label: "Reflex Dots", nx: 0.5, ny: 0.3 },
    { id: "jumprope", label: "Jump Rope", nx: 0.75, ny: 0.3 },
    { id: "workoutclip", label: "Weight Area", nx: 0.5, ny: 0.6 },
  ],
  Diner: [{ id: "order", label: "Order Menu", nx: 0.5, ny: 0.4 }],
  Office: [
    {
      id: "reception-priya",
      label: "Priya",
      nx: 0.2,
      ny: 0.28,
      kind: "npc",
      radius: 24,
      approachDecorationId: "reception-desk",
    },
    {
      id: "reception-2",
      label: "Carol",
      nx: 0.4,
      ny: 0.28,
      kind: "npc",
      radius: 24,
      approachDecorationId: "reception-desk",
    },
    { id: "elevator", label: "Elevator", nx: 0.78, ny: 0.15 },
  ],
  Beach: [
    { id: "sunbathe", label: "Sunbathe", nx: 0.35, ny: 0.4 },
    { id: "swim", label: "Swim", nx: 0.65, ny: 0.4 },
  ],
  Lounge: [
    { id: "bar", label: "Bar", nx: 0.3, ny: 0.4 },
    { id: "vip-bouncer", label: "VIP Bouncer", nx: 0.55, ny: 0.32 },
    { id: "bottle", label: "Buy a Bottle", nx: 0.85, ny: 0.15 },
  ],
  Airport: [{ id: "vacation", label: "Go on Vacation", nx: 0.5, ny: 0.4 }],
  Arena: [{ id: "simulate-fight", label: "Simulate Fight", nx: 0.5, ny: 0.4 }],
  Mall: [
    { id: "vehicles", label: "Vehicle Dealer", nx: 0.05, ny: 0.3 },
    { id: "petstore", label: "Pet Store", nx: 0.05, ny: 0.7 },
    { id: "giftshop", label: "Gift Shop", nx: 0.5, ny: 0.08 },
    { id: "clothes", label: "Clothing Store", nx: 0.95, ny: 0.3 },
    { id: "furniture", label: "Furniture Store", nx: 0.95, ny: 0.7 },
  ],
  "Press Building": [
    { id: "faceoff", label: "Face-Off Area", nx: 0.25, ny: 0.25 },
    { id: "fanevent", label: "Marketing Expert", nx: 0.75, ny: 0.25 },
    { id: "pressreception", label: "Press Reception", nx: 0.5, ny: 0.5 },
    { id: "photostudio", label: "Photo Studio", nx: 0.25, ny: 0.75 },
    { id: "pressconf", label: "Press Conference Room", nx: 0.75, ny: 0.75 },
  ],
};

// Meetup System: which building(s) a location id corresponds to, and
// where her marker sits in that room when a meetup's arranged there.
const MEETUP_LOCATION_BUILDING: Record<MeetupLocationId, (buildingName: string) => boolean> = {
  home: (name) => HOUSE_NAMES.has(name),
  diner: (name) => name === "Diner",
  beach: (name) => name === "Beach",
  lounge: (name) => name === "Lounge",
};
const MEETUP_STATION_POS: Record<MeetupLocationId, { nx: number; ny: number }> = {
  home: { nx: 0.5, ny: 0.65 },
  diner: { nx: 0.5, ny: 0.75 },
  beach: { nx: 0.5, ny: 0.75 },
  lounge: { nx: 0.2, ny: 0.75 },
};

/** The arranged NPC's station for this room, if a pending meetup is set here — null otherwise. */
function getActiveMeetupStation(buildingName: string): Station | null {
  const meetup = playerState.activeMeetup;
  if (meetup && MEETUP_LOCATION_BUILDING[meetup.location](buildingName)) {
    const npc = getNpcById(meetup.npcId);
    if (npc) return { id: "meetup-npc", label: npc.name, kind: "npc", ...MEETUP_STATION_POS[meetup.location] };
  }
  // An overnight guest, still asleep at Home the morning after — a
  // separate, lower-key station (see the "overnight-guest" dispatch)
  // rather than the full meetup dialogue.
  if (HOUSE_NAMES.has(buildingName)) {
    for (const npcId of Object.keys(playerState.overnightCommuteStep)) {
      if (playerState.overnightCommuteStep[npcId] === 0) {
        const npc = getNpcById(npcId);
        if (npc) return { id: "overnight-guest", label: npc.name, kind: "npc", ...MEETUP_STATION_POS.home };
      }
    }
  }
  return null;
}

// Marriage System: once accepted, she permanently lives at home instead of
// her old station — this is the station that replaces "meetup-npc"/her
// regular-location station for good, in every house the player owns.
function getSpouseStation(buildingName: string): Station | null {
  if (!HOUSE_NAMES.has(buildingName)) return null;
  const spouseId = Object.keys(playerState.married).find((id) => playerState.married[id]);
  if (!spouseId) return null;
  const npc = getNpcById(spouseId);
  return npc ? { id: "spouse-npc", label: npc.name, kind: "npc", nx: 0.75, ny: 0.3 } : null;
}

// Family System: one dot per kid, laid out along the bottom of the room —
// separate from the bed (0.5, 0.3) and spouse (0.75, 0.3) up top. Only a
// handful of positions exist since kidsWants is always a small number for
// any NPC written so far; extra kids beyond the list just stack on the
// last slot rather than crash.
const CHILD_STATION_POSITIONS: { nx: number; ny: number }[] = [
  { nx: 0.25, ny: 0.75 },
  { nx: 0.4, ny: 0.75 },
  { nx: 0.55, ny: 0.75 },
  { nx: 0.7, ny: 0.75 },
];
function getChildStations(buildingName: string): Station[] {
  if (!HOUSE_NAMES.has(buildingName)) return [];
  const spouseId = Object.keys(playerState.married).find((id) => playerState.married[id]);
  if (!spouseId) return [];
  const kids = playerState.children[spouseId] ?? [];
  return kids.map((child, i) => ({
    id: child.id,
    label: child.name,
    kind: "npc",
    ...(CHILD_STATION_POSITIONS[i] ?? CHILD_STATION_POSITIONS[CHILD_STATION_POSITIONS.length - 1]),
  }));
}

// Pet Store (Section 5, updated): pets are Home fixtures like children,
// but not tied to a spouse — they show up in every house the player owns
// regardless of romance state, so (unlike getChildStations) this is
// unconditional. A simple 4-per-row grid, generated rather than hand-
// authored since the count varies a lot (0 to 8 Dog/Cat slots + up to 4
// tank/cage stations) — sits between the bed/spouse row and the kids row
// so it doesn't collide with either.
function petStationPosition(index: number): { nx: number; ny: number } {
  const perRow = 4;
  const row = Math.floor(index / perRow);
  const col = index % perRow;
  return { nx: 0.15 + col * 0.22, ny: 0.45 + row * 0.13 };
}
function getPetStations(buildingName: string): Station[] {
  if (!HOUSE_NAMES.has(buildingName)) return [];
  const ids: string[] = [];
  playerState.dogsOwned.forEach((_, i) => ids.push(`pet-dog-${i}`));
  playerState.catsOwned.forEach((_, i) => ids.push(`pet-cat-${i}`));
  if (playerState.fishTankOwned) ids.push("pet-fish");
  if (playerState.snakeTankOwned) ids.push("pet-snake");
  if (playerState.birdCageOwned) ids.push("pet-bird");
  if (playerState.rabbitCageOwned) ids.push("pet-rabbit");
  return ids.map((id, index) => {
    const info = describePetStation(id)!;
    return { id, label: info.displayName, kind: "npc", ...petStationPosition(index) };
  });
}

interface PetStationInfo {
  kind: "dog" | "cat" | "tank";
  displayName: string;
  portrait: string;
  foodCategory: PetCategory;
  petIndex?: number; // dog/cat only — index into dogsOwned/catsOwned
  named?: boolean; // dog/cat only
}

/** Pet Supply interaction (Section 5, updated): resolves a "pet-*" station id to what's shown in the dialogue. Dog/Cat show "Unnamed Dog/Cat" until named at Home (see buildPetSupplyDialogue); Fish/Snake/Bird/Rabbit are never named. */
function describePetStation(stationId: string): PetStationInfo | null {
  const dogMatch = stationId.match(/^pet-dog-(\d+)$/);
  if (dogMatch) {
    const i = Number(dogMatch[1]);
    const pet = playerState.dogsOwned[i];
    if (!pet) return null;
    const breed = DOG_BREEDS.find((b) => b.id === pet.breedId);
    return {
      kind: "dog",
      displayName: pet.name ?? "Unnamed Dog",
      portrait: breed?.image ?? "🐶",
      foodCategory: "dog",
      petIndex: i,
      named: !!pet.name,
    };
  }
  const catMatch = stationId.match(/^pet-cat-(\d+)$/);
  if (catMatch) {
    const i = Number(catMatch[1]);
    const pet = playerState.catsOwned[i];
    if (!pet) return null;
    const breed = CAT_BREEDS.find((b) => b.id === pet.breedId);
    return {
      kind: "cat",
      displayName: pet.name ?? "Unnamed Cat",
      portrait: breed?.image ?? "🐱",
      foodCategory: "cat",
      petIndex: i,
      named: !!pet.name,
    };
  }
  if (stationId === "pet-fish") {
    return {
      kind: "tank",
      displayName: "Fish Tank",
      portrait: fishSpeciesAtStage(playerState.fishTankStage).map((s) => s.image).join(""),
      foodCategory: "fish",
    };
  }
  if (stationId === "pet-snake") {
    return {
      kind: "tank",
      displayName: "Snake Tank",
      portrait: snakeSpeciesAtStage(playerState.snakeTankStage).map((s) => s.image).join(""),
      foodCategory: "snake",
    };
  }
  if (stationId === "pet-bird") {
    return {
      kind: "tank",
      displayName: "Bird Cage",
      portrait: birdSpeciesAtStage(playerState.birdCageStage).map((s) => s.image).join(""),
      foodCategory: "bird",
    };
  }
  if (stationId === "pet-rabbit") {
    return {
      kind: "tank",
      displayName: "Rabbit Cage",
      portrait: rabbitSpeciesAtStage(playerState.rabbitCageStage).map((s) => s.image).join(""),
      foodCategory: "rabbit",
    };
  }
  return null;
}

// Purely cosmetic — not a Tamagotchi decay system. Feeding/playing just
// pulses the portrait happy (reference: Pikachu's reactions in Pokémon
// Yellow); there's no maintenance and no penalty for never visiting.
let petSupplyMood: "neutral" | "happy" = "neutral";
let petSupplyMessage = "";
let petSupplyView: "main" | "toy-pick" | "message" = "main";
let petNameDraft = "";

function openPetSupplyDialogue(stationId: string) {
  petSupplyMood = "neutral";
  petSupplyMessage = "";
  petSupplyView = "main";
  petNameDraft = "";
  dialogueBox.open(() => buildPetSupplyDialogue(stationId));
}

function buildPetSupplyDialogue(stationId: string): DialogueData {
  const info = describePetStation(stationId);
  if (!info) {
    return {
      portrait: "🐾",
      name: "",
      text: "",
      options: [{ id: "leave", label: "‹ Leave", onSelect: () => dialogueBox.close() }],
    };
  }

  // Dog/Cat, not yet named: naming is the only thing on offer — Feed/Play
  // unlock once it has a name (Fish/Snake/Bird/Rabbit are never named).
  if ((info.kind === "dog" || info.kind === "cat") && !info.named) {
    return {
      portrait: info.portrait,
      name: info.displayName,
      text: `Give your new ${info.kind} a name.`,
      textInput: {
        value: petNameDraft,
        placeholder: "Name",
        submitLabel: "Name",
        onChange: (v) => {
          petNameDraft = v;
        },
        onSubmit: () => {
          const trimmed = petNameDraft.trim();
          if (!trimmed) return;
          const list = info.kind === "dog" ? playerState.dogsOwned : playerState.catsOwned;
          list[info.petIndex!].name = trimmed;
        },
      },
      options: [{ id: "leave", label: "‹ Leave", onSelect: () => dialogueBox.close() }],
    };
  }

  const canPlay = info.kind === "dog" || info.kind === "cat";
  // Once per phase, per pet — same hasUsedThisPhase/markUsedThisPhase
  // mechanism every other once-per-phase Private Life activity uses
  // (cleared on every sleep/phase advance, see clearUsedThisPhase). Not
  // stage-gated like those, though — pets are a Home fixture available
  // every phase, just rate-limited within it.
  const feedId = `pet-feed-${stationId}`;
  const playId = `pet-play-${stationId}`;

  // A mismatched toy doesn't just fall straight back to the Feed/Play
  // menu — it gets its own single-message beat with an OK to acknowledge,
  // same as the naming/food flows never silently skip a step. A matching
  // toy skips this and goes straight to the happy reaction on the main
  // screen below, same as Feed already does.
  if (petSupplyView === "message") {
    return {
      portrait: info.portrait,
      name: info.displayName,
      text: petSupplyMessage,
      options: [
        {
          id: "ok",
          label: "OK",
          onSelect: () => {
            petSupplyView = "main";
            petSupplyMessage = "";
          },
        },
      ],
    };
  }

  if (petSupplyView === "toy-pick" && canPlay) {
    return {
      portrait: info.portrait,
      name: info.displayName,
      text: "Pick a toy to play with.",
      optionsLayout: "grid",
      options: [
        ...PET_TOY_CATALOG.map((t) => {
          const count = playerState.petToyInventory[t.id] ?? 0;
          return {
            id: t.id,
            icon: t.icon,
            label: `${t.name} (${count})`,
            disabled: count === 0,
            onSelect: () => {
              playerState.petToyInventory[t.id] -= 1;
              markUsedThisPhase(playId);
              if (t.for === info.kind) {
                petSupplyMood = "happy";
                petSupplyMessage = "";
                petSupplyView = "main";
              } else {
                petSupplyMood = "neutral";
                petSupplyMessage = `${info.displayName} doesn't know what to do with that.`;
                petSupplyView = "message";
              }
            },
          };
        }),
        {
          id: "back",
          icon: "↩️",
          label: "Back",
          onSelect: () => {
            petSupplyView = "main";
          },
        },
      ],
    };
  }

  const foodOwned = playerState.petFoodInventory[info.foodCategory] ?? 0;
  const fedThisPhase = hasUsedThisPhase(feedId);
  const options: DialogueOption[] = [
    {
      id: "food",
      label: "🍖 Feed",
      costLabel: fedThisPhase ? "FED" : foodOwned > 0 ? undefined : "NO FOOD",
      disabled: fedThisPhase || foodOwned === 0,
      onSelect: () => {
        playerState.petFoodInventory[info.foodCategory] -= 1;
        markUsedThisPhase(feedId);
        petSupplyMood = "happy";
        petSupplyMessage = "";
      },
    },
  ];
  if (canPlay) {
    const playedThisPhase = hasUsedThisPhase(playId);
    options.push({
      id: "toy",
      label: "🧸 Play with Toy",
      costLabel: playedThisPhase ? "PLAYED" : undefined,
      disabled: playedThisPhase,
      onSelect: () => {
        petSupplyView = "toy-pick";
      },
    });
  }
  options.push({ id: "leave", label: "‹ Leave", onSelect: () => dialogueBox.close() });

  return {
    portrait: info.portrait,
    name: info.displayName,
    text:
      petSupplyMessage ||
      (petSupplyMood === "happy" ? `${info.displayName} is thrilled! 🎉` : `${info.displayName} looks up at you.`),
    portraitMood: petSupplyMood === "happy" ? "happy" : undefined,
    options,
  };
}

// True while an NPC is away from her normal station — either because
// a meetup's been arranged elsewhere and not yet fulfilled, or she's
// mid-commute after an Overnight Stay (still asleep at home, or on her
// way in but not yet arrived — see advanceOvernightCommute). Generic
// across every building (Office floors, Mall stores, Reception) — not
// Office-specific despite the historical name of its call sites.
// Lobby Wanderer: Derek isn't fixed to the desk like the receptionists —
// wandering-cast rather than permanent. Content is only being designed
// for "No Fight Scheduled" right now, so this only covers that phase for
// now; his other 2 phases (spec: "3 camp cycle phases including Phase 1")
// get decided once Training 1 and onward are actually being designed.
// Shared by his station and the Text/Meetup presence check.
function isDerekPresentThisPhase(): boolean {
  return campCycle.current.type === "nofight";
}

function isNpcAway(npcId: string): boolean {
  if (playerState.divorced[npcId]) return true; // permanent — she's gone from the game for good
  if (playerState.married[npcId]) return true; // permanent — she's moved out for good
  if (playerState.activeMeetup?.npcId === npcId) return true;
  if (npcId === "derek" && !isDerekPresentThisPhase()) return true;
  const step = playerState.overnightCommuteStep[npcId];
  return step !== undefined && step < 2;
}

// Each time the player enters ANY building, an NPC mid-commute (see
// resolveOvernightStay) advances one step closer to being back at her
// normal spot: 0 (asleep at home) → 1 (in transit, present nowhere) → back
// to normal. This is deliberately building-entry-driven rather than tied
// to a phase advance, so it resolves within the same phase.
function advanceOvernightCommute() {
  for (const npcId of Object.keys(playerState.overnightCommuteStep)) {
    const next = playerState.overnightCommuteStep[npcId] + 1;
    if (next >= 2) delete playerState.overnightCommuteStep[npcId];
    else playerState.overnightCommuteStep[npcId] = next;
  }
}

/** Derek's Lobby spot — only present some phases (see isDerekPresentThisPhase), so this is additive rather than a static STATIONS_BY_BUILDING entry. */
function getDerekStation(buildingName: string): Station | null {
  if (buildingName !== "Office" || !isDerekPresentThisPhase()) return null;
  // Parked in the left of the two lobby seats, opposite Reception.
  return { id: "derek-lobby", label: "Derek", kind: "npc", nx: 0.75, ny: 0.72 };
}

/** Jasmine's Mall Lobby spot — a wanderer like Derek, but no camp-phase restriction, just the generic isNpcAway check. */
function getJasmineStation(buildingName: string): Station | null {
  if (buildingName !== "Mall" || isNpcAway("jasmine")) return null;
  // Central, away from the 5 store-entry stations around the edges.
  return { id: "jasmine-lobby", label: "Jasmine", kind: "npc", nx: 0.5, ny: 0.55 };
}

// Right after sleeping together, her spouse-npc/overnight-guest marker
// moves to sit beside the bed instead of her regular spot (see
// justSleptTogether) — offset slightly from the bed's own position so the
// two markers don't fully overlap.
function applyBedPositionIfJustSlept(station: Station): Station {
  if (!justSleptTogether) return station;
  if (station.id !== "spouse-npc" && station.id !== "overnight-guest") return station;
  const bed = HOUSE_STATIONS.find((s) => s.id === BED_STATION_ID)!;
  return { ...station, nx: Math.min(0.95, bed.nx + 0.12), ny: bed.ny };
}

function computeStationsFor(buildingName: string): Station[] {
  let base = STATIONS_BY_BUILDING[buildingName] ?? [];
  // Her marker shouldn't just be non-interactive while she's away — it
  // shouldn't be there to look confusingly clickable in the first place.
  if (buildingName === "Office" && isNpcAway("priya")) {
    base = base.filter((s) => s.id !== "reception-priya");
  }
  const derekStation = getDerekStation(buildingName);
  if (derekStation) base = [...base, derekStation];
  const jasmineStation = getJasmineStation(buildingName);
  if (jasmineStation) base = [...base, jasmineStation];
  base = [...base, ...getPetStations(buildingName)];
  const spouseStation = getSpouseStation(buildingName);
  if (spouseStation) return [...base, applyBedPositionIfJustSlept(spouseStation), ...getChildStations(buildingName)];
  const meetupStation = getActiveMeetupStation(buildingName);
  if (meetupStation?.id === "meetup-npc") {
    // She's here for an arranged Regular Meetup/Date — no wandering off to
    // the room's own solo self-serve stations (Diner's Order Menu, Beach's
    // Sunbathe/Swim, Lounge's Bar/VIP Bouncer/Buy a Bottle, Home's bed)
    // while she's waiting on you instead.
    base = [];
  }
  return meetupStation ? [...base, applyBedPositionIfJustSlept(meetupStation)] : base;
}

/** Builds a fresh InteriorScene for this lot, including its meetup NPC marker if one's arranged here. */
function buildInteriorScene(lot: LotInstance, spawnStationId?: string): InteriorScene {
  const stations = computeStationsFor(lot.building.name);
  const blockedZone = lot.building.name === "Lounge" ? LOUNGE_VIP_ZONE : undefined;
  const decorations = lot.building.name === "Office" ? OFFICE_DECORATIONS : undefined;
  return new InteriorScene(lot, stations, blockedZone, decorations, true, spawnStationId);
}

// Each Mall store is its own room, entered through a wall-side station on
// the main floor — same sub-room pattern as Office's elevator floors, just
// triggered by walking up to a door instead of picking from a menu.
const MALL_STORE_LABELS: Record<string, string> = {
  vehicles: "Vehicle Dealer",
  clothes: "Clothing Store",
  giftshop: "Gift Shop",
  petstore: "Pet Store",
  furniture: "Furniture Store",
};

// No store has a separate walk-up counter anymore — shopping happens at
// whichever staff member is the shopkeeper instead (see
// isMallShopkeeper/buildMallStoreRoom), same as buying isn't a separate
// station from Priya/Carol at Office Reception. Every entry is empty; the
// map's keys still double as the set of valid store-entry station ids on
// the main Mall floor (see the elevator-style dispatch below).
const MALL_STORE_STATIONS: Record<string, Station[]> = {
  vehicles: [],
  clothes: [],
  giftshop: [],
  petstore: [],
  furniture: [],
};

type Scene =
  | { type: "street" }
  // officeFloor/mallStore are set only while inside a building's sub-room —
  // their door returns to that building's main room instead of the street.
  | { type: "interior"; lot: LotInstance; interior: InteriorScene; officeFloor?: number; mallStore?: string }
  | { type: "heavybag"; lot: LotInstance; interior: InteriorScene; game: HeavyBagScene }
  | { type: "reflexdots"; lot: LotInstance; interior: InteriorScene; game: ReflexDotsScene }
  | { type: "jumprope"; lot: LotInstance; interior: InteriorScene; game: JumpRopeScene };
let scene: Scene = { type: "street" };
// Latches the end-meetup door confirmation to one prompt per approach to
// the door, instead of reopening it every frame the player stands there.
let doorConfirmShown = false;

function enterBuilding(lot: LotInstance, anchor: { x: number; y: number }) {
  if (lot.building.locked) {
    buildingUI.showToast(
      "LOCKED — you need to purchase this building first via the Real Estate App.",
      anchor,
      lot.row,
    );
    return; // stay on the street; no room, so no exit mechanic is needed
  }
  // Fight night: only home and the Arena are open — everywhere else is closed.
  if (
    campCycle.current.type === "fight" &&
    !HOUSE_NAMES.has(lot.building.name) &&
    lot.building.name !== "Arena"
  ) {
    buildingUI.showToast("Closed for fight night — only your home and the Arena are open.", anchor, lot.row);
    return;
  }
  // After Fight: only home and the Airport (Vacation) are open.
  if (
    campCycle.current.type === "afterfight" &&
    !HOUSE_NAMES.has(lot.building.name) &&
    lot.building.name !== "Airport"
  ) {
    buildingUI.showToast("Closed after the fight — only your home and the Airport are open.", anchor, lot.row);
    return;
  }
  advanceOvernightCommute();
  // Sleeping together only holds her at the bedside for the room-view right
  // after it happens — a fresh entry (even right back into the same house)
  // returns her to her regular spot.
  justSleptTogether = false;
  scene = { type: "interior", lot, interior: buildInteriorScene(lot) };
  controls.root.style.display = "none";
  buildingUI.setEnterPrompt(null, () => {});
  joystick.setActive(true);
}

/** Leaves the current interior for the street, no vehicle change — used by both a plain door exit and the Garage's Drive/Set as Standard. */
function returnToStreet() {
  scene = { type: "street" };
  controls.root.style.display = "flex";
  joystick.setActive(false);
}

function exitBuilding() {
  // Garage (Section 5, updated): walking out of Home's actual door always
  // resets to the standard vehicle — the only way to leave in something
  // else is the Garage's Drive/Set as Standard, which exit straight to the
  // street themselves (see buildGarageMenu) and never call this function.
  if (scene.type === "interior" && HOUSE_NAMES.has(scene.lot.building.name) && playerState.standardVehicle) {
    playerState.activeVehicle = playerState.standardVehicle;
    applyVehiclePerformance();
  }
  returnToStreet();
}

const TRAINING_STATION_IDS = new Set(["heavybag", "reflexdots", "jumprope"]);

function startStation(lot: LotInstance, interior: InteriorScene, stationId: string, anchor: { x: number; y: number }) {
  // Each Training minigame costs the full 100 Energy Star (Section 4) —
  // only one per session, and it leaves nothing for Private Life actions
  // until you sleep, which is the mechanism that actually keeps training
  // and private-life days separated.
  if (TRAINING_STATION_IDS.has(stationId) && !energy.spend(100)) {
    buildingUI.showToast("Not enough energy left to train today — sleep to refill first.", anchor, "bottom");
    return;
  }

  joystick.setActive(false);
  buildingUI.setEnterPrompt(null, () => {});
  if (stationId === "heavybag") {
    scene = { type: "heavybag", lot, interior, game: new HeavyBagScene() };
  } else if (stationId === "reflexdots") {
    scene = { type: "reflexdots", lot, interior, game: new ReflexDotsScene() };
    tapZone.setActive(true);
  } else if (stationId === "jumprope") {
    scene = { type: "jumprope", lot, interior, game: new JumpRopeScene() };
    tapZone.setActive(true);
  }
}

function finishMinigame(lot: LotInstance, interior: InteriorScene) {
  scene = { type: "interior", lot, interior };
  actionButtons.hideAll();
  tapZone.setActive(false);
  buildingUI.setEnterPrompt(null, () => {});
  joystick.setActive(true);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const outOfMinigame = scene.type === "street" || scene.type === "interior";
  statusHud.style.display = outOfMinigame ? "flex" : "none";
  moneyHud.style.display = outOfMinigame ? "block" : "none";
  campHud.style.display = outOfMinigame ? "flex" : "none";
  if (outOfMinigame) {
    energyPill.textContent = `⚡ ${energy.remaining}/${energy.maxValue}`;
    hpPill.textContent = `❤ ${playerState.hp} HP`;
    socialPill.textContent = `💬 ${socialBattery.remaining}/100`;
    moneyPill.textContent = `$${playerState.money}`;
    const stage = campCycle.current;
    const statSuffix = stage.stat ? ` — ${stage.stat[0].toUpperCase()}${stage.stat.slice(1)}` : "";
    campPill.textContent = `🥊 Camp ${campCycle.campNumber} · ${stage.label}${statSuffix}`;
  }

  // The Phone only works inside a building, not while driving, and stays
  // hidden while another location's action menu is already open.
  phoneBtn.style.display =
    scene.type === "interior" &&
    !phoneUI.isOpen() &&
    !locationMenu.isOpen() &&
    !dialogueBox.isOpen() &&
    !vehicleSheet.isOpen()
      ? "flex"
      : "none";
  debugBtn.style.display =
    outOfMinigame && !phoneUI.isOpen() && !locationMenu.isOpen() && !dialogueBox.isOpen() && !vehicleSheet.isOpen()
      ? "flex"
      : "none";

  if (scene.type === "street") {
    street.update(dt);
    street.render(ctx, window.innerWidth, window.innerHeight);
    hudLabel.textContent = street.getCurrentFrameLabel();

    // Only the building on the player's current right-hand side is
    // enterable — reaching the other side means U-turning first.
    const [lot] = street.isStopped()
      ? nearbyLots(street.getWorldX()).filter((l) => l.row === rowForFacing(street.getFacing()))
      : [];

    if (lot) {
      const pos = street.getEntranceScreenPos(lot, window.innerWidth, window.innerHeight);
      buildingUI.setEnterPrompt(pos, () => enterBuilding(lot, pos));
    } else {
      buildingUI.setEnterPrompt(null, () => {});
    }
  } else if (scene.type === "interior") {
    const { lot, interior, officeFloor, mallStore } = scene;
    const { atDoor, nearStation } = interior.update(dt, joystick.getVector(), window.innerWidth, window.innerHeight);
    interior.render(ctx, window.innerWidth, window.innerHeight);
    hudLabel.textContent = officeFloor
      ? `${lot.building.name} — Floor ${officeFloor}`
      : mallStore
        ? `${lot.building.name} — ${MALL_STORE_LABELS[mallStore]}`
        : lot.building.name;

    if (atDoor) {
      if (mallStore) {
        // Store rooms exit back to the Mall floor, not the street — and
        // right in front of that store's own entrance (its station id
        // matches the store id, see STATIONS_BY_BUILDING.Mall), not the
        // Mall's own street-side lobby door.
        scene = {
          type: "interior",
          lot,
          interior: new InteriorScene(lot, computeStationsFor("Mall"), undefined, undefined, true, mallStore),
        };
      } else if (playerState.activeMeetup && interior.hasStation("meetup-npc")) {
        // Checks the room's own station list (fixed at entry), not just
        // whether a meetup's arranged — an arranged-but-not-yet-visited
        // meetup shouldn't trigger this if the player never left and came
        // back since arranging it (she isn't actually here yet).
        // Walking to the door mid-visit doesn't exit on its own — confirm
        // first (only once per approach, not every frame standing here).
        if (!doorConfirmShown) {
          doorConfirmShown = true;
          openEndMeetupConfirm();
        }
      } else {
        exitBuilding();
      }
    } else if (nearStation) {
      doorConfirmShown = false;
      const pos = interior.getStationScreenPos(nearStation, window.innerWidth, window.innerHeight);
      const phaseLock = getStationPhaseLock(nearStation.id);
      let onTrigger: () => void;
      if (phaseLock) onTrigger = () => buildingUI.showToast(phaseLock, pos, "bottom");
      else if (nearStation.id === "bed") {
        const bedLock = getBedLock();
        onTrigger = bedLock ? () => buildingUI.showToast(bedLock, pos, "bottom") : () => sleepAtBed(pos);
      }
      else if (nearStation.id === "garage") onTrigger = openGarageMenu;
      else if (nearStation.id === "wardrobe") onTrigger = openWardrobeMenu;
      else if (nearStation.id === "workoutclip") onTrigger = openWeightAreaMenu;
      else if (nearStation.id === "order") onTrigger = openDinerMenu;
      else if (nearStation.id === "vip-bouncer") onTrigger = openVipBouncerMenu;
      else if (nearStation.id === "bar") onTrigger = openBarMenu;
      else if (nearStation.id === "bottle") onTrigger = openBottleMenu;
      else if (nearStation.id === "vacation") onTrigger = openVacationMenu;
      else if (nearStation.id === "simulate-fight") onTrigger = openSimulateFightMenu;
      else if (nearStation.id in MALL_STORE_STATIONS) {
        const storeId = nearStation.id;
        onTrigger = () => {
          const room = buildMallStoreRoom(storeId);
          scene = {
            type: "interior",
            lot,
            interior: new InteriorScene(lot, room.stations, undefined, room.decorations),
            mallStore: storeId,
          };
        };
      } else if (nearStation.id === "pressreception") onTrigger = openPressReceptionMenu;
      else if (nearStation.id === "pressconf") onTrigger = openPressConfMenu;
      else if (nearStation.id === "photostudio") onTrigger = openPhotoShootMenu;
      else if (nearStation.id === "faceoff") onTrigger = openFaceOffMenu;
      else if (nearStation.id === "fanevent") onTrigger = openFanEventMenu;
      else if (officeFloor && nearStation.id === `office-desk-${OFFICE_FLOOR_MANAGER[officeFloor]?.id}`) {
        // The floor's manager himself — a real dialogue-capable NPC, with
        // the Manager Desk business menu folded in as an extra option,
        // same pattern as Reception's "Hire Manager".
        const floor = officeFloor;
        const manager = OFFICE_FLOOR_MANAGER[floor];
        onTrigger = () => openNpcDialogue(manager, managerDeskOptions(floor));
      }
      else if (officeFloor && (OFFICE_FLOOR_STAFF[officeFloor] ?? []).some((n) => nearStation.id === `office-desk-${n.id}`)) {
        // Secretaries/assistants are NOT Managers — full standard NPC
        // dialogue, no Manager Desk option tacked on.
        const staffNpc = (OFFICE_FLOOR_STAFF[officeFloor] ?? []).find((n) => nearStation.id === `office-desk-${n.id}`)!;
        onTrigger = () => openNpcDialogue(staffNpc);
      }
      else if (nearStation.id === "reception-priya") {
        onTrigger = isNpcAway("priya")
          ? () => buildingUI.showToast("Priya isn't at her desk right now.", pos, "bottom")
          : () => openNpcDialogue(PRIYA, receptionSharedOptions());
      }
      else if (nearStation.id === "reception-2") onTrigger = () => openNpcDialogue(CAROL, receptionSharedOptions());
      else if (nearStation.id === "derek-lobby") onTrigger = () => openNpcDialogue(DEREK);
      else if (nearStation.id === "jasmine-lobby") onTrigger = () => openNpcDialogue(JASMINE);
      else if (mallStore && nearStation.id.startsWith("mall-staff-")) {
        const staffNpc = getNpcById(nearStation.id.slice("mall-staff-".length));
        const store = mallStore;
        onTrigger = staffNpc
          ? () => openNpcDialogue(staffNpc, isMallShopkeeper(store, staffNpc.id) ? mallShopOptions(store) : [])
          : () => {};
      }
      else if (nearStation.id === "meetup-npc" && playerState.activeMeetup) {
        const { npcId, location, type } = playerState.activeMeetup;
        const meetupNpc = getNpcById(npcId);
        onTrigger = meetupNpc ? () => openMeetupDialogue(meetupNpc, location, type) : () => {};
      }
      else if (nearStation.id === "overnight-guest") {
        onTrigger = () => buildingUI.showToast("She's still asleep — let her rest.", pos, "bottom");
      }
      else if (nearStation.id === "spouse-npc") {
        const spouseId = Object.keys(playerState.married).find((id) => playerState.married[id]);
        const spouse = spouseId ? getNpcById(spouseId) : undefined;
        onTrigger = spouse ? () => openNpcDialogue(spouse) : () => {};
      }
      else if (findChildById(nearStation.id)) {
        const found = findChildById(nearStation.id)!;
        onTrigger = () => openChildDialogue(found.child);
      }
      else if (nearStation.id.startsWith("pet-")) {
        const petStationId = nearStation.id;
        onTrigger = () => openPetSupplyDialogue(petStationId);
      }
      else if (nearStation.id === "elevator") {
        // On a floor room this IS the door — no ground-level exit, riding
        // the elevator back down returns straight to the Lobby (no
        // floor-picker menu; you're already leaving, not choosing where to
        // go). At the Lobby itself it opens the floor picker as before.
        onTrigger = officeFloor
          ? () => {
              scene = {
                type: "interior",
                lot,
                // Arrive right in front of the Lobby's own Elevator, not
                // the street-side door spawn.
                interior: new InteriorScene(lot, computeStationsFor("Office"), undefined, OFFICE_DECORATIONS, true, "elevator"),
              };
            }
          : () => openElevatorMenu(lot);
      }
      else if (nearStation.id === "sunbathe") onTrigger = openSunbatheMenu;
      else if (nearStation.id === "swim") onTrigger = openSwimMenu;
      else onTrigger = () => startStation(lot, interior, nearStation.id, pos);
      // Every interior station prompt docks to the bottom-center of the
      // screen (like the NPC dialogue prompt) rather than floating at the
      // station's world position — keeps the interact button in the same
      // predictable spot for the bed, equipment, counters, etc. The street
      // building-entrance prompt (line ~2163) is unrelated and stays
      // anchored to the building's world position.
      const promptPos = { x: window.innerWidth / 2, y: window.innerHeight - 100 };
      // Every interior station uses the same generic "INTERACT" label now,
      // rather than the station's own name (NPC name, "Elevator", etc.) —
      // the street building-entrance prompt keeps its default "ENTER".
      buildingUI.setEnterPrompt(promptPos, onTrigger, "INTERACT");
    } else {
      doorConfirmShown = false;
      buildingUI.setEnterPrompt(null, () => {});
    }
  } else if (scene.type === "heavybag") {
    const { lot, interior, game } = scene;
    game.update(dt);
    game.render(ctx, window.innerWidth, window.innerHeight);
    hudLabel.textContent = "Heavy Bag";

    const phase = game.getPhase();
    if (phase === "ready") {
      actionButtons.showLeft("PUNCH", () => game.startCharge());
    } else if (phase === "charging") {
      actionButtons.showRight("RELEASE", () => game.release());
    } else {
      actionButtons.hideAll();
    }

    if (game.isDone()) {
      buildingUI.setEnterPrompt(
        { x: window.innerWidth / 2, y: window.innerHeight * 0.82 },
        () => {
          applyTraining("power", game.getResults());
          finishMinigame(lot, interior);
        },
        "DONE",
      );
    }
  } else if (scene.type === "reflexdots") {
    const { lot, interior, game } = scene;
    game.update(dt, window.innerWidth, window.innerHeight);
    game.render(ctx, window.innerWidth, window.innerHeight);
    hudLabel.textContent = "Reflex Dots";

    if (game.isDone()) {
      tapZone.setActive(false);
      buildingUI.setEnterPrompt(
        { x: window.innerWidth / 2, y: window.innerHeight * 0.82 },
        () => {
          applyTraining("speed", game.getResults());
          finishMinigame(lot, interior);
        },
        "DONE",
      );
    }
  } else {
    const { lot, interior, game } = scene;
    game.update(dt);
    game.render(ctx, window.innerWidth, window.innerHeight);
    hudLabel.textContent = "Jump Rope";

    if (game.isDone()) {
      tapZone.setActive(false);
      buildingUI.setEnterPrompt(
        { x: window.innerWidth / 2, y: window.innerHeight * 0.82 },
        () => {
          applyTraining("endurance", game.getResults());
          finishMinigame(lot, interior);
        },
        "DONE",
      );
    }
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
