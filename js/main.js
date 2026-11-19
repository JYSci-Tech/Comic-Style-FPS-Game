import { ComicAudio } from "./audio.js";
import { ComicAssets } from "./textures.js";
import { COMIC_LEVELS } from "./levels.js";
import { ComicFPS3DEngine } from "./engine.js";
import { LanClient } from "./lan.js";
import { KILL_LIMIT } from "./lan-rules.js";

const SAVE_KEY = "ink_and_iron_checkpoint_v1";

const glCanvas = document.getElementById("game-canvas");
const fxCanvas = document.getElementById("fx-canvas");
const miniCanvas = document.getElementById("minimap-canvas");
const miniCtx = miniCanvas.getContext("2d");
const portraitCanvas = document.getElementById("portrait-canvas");
const portraitCtx = portraitCanvas.getContext("2d");

const hud = document.getElementById("hud");
const startScreen = document.getElementById("start-screen");
const pauseScreen = document.getElementById("pause-screen");
const interScreen = document.getElementById("intermission-screen");
const endScreen = document.getElementById("end-screen");
const damageFlash = document.getElementById("damage-flash");
const crosshair = document.getElementById("crosshair");
const hitmarker = document.getElementById("hitmarker");
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
const hudDashFill = document.getElementById("hud-dash-fill");
const hudDashText = document.getElementById("hud-dash-text");
const hudWeaponName = document.getElementById("hud-weapon-name");
const hudAmmoCur = document.getElementById("hud-ammo-cur");
const hudAmmoRes = document.getElementById("hud-ammo-res");
const hudReloadHint = document.getElementById("hud-reload-hint");
const weaponSlots = Array.from(document.querySelectorAll(".w-slot"));

const btnContinue = document.getElementById("btn-continue");
const btnStart = document.getElementById("btn-start");
const btnToggleSfx = document.getElementById("btn-toggle-sfx");
const btnResume = document.getElementById("btn-resume");
const btnRetryPause = document.getElementById("btn-retry-pause");
const btnRestartPause = document.getElementById("btn-restart-pause");
const btnNextIssue = document.getElementById("btn-next-issue");
const btnRetryLevel = document.getElementById("btn-retry-level");
const btnRestart = document.getElementById("btn-restart");

const audio = new ComicAudio();
const assets = new ComicAssets();

let state = "menu"; // menu | playing | paused | intermission | gameover | victory | lan
let hitmarkerTimer = 0;
let killPanelTimeout = null;
let currentCheckpoint = null;

const engine = new ComicFPS3DEngine(glCanvas, fxCanvas, assets, audio, {
  onHit(isCrit) {
    hitmarker.classList.add("active");
    hitmarker.classList.toggle("crit", !!isCrit);
    hitmarkerTimer = 0.14;
  },
  onPlayerHurt() {
    damageFlash.style.opacity = "1";
    setTimeout(() => {
      damageFlash.style.opacity = "0";
    }, 150);
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
    shotgunReserve: Math.max(18, ws[1].reserve),
    raygunReserve: Math.max(48, ws[2].reserve),
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

function applyCheckpoint(cp) {
  const idx = cp ? cp.levelIdx : 0;
  engine.loadLevel(idx, false);
  if (cp) {
    engine.score = cp.score || 0;
    engine.kills = cp.kills || 0;
    engine.player.hp = engine.player.maxHp; // 重开本关满血复活，避免低血死循环
    engine.weapons.weapons[1].reserve = Math.max(18, cp.shotgunReserve ?? 24);
    engine.weapons.weapons[2].reserve = Math.max(48, cp.raygunReserve ?? 72);
  }
  currentCheckpoint = buildCheckpointData(idx);
}

function refreshCoverSaveUI() {
  const saved = readSavedCheckpoint();
  if (saved && saved.levelIdx > 0) {
    const lvl = COMIC_LEVELS[saved.levelIdx];
    btnContinue.textContent = `继续存档 · ${lvl.issue} (${lvl.name})`;
    btnContinue.classList.remove("hidden");
    btnStart.textContent = "从第 1 期新开";
    btnStart.classList.remove("primary");
    btnStart.classList.add("secondary");
  } else {
    btnContinue.classList.add("hidden");
    btnStart.textContent = "翻开第 1 期 · 开始战斗!";
    btnStart.classList.add("primary");
    btnStart.classList.remove("secondary");
  }
}

// 初始加载（若有存档则以存档关卡作为封面背景）
const initialSave = readSavedCheckpoint();
engine.loadLevel(initialSave ? initialSave.levelIdx : 0, false);
refreshCoverSaveUI();

const lan = new LanClient(engine, {
  onOpen() {
    state = "lan";
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
  startScreen.classList.add("hidden");
  pauseScreen.classList.add("hidden");
  interScreen.classList.add("hidden");
  endScreen.classList.add("hidden");
}

function startNewGame() {
  audio.init();
  engine.loadLevel(0, false);
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
  hideAllScreens();
  hud.classList.remove("hidden");
  state = "playing";
  lockPointer();
}

function retryCurrentLevel() {
  audio.init();
  const cp = currentCheckpoint || readSavedCheckpoint() || { levelIdx: engine.levelIdx, score: 0, kills: 0 };
  cp.levelIdx = engine.levelIdx;
  applyCheckpoint(cp);
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
  engine.keys = {};
  btnRetryPause.textContent = `重开本关 (${engine.level.issue})`;
  pauseScreen.classList.remove("hidden");
}

function showIntermission() {
  state = "intermission";
  engine.mouseDown = false;
  engine.setAds(false);
  engine.keys = {};
  const lvl = engine.level;
  document.getElementById("inter-tag").textContent = `${lvl.issue} CLEARED! · 已自动存档`;
  document.getElementById("inter-title").textContent = lvl.intermissionTitle;
  document.getElementById("inter-desc").textContent = lvl.intermissionDesc;
  document.getElementById("inter-stats").innerHTML = `
    当前得分: ${engine.score}<br/>
    累计击倒反派: ${engine.kills}<br/>
    已保存下一期检查点，进入下一期自动恢复 +35 HP
  `;
  interScreen.classList.remove("hidden");
}

function nextIssue() {
  const nextIdx = engine.levelIdx + 1;
  engine.loadLevel(nextIdx, true);
  saveCheckpoint(nextIdx);
  hideAllScreens();
  hud.classList.remove("hidden");
  state = "playing";
  lockPointer();
}

function showEndScreen(victory) {
  state = victory ? "victory" : "gameover";
  engine.mouseDown = false;
  engine.setAds(false);
  engine.keys = {};
  hud.classList.add("hidden");

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
  endScreen.classList.remove("hidden");
}

btnContinue.addEventListener("click", continueSavedGame);
btnStart.addEventListener("click", startNewGame);
btnResume.addEventListener("click", resumeGame);
btnRetryPause.addEventListener("click", retryCurrentLevel);
btnRestartPause.addEventListener("click", startNewGame);
btnNextIssue.addEventListener("click", nextIssue);
btnRetryLevel.addEventListener("click", retryCurrentLevel);
btnRestart.addEventListener("click", startNewGame);

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
  if (!locked && state === "playing") {
    pauseGame();
  }
});
document.addEventListener("pointerlockerror", () => lan.pointerError());
window.addEventListener("blur", () => {
  if (state === "lan" && lan.match) lan.releaseInput();
});

glCanvas.addEventListener("contextmenu", (e) => e.preventDefault());

glCanvas.addEventListener("mousedown", (e) => {
  if (state === "lan") {
    if (!lan.canControl) return;
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
    lan.weapon = (lan.weapon + (e.deltaY > 0 ? 1 : 2)) % 3;
    lan.sendInput();
    return;
  }
  if (state !== "playing") return;
  engine.weapons.cycle(e.deltaY > 0 ? 1 : -1);
});

window.addEventListener("keydown", (e) => {
  if (state !== "playing" && !(state === "lan" && lan.canControl)) return;
  engine.keys[e.code] = true;
  if (state === "lan") {
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    if (e.repeat) return;
    if (/^Digit[1-3]$/.test(e.code)) {
      lan.weapon = Number(e.code.at(-1)) - 1;
      lan.sendInput();
    } else if (e.code === "KeyR") lan.action("reload");
    else if (e.code === "ShiftLeft" || e.code === "ShiftRight") lan.action("dash");
    else if (e.code === "Space") lan.action("jump");
    else if (e.code === "KeyE" || e.code === "KeyV") lan.action("melee");
    else if (e.code === "KeyM") {
      btnToggleSfx.textContent = engine.audio.toggle() ? "音效: 开启" : "音效: 关闭";
    } else lan.sendInput();
    return;
  }

  if (e.code === "Digit1") engine.weapons.select(0);
  else if (e.code === "Digit2") engine.weapons.select(1);
  else if (e.code === "Digit3") engine.weapons.select(2);
  else if (e.code === "KeyR") engine.weapons.startReload();
  else if (e.code === "ShiftLeft" || e.code === "ShiftRight") engine.triggerDash();
  else if (e.code === "Space") {
    e.preventDefault();
    engine.triggerJump();
  } else if (e.code === "KeyE" || e.code === "KeyV") {
    engine.triggerMeleePunch();
  } else if (e.code === "KeyM") {
    const on = audio.toggle();
    btnToggleSfx.textContent = on ? "音效: 开启" : "音效: 关闭";
  }
});

window.addEventListener("keyup", (e) => {
  if (!engine.keys[e.code]) return;
  engine.keys[e.code] = false;
  if (state === "lan" && lan.canControl) lan.sendInput();
});

function updateHUD(dt) {
  if (hitmarkerTimer > 0) {
    hitmarkerTimer -= dt;
    if (hitmarkerTimer <= 0) {
      hitmarker.classList.remove("active", "crit");
    }
  }

  crosshair.classList.toggle("ads", engine.weapons.isAds);

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

  const hpPct = Math.max(0, (engine.player.hp / engine.player.maxHp) * 100);
  hudHpFill.style.width = `${hpPct}%`;
  hudHpText.textContent = Math.ceil(engine.player.hp);

  const dashReady = engine.player.dashCooldown <= 0;
  const dashPct = dashReady ? 100 : Math.max(0, (1 - engine.player.dashCooldown / 1.35) * 100);
  hudDashFill.style.width = `${dashPct}%`;
  hudDashText.textContent = dashReady ? "RDY" : `${engine.player.dashCooldown.toFixed(1)}s`;

  const w = engine.weapons.current;
  hudWeaponName.textContent = w.name;
  hudAmmoCur.textContent = w.ammo;
  hudAmmoRes.textContent = w.reserve === Infinity ? "∞" : w.reserve;
  hudReloadHint.classList.toggle("hidden", !engine.weapons.reloading);

  weaponSlots.forEach((slot, idx) => {
    slot.classList.toggle("active", idx === engine.weapons.currentIdx);
  });

  assets.drawPortrait(portraitCtx, engine.player.hp, engine.player.hurtTimer, engine.player.fireTimer);
  engine.drawMinimap(miniCtx);
}

let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (state === "playing") {
    engine.update(dt);
    engine.render();
    updateHUD(dt);
  } else if (state === "lan" && lan.match) {
    lan.update(dt);
    engine.render();
    updateHUD(dt);
    lan.view.drawLabels(miniCtx);
  } else if (state === "menu" || state === "lan") {
    engine.player.yaw -= dt * 0.25;
    engine._syncCamera();
    engine.render();
  } else {
    engine.render();
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
