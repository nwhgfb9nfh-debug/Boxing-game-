// The generic "walk up, tap to act" prompt — used for the street's ENTER
// button and, inside interiors, interactive stations like the Gym's Heavy
// Bag (label configurable per use). Also owns the brief toast for locked
// buildings (which never open an interior scene at all — no room, so no
// exit mechanic is needed for them). Unlocked buildings exit by walking
// into the door inside the interior scene itself.

export interface EnterTarget {
  x: number;
  y: number;
}

export interface BuildingUI {
  setEnterPrompt: (target: EnterTarget | null, onEnter: () => void, label?: string) => void;
  showLockedToast: (message: string, anchor: EnterTarget, row: "top" | "bottom") => void;
  destroy: () => void;
}

const LOCKED_TOAST_DURATION_MS = 2600;
// Vertical gap from the ENTER button's anchor point to the near edge of
// the toast, so it stacks fully clear of the button instead of clipping it.
const TOAST_GAP = 30;

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
    setEnterPrompt: (target, onEnter, label = "ENTER") => {
      if (!target) {
        enterBtn.style.display = "none";
        currentEnterHandler = null;
        return;
      }
      currentEnterHandler = onEnter;
      enterBtn.textContent = label;
      enterBtn.style.left = `${target.x}px`;
      enterBtn.style.top = `${target.y}px`;
      enterBtn.style.display = "flex";
    },
    showLockedToast: (message, anchor, row) => {
      toast.textContent = message;
      toast.style.left = `${anchor.x}px`;
      if (row === "top") {
        // Building's entrance (and its ENTER button) sits on the upper
        // half of the road — stack the message fully above the button.
        toast.style.top = `${anchor.y - TOAST_GAP}px`;
        toast.style.transform = "translate(-50%, -100%)";
      } else {
        // Bottom-row building — stack the message fully below the button.
        toast.style.top = `${anchor.y + TOAST_GAP}px`;
        toast.style.transform = "translate(-50%, 0)";
      }
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
