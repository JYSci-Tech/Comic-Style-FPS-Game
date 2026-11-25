export function prefersTouchControls() {
  return matchMedia("(pointer: coarse)").matches;
}

export class TouchControls {
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.pointers = new Map();
    this.stick = root.querySelector(".touch-stick");
    this.active = false;
    root.addEventListener("pointerdown", (event) => this.press(event));
    root.addEventListener("pointermove", (event) => this.move(event));
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      root.addEventListener(type, (event) => this.release(event.pointerId, type !== "pointerup"));
    }
    root.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  setActive(active) {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.reset();
    this.root.classList.toggle("hidden", !active);
  }

  reset() {
    for (const id of this.pointers.keys()) this.release(id, true);
    this.updateStick(0, 0, 1);
  }

  press(event) {
    const target = event.target.closest("[data-touch]");
    if (!this.active || !target || event.button !== 0) return;
    const action = target.dataset.touch;
    if ([...this.pointers.values()].some((pointer) => pointer.action === action)) return;
    event.preventDefault();
    const { clientX: x, clientY: y, pointerId } = event;
    const pointer = { action, target, x, y };
    this.pointers.set(pointerId, pointer);
    this.root.setPointerCapture(pointerId);
    if (action === "move") {
      const box = this.stick.getBoundingClientRect();
      pointer.x = box.left + box.width / 2;
      pointer.y = box.top + box.height / 2;
      pointer.radius = box.width * 0.32;
      this.updateStick(x - pointer.x, y - pointer.y, pointer.radius);
    } else if (action !== "look") {
      target.classList.add("held");
      this.callbacks.press(action);
    }
  }

  move(event) {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (pointer.action === "move") {
      this.updateStick(dx, dy, pointer.radius);
      return;
    }
    const isLook = pointer.action === "look";
    if (isLook || pointer.action === "fire" || pointer.action === "aim" || pointer.action === "grenade") {
      // A finger already dragging the scene takes precedence over drags on action buttons.
      const hasLook = !isLook && [...this.pointers.values()].some((input) => input.action === "look");
      if (!hasLook) this.callbacks.look(dx, dy);
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }
  }

  release(id, canceled) {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    this.pointers.delete(id);
    if (this.root.hasPointerCapture(id)) this.root.releasePointerCapture(id);
    if (pointer.action === "move") this.updateStick(0, 0, 1);
    else if (pointer.action !== "look") {
      pointer.target.classList.remove("held");
      this.callbacks.release(pointer.action, canceled);
    }
  }

  updateStick(x, y, radius) {
    const distance = Math.hypot(x, y);
    const clamp = Math.min(1, radius / (distance || 1));
    this.stick.style.setProperty("--stick-x", x * clamp + "px");
    this.stick.style.setProperty("--stick-y", y * clamp + "px");
    const threshold = distance > radius * 0.24 ? distance * 0.42 : Infinity;
    this.callbacks.move(x < -threshold, x > threshold, y < -threshold, y > threshold);
  }
}
