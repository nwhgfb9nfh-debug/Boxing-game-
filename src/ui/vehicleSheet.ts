// Vehicle Dealer (Section 5, updated): a single-car info sheet instead of
// a flat list of 9 — title, a picture (emoji placeholder — no real car art
// yet), info text, and price, with ‹ › buttons to page through the whole
// catalogue one car at a time. Reused as-is for the Buy confirmation and
// the post-purchase "set as Standard?" prompt (see main.ts's
// buildVehicleSheet) by swapping in Yes/No actions and hiding ‹ ›.

export interface VehicleSheetAction {
  id: string;
  label: string;
  disabled?: boolean;
  run: () => void;
}

export interface VehicleSheetData {
  title: string;
  image: string;
  infoText: string;
  priceText: string;
  message?: string;
  actions: VehicleSheetAction[];
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
}

export interface VehicleSheet {
  root: HTMLDivElement;
  open: (builder: () => VehicleSheetData) => void;
  close: () => void;
  isOpen: () => boolean;
  destroy: () => void;
}

export function createVehicleSheet(container: HTMLElement): VehicleSheet {
  const overlay = document.createElement("div");
  overlay.className = "vehicle-sheet-overlay";
  overlay.style.display = "none";

  const panel = document.createElement("div");
  panel.className = "vehicle-sheet";
  overlay.appendChild(panel);
  container.appendChild(overlay);

  let builder: (() => VehicleSheetData) | null = null;

  function render() {
    if (!builder) return;
    const { title, image, infoText, priceText, message, actions, onPrev, onNext, onClose } = builder();
    panel.innerHTML = "";

    const titleEl = document.createElement("div");
    titleEl.className = "vehicle-sheet__title";
    titleEl.textContent = title;
    panel.appendChild(titleEl);

    const imageEl = document.createElement("div");
    imageEl.className = "vehicle-sheet__image";
    imageEl.textContent = image;
    panel.appendChild(imageEl);

    const infoEl = document.createElement("div");
    infoEl.className = "vehicle-sheet__info";
    infoEl.textContent = infoText;
    panel.appendChild(infoEl);

    const priceEl = document.createElement("div");
    priceEl.className = "vehicle-sheet__price";
    priceEl.textContent = priceText;
    panel.appendChild(priceEl);

    if (message) {
      const msgEl = document.createElement("div");
      msgEl.className = "vehicle-sheet__message";
      msgEl.textContent = message;
      panel.appendChild(msgEl);
    }

    const actionsEl = document.createElement("div");
    actionsEl.className = "vehicle-sheet__actions";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vehicle-sheet__action";
      btn.textContent = action.label;
      if (action.disabled) btn.disabled = true;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (action.disabled) return;
        action.run();
        render();
      });
      actionsEl.appendChild(btn);
    }
    panel.appendChild(actionsEl);

    const navEl = document.createElement("div");
    navEl.className = "vehicle-sheet__nav";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "vehicle-sheet__nav-btn";
    prevBtn.textContent = "‹";
    if (!onPrev) prevBtn.disabled = true;
    prevBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onPrev?.();
      render();
    });
    navEl.appendChild(prevBtn);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "vehicle-sheet__close";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onClose();
    });
    navEl.appendChild(closeBtn);

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "vehicle-sheet__nav-btn";
    nextBtn.textContent = "›";
    if (!onNext) nextBtn.disabled = true;
    nextBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onNext?.();
      render();
    });
    navEl.appendChild(nextBtn);

    panel.appendChild(navEl);
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
    destroy: () => overlay.remove(),
  };
}
