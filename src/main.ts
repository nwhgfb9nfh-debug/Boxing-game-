import "./style.css";
import { createDriveControls } from "./ui/controls";
import { createBuildingUI } from "./ui/buildingUI";
import { createJoystick } from "./ui/joystick";
import { createActionButtons } from "./ui/actionButtons";
import { createTapZone } from "./ui/tapZone";
import { createPhoneUI, type PhoneApi, type HouseListing } from "./ui/phoneUI";
import { StreetScene } from "./game/street";
import { InteriorScene, type Station } from "./game/interior";
import { HeavyBagScene } from "./game/heavyBag";
import { ReflexDotsScene } from "./game/reflexDots";
import { JumpRopeScene } from "./game/jumpRope";
import { createPlayerState, type TrainingStats } from "./game/playerState";
import { EnergyStar } from "./game/energyStar";
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
  getMoney: () => playerState.money,
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
  post: () => {
    if (!energy.spend(10)) return "Not enough energy to post.";
    playerState.fame += 2;
    return "Posted! Fame +2.";
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

function sleepAtBed(anchor: { x: number; y: number }) {
  const leftover = energy.sleep();
  const hpGain = Math.floor(leftover / 2);
  playerState.hp += hpGain;
  buildingUI.showToast(
    `😴 Slept. +${hpGain} HP (now ${playerState.hp}). Energy refilled to 100/100.`,
    anchor,
    "bottom",
  );
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
const STATIONS_BY_BUILDING: Record<string, Station[]> = {
  Trailer: [{ id: "bed", label: "Sleep", nx: 0.5, ny: 0.3 }],
  Gym: [
    { id: "heavybag", label: "Heavy Bag", nx: 0.25, ny: 0.3 },
    { id: "reflexdots", label: "Reflex Dots", nx: 0.5, ny: 0.3 },
    { id: "jumprope", label: "Jump Rope", nx: 0.75, ny: 0.3 },
  ],
};

type Scene =
  | { type: "street" }
  | { type: "interior"; lot: LotInstance; interior: InteriorScene }
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
  const stations = STATIONS_BY_BUILDING[lot.building.name] ?? [];
  scene = { type: "interior", lot, interior: new InteriorScene(lot, stations) };
  controls.root.style.display = "none";
  buildingUI.setEnterPrompt(null, () => {});
  joystick.setActive(true);
}

function exitBuilding() {
  scene = { type: "street" };
  controls.root.style.display = "flex";
  joystick.setActive(false);
}

function startStation(lot: LotInstance, interior: InteriorScene, stationId: string) {
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
  if (outOfMinigame) {
    energyPill.textContent = `⚡ ${energy.remaining}/100`;
    hpPill.textContent = `❤ ${playerState.hp} HP`;
    moneyPill.textContent = `$${playerState.money}`;
  }

  // The Phone only works inside a building, not while driving.
  phoneBtn.style.display = scene.type === "interior" && !phoneUI.isOpen() ? "flex" : "none";

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
    const { lot, interior } = scene;
    const { atDoor, nearStation } = interior.update(dt, joystick.getVector(), window.innerWidth, window.innerHeight);
    interior.render(ctx, window.innerWidth, window.innerHeight);
    hudLabel.textContent = lot.building.name;

    if (atDoor) {
      exitBuilding();
    } else if (nearStation) {
      const pos = interior.getStationScreenPos(nearStation, window.innerWidth, window.innerHeight);
      const onTrigger =
        nearStation.id === "bed" ? () => sleepAtBed(pos) : () => startStation(lot, interior, nearStation.id);
      buildingUI.setEnterPrompt(pos, onTrigger, nearStation.label.toUpperCase());
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
