export const KEYBINDS_STORAGE_KEY = "ink_and_iron_keybinds_v1";

export const KEYBIND_ACTIONS = [
  { id: "moveForward", label: "向前移动", en: "MOVE FORWARD", defaultCode: "KeyW", group: "move" },
  { id: "moveBackward", label: "向后移动", en: "MOVE BACK", defaultCode: "KeyS", group: "move" },
  { id: "moveLeft", label: "向左移动", en: "STRAFE LEFT", defaultCode: "KeyA", group: "move" },
  { id: "moveRight", label: "向右移动", en: "STRAFE RIGHT", defaultCode: "KeyD", group: "move" },
  { id: "jump", label: "跳跃", en: "JUMP", defaultCode: "Space", group: "move" },
  { id: "dash", label: "闪避冲刺", en: "DASH", defaultCode: "ShiftLeft", group: "move" },
  { id: "slide", label: "战术滑铲", en: "SLIDE", defaultCode: "KeyC", group: "move" },
  { id: "reload", label: "更换弹夹", en: "RELOAD", defaultCode: "KeyR", group: "combat" },
  { id: "grenade", label: "手雷（按住瞄准/松开投掷）", en: "GRENADE", defaultCode: "KeyG", group: "combat" },
  { id: "melee", label: "近战重拳", en: "MELEE PUNCH", defaultCode: "KeyE", group: "combat" },
  { id: "weapon1", label: "1号武器 · 左轮", en: "MAGNUM", defaultCode: "Digit1", group: "combat" },
  { id: "weapon2", label: "2号武器 · 霰弹枪", en: "SHOTGUN", defaultCode: "Digit2", group: "combat" },
  { id: "weapon3", label: "3号武器 · 射线枪", en: "RAYGUN", defaultCode: "Digit3", group: "combat" },
  { id: "weapon4", label: "4号武器 · 狙击枪", en: "SNIPER", defaultCode: "Digit4", group: "combat" },
  { id: "toggleMute", label: "静音开关", en: "TOGGLE AUDIO", defaultCode: "KeyM", group: "combat" },
];

const SPECIAL_KEY_LABELS = {
  Space: "SPACE",
  ShiftLeft: "L-SHIFT",
  ShiftRight: "R-SHIFT",
  ControlLeft: "L-CTRL",
  ControlRight: "R-CTRL",
  AltLeft: "L-ALT",
  AltRight: "R-ALT",
  MetaLeft: "L-META",
  MetaRight: "R-META",
  Tab: "TAB",
  CapsLock: "CAPS",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "ENTER",
  NumpadEnter: "NUM ENTER",
  Backspace: "BKSP",
};

export function formatKeyCode(code) {
  if (!code || typeof code !== "string") return "?";
  if (SPECIAL_KEY_LABELS[code]) return SPECIAL_KEY_LABELS[code];
  if (code.startsWith("Key") && code.length === 4) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("Numpad")) return "NUM " + code.slice(6).toUpperCase();
  return code.toUpperCase();
}

export class KeybindManager {
  constructor() {
    this.bindings = {};
    this.load();
  }

  load() {
    for (const action of KEYBIND_ACTIONS) {
      this.bindings[action.id] = action.defaultCode;
    }
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(KEYBINDS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      for (const action of KEYBIND_ACTIONS) {
        const val = parsed[action.id];
        if (typeof val === "string" && val.length > 0 && val !== "Escape") {
          this.bindings[action.id] = val;
        }
      }
    } catch (_) {}
  }

  save() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(KEYBINDS_STORAGE_KEY, JSON.stringify(this.bindings));
    } catch (_) {}
  }

  get(actionId) {
    return this.bindings[actionId];
  }

  getLabel(actionId) {
    return formatKeyCode(this.get(actionId));
  }

  isBound(code) {
    for (const action of KEYBIND_ACTIONS) {
      if (this.bindings[action.id] === code) return true;
    }
    return false;
  }

  matches(code, actionId) {
    if (!code) return false;
    if (this.bindings[actionId] === code) return true;
    if (this.bindings[actionId] === "ShiftLeft" && code === "ShiftRight" && !this.isBound("ShiftRight")) {
      return true;
    }
    return false;
  }

  getActionForCode(code) {
    if (!code) return null;
    for (const action of KEYBIND_ACTIONS) {
      if (this.bindings[action.id] === code) return action.id;
    }
    if (code === "ShiftRight" && !this.isBound("ShiftRight")) {
      for (const action of KEYBIND_ACTIONS) {
        if (this.bindings[action.id] === "ShiftLeft") return action.id;
      }
    }
    return null;
  }

  set(actionId, newCode) {
    if (!(actionId in this.bindings)) return { ok: false, reason: "unknown" };
    if (typeof newCode !== "string" || !newCode.length || newCode === "Escape") {
      return { ok: false, reason: "reserved" };
    }
    const prevCode = this.bindings[actionId];
    let swappedWith = null;
    for (const action of KEYBIND_ACTIONS) {
      if (action.id !== actionId && this.bindings[action.id] === newCode) {
        this.bindings[action.id] = prevCode;
        swappedWith = action.id;
        break;
      }
    }
    this.bindings[actionId] = newCode;
    this.save();
    return { ok: true, swappedWith };
  }

  resetDefaults() {
    for (const action of KEYBIND_ACTIONS) {
      this.bindings[action.id] = action.defaultCode;
    }
    this.save();
    return { ok: true };
  }
}
