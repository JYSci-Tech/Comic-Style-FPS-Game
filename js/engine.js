import * as THREE from "three";
import { CELL_SIZE, COMIC_LEVELS } from "./levels.js";
import { WeaponSystem3D } from "./weapons.js";

// 真 3D Three.js 美式漫画风 FPS 引擎（赛璐璐着色 + 墨线描边 + 真实爆头判定 + 3D 弹幕与特效）
export class ComicFPS3DEngine {
  constructor(glCanvas, fxCanvas, assets, audio, callbacks = {}) {
    this.glCanvas = glCanvas;
    this.fxCanvas = fxCanvas;
    this.fxCtx = fxCanvas.getContext("2d");
    this.assets = assets;
    this.audio = audio;
    this.callbacks = callbacks;

    // WebGL 渲染器（原生高清 DPR，抗锯齿）
    this.renderer = new THREE.WebGLRenderer({
      canvas: glCanvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;

    // 场景与正确比例的透视相机
    this.scene = new THREE.Scene();
    this.baseFov = 72;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / Math.max(1, window.innerHeight), 0.08, 220);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    // 3D 第一人称武器系统
    this.weapons = new WeaponSystem3D(this.camera, this.assets, this.audio);

    this.levelRoot = new THREE.Group();
    this.scene.add(this.levelRoot);

    this.raycaster = new THREE.Raycaster();
    this.levelIdx = 0;
    this.level = null;
    this.map = [];
    this.mapW = 0;
    this.mapH = 0;

    // 玩家物理状态（眼高 1.72m，支持跳跃、冲刺与低矮掩体攀爬）
    this.eyeHeight = 1.72;
    this.player = {
      pos: new THREE.Vector3(10, 0, 10),
      velY: 0,
      yaw: 0,
      pitch: 0,
      onGround: true,
      hp: 100,
      maxHp: 100,
      speed: 9.2,
      dashTimer: 0,
      dashCooldown: 0,
      dashDir: new THREE.Vector3(),
      hurtTimer: 0,
      fireTimer: 0,
      bobPhase: 0,
    };

    this.enemies = [];
    this.props = [];
    this.enemyProjectiles = [];
    this.tracers = [];
    this.particles = [];
    this.shockwaves = [];
    this.popups = [];
    this.hitTargets = []; // 用于射线检测的所有可击中网格

    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.shake = 0;
    this.hitstop = 0;
    this.speedLineAlpha = 0;

    this.keys = {};
    this.mouseDown = false;

    this._handleResize();
    window.addEventListener("resize", () => this._handleResize());
  }

  _handleResize() {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.fxCanvas.width = Math.floor(w * dpr);
    this.fxCanvas.height = Math.floor(h * dpr);
    this.fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = w;
    this.viewH = h;
  }

  _clearGroup(group) {
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
  }

  loadLevel(idx, keepStats = false) {
    this.levelIdx = idx;
    const lvl = COMIC_LEVELS[idx];
    this.level = lvl;
    this.map = lvl.map;
    this.mapH = this.map.length;
    this.mapW = this.map[0].length;

    this._clearGroup(this.levelRoot);
    this.enemies = [];
    this.props = [];
    this.enemyProjectiles = [];
    this.tracers = [];
    this.particles = [];
    this.shockwaves = [];
    this.popups = [];
    this.hitTargets = [];

    // 天空与雾效
    this.scene.background = new THREE.Color(lvl.skyColor);
    this.scene.fog = new THREE.FogExp2(lvl.fogColor, 0.014);

    // 灯光（赛璐璐强方向光 + 半球补光）
    const hemi = new THREE.HemisphereLight(lvl.ambientColor, 0x262038, 1.15);
    this.levelRoot.add(hemi);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.65);
    dirLight.position.set(28, 42, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 5;
    dirLight.shadow.camera.far = 110;
    const d = 40;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    this.levelRoot.add(dirLight);

    // 地面
    const worldW = this.mapW * CELL_SIZE;
    const worldH = this.mapH * CELL_SIZE;
    const floorTex = this.assets.textures[lvl.floorTex].clone();
    floorTex.needsUpdate = true;
    floorTex.repeat.set(this.mapW, this.mapH);
    const floorMat = this.assets.toonMat({ map: floorTex });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(worldW / 2, 0, worldH / 2);
    floor.receiveShadow = true;
    this.levelRoot.add(floor);

    // 构建 3D 墙壁与矮掩体箱
    const wallH = 4.8;
    const crateH = 1.65;
    const wallGeo = new THREE.BoxGeometry(CELL_SIZE, wallH, CELL_SIZE);
    const crateGeo = new THREE.BoxGeometry(CELL_SIZE * 0.78, crateH, CELL_SIZE * 0.78);
    const trimGeo = new THREE.BoxGeometry(CELL_SIZE + 0.12, 0.28, CELL_SIZE + 0.12);
    const trimMat = this.assets.toonMat({ color: 0x16161e });

    for (let z = 0; z < this.mapH; z++) {
      for (let x = 0; x < this.mapW; x++) {
        const cell = this.map[z][x];
        if (cell === 0) continue;
        const wx = (x + 0.5) * CELL_SIZE;
        const wz = (z + 0.5) * CELL_SIZE;
        const mat = this.assets.wallMaterials[cell] || this.assets.wallMaterials[1];

        if (cell === 6) {
          // 可跳跃越过的矮木箱掩体
          const box = new THREE.Mesh(crateGeo, mat);
          box.position.set(wx, crateH / 2, wz);
          box.castShadow = true;
          box.receiveShadow = true;
          this.assets.addCreaseLines(box);
          box.userData = { kind: "wall" };
          this.levelRoot.add(box);
          this.hitTargets.push(box);
        } else {
          const wall = new THREE.Mesh(wallGeo, mat);
          wall.position.set(wx, wallH / 2, wz);
          wall.castShadow = true;
          wall.receiveShadow = true;
          this.assets.addCreaseLines(wall);
          wall.userData = { kind: "wall" };
          this.levelRoot.add(wall);
          this.hitTargets.push(wall);

          // 屋顶黑墨檐口
          const trim = new THREE.Mesh(trimGeo, trimMat);
          trim.position.set(wx, wallH + 0.14, wz);
          this.levelRoot.add(trim);
        }
      }
    }

    // 漫画城市天际线 & 大太阳背景
    this._buildComicSkyline(worldW, worldH, lvl);

    // 玩家出生点
    this.player.pos.set(lvl.playerStart.x * CELL_SIZE, 0, lvl.playerStart.z * CELL_SIZE);
    this.player.velY = 0;
    this.player.onGround = true;
    this.player.yaw = lvl.playerStart.yaw;
    this.player.pitch = 0;
    this.player.dashTimer = 0;
    this.player.dashCooldown = 0;
    this.player.hurtTimer = 0;

    if (!keepStats) {
      this.player.hp = 100;
      this.score = 0;
      this.kills = 0;
      this.combo = 0;
      this.comboTimer = 0;
      this.weapons.resetAll();
    } else {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 35);
    }

    // 生成 3D 关节敌人
    lvl.enemies.forEach((e, idx) => this._spawnEnemy(e, idx));
    // 生成 3D 道具与油桶
    lvl.props.forEach((p, idx) => this._spawnProp(p, idx));

    this.shake = 0;
    this._syncCamera(0);
  }

  _buildComicSkyline(worldW, worldH, lvl) {
    const cx = worldW / 2;
    const cz = worldH / 2;
    const bMat = new THREE.MeshBasicMaterial({ color: lvl.skylineColor });
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffe01b });
    const winMat2 = new THREE.MeshBasicMaterial({ color: 0x00e5ff });

    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * Math.PI * 2;
      const dist = Math.max(worldW, worldH) * 0.72 + (i % 3) * 10;
      const bw = 7 + (i % 4) * 3;
      const bh = 18 + ((i * 7) % 26);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bw), bMat);
      mesh.position.set(cx + Math.cos(ang) * dist, bh / 2 - 2, cz + Math.sin(ang) * dist);
      this.assets.addCreaseLines(mesh);

      // 漫画发光窗户条
      const wStrip = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.65, 1.4, bw + 0.2),
        i % 2 === 0 ? winMat : winMat2
      );
      wStrip.position.y = bh * 0.25;
      mesh.add(wStrip);
      this.levelRoot.add(mesh);
    }

    // 巨大漫画赛璐璐太阳
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(9, 16, 16),
      new THREE.MeshBasicMaterial({ color: lvl.sunColor })
    );
    sun.position.set(cx + 55, 42, cz - 55);
    this.assets.addOutline(sun, 1.08);
    this.levelRoot.add(sun);
  }

  // 确保实体永远生成在空地（格子值为 0），防止卡进建筑或木箱
  _safeWorldPos(gridX, gridZ) {
    const gx = Math.floor(gridX);
    const gz = Math.floor(gridZ);
    if (gz >= 0 && gz < this.mapH && gx >= 0 && gx < this.mapW && this.map[gz][gx] === 0) {
      return { x: gridX * CELL_SIZE, z: gridZ * CELL_SIZE };
    }
    for (let r = 1; r <= 4; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = gx + dx;
          const nz = gz + dz;
          if (nz >= 0 && nz < this.mapH && nx >= 0 && nx < this.mapW && this.map[nz][nx] === 0) {
            return { x: (nx + 0.5) * CELL_SIZE, z: (nz + 0.5) * CELL_SIZE };
          }
        }
      }
    }
    return { x: gridX * CELL_SIZE, z: gridZ * CELL_SIZE };
  }

  _spawnEnemy(spec, id) {
    const cfgByType = {
      goon: { hp: 80, speed: 4.0, range: 26, dmg: 8, rate: 1.4, score: 150, scale: 1.0, coat: 0x5d2e9e, trim: 0xffe01b, skin: 0xffcfa8, projColor: 0xffe01b, taunt: "GET HIM!" },
      brute: { hp: 185, speed: 3.1, range: 22, dmg: 13, rate: 1.7, score: 300, scale: 1.24, coat: 0xd92638, trim: 0xffe01b, skin: 0xf0a878, projColor: 0xff7a00, taunt: "CRUSH!" },
      sniper: { hp: 95, speed: 4.5, range: 38, dmg: 15, rate: 2.0, score: 260, scale: 0.98, coat: 0x162d42, trim: 0x00e5ff, skin: 0xe6d6c8, projColor: 0x00f0ff, taunt: "LOCKED ON!" },
      boss: { hp: 560, speed: 4.2, range: 42, dmg: 14, rate: 1.05, score: 1500, scale: 1.52, coat: 0x6e14a8, trim: 0x00ff99, skin: 0xc9ffdc, projColor: 0xff2ebd, taunt: "FADE TO GRAY!" },
    };
    const cfg = cfgByType[spec.type];

    const pos = this._safeWorldPos(spec.x, spec.z);
    const root = new THREE.Group();
    root.position.set(pos.x, 0, pos.z);
    root.scale.setScalar(cfg.scale);

    const enemy = {
      id,
      type: spec.type,
      root,
      hp: cfg.hp,
      maxHp: cfg.hp,
      speed: cfg.speed,
      range: cfg.range,
      dmg: cfg.dmg,
      fireRate: cfg.rate,
      score: cfg.score,
      scale: cfg.scale,
      projColor: cfg.projColor,
      taunt: cfg.taunt,
      alive: true,
      alerted: false,
      hurtTimer: 0,
      attackCooldown: 0.8 + Math.random() * 0.8,
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      strafeTimer: 1.2 + Math.random() * 1.4,
      animPhase: Math.random() * 6,
      deathAnim: 0,
      meshes: [],
      bodyParts: {},
    };

    const makePart = (geo, color, isHead = false, emissive = 0x000000) => {
      const mat = this.assets.toonMat({ color, emissive });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      this.assets.addOutline(m, 1.07);
      m.userData = { kind: "enemy", enemy, isHead, baseColor: color };
      this.hitTargets.push(m);
      enemy.meshes.push(m);
      return m;
    };

    // 双腿
    const legGeo = new THREE.BoxGeometry(0.28, 0.78, 0.28);
    const legL = makePart(legGeo, 0x1a1a24, false);
    legL.position.set(-0.2, 0.39, 0);
    const legR = makePart(legGeo, 0x1a1a24, false);
    legR.position.set(0.2, 0.39, 0);
    root.add(legL, legR);

    // 躯干
    const torso = makePart(new THREE.BoxGeometry(0.76, 0.92, 0.44), cfg.coat, false);
    torso.position.set(0, 1.24, 0);
    root.add(torso);

    // 领带 / 胸甲条纹
    const tie = makePart(new THREE.BoxGeometry(0.2, 0.65, 0.47), cfg.trim, false);
    tie.position.set(0, 1.26, 0.01);
    root.add(tie);

    // 手臂与武器
    const armL = makePart(new THREE.BoxGeometry(0.24, 0.72, 0.24), cfg.coat, false);
    armL.position.set(-0.52, 1.24, 0);
    const armR = makePart(new THREE.BoxGeometry(0.24, 0.72, 0.24), cfg.coat, false);
    armR.position.set(0.52, 1.28, 0.16);
    armR.rotation.x = -Math.PI / 2.6;
    const gun = makePart(new THREE.BoxGeometry(0.14, 0.16, 0.65), 0x262632, false);
    gun.position.set(0.52, 1.32, 0.56);
    root.add(armL, armR, gun);

    // 头部（独立爆头判定！）
    const head = makePart(new THREE.SphereGeometry(0.32, 12, 12), cfg.skin, true);
    head.position.set(0, 2.04, 0);
    root.add(head);

    // 特色头饰与Boss披风
    if (spec.type === "goon") {
      const brim = makePart(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 12), 0x2a1448, true);
      brim.position.set(0, 2.28, 0);
      const top = makePart(new THREE.CylinderGeometry(0.28, 0.32, 0.28, 12), 0x2a1448, true);
      top.position.set(0, 2.44, 0);
      root.add(brim, top);
    } else if (spec.type === "brute") {
      const visor = makePart(new THREE.BoxGeometry(0.48, 0.18, 0.24), 0xffe01b, true, 0x443300);
      visor.position.set(0, 2.08, 0.22);
      const padL = makePart(new THREE.BoxGeometry(0.38, 0.34, 0.46), 0xffe01b, false);
      padL.position.set(-0.58, 1.62, 0);
      const padR = makePart(new THREE.BoxGeometry(0.38, 0.34, 0.46), 0xffe01b, false);
      padR.position.set(0.58, 1.62, 0);
      root.add(visor, padL, padR);
    } else if (spec.type === "sniper") {
      const scope = makePart(new THREE.CylinderGeometry(0.11, 0.11, 0.24, 10), 0xff2a44, true, 0xaa0022);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0.12, 2.08, 0.28);
      root.add(scope);
    } else if (spec.type === "boss") {
      const cape = makePart(new THREE.BoxGeometry(1.15, 1.55, 0.1), 0xff2a44, false);
      cape.position.set(0, 1.0, -0.32);
      cape.rotation.x = 0.16;
      const gogL = makePart(new THREE.SphereGeometry(0.12, 8, 8), 0x00ff99, true, 0x008844);
      gogL.position.set(-0.13, 2.08, 0.26);
      const gogR = makePart(new THREE.SphereGeometry(0.12, 8, 8), 0x00ff99, true, 0x008844);
      gogR.position.set(0.13, 2.08, 0.26);
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.95, 0.06, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0x00ffaa })
      );
      halo.position.set(0, 1.5, -0.1);
      root.add(cape, gogL, gogR, halo);
      enemy.bodyParts.halo = halo;
    }

    enemy.bodyParts.legL = legL;
    enemy.bodyParts.legR = legR;
    enemy.bodyParts.armR = armR;

    this.levelRoot.add(root);
    this.enemies.push(enemy);
  }

  _spawnProp(spec, id) {
    const pos = this._safeWorldPos(spec.x, spec.z);
    const wx = pos.x;
    const wz = pos.z;
    const prop = { id, type: spec.type, active: true, x: wx, z: wz, mesh: null };

    if (spec.type === "barrel") {
      const geo = new THREE.CylinderGeometry(0.55, 0.55, 1.45, 14);
      const mat = this.assets.toonMat({ map: this.assets.textures.barrel });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wx, 0.725, wz);
      mesh.castShadow = true;
      this.assets.addOutline(mesh, 1.06);
      mesh.userData = { kind: "barrel", prop };
      this.levelRoot.add(mesh);
      this.hitTargets.push(mesh);
      prop.mesh = mesh;
    } else if (spec.type === "medkit") {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.6), this.assets.toonMat({ color: 0xffffff }));
      this.assets.addOutline(box, 1.07);
      const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.64), this.assets.toonMat({ color: 0xff2a44 }));
      const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.64), this.assets.toonMat({ color: 0xff2a44 }));
      g.add(box, cross1, cross2);
      g.position.set(wx, 0.55, wz);
      this.levelRoot.add(g);
      prop.mesh = g;
    } else if (spec.type === "ammo") {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.52, 0.55), this.assets.toonMat({ color: 0xffe01b }));
      this.assets.addOutline(box, 1.07);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.14, 0.58), this.assets.toonMat({ color: 0x22222c }));
      lid.position.y = 0.24;
      g.add(box, lid);
      g.position.set(wx, 0.52, wz);
      this.levelRoot.add(g);
      prop.mesh = g;
    } else if (spec.type === "jumppad") {
      const g = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.15, 0.22, 16),
        this.assets.toonMat({ color: 0x00ffaa, emissive: 0x005533 })
      );
      this.assets.addOutline(base, 1.06);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.8, 0.08, 6, 18),
        new THREE.MeshBasicMaterial({ color: 0xffe01b })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.25;
      g.add(base, ring);
      g.position.set(wx, 0.11, wz);
      this.levelRoot.add(g);
      prop.mesh = g;
      prop.ring = ring;
    }

    this.props.push(prop);
  }

  getAliveEnemiesCount() {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  getBoss() {
    return this.enemies.find((e) => e.type === "boss" && e.alive) || null;
  }

  _cellAt(wx, wz) {
    const mx = Math.floor(wx / CELL_SIZE);
    const mz = Math.floor(wz / CELL_SIZE);
    if (mx < 0 || mz < 0 || mx >= this.mapW || mz >= this.mapH) return 1;
    return this.map[mz][mx];
  }

  _isBlocked(wx, wz, playerY = 0) {
    const c = this._cellAt(wx, wz);
    if (c === 0) return false;
    if (c === 6 && playerY >= 1.45) return false; // 跳起来可以越过/站在矮木箱上
    return true;
  }

  _groundHeightAt(wx, wz) {
    const c = this._cellAt(wx, wz);
    return c === 6 ? 1.65 : 0;
  }

  _hasLineOfSight(fromPos, toPos) {
    const dir = new THREE.Vector3().subVectors(toPos, fromPos);
    const dist = dir.length();
    dir.normalize();
    const steps = Math.ceil(dist / 0.8);
    for (let i = 1; i < steps; i++) {
      const p = fromPos.clone().addScaledVector(dir, (i / steps) * dist);
      const c = this._cellAt(p.x, p.z);
      if (c > 0 && c !== 6) return false;
      if (c === 6 && p.y < 1.65) return false;
    }
    return true;
  }

  handleMouseMove(dx, dy) {
    const sens = this.weapons.isAds ? 0.0014 : 0.0022;
    this.player.yaw -= dx * sens;
    this.player.pitch = Math.max(-1.35, Math.min(1.35, this.player.pitch - dy * sens));
  }

  setAds(active) {
    this.weapons.isAds = active;
  }

  triggerJump() {
    if (this.player.onGround) {
      this.player.velY = 9.2;
      this.player.onGround = false;
      this.audio.playJump();
    }
  }

  triggerDash() {
    if (this.player.dashCooldown > 0 || this.player.dashTimer > 0) return;
    const forward = new THREE.Vector3(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
    const right = new THREE.Vector3(Math.cos(this.player.yaw), 0, -Math.sin(this.player.yaw));
    const dir = new THREE.Vector3();
    if (this.keys["KeyW"]) dir.add(forward);
    if (this.keys["KeyS"]) dir.sub(forward);
    if (this.keys["KeyD"]) dir.add(right);
    if (this.keys["KeyA"]) dir.sub(right);
    if (dir.lengthSq() === 0) dir.copy(forward);
    dir.normalize();

    this.player.dashDir.copy(dir);
    this.player.dashTimer = 0.19;
    this.player.dashCooldown = 1.35;
    this.speedLineAlpha = 1.0;
    this.audio.playDash();
  }

  triggerMeleePunch() {
    if (!this.weapons.triggerPunch()) return;
    const camPos = this.camera.position;
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let hit = false;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const toE = new THREE.Vector3(e.root.position.x - camPos.x, 0, e.root.position.z - camPos.z);
      const dist = toE.length();
      if (dist < 3.6 && toE.normalize().dot(new THREE.Vector3(camDir.x, 0, camDir.z).normalize()) > 0.45) {
        hit = true;
        // 安全击退敌人（带墙壁碰撞检测，防止把敌人打进墙体）
        const kx = e.root.position.x + toE.x * 1.4;
        const kz = e.root.position.z + toE.z * 1.4;
        if (!this._isBlocked(kx + Math.sign(toE.x) * 0.65, e.root.position.z, 0)) e.root.position.x = kx;
        if (!this._isBlocked(e.root.position.x, kz + Math.sign(toE.z) * 0.65, 0)) e.root.position.z = kz;
        this._damageEnemy(e, 65, true, "POW!");
      }
    }
    if (hit) {
      this.shake = Math.min(16, this.shake + 10);
      this.audio.playHit(true);
      if (this.callbacks.onHit) this.callbacks.onHit(true);
    }
  }

  fireWeapon() {
    if (!this.weapons.canFire()) return;
    const w = this.weapons.consumeShot();
    this.player.fireTimer = 0.22;
    this.shake = Math.min(14, this.shake + w.recoilKick * 4.2);

    const muzzlePos = this.weapons.getMuzzleWorldPosition();
    const spread = this.weapons.isAds ? w.adsSpread : w.spread;

    let hitAny = false;
    let critAny = false;

    for (let p = 0; p < w.pellets; p++) {
      const ndcX = (Math.random() - 0.5) * spread * 2;
      const ndcY = (Math.random() - 0.5) * spread * 2;
      this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
      const hits = this.raycaster.intersectObjects(this.hitTargets, false);

      let endPoint = this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, 55);

      if (hits.length > 0) {
        const hit = hits[0];
        endPoint = hit.point;
        const ud = hit.object.userData;

        if (ud.kind === "enemy" && ud.enemy.alive) {
          hitAny = true;
          const isHead = !!ud.isHead;
          if (isHead) critAny = true;
          const dmg = isHead ? Math.round(w.damage * w.headshotMult) : w.damage;
          this._damageEnemy(ud.enemy, dmg, isHead, w.soundWord, hit.point);
        } else if (ud.kind === "barrel" && ud.prop.active) {
          hitAny = true;
          this._explodeBarrel(ud.prop);
        } else {
          // 击中墙壁的漫画火花
          this._spawnParticles(hit.point, 0xffe01b, 5);
        }
      }

      this._spawnTracer(muzzlePos, endPoint, w.tracerColor, w.id === "raygun" ? 0.08 : 0.045);
    }

    if (hitAny) {
      this.audio.playHit(critAny);
      if (this.callbacks.onHit) this.callbacks.onHit(critAny);
    }
  }

  _spawnTracer(start, end, color, radius = 0.045) {
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = Math.max(0.2, dir.length());
    const geo = new THREE.CylinderGeometry(radius, radius, len, 6);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(start).addScaledVector(dir, 0.5);
    mesh.lookAt(end);
    this.levelRoot.add(mesh);
    this.tracers.push({ mesh, age: 0, life: 0.085 });
  }

  _spawnParticles(pos, color, count = 8) {
    const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);
      this.assets.addOutline(mesh, 1.25);
      mesh.position.copy(pos);
      this.levelRoot.add(mesh);
      this.particles.push({
        mesh,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 9,
          2.5 + Math.random() * 6,
          (Math.random() - 0.5) * 9
        ),
        age: 0,
        life: 0.45 + Math.random() * 0.28,
      });
    }
  }

  _spawnShockwave(pos, color = 0xff7a00) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.14, 8, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(pos.x, 0.5, pos.z);
    this.levelRoot.add(ring);
    this.shockwaves.push({ mesh: ring, age: 0, life: 0.36 });
  }

  spawnPopup(pos, text, color = "#ffe01b", scale = 1.0) {
    this.popups.push({
      pos: pos.clone(),
      text,
      color,
      scale,
      age: 0,
      life: 0.78,
    });
  }

  _damageEnemy(enemy, dmg, isHeadshot, soundWord, hitPoint = null) {
    if (!enemy.alive) return;
    enemy.hp -= dmg;
    enemy.hurtTimer = 0.13;
    enemy.alerted = true;

    const fxPos = hitPoint
      ? hitPoint.clone()
      : new THREE.Vector3(enemy.root.position.x, 1.8 * enemy.scale, enemy.root.position.z);

    const words = isHeadshot ? ["HEADSHOT!", "CRIT!", "CRACK!"] : [soundWord || "POW!", "BAM!", "WHACK!"];
    this.spawnPopup(
      fxPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.5, (Math.random() - 0.5) * 0.5)),
      words[Math.floor(Math.random() * words.length)],
      isHeadshot ? "#ffe01b" : "#ff2a44",
      isHeadshot ? 1.28 : 0.96
    );
    this._spawnParticles(fxPos, isHeadshot ? 0xffe01b : 0xff2a44, isHeadshot ? 10 : 6);

    // 受伤闪白
    enemy.meshes.forEach((m) => m.material.color.setHex(0xffffff));

    if (enemy.hp <= 0) {
      enemy.alive = false;
      this.kills += 1;
      this.combo += 1;
      this.comboTimer = 4.2;
      this.score += Math.round(enemy.score * (1 + (this.combo - 1) * 0.25));
      this.audio.playEnemyDown();
      this.hitstop = isHeadshot || enemy.type === "boss" ? 0.055 : 0.02;

      // 移除死亡敌人的碰撞目标
      this.hitTargets = this.hitTargets.filter((m) => m.userData.enemy !== enemy);

      this.spawnPopup(
        new THREE.Vector3(enemy.root.position.x, 2.2 * enemy.scale, enemy.root.position.z),
        "K.O.!",
        "#00e5ff",
        1.35
      );
      this._spawnParticles(fxPos, 0x101016, 12);

      if ((isHeadshot || enemy.type === "boss" || this.combo >= 3) && this.callbacks.onKillPanel) {
        const panelWords = enemy.type === "boss"
          ? ["ZAP!", "KABOOM!", "VICTORY!"]
          : isHeadshot
          ? ["CRACK!", "HEADSHOT!", "K.O.!"]
          : ["POW!", `x${this.combo}!`, "K.O.!"];
        this.callbacks.onKillPanel(panelWords);
      }

      if (this.getAliveEnemiesCount() === 0 && this.callbacks.onLevelClear) {
        setTimeout(() => this.callbacks.onLevelClear(), 900);
      }
    }
  }

  _explodeBarrel(prop) {
    if (!prop.active) return;
    prop.active = false;
    const pos = prop.mesh.position.clone();
    this.levelRoot.remove(prop.mesh);
    this.hitTargets = this.hitTargets.filter((m) => m !== prop.mesh);

    this.audio.playExplosion();
    this.shake = 16;
    this.hitstop = 0.045;

    this.spawnPopup(pos.clone().add(new THREE.Vector3(0, 1.6, 0)), "KABOOM!", "#ff7a00", 1.75);
    this._spawnParticles(pos, 0xff7a00, 20);
    this._spawnParticles(pos, 0xffe01b, 14);
    this._spawnShockwave(pos, 0xff7a00);

    if (this.callbacks.onKillPanel) {
      this.callbacks.onKillPanel(["BOOM!", "KABOOM!", "SMASH!"]);
    }

    const radius = 11.0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dist = e.root.position.distanceTo(pos);
      if (dist < radius) {
        const dmg = Math.round(150 * (1 - dist / (radius + 2)));
        this._damageEnemy(e, dmg, true, "BOOM!");
      }
    }

    for (const other of this.props) {
      if (other.active && other.type === "barrel" && other !== prop) {
        if (other.mesh.position.distanceTo(pos) < radius) {
          setTimeout(() => this._explodeBarrel(other), 130);
        }
      }
    }

    const pDist = this.player.pos.distanceTo(new THREE.Vector3(pos.x, this.player.pos.y, pos.z));
    if (pDist < 7.5) {
      this._damagePlayer(Math.round(24 * (1 - pDist / 8.5)));
    }
  }

  _damagePlayer(amount) {
    if (this.player.hp <= 0 || this.player.dashTimer > 0) return;
    this.player.hp = Math.max(0, this.player.hp - amount);
    this.player.hurtTimer = 0.25;
    this.shake = Math.min(16, this.shake + 8);
    this.audio.playHurt();
    if (this.callbacks.onPlayerHurt) this.callbacks.onPlayerHurt();
    if (this.player.hp <= 0 && this.callbacks.onGameOver) this.callbacks.onGameOver();
  }

  update(dt) {
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }

    const p = this.player;
    if (p.hurtTimer > 0) p.hurtTimer = Math.max(0, p.hurtTimer - dt);
    if (p.fireTimer > 0) p.fireTimer = Math.max(0, p.fireTimer - dt);
    if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 42);
    if (this.speedLineAlpha > 0) this.speedLineAlpha = Math.max(0, this.speedLineAlpha - dt * 3.0);

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // 键盘视角辅助旋转
    if (this.keys["ArrowLeft"]) p.yaw += 2.3 * dt;
    if (this.keys["ArrowRight"]) p.yaw -= 2.3 * dt;

    // 水平移动
    const move = new THREE.Vector3();
    if (p.dashTimer > 0) {
      p.dashTimer -= dt;
      move.copy(p.dashDir).multiplyScalar(25.0);
    } else {
      const forward = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
      if (this.keys["KeyW"] || this.keys["ArrowUp"]) move.add(forward);
      if (this.keys["KeyS"] || this.keys["ArrowDown"]) move.sub(forward);
      if (this.keys["KeyD"]) move.add(right);
      if (this.keys["KeyA"]) move.sub(right);
      if (move.lengthSq() > 0) {
        const spd = this.weapons.isAds ? p.speed * 0.65 : p.speed;
        move.normalize().multiplyScalar(spd);
      }
    }

    const isMoving = move.lengthSq() > 0.1;
    const radius = 0.65;
    const nextX = p.pos.x + move.x * dt;
    if (!this._isBlocked(nextX + Math.sign(move.x) * radius, p.pos.z, p.pos.y)) {
      p.pos.x = nextX;
    }
    const nextZ = p.pos.z + move.z * dt;
    if (!this._isBlocked(p.pos.x, nextZ + Math.sign(move.z) * radius, p.pos.y)) {
      p.pos.z = nextZ;
    }

    // 垂直重力与跳跃
    p.velY -= 24.0 * dt;
    p.pos.y += p.velY * dt;
    const groundY = this._groundHeightAt(p.pos.x, p.pos.z);
    if (p.pos.y <= groundY) {
      p.pos.y = groundY;
      p.velY = 0;
      p.onGround = true;
    } else {
      p.onGround = false;
    }

    if (isMoving && p.onGround) {
      p.bobPhase += dt * 11.5;
    }

    // 动态平滑 FOV（ADS 机瞄缩放 / Dash 速度拉伸）
    const targetFov = p.dashTimer > 0
      ? 85
      : THREE.MathUtils.lerp(this.baseFov, this.weapons.current.adsFov, this.weapons.adsAmount);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 14);
      this.camera.updateProjectionMatrix();
    }

    this._syncCamera(dt);

    // 武器更新与连发
    this.weapons.update(dt, isMoving && p.onGround);
    if (this.mouseDown && this.weapons.current.auto) {
      this.fireWeapon();
    }

    // 道具拾取与弹跳板
    this._updateProps(dt);
    // 敌人 AI 与弹幕
    this._updateEnemies(dt);
    this._updateProjectiles(dt);
    this._updateFX(dt);
  }

  _syncCamera() {
    const p = this.player;
    const bob = p.onGround ? Math.sin(p.bobPhase) * 0.055 : 0;
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.015 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.015 : 0;

    this.camera.position.set(p.pos.x + sx, p.pos.y + this.eyeHeight + bob + sy, p.pos.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0, "YXZ");
  }

  _updateProps(dt) {
    const p = this.player;
    const t = performance.now() * 0.003;
    for (const pr of this.props) {
      if (!pr.active) continue;
      if (pr.type === "medkit" || pr.type === "ammo") {
        pr.mesh.rotation.y += dt * 2.2;
        pr.mesh.position.y = 0.55 + Math.sin(t + pr.id) * 0.12;
        const dist = Math.hypot(pr.x - p.pos.x, pr.z - p.pos.z);
        if (dist < 1.65 && Math.abs(p.pos.y) < 1.5) {
          if (pr.type === "medkit" && p.hp < p.maxHp) {
            pr.active = false;
            this.levelRoot.remove(pr.mesh);
            p.hp = Math.min(p.maxHp, p.hp + 35);
            this.audio.playPickup();
            this.spawnPopup(new THREE.Vector3(pr.x, 1.4, pr.z), "+35 HP!", "#38e54d", 1.15);
          } else if (pr.type === "ammo") {
            pr.active = false;
            this.levelRoot.remove(pr.mesh);
            this.weapons.addAmmo();
            this.audio.playPickup();
            this.spawnPopup(new THREE.Vector3(pr.x, 1.4, pr.z), "+AMMO!", "#ffe01b", 1.15);
          }
        }
      } else if (pr.type === "jumppad") {
        if (pr.ring) pr.ring.position.y = 0.22 + Math.sin(t * 2.5) * 0.1;
        const dist = Math.hypot(pr.x - p.pos.x, pr.z - p.pos.z);
        if (dist < 1.35 && p.pos.y < 0.8 && p.velY <= 1) {
          p.velY = 14.8;
          p.onGround = false;
          this.audio.playJump();
          this.spawnPopup(new THREE.Vector3(pr.x, 1.6, pr.z), "BOING!", "#00ffaa", 1.25);
        }
      }
    }
  }

  _updateEnemies(dt) {
    const pPos = new THREE.Vector3(this.player.pos.x, this.player.pos.y + 1.2, this.player.pos.z);

    for (const e of this.enemies) {
      if (!e.alive) {
        if (e.deathAnim < 1) {
          e.deathAnim = Math.min(1, e.deathAnim + dt * 3.8);
          e.root.rotation.x = -e.deathAnim * (Math.PI / 2);
          e.root.position.y = -e.deathAnim * 0.15;
        }
        continue;
      }

      if (e.hurtTimer > 0) {
        e.hurtTimer -= dt;
        if (e.hurtTimer <= 0) {
          e.meshes.forEach((m) => m.material.color.setHex(m.userData.baseColor));
        }
      }

      if (e.bodyParts.halo) {
        e.bodyParts.halo.rotation.z += dt * 2.4;
      }

      const eEye = new THREE.Vector3(e.root.position.x, 1.8 * e.scale, e.root.position.z);
      const dx = pPos.x - eEye.x;
      const dz = pPos.z - eEye.z;
      const dist = Math.hypot(dx, dz);
      const canSee = dist < e.range + 6 && this._hasLineOfSight(eEye, pPos);

      if (canSee && !e.alerted) {
        e.alerted = true;
        this.spawnPopup(eEye.clone().add(new THREE.Vector3(0, 0.8, 0)), e.taunt, "#ffffff", 0.9);
      }
      if (!e.alerted) continue;

      // 面向玩家
      e.root.rotation.y = Math.atan2(dx, dz);

      // 追击与左右横移
      e.strafeTimer -= dt;
      if (e.strafeTimer <= 0) {
        e.strafeDir *= -1;
        e.strafeTimer = 1.1 + Math.random() * 1.4;
      }

      const nx = dx / (dist || 1);
      const nz = dz / (dist || 1);
      let vx = 0;
      let vz = 0;
      if (dist > 7.5) {
        vx += nx * e.speed;
        vz += nz * e.speed;
      }
      if (canSee && dist < 20) {
        vx += -nz * e.strafeDir * e.speed * 0.65;
        vz += nx * e.strafeDir * e.speed * 0.65;
      }

      const nextX = e.root.position.x + vx * dt;
      const nextZ = e.root.position.z + vz * dt;
      if (!this._isBlocked(nextX + Math.sign(vx) * 0.65, e.root.position.z, 0)) e.root.position.x = nextX;
      if (!this._isBlocked(e.root.position.x, nextZ + Math.sign(vz) * 0.65, 0)) e.root.position.z = nextZ;

      // 奔跑摆腿动画
      e.animPhase += dt * 9;
      const swing = Math.sin(e.animPhase) * 0.45;
      e.bodyParts.legL.rotation.x = swing;
      e.bodyParts.legR.rotation.x = -swing;

      // 发射可见 3D 漫画弹幕
      if (canSee && dist < e.range) {
        e.attackCooldown -= dt;
        if (e.attackCooldown <= 0) {
          e.attackCooldown = e.fireRate * (0.85 + Math.random() * 0.35);
          this._fireEnemyProjectile(e, eEye, pPos);
        }
      }
    }
  }

  _fireEnemyProjectile(enemy, from, target) {
    this.audio.playEnemyShot();
    const shots = enemy.type === "boss" ? 3 : 1;
    const baseDir = new THREE.Vector3().subVectors(target, from).normalize();
    const spd = enemy.type === "sniper" ? 32 : enemy.type === "boss" ? 21 : 17;

    for (let i = 0; i < shots; i++) {
      const dir = baseDir.clone();
      if (shots > 1) {
        const angle = (i - 1) * 0.14;
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      } else {
        dir.x += (Math.random() - 0.5) * 0.04;
        dir.z += (Math.random() - 0.5) * 0.04;
        dir.normalize();
      }

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(enemy.type === "boss" ? 0.28 : 0.18, 8, 8),
        new THREE.MeshBasicMaterial({ color: enemy.projColor })
      );
      this.assets.addOutline(mesh, 1.35);
      mesh.position.copy(from).addScaledVector(dir, 0.8);
      this.levelRoot.add(mesh);

      this.enemyProjectiles.push({
        mesh,
        vel: dir.multiplyScalar(spd),
        dmg: enemy.dmg,
        age: 0,
        life: 3.2,
      });
    }
  }

  _updateProjectiles(dt) {
    const pCenter = new THREE.Vector3(this.player.pos.x, this.player.pos.y + 1.15, this.player.pos.z);

    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const pr = this.enemyProjectiles[i];
      pr.age += dt;
      pr.mesh.position.addScaledVector(pr.vel, dt);

      let remove = pr.age >= pr.life;
      if (!remove && this._isBlocked(pr.mesh.position.x, pr.mesh.position.z, pr.mesh.position.y)) {
        this._spawnParticles(pr.mesh.position, 0xffe01b, 3);
        remove = true;
      }
      if (!remove && pr.mesh.position.distanceTo(pCenter) < 0.95) {
        this._damagePlayer(pr.dmg);
        remove = true;
      }

      if (remove) {
        this.levelRoot.remove(pr.mesh);
        this.enemyProjectiles.splice(i, 1);
      }
    }
  }

  _updateFX(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.age += dt;
      tr.mesh.material.opacity = Math.max(0, 1 - tr.age / tr.life);
      if (tr.age >= tr.life) {
        this.levelRoot.remove(tr.mesh);
        this.tracers.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.age += dt;
      pt.vel.y -= 18 * dt;
      pt.mesh.position.addScaledVector(pt.vel, dt);
      pt.mesh.rotation.x += dt * 7;
      pt.mesh.rotation.y += dt * 5;
      if (pt.mesh.position.y < 0.1) pt.mesh.position.y = 0.1;
      if (pt.age >= pt.life) {
        this.levelRoot.remove(pt.mesh);
        this.particles.splice(i, 1);
      }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.age += dt;
      const t = sw.age / sw.life;
      sw.mesh.scale.setScalar(1 + t * 14);
      sw.mesh.material.opacity = Math.max(0, 1 - t);
      if (sw.age >= sw.life) {
        this.levelRoot.remove(sw.mesh);
        this.shockwaves.splice(i, 1);
      }
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.age += dt;
      pop.pos.y += dt * 1.45;
      if (pop.age >= pop.life) this.popups.splice(i, 1);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this._render2DOverlay();
  }

  _projectToScreen(worldPos) {
    const v = worldPos.clone().project(this.camera);
    if (v.z > 1) return null; // 在镜头背后
    return {
      x: (v.x * 0.5 + 0.5) * this.viewW,
      y: (-v.y * 0.5 + 0.5) * this.viewH,
      dist: worldPos.distanceTo(this.camera.position),
    };
  }

  _render2DOverlay() {
    const ctx = this.fxCtx;
    const W = this.viewW;
    const H = this.viewH;
    ctx.clearRect(0, 0, W, H);

    // 1. 受伤敌人的头顶漫画血条
    for (const e of this.enemies) {
      if (!e.alive || e.hp >= e.maxHp || e.type === "boss") continue;
      const headTop = new THREE.Vector3(e.root.position.x, 2.7 * e.scale, e.root.position.z);
      const sp = this._projectToScreen(headTop);
      if (!sp || sp.dist > 45) continue;
      const bw = Math.max(38, Math.min(84, 720 / sp.dist));
      const bh = 8;
      ctx.fillStyle = "#101016";
      ctx.fillRect(sp.x - bw / 2 - 2, sp.y - 2, bw + 4, bh + 4);
      ctx.fillStyle = "#2b2833";
      ctx.fillRect(sp.x - bw / 2, sp.y, bw, bh);
      ctx.fillStyle = "#ff2a44";
      ctx.fillRect(sp.x - bw / 2, sp.y, bw * Math.max(0, e.hp / e.maxHp), bh);
    }

    // 2. 3D 投影漫画拟声词气泡
    for (const pop of this.popups) {
      const sp = this._projectToScreen(pop.pos);
      if (!sp) continue;
      const progress = pop.age / pop.life;
      const alpha = progress > 0.72 ? 1 - (progress - 0.72) / 0.28 : 1;
      const bounce = progress < 0.18 ? 0.55 + (progress / 0.18) * 0.6 : 1.05;
      const fontSize = Math.max(18, Math.min(48, (320 / Math.max(5, sp.dist)) * pop.scale * bounce));

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(sp.x, sp.y);
      ctx.rotate(-0.11);

      const spikes = 10;
      const rx = fontSize * (pop.text.length * 0.36 + 0.52);
      const ry = fontSize * 0.76;
      ctx.fillStyle = pop.color;
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const ang = (i / (spikes * 2)) * Math.PI * 2;
        const mult = i % 2 === 0 ? 1.15 : 0.76;
        const px = Math.cos(ang) * rx * mult;
        const py = Math.sin(ang) * ry * mult;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.font = `900 ${Math.round(fontSize)}px Impact, "Arial Black", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#101016";
      ctx.strokeText(pop.text, 0, 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(pop.text, 0, 2);
      ctx.restore();
    }

    // 3. 冲刺速度线
    if (this.speedLineAlpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = this.speedLineAlpha * 0.75;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      const cx = W / 2;
      const cy = H / 2;
      for (let i = 0; i < 28; i++) {
        const ang = (i / 28) * Math.PI * 2 + 0.05;
        const inner = Math.min(W, H) * (0.28 + (i % 3) * 0.05);
        const outer = Math.max(W, H) * 0.78;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
        ctx.lineTo(cx + Math.cos(ang) * outer, cy + Math.sin(ang) * outer);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 右上角雷达小地图
  drawMinimap(miniCtx) {
    const w = miniCtx.canvas.width;
    const h = miniCtx.canvas.height;
    miniCtx.clearRect(0, 0, w, h);
    if (!this.mapW) return;

    const cell = Math.min(w / this.mapW, h / this.mapH);
    const ox = (w - this.mapW * cell) / 2;
    const oy = (h - this.mapH * cell) / 2;

    miniCtx.fillStyle = "#14141e";
    miniCtx.fillRect(0, 0, w, h);

    for (let z = 0; z < this.mapH; z++) {
      for (let x = 0; x < this.mapW; x++) {
        const c = this.map[z][x];
        if (c > 0) {
          miniCtx.fillStyle = c === 6 ? "#b87828" : "#4b5878";
          miniCtx.fillRect(ox + x * cell, oy + z * cell, cell, cell);
        }
      }
    }

    for (const pr of this.props) {
      if (!pr.active) continue;
      miniCtx.fillStyle =
        pr.type === "barrel" ? "#ff7a00" :
        pr.type === "medkit" ? "#38e54d" :
        pr.type === "jumppad" ? "#00ffaa" : "#ffe01b";
      miniCtx.fillRect(ox + (pr.x / CELL_SIZE) * cell - 2, oy + (pr.z / CELL_SIZE) * cell - 2, 4, 4);
    }

    for (const e of this.enemies) {
      if (!e.alive) continue;
      miniCtx.fillStyle = e.type === "boss" ? "#ff2ebd" : "#ff2a44";
      miniCtx.beginPath();
      miniCtx.arc(ox + (e.root.position.x / CELL_SIZE) * cell, oy + (e.root.position.z / CELL_SIZE) * cell, e.type === "boss" ? 4.5 : 3, 0, Math.PI * 2);
      miniCtx.fill();
    }

    const px = ox + (this.player.pos.x / CELL_SIZE) * cell;
    const pz = oy + (this.player.pos.z / CELL_SIZE) * cell;
    miniCtx.strokeStyle = "#00e5ff";
    miniCtx.lineWidth = 2;
    miniCtx.beginPath();
    miniCtx.moveTo(px, pz);
    miniCtx.lineTo(px - Math.sin(this.player.yaw) * 11, pz - Math.cos(this.player.yaw) * 11);
    miniCtx.stroke();

    miniCtx.fillStyle = "#ffe01b";
    miniCtx.beginPath();
    miniCtx.arc(px, pz, 3.5, 0, Math.PI * 2);
    miniCtx.fill();
  }
}
