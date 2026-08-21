// The Phone (Section 5): a home screen of apps rather than a flat action
// list. Only usable inside a building — see main.ts, which gates when
// this is shown. Business logic (spending energy/money, mutating player
// state) lives in main.ts and is handed in via PhoneApi; this module only
// renders and delegates.

import type { TrainingStats, BuzzerPostRecord, Photo } from "../game/playerState";
import type { BuzzerPostResult } from "../game/buzzer";

export interface HouseListing {
  name: string;
  locked: boolean;
  price?: number;
}

// Contacts app (NPC Dialogue system spec, Contacts App & Text-Talk):
// portrait is either an emoji placeholder or a data:/http image URL, same
// as NpcDef.portrait — this module doesn't otherwise know about NpcDef.
export interface ContactSummary {
  id: string;
  name: string;
  portrait: string;
  tierLabel: string;
  score: number;
  maxScore: number;
  romanced: boolean;
  // True while the player is physically inside this NPC's building —
  // Text/Initiate Meetup are locked then (talk to her in person instead).
  locked: boolean;
}

export interface TextTalkOption {
  id: string;
  label: string;
}

// Meetup System — a location is only "available" once its content exists
// (Beach/Lounge don't yet) and, for Home, its per-NPC unlock is met.
export interface MeetupLocationSummary {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
}

export interface PhoneApi {
  getEnergy: () => number;
  getFame: () => number;
  getImage: () => number;
  getMoney: () => number;
  getHp: () => number;
  getTraining: () => TrainingStats;
  getHouses: () => HouseListing[];
  buyHouse: (name: string) => string;
  post: (text: string) => BuzzerPostResult;
  getBuzzerHistory: () => BuzzerPostRecord[];
  getAvailablePhotos: () => Photo[];
  getImagestarPosts: () => Photo[];
  postPhoto: (id: string) => string;
  getContacts: () => ContactSummary[];
  getTextTalkOptions: (npcId: string) => TextTalkOption[];
  sendTextTalk: (npcId: string, optionId: string) => string;
  getMeetupLocations: (npcId: string) => MeetupLocationSummary[];
  payForMeetup: (npcId: string, locationId: string) => { ok: boolean; message: string };
}

type View =
  | "home"
  | "contacts"
  | "contact-detail"
  | "contact-texttalk"
  | "contact-meetup-locations"
  | "stats"
  | "realestate"
  | "buzzer"
  | "imagestar"
  | "bca";

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
  let composeText = "";
  let activeContactId: string | null = null;

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
    else if (view === "contact-detail") renderContactDetail();
    else if (view === "contact-texttalk") renderContactTextTalk();
    else if (view === "contact-meetup-locations") renderContactMeetupLocations();
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

  // Portrait is either an emoji placeholder or a data:/http image URL —
  // same convention as the in-person NPC dialogue box.
  function renderPortraitInto(host: HTMLElement, src: string) {
    if (src.startsWith("data:") || src.startsWith("http")) {
      const img = document.createElement("img");
      img.src = src;
      host.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.textContent = src;
      host.appendChild(span);
    }
  }

  function renderContacts() {
    const contacts = api.getContacts();
    if (contacts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "phone-empty";
      empty.textContent = "No contacts yet — meet people around town to add them here.";
      panel.appendChild(empty);
      return;
    }
    const list = document.createElement("div");
    list.className = "action-menu__list";
    for (const contact of contacts) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "action-menu__item phone-contact-item";
      const portraitEl = document.createElement("span");
      portraitEl.className = "phone-contact-item__portrait";
      renderPortraitInto(portraitEl, contact.portrait);
      const nameEl = document.createElement("span");
      nameEl.textContent = contact.romanced ? `${contact.name} ♥` : contact.name;
      btn.appendChild(portraitEl);
      btn.appendChild(nameEl);
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        activeContactId = contact.id;
        go("contact-detail");
      });
      list.appendChild(btn);
    }
    panel.appendChild(list);
  }

  function renderContactDetail() {
    const contact = api.getContacts().find((c) => c.id === activeContactId);
    if (!contact) {
      go("contacts");
      return;
    }

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "action-menu__item";
    backBtn.textContent = "‹ Back";
    backBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      go("contacts");
    });
    panel.appendChild(backBtn);

    const nameEl = document.createElement("div");
    nameEl.className = "action-menu__title";
    nameEl.textContent = contact.name;
    panel.appendChild(nameEl);

    const portraitEl = document.createElement("div");
    portraitEl.className = "contact-detail__portrait";
    renderPortraitInto(portraitEl, contact.portrait);
    panel.appendChild(portraitEl);

    const statusEl = document.createElement("div");
    statusEl.className = "contact-detail__status";
    statusEl.textContent = contact.tierLabel;
    if (contact.romanced) {
      const heart = document.createElement("span");
      heart.className = "contact-detail__heart";
      heart.textContent = "♥";
      statusEl.appendChild(heart);
    }
    panel.appendChild(statusEl);

    const barTrack = document.createElement("div");
    barTrack.className = "contact-detail__bar";
    const barFill = document.createElement("div");
    barFill.className = "contact-detail__bar-fill";
    barFill.style.width = `${Math.min(100, (contact.score / contact.maxScore) * 100)}%`;
    barTrack.appendChild(barFill);
    panel.appendChild(barTrack);

    const scoreEl = document.createElement("div");
    scoreEl.className = "phone-empty";
    scoreEl.textContent = `${contact.score}/${contact.maxScore}`;
    panel.appendChild(scoreEl);

    if (contact.locked) {
      const lockedNote = document.createElement("div");
      lockedNote.className = "phone-empty";
      lockedNote.textContent = "She's right here — Text and Initiate Meetup only work from elsewhere.";
      panel.appendChild(lockedNote);
    }

    appendMessage();

    const list = document.createElement("div");
    list.className = "action-menu__list";

    const textBtn = document.createElement("button");
    textBtn.type = "button";
    textBtn.className = "action-menu__item";
    textBtn.textContent = "Text";
    textBtn.disabled = contact.locked;
    textBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (contact.locked) return;
      go("contact-texttalk");
    });
    list.appendChild(textBtn);

    const meetupBtn = document.createElement("button");
    meetupBtn.type = "button";
    meetupBtn.className = "action-menu__item";
    meetupBtn.textContent = "Initiate Meetup";
    meetupBtn.disabled = contact.locked;
    meetupBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (contact.locked) return;
      go("contact-meetup-locations");
    });
    list.appendChild(meetupBtn);

    panel.appendChild(list);
  }

  function renderContactTextTalk() {
    const contact = api.getContacts().find((c) => c.id === activeContactId);
    if (!contact) {
      go("contacts");
      return;
    }

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "action-menu__item";
    backBtn.textContent = "‹ Back";
    backBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      go("contact-detail");
    });
    panel.appendChild(backBtn);

    appendMessage();

    const list = document.createElement("div");
    list.className = "action-menu__list";
    for (const option of api.getTextTalkOptions(contact.id)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "action-menu__item";
      btn.textContent = option.label;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        message = api.sendTextTalk(contact.id, option.id);
        render();
      });
      list.appendChild(btn);
    }
    panel.appendChild(list);
  }

  function renderContactMeetupLocations() {
    const contact = api.getContacts().find((c) => c.id === activeContactId);
    if (!contact) {
      go("contacts");
      return;
    }

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "action-menu__item";
    backBtn.textContent = "‹ Back";
    backBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      go("contact-detail");
    });
    panel.appendChild(backBtn);

    appendMessage();

    const list = document.createElement("div");
    list.className = "action-menu__list";
    for (const loc of api.getMeetupLocations(contact.id)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "action-menu__item";
      const labelEl = document.createElement("span");
      labelEl.textContent = loc.label;
      btn.appendChild(labelEl);
      if (!loc.available && loc.reason) {
        const reasonEl = document.createElement("span");
        reasonEl.className = "action-menu__cost";
        reasonEl.textContent = loc.reason;
        btn.appendChild(reasonEl);
      }
      btn.disabled = !loc.available;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (!loc.available) return;
        const result = api.payForMeetup(contact.id, loc.id);
        message = result.message;
        render();
      });
      list.appendChild(btn);
    }
    panel.appendChild(list);
  }

  function renderStats() {
    const t = api.getTraining();
    const statValue = (s: { bonus: number; trained: boolean }) => (s.trained ? `+${s.bonus}` : "Not trained yet");

    const trainingHeader = document.createElement("div");
    trainingHeader.className = "phone-stats__header";
    trainingHeader.textContent = "Training";
    panel.appendChild(trainingHeader);

    const trainingList = document.createElement("div");
    trainingList.className = "phone-stats";
    const trainingRows: [string, string][] = [
      ["Power", statValue(t.power)],
      ["Speed", statValue(t.speed)],
      ["Endurance", statValue(t.endurance)],
      ["Chin", statValue(t.chin)],
    ];
    for (const [label, value] of trainingRows) {
      const row = document.createElement("div");
      row.className = "phone-stats__row";
      row.innerHTML = `<span>${label}</span><span>${value}</span>`;
      trainingList.appendChild(row);
    }
    panel.appendChild(trainingList);

    const statusHeader = document.createElement("div");
    statusHeader.className = "phone-stats__header";
    statusHeader.textContent = "Status";
    panel.appendChild(statusHeader);

    const statusList = document.createElement("div");
    statusList.className = "phone-stats";
    const statusRows: [string, string][] = [
      ["Energy", `${api.getEnergy()}/100`],
      ["HP", `${api.getHp()}`],
      ["Money", `$${api.getMoney()}`],
      ["Fame", `${api.getFame()}`],
      ["Image", `${api.getImage()}`],
    ];
    for (const [label, value] of statusRows) {
      const row = document.createElement("div");
      row.className = "phone-stats__row";
      row.innerHTML = `<span>${label}</span><span>${value}</span>`;
      statusList.appendChild(row);
    }
    panel.appendChild(statusList);

    const note = document.createElement("div");
    note.className = "phone-empty";
    note.textContent = "Training bonuses carry into fight day.";
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
    energyEl.textContent = `Energy: ${api.getEnergy()}/100  ·  Fame: ${api.getFame()}  ·  Image: ${api.getImage()}`;
    panel.appendChild(energyEl);

    appendMessage();

    const textarea = document.createElement("textarea");
    textarea.className = "buzzer-compose";
    textarea.placeholder = "What's on your mind?";
    textarea.value = composeText;
    textarea.rows = 3;
    textarea.addEventListener("input", (e) => {
      composeText = (e.target as HTMLTextAreaElement).value;
    });
    panel.appendChild(textarea);

    const list = document.createElement("div");
    list.className = "action-menu__list";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-menu__item";
    btn.innerHTML = `<span>Post</span><span class="action-menu__cost">10 EN</span>`;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!composeText.trim()) {
        message = "Write something first.";
        render();
        return;
      }
      const result = api.post(composeText.trim());
      composeText = "";
      message = result.blocked ? (result.blockedReason ?? "That post didn't go through.") : "";
      render();
    });
    list.appendChild(btn);
    panel.appendChild(list);

    const feedHeader = document.createElement("div");
    feedHeader.className = "phone-stats__header";
    feedHeader.textContent = "Your Feed (last 10)";
    panel.appendChild(feedHeader);

    const history = api.getBuzzerHistory();
    if (history.length === 0) {
      const empty = document.createElement("div");
      empty.className = "phone-empty";
      empty.textContent = "Nothing posted yet.";
      panel.appendChild(empty);
    } else {
      const feed = document.createElement("div");
      feed.className = "buzzer-feed";
      for (const record of history) {
        const yourPost = document.createElement("div");
        yourPost.className = "buzzer-post";
        yourPost.innerHTML = `<span class="buzzer-post__handle">@you</span><span class="buzzer-post__text"></span>`;
        yourPost.querySelector(".buzzer-post__text")!.textContent = record.text;
        feed.appendChild(yourPost);

        if (record.result.replies.length === 0) {
          const empty = document.createElement("div");
          empty.className = "phone-empty";
          empty.textContent = "No replies — tweeting into the void.";
          feed.appendChild(empty);
        } else {
          for (const reply of record.result.replies) {
            const row = document.createElement("div");
            row.className = "buzzer-reply";
            const handleEl = document.createElement("span");
            handleEl.className = "buzzer-reply__handle";
            handleEl.textContent = reply.handle;
            const textEl = document.createElement("span");
            textEl.className = "buzzer-reply__text";
            textEl.textContent = reply.text;
            row.appendChild(handleEl);
            row.appendChild(textEl);
            feed.appendChild(row);
          }
        }
      }
      panel.appendChild(feed);
    }
  }

  function renderImagestar() {
    const energyEl = document.createElement("div");
    energyEl.className = "action-menu__energy";
    energyEl.textContent = `Energy: ${api.getEnergy()}/100  ·  Image: ${api.getImage()}`;
    panel.appendChild(energyEl);

    appendMessage();

    const availableHeader = document.createElement("div");
    availableHeader.className = "phone-stats__header";
    availableHeader.textContent = "Available to Post";
    panel.appendChild(availableHeader);

    const available = api.getAvailablePhotos();
    if (available.length === 0) {
      const empty = document.createElement("div");
      empty.className = "phone-empty";
      empty.textContent = "Nothing to post yet — Photo Shoot (Press Building) and NPC selfies add photos here.";
      panel.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "action-menu__list";
      for (const photo of available) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "action-menu__item";
        btn.innerHTML = `<span>🖼️ ${photo.caption}</span><span class="action-menu__cost">10 EN</span>`;
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          message = api.postPhoto(photo.id);
          render();
        });
        list.appendChild(btn);
      }
      panel.appendChild(list);
    }

    const feedHeader = document.createElement("div");
    feedHeader.className = "phone-stats__header";
    feedHeader.textContent = "Your Feed";
    panel.appendChild(feedHeader);

    const posts = api.getImagestarPosts();
    if (posts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "phone-empty";
      empty.textContent = "Nothing posted yet.";
      panel.appendChild(empty);
    } else {
      const feed = document.createElement("div");
      feed.className = "buzzer-feed";
      for (const photo of posts) {
        const row = document.createElement("div");
        row.className = "buzzer-post";
        row.innerHTML = `<span class="buzzer-post__handle">@you</span><span class="buzzer-post__text">🖼️ ${photo.caption}</span>`;
        feed.appendChild(row);
      }
      panel.appendChild(feed);
    }
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
