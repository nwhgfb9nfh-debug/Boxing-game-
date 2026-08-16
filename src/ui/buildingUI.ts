// The ENTER prompt, anchored to the actual building it belongs to on the
// street, and a brief toast for locked buildings (which never open an
// interior scene at all — no room, so no exit mechanic is needed for them).
// Unlocked buildings exit by walking into the door inside the interior
// scene itself.

export interface EnterTarget {
  x: number;
  y: number;
}

export interface BuildingUI {
  setEnterPrompt: (target: EnterTarget | null, onEnter: () => void) => void;
  showLockedToast: (message: string) => void;
  destroy: () => void;
}

const LOCKED_TOAST_DURATION_MS = 2600;

export function createBuildingUI(container: HTMLElement): BuildingUI {
  const enterBtn = document.createElement("button");
  enterBtn.type = "button";
  enterBtn.className = "btn btn--enter";
  enterBtn.textContent = "ENTER";
  enterBtn.style.display = "none";
  container.appendChild(enterBtn);

  const toast = document.createElement("div");
  toast.className = "locked-toast";
  container.appendChild(toast);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

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
    showLockedToast: (message) => {
      toast.textContent = message;
      toast.classList.add("is-visible");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove("is-visible");
        toastTimer = null;
      }, LOCKED_TOAST_DURATION_MS);
    },
    destroy: () => {
      if (toastTimer) clearTimeout(toastTimer);
      enterBtn.remove();
      toast.remove();
    },
  };
}
