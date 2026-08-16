import type { LotInstance } from "../game/world";

// The "ENTER <building>" prompt (shown when stopped near a lot on the
// street) and the "EXIT" button (shown while inside a placeholder interior).

export interface BuildingUI {
  showEnterPrompts: (lots: LotInstance[], onEnter: (lot: LotInstance) => void) => void;
  hideEnterPrompts: () => void;
  showExit: (onExit: () => void) => void;
  hideExit: () => void;
  destroy: () => void;
}

export function createBuildingUI(container: HTMLElement): BuildingUI {
  const enterRoot = document.createElement("div");
  enterRoot.className = "enter-prompts";
  container.appendChild(enterRoot);

  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.className = "btn btn--exit";
  exitBtn.textContent = "EXIT";
  exitBtn.style.display = "none";
  container.appendChild(exitBtn);

  let currentExitHandler: (() => void) | null = null;
  exitBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    currentExitHandler?.();
  });

  return {
    showEnterPrompts: (lots, onEnter) => {
      enterRoot.innerHTML = "";
      for (const lot of lots) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn--enter";
        btn.textContent = `ENTER ${lot.building.name.toUpperCase()}`;
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          onEnter(lot);
        });
        enterRoot.appendChild(btn);
      }
      enterRoot.style.display = lots.length ? "flex" : "none";
    },
    hideEnterPrompts: () => {
      enterRoot.style.display = "none";
      enterRoot.innerHTML = "";
    },
    showExit: (onExit) => {
      currentExitHandler = onExit;
      exitBtn.style.display = "flex";
    },
    hideExit: () => {
      exitBtn.style.display = "none";
      currentExitHandler = null;
    },
    destroy: () => {
      enterRoot.remove();
      exitBtn.remove();
    },
  };
}
