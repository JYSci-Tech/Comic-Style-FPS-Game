import * as THREE from "three";
import { CELL_SIZE, COMIC_LEVELS } from "./levels.js";
import { StreetScenery } from "./scenery.js";
import { WeaponSystem3D } from "./weapons.js";

const MAX_RENDER_PIXELS = 2_600_000;
const SHADOW_INTERVAL_MS = 1000 / 30;

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
    slideTimer: 0,
    slideCooldown: 0,
    slideAmount: 0,
    slideDir: new THREE.Vector3(),
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
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.shadowMap.autoUpdate = false;
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
    if (glCanvas) this.streetScenery = new StreetScenery(this.levelRoot, assets);

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
    this.grenadeAiming = false;
    this.grenadeAimKey = null;
    this.grenadeAimPhase = 0;
    this.grenadeAimGroup = null;
    this._grenadeAimParts = null;
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderDpr = Math.min(dpr, Math.max(1, Math.sqrt(MAX_RENDER_PIXELS / (w * h))));
    this.renderer.setDrawingBufferSize(w, h, renderDpr);
    this.fxCanvas.width = Math.floor(w * renderDpr);
    this.fxCanvas.height = Math.floor(h * renderDpr);
    this.fxCtx.setTransform(renderDpr, 0, 0, renderDpr, 0, 0);
    this.viewW = w;
    this.viewH = h;
    this.viewportRevision = (this.viewportRevision || 0) + 1;
  }

  _clearLevel() {
    if (this.renderer) {
      const sharedGeometries = new Set([this.particleGeometry, ...Object.values(this.streetScenery.shapes)]);
      const sharedMaterials = new Set([
        this.assets.inkMaterial, this.assets.edgeMaterial, this.streetScenery.solidMaterial,
        ...Object.values(this.assets.wallMaterials),
      ]);
      const geometries = new Set();
      const materials = new Set();
      const collect = (object) => {
        object.shadow?.dispose();
        if (object.isInstancedMesh) object.dispose();
        if (object.geometry && !sharedGeometries.has(object.geometry)) geometries.add(object.geometry);
        if (object.material) {
          for (const material of [].concat(object.material)) {
            if (!sharedMaterials.has(material)) materials.add(material);
          }
        }
      };
      this.levelRoot.traverse(collect);
      // Consumed props are detached but still owned by the level.
      for (const { mesh } of this.props) {
        if (mesh && !mesh.parent) mesh.traverse(collect);
      }
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    }
    this.levelRoot.clear();
  }

  loadLevel(idx, keepStats = false, arena = false) {
    this.cancelGrenadeAim();
    this.levelIdx = idx;
    this.arena = arena;
    const lvl = COMIC_LEVELS[idx];
    this.level = lvl;
    this.map = lvl.map;
    this.mapH = this.map.length;
    this.mapW = this.map[0].length;

    this._clearLevel();
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

    const worldW = this.mapW * CELL_SIZE;
    const worldH = this.mapH * CELL_SIZE;
    if (this.renderer) this._buildLevelLightingAndFloor(lvl, worldW, worldH);

    // 构建街区 3D 微凸起人行道 + 路沿石 + 连通道路标线，以及合并后的独立街区建筑
    this.sidewalkGrid = null;
    if (lvl.streetTheme) {
      this._build3DRoadsAndSidewalks(lvl);
    }
    this._buildLevelArchitecture(lvl);

    // 街区主题细节：街角漫画路灯、消防栓与各街区专属地标（唐人街牌楼 / 海港高架铁道 / 大都会绿荫与柱廊）
    if (this.renderer && lvl.streetTheme) {
      this._buildStreetBlockFurniture();
      this._buildDistrictLandmarks(lvl);
    }

    // 漫画城市天际线 & 大太阳背景
    if (this.renderer) this._buildComicSkyline(worldW, worldH, lvl);
    this.streetScenery?.build();

    // 玩家出生点
    this.player.pos.set(lvl.playerStart.x * CELL_SIZE, 0, lvl.playerStart.z * CELL_SIZE);
    this.player.velY = 0;
    this.player.onGround = true;
    this.player.yaw = lvl.playerStart.yaw;
    this.player.pitch = 0;
    this.player.dashTimer = 0;
    this.player.dashCooldown = 0;
    this.player.slideTimer = 0;
    this.player.slideCooldown = 0;
    this.player.slideAmount = 0;
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

  _buildLevelLightingAndFloor(lvl, worldW, worldH) {
    const maxSpan = Math.max(worldW, worldH);
    this.scene.background = new THREE.Color(lvl.skyColor);
    this.scene.fog = new THREE.FogExp2(lvl.fogColor, maxSpan >= CELL_SIZE * 20 ? 0.0085 : 0.014);

    this.levelRoot.add(new THREE.HemisphereLight(lvl.ambientColor, 0x262038, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.65);
    sun.position.set(worldW / 2 + 24, 46, worldH / 2 + 18);
    sun.target.position.set(worldW / 2, 0, worldH / 2);
    sun.castShadow = true;
    const d = Math.max(40, maxSpan * 0.65);
    const shadow = sun.shadow;
    shadow.mapSize.set(1024, 1024);
    shadow.bias = -0.00008;
    shadow.normalBias = 0.06;
    Object.assign(shadow.camera, { near: 5, far: Math.max(115, maxSpan * 1.85), left: -d, right: d, top: d, bottom: -d });
    shadow.camera.updateProjectionMatrix();
    this.levelRoot.add(sun, sun.target);
    this.renderer.shadowMap.needsUpdate = true;
    this.nextShadowUpdate = 0;

    // World-space tiling uses the same texture across chapters.
    const geometry = new THREE.PlaneGeometry(worldW, worldH).rotateX(-Math.PI / 2);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * this.mapW, uv.getY(i) * this.mapH);
    const floor = new THREE.Mesh(geometry, this.assets.toonMat({ map: this.assets.textures[lvl.floorTex] }));
    floor.position.set(worldW / 2, 0, worldH / 2);
    floor.receiveShadow = true;
    this.levelRoot.add(floor);
  }

  _spawnMover(spec, id) {
    const baseX = spec.x * CELL_SIZE;
    const baseZ = spec.z * CELL_SIZE;
    const geo = new THREE.BoxGeometry(spec.w, spec.h, spec.d);
    const mat = this.assets.toonMat({ color: spec.color || 0xffe01b });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(baseX, spec.h / 2, baseZ);
    mesh.castShadow = true;
    // Keep cached world shadows off the moving surface.
    mesh.receiveShadow = false;
    if (this.renderer) {
      // Use a solid silhouette instead of rasterizing a thin line on the box's depth.
      this.assets.addOutline(mesh, 1.03);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(spec.w * 0.84, 0.14, spec.d * 0.84),
        this.assets.toonMat({ color: spec.rideable ? 0x181822 : 0xff2a44 })
      );
      cap.position.y = spec.h / 2 + 0.05;
      mesh.add(cap);
    }
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

  // 按世界真实米数重映射 BoxGeometry 各面 UV，彻底消除长边墙与合并建筑的贴图拉伸模糊，且无需克隆贴图
  _applyBoxWorldUVs(geo, bw, bh, bd, tileW = CELL_SIZE, tileH = 4.8) {
    const uv = geo.attributes.uv;
    if (!uv) return;
    const rx = Math.max(1, Math.round(bw / tileW));
    const ry = Math.max(1, Math.round(bh / tileH));
    const rz = Math.max(1, Math.round(bd / tileW));
    // Face 0 (+X) & Face 1 (-X): 宽度方向对应 bd (rz)，高度方向对应 bh (ry)
    for (let i = 0; i < 8; i++) {
      uv.setXY(i, uv.getX(i) * rz, uv.getY(i) * ry);
    }
    // Face 2 (+Y) & Face 3 (-Y): 宽度方向对应 bw (rx)，深度方向对应 bd (rz)
    for (let i = 8; i < 16; i++) {
      uv.setXY(i, uv.getX(i) * rx, uv.getY(i) * rz);
    }
    // Face 4 (+Z) & Face 5 (-Z): 宽度方向对应 bw (rx)，高度方向对应 bh (ry)
    for (let i = 16; i < 24; i++) {
      uv.setXY(i, uv.getX(i) * rx, uv.getY(i) * ry);
    }
    uv.needsUpdate = true;
  }

  // 构建 3D 微凸起水泥人行道 (高 0.16m) + 马路牙子凸起路沿石 (高 0.19m) + 自然连通的道路双黄线/停止线/斑马线
  _build3DRoadsAndSidewalks(lvl) {
    const H = this.mapH;
    const W = this.mapW;
    const isSolidBuilding = (gx, gz) => {
      if (gx <= 0 || gz <= 0 || gx >= W - 1 || gz >= H - 1) return false;
      const c = this.map[gz]?.[gx] || 0;
      return c > 0 && !this._isLowCoverCell(c);
    };

    // 1. 计算人行道网格 vs 连通马路网格：
    // 紧贴外围护栏的一圈，或紧贴内部街区建筑四周的一圈为 3D 微凸起人行道；中间走廊全部为自然连通的柏油马路
    const sidewalkGrid = Array.from({ length: H }, () => new Uint8Array(W));
    const roadGrid = Array.from({ length: H }, () => new Uint8Array(W));

    for (let z = 1; z < H - 1; z++) {
      for (let x = 1; x < W - 1; x++) {
        if (isSolidBuilding(x, z)) continue;
        let nearBuilding = x === 1 || z === 1 || x === W - 2 || z === H - 2;
        if (!nearBuilding) {
          for (let dz = -1; dz <= 1 && !nearBuilding; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (isSolidBuilding(x + dx, z + dz)) {
                nearBuilding = true;
                break;
              }
            }
          }
        }
        if (nearBuilding) {
          sidewalkGrid[z][x] = 1;
        } else {
          roadGrid[z][x] = 1;
        }
      }
    }
    this.sidewalkGrid = sidewalkGrid;

    if (!this.renderer) return;

    // 2. 贪心合并 3D 微凸起人行道平台 (0.16m 高)，并应用 1:1 世界坐标高清步砖 UV
    const visited = Array.from({ length: H }, () => new Uint8Array(W));
    const sidewalkH = 0.16;
    const sidewalkMat = this.assets.wallMaterials.sidewalk || this.assets.wallMaterials[3];

    for (let z = 1; z < H - 1; z++) {
      for (let x = 1; x < W - 1; x++) {
        if (!sidewalkGrid[z][x] || visited[z][x]) continue;
        let wCells = 1;
        while (x + wCells < W - 1 && sidewalkGrid[z][x + wCells] && !visited[z][x + wCells]) {
          wCells++;
        }
        let dCells = 1;
        outer: while (z + dCells < H - 1) {
          for (let dx = 0; dx < wCells; dx++) {
            if (!sidewalkGrid[z + dCells][x + dx] || visited[z + dCells][x + dx]) break outer;
          }
          dCells++;
        }
        for (let dz = 0; dz < dCells; dz++) {
          for (let dx = 0; dx < wCells; dx++) {
            visited[z + dz][x + dx] = 1;
          }
        }

        const bw = wCells * CELL_SIZE;
        const bd = dCells * CELL_SIZE;
        const wx = (x + wCells * 0.5) * CELL_SIZE;
        const wz = (z + dCells * 0.5) * CELL_SIZE;
        const slabGeo = new THREE.BoxGeometry(bw, sidewalkH, bd);
        this._applyBoxWorldUVs(slabGeo, bw, sidewalkH, bd, CELL_SIZE, CELL_SIZE);
        const slab = new THREE.Mesh(slabGeo, sidewalkMat);
        slab.position.set(wx, sidewalkH / 2, wz);
        slab.receiveShadow = true;
        this.levelRoot.add(slab);
      }
    }

    // 3. 在所有「人行道与马路交界处」生成凸起的 3D 马路牙子路沿石 (高 0.20m，宽 0.24m)
    const curbH = 0.20;
    const curbW = 0.24;
    // Let the road-facing face extend beyond the slab so the two vertical faces never coincide.
    const curbInset = curbW * 0.5 - 0.045;
    const curbColor = lvl.districtStyle === "chinatown" ? 0xd9a84e : 0xc8d0e0;

    // 水平方向路沿石合并
    for (let z = 1; z < H - 1; z++) {
      for (const dir of [-1, 1]) {
        let x = 1;
        while (x < W - 1) {
          if (sidewalkGrid[z][x] && roadGrid[z + dir]?.[x]) {
            let run = 1;
            while (x + run < W - 1 && sidewalkGrid[z][x + run] && roadGrid[z + dir]?.[x + run]) run++;
            const len = run * CELL_SIZE;
            this.streetScenery.addSolid("box", curbColor, [
              (x + run * 0.5) * CELL_SIZE,
              curbH / 2,
              (z + 0.5 + dir * 0.5) * CELL_SIZE - dir * curbInset,
            ], [len, curbH, curbW]);
            x += run;
          } else {
            x++;
          }
        }
      }
    }

    // 垂直方向路沿石合并
    for (let x = 1; x < W - 1; x++) {
      for (const dir of [-1, 1]) {
        let z = 1;
        while (z < H - 1) {
          if (sidewalkGrid[z][x] && roadGrid[z]?.[x + dir]) {
            let run = 1;
            while (z + run < H - 1 && sidewalkGrid[z + run][x] && roadGrid[z + run]?.[x + dir]) run++;
            const len = run * CELL_SIZE;
            this.streetScenery.addSolid("box", curbColor, [
              (x + 0.5 + dir * 0.5) * CELL_SIZE - dir * curbInset,
              curbH / 2,
              (z + run * 0.5) * CELL_SIZE,
            ], [curbW, curbH, len]);
            z += run;
          } else {
            z++;
          }
        }
      }
    }

    // 4. 基于道路中心顶点图（Vertex-Dual Road Graph）生成 100% 连通的道路双黄线、L型转弯连接、丁字/十字路口停止线与斑马线
    this._buildConnectedRoadMarkings(roadGrid);
  }

  _buildConnectedRoadMarkings(roadGrid) {
    const H = this.mapH;
    const W = this.mapW;
    // 当网格交点 (vx, vz) 周围的 4 个格子全部是马路时，该交点即为双向车道的几何中心点
    const isCenterNode = (vx, vz) =>
      vx >= 1 && vz >= 1 && vx < W && vz < H &&
      roadGrid[vz - 1][vx - 1] === 1 &&
      roadGrid[vz - 1][vx] === 1 &&
      roadGrid[vz][vx - 1] === 1 &&
      roadGrid[vz][vx] === 1;

    const degree = Array.from({ length: H }, () => new Uint8Array(W));
    for (let vz = 1; vz < H; vz++) {
      for (let vx = 1; vx < W; vx++) {
        if (!isCenterNode(vx, vz)) continue;
        let deg = 0;
        if (isCenterNode(vx + 1, vz)) deg++;
        if (isCenterNode(vx - 1, vz)) deg++;
        if (isCenterNode(vx, vz + 1)) deg++;
        if (isCenterNode(vx, vz - 1)) deg++;
        degree[vz][vx] = deg;
      }
    }

    // Paint is biased against the street surface instead of using nearly coplanar 3D boxes.
    const paint = { polygonOffset: true, polygonOffsetFactor: -1 };
    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xffe01b, ...paint, polygonOffsetUnits: -2 });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf4f7ff, ...paint, polygonOffsetUnits: -3 });
    const scenery = this.streetScenery;
    const stripe = (material, x, z, w, d) => scenery.add("paint", material, [x, 0, z], [w, 1, d]);
    const lineGap = 0.14;
    const lineW = 0.13;

    const addYellowSegment = (x1, z1, x2, z2) => {
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.15) return;
      const mx = (x1 + x2) * 0.5;
      const mz = (z1 + z2) * 0.5;
      const horizontal = Math.abs(dx) > Math.abs(dz);
      for (const offset of [-lineGap, lineGap]) {
        if (horizontal) stripe(yellowMat, mx, mz + offset, len, lineW);
        else stripe(yellowMat, mx + offset, mz, lineW, len);
      }
    };

    const addCrosswalk = (cx, cz, verticalRoad) => {
      // 路口入口处的斑马线
      const stripes = 6;
      const span = CELL_SIZE * 1.65;
      for (let i = 0; i < stripes; i++) {
        const offset = -span * 0.5 + (i + 0.5) * (span / stripes);
        if (verticalRoad) stripe(whiteMat, cx + offset, cz, 0.45, 2.2);
        else stripe(whiteMat, cx, cz + offset, 2.2, 0.45);
      }
    };

    // 遍历所有相邻的道路中心顶点对，绘制连续双黄线，并在丁字/十字路口前自动内缩留出斑马线
    for (let vz = 1; vz < H; vz++) {
      for (let vx = 1; vx < W; vx++) {
        if (!isCenterNode(vx, vz)) continue;
        const wx = vx * CELL_SIZE;
        const wz = vz * CELL_SIZE;
        const degA = degree[vz][vx];

        // 丁字或十字路口中心：放置漫画铸铁井盖
        if (degA >= 3) {
          scenery.addSolid("cylinder", 0x3b4154, [wx, 0.028, wz], [1.38, 0.055, 1.38]);
          scenery.addSolid("cylinder", 0x5b667d, [wx, 0.062, wz], [1.14, 0.033, 1.14]);
        } else if (degA === 2) {
          // L型转弯中心点补齐双黄线转角连接块，确保 90 度弯道无缝衔接
          const hasH = isCenterNode(vx - 1, vz) || isCenterNode(vx + 1, vz);
          const hasV = isCenterNode(vx, vz - 1) || isCenterNode(vx, vz + 1);
          if (hasH && hasV) {
            const size = (lineGap + lineW) * 2.2;
            stripe(yellowMat, wx, wz, size, size);
          }
        }

        // 向右 (东西向) 连接
        if (isCenterNode(vx + 1, vz)) {
          const degB = degree[vz][vx + 1];
          if (degA < 3 || degB < 3) {
            let x1 = wx;
            let x2 = (vx + 1) * CELL_SIZE;
            if (degA >= 3) {
              addCrosswalk(wx + CELL_SIZE * 0.55, wz, false);
              x1 += CELL_SIZE * 0.88;
            }
            if (degB >= 3) {
              addCrosswalk(x2 - CELL_SIZE * 0.55, wz, false);
              x2 -= CELL_SIZE * 0.88;
            }
            addYellowSegment(x1, wz, x2, wz);
          }
        }

        // 向下 (南北向) 连接
        if (isCenterNode(vx, vz + 1)) {
          const degB = degree[vz + 1][vx];
          if (degA < 3 || degB < 3) {
            let z1 = wz;
            let z2 = (vz + 1) * CELL_SIZE;
            if (degA >= 3) {
              addCrosswalk(wx, wz + CELL_SIZE * 0.55, true);
              z1 += CELL_SIZE * 0.88;
            }
            if (degB >= 3) {
              addCrosswalk(wx, z2 - CELL_SIZE * 0.55, true);
              z2 -= CELL_SIZE * 0.88;
            }
            addYellowSegment(wx, z1, wx, z2);
          }
        }
      }
    }
  }

  // 贪心矩形合并 + 差异化美漫街区建筑建模（将数百个零散墙格合并为 ~16 栋完整独立建筑，大幅提升帧率与街区真实感）
  _buildLevelArchitecture(lvl) {
    const crateH = 1.65;
    const baseWallH = 4.8;
    const crateGeo = new THREE.BoxGeometry(CELL_SIZE * 0.78, crateH, CELL_SIZE * 0.78);
    const trimMat = this.assets.toonMat({ color: 0x16161e });
    const vehicleCollisionMat = new THREE.MeshBasicMaterial({ visible: false });

    // 1. 先生成低矮掩体（6: 木箱掩体，10: 街头漫画出租车/警车/货车掩体）
    for (let z = 0; z < this.mapH; z++) {
      for (let x = 0; x < this.mapW; x++) {
        const cell = this.map[z][x];
        if (cell !== 6 && cell !== 10) continue;
        const wx = (x + 0.5) * CELL_SIZE;
        const wz = (z + 0.5) * CELL_SIZE;
        const baseElev = this.sidewalkGrid?.[z]?.[x] ? 0.16 : 0;
        if (cell === 6) {
          const mat = this.assets.wallMaterials[6] || this.assets.wallMaterials[1];
          const box = new THREE.Mesh(crateGeo, mat);
          box.position.set(wx, baseElev + crateH / 2, wz);
          box.receiveShadow = true;
          this.assets.addCreaseLines(box);
          box.userData = { kind: "wall" };
          this.levelRoot.add(box);
          this.hitTargets.push(box);
        } else if (cell === 10) {
          const vType = (x + z) % 3; // 0: 黄色漫画出租车  1: 红白复古快递货车  2: 蓝白漫画警车
          const hitBox = new THREE.Mesh(crateGeo, vehicleCollisionMat);
          hitBox.position.set(wx, baseElev + crateH / 2, wz);
          hitBox.userData = { kind: "wall" };
          this.levelRoot.add(hitBox);
          this.hitTargets.push(hitBox);
          this.streetScenery?.addVehicle(vType, wx, baseElev, wz);
        }
      }
    }

    // 2. 将连续的建筑格子合并为完整矩形建筑体（区分外围高架护栏墙与街区内部独立建筑）
    const visited = Array.from({ length: this.mapH }, () => new Uint8Array(this.mapW));
    const isBorderCell = (gx, gz) => gx === 0 || gz === 0 || gx === this.mapW - 1 || gz === this.mapH - 1;

    for (let z = 0; z < this.mapH; z++) {
      for (let x = 0; x < this.mapW; x++) {
        const cell = this.map[z][x];
        if (cell === 0 || cell === 6 || cell === 10 || visited[z][x]) continue;

        const borderFlag = lvl.streetTheme && isBorderCell(x, z);
        const matchCell = (gx, gz) => {
          if (gx < 0 || gz < 0 || gx >= this.mapW || gz >= this.mapH || visited[gz][gx]) return false;
          const c = this.map[gz][gx];
          if (c === 0 || c === 6 || c === 10) return false;
          if (lvl.streetTheme) {
            const b = isBorderCell(gx, gz);
            if (borderFlag !== b) return false;
            return borderFlag ? true : c === cell;
          }
          return c === cell;
        };

        let wCells = 1;
        while (x + wCells < this.mapW && matchCell(x + wCells, z)) {
          wCells++;
        }

        let dCells = 1;
        outer: while (z + dCells < this.mapH) {
          for (let dx = 0; dx < wCells; dx++) {
            if (!matchCell(x + dx, z + dCells)) break outer;
          }
          dCells++;
        }

        for (let dz = 0; dz < dCells; dz++) {
          for (let dx = 0; dx < wCells; dx++) {
            visited[z + dz][x + dx] = 1;
          }
        }

        const bw = wCells * CELL_SIZE;
        const bd = dCells * CELL_SIZE;
        const wx = (x + wCells * 0.5) * CELL_SIZE;
        const wz = (z + dCells * 0.5) * CELL_SIZE;

        if (lvl.streetTheme && borderFlag) {
          // 街区外围：高清 1:1 世界 UV 映射的城市市政护栏边墙（3.4m 高，绝不拉伸模糊！）
          const guardH = 3.4;
          const geo = new THREE.BoxGeometry(bw, guardH, bd);
          this._applyBoxWorldUVs(geo, bw, guardH, bd, CELL_SIZE, guardH);
          const mat = this.assets.wallMaterials.viaduct || this.assets.wallMaterials[3];
          const wall = new THREE.Mesh(geo, mat);
          wall.position.set(wx, guardH / 2, wz);
          wall.receiveShadow = true;
          this.assets.addCreaseLines(wall);
          wall.userData = { kind: "wall" };
          this.levelRoot.add(wall);
          this.hitTargets.push(wall);

          if (this.renderer) {
            const cap = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.14, 0.24, bd + 0.14), trimMat);
            cap.position.set(wx, guardH + 0.12, wz);
            this.levelRoot.add(cap);
          }
        } else if (lvl.streetTheme) {
          // 街区内部：生成外观、层高、屋顶截然不同的独立建筑（带精确世界 UV 平铺）
          this._spawnDistinctCityBuilding(cell, x, z, wCells, dCells, wx, wz, bw, bd, trimMat);
        } else {
          // 室内/天台关卡：合并后的标准高速墙体 + 精确世界 UV 平铺
          const geo = new THREE.BoxGeometry(bw, baseWallH, bd);
          this._applyBoxWorldUVs(geo, bw, baseWallH, bd, CELL_SIZE, baseWallH);
          const mat = this.assets.wallMaterials[cell] || this.assets.wallMaterials[1];
          const wall = new THREE.Mesh(geo, mat);
          wall.position.set(wx, baseWallH / 2, wz);
          wall.castShadow = true;
          wall.receiveShadow = true;
          this.assets.addCreaseLines(wall);
          wall.userData = { kind: "wall" };
          this.levelRoot.add(wall);
          this.hitTargets.push(wall);

          if (this.renderer) {
            const trim = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.14, 0.28, bd + 0.14), trimMat);
            trim.position.set(wx, baseWallH + 0.14, wz);
            this.levelRoot.add(trim);
          }
        }
      }
    }
  }

  // 生成 9 种外观、层高、屋顶结构截然不同的美式漫画街区独立建筑
  _spawnDistinctCityBuilding(cell, gx, gz, wCells, dCells, wx, wz, bw, bd, trimMat) {
    const variant = (gx * 7 + gz * 13) % 2;
    const heightByType = {
      7: 5.6, // 街角漫画书店 / 复古快餐店
      9: 6.8, // 街头波普涂鸦仓库 / 汽修厂
      11: 8.6 + variant * 1.4, // 唐人街朱红鎏金飞檐楼阁
      12: 7.4 + variant * 1.6, // 海港波纹集装箱货运大楼
      1: 9.0 + variant * 1.2, // 老城红砖联排楼
      4: 10.4, // 复古红砖钟楼 / 啤酒厂
      13: 11.4, // 大都会古典白大理石罗马柱银行
      8: 12.6 + variant * 2.0, // 三层褐石水塔公寓楼
      2: 17.5 + variant * 3.5, // 现代霓虹玻璃摩天大楼
    };
    const bh = heightByType[cell] || 8.5;
    const mat = this.assets.wallMaterials[cell] || this.assets.wallMaterials[1];

    const bodyGeo = new THREE.BoxGeometry(bw, bh, bd);
    this._applyBoxWorldUVs(bodyGeo, bw, bh, bd, CELL_SIZE, 4.8);
    const building = new THREE.Mesh(bodyGeo, mat);
    building.position.set(wx, bh / 2, wz);
    building.castShadow = true;
    building.receiveShadow = true;
    this.assets.addCreaseLines(building);
    building.userData = { kind: "wall" };
    this.levelRoot.add(building);
    this.hitTargets.push(building);

    if (!this.renderer) return;

    // 屋顶墨线挑檐
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.24, 0.34, bd + 0.24), trimMat);
    cornice.position.set(wx, bh + 0.17, wz);
    this.levelRoot.add(cornice);
    this._addFacadeRelief(cell, gx, gz, wCells, dCells, bh);

    // 按建筑类型添加标志性立体屋顶与门头结构
    if (cell === 7) {
      // 【类型 7：漫画书店 & 复古快餐店】外挑红黄遮阳雨棚 + 屋顶阶梯霓虹大招牌
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(bw + 0.85, 0.42, bd + 0.85),
        this.assets.toonMat({ color: variant === 0 ? 0xff2a44 : 0xffe01b })
      );
      awning.position.set(wx, 3.15, wz);
      this.assets.addCreaseLines(awning);
      this.levelRoot.add(awning);

      const signBase = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.75, 1.85, 0.55),
        this.assets.toonMat({ color: variant === 0 ? 0xffe01b : 0xff2ebd })
      );
      signBase.position.set(wx, bh + 1.25, wz);
      this.assets.addCreaseLines(signBase);
      this.levelRoot.add(signBase);
    } else if (cell === 11) {
      // 【类型 11：唐人街东方飞檐楼阁】双层翡翠绿/金黄出挑飞檐攒尖屋顶 + 朱红灯笼柱
      const eave1 = new THREE.Mesh(
        new THREE.BoxGeometry(bw + 1.3, 0.55, bd + 1.3),
        this.assets.toonMat({ color: 0x00a86b })
      );
      eave1.position.set(wx, bh + 0.55, wz);
      this.assets.addCreaseLines(eave1);

      const upperPavilion = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.66, 2.2, bd * 0.66),
        this.assets.toonMat({ color: 0xb81d24 })
      );
      upperPavilion.position.set(wx, bh + 1.9, wz);
      this.assets.addCreaseLines(upperPavilion);

      const eave2 = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.82, 0.5, bd * 0.82),
        this.assets.toonMat({ color: 0xffae19 })
      );
      eave2.position.set(wx, bh + 3.25, wz);
      this.assets.addCreaseLines(eave2);
      this.levelRoot.add(eave1, upperPavilion, eave2);
    } else if (cell === 12) {
      // 【类型 12：布鲁克林海港货运集装箱大楼】屋顶错落叠放的彩色集装箱与斜拉悬臂吊架
      const c1 = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.72, 2.4, Math.min(3.6, bd * 0.55)),
        this.assets.toonMat({ color: variant === 0 ? 0xff7a00 : 0xd92638 })
      );
      c1.position.set(wx - bw * 0.08, bh + 1.5, wz);
      this.assets.addCreaseLines(c1);

      const boom = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.55, bd + 2.6),
        this.assets.toonMat({ color: 0xffe01b })
      );
      boom.position.set(wx + bw * 0.25, bh + 3.1, wz);
      this.assets.addCreaseLines(boom);
      this.levelRoot.add(c1, boom);
    } else if (cell === 13) {
      // 【类型 13：大都会古典白大理石银行大厦】台阶式黄金三角山墙屋顶 + 古典穹顶
      const pediment = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.86, 1.35, bd * 0.86),
        this.assets.toonMat({ color: 0xf5efe2 })
      );
      pediment.position.set(wx, bh + 0.95, wz);
      this.assets.addCreaseLines(pediment);

      const goldDome = new THREE.Mesh(
        new THREE.SphereGeometry(Math.min(bw, bd) * 0.28, 12, 10),
        this.assets.toonMat({ color: 0xffcf33 })
      );
      goldDome.position.set(wx, bh + 1.9, wz);
      this.assets.addOutline(goldDome, 1.06);
      this.levelRoot.add(pediment, goldDome);
    } else if (cell === 8) {
      // 【类型 8：三层褐石公寓楼】中层石材腰线 + 屋顶阁楼出口 + 纽约复古木水塔
      const belt = new THREE.Mesh(
        new THREE.BoxGeometry(bw + 0.18, 0.28, bd + 0.18),
        this.assets.toonMat({ color: 0xf7b733 })
      );
      belt.position.set(wx, bh * 0.52, wz);
      this.levelRoot.add(belt);

      const penthouse = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(3.2, bw * 0.45), 2.1, Math.min(3.2, bd * 0.45)),
        this.assets.toonMat({ color: 0x9c5221 })
      );
      penthouse.position.set(wx - bw * 0.18, bh + 1.2, wz - bd * 0.15);
      this.assets.addCreaseLines(penthouse);
      this.levelRoot.add(penthouse);

      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.1, 2.1, 10),
        this.assets.toonMat({ color: 0xb86b2b })
      );
      tank.position.set(wx + bw * 0.18, bh + 1.5, wz + bd * 0.15);
      this.assets.addOutline(tank, 1.06);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(1.28, 0.95, 10),
        this.assets.toonMat({ color: 0x22222c })
      );
      roof.position.set(wx + bw * 0.18, bh + 3.0, wz + bd * 0.15);
      this.assets.addOutline(roof, 1.06);
      this.levelRoot.add(tank, roof);
    } else if (cell === 2) {
      // 【类型 2：现代霓虹玻璃摩天大楼】帝国大厦式二段退台塔冠 + 发光霓虹尖塔
      const crownH = 3.6;
      const crown = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.68, crownH, bd * 0.68),
        this.assets.toonMat({ color: 0x16284c })
      );
      crown.position.set(wx, bh + 0.34 + crownH / 2, wz);
      this.assets.addCreaseLines(crown);

      const neonBand = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.72, 0.45, bd * 0.72),
        new THREE.MeshBasicMaterial({ color: 0x00e5ff })
      );
      neonBand.position.set(wx, bh + 0.34 + crownH, wz);

      const spire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.26, 4.2, 8),
        new THREE.MeshBasicMaterial({ color: 0xffe01b })
      );
      spire.position.set(wx, bh + crownH + 2.4, wz);
      this.levelRoot.add(crown, neonBand, spire);
    } else if (cell === 9) {
      // 【类型 9：街头涂鸦红砖仓库/车库】工业钢结构采光天窗与银色空调风柜
      const skylight = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.62, 1.1, bd * 0.52),
        this.assets.toonMat({ color: 0x7f8c9a })
      );
      skylight.position.set(wx, bh + 0.85, wz);
      this.assets.addCreaseLines(skylight);
      this.levelRoot.add(skylight);
    } else if (cell === 4 || cell === 1) {
      // 【类型 4/1：工业钟楼啤酒厂/老街红砖楼】古典山墙压顶 + 工业高耸砖烟囱
      const parapet = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.82, 1.25, bd * 0.82),
        this.assets.toonMat({ color: cell === 4 ? 0x5b2c83 : 0x8f2820 })
      );
      parapet.position.set(wx, bh + 0.9, wz);
      this.assets.addCreaseLines(parapet);
      this.levelRoot.add(parapet);

      if (cell === 4) {
        const stack = new THREE.Mesh(
          new THREE.CylinderGeometry(0.55, 0.72, 4.6, 10),
          this.assets.toonMat({ color: 0x9e3328 })
        );
        stack.position.set(wx + bw * 0.2, bh + 3.2, wz);
        this.assets.addOutline(stack, 1.06);
        this.levelRoot.add(stack);
      }
    }
  }

  // 为 3 张街区地图构建截然不同的标志性大场景立体地标（营造强烈的场景区分度与新鲜陌生感）
  _buildDistrictLandmarks(lvl) {
    if (lvl.districtStyle === "chinatown") {
      // ISSUE #2 落日唐人街：跨越主干道的朱红鎏金中式牌楼与横街霓虹灯笼索道
      const buildArchway = (wx, wz, span, rotateY = 0) => {
        const g = new THREE.Group();
        g.position.set(wx, 0, wz);
        g.rotation.y = rotateY;
        const pillarMat = this.assets.toonMat({ color: 0xd92027 });
        const goldMat = this.assets.toonMat({ color: 0xffcf26 });
        const jadeMat = this.assets.toonMat({ color: 0x00a86b });

        [-span * 0.5, span * 0.5].forEach((px) => {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 6.2, 10), pillarMat);
          post.position.set(px, 3.1, 0);
          this.assets.addOutline(post, 1.07);
          g.add(post);
        });

        const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 1.4, 0.85, 0.7), goldMat);
        beam.position.set(0, 5.7, 0);
        this.assets.addCreaseLines(beam);

        const roof = new THREE.Mesh(new THREE.BoxGeometry(span + 2.6, 0.65, 1.45), jadeMat);
        roof.position.set(0, 6.45, 0);
        this.assets.addCreaseLines(roof);
        g.add(beam, roof);
        this.levelRoot.add(g);
      };

      // 在唐人街南段入口大道与东段弯道架设两座巨型跨街牌楼
      buildArchway(3.0 * CELL_SIZE, 10.5 * CELL_SIZE, 9.2, 0);
      buildArchway(14.5 * CELL_SIZE, 3.0 * CELL_SIZE, 9.2, Math.PI / 2);
    } else if (lvl.districtStyle === "harbor") {
      // ISSUE #4 布鲁克林海港：贯穿街区上空的钢铁高架轻轨铁道桥（带工字钢横梁与高架列车剪影）
      const railY = 6.2;
      const deckLen = (this.mapW - 2) * CELL_SIZE;
      const deckZ = 10.0 * CELL_SIZE;
      const steelMat = this.assets.toonMat({ color: 0x3b4859 });
      const hazardMat = this.assets.toonMat({ color: 0xffae19 });

      const deck = new THREE.Mesh(new THREE.BoxGeometry(deckLen, 0.75, 4.4), steelMat);
      deck.position.set(this.mapW * 0.5 * CELL_SIZE, railY, deckZ);
      this.assets.addCreaseLines(deck);

      const railSide1 = new THREE.Mesh(new THREE.BoxGeometry(deckLen, 0.45, 0.25), hazardMat);
      railSide1.position.set(this.mapW * 0.5 * CELL_SIZE, railY + 0.6, deckZ - 2.1);
      const railSide2 = new THREE.Mesh(new THREE.BoxGeometry(deckLen, 0.45, 0.25), hazardMat);
      railSide2.position.set(this.mapW * 0.5 * CELL_SIZE, railY + 0.6, deckZ + 2.1);

      // 高架桥上停靠的一列美漫黄色涂鸦地铁车厢
      const train = new THREE.Mesh(
        new THREE.BoxGeometry(18.0, 2.5, 3.2),
        this.assets.toonMat({ color: 0xff2a44 })
      );
      train.position.set(this.mapW * 0.55 * CELL_SIZE, railY + 1.65, deckZ);
      this.assets.addCreaseLines(train);
      this.levelRoot.add(deck, railSide1, railSide2, train);
    } else if (lvl.districtStyle === "metropolis") {
      // ISSUE #6 大都会环形金融广场：人行道两侧的赛璐璐翠绿行道树与中央广场金色英雄方尖碑
      const trunkGeo = new THREE.CylinderGeometry(0.18, 0.24, 2.2, 8);
      const crownGeo = new THREE.DodecahedronGeometry(1.35, 0);
      const trunkMat = this.assets.toonMat({ color: 0x6e472b });
      const leafMat = this.assets.toonMat({ color: 0x2ecc71 });

      for (let z = 3; z < this.mapH - 3; z += 5) {
        for (let x = 3; x < this.mapW - 3; x += 6) {
          if (!this.sidewalkGrid?.[z]?.[x] || this.map[z][x] !== 0) continue;
          const wx = (x + 0.5) * CELL_SIZE + 1.1;
          const wz = (z + 0.5) * CELL_SIZE + 1.1;
          const trunk = new THREE.Mesh(trunkGeo, trunkMat);
          trunk.position.set(wx, 1.26, wz);
          const crown = new THREE.Mesh(crownGeo, leafMat);
          crown.position.set(0, 1.65, 0);
          this.assets.addOutline(crown, 1.07);
          trunk.add(crown);
          this.levelRoot.add(trunk);
        }
      }
    }
  }

  // 街区 3 种漫画街头车辆造型（0: 黄色出租车  1: 红白快递货车  2: 蓝白警车，全部共享几何体零重复分配）
  _addFacadeRelief(cell, gx, gz, wCells, dCells, height) {
    const finish = { 1: 0xaa735c, 8: 0xc2885e, 11: 0xde9860, 13: 0xe4ceb0 }[cell];
    if (!finish) return;
    const scenery = this.streetScenery;
    const sides = [
      { x: gx, z: gz, dx: 1, dz: 0, nx: 0, nz: -1, length: wCells },
      { x: gx, z: gz + dCells - 1, dx: 1, dz: 0, nx: 0, nz: 1, length: wCells },
      { x: gx, z: gz, dx: 0, dz: 1, nx: -1, nz: 0, length: dCells },
      { x: gx + wCells - 1, z: gz, dx: 0, dz: 1, nx: 1, nz: 0, length: dCells },
    ];
    for (const side of sides) {
      const { dx, dz, nx, nz, length } = side;
      for (let i = 0; i < length; i++) {
        const x = side.x + i * dx;
        const z = side.z + i * dz;
        const adjacent = this.map[z + nz]?.[x + nx];
        if (adjacent !== 0 && !this._isLowCoverCell(adjacent)) continue;
        const faceX = (x + 0.5 + 0.5 * nx) * CELL_SIZE;
        const faceZ = (z + 0.5 + 0.5 * nz) * CELL_SIZE;
        const relief = (y, w, h, depth, lateral = 0) => {
          const position = [faceX + dx * lateral + nx * depth * 0.46, y,
            faceZ + dz * lateral + nz * depth * 0.46];
          scenery.addSolid("box", finish, position, [dx ? w : depth, h, dz ? w : depth]);
        };
        // Stone lintels and sills sit proud of the inked façade.
        relief(cell === 13 ? 3.48 : 2.62, 2.76, 0.14, 0.24);
        relief(Math.min(6.8, height - 1.1), 2.42, 0.13, 0.21);
        if (cell === 13) {
          for (const offset of [-1.35, 1.35]) {
            relief(1.79, 0.33, 2.99, 0.23, offset);
            relief(0.31, 0.51, 0.28, 0.35, offset);
            relief(3.29, 0.54, 0.23, 0.33, offset);
          }
        }
      }
    }
  }

  // 街区人行道旁的漫画路灯与红色消防栓点缀。
  _buildStreetBlockFurniture() {
    for (let z = 2; z < this.mapH - 2; z += 4) {
      for (let x = 2; x < this.mapW - 2; x += 4) {
        if (this.map[z][x] !== 0) continue;
        const northWall = this.map[z - 1]?.[x] > 0 && !this._isLowCoverCell(this.map[z - 1][x]);
        const southWall = this.map[z + 1]?.[x] > 0 && !this._isLowCoverCell(this.map[z + 1][x]);
        if (!northWall && !southWall) continue;

        const lamp = (x + z) % 8 === 0;
        const wx = (x + 0.5) * CELL_SIZE + (lamp ? -1.45 : 1.45);
        const wz = (z + 0.5) * CELL_SIZE + (northWall ? -1.55 : 1.55);
        const ground = this.sidewalkGrid[z][x] ? 0.16 : 0;
        this.streetScenery.addStreetFixture(lamp, wx, ground, wz);
      }
    }
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
    const baseElev = this.sidewalkGrid?.[Math.floor(pos.z / CELL_SIZE)]?.[Math.floor(pos.x / CELL_SIZE)] ? 0.16 : 0;
    const root = new THREE.Group();
    root.position.set(pos.x, baseElev, pos.z);
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
      losTimer: (id % 5) * 0.022,
      cachedSeen: null,
      meshes: [],
      bodyParts: {},
    };

    const makePart = (geo, color, isHead = false, emissive = 0x000000, hitTarget = true, castShadow = false) => {
      const mat = this.assets.toonMat({ color, emissive });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = castShadow;
      this.assets.addOutline(m, 1.07);
      m.userData = { kind: "enemy", enemy, isHead, baseColor: color };
      if (hitTarget) this.hitTargets.push(m);
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

    // 躯干（仅躯干投射阴影，节省 90% 角色阴影渲染开销）
    const torso = makePart(new THREE.BoxGeometry(0.76, 0.92, 0.44), cfg.coat, false, 0x000000, true, true);
    torso.position.set(0, 1.24, 0);
    root.add(torso);

    // 领带 / 胸甲条纹
    const tie = makePart(new THREE.BoxGeometry(0.2, 0.65, 0.47), cfg.trim, false, 0x000000, false);
    tie.position.set(0, 1.26, 0.01);
    root.add(tie);

    // 手臂与武器
    const armL = makePart(new THREE.BoxGeometry(0.24, 0.72, 0.24), cfg.coat, false);
    armL.position.set(-0.52, 1.24, 0);
    const armR = makePart(new THREE.BoxGeometry(0.24, 0.72, 0.24), cfg.coat, false);
    armR.position.set(0.52, 1.28, 0.16);
    armR.rotation.x = -Math.PI / 2.6;
    const gun = makePart(new THREE.BoxGeometry(0.14, 0.16, 0.65), 0x262632, false, 0x000000, false);
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
    const baseElev = this.sidewalkGrid?.[Math.floor(wz / CELL_SIZE)]?.[Math.floor(wx / CELL_SIZE)] ? 0.16 : 0;
    const prop = { id, type: spec.type, active: true, x: wx, z: wz, baseElev, mesh: null };

    if (spec.type === "barrel") {
      const geo = new THREE.CylinderGeometry(0.55, 0.55, 1.45, 14);
      const mat = this.assets.toonMat({ map: this.assets.textures.barrel });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wx, baseElev + 0.725, wz);
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
      g.position.set(wx, baseElev + 0.55, wz);
      this.levelRoot.add(g);
      prop.mesh = g;
    } else if (spec.type === "ammo") {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.52, 0.55), this.assets.toonMat({ color: 0xffe01b }));
      this.assets.addOutline(box, 1.07);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.14, 0.58), this.assets.toonMat({ color: 0x22222c }));
      lid.position.y = 0.24;
      g.add(box, lid);
      g.position.set(wx, baseElev + 0.52, wz);
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
      g.position.set(wx, baseElev + 0.11, wz);
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
      g.position.set(wx, baseElev + 0.07, wz);
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

  _isLowCoverCell(c) {
    return c === 6 || c === 10;
  }

  _isStaticBlocked(wx, wz, playerY = 0, radius = 0) {
    if (radius <= 0) {
      const c = this._cellAt(wx, wz);
      return c !== 0 && !(this._isLowCoverCell(c) && playerY >= 1.45);
    }
    const offsets = [
      [-radius, -radius],
      [radius, -radius],
      [-radius, radius],
      [radius, radius],
    ];
    for (const [ox, oz] of offsets) {
      const c = this._cellAt(wx + ox, wz + oz);
      if (c !== 0 && !(this._isLowCoverCell(c) && playerY >= 1.45)) return true;
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
    const mx = Math.floor(wx / CELL_SIZE);
    const mz = Math.floor(wz / CELL_SIZE);
    const sw = this.sidewalkGrid?.[mz]?.[mx] ? 0.16 : 0;
    let h = this._isLowCoverCell(this._cellAt(wx, wz)) ? 1.65 + sw : sw;
    for (const m of this.movers) {
      if (m.rideable && Math.abs(wx - m.x) < m.w / 2 + 0.35 && Math.abs(wz - m.z) < m.d / 2 + 0.35) {
        if (m.h > h) h = m.h;
      }
    }
    return h;
  }

  _hasLineOfSight(fromPos, toPos) {
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const dz = toPos.z - fromPos.z;
    const steps = Math.ceil(Math.hypot(dx, dy, dz) / 0.8);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = fromPos.x + dx * t;
      const y = fromPos.y + dy * t;
      const z = fromPos.z + dz * t;
      const c = this._cellAt(x, z);
      if (c > 0 && !this._isLowCoverCell(c)) return false;
      if (this._isLowCoverCell(c) && y < 1.65) return false;
      for (const m of this.movers) {
        if (Math.abs(x - m.x) < m.w / 2 && Math.abs(z - m.z) < m.d / 2 && y < m.h) {
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
      const wasSliding = this.player.slideTimer > 0;
      this.player.slideTimer = 0;
      this.player.velY = wasSliding ? 9.8 : 9.2;
      this.player.onGround = false;
      this.audio.playJump();
      return true;
    }
    return false;
  }

  triggerSlide() {
    const p = this.player;
    if (!p.onGround || p.slideTimer > 0 || p.slideCooldown > 0 || p.dashTimer > 0) return false;
    const forward = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const dir = new THREE.Vector3();
    if (this.keys["KeyW"] || this.keys["ArrowUp"]) dir.add(forward);
    if (this.keys["KeyS"] || this.keys["ArrowDown"]) dir.sub(forward);
    if (this.keys["KeyD"]) dir.add(right);
    if (this.keys["KeyA"]) dir.sub(right);
    // 只有奔跑/移动状态下才能按 C 触发滑铲
    if (dir.lengthSq() === 0) return false;
    dir.normalize();

    p.slideDir.copy(dir);
    p.slideTimer = 0.58;
    p.slideCooldown = 0.85;
    this.speedLineAlpha = Math.max(this.speedLineAlpha, 0.72);
    this.audio.playSlide();
    return true;
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
    if (p.slideTimer > 0) {
      spread += isAds ? 0.008 : 0.016;
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
        return (this.renderer || distance <= 95) && (enemy?.alive ?? prop?.active ?? (!player || player.hp > 0));
      });

      let endPoint = this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, 95);

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

  canThrowGrenade(owner = this.player) {
    return Boolean(owner && owner.hp > 0 && owner.grenades > 0 && (owner.grenadeCooldown || 0) <= 0);
  }

  _computeGrenadeLaunch(owner = this.player) {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(owner.pitch, owner.yaw, 0, "YXZ")).normalize();
    const right = new THREE.Vector3(Math.cos(owner.yaw), 0, -Math.sin(owner.yaw));
    const spawnPos = new THREE.Vector3(owner.pos.x, owner.pos.y + this.eyeHeight - 0.12, owner.pos.z)
      .addScaledVector(dir, 0.85)
      .addScaledVector(right, 0.22);
    const vel = dir.multiplyScalar(20.5);
    vel.y += 5.4;
    return { spawnPos, vel };
  }

  startGrenadeAim(keyCode = "KeyG") {
    if (!this.canThrowGrenade()) return false;
    this.grenadeAiming = true;
    this.grenadeAimKey = keyCode;
    this.mouseDown = false;
    this.setAds(false);
    this._ensureGrenadeAimVisuals();
    this.updateGrenadeAim(0);
    return true;
  }

  cancelGrenadeAim() {
    this.grenadeAiming = false;
    this.grenadeAimKey = null;
    if (this.grenadeAimGroup) {
      this.grenadeAimGroup.visible = false;
    }
  }

  releaseGrenadeAim() {
    if (!this.grenadeAiming) return false;
    this.cancelGrenadeAim();
    return this.throwGrenade(this.player);
  }

  predictGrenadeTrajectory(owner = this.player) {
    const { spawnPos, vel } = this._computeGrenadeLaunch(owner);
    const pos = spawnPos.clone();
    const v = vel.clone();
    const points = [pos.clone()];
    let firstImpact = null;
    let directHit = false;
    const radius = 0.26;
    const fixedDt = 1 / 45;
    let rem = 1.45;

    while (rem > 1e-5) {
      const dt = Math.min(fixedDt, rem);
      rem -= dt;
      v.y -= 24.0 * dt;

      const nextX = pos.x + v.x * dt;
      if (this._isBlocked(nextX, pos.z, pos.y, radius)) {
        v.x *= -0.52;
      } else {
        pos.x = nextX;
      }

      const nextZ = pos.z + v.z * dt;
      if (this._isBlocked(pos.x, nextZ, pos.y, radius)) {
        v.z *= -0.52;
      } else {
        pos.z = nextZ;
      }

      pos.y += v.y * dt;
      const floorY = this._groundHeightAt(pos.x, pos.z) + radius;
      if (pos.y <= floorY) {
        pos.y = floorY;
        if (!firstImpact) {
          firstImpact = pos.clone();
        }
        if (Math.abs(v.y) > 2.2) {
          v.y = -v.y * 0.48;
        } else {
          v.y = 0;
        }
        v.x *= 0.78;
        v.z *= 0.78;
      }

      points.push(pos.clone());

      for (const e of this.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.root.position.x - pos.x, e.root.position.z - pos.z);
        if (d < 1.15 * e.scale && pos.y < 2.6 * e.scale) {
          directHit = true;
          break;
        }
      }
      if (directHit) break;
    }

    const finalPoint = points[points.length - 1];
    const groundY = this._groundHeightAt(finalPoint.x, finalPoint.z);
    let enemyInBlast = directHit;
    if (!enemyInBlast) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (e.root.position.distanceTo(finalPoint) < 12.0) {
          enemyInBlast = true;
          break;
        }
      }
    }

    return { points, firstImpact, finalPoint, groundY, directHit, enemyInBlast };
  }

  _ensureGrenadeAimVisuals() {
    if (!this.renderer || this.grenadeAimGroup) return;
    const root = new THREE.Group();
    root.visible = false;

    const MAX_POINTS = 72;
    const lineGeo = new THREE.BufferGeometry();
    const linePos = new Float32Array(MAX_POINTS * 3);
    lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffe01b, transparent: true, opacity: 0.92 });
    const line = new THREE.Line(lineGeo, lineMat);
    line.frustumCulled = false;
    root.add(line);

    const beadCount = 28;
    const beadGeo = new THREE.SphereGeometry(0.11, 8, 8);
    const beadMat = new THREE.MeshBasicMaterial({ color: 0xffe01b });
    const beads = [];
    for (let i = 0; i < beadCount; i++) {
      const bead = new THREE.Mesh(beadGeo, beadMat);
      this.assets.addOutline(bead, 1.25);
      bead.frustumCulled = false;
      root.add(bead);
      beads.push(bead);
    }

    // 首次着地弹跳指示环
    const bounceRingMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.9 });
    const bounceRing = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 6, 18), bounceRingMat);
    bounceRing.rotation.x = Math.PI / 2;
    bounceRing.visible = false;
    root.add(bounceRing);

    // 最终落点漫画靶标（发光外环 + 半透明危险区填充 + 旋转十字准心 + 悬空倒三角箭标）
    const landingGroup = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff7a00, transparent: true, opacity: 0.95 });
    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.09, 8, 28), ringMat);
    outerRing.rotation.x = Math.PI / 2;

    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xff7a00,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fillDisc = new THREE.Mesh(new THREE.CircleGeometry(1.85, 24), fillMat);
    fillDisc.rotation.x = -Math.PI / 2;

    const crossMat = new THREE.MeshBasicMaterial({ color: 0xffe01b });
    const crossGroup = new THREE.Group();
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 0.16), crossMat);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 2.2), crossMat);
    crossGroup.position.y = 0.02;
    crossGroup.add(c1, c2);

    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff7a00 });
    const arrowCone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 6), arrowMat);
    arrowCone.rotation.x = Math.PI;
    arrowCone.position.y = 1.05;
    this.assets.addOutline(arrowCone, 1.15);

    landingGroup.add(outerRing, fillDisc, crossGroup, arrowCone);
    root.add(landingGroup);

    this.scene.add(root);
    this.grenadeAimGroup = root;
    this._grenadeAimParts = {
      line,
      lineGeo,
      linePos,
      lineMat,
      MAX_POINTS,
      beads,
      beadMat,
      bounceRing,
      landingGroup,
      ringMat,
      fillMat,
      crossGroup,
      crossMat,
      arrowCone,
      arrowMat,
    };
  }

  updateGrenadeAim(dt = 0) {
    if (!this.grenadeAiming) {
      if (this.grenadeAimGroup) this.grenadeAimGroup.visible = false;
      return;
    }
    if (!this.canThrowGrenade()) {
      this.cancelGrenadeAim();
      return;
    }
    if (!this.renderer) return;

    this._ensureGrenadeAimVisuals();
    const parts = this._grenadeAimParts;
    if (!parts) return;

    this.grenadeAimPhase = (this.grenadeAimPhase + dt * 2.4) % 1;
    const pred = this.predictGrenadeTrajectory(this.player);
    const pts = pred.points;
    const nPts = pts.length;
    if (nPts < 2) {
      this.grenadeAimGroup.visible = false;
      return;
    }

    // 1. 更新抛物线轨迹线段
    const drawCount = Math.min(nPts, parts.MAX_POINTS);
    for (let i = 0; i < drawCount; i++) {
      const idx = drawCount === nPts ? i : Math.round((i / (drawCount - 1)) * (nPts - 1));
      const p = pts[idx];
      parts.linePos[i * 3] = p.x;
      parts.linePos[i * 3 + 1] = p.y;
      parts.linePos[i * 3 + 2] = p.z;
    }
    parts.lineGeo.setDrawRange(0, drawCount);
    parts.lineGeo.attributes.position.needsUpdate = true;

    // 2. 按弧长均匀分布并流动更新 28 颗带黑墨描边的抛物线导引珠
    const cumDist = new Float32Array(nPts);
    let totalLen = 0;
    for (let i = 1; i < nPts; i++) {
      totalLen += pts[i].distanceTo(pts[i - 1]);
      cumDist[i] = totalLen;
    }

    const beadCount = parts.beads.length;
    let seg = 1;
    for (let i = 0; i < beadCount; i++) {
      const u = (i + this.grenadeAimPhase) / beadCount;
      const targetDist = u * totalLen;
      while (seg < nPts - 1 && cumDist[seg] < targetDist) {
        seg++;
      }
      const prevD = cumDist[seg - 1];
      const nextD = cumDist[seg];
      const alpha = nextD > prevD ? (targetDist - prevD) / (nextD - prevD) : 0;
      const bead = parts.beads[i];
      bead.position.lerpVectors(pts[seg - 1], pts[seg], alpha);
      const s = 0.78 + Math.sin(u * Math.PI) * 0.42;
      bead.scale.setScalar(s);
    }

    // 3. 首次落点弹跳指示环（当落点与首次触地相距超过 1m 时显示）
    if (pred.firstImpact && pred.firstImpact.distanceTo(pred.finalPoint) > 1.0) {
      const by = this._groundHeightAt(pred.firstImpact.x, pred.firstImpact.z);
      parts.bounceRing.position.set(pred.firstImpact.x, by + 0.05, pred.firstImpact.z);
      parts.bounceRing.visible = true;
    } else {
      parts.bounceRing.visible = false;
    }

    // 4. 最终引爆落点靶标与威胁变色
    const t = performance.now() * 0.008;
    parts.landingGroup.position.set(pred.finalPoint.x, pred.groundY + 0.06, pred.finalPoint.z);
    const pulse = 1 + Math.sin(t) * 0.08;
    parts.landingGroup.scale.set(pulse, 1, pulse);
    parts.crossGroup.rotation.y += dt * 1.8;
    parts.arrowCone.position.y = 1.05 + Math.sin(t * 1.2) * 0.22;

    const inDanger = pred.directHit || pred.enemyInBlast;
    parts.beadMat.color.setHex(inDanger ? 0xff2a44 : 0xffe01b);
    parts.lineMat.color.setHex(inDanger ? 0xff2a44 : 0xffe01b);
    parts.ringMat.color.setHex(inDanger ? 0xff2a44 : 0xff7a00);
    parts.fillMat.color.setHex(inDanger ? 0xff2a44 : 0xff7a00);
    parts.arrowMat.color.setHex(inDanger ? 0xff2a44 : 0xff7a00);
    parts.crossMat.color.setHex(inDanger ? 0xffffff : 0xffe01b);

    this.grenadeAimGroup.visible = true;
  }

  throwGrenade(owner = this.player) {
    if (!this.canThrowGrenade(owner)) return false;
    owner.grenades -= 1;
    owner.grenadeCooldown = 0.55;

    const { spawnPos, vel } = this._computeGrenadeLaunch(owner);

    const { mesh, led } = this._makeGrenadeMesh();
    mesh.position.copy(spawnPos);
    this.levelRoot.add(mesh);

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
        this._disposeGrenadeMesh(g.mesh);
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
          setTimeout(() => {
            if (this.props.includes(pr)) this._explodeBarrel(pr);
          }, 90);
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
    if (p.slideCooldown > 0) p.slideCooldown = Math.max(0, p.slideCooldown - dt);
    if (p.grenadeCooldown > 0) p.grenadeCooldown = Math.max(0, p.grenadeCooldown - dt);
    this._decayCameraRecoil(dt);
    if (this.speedLineAlpha > 0) this.speedLineAlpha = Math.max(0, this.speedLineAlpha - dt * 3.0);

    // 键盘视角辅助旋转
    if (this.keys["ArrowLeft"]) p.yaw += 2.3 * dt;
    if (this.keys["ArrowRight"]) p.yaw -= 2.3 * dt;

    // 水平移动（冲刺 / 滑铲 / 常规走位）
    const move = new THREE.Vector3();
    if (p.dashTimer > 0) {
      p.dashTimer -= dt;
      move.copy(p.dashDir).multiplyScalar(25.0);
    } else if (p.slideTimer > 0) {
      p.slideTimer = Math.max(0, p.slideTimer - dt);
      const slideSpd = 10.5 + (p.slideTimer / 0.58) * 9.0;
      move.copy(p.slideDir).multiplyScalar(slideSpd);
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

    const targetSlide = p.slideTimer > 0 ? 1 : 0;
    p.slideAmount += (targetSlide - p.slideAmount) * Math.min(1, dt * (p.slideTimer > 0 ? 20 : 12));

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

    if (isMoving && p.onGround && p.slideTimer <= 0) {
      p.bobPhase += dt * 11.5;
    }

    // 动态平滑 FOV（ADS 机瞄缩放 / Dash / 滑铲速度拉伸 / 开火后坐力脉冲）
    const baseTargetFov = p.dashTimer > 0
      ? 85
      : THREE.MathUtils.lerp(this.baseFov, this.weapons.current.adsFov, this.weapons.adsAmount) + p.slideAmount * 9;
    const targetFov = baseTargetFov + this.recoilFovKick;
    if (this.renderer && Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 18);
      this.camera.updateProjectionMatrix();
    }

    this._syncCamera(dt);

    // 武器更新与连发
    this.weapons.update(dt, isMoving && p.onGround && p.slideTimer <= 0, p.slideAmount);
  }

  _syncCamera() {
    const p = this.player;
    const bob = this.renderer && p.onGround && p.slideTimer <= 0 ? Math.sin(p.bobPhase) * 0.055 : 0;
    const slideDrop = this.renderer ? (p.slideAmount || 0) * 0.78 : 0;
    const slideTilt = this.renderer ? -(p.slideAmount || 0) * 0.13 : 0;
    const activeShake = this.renderer && this.shake > 0 ? this.shake : 0;
    const sx = activeShake ? (Math.random() - 0.5) * activeShake * 0.018 : 0;
    const sy = activeShake ? (Math.random() - 0.5) * activeShake * 0.018 : 0;
    const rotShakeX = activeShake ? (Math.random() - 0.5) * activeShake * 0.0032 : 0;
    const rotShakeY = activeShake ? (Math.random() - 0.5) * activeShake * 0.0028 : 0;
    const rotShakeZ = activeShake ? (Math.random() - 0.5) * activeShake * 0.0038 : 0;

    this.camera.position.set(p.pos.x + sx, p.pos.y + this.eyeHeight - slideDrop + bob + sy, p.pos.z);
    this.camera.rotation.set(
      p.pitch + (this.renderer ? this.recoilPitch + rotShakeX : 0),
      p.yaw + (this.renderer ? rotShakeY : 0),
      this.renderer ? this.recoilRoll + slideTilt + rotShakeZ : 0,
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
        pr.mesh.position.y = (pr.baseElev || 0) + 0.55 + Math.sin(t + pr.id) * 0.12;
        if (!applyEffects) continue;
        const dist = Math.hypot(pr.x - p.pos.x, pr.z - p.pos.z);
        if (dist < 1.65 && Math.abs(p.pos.y) < 1.5) {
          if (pr.type === "medkit" && p.hp < p.maxHp) {
            pr.active = false;
            this.levelRoot.remove(pr.mesh);
            const prevHp = p.hp;
            p.hp = Math.min(p.maxHp, p.hp + 35);
            const gained = Math.max(1, Math.round(p.hp - prevHp));
            this.audio.playPickup();
            this.callbacks.onPickup?.(p, { kind: "medkit", amount: gained });
            this.spawnPopup(new THREE.Vector3(pr.x, 1.4, pr.z), `+${gained} HP!`, "#38e54d", 1.15);
          } else if (pr.type === "ammo") {
            pr.active = false;
            this.levelRoot.remove(pr.mesh);
            const gains = this.weapons.addAmmo();
            this.audio.playPickup();
            this.callbacks.onPickup?.(p, { kind: "ammo", gains });
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
      e.losTimer -= dt;
      const shouldCheckLos = e.losTimer <= 0;
      if (shouldCheckLos) e.losTimer = 0.095;

      let pPos;
      let seen;
      let nearest = Infinity;
      let nearestVisible = Infinity;
      const maxSeeDistSq = (e.range + 6) ** 2;
      for (const target of targets) {
        const distance = eEye.distanceToSquared(target);
        if (distance < nearest) {
          nearest = distance;
          pPos = target;
        }
        if (shouldCheckLos && distance < nearestVisible && distance < maxSeeDistSq
          && this._hasLineOfSight(eEye, target)) {
          nearestVisible = distance;
          seen = target;
        }
      }
      if (shouldCheckLos) {
        e.cachedSeen = seen || null;
      } else if (e.cachedSeen && targets.length === 1) {
        e.cachedSeen = targets[0];
      }
      seen = e.cachedSeen;
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
      if (this.sidewalkGrid) {
        const egx = Math.floor(e.root.position.x / CELL_SIZE);
        const egz = Math.floor(e.root.position.z / CELL_SIZE);
        e.root.position.y = this.sidewalkGrid[egz]?.[egx] ? 0.16 : 0;
      }

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
      .map((player) => [player, player.pos.clone().add(new THREE.Vector3(0, 1.15 - (player.slideAmount || 0) * 0.55, 0))]);

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

  _disposeGrenadeMesh(mesh) {
    mesh.removeFromParent();
    // The outline children share their parent's geometry and the game's ink material.
    for (const part of mesh.children) {
      part.geometry.dispose();
      part.material.dispose();
    }
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

  render(updateShadows = true) {
    const now = performance.now();
    if (updateShadows && now >= this.nextShadowUpdate) {
      this.renderer.shadowMap.needsUpdate = true;
      this.nextShadowUpdate = now + SHADOW_INTERVAL_MS;
    }
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
    if (!this.mapW) {
      miniCtx.clearRect(0, 0, w, h);
      return;
    }

    const cell = Math.min(w / this.mapW, h / this.mapH);
    const ox = (w - this.mapW * cell) / 2;
    const oy = (h - this.mapH * cell) / 2;

    const background = this.minimapBackground ??= document.createElement("canvas");
    if (this.minimapMap !== this.map || background.width !== w || background.height !== h) {
      this.minimapMap = this.map;
      background.width = w;
      background.height = h;
      const cached = background.getContext("2d");
      cached.fillStyle = "#14141e";
      cached.fillRect(0, 0, w, h);
      for (let z = 0; z < this.mapH; z++) {
        for (let x = 0; x < this.mapW; x++) {
          const c = this.map[z][x];
          if (c > 0) {
            cached.fillStyle = c === 6 ? "#b87828" : c === 10 ? "#d4af26" : "#4b5878";
            cached.fillRect(ox + x * cell, oy + z * cell, cell, cell);
          }
        }
      }
    }
    miniCtx.drawImage(background, 0, 0);

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
