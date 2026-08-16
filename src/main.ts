import "./style.css";
import { createDriveControls } from "./ui/controls";
import { createBuildingUI } from "./ui/buildingUI";
import { createJoystick } from "./ui/joystick";
import { createActionButtons } from "./ui/actionButtons";
import { createTapZone } from "./ui/tapZone";
import { StreetScene } from "./game/street";
import { InteriorScene, type Station } from "./game/interior";
import { HeavyBagScene } from "./game/heavyBag";
import { ReflexDotsScene } from "./game/reflexDots";
import { nearbyLots, rowForFacing, type LotInstance } from "./game/world";

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

tapZone.onTap((x, y) => {
  if (scene.type === "reflexdots") scene.game.handleTap(x, y);
});

// Stations placed inside specific buildings' interiors — walk up to one
// and its prompt surfaces the same way the street's ENTER prompt does.
const STATIONS_BY_BUILDING: Record<string, Station[]> = {
  Gym: [
    { id: "heavybag", label: "Heavy Bag", nx: 0.3, ny: 0.3 },
    { id: "reflexdots", label: "Reflex Dots", nx: 0.7, ny: 0.3 },
  ],
};

type Scene =
  | { type: "street" }
  | { type: "interior"; lot: LotInstance; interior: InteriorScene }
  | { type: "heavybag"; lot: LotInstance; interior: InteriorScene; game: HeavyBagScene }
  | { type: "reflexdots"; lot: LotInstance; interior: InteriorScene; game: ReflexDotsScene };
let scene: Scene = { type: "street" };

function enterBuilding(lot: LotInstance, anchor: { x: number; y: number }) {
  if (lot.building.locked) {
    buildingUI.showLockedToast(
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
      buildingUI.setEnterPrompt(pos, () => startStation(lot, interior, nearStation.id), nearStation.label.toUpperCase());
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
        () => finishMinigame(lot, interior),
        "DONE",
      );
    }
  } else {
    const { lot, interior, game } = scene;
    game.update(dt, window.innerWidth, window.innerHeight);
    game.render(ctx, window.innerWidth, window.innerHeight);
    hudLabel.textContent = "Reflex Dots";

    if (game.isDone()) {
      tapZone.setActive(false);
      buildingUI.setEnterPrompt(
        { x: window.innerWidth / 2, y: window.innerHeight * 0.82 },
        () => finishMinigame(lot, interior),
        "DONE",
      );
    }
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
