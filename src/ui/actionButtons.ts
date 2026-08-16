// Two discrete tap buttons, fixed left/right of center, for minigames that
// need "press one thing, then press the other" flows (Heavy Bag's
// start-charge / release, and any future minigame with the same shape) —
// as opposed to a press-and-hold gesture. Only the relevant button is ever
// shown, so it's always visually obvious what's actionable right now.

export interface ActionButtons {
  showLeft: (label: string, onPress: () => void) => void;
  showRight: (label: string, onPress: () => void) => void;
  hideAll: () => void;
  destroy: () => void;
}

export function createActionButtons(container: HTMLElement): ActionButtons {
  const leftBtn = document.createElement("button");
  leftBtn.type = "button";
  leftBtn.className = "btn btn--action btn--action-left";
  leftBtn.style.display = "none";
  container.appendChild(leftBtn);

  const rightBtn = document.createElement("button");
  rightBtn.type = "button";
  rightBtn.className = "btn btn--action btn--action-right";
  rightBtn.style.display = "none";
  container.appendChild(rightBtn);

  let leftHandler: (() => void) | null = null;
  let rightHandler: (() => void) | null = null;

  leftBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    leftHandler?.();
  });
  rightBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    rightHandler?.();
  });

  return {
    showLeft: (label, onPress) => {
      leftBtn.textContent = label;
      leftHandler = onPress;
      leftBtn.style.display = "flex";
      rightBtn.style.display = "none";
      rightHandler = null;
    },
    showRight: (label, onPress) => {
      rightBtn.textContent = label;
      rightHandler = onPress;
      rightBtn.style.display = "flex";
      leftBtn.style.display = "none";
      leftHandler = null;
    },
    hideAll: () => {
      leftBtn.style.display = "none";
      rightBtn.style.display = "none";
      leftHandler = null;
      rightHandler = null;
    },
    destroy: () => {
      leftBtn.remove();
      rightBtn.remove();
    },
  };
}
