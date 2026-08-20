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

  const box = document.createElement("div");
  box.className = "dialogue-box";
  overlay.appendChild(box);
  container.appendChild(overlay);

  let builder: (() => DialogueData) | null = null;

  function render() {
    if (!builder) return;
    const { portrait, name, text, options } = builder();
    box.innerHTML = "";

    const header = document.createElement("div");
    header.className = "dialogue-box__header";
    const portraitEl = document.createElement("span");
    portraitEl.className = "dialogue-box__portrait";
    portraitEl.textContent = portrait;
    const nameEl = document.createElement("span");
    nameEl.className = "dialogue-box__name";
    nameEl.textContent = name;
    header.appendChild(portraitEl);
    header.appendChild(nameEl);
    box.appendChild(header);

    const textEl = document.createElement("div");
    textEl.className = "dialogue-box__text";
    textEl.textContent = text;
    box.appendChild(textEl);

    const optionsEl = document.createElement("div");
    optionsEl.className = "dialogue-box__options";
    for (const option of options) {
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
