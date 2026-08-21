// GBA/Pokémon-style dialogue box (NPC Dialogue spec, Section 1): docked to
// the bottom of the screen rather than a centered floating card like
// ActionMenu. Reused for every dialogue-capable NPC — callers hand in a
// builder describing the current portrait/name/text/options; it's called
// fresh on every open and after every option pick, same rebuild pattern
// as ActionMenu.

export interface DialogueOption {
  id: string;
  label: string;
  costLabel?: string;
  disabled?: boolean;
  onSelect: () => void;
  // A header is inserted before this option whenever it differs from the
  // previous option's section (e.g. Meetup System's General/Romance split).
  section?: string;
}

export interface DialogueData {
  portrait: string;
  name: string;
  text: string;
  options: DialogueOption[];
}

export interface DialogueBox {
  root: HTMLDivElement;
  open: (builder: () => DialogueData) => void;
  close: () => void;
  isOpen: () => boolean;
}

export function createDialogueBox(container: HTMLElement): DialogueBox {
  const overlay = document.createElement("div");
  overlay.className = "dialogue-overlay";
  overlay.style.display = "none";

  // wrap holds the floating portrait above the box's top-left corner and
  // the box itself, stacked — same max-width as the box so the portrait
  // lines up with its left edge instead of the screen's.
  const wrap = document.createElement("div");
  wrap.className = "dialogue-wrap";

  const portrait = document.createElement("div");
  portrait.className = "dialogue-portrait";

  const box = document.createElement("div");
  box.className = "dialogue-box";

  wrap.appendChild(portrait);
  wrap.appendChild(box);
  overlay.appendChild(wrap);
  container.appendChild(overlay);

  let builder: (() => DialogueData) | null = null;

  function render() {
    if (!builder) return;
    const { portrait: portraitSrc, name, text, options } = builder();

    portrait.innerHTML = "";
    if (portraitSrc.startsWith("data:") || portraitSrc.startsWith("http")) {
      const img = document.createElement("img");
      img.className = "dialogue-portrait__img";
      img.src = portraitSrc;
      portrait.appendChild(img);
    } else {
      const emoji = document.createElement("span");
      emoji.className = "dialogue-portrait__emoji";
      emoji.textContent = portraitSrc;
      portrait.appendChild(emoji);
    }

    box.innerHTML = "";

    const header = document.createElement("div");
    header.className = "dialogue-box__header";
    const nameEl = document.createElement("span");
    nameEl.className = "dialogue-box__name";
    nameEl.textContent = name;
    header.appendChild(nameEl);
    box.appendChild(header);

    const textEl = document.createElement("div");
    textEl.className = "dialogue-box__text";
    textEl.textContent = text;
    box.appendChild(textEl);

    const optionsEl = document.createElement("div");
    optionsEl.className = "dialogue-box__options";
    let lastSection: string | undefined;
    for (const option of options) {
      if (option.section && option.section !== lastSection) {
        const sectionEl = document.createElement("div");
        sectionEl.className = "dialogue-box__section";
        sectionEl.textContent = option.section;
        optionsEl.appendChild(sectionEl);
      }
      lastSection = option.section;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dialogue-box__option";
      const labelEl = document.createElement("span");
      labelEl.textContent = option.label;
      btn.appendChild(labelEl);
      if (option.costLabel) {
        const costEl = document.createElement("span");
        costEl.className = "dialogue-box__cost";
        costEl.textContent = option.costLabel;
        btn.appendChild(costEl);
      }
      if (option.disabled) btn.disabled = true;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (option.disabled) return;
        option.onSelect();
        render();
      });
      optionsEl.appendChild(btn);
    }
    box.appendChild(optionsEl);
  }

  function close() {
    overlay.style.display = "none";
    builder = null;
  }

  return {
    root: overlay,
    open: (b) => {
      builder = b;
      overlay.style.display = "flex";
      render();
    },
    close,
    isOpen: () => overlay.style.display !== "none",
  };
}
