// A big fixed hold-to-charge button, shared by training minigames that use
// the "press and hold, release at the right moment" mechanic (Heavy Bag
// first, more later). Works with touch, mouse, and pen via pointer events.

export interface HoldButton {
  root: HTMLButtonElement;
  isHeld: () => boolean;
  setActive: (active: boolean) => void;
  destroy: () => void;
}

export function createHoldButton(container: HTMLElement, label: string): HoldButton {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn--hold";
  btn.textContent = label;
  btn.style.display = "none";
  container.appendChild(btn);

  let held = false;

  const setHeld = (v: boolean) => {
    held = v;
    btn.classList.toggle("is-active", v);
  };

  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    setHeld(true);
  });
  const release = () => setHeld(false);
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("pointerleave", release);

  return {
    root: btn,
    isHeld: () => held,
    setActive: (active) => {
      btn.style.display = active ? "flex" : "none";
      if (!active) setHeld(false);
    },
    destroy: () => btn.remove(),
  };
}
