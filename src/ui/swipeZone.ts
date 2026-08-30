// Full-screen invisible swipe-capture layer for the Fight scene's
// memory-combo input — up/down/left/right gestures only. Mirrors
// ui/tapZone.ts's tap-capture pattern exactly, just grading a drag's
// dominant axis/direction instead of reporting a tap point.

export type SwipeDirection = "up" | "down" | "left" | "right";

export interface SwipeZone {
  root: HTMLDivElement;
  onSwipe: (handler: (direction: SwipeDirection) => void) => void;
  setActive: (active: boolean) => void;
  destroy: () => void;
}

// Shorter drags are ignored (not misread as a direction) — keeps an
// impatient tap from accidentally registering as a swipe.
const MIN_SWIPE_DISTANCE = 32;

export function createSwipeZone(container: HTMLElement): SwipeZone {
  const zone = document.createElement("div");
  zone.className = "swipe-zone";
  container.appendChild(zone);

  let handler: ((direction: SwipeDirection) => void) | null = null;
  let tracking = false;
  let startX = 0;
  let startY = 0;

  zone.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    tracking = true;
    startX = e.clientX;
    startY = e.clientY;
  });
  const endDrag = (e: PointerEvent) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) < MIN_SWIPE_DISTANCE) return;
    const direction: SwipeDirection =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    handler?.(direction);
  };
  zone.addEventListener("pointerup", endDrag);
  zone.addEventListener("pointercancel", () => {
    tracking = false;
  });

  return {
    root: zone,
    onSwipe: (h) => {
      handler = h;
    },
    setActive: (active) => {
      zone.style.display = active ? "block" : "none";
    },
    destroy: () => zone.remove(),
  };
}
