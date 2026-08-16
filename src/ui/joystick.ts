// Virtual joystick for the interior free-roam control scheme (Section 12):
// drag from the base, knob clamped to a max radius, vector snaps back to
// zero on release. Pointer events cover touch, mouse, and pen alike.

export interface Joystick {
  root: HTMLDivElement;
  getVector: () => { x: number; y: number }; // both axes clamped to [-1, 1]
  destroy: () => void;
}

const MAX_RADIUS = 44;

export function createJoystick(container: HTMLElement): Joystick {
  const root = document.createElement("div");
  root.className = "joystick";

  const base = document.createElement("div");
  base.className = "joystick__base";
  const knob = document.createElement("div");
  knob.className = "joystick__knob";
  base.appendChild(knob);
  root.appendChild(base);
  container.appendChild(root);

  let vx = 0;
  let vy = 0;
  let activePointerId: number | null = null;

  function setKnob(dx: number, dy: number) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function updateFromClient(clientX: number, clientY: number) {
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_RADIUS) {
      dx = (dx / dist) * MAX_RADIUS;
      dy = (dy / dist) * MAX_RADIUS;
    }
    setKnob(dx, dy);
    vx = dx / MAX_RADIUS;
    vy = dy / MAX_RADIUS;
  }

  base.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    activePointerId = e.pointerId;
    base.setPointerCapture(e.pointerId);
    updateFromClient(e.clientX, e.clientY);
  });
  base.addEventListener("pointermove", (e) => {
    if (activePointerId !== e.pointerId) return;
    updateFromClient(e.clientX, e.clientY);
  });
  const release = (e: PointerEvent) => {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    vx = 0;
    vy = 0;
    setKnob(0, 0);
  };
  base.addEventListener("pointerup", release);
  base.addEventListener("pointercancel", release);

  return {
    root,
    getVector: () => ({ x: vx, y: vy }),
    destroy: () => root.remove(),
  };
}
