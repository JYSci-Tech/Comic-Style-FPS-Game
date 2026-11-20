import * as THREE from "three";
import { CELL_SIZE, COMIC_LEVELS } from "./levels.js";
import { WeaponSystem3D } from "./weapons.js";

export function createPlayer() {
  return {
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
    moveSpeedRatio: 0,
    grenades: 1,
    grenadeCooldown: 0,
  };
}

// 真 3D Three.js 美式漫画风 FPS 引擎（赛璐璐着色 + 墨线描边 + 真实爆头判定 + 3D 弹幕与特效）
export class ComicFPS3DEngine {
  constructor(glCanvas, fxCanvas, assets, audio, callbacks = {}) {
    this.glCanvas = glCanvas;
    this.fxCanvas = fxCanvas;
    this.fxCtx = fxCanvas?.getContext("2d");
    this.assets = assets;
    this.audio = audio;
    this.callbacks = callbacks;

    // WebGL 渲染器（原生高清 DPR，抗锯齿）
    if (glCanvas) {
      this.renderer = new THREE.WebGLRenderer({
        canvas: glCanvas,
        antialias: true,
        powerPreference: "high-performance",
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.BasicShadowMap;
    }

    // 场景与正确比例的透视相机
    this.scene = new THREE.Scene();
    this.baseFov = 72;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 16 / 9, 0.08, 220);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    // 3D 第一人称武器系统
    this.weapons = new WeaponSystem3D(glCanvas ? this.camera : null, this.assets, this.audio);

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
    this.player = createPlayer();

    this.enemies = [];
    this.props = [];
    this.movers = [];
    this.lasers = [];
    this.levelTime = 0;
    this.enemyProjectiles = [];
    this.projectileId = 0;
    this.grenades = [];
    this.grenadeId = 0;
    this.tracers = [];
    this.particles = [];
    this.shockwaves = [];
    this.popups = [];
    this.hitTargets = []; // 用于射线检测的所有可击中网格
    this.particleGeometry = glCanvas ? new THREE.BoxGeometry(0.22, 0.22, 0.22) : null;

    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.shake = 0;
    this.recoilPitch = 0;
    this.recoilRoll = 0;
    this.recoilFovKick = 0;
    this.hitstop = 0;
    this.speedLineAlpha = 0;

    this.keys = {};
    this.mouseDown = false;

    if (glCanvas) {
      this._handleResize();
      window.addEventListener("resize", () => this._handleResize());
    }
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

  loadLevel(idx, keepStats = false, arena = false) {
    this.levelIdx = idx;
    this.arena = arena;
    const lvl = COMIC_LEVELS[idx];
    this.level = lvl;
    this.map = lvl.map;
    this.mapH = this.map.length;
    this.mapW = this.map[0].length;

    this._clearGroup(this.levelRoot);
    this.enemies = [];
    this.props = [];
    this.movers = [];
    this.lasers = [];
    this.levelTime = 0;
    this.enemyProjectiles = [];
    this.projectileId = 0;
    this.grenades = [];
    this.grenadeId = 0;
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
    if (this.renderer) this._buildComicSkyline(worldW, worldH, lvl);

    // 玩家出生点
    this.player.pos.set(lvl.playerStart.x * CELL_SIZE, 0, lvl.playerStart.z * CELL_SIZE);
    this.player.velY = 0;
    this.player.onGround = true;
    this.player.yaw = lvl.playerStart.yaw;
    this.player.pitch = 0;
    this.player.dashTimer = 0;
    this.player.dashCooldown = 0;
    this.player.hurtTimer = 0;
    this.player.grenadeCooldown = 0;

    if (!keepStats) {
      this.player.hp = 100;
      this.player.grenades = 1;
      this.score = 0;
      this.kills = 0;
      this.combo = 0;
      this.comboTimer = 0;
      this.weapons.resetAll();
    } else {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 35);
      this.player.grenades = (this.player.grenades || 0) + 2;
    }

    // 生成 3D 关节敌人
    if (!arena) lvl.enemies.forEach((e, idx) => this._spawnEnemy(e, idx));
    // 生成 3D 道具与油桶
    lvl.props.forEach((p, idx) => this._spawnProp(p, idx));
    // 生成移动方块/浮空平台与周期激光封锁线
    if (lvl.movers) lvl.movers.forEach((m, idx) => this._spawnMover(m, idx));
    if (lvl.lasers) lvl.lasers.forEach((l, idx) => this._spawnLaser(l, idx));

    this.shake = 0;
    this._syncCamera(0);
  }

  _spawnMover(spec, id) {
    const baseX = spec.x * CELL_SIZE;
    const baseZ = spec.z * CELL_SIZE;
    const geo = new THREE.BoxGeometry(spec.w, spec.h, spec.d);
    const mat = this.assets.toonMat({ color: spec.color || 0xffe01b });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(baseX, spec.h / 2, baseZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.assets.addCreaseLines(mesh);
    // 顶部添加漫画高对比装饰条（可踩踏平台带青色/金色边框）
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(spec.w * 0.84, 0.12, spec.d * 0.84),
      this.assets.toonMat({ color: spec.rideable ? 0x181822 : 0xff2a44 })
    );
    cap.position.y = spec.h / 2 + 0.06;
    mesh.add(cap);
    mesh.userData = { kind: "wall" };
    this.levelRoot.add(mesh);
    this.hitTargets.push(mesh);

    this.movers.push({
      id,
      mesh,
      baseX,
      baseZ,
      x: baseX,
      z: baseZ,
      dx: 0,
      dz: 0,
      axis: spec.axis || "z",
      range: (spec.range || 2) * CELL_SIZE,
      speed: spec.speed || 1.2,
      phase: spec.phase || 0,
      w: spec.w,
      h: spec.h,
      d: spec.d,
      color: spec.color || 0xffe01b,
      rideable: !!spec.rideable,
    });
  }

  _spawnLaser(spec, id) {
    const x1 = spec.x1 * CELL_SIZE;
    const z1 = spec.z1 * CELL_SIZE;
    const x2 = spec.x2 * CELL_SIZE;
    const z2 = spec.z2 * CELL_SIZE;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const midX = (x1 + x2) / 2;
    const midZ = (z1 + z2) / 2;
    const yaw = Math.atan2(dx, dz);

    // 两端发射柱
    const pylonGeo = new THREE.CylinderGeometry(0.28, 0.34, 2.2, 8);
    const pylonMat = this.assets.toonMat({ color: 0x22222c });
    [[x1, z1], [x2, z2]].forEach(([px, pz]) => {
      const pylon = new THREE.Mesh(pylonGeo, pylonMat);
      pylon.position.set(px, 1.1, pz);
      this.assets.addOutline(pylon, 1.08);
      this.levelRoot.add(pylon);
    });

    // 3 道平行水平激光束（可用 SPACE 跳过或 SHIFT 冲刺无敌帧穿过）
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff2ebd, transparent: true, opacity: 0.92 });
    const beams = [];
    [0.5, 1.0, 1.45].forEach((by) => {
      const geo = new THREE.CylinderGeometry(0.085, 0.085, len, 8);
      geo.rotateX(Math.PI / 2);
      const beam = new THREE.Mesh(geo, beamMat);
      beam.position.set(midX, by, midZ);
      beam.rotation.y = yaw;
      this.levelRoot.add(beam);
      beams.push(beam);
    });

    this.lasers.push({
      id,
      x1,
      z1,
      x2,
      z2,
      len,
      period: spec.period || 4.2,
      duty: spec.duty || 0.5,
      phase: spec.phase || 0,
      beams,
      beamMat,
      active: true,
    });
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
    } else if (spec.type === "boostpad") {
      const g = new THREE.Group();
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 0.14, 2.1),
        this.assets.toonMat({ color: 0x00e5ff, emissive: 0x005577 })
      );
      this.assets.addOutline(pad, 1.05);
      const chevron = new THREE.Mesh(
        new THREE.ConeGeometry(0.55, 1.0, 3),
        new THREE.MeshBasicMaterial({ color: 0xffe01b })
      );
      chevron.rotation.x = -Math.PI / 2;
      chevron.position.y = 0.15;
      g.add(pad, chevron);
      g.position.set(wx, 0.07, wz);
      this.levelRoot.add(g);
      prop.mesh = g;
      prop.ring = chevron;
      prop.boostCooldown = 0;
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

  _isStaticBlocked(wx, wz, playerY = 0, radius = 0) {
    if (radius <= 0) {
      const c = this._cellAt(wx, wz);
      return c !== 0 && !(c === 6 && playerY >= 1.45);
    }
    const offsets = [
      [-radius, -radius],
      [radius, -radius],
      [-radius, radius],
      [radius, radius],
    ];
    for (const [ox, oz] of offsets) {
      const c = this._cellAt(wx + ox, wz + oz);
      if (c !== 0 && !(c === 6 && playerY >= 1.45)) return true;
    }
    return false;
  }

  _isBlocked(wx, wz, playerY = 0, radius = 0) {
    if (this._isStaticBlocked(wx, wz, playerY, radius)) return true;
    for (const m of this.movers) {
      if (Math.abs(wx - m.x) < m.w / 2 + radius && Math.abs(wz - m.z) < m.d / 2 + radius) {
        if (m.rideable && playerY >= m.h - 0.28) continue;
        if (playerY < m.h) return true;
      }
    }
    return false;
  }

  _groundHeightAt(wx, wz) {
    let h = this._cellAt(wx, wz) === 6 ? 1.65 : 0;
    for (const m of this.movers) {
      if (m.rideable && Math.abs(wx - m.x) < m.w / 2 + 0.35 && Math.abs(wz - m.z) < m.d / 2 + 0.35) {
        if (m.h > h) h = m.h;
      }
    }
    return h;
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
      for (const m of this.movers) {
        if (Math.abs(p.x - m.x) < m.w / 2 && Math.abs(p.z - m.z) < m.d / 2 && p.y < m.h) {
          return false;
        }
      }
    }
    return true;
  }

  handleMouseMove(dx, dy) {
    const sens = this.weapons.isScoped() ? 0.0007 : this.weapons.isAds ? 0.0014 : 0.0022;
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
      return true;
    }
    return false;
  }

  triggerDash() {
    if (this.player.dashCooldown > 0 || this.player.dashTimer > 0) return false;
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
    return true;
  }

  triggerMeleePunch() {
    if (!this.weapons.triggerPunch()) return false;
    const camPos = this.camera.position;
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let hit = false;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const toE = new THREE.Vector3(e.root.position.x - camPos.x, 0, e.root.position.z - camPos.z);
      const dist = toE.length();
      if (dist < 3.6 && toE.normalize().dot(new THREE.Vector3(camDir.x, 0, camDir.z).normalize()) > 0.45
        && (this.renderer || this._hasLineOfSight(camPos, e.root.position.clone().setY(1.2)))) {
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
    return true;
  }

  addShotRecoil(recoilKick = 1.0) {
    const adsScale = this.weapons?.isAds ? 0.72 : 1.0;
    const k = recoilKick * adsScale;
    this.shake = Math.min(20, this.shake + k * 7.8);
    this.recoilPitch = Math.min(0.11, this.recoilPitch + k * 0.036);
    this.recoilRoll = (Math.random() < 0.5 ? -1 : 1) * Math.min(0.055, k * 0.022);
    this.recoilFovKick = Math.min(4.2, this.recoilFovKick + k * 1.7);
  }

  _decayCameraRecoil(dt) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 38);
    const decay = Math.exp(-dt * 14);
    this.recoilPitch *= decay;
    this.recoilRoll *= decay;
    this.recoilFovKick *= Math.exp(-dt * 16);
    if (Math.abs(this.recoilPitch) < 0.0002) this.recoilPitch = 0;
    if (Math.abs(this.recoilRoll) < 0.0002) this.recoilRoll = 0;
    if (Math.abs(this.recoilFovKick) < 0.01) this.recoilFovKick = 0;
  }

  // 动态子弹散布：站立精准，移动 / 跳跃腾空 / 冲刺时适度增加散布惩罚
  getCurrentSpread() {
    const w = this.weapons.current;
    const p = this.player;
    const isAds = this.weapons.isAds;
    let spread = isAds ? w.adsSpread : w.spread;

    const moveRatio = Math.min(1, Math.max(0, p.moveSpeedRatio || 0));
    if (moveRatio > 0.05) {
      spread += (isAds ? 0.007 : 0.015) * moveRatio;
    }
    if (!p.onGround) {
      spread += isAds ? 0.018 : 0.032;
    }
    if (p.dashTimer > 0) {
      spread += 0.042;
    }
    return spread;
  }

  fireWeapon(targets = this.hitTargets) {
    if (!this.weapons.canFire()) return;
    const w = this.weapons.consumeShot();
    this.callbacks.onShot?.(this.weapons.currentIdx);
    this.player.fireTimer = 0.22;
    this.addShotRecoil(w.recoilKick);

    const muzzlePos = this.renderer ? this.weapons.getMuzzleWorldPosition() : this.camera.position;
    const spread = this.getCurrentSpread();

    let hitAny = false;
    let critAny = false;
    this.camera.updateMatrixWorld();

    for (let p = 0; p < w.pellets; p++) {
      // 圆形均匀散布采样，比方形散布更自然
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * spread;
      const ndcX = Math.cos(ang) * rad;
      const ndcY = Math.sin(ang) * rad;
      this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
      const hit = this.raycaster.intersectObjects(targets, false).find(({ distance, object }) => {
        const { enemy, prop, player } = object.userData;
        return (this.renderer || distance <= 55) && (enemy?.alive ?? prop?.active ?? (!player || player.hp > 0));
      });

      let endPoint = this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, 55);

      if (hit) {
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
        } else if (ud.kind === "player") {
          const isHead = !!ud.isHead;
          const dmg = isHead ? Math.round(w.damage * w.headshotMult) : w.damage;
          if (this.callbacks.onPlayerHit?.(ud.player, dmg)) {
            hitAny = true;
            critAny ||= isHead;
            this.spawnPopup(
              hit.point.clone().add(new THREE.Vector3(0, 0.25, 0)),
              isHead ? `-${dmg} ★` : `-${dmg}`,
              isHead ? "#ffe01b" : "#ffffff",
              isHead ? 1.18 : 0.92,
              isHead ? "headshot" : "dmg"
            );
            this._spawnParticles(hit.point, isHead ? 0xffe01b : 0xff2a44, isHead ? 7 : 4);
          }
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
    if (!this.renderer) {
      this.callbacks.onTracer?.(end);
      return;
    }
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
    if (!this.renderer) return;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(this.particleGeometry, mat);
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
    if (!this.renderer) return;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.14, 8, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(pos.x, 0.5, pos.z);
    this.levelRoot.add(ring);
    this.shockwaves.push({ mesh: ring, age: 0, life: 0.36 });
  }

  spawnPopup(pos, text, color = "#ffe01b", scale = 1.0, kind = "bubble") {
    if (!this.renderer) {
      this.callbacks.onPopup?.(pos, text, color, scale, kind);
      return;
    }
    this.popups.push({
      pos: pos.clone(),
      text,
      color,
      scale,
      kind,
      age: 0,
      life: kind === "dmg" ? 0.62 : kind === "headshot" ? 0.72 : 0.78,
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

    // 显示扣血点数（爆头额外带金色星标与微光环特效）
    this.spawnPopup(
      fxPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.35, (Math.random() - 0.5) * 0.3)),
      isHeadshot ? `-${dmg} ★` : `-${dmg}`,
      isHeadshot ? "#ffe01b" : "#ffffff",
      isHeadshot ? 1.2 : 0.94,
      isHeadshot ? "headshot" : "dmg"
    );
    this._spawnParticles(fxPos, isHeadshot ? 0xffe01b : 0xff2a44, isHeadshot ? 9 : 5);

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
        setTimeout(() => {
          if (this.enemies.includes(enemy)) this.callbacks.onLevelClear();
        }, 900);
      }
    }
  }

  _explodeBarrel(prop, players = this.damageablePlayers || [this.player]) {
    if (!prop.active) return;
    prop.active = false;
    const pos = prop.mesh.position.clone();
    this.levelRoot.remove(prop.mesh);
    this.hitTargets = this.hitTargets.filter((m) => m !== prop.mesh);

    this.audio.playExplosion();
    this.callbacks.onExplosion?.(pos);
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
          if (this.renderer) {
            setTimeout(() => {
              if (this.props.includes(other)) this._explodeBarrel(other);
            }, 130);
          } else {
            this._explodeBarrel(other, players);
          }
        }
      }
    }

    for (const player of players) {
      const dist = Math.hypot(pos.x - player.pos.x, pos.z - player.pos.z);
      if (dist < 7.5) this._damagePlayer(Math.round(24 * (1 - dist / 8.5)), player);
    }
  }

  _damagePlayer(amount, player = this.player) {
    if (player.hp <= 0 || player.dashTimer > 0 || player.protection > 0) return false;
    player.hp = Math.max(0, player.hp - amount);
    player.hurtTimer = 0.25;
    this.shake = Math.min(16, this.shake + 8);
    this.audio.playHurt();
    this.callbacks.onPlayerHurt?.(player);
    if (player.hp <= 0) this.callbacks.onGameOver?.(player);
    return true;
  }

  update(dt) {
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }

    this.levelTime += dt;
    this._updateDynamics(dt, [this.player], true);
    this._updateCombo(dt);
    this._updatePlayer(dt);
    if (this.mouseDown && this.weapons.current.auto) this.fireWeapon();
    this._updateProps(dt);
    this._updateEnemies(dt);
    this._updateProjectiles(dt);
    this._updateGrenades(dt, [this.player]);
    this._updateFX(dt);
  }

  _makeGrenadeMesh() {
    if (!this.renderer) {
      return { mesh: new THREE.Object3D(), led: null };
    }
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 10, 10),
      this.assets.toonMat({ color: 0x2e7d32 })
    );
    body.scale.set(1, 1.18, 1);
    this.assets.addOutline(body, 1.12);

    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.08, 10),
      this.assets.toonMat({ color: 0xffe01b })
    );
    this.assets.addOutline(band, 1.08);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.12, 8),
      this.assets.toonMat({ color: 0x37474f })
    );
    cap.position.y = 0.28;

    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2a44 })
    );
    led.position.y = 0.36;

    g.add(body, band, cap, led);
    return { mesh: g, led };
  }

  throwGrenade(owner = this.player) {
    if (owner.hp <= 0 || owner.grenades <= 0 || owner.grenadeCooldown > 0) return false;
    owner.grenades -= 1;
    owner.grenadeCooldown = 0.55;

    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(owner.pitch, owner.yaw, 0, "YXZ")).normalize();
    const right = new THREE.Vector3(Math.cos(owner.yaw), 0, -Math.sin(owner.yaw));
    const spawnPos = new THREE.Vector3(owner.pos.x, owner.pos.y + this.eyeHeight - 0.12, owner.pos.z)
      .addScaledVector(dir, 0.85)
      .addScaledVector(right, 0.22);

    const { mesh, led } = this._makeGrenadeMesh();
    mesh.position.copy(spawnPos);
    this.levelRoot.add(mesh);

    const vel = dir.multiplyScalar(20.5);
    vel.y += 5.4;

    this.grenades.push({
      id: ++this.grenadeId,
      owner,
      mesh,
      led,
      vel,
      fuse: 1.45,
    });

    this.audio.playThrow();
    this.callbacks.onGrenadeThrow?.(owner);
    return true;
  }

  _updateGrenades(dt, players = [this.player]) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.vel.y -= 24.0 * dt;

      const radius = 0.26;
      const nextX = g.mesh.position.x + g.vel.x * dt;
      if (this._isBlocked(nextX, g.mesh.position.z, g.mesh.position.y, radius)) {
        g.vel.x *= -0.52;
      } else {
        g.mesh.position.x = nextX;
      }

      const nextZ = g.mesh.position.z + g.vel.z * dt;
      if (this._isBlocked(g.mesh.position.x, nextZ, g.mesh.position.y, radius)) {
        g.vel.z *= -0.52;
      } else {
        g.mesh.position.z = nextZ;
      }

      g.mesh.position.y += g.vel.y * dt;
      const floorY = this._groundHeightAt(g.mesh.position.x, g.mesh.position.z) + 0.26;
      if (g.mesh.position.y <= floorY) {
        g.mesh.position.y = floorY;
        if (Math.abs(g.vel.y) > 2.2) {
          g.vel.y = -g.vel.y * 0.48;
        } else {
          g.vel.y = 0;
        }
        g.vel.x *= 0.78;
        g.vel.z *= 0.78;
      }

      g.mesh.rotation.x += dt * 9;
      g.mesh.rotation.z += dt * 7;

      if (g.led) {
        const blinkRate = g.fuse < 0.55 ? 24 : 10;
        g.led.material.color.setHex(Math.floor(g.fuse * blinkRate) % 2 === 0 ? 0xff2a44 : 0xffe01b);
      }

      // 贴脸直接命中敌方单位或敌人直接引爆
      let directHit = false;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.root.position.x - g.mesh.position.x, e.root.position.z - g.mesh.position.z);
        if (d < 1.15 * e.scale && g.mesh.position.y < 2.6 * e.scale) {
          directHit = true;
          break;
        }
      }
      if (!directHit) {
        for (const pl of players) {
          if (pl === g.owner || pl.hp <= 0) continue;
          const d = Math.hypot(pl.pos.x - g.mesh.position.x, pl.pos.z - g.mesh.position.z);
          if (d < 1.05 && Math.abs(g.mesh.position.y - (pl.pos.y + 1.0)) < 1.2) {
            directHit = true;
            break;
          }
        }
      }

      if (g.fuse <= 0 || directHit) {
        this._detonateGrenade(g, players);
        this.levelRoot.remove(g.mesh);
        this.grenades.splice(i, 1);
      }
    }
  }

  _detonateGrenade(g, players = [this.player]) {
    const pos = g.mesh.position.clone();
    this.audio.playExplosion();
    this.shake = 18;
    this.hitstop = 0.04;
    this.callbacks.onExplosion?.(pos);

    this.spawnPopup(pos.clone().add(new THREE.Vector3(0, 1.5, 0)), "KABOOM!", "#ff7a00", 1.7);
    this._spawnParticles(pos, 0xff7a00, 22);
    this._spawnParticles(pos, 0xffe01b, 14);
    this._spawnShockwave(pos, 0xff7a00);

    const radius = 12.0;
    let hitEnemyOrRival = false;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dist = e.root.position.distanceTo(pos);
      if (dist < radius) {
        hitEnemyOrRival = true;
        const dmg = Math.max(55, Math.round(165 * (1 - dist / (radius + 2.5))));
        this._damageEnemy(e, dmg, dist < 3.6, "BOOM!", e.root.position.clone().setY(1.6 * e.scale));
      }
    }

    for (const pr of this.props) {
      if (pr.active && pr.type === "barrel") {
        if (pr.mesh.position.distanceTo(pos) < radius * 0.85) {
          setTimeout(() => this._explodeBarrel(pr), 90);
        }
      }
    }

    for (const pl of players) {
      if (pl.hp <= 0) continue;
      const dist = Math.hypot(pos.x - pl.pos.x, pos.z - pl.pos.z);
      if (pl === g.owner) {
        if (dist < 5.2) this._damagePlayer(Math.round(28 * (1 - dist / 6.0)), pl);
      } else if (this.arena && dist < 11.5) {
        const dmg = Math.max(35, Math.round(125 * (1 - dist / 13.5)));
        const hitOk = this.callbacks.onPlayerHit
          ? this.callbacks.onPlayerHit(pl, dmg, g.owner)
          : this._damagePlayer(dmg, pl);
        if (hitOk) {
          hitEnemyOrRival = true;
          this.spawnPopup(pl.pos.clone().add(new THREE.Vector3(0, 1.7, 0)), `-${dmg}`, "#ff7a00", 1.1, "dmg");
        }
      }
    }

    if (hitEnemyOrRival) {
      this.audio.playHit(true);
      this.callbacks.onHit?.(true, g.owner);
    }
  }

  _updateDynamics(dt, players = [this.player], applyHazard = true) {
    // 1. 更新移动方块 / 可踩踏浮空平台
    for (const m of this.movers) {
      const prevX = m.x;
      const prevZ = m.z;
      const offset = Math.sin(this.levelTime * m.speed + m.phase) * m.range;
      m.x = m.axis === "x" ? m.baseX + offset : m.baseX;
      m.z = m.axis === "z" ? m.baseZ + offset : m.baseZ;
      m.dx = m.x - prevX;
      m.dz = m.z - prevZ;
      m.mesh.position.set(m.x, m.h / 2, m.z);

      if (!applyHazard) continue;
      const pRadius = 0.68;
      // 玩家站在可踩踏移动平台上时随平台一同移动；否则被移动方块推开，彻底避免穿模
      for (const pl of players) {
        if (pl.hp <= 0) continue;
        const onTop = m.rideable && pl.pos.y >= m.h - 0.32 && Math.abs(pl.pos.x - prevX) < m.w / 2 + 0.45 && Math.abs(pl.pos.z - prevZ) < m.d / 2 + 0.45;
        if (onTop) {
          if (!this._isStaticBlocked(pl.pos.x + m.dx, pl.pos.z, pl.pos.y, pRadius)) pl.pos.x += m.dx;
          if (!this._isStaticBlocked(pl.pos.x, pl.pos.z + m.dz, pl.pos.y, pRadius)) pl.pos.z += m.dz;
          continue;
        }
        const halfW = m.w / 2 + pRadius;
        const halfD = m.d / 2 + pRadius;
        const diffX = pl.pos.x - m.x;
        const diffZ = pl.pos.z - m.z;
        if (pl.pos.y < m.h - 0.12 && Math.abs(diffX) < halfW && Math.abs(diffZ) < halfD) {
          if (m.rideable && pl.pos.y >= m.h - 0.55) {
            pl.pos.y = m.h;
            pl.velY = Math.max(0, pl.velY);
            pl.onGround = true;
          } else {
            const penX = halfW - Math.abs(diffX);
            const penZ = halfD - Math.abs(diffZ);
            if (penX < penZ) {
              const pushX = pl.pos.x + (diffX >= 0 ? penX : -penX);
              if (!this._isStaticBlocked(pushX, pl.pos.z, pl.pos.y, pRadius)) pl.pos.x = pushX;
            } else {
              const pushZ = pl.pos.z + (diffZ >= 0 ? penZ : -penZ);
              if (!this._isStaticBlocked(pl.pos.x, pushZ, pl.pos.y, pRadius)) pl.pos.z = pushZ;
            }
          }
        }
      }

      // 同样推开接触到移动方块的存活敌人，防止敌人穿模进入移动物体
      const eRadius = 0.65;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const halfW = m.w / 2 + eRadius;
        const halfD = m.d / 2 + eRadius;
        const diffX = e.root.position.x - m.x;
        const diffZ = e.root.position.z - m.z;
        if (Math.abs(diffX) < halfW && Math.abs(diffZ) < halfD) {
          const penX = halfW - Math.abs(diffX);
          const penZ = halfD - Math.abs(diffZ);
          if (penX < penZ) {
            const pushX = e.root.position.x + (diffX >= 0 ? penX : -penX);
            if (!this._isStaticBlocked(pushX, e.root.position.z, 0, eRadius)) e.root.position.x = pushX;
          } else {
            const pushZ = e.root.position.z + (diffZ >= 0 ? penZ : -penZ);
            if (!this._isStaticBlocked(e.root.position.x, pushZ, 0, eRadius)) e.root.position.z = pushZ;
          }
        }
      }
    }

    // 2. 更新周期性安保激光封锁线
    for (const l of this.lasers) {
      const phasePos = ((this.levelTime + l.phase) % l.period) / l.period;
      const isOn = phasePos < l.duty;
      const isWarn = !isOn && phasePos > 0.86;
      l.active = isOn;

      for (const beam of l.beams) {
        beam.visible = isOn || isWarn;
        beam.scale.set(isOn ? 1 : 0.35, 1, isOn ? 1 : 0.35);
      }
      l.beamMat.color.setHex(isOn ? 0xff2ebd : 0xffe01b);
      l.beamMat.opacity = isOn ? 0.92 : (Math.floor(this.levelTime * 16) % 2 === 0 ? 0.6 : 0.15);

      if (!applyHazard || !isOn) continue;
      for (const pl of players) {
        if (pl.hp <= 0 || pl.pos.y > 1.55) continue; // 跳跃可越过激光
        if (pl.laserCooldown > 0) {
          pl.laserCooldown -= dt;
          continue;
        }
        // 计算玩家到激光线段的距离
        const vx = l.x2 - l.x1;
        const vz = l.z2 - l.z1;
        const t = Math.max(0, Math.min(1, ((pl.pos.x - l.x1) * vx + (pl.pos.z - l.z1) * vz) / (vx * vx + vz * vz || 1)));
        const cx = l.x1 + t * vx;
        const cz = l.z1 + t * vz;
        if (Math.hypot(pl.pos.x - cx, pl.pos.z - cz) < 0.72) {
          if (this._damagePlayer(14, pl)) {
            pl.laserCooldown = 0.65;
            this.spawnPopup(new THREE.Vector3(pl.pos.x, 1.8, pl.pos.z), "ZAP!", "#ff2ebd", 1.15);
          }
        }
      }
    }
  }

  _updateCombo(dt) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
  }

  _updatePlayer(dt) {
    const p = this.player;
    if (p.hurtTimer > 0) p.hurtTimer = Math.max(0, p.hurtTimer - dt);
    if (p.fireTimer > 0) p.fireTimer = Math.max(0, p.fireTimer - dt);
    if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    if (p.grenadeCooldown > 0) p.grenadeCooldown = Math.max(0, p.grenadeCooldown - dt);
    this._decayCameraRecoil(dt);
    if (this.speedLineAlpha > 0) this.speedLineAlpha = Math.max(0, this.speedLineAlpha - dt * 3.0);

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
    const targetMoveRatio = isMoving ? 1 : 0;
    p.moveSpeedRatio += (targetMoveRatio - p.moveSpeedRatio) * Math.min(1, dt * 14);
    const radius = 0.68;
    const nextX = p.pos.x + move.x * dt;
    if (!this._isBlocked(nextX, p.pos.z, p.pos.y, radius)) {
      p.pos.x = nextX;
    }
    const nextZ = p.pos.z + move.z * dt;
    if (!this._isBlocked(p.pos.x, nextZ, p.pos.y, radius)) {
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

    // 动态平滑 FOV（ADS 机瞄缩放 / Dash 速度拉伸 / 开火后坐力脉冲）
    const baseTargetFov = p.dashTimer > 0
      ? 85
      : THREE.MathUtils.lerp(this.baseFov, this.weapons.current.adsFov, this.weapons.adsAmount);
    const targetFov = baseTargetFov + this.recoilFovKick;
    if (this.renderer && Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 18);
      this.camera.updateProjectionMatrix();
    }

    this._syncCamera(dt);

    // 武器更新与连发
    this.weapons.update(dt, isMoving && p.onGround);
  }

  _syncCamera() {
    const p = this.player;
    const bob = this.renderer && p.onGround ? Math.sin(p.bobPhase) * 0.055 : 0;
    const activeShake = this.renderer && this.shake > 0 ? this.shake : 0;
    const sx = activeShake ? (Math.random() - 0.5) * activeShake * 0.018 : 0;
    const sy = activeShake ? (Math.random() - 0.5) * activeShake * 0.018 : 0;
    const rotShakeX = activeShake ? (Math.random() - 0.5) * activeShake * 0.0032 : 0;
    const rotShakeY = activeShake ? (Math.random() - 0.5) * activeShake * 0.0028 : 0;
    const rotShakeZ = activeShake ? (Math.random() - 0.5) * activeShake * 0.0038 : 0;

    this.camera.position.set(p.pos.x + sx, p.pos.y + this.eyeHeight + bob + sy, p.pos.z);
    this.camera.rotation.set(
      p.pitch + (this.renderer ? this.recoilPitch + rotShakeX : 0),
      p.yaw + (this.renderer ? rotShakeY : 0),
      this.renderer ? this.recoilRoll + rotShakeZ : 0,
      "YXZ"
    );
  }

  _updateProps(dt, applyEffects = true) {
    const p = this.player;
    const t = performance.now() * 0.003;
    for (const pr of this.props) {
      if (!pr.active) continue;
      if (pr.type === "medkit" || pr.type === "ammo") {
        pr.mesh.rotation.y += dt * 2.2;
        pr.mesh.position.y = 0.55 + Math.sin(t + pr.id) * 0.12;
        if (!applyEffects) continue;
        const dist = Math.hypot(pr.x - p.pos.x, pr.z - p.pos.z);
        if (dist < 1.65 && Math.abs(p.pos.y) < 1.5) {
          if (pr.type === "medkit" && p.hp < p.maxHp) {
            pr.active = false;
            this.levelRoot.remove(pr.mesh);
            p.hp = Math.min(p.maxHp, p.hp + 35);
            this.audio.playPickup();
            this.callbacks.onPickup?.(p);
            this.spawnPopup(new THREE.Vector3(pr.x, 1.4, pr.z), "+35 HP!", "#38e54d", 1.15);
          } else if (pr.type === "ammo") {
            pr.active = false;
            this.levelRoot.remove(pr.mesh);
            this.weapons.addAmmo();
            this.audio.playPickup();
            this.callbacks.onPickup?.(p);
            this.spawnPopup(new THREE.Vector3(pr.x, 1.4, pr.z), "+AMMO!", "#ffe01b", 1.15);
          }
        }
      } else if (pr.type === "jumppad") {
        if (pr.ring) pr.ring.position.y = 0.22 + Math.sin(t * 2.5) * 0.1;
        if (!applyEffects) continue;
        const dist = Math.hypot(pr.x - p.pos.x, pr.z - p.pos.z);
        if (dist < 1.35 && p.pos.y < 0.8 && p.velY <= 1) {
          p.velY = 14.8;
          p.onGround = false;
          this.audio.playJump();
          this.callbacks.onBounce?.(p);
          this.spawnPopup(new THREE.Vector3(pr.x, 1.6, pr.z), "BOING!", "#00ffaa", 1.25);
        }
      } else if (pr.type === "boostpad") {
        if (pr.ring) pr.ring.rotation.y += dt * 3.2;
        if (pr.boostCooldown > 0) pr.boostCooldown -= dt;
        if (!applyEffects || pr.boostCooldown > 0) continue;
        const dist = Math.hypot(pr.x - p.pos.x, pr.z - p.pos.z);
        if (dist < 1.45 && p.pos.y < 0.9) {
          pr.boostCooldown = 0.75;
          p.dashDir.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)).normalize();
          p.dashTimer = 0.28;
          this.speedLineAlpha = 1.0;
          this.audio.playDash();
          this.callbacks.onBounce?.(p);
          this.spawnPopup(new THREE.Vector3(pr.x, 1.6, pr.z), "ZOOM!", "#00e5ff", 1.25);
        }
      }
    }
  }

  _updateEnemies(dt, players = [this.player]) {
    const targets = players.filter((player) => player.hp > 0)
      .map((player) => player.pos.clone().add(new THREE.Vector3(0, 1.2, 0)));

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
      let pPos;
      let seen;
      let nearest = Infinity;
      let nearestVisible = Infinity;
      for (const target of targets) {
        const distance = eEye.distanceToSquared(target);
        if (distance < nearest) {
          nearest = distance;
          pPos = target;
        }
        if (distance < nearestVisible && Math.hypot(target.x - eEye.x, target.z - eEye.z) < e.range + 6
          && this._hasLineOfSight(eEye, target)) {
          nearestVisible = distance;
          seen = target;
        }
      }
      if (!pPos) continue;
      pPos = seen || pPos;
      const canSee = Boolean(seen);
      const dx = pPos.x - eEye.x;
      const dz = pPos.z - eEye.z;
      const dist = Math.hypot(dx, dz);

      if (canSee && !e.alerted) {
        e.alerted = true;
        this.spawnPopup(eEye.clone().add(new THREE.Vector3(0, 0.8, 0)), e.taunt, "#ffffff", 0.9);
      }

      // 只有当主人公处于视线可见范围内时，NPC 才面向并向主人公方向移动与开火
      if (!canSee) {
        e.bodyParts.legL.rotation.x *= Math.max(0, 1 - dt * 10);
        e.bodyParts.legR.rotation.x *= Math.max(0, 1 - dt * 10);
        continue;
      }

      // 面向可见玩家
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
      if (dist < 20) {
        vx += -nz * e.strafeDir * e.speed * 0.65;
        vz += nx * e.strafeDir * e.speed * 0.65;
      }

      const nextX = e.root.position.x + vx * dt;
      const nextZ = e.root.position.z + vz * dt;
      const prevX = e.root.position.x;
      const prevZ = e.root.position.z;
      if (!this._isBlocked(nextX, e.root.position.z, 0, 0.65)) e.root.position.x = nextX;
      if (!this._isBlocked(e.root.position.x, nextZ, 0, 0.65)) e.root.position.z = nextZ;

      // 仅在实际位移时播放奔跑摆腿动画，避免原地踏步
      const moved = Math.hypot(e.root.position.x - prevX, e.root.position.z - prevZ) > 0.002;
      if (moved) {
        e.animPhase += dt * 9;
        const swing = Math.sin(e.animPhase) * 0.45;
        e.bodyParts.legL.rotation.x = swing;
        e.bodyParts.legR.rotation.x = -swing;
      } else {
        e.bodyParts.legL.rotation.x *= Math.max(0, 1 - dt * 10);
        e.bodyParts.legR.rotation.x *= Math.max(0, 1 - dt * 10);
      }

      // 发射可见 3D 漫画弹幕
      if (dist < e.range) {
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

      const mesh = this._makeProjectileMesh(enemy.type, enemy.projColor);
      mesh.position.copy(from).addScaledVector(dir, 0.8);
      this.levelRoot.add(mesh);

      this.enemyProjectiles.push({
        id: this.projectileId++,
        type: enemy.type,
        color: enemy.projColor,
        mesh,
        vel: dir.multiplyScalar(spd),
        dmg: enemy.dmg,
        age: 0,
        life: 3.2,
      });
    }
  }

  _makeProjectileMesh(type, color) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(type === "boss" ? 0.28 : 0.18, 8, 8),
      new THREE.MeshBasicMaterial({ color })
    );
    this.assets.addOutline(mesh, 1.35);
    return mesh;
  }

  _updateProjectiles(dt, players = [this.player]) {
    const targets = players.filter((player) => player.hp > 0)
      .map((player) => [player, player.pos.clone().add(new THREE.Vector3(0, 1.15, 0))]);

    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const pr = this.enemyProjectiles[i];
      pr.age += dt;
      pr.mesh.position.addScaledVector(pr.vel, dt);

      let remove = pr.age >= pr.life;
      if (!remove && this._isBlocked(pr.mesh.position.x, pr.mesh.position.z, pr.mesh.position.y)) {
        this._spawnParticles(pr.mesh.position, 0xffe01b, 3);
        remove = true;
      }
      if (!remove) {
        const target = targets.find(([player, center]) => player.hp > 0 && pr.mesh.position.distanceTo(center) < 0.95);
        if (target) {
          this._damagePlayer(pr.dmg, target[0]);
          remove = true;
        }
      }

      if (remove) {
        this._disposeTransientMesh(pr.mesh);
        this.enemyProjectiles.splice(i, 1);
      }
    }
  }

  _disposeTransientMesh(mesh) {
    mesh.removeFromParent();
    if (mesh.geometry !== this.particleGeometry) mesh.geometry.dispose();
    mesh.material.dispose();
  }

  _updateFX(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.age += dt;
      tr.mesh.material.opacity = Math.max(0, 1 - tr.age / tr.life);
      if (tr.age >= tr.life) {
        this._disposeTransientMesh(tr.mesh);
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
        this._disposeTransientMesh(pt.mesh);
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
        this._disposeTransientMesh(sw.mesh);
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

    // 2. 3D 投影漫画拟声词气泡 & 扣血点数 & 爆头微特效
    for (const pop of this.popups) {
      const sp = this._projectToScreen(pop.pos);
      if (!sp) continue;
      const progress = pop.age / pop.life;
      const alpha = progress > 0.68 ? 1 - (progress - 0.68) / 0.32 : 1;
      const bounce = progress < 0.16 ? 0.65 + (progress / 0.16) * 0.5 : 1.0;

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(sp.x, sp.y);

      if (pop.kind === "dmg" || pop.kind === "headshot") {
        const fontSize = Math.max(20, Math.min(44, (290 / Math.max(4.5, sp.dist)) * pop.scale * bounce));

        // 爆头额外克制特效：短暂扩张的金色光圈 + 4角小星芒（前 0.24 秒）
        if (pop.kind === "headshot" && pop.age < 0.26) {
          const hp = pop.age / 0.26;
          const r = fontSize * (0.45 + hp * 0.95);
          ctx.save();
          ctx.globalAlpha = Math.max(0, (1 - hp) * 0.9);
          ctx.strokeStyle = "#ffe01b";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          for (let i = 0; i < 4; i++) {
            const ang = (i * Math.PI) / 2 + Math.PI / 4;
            ctx.beginPath();
            ctx.moveTo(Math.cos(ang) * (r * 0.55), Math.sin(ang) * (r * 0.55));
            ctx.lineTo(Math.cos(ang) * (r * 1.25), Math.sin(ang) * (r * 1.25));
            ctx.stroke();
          }
          ctx.restore();
        }

        ctx.font = `900 ${Math.round(fontSize)}px Impact, "Arial Black", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = pop.kind === "headshot" ? 6 : 5;
        ctx.strokeStyle = "#101016";
        ctx.strokeText(pop.text, 0, 0);
        ctx.fillStyle = pop.kind === "headshot" ? "#ffe01b" : "#ffffff";
        ctx.fillText(pop.text, 0, 0);
        ctx.restore();
        continue;
      }

      const fontSize = Math.max(18, Math.min(48, (320 / Math.max(5, sp.dist)) * pop.scale * bounce));
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

    // 移动方块与激活激光线
    for (const m of this.movers) {
      miniCtx.fillStyle = m.rideable ? "#00e5ff" : "#ff7a00";
      const mw = (m.w / CELL_SIZE) * cell;
      const md = (m.d / CELL_SIZE) * cell;
      miniCtx.fillRect(ox + (m.x / CELL_SIZE) * cell - mw / 2, oy + (m.z / CELL_SIZE) * cell - md / 2, mw, md);
    }

    for (const l of this.lasers) {
      if (!l.active) continue;
      miniCtx.strokeStyle = "#ff2ebd";
      miniCtx.lineWidth = 2;
      miniCtx.beginPath();
      miniCtx.moveTo(ox + (l.x1 / CELL_SIZE) * cell, oy + (l.z1 / CELL_SIZE) * cell);
      miniCtx.lineTo(ox + (l.x2 / CELL_SIZE) * cell, oy + (l.z2 / CELL_SIZE) * cell);
      miniCtx.stroke();
    }

    for (const pr of this.props) {
      if (!pr.active) continue;
      miniCtx.fillStyle =
        pr.type === "barrel" ? "#ff7a00" :
        pr.type === "medkit" ? "#38e54d" :
        pr.type === "boostpad" ? "#00e5ff" :
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
