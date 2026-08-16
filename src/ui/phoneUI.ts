// The Phone (Section 5): a home screen of apps rather than a flat action
// list. Only usable inside a building — see main.ts, which gates when
// this is shown. Business logic (spending energy/money, mutating player
// state) lives in main.ts and is handed in via PhoneApi; this module only
// renders and delegates.

import type { TrainingStats } from "../game/playerState";

export interface HouseListing {
  name: string;
  locked: boolean;
  price?: number;
}

export interface PhoneApi {
  getEnergy: () => number;
  getFame: () => number;
  getMoney: () => number;
  getTraining: () => TrainingStats;
  getHouses: () => HouseListing[];
  buyHouse: (name: string) => string;
  post: () => string;
}

type View = "home" | "contacts" | "stats" | "realestate" | "buzzer" | "imagestar" | "bca";

interface AppDef {
  id: View;
  icon: string;
  label: string;
}

const APPS: AppDef[] = [
  { id: "contacts", icon: "👥", label: "Contacts" },
  { id: "stats", icon: "📊", label: "Stats" },
  { id: "realestate", icon: "🏠", label: "Real Estate" },
  { id: "buzzer", icon: "🐦", label: "Buzzer" },
  { id: "imagestar", icon: "📷", label: "Imagestar" },
  { id: "bca", icon: "👑", label: "BCA" },
];

export interface PhoneUI {
  root: HTMLDivElement;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  destroy: () => void;
}

export function createPhoneUI(container: HTMLElement, api: PhoneApi): PhoneUI {
  const overlay = document.createElement("div");
  overlay.className = "action-menu-overlay";
  overlay.style.display = "none";

  const panel = document.createElement("div");
  panel.className = "action-menu phone-panel";
  overlay.appendChild(panel);
  container.appendChild(overlay);

  let view: View = "home";
  let message = "";

  function go(next: View) {
    view = next;
    message = "";
    render();
  }

  function render() {
    panel.innerHTML = "";

    const header = document.createElement("div");
    header.className = "phone-header";

    if (view !== "home") {
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "phone-back";
      backBtn.textContent = "‹ Phone";
      backBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        go("home");
      });
      header.appendChild(backBtn);
    } else {
      const titleEl = document.createElement("div");
      titleEl.className = "action-menu__title";
      titleEl.textContent = "📱 Phone";
      header.appendChild(titleEl);
    }

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "phone-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      close();
    });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    if (view === "home") renderHome();
    else if (view === "contacts") renderContacts();
    else if (view === "stats") renderStats();
    else if (view === "realestate") renderRealEstate();
    else if (view === "buzzer") renderBuzzer();
    else if (view === "imagestar") renderImagestar();
    else renderBCA();
  }

  function renderHome() {
    const energyEl = document.createElement("div");
    energyEl.className = "action-menu__energy";
    energyEl.textContent = `Energy: ${api.getEnergy()}/100`;
    panel.appendChild(energyEl);

    const grid = document.createElement("div");
    grid.className = "phone-grid";
    for (const app of APPS) {
      const icon = document.createElement("button");
      icon.type = "button";
      icon.className = "phone-app";
      icon.innerHTML = `<span class="phone-app__icon">${app.icon}</span><span class="phone-app__label">${app.label}</span>`;
      icon.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        go(app.id);
      });
      grid.appendChild(icon);
    }
    panel.appendChild(grid);
  }

  function appendMessage() {
    if (!message) return;
    const msgEl = document.createElement("div");
    msgEl.className = "action-menu__message";
    msgEl.textContent = message;
    panel.appendChild(msgEl);
  }

  function renderContacts() {
    const empty = document.createElement("div");
    empty.className = "phone-empty";
    empty.textContent = "No contacts yet — meet people around town to add them here.";
    panel.appendChild(empty);
  }

  function renderStats() {
    const t = api.getTraining();
    const list = document.createElement("div");
    list.className = "phone-stats";
    const statValue = (n: number) => (n > 0 ? `+${n}` : "Not trained yet");
    const rows: [string, string][] = [
      ["Power", statValue(t.power)],
      ["Speed", statValue(t.speed)],
      ["Endurance", statValue(t.endurance)],
      ["Chin", statValue(t.chin)],
    ];
    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "phone-stats__row";
      row.innerHTML = `<span>${label}</span><span>${value}</span>`;
      list.appendChild(row);
    }
    panel.appendChild(list);
    const note = document.createElement("div");
    note.className = "phone-empty";
    note.textContent = "Bonuses from completed training sessions — these carry into fight day.";
    panel.appendChild(note);
  }

  function renderRealEstate() {
    const moneyEl = document.createElement("div");
    moneyEl.className = "action-menu__energy";
    moneyEl.textContent = `Money: $${api.getMoney()}`;
    panel.appendChild(moneyEl);

    appendMessage();

    const list = document.createElement("div");
    list.className = "action-menu__list";
    for (const house of api.getHouses()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "action-menu__item";
      const status = house.locked ? `$${house.price ?? 0}` : "Owned";
      btn.innerHTML = `<span>${house.name}</span><span class="action-menu__cost">${status}</span>`;
      if (!house.locked) btn.disabled = true;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (!house.locked) return;
        message = api.buyHouse(house.name);
        render();
      });
      list.appendChild(btn);
    }
    panel.appendChild(list);
  }

  function renderBuzzer() {
    const energyEl = document.createElement("div");
    energyEl.className = "action-menu__energy";
    energyEl.textContent = `Energy: ${api.getEnergy()}/100  ·  Fame: ${api.getFame()}`;
    panel.appendChild(energyEl);

    appendMessage();

    const list = document.createElement("div");
    list.className = "action-menu__list";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-menu__item";
    btn.innerHTML = `<span>Post on Social Media</span><span class="action-menu__cost">10 EN</span>`;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      message = api.post();
      render();
    });
    list.appendChild(btn);
    panel.appendChild(list);
  }

  function renderImagestar() {
    const empty = document.createElement("div");
    empty.className = "phone-empty";
    empty.textContent = "Imagestar is coming soon.";
    panel.appendChild(empty);
  }

  function renderBCA() {
    const empty = document.createElement("div");
    empty.className = "phone-empty";
    empty.textContent =
      "Boxing Crown Association — rankings will appear here once the opponent roster is built.";
    panel.appendChild(empty);
  }

  function close() {
    overlay.style.display = "none";
    view = "home";
    message = "";
  }

  return {
    root: overlay,
    open: () => {
      view = "home";
      message = "";
      overlay.style.display = "flex";
      render();
    },
    close,
    isOpen: () => overlay.style.display !== "none",
    destroy: () => overlay.remove(),
  };
}
