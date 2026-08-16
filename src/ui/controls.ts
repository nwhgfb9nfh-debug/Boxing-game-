// Overlay HTML buttons for the street driving control scheme:
// hold-to-drive (gas) + U-turn (only while stopped). Works with touch,
// mouse, and pen via pointer events so it's testable both on a phone and
// in a desktop browser preview.

export interface DriveControls {
  root: HTMLDivElement;
  isGasHeld: () => boolean;
  onUTurn: (handler: () => void) => void;
  setUTurnEnabled: (enabled: boolean) => void;
  destroy: () => void;
}

export function createDriveControls(container: HTMLElement): DriveControls {
  const root = document.createElement("div");
  root.className = "controls";

  const uturnBtn = document.createElement("button");
  uturnBtn.className = "btn btn--uturn";
  uturnBtn.type = "button";
  uturnBtn.textContent = "U-TURN";

  const gasBtn = document.createElement("button");
  gasBtn.className = "btn btn--gas";
  gasBtn.type = "button";
  gasBtn.textContent = "HOLD\nGAS";
  gasBtn.style.whiteSpace = "pre";

  root.appendChild(uturnBtn);
  root.appendChild(gasBtn);
  container.appendChild(root);

  let gasHeld = false;
  let uturnHandler: (() => void) | null = null;

  const setGas = (held: boolean) => {
    gasHeld = held;
    gasBtn.classList.toggle("is-active", held);
  };

  gasBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    gasBtn.setPointerCapture(e.pointerId);
    setGas(true);
  });
  const releaseGas = () => setGas(false);
  gasBtn.addEventListener("pointerup", releaseGas);
  gasBtn.addEventListener("pointercancel", releaseGas);
  gasBtn.addEventListener("pointerleave", releaseGas);

  uturnBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (uturnBtn.disabled) return;
    uturnHandler?.();
  });

  return {
    root,
    isGasHeld: () => gasHeld,
    onUTurn: (handler) => {
      uturnHandler = handler;
    },
    setUTurnEnabled: (enabled) => {
      uturnBtn.disabled = !enabled;
      uturnBtn.classList.toggle("is-disabled", !enabled);
    },
    destroy: () => root.remove(),
  };
}
