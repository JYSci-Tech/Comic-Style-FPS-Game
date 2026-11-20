import * as THREE from "three";
import { ComicFPS3DEngine, createPlayer } from "./js/engine.js";
import { WeaponSystem3D } from "./js/weapons.js";
import { CELL_SIZE, COMIC_LEVELS } from "./js/levels.js";
import { createLanAvatar, PLAYER_COLORS } from "./js/lan-avatar.js";
import { ACTIONS, INPUT_KEYS, KILL_LIMIT } from "./js/lan-rules.js";

const NO_INPUT = { keys: {}, fire: false, ads: false };
const ARENA_SPAWNS = [[2.5, 2.5], [12.5, 9.5], [11.5, 1.5], [2.5, 8.5]];
const silent = {};
for (const name of ["Jump", "Dash", "Slide", "Punch", "Reload", "DryFire", "Magnum", "Shotgun", "Raygun", "Sniper",
  "Throw", "Hit", "EnemyDown", "Explosion", "Hurt", "Pickup", "EnemyShot"]) {
  silent["play" + name] = () => {};
}
const texture = new THREE.Texture();
const assets = {
  textures: {
    asphalt: texture,
    streetFloor: texture,
    factoryFloor: texture,
    labFloor: texture,
    barrel: texture,
    comicShop: texture,
    apartment: texture,
    graffiti: texture,
  },
  wallMaterials: { 1: new THREE.MeshBasicMaterial() },
  toonMat: ({ color = 0xffffff }) => new THREE.MeshBasicMaterial({ color }),
  createStreetNetworkTexture: () => texture,
  addOutline() {},
  addCreaseLines() {},
};

export class LanMatch {
  constructor(mode, players) {
    this.mode = mode;
    this.players = players;
    this.events = [];
    this.round = 0;
    this.engine = new ComicFPS3DEngine(null, null, assets, silent, {
      onShot: (weapon) => {
        const player = this.actor;
        this.shot = { type: "shot", id: player.id, weapon, start: this.engine.camera.position.toArray(), ends: [] };
        this.events.push(this.shot);
      },
      onTracer: (end) => this.shot.ends.push(end.toArray()),
      onPopup: (at, text, color, scale, kind = "bubble") =>
        this.events.push({ type: "popup", at: at.toArray(), text, color, scale, kind }),
      onExplosion: (at) => this.events.push({ type: "explosion", at: at.toArray() }),
      onHit: (crit, owner) => this.markHit(crit, owner),
      onPickup: (player) => this.events.push({ type: "pickup", id: player.id }),
      onBounce: (player) => this.events.push({ type: "jump", id: player.id }),
      onKillPanel: (words) => this.events.push({ type: "panel", id: this.actor?.id, words }),
      onPlayerHit: (player, damage, attacker) => {
        const prev = this.actor;
        if (attacker) this.actor = attacker;
        const ok = this.engine._damagePlayer(damage, player);
        this.actor = prev;
        return ok;
      },
      onPlayerHurt: (player) => this.events.push({ type: "hurt", id: player.id }),
      onGameOver: (player) => this.onDeath(player),
    });
  }

  start(level = 0, keepStats = false) {
    this.level = level;
    this.phase = "playing";
    this.round += 1;
    this.winner = null;
    this.events.length = 0;
    this.engine.player = createPlayer();
    this.engine.weapons = new WeaponSystem3D(null, assets, silent);
    this.engine.loadLevel(level, keepStats, this.mode === "pvp");
    for (const player of this.players) {
      if (!keepStats) {
        player.kills = 0;
        player.deaths = 0;
      }
      player.avatar = createLanAvatar(assets, PLAYER_COLORS[player.slot]);
      this.engine.levelRoot.add(player.avatar.root);
      for (const mesh of player.avatar.hitboxes) {
        mesh.userData = { kind: "player", player, isHead: mesh === player.avatar.head };
      }
      this.spawn(player, false, keepStats);
    }
  }

  spawn(player, respawn, keepStats = false) {
    const previousHp = player.hp || 0;
    const previousWeapon = player.weapons ? player.weapons.currentIdx : 0;
    const previousGrenades = typeof player.grenades === "number" ? player.grenades : 1;
    Object.assign(player, createPlayer());
    player.life = (player.life || 0) + 1;
    player.input = NO_INPUT;
    player.lastInput = 0;
    player.actions = new Set();
    player.respawn = 0;
    player.respawnTotal = 0;
    player.lastKiller = null;
    player.protection = respawn ? 1.2 : 0;
    if (!keepStats || !previousHp) player.weapons = new WeaponSystem3D(null, assets, silent);
    if (keepStats && previousHp) player.hp = Math.min(player.maxHp, previousHp + 35);
    if (keepStats) player.grenades = previousGrenades + 2;
    else if (respawn) player.grenades = this.mode === "pvp" ? Math.max(1, previousGrenades) : previousGrenades;
    else player.grenades = 1;
    if (respawn || keepStats) {
      player.weapons.select(previousWeapon);
      player.weapons.switchAnim = 0;
      player.weapons.cooldown = 0;
    }
    player.weapons.isAds = false;

    const level = COMIC_LEVELS[this.level];
    let { x, z, yaw } = level.playerStart;
    if (this.mode === "pvp") {
      const mapW = level.map[0].length;
      const mapH = level.map.length;
      const arenaSpawns = [
        [2.5, 2.5],
        [mapW - 2.5, mapH - 2.5],
        [mapW - 2.5, 1.5],
        [2.5, mapH - 2.5],
      ].map(([sx, sz]) => {
        const safe = this.engine._safeWorldPos(sx, sz);
        return [safe.x / CELL_SIZE, safe.z / CELL_SIZE];
      });
      let spawn = arenaSpawns[player.slot % arenaSpawns.length];
      if (respawn) {
        const opponents = this.players.filter((other) => other !== player && other.hp > 0);
        const distance = ([px, pz]) => Math.min(...opponents.map((other) =>
          Math.hypot(px * CELL_SIZE - other.pos.x, pz * CELL_SIZE - other.pos.z)));
        spawn = arenaSpawns.reduce((best, point) => distance(point) > distance(best) ? point : best, spawn);
      }
      [x, z] = spawn;
      yaw = Math.atan2(x - mapW / 2, z - mapH / 2);
    } else {
      const offsets = [[0, 0], [0.75, 0], [0, -0.75], [-0.75, 0]];
      const [dx, dz] = offsets[player.slot];
      const desired = this.engine._safeWorldPos(x + dx, z + dz);
      x = desired.x / CELL_SIZE;
      z = desired.z / CELL_SIZE;
    }
    player.pos.set(x * CELL_SIZE, 0, z * CELL_SIZE);
    player.yaw = yaw;
    this.syncAvatar(player);
  }

  remove(player) {
    if (player.avatar) {
      this.engine.levelRoot.remove(player.avatar.root);
      player.avatar.root.traverse((part) => {
        part.geometry?.dispose();
        part.material?.dispose();
      });
      player.avatar = null;
    }
  }

  input(player, message, now) {
    if (this.phase !== "playing" || player.hp <= 0 || message.round !== this.round || message.life !== player.life) return;
    if (!Number.isFinite(message.yaw) || !Number.isFinite(message.pitch) || !Number.isInteger(message.keys)) return;
    const bits = message.keys;
    player.input = {
      keys: Object.fromEntries(INPUT_KEYS.map((key, index) => [key, Boolean(bits & (1 << index))])),
      yaw: message.yaw % (Math.PI * 2),
      pitch: THREE.MathUtils.clamp(message.pitch, -1.35, 1.35),
      weapon: Number.isInteger(message.weapon) && message.weapon >= 0 && message.weapon < 4 ? message.weapon : undefined,
      fire: message.fire === true,
      ads: message.ads === true,
    };
    player.lastInput = now;
    if (Array.isArray(message.actions)) {
      for (const action of ACTIONS) if (message.actions.includes(action)) player.actions.add(action);
    }
  }

  syncAvatar(player) {
    player.avatar.root.position.copy(player.pos);
    player.avatar.root.position.y -= (player.slideAmount || 0) * 0.45;
    player.avatar.root.rotation.y = player.yaw;
    player.avatar.root.rotation.x = (player.slideAmount || 0) * 0.55;
    player.avatar.root.visible = player.hp > 0;
    const swing = player.slideTimer > 0 ? 0 : Math.sin(player.bobPhase) * 0.48;
    player.avatar.leftLeg.rotation.x = swing;
    player.avatar.rightLeg.rotation.x = -swing;
  }

  selectPlayer(player) {
    this.actor = player;
    this.engine.player = player;
    this.engine.weapons = player.weapons;
    this.engine.keys = player.input.keys;
  }

  markHit(crit, owner = this.actor) {
    if (owner) this.events.push({ type: "hit", id: owner.id, crit });
  }

  onDeath(player) {
    player.deaths += 1;
    player.respawnTotal = this.mode === "pvp" ? 3 : 6;
    player.respawn = player.respawnTotal;
    player.input = NO_INPUT;
    player.actions.clear();
    this.syncAvatar(player);
    const killer = this.actor;
    player.lastKiller = (this.mode === "pvp" && killer && killer !== player) ? killer.id : null;
    this.events.push({ type: "death", id: player.id, killer: player.lastKiller });
    if (this.mode === "pvp" && killer && killer !== player) {
      killer.kills += 1;
      if (killer.kills >= KILL_LIMIT) {
        this.winner = killer.id;
        this.phase = "finished";
      }
    }
  }

  attack(player) {
    const engine = this.engine;
    this.selectPlayer(player);
    engine._syncCamera();
    const rivals = this.mode === "pvp" ? this.players.filter((other) => other !== player && other.hp > 0) : [];
    if (player.actions.has("melee") && engine.triggerMeleePunch()) {
      this.events.push({ type: "melee", id: player.id });
      const origin = engine.camera.position;
      const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      for (const rival of rivals) {
        const target = rival.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
        const offset = target.clone().sub(origin);
        if (offset.lengthSq() < 3.6 ** 2 && offset.setY(0).normalize().dot(forward) > 0.45
          && engine._hasLineOfSight(origin, target) && engine._damagePlayer(65, rival)) {
          this.markHit(true);
          engine.spawnPopup(target.clone().add(new THREE.Vector3(0, 0.35, 0)), "-65 ★", "#ffe01b", 1.15, "headshot");
        }
      }
    }
    if (this.phase === "playing" && player.hp > 0 && player.actions.has("grenade") && engine.throwGrenade(player)) {
      this.events.push({ type: "throw", id: player.id });
    }
    if (this.phase === "playing" && player.hp > 0 && (player.actions.has("fire")
      || (player.input.fire && player.weapons.current.auto))) {
      engine.camera.fov = player.weapons.isAds ? player.weapons.current.adsFov : engine.baseFov;
      engine.camera.updateProjectionMatrix();
      engine.levelRoot.updateMatrixWorld(true);
      const targets = engine.hitTargets.concat(rivals.filter((rival) => rival.hp > 0).flatMap((rival) => rival.avatar.hitboxes));
      engine.fireWeapon(targets);
    }
    player.actions.clear();
  }

  update(dt, now) {
    if (this.phase !== "playing") return;
    const engine = this.engine;
    engine.levelTime += dt;
    engine._updateDynamics(dt, this.players, true);
    engine._updateCombo(dt);
    engine.damageablePlayers = this.players;
    for (const player of this.players) {
      if (player.hp <= 0) {
        player.respawn = Math.max(0, player.respawn - dt);
        if (player.respawn === 0) this.spawn(player, true);
        continue;
      }
      if (now - player.lastInput > 500) player.input = NO_INPUT;
      this.selectPlayer(player);
      const { yaw, pitch, weapon, ads } = player.input;
      if (yaw !== undefined) {
        player.yaw = yaw;
        player.pitch = pitch;
      }
      engine.setAds(ads);
      if (weapon !== undefined) player.weapons.select(weapon);
      if (player.actions.has("reload")) player.weapons.startReload();
      if (player.actions.has("jump") && engine.triggerJump()) this.events.push({ type: "jump", id: player.id });
      if (player.actions.has("dash") && engine.triggerDash()) this.events.push({ type: "dash", id: player.id });
      if (player.actions.has("slide") && engine.triggerSlide()) this.events.push({ type: "slide", id: player.id });
      player.protection = Math.max(0, player.protection - dt);
      engine._updatePlayer(dt);
      engine._updateProps(dt);
      this.syncAvatar(player);
    }

    for (const player of this.players) {
      if (this.phase !== "playing") break;
      if (player.hp > 0) this.attack(player);
    }
    this.actor = null;
    engine._updateGrenades(dt, this.players);
    if (this.mode === "coop") {
      engine._updateEnemies(dt, this.players);
      engine._updateProjectiles(dt, this.players);
      if (this.players.every((player) => player.hp <= 0)) this.phase = "failed";
      else if (!engine.getAliveEnemiesCount()) this.phase = this.level === COMIC_LEVELS.length - 1 ? "finished" : "cleared";
    } else if (this.mode === "pvp") {
      this._updatePvpPropRespawns(dt);
    }
  }

  _pickRandomOpenCell(props) {
    const engine = this.engine;
    const candidates = [];
    for (let z = 1; z < engine.mapH - 1; z++) {
      for (let x = 1; x < engine.mapW - 1; x++) {
        if (engine.map[z][x] !== 0) continue;
        const wx = (x + 0.5) * CELL_SIZE;
        const wz = (z + 0.5) * CELL_SIZE;
        const nearProp = props.some((p) => p.active && Math.hypot(p.x - wx, p.z - wz) < CELL_SIZE * 1.1);
        if (nearProp) continue;
        const nearPlayer = this.players.some((pl) => pl.hp > 0 && Math.hypot(pl.pos.x - wx, pl.pos.z - wz) < CELL_SIZE * 1.4);
        if (nearPlayer) continue;
        candidates.push({ x: wx, z: wz });
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  _updatePvpPropRespawns(dt) {
    const engine = this.engine;
    for (const pr of engine.props) {
      if (pr.type === "jumppad" || pr.type === "boostpad") continue;
      if (pr.active) {
        pr.respawnTimer = 0;
        continue;
      }
      if (!pr.respawnTimer) {
        pr.respawnTimer = pr.type === "barrel" ? 13 + Math.random() * 5 : 8 + Math.random() * 4;
      } else {
        pr.respawnTimer -= dt;
        if (pr.respawnTimer <= 0) {
          const spot = this._pickRandomOpenCell(engine.props);
          if (spot) {
            pr.x = spot.x;
            pr.z = spot.z;
            const baseY = pr.type === "barrel" ? 0.725 : pr.type === "medkit" ? 0.55 : 0.52;
            pr.mesh.position.set(spot.x, baseY, spot.z);
            pr.active = true;
            pr.respawnTimer = 0;
            engine.levelRoot.add(pr.mesh);
            if (pr.type === "barrel" && !engine.hitTargets.includes(pr.mesh)) {
              engine.hitTargets.push(pr.mesh);
            }
            const label = pr.type === "medkit" ? "+HP 刷新!" : pr.type === "ammo" ? "弹药刷新!" : "TNT 刷新!";
            const color = pr.type === "medkit" ? "#38e54d" : pr.type === "ammo" ? "#ffe01b" : "#ff7a00";
            engine.spawnPopup(new THREE.Vector3(spot.x, 1.5, spot.z), label, color, 0.9);
          } else {
            pr.respawnTimer = 2;
          }
        }
      }
    }
  }

  snapshot() {
    return {
      type: "snapshot",
      mode: this.mode,
      level: this.level,
      round: this.round,
      phase: this.phase,
      winner: this.winner,
      score: this.engine.score,
      kills: this.engine.kills,
      combo: this.engine.combo,
      t: this.engine.levelTime,
      players: this.players.map((player) => ({
        id: player.id, life: player.life, p: player.pos.toArray(), yaw: player.yaw, pitch: player.pitch,
        hp: player.hp, onGround: player.onGround, invulnerable: player.protection > 0,
        dash: player.dashCooldown, dashing: player.dashTimer > 0, sliding: player.slideTimer > 0,
        respawn: player.respawn, respawnTotal: player.respawnTotal || (this.mode === "pvp" ? 3 : 6),
        lastKiller: player.lastKiller || null,
        grenades: player.grenades,
        kills: player.kills, deaths: player.deaths, weapon: player.weapons.currentIdx,
        ammo: player.weapons.weapons.map((weapon) => [weapon.ammo, Number.isFinite(weapon.reserve) ? weapon.reserve : null]),
        reload: player.weapons.reloading ? player.weapons.reloadTimer : 0,
      })),
      enemies: this.engine.enemies.map((enemy) => [
        ...enemy.root.position.toArray(), enemy.root.rotation.y, Math.max(0, enemy.hp), enemy.deathAnim, enemy.animPhase,
      ]),
      props: this.engine.props.map((prop) => [prop.active, prop.x, prop.z]),
      projectiles: this.engine.enemyProjectiles.map(({ id, mesh, type, color }) => [id, type, color, ...mesh.position.toArray()]),
      grenades: this.engine.grenades.map(({ id, mesh, fuse }) => [id, ...mesh.position.toArray(), fuse]),
      events: this.events.splice(0),
    };
  }
}
