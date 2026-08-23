// Overlay HTML buttons for the street driving control scheme:
// hold-to-drive (gas), hold-to-back-up (reverse, Vehicle Dealer Reverse
// Driving skillset only), Autopilot (Vehicle Dealer Autopilot skillset
// only), and U-turn (only while stopped). Works with touch, mouse, and pen
// via pointer events so it's testable both on a phone and in a desktop
// browser preview. Reverse/Autopilot start hidden — main.ts shows them
// via setReverseVisible/setAutopilotVisible only while the active vehicle
// owns that skillset.

export interface DriveControls {
  root: HTMLDivElement;
  isGasHeld: () => boolean;
  isReverseHeld: () => boolean;
  onUTurn: (handler: () => void) => void;
  onAutopilot: (handler: () => void) => void;
  setUTurnEnabled: (enabled: boolean) => void;
  setGasEnabled: (enabled: boolean) => void;
  setReverseVisible: (visible: boolean) => void;
  setReverseEnabled: (enabled: boolean) => void;
  setAutopilotVisible: (visible: boolean) => void;
  setAutopilotEnabled: (enabled: boolean) => void;
  destroy: () => void;
}

export function createDriveControls(container: HTMLElement): DriveControls {
  const root = document.createElement("div");
  root.className = "controls";

  // Left-to-right layout: U-TURN, AUTOPILOT, REVERSE, GAS.
  const uturnBtn = document.createElement("button");
  uturnBtn.className = "btn btn--uturn";
  uturnBtn.type = "button";
  uturnBtn.textContent = "U-TURN";

  const autopilotBtn = document.createElement("button");
  autopilotBtn.className = "btn btn--autopilot";
  autopilotBtn.type = "button";
  autopilotBtn.textContent = "🧭 AUTO";
  autopilotBtn.style.display = "none";

  const reverseBtn = document.createElement("button");
  reverseBtn.className = "btn btn--reverse";
  reverseBtn.type = "button";
  reverseBtn.textContent = "REVERSE";
  reverseBtn.style.display = "none";

  const gasBtn = document.createElement("button");
  gasBtn.className = "btn btn--gas";
  gasBtn.type = "button";
  gasBtn.textContent = "HOLD\nGAS";
  gasBtn.style.whiteSpace = "pre";

  root.appendChild(uturnBtn);
  root.appendChild(autopilotBtn);
  root.appendChild(reverseBtn);
  root.appendChild(gasBtn);
  container.appendChild(root);

  let gasHeld = false;
  let reverseHeld = false;
  let uturnHandler: (() => void) | null = null;
  let autopilotHandler: (() => void) | null = null;

  const setGas = (held: boolean) => {
    gasHeld = held;
    gasBtn.classList.toggle("is-active", held);
  };
  const setReverse = (held: boolean) => {
    reverseHeld = held;
    reverseBtn.classList.toggle("is-active", held);
  };

  gasBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (gasBtn.disabled) return;
    gasBtn.setPointerCapture(e.pointerId);
    setGas(true);
  });
  const releaseGas = () => setGas(false);
  gasBtn.addEventListener("pointerup", releaseGas);
  gasBtn.addEventListener("pointercancel", releaseGas);
  gasBtn.addEventListener("pointerleave", releaseGas);

  reverseBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (reverseBtn.disabled) return;
    reverseBtn.setPointerCapture(e.pointerId);
    setReverse(true);
  });
  const releaseReverse = () => setReverse(false);
  reverseBtn.addEventListener("pointerup", releaseReverse);
  reverseBtn.addEventListener("pointercancel", releaseReverse);
  reverseBtn.addEventListener("pointerleave", releaseReverse);

  uturnBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (uturnBtn.disabled) return;
    uturnHandler?.();
  });

  autopilotBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (autopilotBtn.disabled) return;
    autopilotHandler?.();
  });

  return {
    root,
    isGasHeld: () => gasHeld,
    isReverseHeld: () => reverseHeld,
    onUTurn: (handler) => {
      uturnHandler = handler;
    },
    onAutopilot: (handler) => {
      autopilotHandler = handler;
    },
    setUTurnEnabled: (enabled) => {
      uturnBtn.disabled = !enabled;
      uturnBtn.classList.toggle("is-disabled", !enabled);
    },
    setGasEnabled: (enabled) => {
      gasBtn.disabled = !enabled;
      gasBtn.classList.toggle("is-disabled", !enabled);
      if (!enabled) setGas(false);
    },
    setReverseVisible: (visible) => {
      reverseBtn.style.display = visible ? "flex" : "none";
      if (!visible) setReverse(false);
    },
    setReverseEnabled: (enabled) => {
      reverseBtn.disabled = !enabled;
      reverseBtn.classList.toggle("is-disabled", !enabled);
      if (!enabled) setReverse(false);
    },
    setAutopilotVisible: (visible) => {
      autopilotBtn.style.display = visible ? "flex" : "none";
    },
    setAutopilotEnabled: (enabled) => {
      autopilotBtn.disabled = !enabled;
      autopilotBtn.classList.toggle("is-disabled", !enabled);
    },
    destroy: () => root.remove(),
  };
}
