// Full-screen invisible tap-capture layer for minigames that need "tap
// wherever the target is" input (Reflex Dots first). Only active while
// the owning scene is active.

export interface TapZone {
  root: HTMLDivElement;
  onTap: (handler: (x: number, y: number) => void) => void;
  setActive: (active: boolean) => void;
  destroy: () => void;
}

export function createTapZone(container: HTMLElement): TapZone {
  const zone = document.createElement("div");
  zone.className = "tap-zone";
  container.appendChild(zone);

  let handler: ((x: number, y: number) => void) | null = null;

  zone.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handler?.(e.clientX, e.clientY);
  });

  return {
    root: zone,
    onTap: (h) => {
      handler = h;
    },
    setActive: (active) => {
      zone.style.display = active ? "block" : "none";
    },
    destroy: () => zone.remove(),
  };
}
