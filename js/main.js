import { ComicAudio } from "./audio.js";
import { ComicAssets } from "./textures.js";
import { CELL_SIZE, COMIC_LEVELS } from "./levels.js";
import { ComicFPS3DEngine } from "./engine.js";
import { LanClient } from "./lan.js";
import { KILL_LIMIT } from "./lan-rules.js";
import { getWeaponArtSVG } from "./weapon-art.js";

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

const audio = new ComicAudio();
const assets = new ComicAssets();

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
});

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

const lan = new LanClient(engine, {
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
});

function lockPointer() {
  if (glCanvas.requestPointerLock) {
    try {
      glCanvas.requestPointerLock()?.catch(() => lan.pointerError());
    } catch (_) {}
  }
}

function unlockPointer() {
  if (document.pointerLockElement && document.exitPointerLock) {
    document.exitPointerLock();
  }
}

function hideAllScreens() {
  clearResultDelay();
  gameShell.classList.remove("defeat-monochrome");
  startScreen.classList.add("hidden");
  guideScreen.classList.add("hidden");
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
  engine.keys = {};
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
  engine.keys = {};
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
  engine.keys = {};
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
  engine.keys = {};
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
  engine.keys = {};
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
document.addEventListener("pointerlockerror", () => lan.pointerError());
window.addEventListener("blur", () => {
  engine.cancelGrenadeAim();
  engine.keys = {};
  if (state === "lan" && lan.match) lan.releaseInput();
});

glCanvas.addEventListener("contextmenu", (e) => e.preventDefault());

glCanvas.addEventListener("mousedown", (e) => {
  if (state === "lan") {
    if (!lan.canControl) return;
    if (engine.grenadeAiming) {
      if (e.button === 2) engine.cancelGrenadeAim();
      return;
    }
    if (e.button === 0) {
      engine.mouseDown = true;
      lan.action("fire");
    } else if (e.button === 2) {
      engine.setAds(true);
      lan.sendInput();
    }
    return;
  }
  if (state !== "playing") return;
  if (document.pointerLockElement !== glCanvas) {
    lockPointer();
  }
  if (engine.grenadeAiming) {
    if (e.button === 2) engine.cancelGrenadeAim();
    return;
  }
  if (e.button === 0) {
    engine.mouseDown = true;
    engine.fireWeapon();
  } else if (e.button === 2) {
    engine.setAds(true);
  }
});

window.addEventListener("mouseup", (e) => {
  if (state === "lan" && !lan.canControl) return;
  if (e.button === 0) engine.mouseDown = false;
  else if (e.button === 2) engine.setAds(false);
  if (state === "lan" && (e.button === 0 || e.button === 2)) lan.sendInput();
});

window.addEventListener("mousemove", (e) => {
  if ((state === "playing" && document.pointerLockElement === glCanvas) || (state === "lan" && lan.canControl)) {
    engine.handleMouseMove(e.movementX, e.movementY);
  }
});

window.addEventListener("wheel", (e) => {
  if (state === "lan" && lan.canControl) {
    engine.cancelGrenadeAim();
    lan.weapon = (lan.weapon + (e.deltaY > 0 ? 1 : 3)) % 4;
    lan.sendInput();
    return;
  }
  if (state !== "playing") return;
  engine.cancelGrenadeAim();
  engine.weapons.cycle(e.deltaY > 0 ? 1 : -1);
});

window.addEventListener("keydown", (e) => {
  if (state !== "playing" && !(state === "lan" && lan.canControl)) return;
  engine.keys[e.code] = true;
  if (state === "lan") {
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    if (e.repeat) return;
    if (/^Digit[1-4]$/.test(e.code)) {
      engine.cancelGrenadeAim();
      lan.weapon = Number(e.code.at(-1)) - 1;
      lan.sendInput();
    } else if (e.code === "KeyR") lan.action("reload");
    else if (e.code === "ShiftLeft" || e.code === "ShiftRight") lan.action("dash");
    else if (e.code === "KeyC") lan.action("slide");
    else if (e.code === "Space") lan.action("jump");
    else if (e.code === "KeyG" || e.code === "KeyQ") {
      if (!engine.grenadeAiming && engine.startGrenadeAim(e.code)) {
        lan.sendInput();
      }
    } else if (e.code === "KeyE" || e.code === "KeyV") lan.action("melee");
    else if (e.code === "KeyM") {
      btnToggleSfx.textContent = engine.audio.toggle() ? "音效: 开启" : "音效: 关闭";
    } else lan.sendInput();
    return;
  }

  if (e.code === "Digit1") { engine.cancelGrenadeAim(); engine.weapons.select(0); }
  else if (e.code === "Digit2") { engine.cancelGrenadeAim(); engine.weapons.select(1); }
  else if (e.code === "Digit3") { engine.cancelGrenadeAim(); engine.weapons.select(2); }
  else if (e.code === "Digit4") { engine.cancelGrenadeAim(); engine.weapons.select(3); }
  else if (e.code === "KeyR") engine.weapons.startReload();
  else if (e.code === "ShiftLeft" || e.code === "ShiftRight") engine.triggerDash();
  else if (e.code === "KeyC") engine.triggerSlide();
  else if (e.code === "Space") {
    e.preventDefault();
    engine.triggerJump();
  } else if (e.code === "KeyG" || e.code === "KeyQ") {
    if (!e.repeat && !engine.grenadeAiming) {
      engine.startGrenadeAim(e.code);
    }
  } else if (e.code === "KeyE" || e.code === "KeyV") {
    engine.triggerMeleePunch();
  } else if (e.code === "KeyM") {
    const on = audio.toggle();
    btnToggleSfx.textContent = on ? "音效: 开启" : "音效: 关闭";
  }
});

window.addEventListener("keyup", (e) => {
  if (engine.grenadeAiming && (e.code === engine.grenadeAimKey || e.code === "KeyG" || e.code === "KeyQ")) {
    engine.keys[e.code] = false;
    if (state === "lan") {
      if (lan.canControl && engine.canThrowGrenade()) {
        engine.cancelGrenadeAim();
        lan.action("grenade");
      } else {
        engine.cancelGrenadeAim();
      }
    } else if (state === "playing") {
      engine.releaseGrenadeAim();
    } else {
      engine.cancelGrenadeAim();
    }
    return;
  }
  if (!engine.keys[e.code]) return;
  engine.keys[e.code] = false;
  if (state === "lan" && lan.canControl) lan.sendInput();
});

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
  hudIssue.textContent = pvp ? "玩家对战" : lvl.issue;
  hudLevelName.textContent = lvl.name;
  hudObjectiveLabel.textContent = pvp ? "击倒目标" : "消灭所有反派:";
  hudEnemiesLeft.textContent = pvp ? String(KILL_LIMIT) : engine.getAliveEnemiesCount();
  hudScore.textContent = String(engine.score).padStart(5, "0");

  if (engine.combo >= 2) {
    hudComboBox.classList.remove("hidden");
    hudCombo.textContent = `x${engine.combo} COMBO!`;
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
  hudHpText.textContent = Math.ceil(displayedHp);

  const dashReady = engine.player.dashCooldown <= 0;
  const dashPct = dashReady ? 100 : Math.max(0, (1 - engine.player.dashCooldown / 1.35) * 100);
  hudDashFill.style.width = `${dashPct}%`;
  hudDashText.textContent = dashReady ? "RDY" : `${engine.player.dashCooldown.toFixed(1)}s`;

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

  hudWeaponName.textContent = w.name;
  hudAmmoCur.textContent = w.ammo;
  hudAmmoRes.textContent = w.reserve === Infinity ? "∞" : Math.round(displayedAmmoRes);

  const gCount = Math.max(0, engine.player.grenades || 0);
  hudGrenadeCount.textContent = `x${gCount}`;
  hudGrenadeBox.classList.toggle("empty", gCount === 0);
  hudGrenadeBox.classList.toggle("aiming", engine.grenadeAiming);
  if (hudGrenadeKey) {
    hudGrenadeKey.textContent = engine.grenadeAiming ? "松开投掷 · 右键取消" : "[G] 手雷";
  }

  const isReloading = engine.weapons.reloading && engine.weapons.reloadTimer > 0;
  hudReloadHint.classList.toggle("hidden", !isReloading);
  reloadHud.classList.toggle("hidden", !isReloading);
  if (isReloading) {
    const leftSec = Math.max(0, engine.weapons.reloadTimer);
    const pct = Math.min(100, Math.max(0, (1 - leftSec / w.reloadTime) * 100));
    hudReloadHint.textContent = `RELOADING ${leftSec.toFixed(1)}s`;
    reloadHudText.textContent = `换弹中 ${leftSec.toFixed(1)}s`;
    reloadFill.style.width = `${pct}%`;
  }

  weaponSlots.forEach((slot, idx) => {
    const unlocked = engine.weapons.isUnlocked(idx);
    slot.classList.toggle("active", idx === engine.weapons.currentIdx);
    slot.classList.toggle("locked", !unlocked);
    slot.textContent = unlocked ? WEAPON_SLOT_LABELS[idx] : `${idx + 1}. 🔒 LOCKED`;
  });

  assets.drawPortrait(portraitCtx, engine.player.hp, engine.player.hurtTimer, engine.player.fireTimer);
  engine.drawMinimap(miniCtx);
}

let lastTime = performance.now();
let menuOrbitAngle = 0.4;
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

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
    // 3A 主界面实时 3D 航拍运镜：隐藏手部武器，实时运行移动平台/激光/道具旋转
    if (engine.weapons.root) engine.weapons.root.visible = false;
    menuOrbitAngle += dt * 0.16;
    engine.levelTime += dt;
    engine._updateDynamics(dt, [], false);
    engine._updateProps(dt, false);

    const cx = (engine.mapW * CELL_SIZE) / 2;
    const cz = (engine.mapH * CELL_SIZE) / 2;
    const rx = Math.max(8, engine.mapW * CELL_SIZE * 0.28);
    const rz = Math.max(8, engine.mapH * CELL_SIZE * 0.28);
    engine.camera.position.set(
      cx + Math.cos(menuOrbitAngle) * rx,
      7.2 + Math.sin(menuOrbitAngle * 1.5) * 1.1,
      cz + Math.sin(menuOrbitAngle) * rz
    );
    engine.camera.lookAt(cx, 1.8, cz);
    engine.render();
  } else {
    engine.render();
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
