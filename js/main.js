import { ComicAudio } from "./audio.js";
import { ComicAssets } from "./textures.js";
import { CELL_SIZE, COMIC_LEVELS } from "./levels.js";
import { ComicFPS3DEngine } from "./engine.js";
import { KeybindManager, KEYBIND_ACTIONS, formatKeyCode } from "./keybinds.js";
import { LanClient } from "./lan.js";
import { KILL_LIMIT } from "./lan-rules.js";
import { getWeaponArtSVG } from "./weapon-art.js";
import { TouchControls, prefersTouchControls } from "./touch-controls.js";

const SAVE_KEY = "ink_and_iron_checkpoint_v1";

const gameShell = document.getElementById("game-shell");
const glCanvas = document.getElementById("game-canvas");
const fxCanvas = document.getElementById("fx-canvas");
const miniCanvas = document.getElementById("minimap-canvas");
const miniCtx = miniCanvas.getContext("2d");
const portraitCanvas = document.getElementById("portrait-canvas");
const portraitCtx = portraitCanvas.getContext("2d");

const hud = document.getElementById("hud");
const startScreen = document.getElementById("start-screen");
const guideScreen = document.getElementById("guide-screen");
const pauseScreen = document.getElementById("pause-screen");
const interScreen = document.getElementById("intermission-screen");
const endScreen = document.getElementById("end-screen");
const damageFlash = document.getElementById("damage-flash");
const damageStamp = document.getElementById("damage-stamp");
const crosshair = document.getElementById("crosshair");
const hitmarker = document.getElementById("hitmarker");
const hitRing = document.getElementById("hit-ring");
const hitLabel = document.getElementById("hit-label");
const reloadHud = document.getElementById("reload-hud");
const reloadHudText = document.getElementById("reload-hud-text");
const reloadFill = document.getElementById("reload-fill");
const sniperScope = document.getElementById("sniper-scope");
const weaponSelectScreen = document.getElementById("weapon-select-screen");
const wsTag = document.getElementById("ws-tag");
const wsTitle = document.getElementById("ws-title");
const wsSubtitle = document.getElementById("ws-subtitle");
const wsCards = document.getElementById("ws-cards");
const btnWsConfirm = document.getElementById("btn-ws-confirm");
const btnWsBack = document.getElementById("btn-ws-back");
const killPanels = document.getElementById("kill-panels");

const hudIssue = document.getElementById("hud-issue");
const hudLevelName = document.getElementById("hud-level-name");
const hudComboBox = document.getElementById("hud-combo-box");
const hudCombo = document.getElementById("hud-combo");
const hudEnemiesLeft = document.getElementById("hud-enemies-left");
const hudObjectiveLabel = document.getElementById("hud-objective-label");
const hudScore = document.getElementById("hud-score");
const bossBarBox = document.getElementById("boss-bar-box");
const bossHpFill = document.getElementById("boss-hp-fill");
const hudHpFill = document.getElementById("hud-hp-fill");
const hudHpText = document.getElementById("hud-hp-text");
const hudPortraitBox = document.getElementById("hud-portrait-box");
const hudStatsBox = document.getElementById("hud-stats-box");
const hudHpGain = document.getElementById("hud-hp-gain");
const hudDashFill = document.getElementById("hud-dash-fill");
const hudDashText = document.getElementById("hud-dash-text");
const hudWeaponName = document.getElementById("hud-weapon-name");
const hudAmmoBox = document.getElementById("hud-ammo-box");
const hudAmmoReadout = document.getElementById("hud-ammo-readout");
const hudAmmoCur = document.getElementById("hud-ammo-cur");
const hudAmmoRes = document.getElementById("hud-ammo-res");
const hudAmmoGain = document.getElementById("hud-ammo-gain");
const hudReloadHint = document.getElementById("hud-reload-hint");
const hudGrenadeBox = document.getElementById("hud-grenade-box");
const hudGrenadeKey = document.getElementById("hud-grenade-key");
const hudGrenadeCount = document.getElementById("hud-grenade-count");
const weaponSlots = Array.from(document.querySelectorAll(".w-slot"));

const btnContinue = document.getElementById("btn-continue");
const btnStart = document.getElementById("btn-start");
const btnGuide = document.getElementById("btn-guide");
const btnGuideClose = document.getElementById("btn-guide-close");
const btnKeybinds = document.getElementById("btn-keybinds");
const btnKeybindsPause = document.getElementById("btn-keybinds-pause");
const btnKeybindsReset = document.getElementById("btn-keybinds-reset");
const btnKeybindsClose = document.getElementById("btn-keybinds-close");
const btnToggleSfx = document.getElementById("btn-toggle-sfx");
const btnResume = document.getElementById("btn-resume");
const btnRetryPause = document.getElementById("btn-retry-pause");
const btnRestartPause = document.getElementById("btn-restart-pause");
const btnHomePause = document.getElementById("btn-home-pause");
const btnNextIssue = document.getElementById("btn-next-issue");
const btnHomeInter = document.getElementById("btn-home-inter");
const btnRetryLevel = document.getElementById("btn-retry-level");
const btnRestart = document.getElementById("btn-restart");
const btnHomeEnd = document.getElementById("btn-home-end");
const keybindsScreen = document.getElementById("keybinds-screen");
const keybindsStatus = document.getElementById("keybinds-status");
const keybindsList = document.getElementById("keybinds-list");
const hudControlsStrip = document.getElementById("hud-controls-strip");
const aaaControlsHint = document.getElementById("aaa-controls-hint");
const guideControlsList = document.getElementById("guide-controls-list");

const hasTouch = prefersTouchControls();
const pages = document.documentElement.dataset.hosting === "pages";
document.documentElement.classList.toggle("has-touch", hasTouch);
if (pages) {
  document.getElementById("btn-lan").classList.add("hidden");
  document.querySelector(".aaa-issue-pill").textContent = COMIC_LEVELS.length + " ISSUES · SOLO";
  if (hasTouch && !navigator.standalone && !matchMedia("(display-mode: standalone)").matches) {
    document.getElementById("home-screen-hint").classList.remove("hidden");
  }
}
if (hasTouch) document.getElementById("pause-desc").textContent = "轻触继续，回到战斗。";
const audio = new ComicAudio();
const assets = new ComicAssets({ textureScale: hasTouch ? 2 : 4 });
const keybinds = new KeybindManager();
const pressedCodes = new Set();
let touchDirections = 0;
let touchFocused = false;
let listeningAction = null;
let keybindsReturnTarget = "menu";

let state = "menu"; // menu | playing | paused | intermission | weaponselect | gameover | victory | lan
let hitmarkerTimer = 0;
let hurtFlashTimeout = null;
let killPanelTimeout = null;
let resultDelayTimer = null;
let hpPickupTimeout = null;
let ammoPickupTimeout = null;
const slotGainTimeouts = [];
let hpRollTimer = 0;
let displayedHp = 100;
let ammoRollTimer = 0;
let displayedAmmoRes = 0;
let lastHudWeaponIdx = -1;
let currentCheckpoint = null;
let lastWeaponIdx = 0;
let pendingUnlockIdx = null;
let pendingTargetLevel = 0;
let pendingKeepStats = true;

const WEAPON_SLOT_NAMES = ["MAGNUM", "SHOTGUN", "RAYGUN", "SNIPER"];
const WEAPON_SLOT_LABELS = ["1. MAGNUM", "2. SHOTGUN", "3. RAYGUN", "4. SNIPER"];
const WEAPON_DRAFT_META = {
  0: {
    name: "THE EQUALIZER",
    role: "1号位 · .44 左轮手枪",
    desc: "备弹无限，换弹干脆，稳健可靠的全能随身武器",
    stats: { power: 68, rate: 58, range: 78 },
  },
  1: {
    name: "THE BOOMSTICK",
    role: "2号位 · 双管泵动霰弹枪",
    desc: "近距 8 弹丸超高爆发，清场与打重装利器",
    stats: { power: 96, rate: 34, range: 42 },
  },
  2: {
    name: "ZAP-O-MATIC",
    role: "3号位 · 复古科幻射线枪",
    desc: "全自动高速能量连射，中近距火力压制",
    stats: { power: 54, rate: 95, range: 72 },
  },
  3: {
    name: "DEADEYE .50",
    role: "4号位 · 4倍镜重型狙击枪",
    desc: "右键高倍开镜，爆头 2.5x 一枪秒杀强敌",
    stats: { power: 100, rate: 24, range: 100 },
  },
};

const HURT_WORDS = ["OUCH!", "HIT!", "BAM!", "ZAP!"];

function clearResultDelay() {
  if (resultDelayTimer) {
    clearInterval(resultDelayTimer);
    resultDelayTimer = null;
  }
}

function scheduleActionReveal(actionsEl, waitEl, delayMs = 2500) {
  clearResultDelay();
  const revealAt = performance.now() + delayMs;
  actionsEl.classList.add("hidden");
  actionsEl.classList.remove("actions-reveal");
  waitEl.classList.remove("hidden");

  const tick = () => {
    const left = Math.max(0, (revealAt - performance.now()) / 1000);
    if (left > 0.05) {
      waitEl.textContent = `对局结果展示中 · ${Math.ceil(left)}s 后显示操作选项...`;
    } else {
      clearResultDelay();
      waitEl.classList.add("hidden");
      actionsEl.classList.remove("hidden");
      void actionsEl.offsetWidth;
      actionsEl.classList.add("actions-reveal");
    }
  };
  tick();
  resultDelayTimer = setInterval(tick, 100);
}

function triggerHpGainAnim(amount) {
  const gain = Math.max(1, Math.round(amount || 35));
  if (hudHpGain) hudHpGain.textContent = `+${gain} HP!`;

  hudStatsBox?.classList.remove("hp-heal-active");
  hudPortraitBox?.classList.remove("heal-pulse");
  hudHpGain?.classList.remove("active");
  void hudStatsBox?.offsetWidth;
  hudStatsBox?.classList.add("hp-heal-active");
  hudPortraitBox?.classList.add("heal-pulse");
  hudHpGain?.classList.add("active");

  if (displayedHp >= engine.player.hp) {
    displayedHp = Math.max(0, engine.player.hp - gain);
  }
  hpRollTimer = 0.42;

  if (hpPickupTimeout) clearTimeout(hpPickupTimeout);
  hpPickupTimeout = setTimeout(() => {
    hudStatsBox?.classList.remove("hp-heal-active");
    hudPortraitBox?.classList.remove("heal-pulse");
    hudHpGain?.classList.remove("active");
  }, 950);
}

function triggerAmmoGainAnim(gains) {
  const curIdx = engine.weapons.currentIdx;
  const curGain = Array.isArray(gains) ? (gains[curIdx] || 0) : 0;
  const totalGain = Array.isArray(gains) ? gains.reduce((a, b) => a + b, 0) : 0;

  if (hudAmmoGain) {
    hudAmmoGain.textContent = curGain > 0 ? `+${curGain} 弹药!` : totalGain > 0 ? `+${totalGain} 备弹!` : "+AMMO!";
  }

  hudAmmoBox?.classList.remove("ammo-gain-active");
  hudAmmoGain?.classList.remove("active");
  void hudAmmoBox?.offsetWidth;
  hudAmmoBox?.classList.add("ammo-gain-active");
  hudAmmoGain?.classList.add("active");

  if (curGain > 0 && Number.isFinite(engine.weapons.current.reserve)) {
    if (displayedAmmoRes >= engine.weapons.current.reserve) {
      displayedAmmoRes = Math.max(0, engine.weapons.current.reserve - curGain);
    }
    ammoRollTimer = 0.42;
  }

  weaponSlots.forEach((slot, idx) => {
    if ((gains?.[idx] || 0) > 0 && engine.weapons.isUnlocked(idx)) {
      slot.classList.remove("slot-ammo-gain");
      void slot.offsetWidth;
      slot.classList.add("slot-ammo-gain");
      if (slotGainTimeouts[idx]) clearTimeout(slotGainTimeouts[idx]);
      slotGainTimeouts[idx] = setTimeout(() => {
        slot.classList.remove("slot-ammo-gain");
      }, 900);
    }
  });

  if (ammoPickupTimeout) clearTimeout(ammoPickupTimeout);
  ammoPickupTimeout = setTimeout(() => {
    hudAmmoBox?.classList.remove("ammo-gain-active");
    hudAmmoGain?.classList.remove("active");
  }, 950);
}

const engine = new ComicFPS3DEngine(glCanvas, fxCanvas, assets, audio, {
  onHit(isCrit) {
    hitmarker.classList.remove("active", "crit");
    hitRing.classList.remove("active", "crit");
    hitLabel.classList.remove("active", "crit");
    void hitmarker.offsetWidth;
    hitmarker.classList.add("active");
    hitRing.classList.add("active");
    hitLabel.classList.add("active");
    hitLabel.textContent = isCrit ? "CRIT!" : "HIT!";
    if (isCrit) {
      hitmarker.classList.add("crit");
      hitRing.classList.add("crit");
      hitLabel.classList.add("crit");
    }
    hitmarkerTimer = 0.22;
  },
  onPlayerHurt() {
    damageStamp.textContent = HURT_WORDS[Math.floor(Math.random() * HURT_WORDS.length)];
    damageFlash.classList.remove("active");
    void damageFlash.offsetWidth;
    damageFlash.classList.add("active");
    if (hurtFlashTimeout) clearTimeout(hurtFlashTimeout);
    hurtFlashTimeout = setTimeout(() => {
      damageFlash.classList.remove("active");
    }, 300);
  },
  onPickup(player, detail) {
    if (detail?.kind === "medkit") {
      triggerHpGainAnim(detail.amount || 35);
    } else if (detail?.kind === "ammo") {
      triggerAmmoGainAnim(detail.gains);
    }
  },
  onKillPanel(words) {
    document.getElementById("kp-text-1").textContent = words[0] || "POW!";
    document.getElementById("kp-text-2").textContent = words[1] || "BLAM!";
    document.getElementById("kp-text-3").textContent = words[2] || "K.O.!";
    killPanels.classList.remove("hidden", "show");
    void killPanels.offsetWidth;
    killPanels.classList.add("show");
    if (killPanelTimeout) clearTimeout(killPanelTimeout);
    killPanelTimeout = setTimeout(() => {
      killPanels.classList.remove("show");
      killPanels.classList.add("hidden");
    }, 1150);
  },
  onLevelClear() {
    if (state !== "playing") return;
    unlockPointer();
    const isLast = engine.levelIdx >= COMIC_LEVELS.length - 1;
    if (isLast) {
      saveCheckpoint(engine.levelIdx);
      showEndScreen(true);
    } else {
      // 通关后立即为下一关写入按局存档，刷新页面也不会丢失进度
      saveCheckpoint(engine.levelIdx + 1);
      showIntermission();
    }
  },
  onGameOver() {
    if (state !== "playing") return;
    lastWeaponIdx = engine.weapons.currentIdx;
    unlockPointer();
    showEndScreen(false);
  },
}, { mobile: hasTouch });

// ================= 按局存档系统（localStorage） =================
function buildCheckpointData(levelIdx) {
  const ws = engine.weapons.weapons;
  return {
    levelIdx,
    score: engine.score,
    kills: engine.kills,
    grenades: engine.player.grenades,
    unlocked: [...engine.weapons.unlocked],
    shotgunReserve: Math.max(18, ws[1].reserve),
    raygunReserve: Math.max(48, ws[2].reserve),
    sniperReserve: Math.max(12, ws[3].reserve),
  };
}

function saveCheckpoint(levelIdx) {
  currentCheckpoint = buildCheckpointData(levelIdx);
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(currentCheckpoint));
  } catch (_) {}
  refreshCoverSaveUI();
}

function readSavedCheckpoint() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data.levelIdx === "number" && data.levelIdx >= 0 && data.levelIdx < COMIC_LEVELS.length) {
      return data;
    }
  } catch (_) {}
  return null;
}

function applyCheckpoint(cp, preserveWeaponIdx = null) {
  const idx = cp ? cp.levelIdx : 0;
  engine.loadLevel(idx, false);
  const unlocked = Array.isArray(cp?.unlocked) && cp.unlocked.length === 4
    ? cp.unlocked
    : [true, idx >= 1, idx >= 2, idx >= 3];
  engine.weapons.setUnlocked(unlocked);
  if (cp) {
    engine.score = cp.score || 0;
    engine.kills = cp.kills || 0;
    engine.player.hp = engine.player.maxHp; // 重开本关满血复活，避免低血死循环
    engine.player.grenades = typeof cp.grenades === "number" ? cp.grenades : (idx === 0 ? 1 : 2);
    engine.weapons.weapons[1].reserve = Math.max(18, cp.shotgunReserve ?? 24);
    engine.weapons.weapons[2].reserve = Math.max(48, cp.raygunReserve ?? 72);
    engine.weapons.weapons[3].reserve = Math.max(12, cp.sniperReserve ?? 16);
  }
  if (Number.isInteger(preserveWeaponIdx) && preserveWeaponIdx >= 0 && preserveWeaponIdx < 4 && engine.weapons.isUnlocked(preserveWeaponIdx)) {
    engine.weapons.select(preserveWeaponIdx);
    engine.weapons.switchAnim = 0;
    engine.weapons.cooldown = 0;
  }
  currentCheckpoint = buildCheckpointData(idx);
}

function refreshCoverSaveUI() {
  const saved = readSavedCheckpoint();
  if (saved && saved.levelIdx > 0) {
    const lvl = COMIC_LEVELS[saved.levelIdx];
    btnContinue.textContent = `继续存档 · ${lvl.issue}`;
    btnContinue.classList.remove("hidden");
    btnStart.textContent = "新开战役 · ISSUE #1";
    btnStart.classList.remove("primary");
  } else {
    btnContinue.classList.add("hidden");
    btnStart.textContent = "开始战役 · ISSUE #1";
    btnStart.classList.add("primary");
  }
}

// 初始加载（若有存档则以存档关卡作为封面背景）
const initialSave = readSavedCheckpoint();
engine.loadLevel(initialSave ? initialSave.levelIdx : 0, false);
refreshCoverSaveUI();

const touch = hasTouch ? new TouchControls(document.getElementById("touch-controls"), {
  move(left, right, forward, back) {
    const next = Number(left) | (Number(right) << 1) | (Number(forward) << 2) | (Number(back) << 3);
    if (next === touchDirections) return;
    touchDirections = next;
    syncMovementKeys();
    if (state === "lan" && lan.canControl) lan.sendInput();
  },
  look(dx, dy) {
    if (state !== "playing" && !(state === "lan" && lan.canControl)) return;
    engine.handleMouseMove(dx * 2.1, dy * 2.1);
  },
  press(action) {
    if (action === "pause") {
      suspendTouchGame();
    } else if (state === "playing" || (state === "lan" && lan.canControl)) {
      if (action === "fire") setFiring(true);
      else if (action === "aim") setAiming(!engine.weapons.isAds);
      else if (action === "weapon") cycleWeapons(1);
      else runGameplayAction(action, "TouchGrenade");
    }
  },
  release(action, canceled) {
    if (action === "fire") setFiring(false);
    if (action === "grenade" && engine.grenadeAimKey === "TouchGrenade") {
      if (canceled) engine.cancelGrenadeAim();
      else finishGrenadeAim();
    }
  },
}) : null;
const touchAim = document.querySelector('[data-touch="aim"]');

const lan = pages ? null : new LanClient(engine, {
  onOpen() {
    state = "lan";
    engine.weapons.setUnlocked([true, true, true, true]);
    hideAllScreens();
    hud.classList.add("hidden");
  },
  onClose() {
    state = "menu";
    const saved = readSavedCheckpoint();
    engine.loadLevel(saved?.levelIdx ?? 0, false);
    refreshCoverSaveUI();
    startScreen.classList.remove("hidden");
  },
  onMatch(active) {
    hud.classList.toggle("hidden", !active);
  },
  lockPointer,
  unlockPointer,
  touchControls: hasTouch,
  isFocused: () => hasTouch ? touchFocused : document.pointerLockElement === glCanvas,
});

function lockPointer() {
  if (hasTouch) {
    touchFocused = true;
    if (state === "lan") lan.pointerChanged();
    return;
  }
  if (glCanvas.requestPointerLock) {
    try {
      glCanvas.requestPointerLock()?.catch(() => lan?.pointerError());
    } catch (_) {}
  }
}

function unlockPointer() {
  if (hasTouch) {
    touchFocused = false;
    touch.setActive(false);
    return;
  }
  if (document.pointerLockElement && document.exitPointerLock) {
    document.exitPointerLock();
  }
}

function suspendTouchGame() {
  unlockPointer();
  if (state === "lan") lan.pointerChanged();
  else pauseGame();
}

function syncMovementKeys() {
  const arrowUpUsed = keybinds.isBound("ArrowUp");
  const arrowDownUsed = keybinds.isBound("ArrowDown");
  const arrowLeftUsed = keybinds.isBound("ArrowLeft");
  const arrowRightUsed = keybinds.isBound("ArrowRight");

  engine.keys.KeyW = Boolean(touchDirections & 4) || pressedCodes.has(keybinds.get("moveForward")) || (!arrowUpUsed && pressedCodes.has("ArrowUp"));
  engine.keys.KeyS = Boolean(touchDirections & 8) || pressedCodes.has(keybinds.get("moveBackward")) || (!arrowDownUsed && pressedCodes.has("ArrowDown"));
  engine.keys.KeyA = Boolean(touchDirections & 1) || pressedCodes.has(keybinds.get("moveLeft"));
  engine.keys.KeyD = Boolean(touchDirections & 2) || pressedCodes.has(keybinds.get("moveRight"));
  engine.keys.ArrowUp = !arrowUpUsed && pressedCodes.has("ArrowUp");
  engine.keys.ArrowDown = !arrowDownUsed && pressedCodes.has("ArrowDown");
  engine.keys.ArrowLeft = !arrowLeftUsed && pressedCodes.has("ArrowLeft");
  engine.keys.ArrowRight = !arrowRightUsed && pressedCodes.has("ArrowRight");
}

function clearPressedInputs() {
  touch?.reset();
  pressedCodes.clear();
  touchDirections = 0;
  engine.keys = {};
}

function refreshKeybindHints() {
  if (hasTouch) {
    guideControlsList.innerHTML = '<li><b>左下摇杆</b> 移动</li><li><b>屏幕右侧滑动</b> 转动视角</li>'
      + '<li><b>轻触机瞄</b> 开关瞄准，按住开火按钮即可连续射击全自动武器</li>'
      + '<li><b>长按手雷</b> 预览轨迹，松开投掷</li><li><b>右上角</b> 暂停</li>';
    return;
  }
  const kFwd = keybinds.getLabel("moveForward");
  const kBack = keybinds.getLabel("moveBackward");
  const kLeft = keybinds.getLabel("moveLeft");
  const kRight = keybinds.getLabel("moveRight");
  const moveCombo = kFwd + kLeft + kBack + kRight;
  const kJump = keybinds.getLabel("jump");
  const kDash = keybinds.getLabel("dash");
  const kSlide = keybinds.getLabel("slide");
  const kReload = keybinds.getLabel("reload");
  const kGrenade = keybinds.getLabel("grenade");
  const kMelee = keybinds.getLabel("melee");
  const w1 = keybinds.getLabel("weapon1");
  const w2 = keybinds.getLabel("weapon2");
  const w3 = keybinds.getLabel("weapon3");
  const w4 = keybinds.getLabel("weapon4");

  for (let i = 0; i < 4; i++) {
    const label = keybinds.getLabel(`weapon${i + 1}`);
    WEAPON_SLOT_LABELS[i] = `${label}. ${WEAPON_SLOT_NAMES[i]}`;
  }

  if (hudControlsStrip) {
    hudControlsStrip.textContent =
      `${moveCombo} 移动 · ${kJump} 跳跃 · ${kDash} 冲刺 · ${kSlide} 滑铲 · 左键射击 · 右键机瞄 · 按住 ${kGrenade} 瞄准松开扔手雷 · ${kMelee} 重拳 · ${kReload} 换弹 · ${w1}/${w2}/${w3}/${w4} 切枪 · ESC 暂停`;
  }
  if (aaaControlsHint) {
    aaaControlsHint.textContent =
      `${moveCombo} 移动 · ${kJump} 跳跃 · ${kSlide} 滑铲 · ${kDash} 冲刺 · 左键开火 / 右键机瞄 · 按住 ${kGrenade} 瞄准扔手雷 · ${kMelee} 重拳`;
  }
  if (guideControlsList) {
    guideControlsList.innerHTML = `
      <li><b>${kFwd} ${kLeft} ${kBack} ${kRight} / ${kJump}</b>：移动、跳跃翻越木箱与移动平台</li>
      <li><b>鼠标左键 / 右键</b>：开火 / 精确机瞄缩放 (ADS)</li>
      <li><b>${kDash}</b>：漫画速度线闪避冲刺（带无敌帧，可穿激光）</li>
      <li><b>${kSlide}（奔跑中）</b>：高速战术滑铲（低视角滑行 + 可接跳跃）</li>
      <li><b>按住 ${kGrenade} 键</b>：移动鼠标预瞄抛物线与落点，松开投掷手雷 · 右键取消（首局 1 颗，每晋级 +2 颗）</li>
      <li><b>${kMelee} 键</b>：漫画重拳近战击退 (POW!)</li>
      <li><b>${w1} ${w2} ${w3} ${w4} 或滚轮 / ${kReload}</b>：切换 3D 武器与换弹</li>
    `;
  }
}

function renderKeybindsList() {
  if (!keybindsList) return;
  const groups = [
    { id: "move", title: "移动与身法 · MOVEMENT" },
    { id: "combat", title: "战斗与武器 · COMBAT" },
  ];
  const nodes = [];
  for (const grp of groups) {
    const header = document.createElement("div");
    header.className = "kb-group-title";
    header.textContent = grp.title;
    nodes.push(header);

    for (const action of KEYBIND_ACTIONS) {
      if (action.group !== grp.id) continue;
      const row = document.createElement("div");
      row.className = "kb-row";

      const labelWrap = document.createElement("div");
      labelWrap.className = "kb-label";
      const strong = document.createElement("strong");
      strong.textContent = action.label;
      const span = document.createElement("span");
      span.textContent = action.en;
      labelWrap.append(strong, span);

      const btn = document.createElement("button");
      btn.type = "button";
      const isListening = listeningAction === action.id;
      btn.className = "kb-key-btn" + (isListening ? " listening" : "");
      btn.textContent = isListening ? "请按键..." : keybinds.getLabel(action.id);
      btn.addEventListener("click", () => {
        audio.init();
        listeningAction = listeningAction === action.id ? null : action.id;
        if (keybindsStatus) {
          keybindsStatus.textContent = listeningAction
            ? `正在设置「${action.label}」—— 请按下新的键盘按键（ESC 取消）`
            : "点击任意按键框后按下新键即可绑定 · ESC 取消";
        }
        renderKeybindsList();
      });

      row.append(labelWrap, btn);
      nodes.push(row);
    }
  }
  keybindsList.replaceChildren(...nodes);
}

function openKeybinds(from = "menu") {
  keybindsReturnTarget = from;
  listeningAction = null;
  clearPressedInputs();
  if (keybindsStatus) {
    keybindsStatus.textContent = "点击任意按键框后按下新键即可绑定 · 冲突键位自动对调 · ESC 取消";
  }
  renderKeybindsList();
  pauseScreen.classList.add("hidden");
  keybindsScreen.classList.remove("hidden");
}

function closeKeybinds() {
  listeningAction = null;
  keybindsScreen.classList.add("hidden");
  if (keybindsReturnTarget === "pause" && state === "paused") {
    pauseScreen.classList.remove("hidden");
  }
}

function hideAllScreens() {
  clearResultDelay();
  listeningAction = null;
  gameShell.classList.remove("defeat-monochrome");
  startScreen.classList.add("hidden");
  guideScreen.classList.add("hidden");
  keybindsScreen?.classList.add("hidden");
  pauseScreen.classList.add("hidden");
  interScreen.classList.add("hidden");
  weaponSelectScreen.classList.add("hidden");
  endScreen.classList.add("hidden");
}

function startNewGame() {
  audio.init();
  engine.loadLevel(0, false);
  // 第一局只配备基础左轮，后续每通关一局由玩家自选解锁新武器
  engine.weapons.setUnlocked([true, false, false, false]);
  saveCheckpoint(0);
  hideAllScreens();
  hud.classList.remove("hidden");
  state = "playing";
  lockPointer();
}

function continueSavedGame() {
  audio.init();
  const saved = readSavedCheckpoint();
  applyCheckpoint(saved);
  const unlockedCount = engine.weapons.unlocked.filter(Boolean).length;
  if (saved && saved.levelIdx > 0 && unlockedCount <= saved.levelIdx && unlockedCount < 4) {
    openWeaponSelect(saved.levelIdx, false);
    return;
  }
  hideAllScreens();
  hud.classList.remove("hidden");
  state = "playing";
  lockPointer();
}

function retryCurrentLevel() {
  audio.init();
  const keepWeapon = state === "gameover" ? lastWeaponIdx : engine.weapons.currentIdx;
  const cp = currentCheckpoint || readSavedCheckpoint() || { levelIdx: engine.levelIdx, score: 0, kills: 0 };
  cp.levelIdx = engine.levelIdx;
  applyCheckpoint(cp, keepWeapon);
  hideAllScreens();
  hud.classList.remove("hidden");
  state = "playing";
  lockPointer();
}

function resumeGame() {
  hideAllScreens();
  hud.classList.remove("hidden");
  state = "playing";
  lockPointer();
}

function pauseGame() {
  if (state !== "playing") return;
  state = "paused";
  engine.mouseDown = false;
  engine.setAds(false);
  engine.cancelGrenadeAim();
  sniperScope.classList.add("hidden");
  clearPressedInputs();
  btnRetryPause.textContent = `重开本关 (${engine.level.issue})`;
  pauseScreen.classList.remove("hidden");
}

function goHome() {
  unlockPointer();
  hideAllScreens();
  hud.classList.add("hidden");
  sniperScope.classList.add("hidden");
  engine.mouseDown = false;
  engine.setAds(false);
  engine.cancelGrenadeAim();
  clearPressedInputs();
  state = "menu";
  const saved = readSavedCheckpoint();
  engine.loadLevel(saved?.levelIdx ?? 0, false);
  refreshCoverSaveUI();
  startScreen.classList.remove("hidden");
}

function showIntermission() {
  state = "intermission";
  engine.mouseDown = false;
  engine.setAds(false);
  engine.cancelGrenadeAim();
  sniperScope.classList.add("hidden");
  clearPressedInputs();
  const lvl = engine.level;
  gameShell.classList.remove("defeat-monochrome");
  document.getElementById("inter-banner").textContent = `★ ${lvl.issue} 通关成功 · STAGE CLEARED! ★`;
  document.getElementById("inter-tag").textContent = `${lvl.issue} CLEARED! · 已自动存档`;
  document.getElementById("inter-title").textContent = lvl.intermissionTitle;
  document.getElementById("inter-desc").textContent = lvl.intermissionDesc;
  document.getElementById("inter-stats").innerHTML = `
    当前得分: ${engine.score}<br/>
    累计击倒反派: ${engine.kills}<br/>
    已保存下一期检查点，进入下一期自动恢复 +35 HP 并获赠 +2 颗手雷
  `;
  interScreen.classList.remove("hidden", "result-victory", "result-defeat");
  void interScreen.offsetWidth;
  interScreen.classList.add("result-victory");
  scheduleActionReveal(document.getElementById("inter-actions"), document.getElementById("inter-wait"), 2500);
}

function openWeaponSelect(targetIdx, keepStats = true) {
  state = "weaponselect";
  pendingTargetLevel = targetIdx;
  pendingKeepStats = keepStats;
  pendingUnlockIdx = null;
  engine.mouseDown = false;
  engine.setAds(false);
  engine.cancelGrenadeAim();
  sniperScope.classList.add("hidden");
  clearPressedInputs();
  hud.classList.add("hidden");

  const nextLvl = COMIC_LEVELS[targetIdx];
  const lockedIndices = engine.weapons.weapons
    .map((_, idx) => idx)
    .filter((idx) => idx > 0 && !engine.weapons.isUnlocked(idx));
  const isUnlockPick = lockedIndices.length > 0;
  const candidateIndices = isUnlockPick ? lockedIndices : [0, 1, 2, 3];

  wsTag.textContent = `ARMORY · ${nextLvl.issue} (${nextLvl.name})`;
  wsTitle.textContent = isUnlockPick ? "选择解锁一把新武器!" : "选择本局首发武器!";
  wsSubtitle.textContent = isUnlockPick
    ? `即将进入 ${nextLvl.issue} · 点击武器卡片挑选你的新装备`
    : `全武器已集齐！挑选一把趁手武器率先出战 ${nextLvl.issue}`;

  btnWsBack.textContent = keepStats ? "返回对局结果" : "回到首页";
  btnWsConfirm.disabled = true;
  btnWsConfirm.textContent = "请先点击选择一把武器";
  wsCards.innerHTML = "";

  for (const idx of candidateIndices) {
    const w = engine.weapons.weapons[idx];
    const meta = WEAPON_DRAFT_META[idx];
    const card = document.createElement("button");
    card.type = "button";
    card.className = "ws-card";
    card.innerHTML = `
      <span class="ws-card-badge">${isUnlockPick ? "NEW UNLOCK" : "已解锁"}</span>
      <div class="ws-art-frame">${getWeaponArtSVG(w.id)}</div>
      <div class="ws-card-name">${meta.name}</div>
      <div class="ws-card-role">${meta.role}</div>
      <div class="ws-card-desc">${meta.desc}</div>
      <div class="ws-stats">
        <div class="ws-stat-row">
          <span>威力</span>
          <div class="ws-stat-bar"><div class="ws-stat-fill" style="width:${meta.stats.power}%"></div></div>
        </div>
        <div class="ws-stat-row">
          <span>射速</span>
          <div class="ws-stat-bar"><div class="ws-stat-fill" style="width:${meta.stats.rate}%"></div></div>
        </div>
        <div class="ws-stat-row">
          <span>射程</span>
          <div class="ws-stat-bar"><div class="ws-stat-fill" style="width:${meta.stats.range}%"></div></div>
        </div>
      </div>
    `;
    card.addEventListener("click", () => {
      audio.init();
      audio.playReload();
      pendingUnlockIdx = idx;
      wsCards.querySelectorAll(".ws-card").forEach((c) => {
        c.classList.remove("selected");
        const b = c.querySelector(".ws-card-badge");
        if (b) b.textContent = isUnlockPick ? "NEW UNLOCK" : "已解锁";
      });
      card.classList.add("selected");
      const badge = card.querySelector(".ws-card-badge");
      if (badge) badge.textContent = "已选定 ✓";
      btnWsConfirm.disabled = false;
      btnWsConfirm.textContent = `装备 ${meta.name} · 开始 ${nextLvl.issue}!`;
    });
    wsCards.appendChild(card);
  }

  hideAllScreens();
  weaponSelectScreen.classList.remove("hidden");
}

function confirmWeaponAndStart() {
  if (pendingUnlockIdx === null) return;
  const chosen = pendingUnlockIdx;
  const targetIdx = pendingTargetLevel;

  if (pendingKeepStats) {
    engine.weapons.unlock(chosen);
    const savedUnlocks = [...engine.weapons.unlocked];
    engine.loadLevel(targetIdx, true);
    engine.weapons.setUnlocked(savedUnlocks);
  } else {
    engine.weapons.unlock(chosen);
  }

  engine.weapons.select(chosen);
  engine.weapons.switchAnim = 0;
  engine.weapons.cooldown = 0;
  pendingUnlockIdx = null;
  saveCheckpoint(targetIdx);
  hideAllScreens();
  hud.classList.remove("hidden");
  state = "playing";
  lockPointer();
}

function showEndScreen(victory) {
  state = victory ? "victory" : "gameover";
  engine.mouseDown = false;
  engine.setAds(false);
  engine.cancelGrenadeAim();
  clearPressedInputs();
  hud.classList.add("hidden");
  sniperScope.classList.add("hidden");
  gameShell.classList.toggle("defeat-monochrome", !victory);

  const endBanner = document.getElementById("end-banner");
  endBanner.className = `result-status-banner ${victory ? "victory" : "defeat"}`;
  endBanner.textContent = victory ? "★ 全关卡通关 · VICTORY! ★" : "✖ 挑战失败 · DEFEAT ✖";

  document.getElementById("end-tag").textContent = victory ? "THE END · VICTORY!" : `${engine.level.issue} FAILED`;
  document.getElementById("end-title").textContent = victory ? "CITY SAVED!" : "YOU GOT INKED!";
  document.getElementById("end-desc").textContent = victory
    ? "你彻底粉碎了半调博士的阴谋，成为了漫画之城的传奇英雄！"
    : `进度已按局保存在 ${engine.level.issue}，你可以直接满血重开本关！`;
  document.getElementById("end-stats").innerHTML = `
    当前得分: ${engine.score}<br/>
    击败反派总数: ${engine.kills}<br/>
    当前章节: ${engine.level.issue} - ${engine.level.name}
  `;

  btnRetryLevel.textContent = victory ? `重玩 ${engine.level.issue}` : `重开本关 (${engine.level.issue})`;
  endScreen.classList.remove("hidden", "result-victory", "result-defeat");
  void endScreen.offsetWidth;
  endScreen.classList.add(victory ? "result-victory" : "result-defeat");
  scheduleActionReveal(document.getElementById("end-actions"), document.getElementById("end-wait"), 2500);
}

btnContinue.addEventListener("click", continueSavedGame);
btnStart.addEventListener("click", startNewGame);
btnGuide.addEventListener("click", () => guideScreen.classList.remove("hidden"));
btnGuideClose.addEventListener("click", () => guideScreen.classList.add("hidden"));
btnKeybinds?.addEventListener("click", () => openKeybinds("menu"));
btnKeybindsPause?.addEventListener("click", () => openKeybinds("pause"));
btnKeybindsReset?.addEventListener("click", () => {
  audio.init();
  audio.playReload();
  listeningAction = null;
  keybinds.resetDefaults();
  if (keybindsStatus) keybindsStatus.textContent = "已恢复全部默认键位！";
  renderKeybindsList();
  refreshKeybindHints();
});
btnKeybindsClose?.addEventListener("click", closeKeybinds);
btnResume.addEventListener("click", () => {
  audio.init();
  resumeGame();
});
btnRetryPause.addEventListener("click", retryCurrentLevel);
btnRestartPause.addEventListener("click", startNewGame);
btnHomePause.addEventListener("click", goHome);
btnNextIssue.addEventListener("click", () => {
  audio.init();
  openWeaponSelect(engine.levelIdx + 1, true);
});
btnWsConfirm.addEventListener("click", () => {
  audio.init();
  confirmWeaponAndStart();
});
btnWsBack.addEventListener("click", () => {
  if (pendingKeepStats) {
    weaponSelectScreen.classList.add("hidden");
    interScreen.classList.remove("hidden");
    state = "intermission";
  } else {
    goHome();
  }
});
btnHomeInter.addEventListener("click", goHome);
btnRetryLevel.addEventListener("click", retryCurrentLevel);
btnRestart.addEventListener("click", startNewGame);
btnHomeEnd.addEventListener("click", goHome);

// 在任意首次点击或按键时自动唤醒 Web Audio，彻底避免浏览器自动播放策略导致无声
const unlockAudioOnGesture = () => {
  if (audio.enabled) audio.init();
};
window.addEventListener("pointerdown", unlockAudioOnGesture, { passive: true });
window.addEventListener("keydown", unlockAudioOnGesture, { passive: true });

btnToggleSfx.addEventListener("click", () => {
  const on = audio.toggle();
  btnToggleSfx.textContent = on ? "音效: 开启" : "音效: 关闭";
});

document.addEventListener("pointerlockchange", () => {
  if (hasTouch) return;
  if (state === "lan") {
    lan.pointerChanged();
    return;
  }
  const locked = document.pointerLockElement === glCanvas;
  if (!locked) {
    engine.cancelGrenadeAim();
    if (state === "playing") {
      pauseGame();
    }
  }
});
document.addEventListener("pointerlockerror", () => lan?.pointerError());
document.addEventListener("visibilitychange", () => {
  if (hasTouch && document.hidden && touchFocused) suspendTouchGame();
});
window.addEventListener("blur", () => {
  engine.cancelGrenadeAim();
  clearPressedInputs();
  if (state === "lan" && lan.match) lan.releaseInput();
});

// 键位设置界面全局捕获按键监听
window.addEventListener("keydown", (e) => {
  if (!keybindsScreen || keybindsScreen.classList.contains("hidden")) return;
  if (listeningAction) {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape") {
      listeningAction = null;
      if (keybindsStatus) keybindsStatus.textContent = "已取消修改，点击任意按键框可重新绑定 · ESC 取消";
      renderKeybindsList();
      return;
    }
    const targetAction = KEYBIND_ACTIONS.find((a) => a.id === listeningAction);
    const res = keybinds.set(listeningAction, e.code);
    listeningAction = null;
    if (res.ok) {
      audio.init();
      audio.playReload();
      if (res.swappedWith) {
        const swappedAction = KEYBIND_ACTIONS.find((a) => a.id === res.swappedWith);
        if (keybindsStatus) {
          keybindsStatus.textContent = `已将「${targetAction?.label}」绑定为 ${formatKeyCode(e.code)}（并与「${swappedAction?.label}」自动对调）`;
        }
      } else if (keybindsStatus) {
        keybindsStatus.textContent = `已将「${targetAction?.label}」绑定为 ${formatKeyCode(e.code)}`;
      }
      refreshKeybindHints();
    } else if (keybindsStatus) {
      keybindsStatus.textContent = "该按键不可绑定（ESC 为系统保留键），请更换其他按键";
    }
    renderKeybindsList();
    return;
  }
  if (e.code === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeKeybinds();
  }
}, true);

refreshKeybindHints();

glCanvas.addEventListener("contextmenu", (e) => e.preventDefault());

glCanvas.addEventListener("mousedown", (e) => {
  if (hasTouch || (state !== "playing" && !(state === "lan" && lan.canControl))) return;
  if (state === "playing" && document.pointerLockElement !== glCanvas) lockPointer();
  if (e.button === 0) setFiring(true);
  else if (e.button === 2) setAiming(true);
});

window.addEventListener("mouseup", (e) => {
  if (hasTouch) return;
  if (e.button === 0) setFiring(false);
  else if (e.button === 2) setAiming(false);
});

window.addEventListener("mousemove", (e) => {
  if (!hasTouch && ((state === "playing" && document.pointerLockElement === glCanvas) || (state === "lan" && lan.canControl))) {
    engine.handleMouseMove(e.movementX, e.movementY);
  }
});

window.addEventListener("wheel", (e) => cycleWeapons(e.deltaY > 0 ? 1 : -1));

function setFiring(down) {
  if (down && engine.grenadeAiming) return;
  engine.mouseDown = down;
  if (state === "lan" && lan.canControl) {
    if (down) lan.action("fire");
    else lan.sendInput();
  } else if (down && state === "playing") engine.fireWeapon();
}

function setAiming(down) {
  if (down && engine.grenadeAiming) {
    engine.cancelGrenadeAim();
    return;
  }
  engine.setAds(down);
  if (state === "lan" && lan.canControl) lan.sendInput();
}

function cycleWeapons(direction) {
  if (state === "lan" && lan.canControl) {
    engine.cancelGrenadeAim();
    const count = engine.weapons.weapons.length;
    lan.weapon = (lan.weapon + direction + count) % count;
    lan.sendInput();
  } else if (state === "playing") {
    engine.cancelGrenadeAim();
    engine.weapons.cycle(direction);
  }
}

const localActions = {
  reload: () => engine.weapons.startReload(),
  dash: () => engine.triggerDash(),
  slide: () => engine.triggerSlide(),
  jump: () => engine.triggerJump(),
  melee: () => engine.triggerMeleePunch(),
};

function runGameplayAction(action, code) {
  const inLan = state === "lan";
  if (/^weapon[1-4]$/.test(action || "")) {
    engine.cancelGrenadeAim();
    const index = Number(action.slice(-1)) - 1;
    if (inLan) {
      lan.weapon = index;
      lan.sendInput();
    } else engine.weapons.select(index);
  } else if (action === "grenade") {
    if (!engine.grenadeAiming && engine.startGrenadeAim(code) && inLan) lan.sendInput();
  } else if (action === "toggleMute") {
    btnToggleSfx.textContent = audio.toggle() ? "音效: 开启" : "音效: 关闭";
  } else if (Object.hasOwn(localActions, action)) {
    if (inLan) lan.action(action);
    else localActions[action]();
  } else return false;
  return true;
}

function finishGrenadeAim() {
  if (state === "lan" && lan.canControl && engine.canThrowGrenade()) {
    engine.cancelGrenadeAim();
    lan.action("grenade");
  } else if (state === "playing") engine.releaseGrenadeAim();
  else engine.cancelGrenadeAim();
}

window.addEventListener("keydown", (e) => {
  if (keybindsScreen && !keybindsScreen.classList.contains("hidden")) return;
  if (state !== "playing" && !(state === "lan" && lan.canControl)) return;
  if (e.code === "Space" || e.code === "Tab" || e.code.startsWith("Arrow")) e.preventDefault();

  const prevW = engine.keys.KeyW;
  const prevS = engine.keys.KeyS;
  const prevA = engine.keys.KeyA;
  const prevD = engine.keys.KeyD;
  const prevAL = engine.keys.ArrowLeft;
  const prevAR = engine.keys.ArrowRight;

  pressedCodes.add(e.code);
  syncMovementKeys();

  const moveChanged = prevW !== engine.keys.KeyW || prevS !== engine.keys.KeyS
    || prevA !== engine.keys.KeyA || prevD !== engine.keys.KeyD
    || prevAL !== engine.keys.ArrowLeft || prevAR !== engine.keys.ArrowRight;
  const action = keybinds.getActionForCode(e.code);
  const handleAction = !e.repeat || (state === "playing" && action !== "grenade");
  if (handleAction && runGameplayAction(action, e.code)) return;
  if (state === "lan" && moveChanged) lan.sendInput();
});

window.addEventListener("keyup", (e) => {
  const wasDown = pressedCodes.delete(e.code);
  const prevW = engine.keys.KeyW;
  const prevS = engine.keys.KeyS;
  const prevA = engine.keys.KeyA;
  const prevD = engine.keys.KeyD;
  const prevAL = engine.keys.ArrowLeft;
  const prevAR = engine.keys.ArrowRight;

  syncMovementKeys();

  const moveChanged = prevW !== engine.keys.KeyW || prevS !== engine.keys.KeyS
    || prevA !== engine.keys.KeyA || prevD !== engine.keys.KeyD
    || prevAL !== engine.keys.ArrowLeft || prevAR !== engine.keys.ArrowRight;

  if (engine.grenadeAiming && (e.code === engine.grenadeAimKey || keybinds.matches(e.code, "grenade"))) {
    finishGrenadeAim();
    return;
  }
  if (!wasDown && !moveChanged) return;
  if (state === "lan" && lan.canControl && moveChanged) lan.sendInput();
});

function setHudText(node, value) {
  const text = String(value);
  if (node.textContent !== text) node.textContent = text;
}

function updateHUD(dt) {
  if (hitmarkerTimer > 0) {
    hitmarkerTimer -= dt;
    if (hitmarkerTimer <= 0) {
      hitmarker.classList.remove("active", "crit");
      hitRing.classList.remove("active", "crit");
      hitLabel.classList.remove("active", "crit");
    }
  }

  const scoped = engine.weapons.isScoped() && (state === "playing" || (state === "lan" && lan.match?.phase === "playing"));
  sniperScope.classList.toggle("hidden", !scoped);
  crosshair.classList.toggle("hidden", scoped);
  crosshair.classList.toggle("ads", engine.weapons.isAds);
  // 根据当前移动/跳跃/冲刺散布实时动态扩张准星，直观反馈射击精度
  const spreadPx = Math.round(Math.min(28, Math.max(0, (engine.getCurrentSpread() - 0.008) * 320)));
  crosshair.style.setProperty("--spread", `${spreadPx}px`);

  const lvl = engine.level;
  const pvp = state === "lan" && lan.match?.mode === "pvp";
  setHudText(hudIssue, pvp ? "玩家对战" : lvl.issue);
  setHudText(hudLevelName, lvl.name);
  setHudText(hudObjectiveLabel, pvp ? "击倒目标" : "消灭所有反派:");
  setHudText(hudEnemiesLeft, pvp ? KILL_LIMIT : engine.getAliveEnemiesCount());
  setHudText(hudScore, String(engine.score).padStart(5, "0"));

  if (engine.combo >= 2) {
    hudComboBox.classList.remove("hidden");
    setHudText(hudCombo, `x${engine.combo} COMBO!`);
  } else {
    hudComboBox.classList.add("hidden");
  }

  const boss = engine.getBoss();
  if (boss) {
    bossBarBox.classList.remove("hidden");
    bossHpFill.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
  } else {
    bossBarBox.classList.add("hidden");
  }

  if (hpRollTimer > 0 && engine.player.hp > displayedHp) {
    hpRollTimer = Math.max(0, hpRollTimer - dt);
    displayedHp += (engine.player.hp - displayedHp) * Math.min(1, dt * 11);
    if (engine.player.hp - displayedHp < 0.6 || hpRollTimer === 0) {
      displayedHp = engine.player.hp;
      hpRollTimer = 0;
    }
  } else {
    displayedHp = engine.player.hp;
    hpRollTimer = 0;
  }

  const hpPct = Math.max(0, (displayedHp / engine.player.maxHp) * 100);
  hudHpFill.style.width = `${hpPct}%`;
  setHudText(hudHpText, Math.ceil(displayedHp));

  const dashReady = engine.player.dashCooldown <= 0;
  const dashPct = dashReady ? 100 : Math.max(0, (1 - engine.player.dashCooldown / 1.35) * 100);
  hudDashFill.style.width = `${dashPct}%`;
  setHudText(hudDashText, dashReady ? "RDY" : `${engine.player.dashCooldown.toFixed(1)}s`);

  const w = engine.weapons.current;
  if (engine.weapons.currentIdx !== lastHudWeaponIdx || !Number.isFinite(w.reserve)) {
    lastHudWeaponIdx = engine.weapons.currentIdx;
    displayedAmmoRes = w.reserve;
    ammoRollTimer = 0;
  } else if (ammoRollTimer > 0 && w.reserve > displayedAmmoRes) {
    ammoRollTimer = Math.max(0, ammoRollTimer - dt);
    displayedAmmoRes += (w.reserve - displayedAmmoRes) * Math.min(1, dt * 11);
    if (w.reserve - displayedAmmoRes < 0.6 || ammoRollTimer === 0) {
      displayedAmmoRes = w.reserve;
      ammoRollTimer = 0;
    }
  } else {
    displayedAmmoRes = w.reserve;
    ammoRollTimer = 0;
  }

  setHudText(hudWeaponName, w.name);
  setHudText(hudAmmoCur, w.ammo);
  setHudText(hudAmmoRes, w.reserve === Infinity ? "∞" : Math.round(displayedAmmoRes));

  const gCount = Math.max(0, engine.player.grenades || 0);
  setHudText(hudGrenadeCount, `x${gCount}`);
  hudGrenadeBox.classList.toggle("empty", gCount === 0);
  hudGrenadeBox.classList.toggle("aiming", engine.grenadeAiming);
  if (hudGrenadeKey) {
    const grenadeHint = hasTouch ? "手雷" : `[${keybinds.getLabel("grenade")}] 手雷`;
    const aimHint = hasTouch ? "松开投掷" : "松开投掷 · 右键取消";
    setHudText(hudGrenadeKey, engine.grenadeAiming ? aimHint : grenadeHint);
  }

  const isReloading = engine.weapons.reloading && engine.weapons.reloadTimer > 0;
  hudReloadHint.classList.toggle("hidden", !isReloading);
  reloadHud.classList.toggle("hidden", !isReloading);
  if (isReloading) {
    const leftSec = Math.max(0, engine.weapons.reloadTimer);
    const pct = Math.min(100, Math.max(0, (1 - leftSec / w.reloadTime) * 100));
    setHudText(hudReloadHint, `RELOADING ${leftSec.toFixed(1)}s`);
    setHudText(reloadHudText, `换弹中 ${leftSec.toFixed(1)}s`);
    reloadFill.style.width = `${pct}%`;
  }

  weaponSlots.forEach((slot, idx) => {
    const unlocked = engine.weapons.isUnlocked(idx);
    slot.classList.toggle("active", idx === engine.weapons.currentIdx);
    slot.classList.toggle("locked", !unlocked);
    const k = keybinds.getLabel(`weapon${idx + 1}`);
    setHudText(slot, unlocked ? WEAPON_SLOT_LABELS[idx] : `${k}. 🔒 LOCKED`);
  });

  assets.drawPortrait(portraitCtx, engine.player.hp, engine.player.hurtTimer, engine.player.fireTimer);
  engine.drawMinimap(miniCtx);
}

let lastTime = performance.now();
let menuOrbitAngle = 0.4;
const menuOrbitTarget = engine.camera.position.clone();
let lastRenderedState;
let lastViewportRevision;
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (touch) {
    touch.setActive(touchFocused && (state === "playing" || (state === "lan" && lan.canControl)));
    const aiming = String(engine.weapons.isAds);
    if (touchAim.getAttribute("aria-pressed") !== aiming) touchAim.setAttribute("aria-pressed", aiming);
  }

  if (state === "playing") {
    if (engine.weapons.root) engine.weapons.root.visible = true;
    engine.update(dt);
    engine.updateGrenadeAim(dt);
    engine.render();
    updateHUD(dt);
  } else if (state === "lan" && lan.match) {
    lan.update(dt);
    engine.updateGrenadeAim(dt);
    engine.render();
    updateHUD(dt);
    lan.view.drawLabels(miniCtx);
  } else if (state === "menu" || state === "lan") {
    // 3A 主界面实时 3D 航拍运镜：隐藏手部武器，智能避障环视运行移动平台/激光/道具旋转
    if (engine.weapons.root) engine.weapons.root.visible = false;
    if (engine.weapons.punchFist) engine.weapons.punchFist.visible = false;
    menuOrbitAngle += dt * 0.16;
    engine.levelTime += dt;
    engine._updateDynamics(dt, [], false);
    engine._updateProps(dt, false, false);

    engine.computeMenuOrbitCamera(menuOrbitAngle, engine.camera.position, menuOrbitTarget);
    engine.camera.lookAt(menuOrbitTarget);
    engine.render(engine.movers.length > 0);
  } else if (state !== lastRenderedState || engine.viewportRevision !== lastViewportRevision) {
    engine.render(false);
  }

  lastRenderedState = state;
  lastViewportRevision = engine.viewportRevision;
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
