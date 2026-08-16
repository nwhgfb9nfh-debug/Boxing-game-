import "./style.css";
import { createDriveControls } from "./ui/controls";
import { createBuildingUI } from "./ui/buildingUI";
import { StreetScene } from "./game/street";
import { renderInterior } from "./game/interior";
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
const street = new StreetScene(controls);

type Scene = { type: "street" } | { type: "interior"; lot: LotInstance };
let scene: Scene = { type: "street" };

function enterBuilding(lot: LotInstance) {
  scene = { type: "interior", lot };
  controls.root.style.display = "none";
  buildingUI.setEnterPrompt(null, () => {});
  buildingUI.showExit(exitBuilding);
}

function exitBuilding() {
  scene = { type: "street" };
  controls.root.style.display = "flex";
  buildingUI.hideExit();
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
      buildingUI.setEnterPrompt(pos, () => enterBuilding(lot));
    } else {
      buildingUI.setEnterPrompt(null, () => {});
    }
  } else {
    renderInterior(ctx, window.innerWidth, window.innerHeight, scene.lot);
    hudLabel.textContent = scene.lot.building.name;
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
