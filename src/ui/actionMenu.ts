// A generic location action menu — a list of energy-costed actions, shown
// as an overlay. Used for other Private Life locations (Gym, Diner,
// Beach, Lounge, ...) as those come online. Sleeping isn't here — that's
// its own interaction at a bed, not a menu action (see main.ts).

export interface MenuAction {
  id: string;
  label: string;
  cost: number; // Energy Star cost, shown next to the label (ignored if costLabel is set)
  /** Override the auto "N EN" badge — e.g. "$2000" or "HIRED" for money-costed actions like Reception. */
  costLabel?: string;
  /** Greys out and disables the row (e.g. an already-owned tier) — run() still guards itself as a fallback. */
  disabled?: boolean;
  /** Perform the action (or reject it, e.g. insufficient energy) and return a short result message. */
  run: () => string;
}

export interface MenuData {
  title: string;
  energyText: string;
  actions: MenuAction[];
  /** Hides the Close button — used for a committed step (energy already spent) that must be resolved by picking an option. */
  hideClose?: boolean;
}

export interface ActionMenu {
  root: HTMLDivElement;
  open: (builder: () => MenuData) => void;
  close: () => void;
  isOpen: () => boolean;
  destroy: () => void;
}

export function createActionMenu(container: HTMLElement): ActionMenu {
  const overlay = document.createElement("div");
  overlay.className = "action-menu-overlay";
  overlay.style.display = "none";

  const panel = document.createElement("div");
  panel.className = "action-menu";
  overlay.appendChild(panel);
  container.appendChild(overlay);

  let builder: (() => MenuData) | null = null;
  let message = "";

  function render() {
    if (!builder) return;
    const { title, energyText, actions, hideClose } = builder();
    panel.innerHTML = "";

    const titleEl = document.createElement("div");
    titleEl.className = "action-menu__title";
    titleEl.textContent = title;
    panel.appendChild(titleEl);

    const energyEl = document.createElement("div");
    energyEl.className = "action-menu__energy";
    energyEl.textContent = energyText;
    panel.appendChild(energyEl);

    if (message) {
      const msgEl = document.createElement("div");
      msgEl.className = "action-menu__message";
      msgEl.textContent = message;
      panel.appendChild(msgEl);
    }

    const list = document.createElement("div");
    list.className = "action-menu__list";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "action-menu__item";
      const costText = action.costLabel ?? `${action.cost} EN`;
      btn.innerHTML = `<span>${action.label}</span><span class="action-menu__cost">${costText}</span>`;
      if (action.disabled) btn.disabled = true;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (action.disabled) return;
        message = action.run();
        render();
      });
      list.appendChild(btn);
    }
    panel.appendChild(list);

    if (!hideClose) {
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "action-menu__close";
      closeBtn.textContent = "Close";
      closeBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        close();
      });
      panel.appendChild(closeBtn);
    }
  }

  function close() {
    overlay.style.display = "none";
    builder = null;
    message = "";
  }

  return {
    root: overlay,
    open: (b) => {
      builder = b;
      message = "";
      overlay.style.display = "flex";
      render();
    },
    close,
    isOpen: () => overlay.style.display !== "none",
    destroy: () => overlay.remove(),
  };
}
