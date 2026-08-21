import "./style.css";
import { createDriveControls } from "./ui/controls";
import { createBuildingUI } from "./ui/buildingUI";
import { createJoystick } from "./ui/joystick";
import { createActionButtons } from "./ui/actionButtons";
import { createTapZone } from "./ui/tapZone";
import { createPhoneUI, type PhoneApi, type HouseListing } from "./ui/phoneUI";
import { createActionMenu, type MenuData } from "./ui/actionMenu";
import { createDialogueBox, type DialogueOption, type DialogueData } from "./ui/dialogueBox";
import { StreetScene } from "./game/street";
import { InteriorScene, type Station, type BlockedZone, type Decoration } from "./game/interior";
import { HeavyBagScene } from "./game/heavyBag";
import { ReflexDotsScene } from "./game/reflexDots";
import { JumpRopeScene } from "./game/jumpRope";
import { createPlayerState, addBuzzerPost, type TrainingStats, type GymLevels } from "./game/playerState";
import { EnergyStar, MAX_ENERGY } from "./game/energyStar";
import { CampCycle, CAMP_SEQUENCE } from "./game/campCycle";
import { generateBuzzerReplies } from "./game/buzzer";
import { SocialBattery } from "./game/socialBattery";
import { PRIYA_PORTRAIT } from "./assets/portraits";
import {
  type NpcDef,
  type TalkCategory,
  type TalkTopicDef,
  getRelationshipTier,
  isCategoryUnlocked,
  getTopicDelta,
  formatTopicResult,
} from "./game/npc";
import { nearbyLots, rowForFacing, getHousingBuildings, type LotInstance } from "./game/world";

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

const playerState = createPlayerState();
const energy = new EnergyStar();
const campCycle = new CampCycle();
const socialBattery = new SocialBattery();
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
// in sleepAtBed whenever the stage advances. "bar" and "pressreception"
// host multiple distinct activities each limited individually inside
// their own menu builders (bar-drink/bar-round, press-podcast/press-tv),
// so they're excluded from the blanket per-station check below.
const usedThisPhase = new Set<string>();
function markUsedThisPhase(activityId: string) {
  usedThisPhase.add(activityId);
}
const MULTI_ACTIVITY_STATIONS = new Set(["bar", "pressreception"]);

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
    if (!MULTI_ACTIVITY_STATIONS.has(stationId) && usedThisPhase.has(stationId)) {
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
  return null;
}

// Energy Star + HP (Section 3 & 7) — top-right, always visible outside minigames.
const statusHud = document.createElement("div");
statusHud.className = "status-hud";
const energyPill = document.createElement("div");
energyPill.className = "status-hud__pill status-hud__pill--energy";
const hpPill = document.createElement("div");
hpPill.className = "status-hud__pill status-hud__pill--hp";
statusHud.appendChild(energyPill);
statusHud.appendChild(hpPill);
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
// (Gym's Workout Clip first; Diner/Beach/Office/Lounge/Press reuse this
// same instance as they come online — only one can be open at a time).
const locationMenu = createActionMenu(app);

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
  const setTrainingBonus = (stat: keyof TrainingStats) => (n: number) => {
    playerState.training[stat].bonus = n;
    playerState.training[stat].trained = true;
  };
  return [
    { label: "Fame", get: () => playerState.fame, set: (n) => (playerState.fame = n) },
    { label: "Image", get: () => playerState.image, set: (n) => (playerState.image = n) },
    { label: "HP", get: () => playerState.hp, set: (n) => (playerState.hp = n) },
    { label: "Money", get: () => playerState.money, set: (n) => (playerState.money = n) },
    { label: "Power bonus", get: () => playerState.training.power.bonus, set: setTrainingBonus("power") },
    { label: "Speed bonus", get: () => playerState.training.speed.bonus, set: setTrainingBonus("speed") },
    {
      label: "Endurance bonus",
      get: () => playerState.training.endurance.bonus,
      set: setTrainingBonus("endurance"),
    },
    { label: "Chin bonus", get: () => playerState.training.chin.bonus, set: setTrainingBonus("chin") },
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
          usedThisPhase.clear();
          socialBattery.reset();
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

function openWorkoutClipMenu() {
  locationMenu.open(() => {
    const used = usedThisPhase.has("workoutclip");
    return {
      title: "🎥 Workout Clip",
      energyText: `Energy: ${energy.remaining}/100  ·  Fame: ${playerState.fame}  ·  Image: ${playerState.image}`,
      actions: [
        {
          id: "post-workout",
          label: "Post a Workout Clip",
          cost: 10,
          costLabel: used ? "DONE" : "10 EN",
          disabled: used,
          run: () => {
            if (used) return "Already done this Private Life phase.";
            if (!energy.spend(10)) return "Not enough energy to post a clip.";
            playerState.fame += 2;
            playerState.image += 2;
            markUsedThisPhase("workoutclip");
            return "Posted! Fame +2, Image +2.";
          },
        },
      ],
    };
  });
}

function openDinerMenu() {
  locationMenu.open(() => {
    const used = usedThisPhase.has("order");
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
  isAllowed: () => usedThisPhase.has("vip-bouncer"),
  label: "VIP",
};

function openVipBouncerMenu() {
  locationMenu.open(() => {
    const used = usedThisPhase.has("vip-bouncer");
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
    const drinkUsed = usedThisPhase.has("bar-drink");
    const roundUsed = usedThisPhase.has("bar-round");
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
    const used = usedThisPhase.has("bottle");
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
  const podcastUsed = usedThisPhase.has("press-podcast");
  const tvUsed = usedThisPhase.has("press-tv");
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
    const used = usedThisPhase.has("sunbathe");
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
    const used = usedThisPhase.has("swim");
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
  if (role === "manager") playerState.managerLevel = level;
  else if (role === "coach") playerState.coachLevel = level;
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
// any other room, but walking out their door returns to the Lobby instead
// of the street — see the "interior" scene branch below.
const OFFICE_FLOOR_STATIONS: Record<number, Station[]> = {
  1: [{ id: "managerdesk", label: "Manager Desk", nx: 0.5, ny: 0.4 }],
  2: [{ id: "managerdesk", label: "Manager Desk", nx: 0.5, ny: 0.4 }],
  3: [{ id: "managerdesk", label: "Manager Desk", nx: 0.5, ny: 0.4 }],
};

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

type ManagerDeskView = "main" | "sponsorships";
let managerDeskView: ManagerDeskView = "main";

function buildManagerDeskMenu(floor: number): MenuData {
  if (managerDeskView === "sponsorships") return buildSponsorshipsMenu();
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
      id: "sponsorships",
      label: "Sponsorships",
      cost: 0,
      costLabel: "›",
      run: () => {
        managerDeskView = "sponsorships";
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
      costLabel: requirePrivateLifePhase() ? "LOCKED" : usedThisPhase.has("media-training") ? "DONE" : "10 EN",
      disabled: !!requirePrivateLifePhase() || usedThisPhase.has("media-training"),
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
      costLabel: requirePrivateLifePhase() ? "LOCKED" : usedThisPhase.has("charity-event") ? "DONE" : "15 EN",
      disabled: !!requirePrivateLifePhase() || usedThisPhase.has("charity-event"),
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

  // Manager Lvl 2+ desk options.
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
      costLabel: requirePrivateLifePhase() ? "LOCKED" : usedThisPhase.has("networking-event") ? "DONE" : "20 EN",
      disabled: !!requirePrivateLifePhase() || usedThisPhase.has("networking-event"),
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
    title: `🗄️ Manager Desk — Lvl ${floor}`,
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
  locationMenu.open(() => buildManagerDeskMenu(floor));
}

type ReceptionView = "main" | "staff" | "staff-role" | "gym" | "gym-category";
let receptionView: ReceptionView = "main";
let activeStaffRole: StaffRole["id"] | null = null;
let activeGymCategory: GymCategory["id"] | null = null;

function buildReceptionMenu(): MenuData {
  if (receptionView === "staff") return buildStaffMenu();
  if (receptionView === "staff-role" && activeStaffRole) return buildStaffRoleMenu(activeStaffRole);
  if (receptionView === "gym") return buildGymMenu();
  if (receptionView === "gym-category" && activeGymCategory) return buildGymCategoryMenu(activeGymCategory);
  return {
    title: "🛎️ Reception",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "hire-staff",
        label: "Hire Staff",
        cost: 0,
        costLabel: "›",
        run: () => {
          receptionView = "staff";
          return "";
        },
      },
      {
        id: "upgrade-gym",
        label: "Upgrade Gym",
        cost: 0,
        costLabel: "›",
        run: () => {
          receptionView = "gym";
          return "";
        },
      },
    ],
  };
}

function buildStaffMenu(): MenuData {
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
          receptionView = "main";
          return "";
        },
      },
      ...STAFF_ROLES.map((role) => ({
        id: `role-${role.id}`,
        label: `${role.icon} ${role.name} (Lvl ${getStaffLevel(role.id)}/3)`,
        cost: 0,
        costLabel: "›",
        run: () => {
          activeStaffRole = role.id;
          receptionView = "staff-role";
          return "";
        },
      })),
    ],
  };
}

function buildStaffRoleMenu(roleId: StaffRole["id"]): MenuData {
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
          receptionView = "staff";
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

function buildGymMenu(): MenuData {
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
          receptionView = "main";
          return "";
        },
      },
      ...GYM_CATEGORIES.map((cat) => ({
        id: `cat-${cat.id}`,
        label: `${cat.icon} ${cat.name} (Lvl ${playerState.gymLevels[cat.id]}/3)`,
        cost: 0,
        costLabel: "›",
        run: () => {
          activeGymCategory = cat.id;
          receptionView = "gym-category";
          return "";
        },
      })),
    ],
  };
}

function buildGymCategoryMenu(catId: GymCategory["id"]): MenuData {
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
          receptionView = "gym";
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
      id: "events",
      label: "Current Events",
      ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" },
    },
  ],
  personalTopics: [
    { id: "family", label: "Family", ratingByTier: { acquaintance: "negative", friend: "positive", close: "positive" } },
    { id: "hobbies", label: "Hobbies", ratingByTier: { acquaintance: "positive", friend: "positive", close: "positive" } },
    {
      id: "weekend",
      label: "Weekend Plans",
      ratingByTier: { acquaintance: "neutral", friend: "positive", close: "positive" },
    },
    { id: "music", label: "Music", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
  ],
};

// Not yet designed per spec — a generic placeholder so a real NPC can be
// slotted into this same interaction point later without rework.
const RECEPTIONIST_2: NpcDef = {
  id: "receptionist-2",
  name: "Receptionist",
  portrait: "🧑🏻‍💼",
  romanceEligible: false,
  greetings: {
    stranger: "Hi there — welcome in. Let me know if you need anything.",
    acquaintance: "Hey, good to see you again.",
    friend: "Hey! How's it going?",
    close: "Hey you — good to see you.",
  },
  smallTalkTopics: [
    { id: "weather", label: "Weather", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "office", label: "The Office", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
    { id: "events", label: "Current Events", ratingByTier: { stranger: "neutral", acquaintance: "neutral", friend: "neutral", close: "neutral" } },
  ],
  personalTopics: [
    { id: "weekend", label: "Weekend Plans", ratingByTier: { acquaintance: "neutral", friend: "neutral", close: "neutral" } },
  ],
};

function getRelationshipScore(npcId: string): number {
  return playerState.contacts[npcId] ?? 0;
}

function bumpRelationship(npcId: string, delta: number) {
  playerState.contacts[npcId] = Math.max(0, getRelationshipScore(npcId) + delta);
}

type DialogueView = "main" | "talk-categories" | "talk-topics" | "talk-response";
let dialogueView: DialogueView = "main";
let activeNpc: NpcDef | null = null;
let activeCategory: TalkCategory | null = null;
let lastTalkResult = "";

// "Hire Staff" and "Upgrade Gym" are shared business functions, not tied
// to either receptionist specifically (per spec for Hire Staff; Upgrade
// Gym is treated the same way since it's the same kind of desk function
// and predates this NPC system).
function receptionSharedOptions(): DialogueOption[] {
  return [
    {
      id: "hire-staff",
      label: "Hire Staff",
      onSelect: () => {
        dialogueBox.close();
        receptionView = "staff";
        locationMenu.open(buildReceptionMenu);
      },
    },
    {
      id: "upgrade-gym",
      label: "Upgrade Gym",
      onSelect: () => {
        dialogueBox.close();
        receptionView = "gym";
        locationMenu.open(buildReceptionMenu);
      },
    },
  ];
}

function buildDialogueMain(npc: NpcDef, extraOptions: DialogueOption[]): DialogueData {
  const tier = getRelationshipTier(getRelationshipScore(npc.id));
  return {
    portrait: npc.portrait,
    name: npc.name,
    text: npc.greetings[tier],
    options: [
      {
        id: "talk",
        label: "Talk",
        onSelect: () => {
          dialogueView = "talk-categories";
        },
      },
      ...extraOptions,
      { id: "leave", label: "Leave", onSelect: () => dialogueBox.close() },
    ],
  };
}

// "Talk" opens a category menu first (Small Talk always, Personal once
// unlocked at Acquaintance+) — locked categories are omitted entirely
// rather than shown disabled, same treatment the spec calls for once
// Flirty exists.
function buildDialogueTalkCategories(npc: NpcDef): DialogueData {
  const tier = getRelationshipTier(getRelationshipScore(npc.id));
  const categories: { id: TalkCategory; label: string }[] = [{ id: "smalltalk", label: "Small Talk" }];
  if (isCategoryUnlocked("personal", tier)) categories.push({ id: "personal", label: "Personal" });
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
          dialogueView = "talk-topics";
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

function buildDialogueTalkTopics(npc: NpcDef): DialogueData {
  const tier = getRelationshipTier(getRelationshipScore(npc.id));
  const topics: TalkTopicDef[] = activeCategory === "personal" ? npc.personalTopics : npc.smallTalkTopics;
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
          const delta = getTopicDelta(topic, tier);
          bumpRelationship(npc.id, delta);
          lastTalkResult = formatTopicResult(delta);
          dialogueView = "talk-response";
        },
      })),
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

function openNpcDialogue(npc: NpcDef, extraOptions: DialogueOption[] = []) {
  activeNpc = npc;
  dialogueView = "main";
  activeCategory = null;
  dialogueBox.open(() => {
    if (dialogueView === "talk-categories") return buildDialogueTalkCategories(activeNpc!);
    if (dialogueView === "talk-topics") return buildDialogueTalkTopics(activeNpc!);
    if (dialogueView === "talk-response") return buildDialogueTalkResponse(activeNpc!);
    return buildDialogueMain(activeNpc!, extraOptions);
  });
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
          scene = {
            type: "interior",
            lot,
            interior: new InteriorScene(lot, OFFICE_FLOOR_STATIONS[floor] ?? []),
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
  usedThisPhase.clear();
  socialBattery.reset();
  // HP banked above 100 is pure pre-fight insurance — it never carries
  // into the fight itself as extra usable HP.
  if (nextStage.type === "fight" && playerState.hp > 100) playerState.hp = 100;
  // A fresh camp starts back at "No Fight Scheduled" — clear last camp's fight state.
  if (nextStage.type === "nofight") {
    playerState.fightScheduled = false;
    playerState.cashAdvanceTaken = false;
  }

  buildingUI.showToast(
    `😴 Slept. +${hpGain} HP (now ${playerState.hp}). Energy refilled to ${cap}/${MAX_ENERGY}${useBonus ? " (vacation bonus!)" : ""}. Next: ${nextStage.label}.`,
    anchor,
    "bottom",
  );
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
            usedThisPhase.clear();
            socialBattery.reset();
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

const VEHICLE_OPTIONS: ShopItem[] = [
  { id: "sedan", name: "Sedan", price: 3000 },
  { id: "sports-car", name: "Sports Car", price: 8000 },
  { id: "luxury-suv", name: "Luxury SUV", price: 15000 },
];

function openVehicleMenu() {
  locationMenu.open(() => ({
    title: "🚗 Vehicle Dealer",
    energyText: `Money: $${playerState.money}  ·  Owned: ${playerState.vehicleOwned ?? "None"}`,
    actions: VEHICLE_OPTIONS.map((v) => {
      const owned = playerState.vehicleOwned === v.id;
      return {
        id: v.id,
        label: v.name,
        cost: 0,
        costLabel: owned ? "OWNED" : `$${v.price}`,
        disabled: owned,
        run: () => {
          if (owned) return `You already own the ${v.name}.`;
          if (playerState.money < v.price) return `Not enough money — need $${v.price}, have $${playerState.money}.`;
          playerState.money -= v.price;
          playerState.vehicleOwned = v.id;
          return `Purchased the ${v.name}! (Cosmetic for now.)`;
        },
      };
    }),
  }));
}

interface OutfitOption extends ShopItem {
  imageGain: number;
}
const OUTFIT_OPTIONS: OutfitOption[] = [
  { id: "casual", name: "Casual Outfit", price: 200, imageGain: 2 },
  { id: "designer", name: "Designer Outfit", price: 800, imageGain: 5 },
  { id: "luxury", name: "Luxury Outfit", price: 2000, imageGain: 10 },
];

function openClothesMenu() {
  locationMenu.open(() => ({
    title: "👗 Clothing Store",
    energyText: `Money: $${playerState.money}  ·  Image: ${playerState.image}`,
    actions: OUTFIT_OPTIONS.map((o) => ({
      id: o.id,
      label: `${o.name} (Image +${o.imageGain})`,
      cost: 0,
      costLabel: `$${o.price}`,
      run: () => {
        if (playerState.money < o.price) return `Not enough money — need $${o.price}, have $${playerState.money}.`;
        playerState.money -= o.price;
        playerState.image += o.imageGain;
        return `Bought the ${o.name}! Image +${o.imageGain} (now ${playerState.image}).`;
      },
    })),
  }));
}

const GIFT_OPTIONS: ShopItem[] = [
  { id: "flowers", name: "Flowers", price: 50 },
  { id: "jewelry", name: "Jewelry", price: 500 },
  { id: "ring", name: "Ring", price: 3000 },
];

function openGiftShopMenu() {
  locationMenu.open(() => ({
    title: "🎁 Gift Shop",
    energyText: `Money: $${playerState.money}  ·  Gifts owned: ${playerState.giftsOwned}`,
    actions: GIFT_OPTIONS.map((g) => ({
      id: g.id,
      label: g.name,
      cost: 0,
      costLabel: `$${g.price}`,
      run: () => {
        if (playerState.money < g.price) return `Not enough money — need $${g.price}, have $${playerState.money}.`;
        playerState.money -= g.price;
        playerState.giftsOwned += 1;
        return `Bought ${g.name}! (Give it to someone once the NPC/romance system exists.)`;
      },
    })),
  }));
}

const PET_OPTIONS: ShopItem[] = [
  { id: "dog", name: "Dog", price: 500 },
  { id: "cat", name: "Cat", price: 400 },
  { id: "exotic-bird", name: "Exotic Bird", price: 1500 },
];

function openPetStoreMenu() {
  locationMenu.open(() => ({
    title: "🐾 Pet Store",
    energyText: `Money: $${playerState.money}  ·  Owned: ${playerState.petOwned ?? "None"}`,
    actions: PET_OPTIONS.map((p) => {
      const owned = playerState.petOwned === p.id;
      return {
        id: p.id,
        label: p.name,
        cost: 0,
        costLabel: owned ? "OWNED" : `$${p.price}`,
        disabled: owned,
        run: () => {
          if (owned) return `You already own a ${p.name}.`;
          if (playerState.money < p.price) return `Not enough money — need $${p.price}, have $${playerState.money}.`;
          playerState.money -= p.price;
          playerState.petOwned = p.id;
          return `Adopted a ${p.name}! (Cosmetic for now.)`;
        },
      };
    }),
  }));
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
const HOUSE_STATIONS: Station[] = [{ id: "bed", label: "Sleep", nx: 0.5, ny: 0.3 }];
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
const OFFICE_DECORATIONS: Decoration[] = [{ nx: 0.3, ny: 0.4, width: 200, height: 36, blocking: true }];

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
    { id: "workoutclip", label: "Workout Clip", nx: 0.5, ny: 0.6 },
  ],
  Diner: [{ id: "order", label: "Order Menu", nx: 0.5, ny: 0.4 }],
  Office: [
    {
      id: "reception-priya",
      label: "Priya",
      nx: 0.2,
      ny: 0.28,
      kind: "npc",
      radius: 50,
      approachNx: 0.2,
      approachNy: 0.5,
    },
    {
      id: "reception-2",
      label: "Receptionist",
      nx: 0.4,
      ny: 0.28,
      kind: "npc",
      radius: 50,
      approachNx: 0.4,
      approachNy: 0.5,
    },
    { id: "elevator", label: "Elevator", nx: 0.7, ny: 0.4 },
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

const MALL_STORE_STATIONS: Record<string, Station[]> = {
  vehicles: [{ id: "vehicles-counter", label: "Vehicle Dealer", nx: 0.5, ny: 0.4 }],
  clothes: [{ id: "clothes-counter", label: "Clothing Store", nx: 0.5, ny: 0.4 }],
  giftshop: [{ id: "giftshop-counter", label: "Gift Shop", nx: 0.5, ny: 0.4 }],
  petstore: [{ id: "petstore-counter", label: "Pet Store", nx: 0.5, ny: 0.4 }],
  furniture: [{ id: "furniture-counter", label: "Furniture Store", nx: 0.5, ny: 0.4 }],
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
  const stations = STATIONS_BY_BUILDING[lot.building.name] ?? [];
  const blockedZone = lot.building.name === "Lounge" ? LOUNGE_VIP_ZONE : undefined;
  const decorations = lot.building.name === "Office" ? OFFICE_DECORATIONS : undefined;
  scene = { type: "interior", lot, interior: new InteriorScene(lot, stations, blockedZone, decorations) };
  controls.root.style.display = "none";
  buildingUI.setEnterPrompt(null, () => {});
  joystick.setActive(true);
}

function exitBuilding() {
  scene = { type: "street" };
  controls.root.style.display = "flex";
  joystick.setActive(false);
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
    moneyPill.textContent = `$${playerState.money}`;
    const stage = campCycle.current;
    const statSuffix = stage.stat ? ` — ${stage.stat[0].toUpperCase()}${stage.stat.slice(1)}` : "";
    campPill.textContent = `🥊 Camp ${campCycle.campNumber} · ${stage.label}${statSuffix}`;
  }

  // The Phone only works inside a building, not while driving, and stays
  // hidden while another location's action menu is already open.
  phoneBtn.style.display =
    scene.type === "interior" && !phoneUI.isOpen() && !locationMenu.isOpen() && !dialogueBox.isOpen()
      ? "flex"
      : "none";
  debugBtn.style.display =
    outOfMinigame && !phoneUI.isOpen() && !locationMenu.isOpen() && !dialogueBox.isOpen() ? "flex" : "none";

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
      if (officeFloor) {
        // Elevator floors exit back to the Lobby, not the street.
        scene = {
          type: "interior",
          lot,
          interior: new InteriorScene(lot, STATIONS_BY_BUILDING.Office, undefined, OFFICE_DECORATIONS),
        };
      } else if (mallStore) {
        // Store rooms exit back to the Mall floor, not the street.
        scene = { type: "interior", lot, interior: new InteriorScene(lot, STATIONS_BY_BUILDING.Mall) };
      } else {
        exitBuilding();
      }
    } else if (nearStation) {
      const pos = interior.getStationScreenPos(nearStation, window.innerWidth, window.innerHeight);
      const phaseLock = getStationPhaseLock(nearStation.id);
      let onTrigger: () => void;
      if (phaseLock) onTrigger = () => buildingUI.showToast(phaseLock, pos, "bottom");
      else if (nearStation.id === "bed") {
        const bedLock = getBedLock();
        onTrigger = bedLock ? () => buildingUI.showToast(bedLock, pos, "bottom") : () => sleepAtBed(pos);
      }
      else if (nearStation.id === "workoutclip") onTrigger = openWorkoutClipMenu;
      else if (nearStation.id === "order") onTrigger = openDinerMenu;
      else if (nearStation.id === "vip-bouncer") onTrigger = openVipBouncerMenu;
      else if (nearStation.id === "bar") onTrigger = openBarMenu;
      else if (nearStation.id === "bottle") onTrigger = openBottleMenu;
      else if (nearStation.id === "vacation") onTrigger = openVacationMenu;
      else if (nearStation.id === "simulate-fight") onTrigger = openSimulateFightMenu;
      else if (nearStation.id in MALL_STORE_STATIONS) {
        const storeId = nearStation.id;
        onTrigger = () => {
          scene = {
            type: "interior",
            lot,
            interior: new InteriorScene(lot, MALL_STORE_STATIONS[storeId]),
            mallStore: storeId,
          };
        };
      } else if (nearStation.id === "vehicles-counter") onTrigger = openVehicleMenu;
      else if (nearStation.id === "clothes-counter") onTrigger = openClothesMenu;
      else if (nearStation.id === "giftshop-counter") onTrigger = openGiftShopMenu;
      else if (nearStation.id === "petstore-counter") onTrigger = openPetStoreMenu;
      else if (nearStation.id === "furniture-counter") onTrigger = openFurnitureMenu;
      else if (nearStation.id === "pressreception") onTrigger = openPressReceptionMenu;
      else if (nearStation.id === "pressconf") onTrigger = openPressConfMenu;
      else if (nearStation.id === "photostudio") onTrigger = openPhotoShootMenu;
      else if (nearStation.id === "faceoff") onTrigger = openFaceOffMenu;
      else if (nearStation.id === "fanevent") onTrigger = openFanEventMenu;
      else if (nearStation.id === "managerdesk") onTrigger = () => openManagerDeskMenu(officeFloor ?? 1);
      else if (nearStation.id === "reception-priya") onTrigger = () => openNpcDialogue(PRIYA, receptionSharedOptions());
      else if (nearStation.id === "reception-2") onTrigger = () => openNpcDialogue(RECEPTIONIST_2, receptionSharedOptions());
      else if (nearStation.id === "elevator") onTrigger = () => openElevatorMenu(lot);
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
      buildingUI.setEnterPrompt(promptPos, onTrigger, nearStation.label.toUpperCase());
    } else {
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
