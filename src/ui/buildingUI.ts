// The ENTER prompt, anchored to the actual building it belongs to on the
// street. Exiting a building is handled inside the interior scene itself
// (walk into the door) rather than through a persistent UI button.

export interface EnterTarget {
  x: number;
  y: number;
}

export interface BuildingUI {
  setEnterPrompt: (target: EnterTarget | null, onEnter: () => void) => void;
  destroy: () => void;
}

export function createBuildingUI(container: HTMLElement): BuildingUI {
  const enterBtn = document.createElement("button");
  enterBtn.type = "button";
  enterBtn.className = "btn btn--enter";
  enterBtn.textContent = "ENTER";
  enterBtn.style.display = "none";
  container.appendChild(enterBtn);

  let currentEnterHandler: (() => void) | null = null;
  enterBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    currentEnterHandler?.();
  });

  return {
    setEnterPrompt: (target, onEnter) => {
      if (!target) {
        enterBtn.style.display = "none";
        currentEnterHandler = null;
        return;
      }
      currentEnterHandler = onEnter;
      enterBtn.style.left = `${target.x}px`;
      enterBtn.style.top = `${target.y}px`;
      enterBtn.style.display = "flex";
    },
    destroy: () => {
      enterBtn.remove();
    },
  };
}
