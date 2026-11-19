import * as THREE from "three";
import { ComicFPS3DEngine, createPlayer } from "./js/engine.js";
import { WeaponSystem3D } from "./js/weapons.js";
import { CELL_SIZE, COMIC_LEVELS } from "./js/levels.js";
import { createLanAvatar, PLAYER_COLORS } from "./js/lan-avatar.js";
import { ACTIONS, INPUT_KEYS, KILL_LIMIT } from "./js/lan-rules.js";

const NO_INPUT = { keys: {}, fire: false, ads: false };
const ARENA_SPAWNS = [[2.5, 2.5], [12.5, 9.5], [11.5, 1.5], [2.5, 8.5]];
const silent = {};
for (const name of ["Jump", "Dash", "Punch", "Reload", "DryFire", "Magnum", "Shotgun", "Raygun",
  "Hit", "EnemyDown", "Explosion", "Hurt", "Pickup", "EnemyShot"]) {
  silent["play" + name] = () => {};
}
const texture = new THREE.Texture();
const assets = {
  textures: { asphalt: texture, factoryFloor: texture, labFloor: texture, barrel: texture },
  wallMaterials: { 1: new THREE.MeshBasicMaterial() },
  toonMat: ({ color = 0xffffff }) => new THREE.MeshBasicMaterial({ color }),
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
      onPopup: (at, text, color, scale) => this.events.push({ type: "popup", at: at.toArray(), text, color, scale }),
      onExplosion: (at) => this.events.push({ type: "explosion", at: at.toArray() }),
      onHit: (crit) => this.markHit(crit),
      onPickup: (player) => this.events.push({ type: "pickup", id: player.id }),
      onBounce: (player) => this.events.push({ type: "jump", id: player.id }),
      onKillPanel: (words) => this.events.push({ type: "panel", id: this.actor?.id, words }),
      onPlayerHit: (player, damage) => this.engine._damagePlayer(damage, player),
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
    Object.assign(player, createPlayer());
    player.life = (player.life || 0) + 1;
    player.input = NO_INPUT;
    player.lastInput = 0;
    player.actions = new Set();
    player.respawn = 0;
    player.protection = respawn ? 1.2 : 0;
    if (!keepStats || !previousHp) player.weapons = new WeaponSystem3D(null, assets, silent);
    if (keepStats && previousHp) player.hp = Math.min(player.maxHp, previousHp + 35);
    player.weapons.isAds = false;

    const level = COMIC_LEVELS[this.level];
    let { x, z, yaw } = level.playerStart;
    if (this.mode === "pvp") {
      let spawn = ARENA_SPAWNS[player.slot];
      if (respawn) {
        const opponents = this.players.filter((other) => other !== player && other.hp > 0);
        const distance = ([px, pz]) => Math.min(...opponents.map((other) =>
          Math.hypot(px * CELL_SIZE - other.pos.x, pz * CELL_SIZE - other.pos.z)));
        spawn = ARENA_SPAWNS.reduce((best, point) => distance(point) > distance(best) ? point : best, spawn);
      }
      [x, z] = spawn;
      yaw = Math.atan2(x - level.map[0].length / 2, z - level.map.length / 2);
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
      weapon: Number.isInteger(message.weapon) && message.weapon >= 0 && message.weapon < 3 ? message.weapon : undefined,
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
    player.avatar.root.rotation.y = player.yaw;
    player.avatar.root.visible = player.hp > 0;
    const swing = Math.sin(player.bobPhase) * 0.48;
    player.avatar.leftLeg.rotation.x = swing;
    player.avatar.rightLeg.rotation.x = -swing;
  }

  selectPlayer(player) {
    this.actor = player;
    this.engine.player = player;
    this.engine.weapons = player.weapons;
    this.engine.keys = player.input.keys;
  }

  markHit(crit) {
    if (this.actor) this.events.push({ type: "hit", id: this.actor.id, crit });
  }

  onDeath(player) {
    player.deaths += 1;
    player.respawn = this.mode === "pvp" ? 3 : 6;
    player.input = NO_INPUT;
    player.actions.clear();
    this.syncAvatar(player);
    const killer = this.actor;
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
          && engine._hasLineOfSight(origin, target) && engine._damagePlayer(65, rival)) this.markHit(true);
      }
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
    if (this.mode === "coop") {
      engine._updateEnemies(dt, this.players);
      engine._updateProjectiles(dt, this.players);
      if (this.players.every((player) => player.hp <= 0)) this.phase = "failed";
      else if (!engine.getAliveEnemiesCount()) this.phase = this.level === COMIC_LEVELS.length - 1 ? "finished" : "cleared";
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
      players: this.players.map((player) => ({
        id: player.id, life: player.life, p: player.pos.toArray(), yaw: player.yaw, pitch: player.pitch,
        hp: player.hp, onGround: player.onGround, invulnerable: player.protection > 0,
        dash: player.dashCooldown, dashing: player.dashTimer > 0, respawn: player.respawn,
        kills: player.kills, deaths: player.deaths, weapon: player.weapons.currentIdx,
        ammo: player.weapons.weapons.map((weapon) => [weapon.ammo, Number.isFinite(weapon.reserve) ? weapon.reserve : null]),
        reload: player.weapons.reloading ? player.weapons.reloadTimer : 0,
      })),
      enemies: this.engine.enemies.map((enemy) => [
        ...enemy.root.position.toArray(), enemy.root.rotation.y, Math.max(0, enemy.hp), enemy.deathAnim, enemy.animPhase,
      ]),
      props: this.engine.props.map((prop) => prop.active),
      projectiles: this.engine.enemyProjectiles.map(({ id, mesh, type, color }) => [id, type, color, ...mesh.position.toArray()]),
      events: this.events.splice(0),
    };
  }
}
