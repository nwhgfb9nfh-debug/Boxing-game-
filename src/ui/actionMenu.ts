// A generic location action menu — energy-costed actions plus Sleep,
// shown as an overlay. Built for the Phone first, but meant to be reused
// for every other Private Life location's menu (Gym, Diner, Beach,
// Lounge, ...) as those come online.

export interface MenuAction {
  id: string;
  label: string;
  cost: number; // Energy Star cost, shown next to the label
  /** Perform the action (or reject it, e.g. insufficient energy) and return a short result message. */
  run: () => string;
}

export interface MenuData {
  title: string;
  energyText: string;
  actions: MenuAction[];
}

export interface ActionMenu {
  root: HTMLDivElement;
  open: (builder: () => MenuData, onSleep: () => void) => void;
  setMessage: (text: string) => void;
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
  let sleepHandler: (() => void) | null = null;
  let message = "";

  function render() {
    if (!builder) return;
    const { title, energyText, actions } = builder();
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
      btn.innerHTML = `<span>${action.label}</span><span class="action-menu__cost">${action.cost} EN</span>`;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        message = action.run();
        render();
      });
      list.appendChild(btn);
    }
    panel.appendChild(list);

    const sleepBtn = document.createElement("button");
    sleepBtn.type = "button";
    sleepBtn.className = "action-menu__sleep";
    sleepBtn.textContent = "😴 Sleep";
    sleepBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      sleepHandler?.();
    });
    panel.appendChild(sleepBtn);

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

  function close() {
    overlay.style.display = "none";
    builder = null;
    sleepHandler = null;
    message = "";
  }

  return {
    root: overlay,
    open: (b, onSleep) => {
      builder = b;
      sleepHandler = onSleep;
      message = "";
      overlay.style.display = "flex";
      render();
    },
    setMessage: (text) => {
      message = text;
      render();
    },
    close,
    isOpen: () => overlay.style.display !== "none",
    destroy: () => overlay.remove(),
  };
}
