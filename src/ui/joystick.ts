// Floating/dynamic virtual joystick for the interior free-roam control
// scheme (Section 12): invisible until the player touches the screen,
// wherever they first touch becomes its center, and dragging from there
// drives movement. Releasing hides it again. Pointer events cover touch,
// mouse, and pen alike.

export interface Joystick {
  root: HTMLDivElement;
  getVector: () => { x: number; y: number }; // both axes clamped to [-1, 1]
  setActive: (active: boolean) => void; // enable/disable the whole touch zone
  destroy: () => void;
}

const MAX_RADIUS = 50;

export function createJoystick(container: HTMLElement): Joystick {
  const zone = document.createElement("div");
  zone.className = "joystick-zone";

  const stick = document.createElement("div");
  stick.className = "joystick-stick";
  const knob = document.createElement("div");
  knob.className = "joystick-stick__knob";
  stick.appendChild(knob);
  zone.appendChild(stick);
  container.appendChild(zone);

  let vx = 0;
  let vy = 0;
  let activePointerId: number | null = null;
  let originX = 0;
  let originY = 0;

  function setKnob(dx: number, dy: number) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function showAt(x: number, y: number) {
    originX = x;
    originY = y;
    stick.style.left = `${x}px`;
    stick.style.top = `${y}px`;
    stick.style.display = "block";
    setKnob(0, 0);
  }

  function hideStick() {
    stick.style.display = "none";
    vx = 0;
    vy = 0;
  }

  zone.addEventListener("pointerdown", (e) => {
    if (activePointerId !== null) return; // one touch drives the stick at a time
    e.preventDefault();
    activePointerId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    showAt(e.clientX, e.clientY);
  });

  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activePointerId) return;
    let dx = e.clientX - originX;
    let dy = e.clientY - originY;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_RADIUS) {
      dx = (dx / dist) * MAX_RADIUS;
      dy = (dy / dist) * MAX_RADIUS;
    }
    setKnob(dx, dy);
    vx = dx / MAX_RADIUS;
    vy = dy / MAX_RADIUS;
  });

  const release = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    hideStick();
  };
  zone.addEventListener("pointerup", release);
  zone.addEventListener("pointercancel", release);

  return {
    root: zone,
    getVector: () => ({ x: vx, y: vy }),
    setActive: (active) => {
      zone.style.display = active ? "block" : "none";
      if (!active) {
        activePointerId = null;
        hideStick();
      }
    },
    destroy: () => zone.remove(),
  };
}
