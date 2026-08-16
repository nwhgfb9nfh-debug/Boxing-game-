// The ENTER prompt (anchored to the actual building it belongs to, on the
// street) and the EXIT button (shown while inside a placeholder interior).

export interface EnterTarget {
  x: number;
  y: number;
}

export interface BuildingUI {
  setEnterPrompt: (target: EnterTarget | null, onEnter: () => void) => void;
  showExit: (onExit: () => void) => void;
  hideExit: () => void;
  destroy: () => void;
}

export function createBuildingUI(container: HTMLElement): BuildingUI {
  const enterBtn = document.createElement("button");
  enterBtn.type = "button";
  enterBtn.className = "btn btn--enter";
  enterBtn.textContent = "ENTER";
  enterBtn.style.display = "none";
  container.appendChild(enterBtn);

  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.className = "btn btn--exit";
  exitBtn.textContent = "EXIT";
  exitBtn.style.display = "none";
  container.appendChild(exitBtn);

  let currentEnterHandler: (() => void) | null = null;
  enterBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    currentEnterHandler?.();
  });

  let currentExitHandler: (() => void) | null = null;
  exitBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    currentExitHandler?.();
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
    showExit: (onExit) => {
      currentExitHandler = onExit;
      exitBtn.style.display = "flex";
    },
    hideExit: () => {
      exitBtn.style.display = "none";
      currentExitHandler = null;
    },
    destroy: () => {
      enterBtn.remove();
      exitBtn.remove();
    },
  };
}
