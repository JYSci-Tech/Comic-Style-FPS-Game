import * as THREE from "three";
import { createLanAvatar, PLAYER_COLORS } from "./lan-avatar.js";
import { CELL_SIZE } from "./levels.js";

export class LanView {
  constructor(engine) {
    this.engine = engine;
    this.avatars = new Map();
    this.projectiles = new Map();
    this.grenades = new Map();
    this.localPosition = new THREE.Vector3();
    this.delta = new THREE.Vector3();
    this.deathTilt = 0;
  }

  clear() {
    this.deathTilt = 0;
    if (this.engine.weapons?.root) this.engine.weapons.root.visible = true;
    for (const { root } of this.avatars.values()) {
      for (const mesh of [...root.children]) this.removeMesh(mesh);
      root.removeFromParent();
    }
    for (const { mesh } of this.projectiles.values()) this.removeMesh(mesh);
    for (const { mesh } of this.grenades.values()) mesh.removeFromParent();
    this.avatars.clear();
    this.projectiles.clear();
    this.grenades.clear();
  }

  removeMesh(mesh) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  apply(snapshot, room, id, changedRound, changedLife) {
    const engine = this.engine;
    const player = snapshot.players.find((member) => member.id === id);
    if (changedRound) {
      this.clear();
      engine.loadLevel(snapshot.level, false, snapshot.mode === "pvp");
    }
    if (changedLife) {
      engine.player.pos.fromArray(player.p);
      engine.player.yaw = player.yaw;
      engine.player.pitch = player.pitch;
      engine.player.fireTimer = 0;
      engine.player.hurtTimer = 0;
      engine.shake = 0;
      this.deathTilt = 0;
      if (engine.weapons.root) engine.weapons.root.visible = true;
      engine.weapons.resetAll();
      engine.weapons.select(player.weapon);
      engine.weapons.switchAnim = 0;
      engine.weapons.cooldown = 0;
    }
    this.localPosition.fromArray(player.p);
    engine.player.hp = player.hp;
    engine.player.grenades = player.grenades ?? 1;
    engine.player.onGround = player.onGround;
    engine.player.dashCooldown = player.dash;
    engine.score = snapshot.mode === "pvp" ? player.kills : snapshot.score;
    engine.kills = snapshot.kills;
    engine.combo = snapshot.combo;
    if (typeof snapshot.t === "number") engine.levelTime = snapshot.t;

    const weapons = engine.weapons;
    weapons.select(player.weapon);
    weapons.reloading = player.reload > 0;
    weapons.reloadTimer = player.reload;
    if (player.reload > 0 && !this.me?.reload) engine.audio.playReload();
    player.ammo.forEach(([ammo, reserve], index) => {
      weapons.weapons[index].ammo = ammo;
      weapons.weapons[index].reserve = reserve ?? Infinity;
    });

    this.updateAvatars(snapshot.players, room.members, id);
    this.enemies = snapshot.enemies;
    for (let i = 0; i < engine.enemies.length; i++) {
      const enemy = engine.enemies[i];
      enemy.hp = this.enemies[i][4];
      enemy.alive = enemy.hp > 0;
      if (changedRound) enemy.root.position.fromArray(this.enemies[i]);
    }
    snapshot.props.forEach((entry, index) => {
      const prop = engine.props[index];
      if (!prop) return;
      const active = Array.isArray(entry) ? entry[0] : entry;
      const px = Array.isArray(entry) ? entry[1] : prop.x;
      const pz = Array.isArray(entry) ? entry[2] : prop.z;
      if (prop.active && !active) {
        prop.active = false;
        prop.mesh.removeFromParent();
      } else if (!prop.active && active) {
        prop.active = true;
        prop.x = px;
        prop.z = pz;
        const baseY = prop.type === "barrel" ? 0.725 : prop.type === "medkit" ? 0.55 : prop.type === "ammo" ? 0.52 : 0.11;
        prop.mesh.position.set(px, baseY, pz);
        engine.levelRoot.add(prop.mesh);
      } else if (active && (prop.x !== px || prop.z !== pz)) {
        prop.x = px;
        prop.z = pz;
        prop.mesh.position.x = px;
        prop.mesh.position.z = pz;
      }
    });
    this.updateProjectiles(snapshot.projectiles);
    this.updateGrenades(snapshot.grenades || []);
    for (const event of snapshot.events) this.playEvent(event, id);
    this.me = player;
    this.mode = snapshot.mode;
  }

  updateAvatars(players, members, id) {
    const online = new Set();
    for (const player of players) {
      if (player.id === id) continue;
      const member = members.find((entry) => entry.id === player.id);
      if (!member) continue;
      online.add(player.id);
      let avatar = this.avatars.get(player.id);
      if (!avatar) {
        const tint = PLAYER_COLORS[member.slot];
        avatar = Object.assign(createLanAvatar(this.engine.assets, tint), {
          name: member.name,
          color: "#" + tint.toString(16).padStart(6, "0"),
          position: new THREE.Vector3(),
          step: 0,
        });
        this.engine.levelRoot.add(avatar.root);
        this.avatars.set(player.id, avatar);
      }
      avatar.position.fromArray(player.p);
      if (avatar.life !== player.life) avatar.root.position.copy(avatar.position);
      avatar.yaw = player.yaw;
      avatar.sliding = player.sliding === true;
      avatar.root.visible = player.hp > 0;
      avatar.life = player.life;
    }
    for (const [playerId, avatar] of this.avatars) {
      if (online.has(playerId)) continue;
      for (const mesh of [...avatar.root.children]) this.removeMesh(mesh);
      avatar.root.removeFromParent();
      this.avatars.delete(playerId);
    }
  }

  updateProjectiles(current) {
    const online = new Set();
    let fired = false;
    for (const [id, type, color, x, y, z] of current) {
      online.add(id);
      let projectile = this.projectiles.get(id);
      if (!projectile) {
        const mesh = this.engine._makeProjectileMesh(type, color);
        mesh.position.set(x, y, z);
        this.engine.levelRoot.add(mesh);
        projectile = { mesh, position: new THREE.Vector3() };
        this.projectiles.set(id, projectile);
        fired ||= mesh.position.distanceToSquared(this.engine.player.pos) < 32 ** 2;
      }
      projectile.position.set(x, y, z);
    }
    if (fired) this.engine.audio.playEnemyShot();
    for (const [id, { mesh }] of this.projectiles) {
      if (online.has(id)) continue;
      this.removeMesh(mesh);
      this.projectiles.delete(id);
    }
  }

  updateGrenades(current) {
    const online = new Set();
    for (const [id, x, y, z, fuse] of current) {
      online.add(id);
      let g = this.grenades.get(id);
      if (!g) {
        const { mesh, led } = this.engine._makeGrenadeMesh();
        mesh.position.set(x, y, z);
        this.engine.levelRoot.add(mesh);
        g = { mesh, led, position: new THREE.Vector3(x, y, z), fuse };
        this.grenades.set(id, g);
      }
      g.position.set(x, y, z);
      g.fuse = fuse;
    }
    for (const [id, g] of this.grenades) {
      if (online.has(id)) continue;
      g.mesh.removeFromParent();
      this.grenades.delete(id);
    }
  }

  playEvent(event, id) {
    const engine = this.engine;
    const local = event.id === id;
    if (event.type === "shot") {
      const weapon = engine.weapons.weapons[event.weapon];
      const origin = new THREE.Vector3().fromArray(event.start);
      const start = local ? engine.weapons.getMuzzleWorldPosition() : origin;
      for (const end of event.ends) {
        engine._spawnTracer(start, new THREE.Vector3().fromArray(end), weapon.tracerColor, event.weapon === 2 ? 0.08 : 0.045);
      }
      if (local) {
        engine.player.fireTimer = 0.22;
        engine.weapons.cooldown = weapon.fireRate;
        engine.weapons.recoil = weapon.recoilKick;
        engine.weapons.muzzleFlash = 0.075;
        engine.addShotRecoil(weapon.recoilKick);
      }
      if (local || origin.distanceToSquared(engine.player.pos) < 30 ** 2) {
        engine.audio[["playMagnum", "playShotgun", "playRaygun", "playSniper"][event.weapon]]();
      }
    } else if (event.type === "melee" && local) {
      engine.weapons.punchTimer = 0.34;
      engine.audio.playPunch();
    } else if (event.type === "throw" && local) {
      engine.audio.playThrow();
    } else if (event.type === "jump" && local) {
      engine.audio.playJump();
    } else if (event.type === "dash" && local) {
      engine.audio.playDash();
    } else if (event.type === "slide" && local) {
      engine.audio.playSlide();
    } else if (event.type === "pickup" && local) {
      engine.audio.playPickup();
      engine.callbacks.onPickup?.(engine.player, { kind: event.kind, amount: event.amount, gains: event.gains });
    } else if (event.type === "hit" && local) {
      engine.audio.playHit(event.crit);
      engine.callbacks.onHit(event.crit);
    } else if (event.type === "hurt" && local) {
      engine.player.hurtTimer = 0.3;
      engine.shake = Math.min(18, engine.shake + 11);
      engine.audio.playHurt();
      engine.callbacks.onPlayerHurt();
    } else if (event.type === "death" && local) {
      engine.shake = 18;
      engine.audio.playEnemyDown();
      engine.callbacks.onPlayerHurt();
    } else if (event.type === "popup") {
      engine.spawnPopup(new THREE.Vector3().fromArray(event.at), event.text, event.color, event.scale, event.kind || "bubble");
    } else if (event.type === "explosion") {
      const at = new THREE.Vector3().fromArray(event.at);
      engine._spawnShockwave(at);
      engine._spawnParticles(at, 0xff7a00, 20);
      if (at.distanceToSquared(engine.player.pos) < 42 ** 2) engine.audio.playExplosion();
    } else if (event.type === "panel" && local) {
      engine.callbacks.onKillPanel(event.words);
    }
  }

  update(dt) {
    const engine = this.engine;
    const player = engine.player;
    const alpha = 1 - Math.exp(-dt * 24);
    const moving = player.pos.distanceToSquared(this.localPosition) > 0.001;
    player.moveSpeedRatio += ((moving ? 1 : 0) - (player.moveSpeedRatio || 0)) * Math.min(1, dt * 14);
    player.dashTimer = this.me?.dashing ? 0.1 : 0;
    player.slideTimer = this.me?.sliding ? 0.1 : 0;
    const targetSlide = this.me?.sliding ? 1 : 0;
    player.slideAmount = (player.slideAmount || 0) + (targetSlide - (player.slideAmount || 0)) * Math.min(1, dt * (targetSlide ? 20 : 12));
    player.pos.lerp(this.localPosition, alpha);
    if (moving && player.onGround && !this.me?.sliding) player.bobPhase += dt * 11.5;
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    player.fireTimer = Math.max(0, player.fireTimer - dt);
    engine._decayCameraRecoil(dt);
    engine.speedLineAlpha = (this.me.dashing || this.me.sliding) ? Math.max(engine.speedLineAlpha, this.me.dashing ? 1 : 0.65) : Math.max(0, engine.speedLineAlpha - dt * 3);
    engine.weapons.update(dt, moving && player.onGround && !this.me?.sliding, player.slideAmount);
    const baseFov = (this.me.dashing ? 85 : THREE.MathUtils.lerp(engine.baseFov, engine.weapons.current.adsFov, engine.weapons.adsAmount)) + player.slideAmount * 9;
    const fov = baseFov + engine.recoilFovKick;
    if (Math.abs(engine.camera.fov - fov) > 0.05) {
      engine.camera.fov += (fov - engine.camera.fov) * alpha;
      engine.camera.updateProjectionMatrix();
    }
    engine._syncCamera();
    const isDead = this.me && this.me.hp <= 0;
    const targetTilt = isDead ? 1 : 0;
    this.deathTilt += (targetTilt - this.deathTilt) * Math.min(1, dt * 8);
    if (this.deathTilt > 0.005) {
      engine.camera.position.y -= this.deathTilt * 0.85;
      engine.camera.rotation.z = this.deathTilt * 0.42;
    }
    if (engine.weapons.root) engine.weapons.root.visible = !isDead;
    engine.levelTime += dt;
    engine._updateDynamics(dt, [engine.player], false);
    engine._updateProps(dt, false);
    engine._updateFX(dt);

    for (const avatar of this.avatars.values()) {
      const speed = this.delta.subVectors(avatar.position, avatar.root.position).length();
      avatar.root.position.lerp(avatar.position, alpha);
      const slideDrop = avatar.sliding ? 0.45 : 0;
      avatar.root.position.y -= slideDrop;
      avatar.root.rotation.x += ((avatar.sliding ? 0.55 : 0) - avatar.root.rotation.x) * alpha;
      avatar.root.rotation.y += Math.atan2(Math.sin(avatar.yaw - avatar.root.rotation.y),
        Math.cos(avatar.yaw - avatar.root.rotation.y)) * alpha;
      if (speed > 0.03 && !avatar.sliding) avatar.step += dt * 11.5;
      const swing = avatar.sliding ? 0 : Math.sin(avatar.step) * Math.min(0.48, speed * 2);
      avatar.leftLeg.rotation.x = swing;
      avatar.rightLeg.rotation.x = -swing;
    }
    for (let i = 0; i < this.enemies.length; i++) {
      const [x, y, z, yaw, , death, swing] = this.enemies[i];
      const enemy = engine.enemies[i];
      enemy.root.position.lerp(this.delta.set(x, y, z), alpha);
      enemy.root.rotation.y = yaw;
      enemy.root.rotation.x = -death * Math.PI / 2;
      enemy.bodyParts.legL.rotation.x = Math.sin(swing) * 0.45;
      enemy.bodyParts.legR.rotation.x = -enemy.bodyParts.legL.rotation.x;
      if (enemy.bodyParts.halo) enemy.bodyParts.halo.rotation.z += dt * 2.4;
    }
    for (const { mesh, position } of this.projectiles.values()) mesh.position.lerp(position, alpha);
    for (const g of this.grenades.values()) {
      g.mesh.position.lerp(g.position, alpha);
      g.mesh.rotation.x += dt * 9;
      g.mesh.rotation.z += dt * 7;
      if (g.led) {
        const blinkRate = g.fuse < 0.55 ? 24 : 10;
        g.led.material.color.setHex(Math.floor(g.fuse * blinkRate) % 2 === 0 ? 0xff2a44 : 0xffe01b);
      }
    }
  }

  drawLabels(minimap) {
    const engine = this.engine;
    const ctx = engine.fxCtx;
    const cell = Math.min(minimap.canvas.width / engine.mapW, minimap.canvas.height / engine.mapH);
    const ox = (minimap.canvas.width - engine.mapW * cell) / 2;
    const oz = (minimap.canvas.height - engine.mapH * cell) / 2;
    ctx.save();
    ctx.font = "700 15px sans-serif";
    ctx.textAlign = "center";
    for (const avatar of this.avatars.values()) {
      if (!avatar.root.visible) continue;
      const pos = avatar.root.position;
      if (this.mode === "coop") {
        minimap.fillStyle = avatar.color;
        minimap.fillRect(ox + pos.x / CELL_SIZE * cell - 2, oz + pos.z / CELL_SIZE * cell - 2, 5, 5);
      }
      const at = this.delta.copy(pos).add(new THREE.Vector3(0, 2.05, 0));
      const screen = engine._projectToScreen(at);
      if (!screen || screen.dist > 40 || !engine._hasLineOfSight(engine.camera.position, at)) continue;
      const width = ctx.measureText(avatar.name).width;
      ctx.fillStyle = "#0f0f14";
      ctx.fillRect(screen.x - width / 2 - 5, screen.y - 16, width + 10, 22);
      ctx.fillStyle = avatar.color;
      ctx.fillText(avatar.name, screen.x, screen.y);
    }
    ctx.restore();
  }
}
