import * as THREE from "three";
import { CELL_SIZE, COMIC_LEVELS } from "./levels.js";
import { StreetScenery } from "./scenery.js";
import { WeaponSystem3D } from "./weapons.js";

const MAX_RENDER_PIXELS = 2_600_000;
const SHADOW_INTERVAL_MS = 1000 / 20;
const PICKUP_LIFETIME = 20.0;
const PICKUP_WARN_WINDOW = 6.5;
const PICKUP_RESPAWN_MIN = 2.6;
const PICKUP_RESPAWN_MAX = 5.4;

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

    // 场景与正确比例的透视相机（远裁剪面 320m，完整覆盖 40×28 巨型街区与天际线）
    this.scene = new THREE.Scene();
    this.baseFov = 72;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 16 / 9, 0.08, 320);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    // 独立深度隔离第一人称武器渲染通道，彻底杜绝贴墙时枪管与拳套穿模
    if (glCanvas) {
      this.weaponScene = new THREE.Scene();
      this.weaponCamera = new THREE.PerspectiveCamera(this.baseFov, 16 / 9, 0.04, 10);
      this.weaponScene.add(this.weaponCamera);
      this._weaponHemiLight = new THREE.HemisphereLight(0xffffff, 0x262038, 1.2);
      this._weaponDirLight = new THREE.DirectionalLight(0xffffff, 1.45);
      this._weaponDirLight.position.set(3, 6, 4);
      this.weaponScene.add(this._weaponHemiLight, this._weaponDirLight);
    }

    // 3D 第一人称武器系统
    this.weapons = new WeaponSystem3D(
      glCanvas ? this.weaponCamera : null,
      this.assets,
      this.audio,
      glCanvas ? this.camera : null
    );

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
    this.sceneryColliders = [];
    this._cameraObstacleBoxes = [];
    this._menuOrbitProfile = null;
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
    this._tracerGeo = glCanvas ? new THREE.CylinderGeometry(1, 1, 1, 6).rotateX(Math.PI / 2) : null;
    this._projGeo = new THREE.SphereGeometry(1, 8, 8);
    this._shockwaveGeo = glCanvas ? new THREE.TorusGeometry(0.6, 0.14, 8, 24) : null;
    this._fxMatCache = new Map();
    this._tmpProjVec = new THREE.Vector3();

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
    if (this.weaponCamera) {
      this.weaponCamera.aspect = w / h;
      this.weaponCamera.updateProjectionMatrix();
    }
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

  _freezeStatic(obj) {
    obj.updateMatrix();
    obj.matrixAutoUpdate = false;
    return obj;
  }

  _getFxMaterial(color) {
    let mat = this._fxMatCache.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color });
      mat.userData.cachedFx = true;
      this._fxMatCache.set(color, mat);
    }
    return mat;
  }

  _clearLevel() {
    if (this.renderer) {
      const sharedGeometries = new Set([
        this.particleGeometry,
        this._tracerGeo,
        this._projGeo,
        this._shockwaveGeo,
        ...Object.values(this.streetScenery.shapes),
      ]);
      const sharedMaterials = new Set([
        this.assets.inkMaterial,
        this.assets.edgeMaterial,
        this.streetScenery.solidMaterial,
        this.streetScenery.emissiveMaterial,
        ...this._fxMatCache.values(),
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
      for (const geometry of geometries) {
        if (geometry.userData?.edgeGeometries) {
          for (const edgeGeo of geometry.userData.edgeGeometries.values()) edgeGeo.dispose();
          geometry.userData.edgeGeometries.clear();
        }
        geometry.dispose();
      }
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
    this.sceneryColliders = [];
    this._cameraObstacleBoxes = [];
    this._menuOrbitProfile = null;
    this.enemyProjectiles = [];
    this.projectileId = 0;
    this.grenades = [];
    this.grenadeId = 0;
    this.tracers = [];
    this.particles = [];
    this.shockwaves = [];
    this.popups = [];
    this.hitTargets = [];
    this.sceneryColliders = [];
    this._cameraObstacleBoxes = [];
    this._menuOrbitProfile = null;

    const worldW = this.mapW * CELL_SIZE;
    const worldH = this.mapH * CELL_SIZE;
    if (this.renderer) this._buildLevelLightingAndFloor(lvl, worldW, worldH);

    // 构建街区 3D 微凸起人行道 + 路沿石 + 连通道路标线，以及合并后的独立街区建筑
    this.sidewalkGrid = null;
    this.roadGrid = null;
    if (lvl.streetTheme) {
      this._build3DRoadsAndSidewalks(lvl);
    }
    this._buildLevelArchitecture(lvl);

    // 街区主题细节与碰撞盒（无渲染头节点 LAN 服务端同样计算，保持双端碰撞 100% 一致）
    if (lvl.streetTheme) {
      this._buildStreetBlockFurniture(lvl);
      this._buildDistrictLandmarks(lvl);
    } else {
      this._buildArenaEnvironmentDetails(lvl);
    }

    // 漫画城市天际线 & 大太阳背景
    if (this.renderer) this._buildComicSkyline(worldW, worldH, lvl);
    this.streetScenery?.build();
    this._buildMenuOrbitProfile();

    // 玩家出生点
    const startX = lvl.playerStart.x * CELL_SIZE;
    const startZ = lvl.playerStart.z * CELL_SIZE;
    this.player.pos.set(startX, this._groundHeightAt(startX, startZ), startZ);
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
    // 生成 3D 道具与油桶，并适度提高地上补给道具（医疗包/弹药）密度 + 错峰 20s 生命周期
    this._openPickupCells = this._collectOpenPickupCells();
    lvl.props.forEach((p, idx) => this._spawnProp(p, idx));
    const basePickups = lvl.props.filter((p) => this._isDynamicPickup(p.type));
    const extraCount = Math.max(2, Math.ceil(basePickups.length * 0.6));
    for (let k = 0; k < extraCount; k++) {
      const type = k % 2 === 0 ? "medkit" : "ammo";
      const spot = this._pickDynamicPickupSpot([], k);
      if (spot) {
        this._spawnProp({ type, x: spot.x / CELL_SIZE, z: spot.z / CELL_SIZE }, lvl.props.length + k);
      }
    }
    let dynIdx = 0;
    for (const pr of this.props) {
      if (!this._isDynamicPickup(pr.type)) continue;
      pr.life = 11.0 + ((dynIdx * 3.7) % 9.0);
      pr.respawnTimer = 0;
      pr.blinkPhase = 0;
      dynIdx++;
    }
    // 生成移动方块/浮空平台与周期激光封锁线
    if (lvl.movers) lvl.movers.forEach((m, idx) => this._spawnMover(m, idx));
    if (lvl.lasers) lvl.lasers.forEach((l, idx) => this._spawnLaser(l, idx));

    this.shake = 0;
    this._syncCamera(0);
  }

  _buildLevelLightingAndFloor(lvl, worldW, worldH) {
    const maxSpan = Math.max(worldW, worldH);
    this.scene.background = new THREE.Color(lvl.skyColor);
    const fogDensity = maxSpan >= CELL_SIZE * 34 ? 0.0062 : maxSpan >= CELL_SIZE * 20 ? 0.0085 : 0.014;
    this.scene.fog = new THREE.FogExp2(lvl.fogColor, fogDensity);

    this.levelRoot.add(new THREE.HemisphereLight(lvl.ambientColor, 0x262038, 1.15));
    this._weaponHemiLight?.color.setHex(lvl.ambientColor);
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
    this._freezeStatic(floor);
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
    const scenery = this.streetScenery;

    // 所有天际线远景摩天楼与发光窗带全部合批进 StreetScenery（零额外 Mesh / Draw Call！）
    for (let i = 0; i < 32; i++) {
      const ang = (i / 32) * Math.PI * 2;
      const dist = Math.max(worldW, worldH) * 0.72 + (i % 3) * 11;
      const bw = 7 + (i % 4) * 3;
      const bh = 18 + ((i * 7) % 28);
      const tx = cx + Math.cos(ang) * dist;
      const tz = cz + Math.sin(ang) * dist;
      scenery?.addEmissive("box", lvl.skylineColor, [tx, bh / 2 - 2, tz], [bw, bh, bw]);
      scenery?.addEmissive(
        "box",
        i % 2 === 0 ? 0xffe01b : 0x00e5ff,
        [tx, bh * 0.72 - 2, tz],
        [bw * 0.68, 1.4, bw + 0.25]
      );
      if (i % 3 === 0) {
        scenery?.addEmissive(
          "box",
          i % 6 === 0 ? 0xff2ebd : 0xffe01b,
          [tx, bh * 0.48 - 2, tz],
          [bw + 0.25, 1.1, bw * 0.62]
        );
      }
    }

    // 巨大漫画赛璐璐太阳（随地图尺寸自动外推，避免落入超大街区内部）
    const sunDist = Math.max(55, Math.max(worldW, worldH) * 0.68);
    const sunRadius = Math.max(9, Math.max(worldW, worldH) * 0.085);
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(sunRadius, 16, 16),
      new THREE.MeshBasicMaterial({ color: lvl.sunColor })
    );
    sun.position.set(cx + sunDist, Math.max(42, sunDist * 0.62), cz - sunDist);
    this.assets.addOutline(sun, 1.08);
    this._freezeStatic(sun);
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
    this.roadGrid = roadGrid;

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
        this._freezeStatic(slab);
        this.levelRoot.add(slab);
      }
    }

    // 3. 在所有「人行道与马路交界处」生成凸起的 3D 马路牙子路沿石 (高 0.20m，宽 0.24m)
    const curbH = 0.20;
    const curbW = 0.24;
    // Let the road-facing face extend beyond the slab so the two vertical faces never coincide.
    const curbInset = curbW * 0.5 - 0.045;
    const curbColor =
      lvl.districtStyle === "chinatown" ? 0xd9a84e :
      lvl.districtStyle === "nightmarket" ? 0x5c6482 :
      lvl.districtStyle === "oldquarter" ? 0xd8c19a :
      0xc8d0e0;

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
          this._freezeStatic(box);
          this.levelRoot.add(box);
          this.hitTargets.push(box);
        } else if (cell === 10) {
          const vType = (x * 3 + z * 5) % 4; // 0: 黄色出租车  1: 红白货车  2: 蓝白警车  3: 青金双门跑车
          const hitBox = new THREE.Mesh(crateGeo, vehicleCollisionMat);
          hitBox.position.set(wx, baseElev + crateH / 2, wz);
          hitBox.userData = { kind: "wall" };
          this._freezeStatic(hitBox);
          this.levelRoot.add(hitBox);
          this.hitTargets.push(hitBox);
          // 根据相邻街道走向自动旋转车辆方向，并叠加微小的自然停靠角度偏移
          const roadL = this.roadGrid?.[z]?.[x - 1] === 1 || this.map[z]?.[x - 1] === 0;
          const roadR = this.roadGrid?.[z]?.[x + 1] === 1 || this.map[z]?.[x + 1] === 0;
          const roadU = this.roadGrid?.[z - 1]?.[x] === 1 || this.map[z - 1]?.[x] === 0;
          const roadD = this.roadGrid?.[z + 1]?.[x] === 1 || this.map[z + 1]?.[x] === 0;
          const horizScore = (roadL ? 1 : 0) + (roadR ? 1 : 0);
          const vertScore = (roadU ? 1 : 0) + (roadD ? 1 : 0);
          const baseYaw = horizScore > vertScore
            ? (((x + z) % 2 === 0) ? Math.PI / 2 : -Math.PI / 2)
            : (((x * 3 + z) % 2 === 0) ? 0 : Math.PI);
          const organicJitter = ((((x * 19 + z * 37) % 11) - 5) / 5) * 0.07;
          this.streetScenery?.addVehicle(vType, wx, baseElev, wz, baseYaw + organicJitter);
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
          this._freezeStatic(wall);
          this.levelRoot.add(wall);
          this.hitTargets.push(wall);

          this.streetScenery?.addSolid("box", 0x16161e, [wx, guardH + 0.12, wz], [bw + 0.14, 0.24, bd + 0.14]);
          this._addCameraObstacleBox(wx - bw / 2 - 0.5, wx + bw / 2 + 0.5, wz - bd / 2 - 0.5, wz + bd / 2 + 0.5, guardH + 0.4);
        } else if (lvl.streetTheme) {
          // 街区内部：生成外观、层高、屋顶截然不同的独立建筑（装饰部件全合批进 StreetScenery）
          this._spawnDistinctCityBuilding(cell, x, z, wCells, dCells, wx, wz, bw, bd);
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
          this._freezeStatic(wall);
          this.levelRoot.add(wall);
          this.hitTargets.push(wall);

          this.streetScenery?.addSolid("box", 0x16161e, [wx, baseWallH + 0.14, wz], [bw + 0.14, 0.28, bd + 0.14]);
          this._addCameraObstacleBox(wx - bw / 2 - 0.5, wx + bw / 2 + 0.5, wz - bd / 2 - 0.5, wz + bd / 2 + 0.5, baseWallH + 0.5);
        }
      }
    }
  }

  // 生成 11 种外观、层高、屋顶结构截然不同的美式漫画街区独立建筑（所有装饰屋顶全合批进 StreetScenery，极致低 Draw Call）
  _spawnDistinctCityBuilding(cell, gx, gz, wCells, dCells, wx, wz, bw, bd) {
    const hash = Math.abs(gx * 31 + gz * 57 + wCells * 13 + dCells * 19);
    const variant = hash % 2;
    const organicStep = ((hash % 5) - 2) * 0.65; // -1.3m ~ +1.3m 非规则高低错落
    const heightByType = {
      7: 5.6 + variant * 0.9, // 街角漫画书店 / 复古快餐店
      9: 6.8 + variant * 1.1, // 街头波普涂鸦仓库 / 汽修厂
      11: 8.6 + variant * 1.6, // 唐人街朱红鎏金飞檐楼阁
      12: 7.4 + variant * 1.8, // 海港波纹集装箱货运大楼
      1: 9.0 + variant * 1.4, // 老城红砖联排楼
      4: 10.6 + variant * 1.2, // 复古红砖钟楼 / 啤酒厂
      13: 11.6 + variant * 1.2, // 大都会古典白大理石罗马柱银行
      14: 10.4 + (hash % 4) * 2.2, // 九龙城高密度霓虹夜市叠层筒楼
      15: 8.8 + (hash % 3) * 1.8, // 老城运河拱廊石灰岩陶瓦街楼
      8: 12.6 + variant * 2.2, // 三层褐石水塔公寓楼
      2: 17.5 + (hash % 3) * 3.2, // 现代霓虹玻璃摩天大楼
    };
    const bh = Math.max(5.2, (heightByType[cell] || 8.5) + organicStep);
    const mat = this.assets.wallMaterials[cell] || this.assets.wallMaterials[1];

    const bodyGeo = new THREE.BoxGeometry(bw, bh, bd);
    this._applyBoxWorldUVs(bodyGeo, bw, bh, bd, CELL_SIZE, 4.8);
    const building = new THREE.Mesh(bodyGeo, mat);
    building.position.set(wx, bh / 2, wz);
    building.castShadow = true;
    building.receiveShadow = true;
    this.assets.addCreaseLines(building);
    building.userData = { kind: "wall" };
    this._freezeStatic(building);
    this.levelRoot.add(building);
    this.hitTargets.push(building);

    const crownAllowance =
      cell === 2 ? 8.6 :
      cell === 4 ? 6.0 :
      cell === 15 ? 6.6 :
      cell === 11 ? 5.4 :
      cell === 13 ? Math.max(4.2, 2.8 + Math.min(bw, bd) * 0.56) :
      4.0;
    const overhangPadX = cell === 11 ? 0.9 : 0.75;
    const overhangPadZ = cell === 12 ? 1.45 : cell === 11 ? 0.9 : 0.75;
    this._addCameraObstacleBox(
      wx - bw / 2 - overhangPadX,
      wx + bw / 2 + overhangPadX,
      wz - bd / 2 - overhangPadZ,
      wz + bd / 2 + overhangPadZ,
      bh + crownAllowance
    );

    if (!this.renderer) return;

    const sc = this.streetScenery;
    const solid = (shape, color, x, y, z, sx, sy, sz) => sc?.addSolid(shape, color, [x, y, z], [sx, sy, sz]);
    const glow = (shape, color, x, y, z, sx, sy, sz) => sc?.addEmissive(shape, color, [x, y, z], [sx, sy, sz]);

    // 底部勒脚石材压边 + 屋顶墨线挑檐（全合批零新增 Mesh）
    solid("box", 0x262836, wx, 0.28, wz, bw + 0.16, 0.24, bd + 0.16);
    solid("box", 0x16161e, wx, bh + 0.17, wz, bw + 0.24, 0.34, bd + 0.24);
    this._addFacadeRelief(cell, gx, gz, wCells, dCells, bh);
    sc?.addRooftopDetail(hash % 4, wx, bh + 0.34, wz, bw, bd);

    // 按建筑类型添加合批立体屋顶、招牌与门头结构
    if (cell === 7) {
      // 【类型 7：漫画书店 & 复古快餐店】外挑红黄遮阳雨棚 + 发光屋顶大招牌
      solid("box", variant === 0 ? 0xff2a44 : 0xffe01b, wx, 3.15, wz, bw + 0.85, 0.42, bd + 0.85);
      solid("box", 0x16161e, wx, 3.38, wz, bw + 0.90, 0.08, bd + 0.90);
      glow("box", variant === 0 ? 0xffe01b : 0xff2ebd, wx, bh + 1.25, wz, bw * 0.75, 1.85, 0.55);
      solid("box", 0x16161e, wx, bh + 1.25, wz, bw * 0.78, 1.98, 0.42);
    } else if (cell === 11) {
      // 【类型 11：唐人街东方飞檐楼阁】双层翡翠绿/金黄出挑飞檐攒尖屋顶
      solid("box", 0x00a86b, wx, bh + 0.55, wz, bw + 1.3, 0.55, bd + 1.3);
      solid("box", 0xb81d24, wx, bh + 1.9, wz, bw * 0.66, 2.2, bd * 0.66);
      solid("box", 0xffae19, wx, bh + 3.25, wz, bw * 0.82, 0.5, bd * 0.82);
      solid("pyramid", 0x00a86b, wx, bh + 4.2, wz, bw * 0.68, 1.45, bd * 0.68);
    } else if (cell === 12) {
      // 【类型 12：布鲁克林海港货运集装箱大楼】屋顶彩色集装箱与斜拉悬臂吊架
      solid("box", variant === 0 ? 0xff7a00 : 0xd92638, wx - bw * 0.08, bh + 1.5, wz, bw * 0.72, 2.4, Math.min(3.6, bd * 0.55));
      solid("box", 0xffe01b, wx + bw * 0.25, bh + 3.1, wz, 0.55, 0.55, bd + 2.6);
      solid("box", 0x222634, wx + bw * 0.25, bh + 1.6, wz, 0.65, 2.7, 0.65);
    } else if (cell === 13) {
      // 【类型 13：大都会古典白大理石银行大厦】台阶式黄金三角山墙屋顶 + 古典金穹顶
      solid("box", 0xf5efe2, wx, bh + 0.95, wz, bw * 0.86, 1.35, bd * 0.86);
      const domeD = Math.min(bw, bd) * 0.56;
      solid("sphere", 0xffcf33, wx, bh + 1.9, wz, domeD, domeD * 0.85, domeD);
      glow("cylinder", 0xffe875, wx, bh + 1.9 + domeD * 0.55, wz, 0.24, 1.4, 0.24);
    } else if (cell === 8) {
      // 【类型 8：三层褐石公寓楼】中层石材腰线 + 屋顶阁楼出口 + 纽约复古木水塔
      solid("box", 0xf7b733, wx, bh * 0.52, wz, bw + 0.18, 0.28, bd + 0.18);
      solid("box", 0x9c5221, wx - bw * 0.18, bh + 1.2, wz - bd * 0.15, Math.min(3.2, bw * 0.45), 2.1, Math.min(3.2, bd * 0.45));
      solid("cylinder", 0xb86b2b, wx + bw * 0.18, bh + 1.5, wz + bd * 0.15, 2.2, 2.1, 2.2);
      solid("cone", 0x22222c, wx + bw * 0.18, bh + 3.0, wz + bd * 0.15, 2.56, 0.95, 2.56);
    } else if (cell === 2) {
      // 【类型 2：现代霓虹玻璃摩天大楼】帝国大厦式二段退台塔冠 + 发光霓虹腰带与尖塔
      const crownH = 3.6;
      solid("box", 0x16284c, wx, bh + 0.34 + crownH / 2, wz, bw * 0.68, crownH, bd * 0.68);
      glow("box", 0x00e5ff, wx, bh + 0.34 + crownH, wz, bw * 0.72, 0.45, bd * 0.72);
      glow("cylinder", 0xffe01b, wx, bh + crownH + 2.4, wz, 0.36, 4.2, 0.36);
    } else if (cell === 9) {
      // 【类型 9：街头涂鸦红砖仓库/车库】工业钢结构采光天窗
      solid("box", 0x7f8c9a, wx, bh + 0.85, wz, bw * 0.62, 1.1, bd * 0.52);
      glow("box", 0xa8ecff, wx, bh + 1.44, wz, bw * 0.54, 0.14, bd * 0.42);
    } else if (cell === 4 || cell === 1) {
      // 【类型 4/1：工业钟楼啤酒厂/老街红砖楼】古典山墙压顶 + 工业高耸砖烟囱
      solid("box", cell === 4 ? 0x5b2c83 : 0x8f2820, wx, bh + 0.9, wz, bw * 0.82, 1.25, bd * 0.82);
      if (cell === 4) {
        solid("cylinder", 0x9e3328, wx + bw * 0.2, bh + 3.2, wz, 1.35, 4.6, 1.35);
        solid("cylinder", 0x22222c, wx + bw * 0.2, bh + 5.55, wz, 1.48, 0.26, 1.48);
      }
    } else if (cell === 14) {
      // 【类型 14：霓虹九龙城夜市叠层楼】偏心天台铁皮违建阁楼 + 悬挑双色霓虹雨棚 + 发光霓虹光带
      solid("box", variant === 0 ? 0xff2ebd : 0x00c8e8, wx, 3.35, wz, bw + 0.95, 0.34, bd + 0.95);
      solid("box", variant === 0 ? 0x3b4363 : 0x56396b, wx + (variant === 0 ? -bw * 0.16 : bw * 0.16), bh + 1.5, wz + (variant === 0 ? bd * 0.12 : -bd * 0.12), Math.max(2.8, bw * 0.54), 2.35, Math.max(2.8, bd * 0.54));
      glow("box", variant === 0 ? 0x00e5ff : 0xff2ebd, wx, bh - 0.65, wz, bw + 0.42, 0.32, bd + 0.42);
    } else if (cell === 15) {
      // 【类型 15：老城运河拱廊石灰岩陶瓦楼】阶梯式陶土瓦斜顶 + 偏心欧式小钟楼尖顶
      solid("box", 0xf4e3c1, wx, 3.65, wz, bw + 0.26, 0.32, bd + 0.26);
      solid("box", variant === 0 ? 0xc44e32 : 0xa63f2a, wx, bh + 0.9, wz, bw * 0.92, 1.15, bd * 0.92);
      solid("box", variant === 0 ? 0xd8623d : 0xb84c33, wx, bh + 1.95, wz, bw * 0.62, 1.05, bd * 0.62);
      if (wCells >= 3 || dCells >= 3) {
        solid("box", 0xe6cfa8, wx - bw * 0.22, bh + 2.6, wz - bd * 0.22, 2.2, 2.8, 2.2);
        solid("pyramid", 0x265d6e, wx - bw * 0.22, bh + 5.05, wz - bd * 0.22, 2.4, 2.2, 2.4);
      }
    }
  }

  // 为全部 6 张街区地图构建截然不同的标志性大场景立体地标与物理/视角包围盒
  _buildDistrictLandmarks(lvl) {
    const sc = this.streetScenery;

    // 真实垂坠悬链电线 + 精致吊绳挂灯 / 节庆彩旗（跳过实心建筑内部的挂灯，彻底杜绝穿模）
    const addHangingCable = (x1, z1, x2, z2, y, colors, style = "lantern") => {
      if (!sc) return;
      const wx1 = x1 * CELL_SIZE;
      const wz1 = z1 * CELL_SIZE;
      const wx2 = x2 * CELL_SIZE;
      const wz2 = z2 * CELL_SIZE;
      const len = Math.hypot(wx2 - wx1, wz2 - wz1);
      const yaw = Math.atan2(wx2 - wx1, wz2 - wz1);
      const sagAmt = Math.min(1.15, Math.max(0.55, len * 0.032));
      const cableSteps = Math.max(8, Math.ceil(len / 2.2));
      const pointAt = (t) => [
        wx1 + (wx2 - wx1) * t,
        y + 0.55 - Math.sin(t * Math.PI) * sagAmt,
        wz1 + (wz2 - wz1) * t,
      ];

      // 两端锚固支架与真实垂坠悬链主缆
      sc.addSolid("box", 0x181a24, [wx1, y + 0.55, wz1], [0.18, 0.18, 0.18]);
      sc.addSolid("box", 0x181a24, [wx2, y + 0.55, wz2], [0.18, 0.18, 0.18]);
      let prev = pointAt(0);
      for (let s = 1; s <= cableSteps; s++) {
        const cur = pointAt(s / cableSteps);
        sc.addSegment(0x161822, prev, cur, 0.055);
        prev = cur;
      }

      const count = Math.max(4, Math.floor(len / (style === "bunting" ? 2.1 : 3.1)));
      for (let i = 1; i < count; i++) {
        const t = i / count;
        const [lx, cy, lz] = pointAt(t);
        const c = this._cellAt(lx, lz);
        if (c > 0 && !this._isLowCoverCell(c)) continue;
        const col = colors[(i + Math.floor(x1 + z1)) % colors.length];
        if (style === "bunting") {
          // 彩旗直接绑在垂坠主绳上，并穿插短吊绳暖光灯泡
          sc.addSolid("box", 0x161822, [lx, cy, lz], [0.07, 0.07, 0.07]);
          sc.addSolid("cone", col, [lx, cy - 0.30, lz], [0.46, 0.54, 0.10], yaw);
          if (i % 2 === 0) {
            sc.addHangingLantern(lx, cy, lz, 0.28, 0xffe885, "bulb");
          }
        } else {
          // 每盏挂灯拥有 0.42m ~ 0.68m 错落吊绳长度，真实自然
          const dropLen = 0.42 + ((i * 7 + Math.floor(x1)) % 3) * 0.13;
          sc.addHangingLantern(lx, cy, lz, dropLen, col, style);
        }
      }
    };

    if (lvl.districtStyle === "alley") {
      // ISSUE #1 市中心暗巷：垂坠电线 + 复古工业搪瓷罩吊灯 + 美漫铁艺消防逃生梯
      addHangingCable(2.0, 4.5, 11.5, 4.0, 5.4, [0xffe01b, 0xff7a2a, 0x00e5ff], "bulb");
      addHangingCable(3.5, 7.2, 11.5, 8.2, 5.2, [0xff5a2a, 0xffe01b], "bulb");
      if (sc) {
        sc.addFireEscape(6.0 * CELL_SIZE, 0.16, 4.95 * CELL_SIZE, Math.PI, 2);
        sc.addFireEscape(9.95 * CELL_SIZE, 0.16, 4.05 * CELL_SIZE, 0, 1);
        sc.addFireEscape(8.95 * CELL_SIZE, 0.16, 8.0 * CELL_SIZE, Math.PI, 2);
      }
    } else if (lvl.districtStyle === "chinatown") {
      // ISSUE #2 落日唐人街：跨越主干道的朱红鎏金中式牌楼 + 纵横交错的红金垂坠吊绳灯笼索道
      const buildArchway = (wx, wz, span, rotateY = 0) => {
        const c = Math.cos(rotateY);
        const s = Math.sin(rotateY);
        const absC = Math.abs(c);
        const absS = Math.abs(s);
        for (const px of [-span * 0.5, span * 0.5]) {
          const colX = wx + px * c;
          const colZ = wz - px * s;
          this._addSceneryCollider(colX, colZ, 0.48, 0.48, 6.2);
          if (sc) {
            const lx = wx + (px * 0.72) * c;
            const lz = wz - (px * 0.72) * s;
            sc.addHangingLantern(lx, 5.3, lz, 0.45, 0xff2a38, "lantern");
          }
        }
        const halfSpan = span * 0.5 + 1.4;
        const halfDepth = 0.9;
        this._addCameraObstacleBox(
          wx - (halfSpan * absC + halfDepth * absS),
          wx + (halfSpan * absC + halfDepth * absS),
          wz - (halfSpan * absS + halfDepth * absC),
          wz + (halfSpan * absS + halfDepth * absC),
          7.4
        );
        if (!sc) return;
        const part = sc._makePartHelper(wx, 0, wz, rotateY);
        for (const px of [-span * 0.5, span * 0.5]) {
          part("cylinder", 0xd92027, px, 3.1, 0, 0.62, 6.2, 0.62);
          part("box", 0x5c2020, px, 0.32, 0, 0.96, 0.64, 0.96);
        }
        part("box", 0xffcf26, 0, 5.7, 0, span + 1.4, 0.85, 0.72);
        part("box", 0xd92027, 0, 5.7, 0.4, 3.2, 0.65, 0.14);
        part("box", 0xffe97d, 0, 5.7, 0.5, 2.5, 0.38, 0.08, 0, true);
        part("box", 0x00a86b, 0, 6.45, 0, span + 2.6, 0.65, 1.48);
        part("box", 0xffae19, 0, 6.86, 0, span + 1.8, 0.24, 0.76);
      };
      buildArchway(3.0 * CELL_SIZE, 10.5 * CELL_SIZE, 9.2, 0);
      buildArchway(14.5 * CELL_SIZE, 3.0 * CELL_SIZE, 9.2, Math.PI / 2);
      addHangingCable(3.5, 4.5, 18.5, 4.5, 5.8, [0xff2a38, 0xffcf26, 0xff5a1f], "lantern");
      addHangingCable(5.0, 9.2, 18.0, 8.8, 5.6, [0xffcf26, 0xff2a38], "lantern");
      addHangingCable(10.5, 6.5, 10.5, 13.8, 5.5, [0xff2a38, 0xffcf26], "lantern");
    } else if (lvl.districtStyle === "harbor") {
      // ISSUE #4 布鲁克林海港：高架轻轨铁道桥 + 地铁涂鸦列车 + 港口龙门钢拱 + 吊绳工业警示灯
      const railY = 6.2;
      const deckLen = (this.mapW - 2) * CELL_SIZE;
      const deckX = this.mapW * 0.5 * CELL_SIZE;
      const deckZ = 10.0 * CELL_SIZE;
      this._addCameraObstacleBox(0, this.mapW * CELL_SIZE, deckZ - 2.9, deckZ + 2.9, railY + 5.2);
      if (sc) {
        sc.addSolid("box", 0x3b4859, [deckX, railY, deckZ], [deckLen, 0.75, 4.4]);
        sc.addSolid("box", 0xffae19, [deckX, railY + 0.6, deckZ - 2.1], [deckLen, 0.45, 0.25]);
        sc.addSolid("box", 0xffae19, [deckX, railY + 0.6, deckZ + 2.1], [deckLen, 0.45, 0.25]);
        // 桥腹工字钢横肋与高架接触网门架
        for (let gx = 4; gx < this.mapW - 3; gx += 5) {
          const px = gx * CELL_SIZE;
          sc.addSolid("box", 0x263140, [px, railY - 0.55, deckZ], [0.75, 0.45, 4.7]);
          sc.addSolid("box", 0x4b5b70, [px, railY + 2.6, deckZ - 2.25], [0.24, 4.2, 0.24]);
          sc.addSolid("box", 0x4b5b70, [px, railY + 2.6, deckZ + 2.25], [0.24, 4.2, 0.24]);
          sc.addSolid("box", 0x4b5b70, [px, railY + 4.7, deckZ], [0.26, 0.26, 4.8]);
          sc.addEmissive("box", gx % 2 === 0 ? 0xffae19 : 0x00e5ff, [px, railY + 4.4, deckZ], [0.32, 0.22, 0.65]);
        }
        // 高架桥停靠的美漫红色涂鸦地铁列车（含车窗与车头灯）
        const trainX = this.mapW * 0.55 * CELL_SIZE;
        sc.addSolid("box", 0xd92638, [trainX, railY + 1.65, deckZ], [18.0, 2.5, 3.2]);
        sc.addSolid("box", 0x202534, [trainX, railY + 2.95, deckZ], [17.4, 0.26, 2.8]);
        for (let w = -6.5; w <= 6.5; w += 2.6) {
          sc.addEmissive("box", 0xffe885, [trainX + w, railY + 1.85, deckZ + 1.62], [1.65, 0.85, 0.08]);
          sc.addEmissive("box", 0xffe885, [trainX + w, railY + 1.85, deckZ - 1.62], [1.65, 0.85, 0.08]);
        }
        sc.addEmissive("box", 0xfff5c0, [trainX - 9.05, railY + 1.15, deckZ], [0.12, 0.42, 1.8]);
      }
      // 海港跨街钢缆吊绳工业灯
      addHangingCable(3.5, 2.5, 13.5, 3.0, 5.6, [0xffae19, 0x00e5ff], "bulb");
      addHangingCable(14.5, 14.5, 23.5, 15.0, 5.6, [0xffae19, 0xff5a2a], "bulb");
    } else if (lvl.districtStyle === "metropolis") {
      // ISSUE #6 大都会环形金融广场：合批实例化翠绿行道树（贴墙安全间距检测）+ 石材修剪绿篱 + 跨街 Art-Deco 金色凯旋横幅门
      const metroReserved = [];
      if (lvl.playerStart) metroReserved.push([lvl.playerStart.x * CELL_SIZE, lvl.playerStart.z * CELL_SIZE, 3.4]);
      for (const e of lvl.enemies || []) metroReserved.push([e.x * CELL_SIZE, e.z * CELL_SIZE, 2.4]);
      for (const p of lvl.props || []) metroReserved.push([p.x * CELL_SIZE, p.z * CELL_SIZE, 2.4]);
      const isMetroTreeClear = (tx, tz) => {
        if (!this._hasWallClearance(tx, tz, 1.42)) return false;
        for (let i = 0; i < metroReserved.length; i++) {
          const [rx, rz, rr] = metroReserved[i];
          if ((tx - rx) ** 2 + (tz - rz) ** 2 < rr * rr) return false;
        }
        return true;
      };
      for (let z = 3; z < this.mapH - 3; z += 5) {
        for (let x = 3; x < this.mapW - 3; x += 6) {
          if (!this.sidewalkGrid?.[z]?.[x] || this.map[z][x] !== 0) continue;
          const wx = (x + 0.5) * CELL_SIZE;
          const wz = (z + 0.5) * CELL_SIZE;
          if (!isMetroTreeClear(wx, wz)) continue;
          sc?.addTree(wx, 0.16, wz, 0.95, 0x2ecc71, true);
          this._addSceneryCollider(wx, wz, 0.48, 0.48, 0.16 + 3.2);
        }
      }
      // 中央银行大道石材绿篱与 Art-Deco 金融拱门
      for (const gx of [10, 19]) {
        const ax = gx * CELL_SIZE + 2.0;
        this._addCameraObstacleBox(ax - 0.65, ax + 0.65, 9.5 * CELL_SIZE - 6.2, 9.5 * CELL_SIZE + 6.2, 7.0);
        if (sc) {
          sc.addSolid("box", 0xd4af37, [ax, 5.9, 9.5 * CELL_SIZE], [0.55, 0.85, 11.6]);
          sc.addEmissive("box", 0x00e5ff, [ax, 6.45, 9.5 * CELL_SIZE], [0.22, 0.22, 10.6]);
        }
      }
      for (const [hx, hz, rot] of [[14.5, 4.2, 0], [14.5, 14.8, 0], [5.2, 9.5, Math.PI / 2], [24.8, 9.5, Math.PI / 2]]) {
        if (this.map[Math.floor(hz)]?.[Math.floor(hx)] === 0) {
          const hwx = hx * CELL_SIZE;
          const hwz = hz * CELL_SIZE;
          sc?.addPlanterHedge(hwx, 0.16, hwz, rot, 0x27ae60);
          this._addRotatedSceneryCollider(hwx, hwz, 1.12, 0.46, rot, 0.16 + 1.25);
        }
      }
    } else if (lvl.districtStyle === "nightmarket") {
      // ISSUE #7 霓虹九龙城与迷宫夜市街区：三座高低错落霓虹连廊天桥（全合批）+ 斜拉发光吊绳霓虹灯笼索道
      const addSkybridge = (x1, z1, x2, z2, y, neonColor, trimColor) => {
        const dx = (x2 - x1) * CELL_SIZE;
        const dz = (z2 - z1) * CELL_SIZE;
        const len = Math.hypot(dx, dz);
        const mx = ((x1 + x2) * 0.5) * CELL_SIZE;
        const mz = ((z1 + z2) * 0.5) * CELL_SIZE;
        const angle = Math.atan2(dx, dz);
        const hw = Math.abs(Math.cos(angle)) * 1.9 + Math.abs(Math.sin(angle)) * (len * 0.5);
        const hd = Math.abs(Math.sin(angle)) * 1.9 + Math.abs(Math.cos(angle)) * (len * 0.5);
        this._addCameraObstacleBox(mx - hw, mx + hw, mz - hd, mz + hd, y + 3.0);
        if (!sc) return;
        const part = sc._makePartHelper(mx, y, mz, angle);
        part("box", 0x22263c, 0, 0, 0, 3.2, 0.55, len);
        part("box", trimColor, -1.5, 0.85, 0, 0.24, 1.35, len);
        part("box", trimColor, 1.5, 0.85, 0, 0.24, 1.35, len);
        part("box", neonColor, -1.72, 1.05, 0, 0.18, 0.92, Math.min(len * 0.58, 9.5), 0, true);
        part("box", neonColor, 1.72, 1.05, 0, 0.18, 0.92, Math.min(len * 0.58, 9.5), 0, true);
        part("box", 0x181c2e, 0, 2.45, 0, 3.6, 0.28, len);
      };
      addSkybridge(11.0, 7.5, 16.5, 7.5, 6.4, 0xff2ebd, 0x3f4768);
      addSkybridge(23.5, 11.5, 23.5, 16.5, 7.2, 0x00e5ff, 0x453263);
      addSkybridge(8.5, 15.5, 8.5, 20.5, 6.0, 0xffe01b, 0x3b4464);

      const lanternColors = [0xff2ebd, 0x00e5ff, 0xffe01b, 0xff5a2a];
      addHangingCable(13.5, 11.5, 22.5, 14.5, 5.8, lanternColors, "lantern");
      addHangingCable(14.5, 16.5, 22.0, 12.0, 6.2, lanternColors, "lantern");
      addHangingCable(14.0, 18.0, 21.5, 18.8, 5.6, lanternColors, "lantern");
      addHangingCable(26.5, 5.5, 31.5, 9.5, 5.9, lanternColors, "lantern");
      addHangingCable(7.0, 10.5, 14.0, 13.2, 5.7, lanternColors, "lantern");
    } else if (lvl.districtStyle === "oldquarter") {
      // ISSUE #8 老城运河弯街与大巴扎钟楼区：跨街石拱高架水道桥 + 中央四向穿行大钟楼拱门亭 + 垂坠彩旗与暖光吊灯（全合批！）
      const archY = 6.4;
      const archZ = 19.5 * CELL_SIZE;
      const spanLen = (this.mapW - 4) * CELL_SIZE;
      const midX = this.mapW * 0.5 * CELL_SIZE;
      this._addCameraObstacleBox(2 * CELL_SIZE, (this.mapW - 2) * CELL_SIZE, archZ - 2.1, archZ + 2.1, archY + 2.4);
      if (sc) {
        sc.addSolid("box", 0xd6c3a3, [midX, archY, archZ], [spanLen, 1.35, 3.2]);
        sc.addSolid("box", 0xb09670, [midX, archY + 0.96, archZ - 1.42], [spanLen, 0.72, 0.36]);
        sc.addSolid("box", 0xb09670, [midX, archY + 0.96, archZ + 1.42], [spanLen, 0.72, 0.36]);

        for (let gx = 4; gx < this.mapW - 4; gx += 6) {
          const px = gx * CELL_SIZE;
          sc.addSolid("box", 0xc4ae8c, [px, archY - 1.1, archZ], [1.4, 1.35, 3.45]);
          sc.addEmissive("box", 0xffe87d, [px, archY + 1.65, archZ - 1.45], [0.35, 0.55, 0.35]);
          sc.addEmissive("box", 0xffe87d, [px, archY + 1.65, archZ + 1.45], [0.35, 0.55, 0.35]);
        }
      }

      // 中央四向穿行钟楼拱门亭 (21.5, 13.5)
      const fx = 21.5 * CELL_SIZE;
      const fz = 13.5 * CELL_SIZE;
      this._addCameraObstacleBox(fx - 4.0, fx + 4.0, fz - 4.0, fz + 4.0, 17.0);
      for (const sx of [-2.8, 2.8]) {
        for (const sz of [-2.8, 2.8]) {
          this._addSceneryCollider(fx + sx, fz + sz, 0.58, 0.58, 5.2);
        }
      }
      if (sc) {
        sc.addSolid("cylinder", 0xe6d4b3, [fx, 0.03, fz], [8.8, 0.06, 8.8]);
        sc.addEmissive("cylinder", 0x00d9ff, [fx, 0.045, fz], [4.2, 0.08, 4.2]);
        for (const sx of [-2.8, 2.8]) {
          for (const sz of [-2.8, 2.8]) {
            sc.addSolid("box", 0xd6c3a3, [fx + sx, 2.6, fz + sz], [0.85, 5.2, 0.85]);
            sc.addSolid("box", 0xb09670, [fx + sx, 0.25, fz + sz], [1.15, 0.5, 1.15]);
          }
        }
        sc.addSolid("box", 0xb09670, [fx, 5.65, fz], [7.0, 1.1, 7.0]);
        sc.addSolid("box", 0xd6c3a3, [fx, 8.4, fz], [4.6, 4.4, 4.6]);
        // 四面发光金色大钟盘
        for (const [dx, dz, rw, rd] of [[0, 2.36, 2.5, 0.16], [0, -2.36, 2.5, 0.16], [2.36, 0, 0.16, 2.5], [-2.36, 0, 0.16, 2.5]]) {
          sc.addSolid("box", 0xd4af37, [fx + dx, 8.6, fz + dz], [rw, 2.5, rd]);
          sc.addEmissive("box", 0xfff3c4, [fx + dx * 1.03, 8.6, fz + dz * 1.03], [rw === 0.16 ? 0.10 : 2.05, 2.05, rd === 0.16 ? 0.10 : 2.05]);
        }
        sc.addSolid("pyramid", 0x226878, [fx, 12.7, fz], [4.8, 4.2, 4.8]);
        sc.addEmissive("cylinder", 0xffcf33, [fx, 15.4, fz], [0.28, 2.2, 0.28]);
      }

      const flagColors = [0xff4b3e, 0xffcf33, 0x26b5c4, 0xff7a00, 0xf7f0d8];
      addHangingCable(16.5, 10.0, 26.5, 11.5, 6.0, flagColors, "bunting");
      addHangingCable(16.5, 16.5, 26.5, 15.5, 5.8, flagColors, "bunting");
      addHangingCable(5.5, 7.5, 12.5, 10.5, 5.6, flagColors, "bunting");
      addHangingCable(29.5, 7.5, 35.5, 11.5, 5.8, flagColors, "bunting");
    }
  }

  // 为所有非街区竞技场地图（ISSUE #3 墨水工厂 / ISSUE #5 霓虹天台 / ISSUE #9 半调博士实验室）构建合批精细环境细节与碰撞盒
  _buildArenaEnvironmentDetails(lvl) {
    const sc = this.streetScenery;
    const W = this.mapW;
    const H = this.mapH;
    const worldW = W * CELL_SIZE;
    const worldH = H * CELL_SIZE;

    // 1. 通用墙面立柱壁肋与底角防撞线（合批进 StreetScenery，彻底告别光秃秃的方块墙）
    if (sc) {
      const isSolid = (gx, gz) => {
        const c = this.map[gz]?.[gx] || 0;
        return c > 0 && !this._isLowCoverCell(c);
      };
      const ribColor = lvl.floorTex === "factoryFloor" ? 0x394659 : lvl.floorTex === "labFloor" ? 0x3b1f5e : 0x283652;
      const accentColor = lvl.floorTex === "factoryFloor" ? 0xffae19 : lvl.floorTex === "labFloor" ? 0x00ff99 : 0x00e5ff;

      for (let z = 0; z < H; z++) {
        for (let x = 0; x < W; x++) {
          if (!isSolid(x, z)) continue;
          for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            if (this.map[z + nz]?.[x + nx] !== 0) continue;
            const fx = (x + 0.5 + 0.5 * nx) * CELL_SIZE;
            const fz = (z + 0.5 + 0.5 * nz) * CELL_SIZE;
            const horiz = nz !== 0;
            // 墙脚防撞踢脚线 + 竖向钢结构壁柱
            sc.addSolid("box", ribColor, [fx + nx * 0.08, 0.24, fz + nz * 0.08], [horiz ? CELL_SIZE * 0.96 : 0.16, 0.44, horiz ? 0.16 : CELL_SIZE * 0.96]);
            if ((x + z) % 2 === 0) {
              sc.addSolid("box", ribColor, [fx + nx * 0.14, 2.45, fz + nz * 0.14], [horiz ? 0.34 : 0.28, 4.7, horiz ? 0.28 : 0.34]);
              sc.addEmissive("box", accentColor, [fx + nx * 0.29, 3.85, fz + nz * 0.29], [horiz ? 0.18 : 0.08, 0.65, horiz ? 0.08 : 0.18]);
            }
          }
        }
      }
    }

    if (lvl.floorTex === "factoryFloor") {
      // 【ISSUE #3 · 墨水工厂】：钢结构屋顶桁架 + 悬挂工业暖黄吊灯 + 顶部四色 CMYK 巨型墨水管道 + 四角发光墨水巨罐
      this._addCameraObstacleBox(CELL_SIZE, worldW - CELL_SIZE, CELL_SIZE, worldH - CELL_SIZE, 6.6);
      const vatSpecs = [
        [1.7 * CELL_SIZE, 1.7 * CELL_SIZE, 0x00e5ff],
        [1.7 * CELL_SIZE, (H - 1.7) * CELL_SIZE, 0xff2ebd],
        [(W - 1.7) * CELL_SIZE, 1.7 * CELL_SIZE, 0xffe01b],
        [(W - 1.7) * CELL_SIZE, (H - 1.7) * CELL_SIZE, 0x00ffaa],
      ];
      for (const [vx, vz, vcol] of vatSpecs) {
        this._addSceneryCollider(vx, vz, 0.94, 0.94, 4.2);
        sc?.addIndustrialVat(vx, 0, vz, vcol);
      }
      if (sc) {
        for (let gx = 3; gx < W - 2; gx += 4) {
          const px = gx * CELL_SIZE;
          sc.addSolid("box", 0x2c384a, [px, 5.45, worldH * 0.5], [0.46, 0.52, worldH - CELL_SIZE * 1.4]);
          for (const fz of [3.5 * CELL_SIZE, 7.5 * CELL_SIZE]) {
            sc.addSolid("box", 0x1a202c, [px, 5.05, fz], [0.95, 0.24, 0.95]);
            sc.addEmissive("box", 0xffe885, [px, 4.88, fz], [0.76, 0.12, 0.76]);
          }
        }
        // 贯穿工厂天花板的 CMYK 四色巨型输墨主管道
        const pipeSpecs = [
          [2.2 * CELL_SIZE, 0x00e5ff],
          [4.2 * CELL_SIZE, 0xff2ebd],
          [6.8 * CELL_SIZE, 0xffe01b],
          [8.8 * CELL_SIZE, 0x2a3142],
        ];
        for (const [pz, pcol] of pipeSpecs) {
          sc.addSolid("box", pcol, [worldW * 0.5, 5.95, pz], [worldW - CELL_SIZE * 1.6, 0.56, 0.56]);
          for (let gx = 2; gx < W - 2; gx += 3) {
            sc.addSolid("box", 0x1b202e, [gx * CELL_SIZE, 5.95, pz], [0.22, 0.72, 0.72]);
          }
        }
      }
    } else if (lvl.floorTex === "asphalt") {
      // 【ISSUE #5 · 霓虹高速天台】：四周天台钢护栏 + 中心发光直升机停机坪 H 标识 + 四角无线电信号塔 + 屋顶霓虹广告牌
      for (const [mx, mz] of [
        [0.5 * CELL_SIZE, 0.5 * CELL_SIZE],
        [(W - 0.5) * CELL_SIZE, 0.5 * CELL_SIZE],
        [0.5 * CELL_SIZE, (H - 0.5) * CELL_SIZE],
        [(W - 0.5) * CELL_SIZE, (H - 0.5) * CELL_SIZE],
      ]) {
        this._addCameraObstacleBox(mx - 1.6, mx + 1.6, mz - 1.6, mz + 1.6, 14.0);
      }
      this._addCameraObstacleBox(worldW * 0.5 - 5.2, worldW * 0.5 + 5.2, 0.5 * CELL_SIZE - 0.8, 0.5 * CELL_SIZE + 0.8, 8.6);
      this._addCameraObstacleBox(worldW * 0.5 - 5.2, worldW * 0.5 + 5.2, (H - 0.5) * CELL_SIZE - 0.8, (H - 0.5) * CELL_SIZE + 0.8, 8.6);
      if (sc) {
        const paintMat = new THREE.MeshBasicMaterial({ color: 0xffe01b, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
        const hx = worldW * 0.5;
        const hz = worldH * 0.5;
        // 停机坪 H 标志与外框
        sc.add("paint", paintMat, [hx - 1.8, 0.01, hz], [0.55, 1, 5.2]);
        sc.add("paint", paintMat, [hx + 1.8, 0.01, hz], [0.55, 1, 5.2]);
        sc.add("paint", paintMat, [hx, 0.01, hz], [3.6, 1, 0.55]);
        sc.add("paint", paintMat, [hx, 0.01, hz - 4.4], [9.2, 1, 0.35]);
        sc.add("paint", paintMat, [hx, 0.01, hz + 4.4], [9.2, 1, 0.35]);
        sc.add("paint", paintMat, [hx - 4.4, 0.01, hz], [0.35, 1, 9.2]);
        sc.add("paint", paintMat, [hx + 4.4, 0.01, hz], [0.35, 1, 9.2]);
        // 墙顶霓虹导光护栏与四角高耸无线电信号塔
        sc.addEmissive("box", 0x00e5ff, [worldW * 0.5, 5.25, 0.5 * CELL_SIZE], [worldW - 2, 0.24, 0.24]);
        sc.addEmissive("box", 0xff2ebd, [worldW * 0.5, 5.25, (H - 0.5) * CELL_SIZE], [worldW - 2, 0.24, 0.24]);
        sc.addRadioMast(0.5 * CELL_SIZE, 4.8, 0.5 * CELL_SIZE, 7.5, 0xff2a44);
        sc.addRadioMast((W - 0.5) * CELL_SIZE, 4.8, 0.5 * CELL_SIZE, 8.5, 0x00e5ff);
        sc.addRadioMast(0.5 * CELL_SIZE, 4.8, (H - 0.5) * CELL_SIZE, 7.0, 0xffe01b);
        sc.addRadioMast((W - 0.5) * CELL_SIZE, 4.8, (H - 0.5) * CELL_SIZE, 8.0, 0xff2ebd);
        // 墙顶巨型漫画霓虹灯箱广告架
        sc.addRooftopDetail(2, worldW * 0.5, 4.95, 0.5 * CELL_SIZE, 9.5, 2.2);
        sc.addRooftopDetail(2, worldW * 0.5, 4.95, (H - 0.5) * CELL_SIZE, 9.5, 2.2);
      }
    } else if (lvl.floorTex === "labFloor") {
      // 【ISSUE #9 · 半调博士终极实验室】：高空悬吊褪色射线核心环 + 地面汇聚能量导管 + 四角发光反派培养舱
      const cx = worldW * 0.56;
      const cz = worldH * 0.5;
      this._addCameraObstacleBox(cx - 7.8, cx + 7.8, cz - 7.8, cz + 7.8, 10.4);
      const podSpecs = [
        [1.65 * CELL_SIZE, 1.65 * CELL_SIZE, 0, 0x00ff99],
        [1.65 * CELL_SIZE, (H - 1.65) * CELL_SIZE, Math.PI, 0xff2ebd],
        [(W - 1.65) * CELL_SIZE, 1.65 * CELL_SIZE, 0, 0x00e5ff],
        [(W - 1.65) * CELL_SIZE, (H - 1.65) * CELL_SIZE, Math.PI, 0xffe01b],
      ];
      for (const [px, pz, prot, pcol] of podSpecs) {
        this._addSceneryCollider(px, pz, 0.72, 0.72, 3.8);
        sc?.addLabPod(px, 0, pz, prot, pcol);
      }
      if (sc) {
        // 地面汇聚向 Boss 区域的霓虹能量槽
        sc.addEmissive("box", 0xff2ebd, [worldW * 0.5, 0.03, cz], [worldW - CELL_SIZE * 2.4, 0.05, 0.36]);
        sc.addEmissive("box", 0x00ff99, [cx, 0.03, worldH * 0.5], [0.36, 0.05, worldH - CELL_SIZE * 2.4]);
        // 上空悬吊的巨型八角「全城褪色射线」主反应环（y = 6.2m，抬头震撼！）
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          const rx = cx + Math.cos(ang) * 5.2;
          const rz = cz + Math.sin(ang) * 5.2;
          sc.addSolid("box", 0x2b174a, [rx, 6.2, rz], [4.2, 0.72, 0.78], -ang + Math.PI / 2);
          sc.addEmissive("box", i % 2 === 0 ? 0xff2ebd : 0x00ff99, [rx, 6.2, rz], [3.6, 0.28, 0.88], -ang + Math.PI / 2);
        }
        sc.addEmissive("sphere", 0xff2ebd, [cx, 6.2, cz], [2.4, 2.4, 2.4]);
        sc.addSolid("cylinder", 0x1e1136, [cx, 8.2, cz], [1.2, 3.2, 1.2]);
      }
    }
  }

  // 街区建筑外立面浮雕细节（窗楣、壁柱、九龙城外挑霓虹灯牌与空调箱、老城锻铁阳台）
  _addFacadeRelief(cell, gx, gz, wCells, dCells, height) {
    const finish = { 1: 0xaa735c, 8: 0xc2885e, 11: 0xde9860, 13: 0xe4ceb0, 14: 0x3b4464, 15: 0xe6d2b0 }[cell];
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
        const relief = (y, w, h, depth, lateral = 0, color = finish) => {
          const position = [faceX + dx * lateral + nx * depth * 0.46, y,
            faceZ + dz * lateral + nz * depth * 0.46];
          scenery.addSolid("box", color, position, [dx ? w : depth, h, dz ? w : depth]);
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
        } else if (cell === 14) {
          // 九龙城夜市楼：外挑发光竖向霓虹灯牌 + 银灰空调外机箱
          const neonColors = [0xff2ebd, 0x00e5ff, 0xffe01b, 0xff5a2a];
          const sig = (x * 7 + z * 11 + i) % 3;
          if (sig === 0) {
            const signCol = neonColors[(x + z) % neonColors.length];
            const signH = Math.min(3.4, height - 4.2);
            if (signH > 1.2) {
              const sy = 4.6 + signH * 0.4;
              scenery.addEmissive(
                "box",
                signCol,
                [faceX + dx * 0.85 + nx * 0.62, sy, faceZ + dz * 0.85 + nz * 0.62],
                [dx ? 0.24 : 1.25, signH, dz ? 0.24 : 1.25]
              );
              relief(sy, 0.14, signH * 0.88, 1.36, 0.85, 0x161822);
            }
          } else if (sig === 1) {
            relief(4.15, 0.92, 0.62, 0.52, -0.75, 0x8b98ae);
            relief(4.15, 0.46, 0.42, 0.58, -0.75, 0x1e2230);
          }
        } else if (cell === 8 && i === Math.floor(length / 2) && (x + z) % 2 === 0) {
          // 褐石公寓楼外立面补充经典美漫铁艺消防逃生梯
          const fRot = nz === 1 ? 0 : nz === -1 ? Math.PI : nx === 1 ? Math.PI / 2 : -Math.PI / 2;
          scenery.addFireEscape(faceX, 0.16, faceZ, fRot, height > 11 ? 2 : 1);
        } else if (cell === 15) {
          // 老城拱廊楼：凸出石灰岩壁柱 + 铸铁悬挑小阳台
          relief(4.55, 2.45, 0.16, 0.56, 0, 0xd8c39f);
          relief(5.05, 2.42, 0.72, 0.10, 0, 0x1e222e);
          if (height > 9.5) {
            relief(7.6, 2.15, 0.15, 0.48, 0, 0xd8c39f);
          }
        }
      }
    }
  }

  _addCameraObstacleBox(minX, maxX, minZ, maxZ, maxY) {
    if (!this._cameraObstacleBoxes) this._cameraObstacleBoxes = [];
    this._cameraObstacleBoxes.push({ minX, maxX, minZ, maxZ, maxY });
  }

  _addSceneryCollider(x, z, hw, hd, maxY) {
    if (!this.sceneryColliders) this.sceneryColliders = [];
    this.sceneryColliders.push({ x, z, hw, hd, maxY });
  }

  _addRotatedSceneryCollider(x, z, hw, hd, rotY, maxY) {
    const c = Math.abs(Math.cos(rotY));
    const s = Math.abs(Math.sin(rotY));
    this._addSceneryCollider(x, z, hw * c + hd * s, hw * s + hd * c, maxY);
  }

  _hasWallClearance(wx, wz, padRadius = 0.8) {
    const gx = Math.floor(wx / CELL_SIZE);
    const gz = Math.floor(wz / CELL_SIZE);
    const rSq = padRadius * padRadius;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx;
        const nz = gz + dz;
        const c = nx < 0 || nz < 0 || nx >= this.mapW || nz >= this.mapH ? 1 : this.map[nz][nx];
        if (c > 0 && !this._isLowCoverCell(c)) {
          const minX = nx * CELL_SIZE;
          const maxX = minX + CELL_SIZE;
          const minZ = nz * CELL_SIZE;
          const maxZ = minZ + CELL_SIZE;
          const cx = Math.max(minX, Math.min(wx, maxX));
          const cz = Math.max(minZ, Math.min(wz, maxZ));
          const ddx = wx - cx;
          const ddz = wz - cz;
          if (ddx * ddx + ddz * ddz < rSq) return false;
        }
      }
    }
    return true;
  }

  _buildMenuOrbitProfile() {
    const worldW = this.mapW * CELL_SIZE;
    const worldH = this.mapH * CELL_SIZE;
    const cx = worldW * 0.5;
    const cz = worldH * 0.5;
    const rx = Math.max(8, worldW * 0.28);
    const rz = Math.max(8, worldH * 0.28);
    const isStreet = Boolean(this.level?.streetTheme);
    const lookY = isStreet ? 3.2 : 1.8;
    const baseFloor = isStreet ? 14.5 : 10.6;
    const samples = 144;
    const camPad = 2.8;
    const boxes = this._cameraObstacleBoxes || [];
    const raw = new Float64Array(samples);

    for (let i = 0; i < samples; i++) {
      const ang = (i / samples) * Math.PI * 2;
      const x = cx + Math.cos(ang) * rx;
      const z = cz + Math.sin(ang) * rz;
      const dist = Math.hypot(cx - x, cz - z);
      let req = baseFloor;

      for (let bIdx = 0; bIdx < boxes.length; bIdx++) {
        const b = boxes[bIdx];
        if (x >= b.minX - camPad && x <= b.maxX + camPad && z >= b.minZ - camPad && z <= b.maxZ + camPad) {
          if (b.maxY + 2.8 > req) req = b.maxY + 2.8;
        }
        // Check near-camera sight ray so nearby towers/spires never clip the frustum
        for (const d of [1.6, 3.2, 4.8]) {
          const t = d / (dist || 1);
          if (t > 0.32) continue;
          const sx = x + (cx - x) * t;
          const sz = z + (cz - z) * t;
          if (sx >= b.minX - 1.2 && sx <= b.maxX + 1.2 && sz >= b.minZ - 1.2 && sz <= b.maxZ + 1.2) {
            const neededY = (b.maxY + 1.8 - lookY * t) / (1 - t);
            req = Math.max(req, Math.min(b.maxY + 5.5, neededY));
          }
        }
      }
      raw[i] = req;
    }

    const plateau = 1;
    const shoulderRadius = 22;
    const rampSpan = shoulderRadius - plateau + 1;
    const envelope = new Float64Array(samples);
    envelope.fill(baseFloor);
    for (let i = 0; i < samples; i++) {
      const h = raw[i];
      for (let d = -shoulderRadius; d <= shoulderRadius; d++) {
        const j = (i + d + samples) % samples;
        const ad = Math.abs(d);
        const w = ad <= plateau ? 1 : 0.5 * (1 + Math.cos((Math.PI * (ad - plateau)) / rampSpan));
        const candidate = baseFloor + (h - baseFloor) * w;
        if (candidate > envelope[j]) envelope[j] = candidate;
      }
    }

    let heights = envelope;
    for (let pass = 0; pass < 2; pass++) {
      const next = new Float64Array(samples);
      for (let i = 0; i < samples; i++) {
        const avg = (
          heights[(i - 2 + samples) % samples] +
          heights[(i - 1 + samples) % samples] +
          heights[i] +
          heights[(i + 1) % samples] +
          heights[(i + 2) % samples]
        ) / 5;
        // Preserve peak plateau clearance so smoothing never drops below raw obstacle heights
        const safeFloor = Math.max(
          raw[(i - 1 + samples) % samples],
          raw[i],
          raw[(i + 1) % samples]
        );
        next[i] = Math.max(avg, safeFloor);
      }
      heights = next;
    }

    this._menuOrbitProfile = { cx, cz, rx, rz, lookY, samples, heights };
    return this._menuOrbitProfile;
  }

  computeMenuOrbitCamera(angle, outPos, outTarget) {
    const profile = this._menuOrbitProfile || this._buildMenuOrbitProfile();
    const { cx, cz, rx, rz, lookY, samples, heights } = profile;
    const tau = Math.PI * 2;
    const a = ((angle % tau) + tau) % tau;
    const fIdx = (a / tau) * samples;
    const i0 = Math.floor(fIdx) % samples;
    const i1 = (i0 + 1) % samples;
    const frac = fIdx - Math.floor(fIdx);
    let y = heights[i0] * (1 - frac) + heights[i1] * frac;
    y += 0.45 * (1 + Math.sin(angle * 2.0));

    const x = cx + Math.cos(angle) * rx;
    const z = cz + Math.sin(angle) * rz;
    const boxes = this._cameraObstacleBoxes || [];
    for (let bIdx = 0; bIdx < boxes.length; bIdx++) {
      const b = boxes[bIdx];
      if (x >= b.minX - 2.2 && x <= b.maxX + 2.2 && z >= b.minZ - 2.2 && z <= b.maxZ + 2.2) {
        if (b.maxY + 2.4 > y) y = b.maxY + 2.4;
      }
    }

    outPos.set(x, y, z);
    if (outTarget) outTarget.set(cx, lookY, cz);
  }

  // 非规则精细街景家具布置：路口红绿灯、面向车道的路灯与消防栓、报刊亭/夜市摊、候车亭、露天咖啡伞、垃圾箱、邮筒、贩卖机、行道树
  _buildStreetBlockFurniture(lvl) {
    const H = this.mapH;
    const W = this.mapW;
    const roadGrid = this.roadGrid;
    const swGrid = this.sidewalkGrid;
    const style = lvl.districtStyle || "default";

    // 收集不可遮挡的关键点位（玩家出生点、PvP四角出生点、敌人、道具、移动平台、老城中央喷泉），确保装饰物绝不碍路或穿模
    const reserved = [];
    if (lvl.playerStart) reserved.push([lvl.playerStart.x * CELL_SIZE, lvl.playerStart.z * CELL_SIZE, 3.6]);
    for (const [sx, sz] of [[2.5, 2.5], [W - 2.5, H - 2.5], [W - 2.5, 2.5], [2.5, H - 2.5]]) {
      reserved.push([sx * CELL_SIZE, sz * CELL_SIZE, 2.6]);
    }
    if (W >= 22) {
      reserved.push([W * 0.5 * CELL_SIZE, 2.5 * CELL_SIZE, 2.6], [W * 0.5 * CELL_SIZE, (H - 2.5) * CELL_SIZE, 2.6]);
    }
    for (const e of lvl.enemies || []) reserved.push([e.x * CELL_SIZE, e.z * CELL_SIZE, 2.6]);
    for (const p of lvl.props || []) reserved.push([p.x * CELL_SIZE, p.z * CELL_SIZE, 2.6]);
    for (const m of lvl.movers || []) {
      const r = (m.range || 2) * CELL_SIZE + 2.5;
      reserved.push([m.x * CELL_SIZE, m.z * CELL_SIZE, Math.min(r, 5.2)]);
    }
    if (style === "oldquarter") {
      reserved.push([21.5 * CELL_SIZE, 13.5 * CELL_SIZE, 5.2]); // 中央喷泉池
    }

    const isClear = (wx, wz, pad = 0) => {
      for (let i = 0; i < reserved.length; i++) {
        const [rx, rz, rr] = reserved[i];
        const dx = wx - rx;
        const dz = wz - rz;
        if (dx * dx + dz * dz < (rr + pad) * (rr + pad)) return false;
      }
      return true;
    };

    const isBuilding = (gx, gz) => {
      const c = this.map[gz]?.[gx] || 0;
      return c > 0 && !this._isLowCoverCell(c);
    };

    const placed = [];
    const canPlaceProp = (wx, wz, minSpacing = 3.2) => {
      if (!isClear(wx, wz, 0.3)) return false;
      for (let i = 0; i < placed.length; i++) {
        const dx = wx - placed[i][0];
        const dz = wz - placed[i][1];
        if (dx * dx + dz * dz < minSpacing * minSpacing) return false;
      }
      placed.push([wx, wz]);
      return true;
    };

    // 1. 十字/丁字路口自动安放悬臂交通红绿灯
    if (roadGrid) {
      const isCenterNode = (vx, vz) =>
        vx >= 1 && vz >= 1 && vx < W && vz < H &&
        roadGrid[vz - 1][vx - 1] === 1 &&
        roadGrid[vz - 1][vx] === 1 &&
        roadGrid[vz][vx - 1] === 1 &&
        roadGrid[vz][vx] === 1;

      for (let vz = 2; vz < H - 2; vz++) {
        for (let vx = 2; vx < W - 2; vx++) {
          if (!isCenterNode(vx, vz)) continue;
          let deg = 0;
          if (isCenterNode(vx + 1, vz)) deg++;
          if (isCenterNode(vx - 1, vz)) deg++;
          if (isCenterNode(vx, vz + 1)) deg++;
          if (isCenterNode(vx, vz - 1)) deg++;
          if (deg < 3) continue;

          // 在路口对角人行道转角处放置红绿灯（面向路口中心）
          const corners = [
            { gx: vx - 2, gz: vz - 2, rotY: -Math.PI * 0.25 },
            { gx: vx + 1, gz: vz + 1, rotY: Math.PI * 0.75 },
          ];
          for (const c of corners) {
            if (!swGrid?.[c.gz]?.[c.gx] || this.map[c.gz]?.[c.gx] !== 0) continue;
            const wx = (c.gx + 0.5) * CELL_SIZE;
            const wz = (c.gz + 0.5) * CELL_SIZE;
            if (this._hasWallClearance(wx, wz, 0.80) && canPlaceProp(wx, wz, 5.5)) {
              this.streetScenery?.addTrafficLight(wx, 0.16, wz, c.rotY);
              this._addSceneryCollider(wx, wz, 0.24, 0.24, 0.16 + 4.2);
            }
          }
        }
      }
    }

    const clutterMeta = [
      { hw: 0.68, hd: 0.46, h: 1.30, off: 1.08, pad: 0.70, lat: 0.65, endPad: 0.28 }, // 0 垃圾箱
      { hw: 0.55, hd: 0.30, h: 1.30, off: 1.15, pad: 0.55, lat: 0.50, endPad: 0.22 }, // 1 邮筒+报箱
      { hw: 0.58, hd: 0.40, h: 2.15, off: 1.18, pad: 0.62, lat: 0.45, endPad: 0.25 }, // 2 贩卖机
      { hw: 0.80, hd: 0.28, h: 1.05, off: 0.88, pad: 0.65, lat: 1.15, endPad: 0.32 }, // 3 路障+锥桶
      { hw: 0.54, hd: 0.54, h: 2.55, off: 1.12, pad: 0.72, lat: 0.45, endPad: 0.30 }, // 4 电话亭
      { hw: 0.66, hd: 0.44, h: 1.25, off: 1.10, pad: 0.65, lat: 0.65, endPad: 0.25 }, // 5 货箱陶罐
    ];

    // 2. 遍历所有人行道格子，用确定性空间哈希生成「非规则、贴墙/贴路沿、分区风格鲜明」的精细街景与碰撞体
    for (let z = 1; z < H - 1; z++) {
      for (let x = 1; x < W - 1; x++) {
        if (this.map[z][x] !== 0 || !swGrid?.[z]?.[x]) continue;

        const hash = Math.abs((x * 73856093) ^ (z * 19349663) ^ ((x + z) * 83492791));
        const cx = (x + 0.5) * CELL_SIZE;
        const cz = (z + 0.5) * CELL_SIZE;

        // 检测紧邻马路方向（用于放置面向车道的路灯与消防栓）
        const roadDir =
          roadGrid?.[z]?.[x + 1] ? { nx: 1, nz: 0, rotY: 0 } :
          roadGrid?.[z]?.[x - 1] ? { nx: -1, nz: 0, rotY: Math.PI } :
          roadGrid?.[z + 1]?.[x] ? { nx: 0, nz: 1, rotY: -Math.PI / 2 } :
          roadGrid?.[z - 1]?.[x] ? { nx: 0, nz: -1, rotY: Math.PI / 2 } : null;

        // 检测紧邻建筑墙面方向（用于贴墙安放报刊亭、候车亭、贩卖机、垃圾箱、邮筒、电话亭）
        const wallDir =
          isBuilding(x, z - 1) ? { bx: 0, bz: -1, faceRot: 0 } :
          isBuilding(x, z + 1) ? { bx: 0, bz: 1, faceRot: Math.PI } :
          isBuilding(x - 1, z) ? { bx: -1, bz: 0, faceRot: Math.PI / 2 } :
          isBuilding(x + 1, z) ? { bx: 1, bz: 0, faceRot: -Math.PI / 2 } : null;

        // 2a. 靠马路路沿：路灯 & 消防栓（按非均匀哈希错落排布）
        if (roadDir && hash % 7 === 0) {
          const isLamp = (hash >> 3) % 3 !== 0;
          const jitter = (((hash >> 5) % 5) - 2) * 0.25;
          const lx = cx + roadDir.nx * 1.48 + (roadDir.nz ? jitter : 0);
          const lz = cz + roadDir.nz * 1.48 + (roadDir.nx ? jitter : 0);
          if (this._hasWallClearance(lx, lz, 0.60) && canPlaceProp(lx, lz, isLamp ? 6.2 : 5.0)) {
            this.streetScenery?.addStreetFixture(isLamp, lx, 0.16, lz, roadDir.rotY);
            this._addSceneryCollider(lx, lz, isLamp ? 0.22 : 0.24, isLamp ? 0.22 : 0.24, 0.16 + (isLamp ? 4.2 : 1.05));
            continue;
          }
        }

        // 2b. 贴建筑外墙：按各物件实际包络计算安全离墙距并验证L型墙角净距
        if (wallDir && (hash % 5 === 1 || ((style === "nightmarket" || style === "oldquarter") && hash % 5 === 2))) {
          const yawJitter = ((((hash >> 4) % 7) - 3) / 3) * 0.08;
          const rot = wallDir.faceRot + yawJitter;
          const pick = (hash >> 7) % 12;

          const tryPlaceAlongWall = (off, pad, spacing, rotAngle = rot, lat = 0, endPad = 0.28) => {
            const px = cx + wallDir.bx * off;
            const pz = cz + wallDir.bz * off;
            if (!this._hasWallClearance(px, pz, pad)) return null;
            if (lat > 0) {
              const tx = Math.cos(rotAngle);
              const tz = -Math.sin(rotAngle);
              if (!this._hasWallClearance(px + tx * lat, pz + tz * lat, endPad) ||
                  !this._hasWallClearance(px - tx * lat, pz - tz * lat, endPad)) {
                return null;
              }
            }
            return canPlaceProp(px, pz, spacing) ? { px, pz } : null;
          };

          const placeClutter = (variant, spacing, rotAngle = rot) => {
            const meta = clutterMeta[variant];
            const pos = tryPlaceAlongWall(meta.off, meta.pad, spacing, rotAngle, meta.lat, meta.endPad);
            if (!pos) return;
            this.streetScenery?.addStreetClutter(variant, pos.px, 0.16, pos.pz, rotAngle);
            this._addRotatedSceneryCollider(pos.px, pos.pz, meta.hw, meta.hd, rotAngle, 0.16 + meta.h);
          };

          const placeNewsstand = (spacing, accent) => {
            const pos = tryPlaceAlongWall(1.02, 0.82, spacing, rot, 1.12, 0.30);
            if (!pos) return;
            this.streetScenery?.addNewsstand(pos.px, 0.16, pos.pz, rot, accent);
            this._addRotatedSceneryCollider(pos.px, pos.pz, 1.12, 0.56, rot, 0.16 + 2.65);
          };

          const placeBusShelter = (spacing, accent) => {
            const pos = tryPlaceAlongWall(1.02, 0.82, spacing, rot, 1.25, 0.30);
            if (!pos) return;
            this.streetScenery?.addBusShelter(pos.px, 0.16, pos.pz, rot, accent);
            this._addRotatedSceneryCollider(pos.px, pos.pz, 1.28, 0.58, rot, 0.16 + 2.75);
          };

          if (style === "nightmarket") {
            if (pick < 3) {
              placeNewsstand(5.2, pick === 0 ? 0xff2ebd : pick === 1 ? 0x00c8e8 : 0xff7a00);
            } else if (pick < 6) {
              placeClutter(2, 4.2); // 霓虹自动贩卖机
            } else if (pick < 8) {
              placeClutter(0, 4.2); // 巷口垃圾箱
            } else if (pick < 10) {
              placeClutter(5, 4.4); // 夜市货箱堆
            } else {
              placeClutter(3, 5.5, wallDir.faceRot); // 路障锥桶
            }
          } else if (style === "oldquarter") {
            if (pick < 3) {
              const pos = tryPlaceAlongWall(0.50, 1.26, 5.0, rot);
              if (pos) {
                const umb = pick === 0 ? 0xd93829 : pick === 1 ? 0x1b8ca6 : 0xe89923;
                this.streetScenery?.addCafeTable(pos.px, 0.16, pos.pz, rot, umb);
                this._addSceneryCollider(pos.px, pos.pz, 0.62, 0.62, 0.16 + 1.15);
              }
            } else if (pick < 5) {
              placeNewsstand(5.6, pick === 3 ? 0xc44e32 : 0x227c6c);
            } else if (pick === 5) {
              placeBusShelter(6.4, 0xffcf33);
            } else if (pick < 8) {
              placeClutter(pick === 6 ? 4 : 1, 4.6); // 电话亭/邮筒
            } else if (pick < 10) {
              placeClutter(5, 4.6); // 巴扎货箱陶罐
            } else {
              const pos = tryPlaceAlongWall(0.35, 1.42, 5.8, rot);
              if (pos) {
                const scale = 0.85 + (hash % 3) * 0.08;
                this.streetScenery?.addTree(pos.px, 0.16, pos.pz, scale, pick === 10 ? 0x2ea859 : 0x4ca64c, true);
                this._addSceneryCollider(pos.px, pos.pz, 0.48, 0.48, 0.16 + 3.2);
              }
            }
          } else {
            // 唐人街 / 海港 / 大都会同样升级丰富微细节
            if (pick < 2) {
              placeBusShelter(6.2, style === "chinatown" ? 0xffae19 : 0x00e5ff);
            } else if (pick < 4) {
              placeNewsstand(5.6, style === "chinatown" ? 0xd92027 : 0xff2a44);
            } else if (pick < 9) {
              placeClutter(pick % 5, 4.8);
            }
          }
        } else if (style === "oldquarter" && !wallDir && hash % 13 === 0) {
          // 老城宽阔广场人行道点缀错落的行道树与遮阳咖啡伞
          if (this._hasWallClearance(cx, cz, 1.44) && canPlaceProp(cx, cz, 6.5)) {
            if ((hash >> 3) % 2 === 0) {
              this.streetScenery?.addTree(cx, 0.16, cz, 0.96 + (hash % 3) * 0.06, 0x359e58, true);
              this._addSceneryCollider(cx, cz, 0.48, 0.48, 0.16 + 3.2);
            } else {
              this.streetScenery?.addCafeTable(cx, 0.16, cz, (hash % 6) * 0.5, 0xd9482e);
              this._addSceneryCollider(cx, cz, 0.62, 0.62, 0.16 + 1.15);
            }
          }
        }
      }
    }
  }

  // 确保实体永远生成在空地且远离静态碰撞体，防止卡进建筑或街景物件
  _safeWorldPos(gridX, gridZ, padRadius = 0.68) {
    const isFree = (wx, wz) => {
      const mx = Math.floor(wx / CELL_SIZE);
      const mz = Math.floor(wz / CELL_SIZE);
      return mz >= 0 && mz < this.mapH && mx >= 0 && mx < this.mapW &&
        this.map[mz][mx] === 0 && !this._isStaticBlocked(wx, wz, 0, padRadius);
    };
    const reqX = gridX * CELL_SIZE;
    const reqZ = gridZ * CELL_SIZE;
    if (isFree(reqX, reqZ)) return { x: reqX, z: reqZ };
    const gx = Math.floor(gridX);
    const gz = Math.floor(gridZ);
    for (let r = 0; r <= 4; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = gx + dx;
          const nz = gz + dz;
          const cx = (nx + 0.5) * CELL_SIZE;
          const cz = (nz + 0.5) * CELL_SIZE;
          if (isFree(cx, cz)) return { x: cx, z: cz };
        }
      }
    }
    return { x: reqX, z: reqZ };
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

  _isDynamicPickup(type) {
    return type === "medkit" || type === "ammo";
  }

  _collectOpenPickupCells() {
    const cells = [];
    for (let z = 1; z < this.mapH - 1; z++) {
      for (let x = 1; x < this.mapW - 1; x++) {
        if (this.map[z]?.[x] === 0) cells.push([x, z]);
      }
    }
    return cells;
  }

  _pickDynamicPickupSpot(players = [this.player], deterministicIdx = null) {
    const cells = this._openPickupCells || this._collectOpenPickupCells();
    const candidates = [];
    const startX = (this.level?.playerStart?.x ?? 2.5) * CELL_SIZE;
    const startZ = (this.level?.playerStart?.z ?? 2.5) * CELL_SIZE;

    for (let i = 0; i < cells.length; i++) {
      const [cx, cz] = cells[i];
      const wx = (cx + 0.5) * CELL_SIZE;
      const wz = (cz + 0.5) * CELL_SIZE;
      if (this._isStaticBlocked(wx, wz, 0, 0.75)) continue;

      let blocked = false;
      for (let j = 0; j < this.props.length; j++) {
        const pr = this.props[j];
        if (!pr.active) continue;
        const dx = pr.x - wx;
        const dz = pr.z - wz;
        if (dx * dx + dz * dz < (CELL_SIZE * 1.15) ** 2) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      if (deterministicIdx !== null) {
        if ((wx - startX) ** 2 + (wz - startZ) ** 2 < (CELL_SIZE * 1.5) ** 2) continue;
      } else {
        let nearPlayer = false;
        for (let j = 0; j < players.length; j++) {
          const pl = players[j];
          if (!pl || pl.hp <= 0) continue;
          const dx = pl.pos.x - wx;
          const dz = pl.pos.z - wz;
          if (dx * dx + dz * dz < (CELL_SIZE * 1.5) ** 2) {
            nearPlayer = true;
            break;
          }
        }
        if (nearPlayer) continue;
      }

      candidates.push({ x: wx, z: wz });
    }
    if (!candidates.length) return null;
    if (deterministicIdx !== null) {
      return candidates[(deterministicIdx * 17 + 7) % candidates.length];
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  _setPropPosition(prop, wx, wz) {
    prop.x = wx;
    prop.z = wz;
    const gx = Math.floor(wx / CELL_SIZE);
    const gz = Math.floor(wz / CELL_SIZE);
    prop.baseElev = this.sidewalkGrid?.[gz]?.[gx] ? 0.16 : 0;
    const baseY = prop.type === "barrel" ? 0.725 : prop.type === "medkit" ? 0.55 : prop.type === "ammo" ? 0.52 : 0.11;
    if (prop.mesh) prop.mesh.position.set(wx, prop.baseElev + baseY, wz);
  }

  _deactivateDynamicPickup(prop) {
    prop.active = false;
    prop.life = 0;
    prop.blinkPhase = 0;
    prop.respawnTimer = PICKUP_RESPAWN_MIN + Math.random() * (PICKUP_RESPAWN_MAX - PICKUP_RESPAWN_MIN);
    if (prop.mesh) {
      prop.mesh.visible = true;
      this.levelRoot.remove(prop.mesh);
    }
  }

  _updateDynamicPickups(dt, players = [this.player]) {
    for (const pr of this.props) {
      if (!this._isDynamicPickup(pr.type)) continue;
      if (pr.active) {
        pr.life -= dt;
        if (pr.life <= 0) {
          this._deactivateDynamicPickup(pr);
        }
      } else {
        if (pr.respawnTimer <= 0) {
          pr.respawnTimer = PICKUP_RESPAWN_MIN + Math.random() * (PICKUP_RESPAWN_MAX - PICKUP_RESPAWN_MIN);
        }
        pr.respawnTimer -= dt;
        if (pr.respawnTimer <= 0) {
          const spot = this._pickDynamicPickupSpot(players);
          if (spot) {
            this._setPropPosition(pr, spot.x, spot.z);
            pr.active = true;
            pr.life = PICKUP_LIFETIME;
            pr.respawnTimer = 0;
            pr.blinkPhase = 0;
            if (pr.mesh) {
              pr.mesh.visible = true;
              this.levelRoot.add(pr.mesh);
            }
            this._spawnParticles(
              new THREE.Vector3(spot.x, (pr.baseElev || 0) + 0.6, spot.z),
              pr.type === "medkit" ? 0x38e54d : 0xffe01b,
              5
            );
          } else {
            pr.respawnTimer = 1.5;
          }
        }
      }
    }
  }

  _spawnProp(spec, id) {
    const pos = this._safeWorldPos(spec.x, spec.z);
    const wx = pos.x;
    const wz = pos.z;
    const baseElev = this.sidewalkGrid?.[Math.floor(wz / CELL_SIZE)]?.[Math.floor(wx / CELL_SIZE)] ? 0.16 : 0;
    const prop = {
      id,
      type: spec.type,
      active: true,
      x: wx,
      z: wz,
      baseElev,
      mesh: null,
      life: this._isDynamicPickup(spec.type) ? PICKUP_LIFETIME : -1,
      respawnTimer: 0,
      blinkPhase: 0,
    };

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
    const isCellBlocked = (x, z) => {
      const mx = Math.floor(x / CELL_SIZE);
      const mz = Math.floor(z / CELL_SIZE);
      if (mx < 0 || mz < 0 || mx >= this.mapW || mz >= this.mapH) return true;
      const c = this.map[mz][mx];
      if (c === 0) return false;
      if (this._isLowCoverCell(c)) {
        const coverTop = 1.65 + (this.sidewalkGrid?.[mz]?.[mx] ? 0.16 : 0);
        return playerY < coverTop - 0.18;
      }
      return true;
    };
    if (radius <= 0) {
      if (isCellBlocked(wx, wz)) return true;
    } else if (
      isCellBlocked(wx - radius, wz - radius) ||
      isCellBlocked(wx + radius, wz - radius) ||
      isCellBlocked(wx - radius, wz + radius) ||
      isCellBlocked(wx + radius, wz + radius)
    ) {
      return true;
    }
    const cols = this.sceneryColliders;
    if (cols) {
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        if (playerY < col.maxY - 0.12 && Math.abs(wx - col.x) < col.hw + radius && Math.abs(wz - col.z) < col.hd + radius) {
          return true;
        }
      }
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
    const cols = this.sceneryColliders;
    if (cols) {
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        if (col.maxY <= 3.0 && Math.abs(wx - col.x) < col.hw + 0.35 && Math.abs(wz - col.z) < col.hd + 0.35) {
          if (col.maxY > h) h = col.maxY;
        }
      }
    }
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
      if (this._isLowCoverCell(c)) {
        const coverTop = 1.65 + (this.sidewalkGrid?.[Math.floor(z / CELL_SIZE)]?.[Math.floor(x / CELL_SIZE)] ? 0.16 : 0);
        if (y < coverTop) return false;
      }
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
        return (this.renderer || distance <= 130) && (enemy?.alive ?? prop?.active ?? (!player || player.hp > 0));
      });

      let endPoint = this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, 130);

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
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(this._tracerGeo, mat);
    mesh.position.copy(start).addScaledVector(dir, 0.5);
    mesh.scale.set(radius, radius, len);
    mesh.lookAt(end);
    this.levelRoot.add(mesh);
    this.tracers.push({ mesh, age: 0, life: 0.085 });
  }

  _spawnParticles(pos, color, count = 8) {
    if (!this.renderer) return;
    const mat = this._getFxMaterial(color);
    for (let i = 0; i < count; i++) {
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
      this._shockwaveGeo,
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
    this._updateDynamicPickups(dt, [this.player]);
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

    // 软推离存活敌人躯干，防止第一人称视角穿入敌人空心模型内部
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive || Math.abs(p.pos.y - e.root.position.y) > 1.85) continue;
      const dx = p.pos.x - e.root.position.x;
      const dz = p.pos.z - e.root.position.z;
      const minDist = 0.92 * Math.max(1, e.scale * 0.72);
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq);
        const nx = dist > 1e-4 ? dx / dist : 1;
        const nz = dist > 1e-4 ? dz / dist : 0;
        const push = (minDist - dist) * Math.min(1, dt * 18 + 0.35);
        const pushX = p.pos.x + nx * push;
        const pushZ = p.pos.z + nz * push;
        if (!this._isBlocked(pushX, p.pos.z, p.pos.y, radius)) p.pos.x = pushX;
        if (!this._isBlocked(p.pos.x, pushZ, p.pos.y, radius)) p.pos.z = pushZ;
      }
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

  _updateProps(dt, applyEffects = true, animateBlink = true) {
    const p = this.player;
    const t = performance.now() * 0.003;
    for (const pr of this.props) {
      if (!pr.active) continue;
      if (this._isDynamicPickup(pr.type)) {
        pr.mesh.rotation.y += dt * 2.2;
        pr.mesh.position.y = (pr.baseElev || 0) + 0.55 + Math.sin(t + pr.id) * 0.12;
        if (animateBlink && pr.life >= 0 && pr.life <= PICKUP_WARN_WINDOW) {
          const u = 1 - Math.max(0, pr.life) / PICKUP_WARN_WINDOW;
          const freq = 2.2 + 12.5 * u * u; // 从 2.2Hz 随剩余时间减少平滑加速至 14.7Hz
          pr.blinkPhase = (pr.blinkPhase || 0) + dt * freq * Math.PI * 2;
          pr.mesh.visible = Math.sin(pr.blinkPhase) >= -0.15;
        } else {
          pr.mesh.visible = true;
          pr.blinkPhase = 0;
        }
        if (!applyEffects) continue;
        const dist = Math.hypot(pr.x - p.pos.x, pr.z - p.pos.z);
        if (dist < 1.65 && Math.abs(p.pos.y - (pr.baseElev || 0)) < 1.5) {
          if (pr.type === "medkit" && p.hp < p.maxHp) {
            this._deactivateDynamicPickup(pr);
            const prevHp = p.hp;
            p.hp = Math.min(p.maxHp, p.hp + 35);
            const gained = Math.max(1, Math.round(p.hp - prevHp));
            this.audio.playPickup();
            this.callbacks.onPickup?.(p, { kind: "medkit", amount: gained });
            this.spawnPopup(new THREE.Vector3(pr.x, 1.4, pr.z), `+${gained} HP!`, "#38e54d", 1.15);
          } else if (pr.type === "ammo") {
            this._deactivateDynamicPickup(pr);
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

    // 存活敌人之间保持柔和水平间距，避免模型重叠穿模
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (!b.alive) continue;
        const dx = a.root.position.x - b.root.position.x;
        const dz = a.root.position.z - b.root.position.z;
        const minDist = 1.15 * Math.max(a.scale, b.scale);
        const distSq = dx * dx + dz * dz;
        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const nx = dist > 1e-4 ? dx / dist : 1;
          const nz = dist > 1e-4 ? dz / dist : 0;
          const halfPush = (minDist - dist) * 0.5 * Math.min(1, dt * 12);
          const ax = a.root.position.x + nx * halfPush;
          const az = a.root.position.z + nz * halfPush;
          const bx = b.root.position.x - nx * halfPush;
          const bz = b.root.position.z - nz * halfPush;
          if (!this._isBlocked(ax, a.root.position.z, 0, 0.65)) a.root.position.x = ax;
          if (!this._isBlocked(a.root.position.x, az, 0, 0.65)) a.root.position.z = az;
          if (!this._isBlocked(bx, b.root.position.z, 0, 0.65)) b.root.position.x = bx;
          if (!this._isBlocked(b.root.position.x, bz, 0, 0.65)) b.root.position.z = bz;
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
    const mesh = new THREE.Mesh(this._projGeo, this._getFxMaterial(color));
    mesh.scale.setScalar(type === "boss" ? 0.28 : 0.18);
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
    const g = mesh.geometry;
    if (g && g !== this.particleGeometry && g !== this._tracerGeo && g !== this._projGeo && g !== this._shockwaveGeo) {
      g.dispose();
    }
    const m = mesh.material;
    if (m && !m.userData?.cachedFx) {
      m.dispose();
    }
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
    const showWeapons = Boolean(this.weapons?.root?.visible || this.weapons?.punchFist?.visible);
    if (this.weaponScene && showWeapons) {
      let projDirty = false;
      if (this.weaponCamera.fov !== this.camera.fov) {
        this.weaponCamera.fov = this.camera.fov;
        projDirty = true;
      }
      if (this.weaponCamera.aspect !== this.camera.aspect) {
        this.weaponCamera.aspect = this.camera.aspect;
        projDirty = true;
      }
      if (projDirty) this.weaponCamera.updateProjectionMatrix();
      const prevAutoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.weaponScene, this.weaponCamera);
      this.renderer.autoClear = prevAutoClear;
    }
    this._render2DOverlay();
  }

  _projectToScreen(worldPos) {
    const v = this._tmpProjVec.copy(worldPos).project(this.camera);
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
      if (pr.mesh && !pr.mesh.visible) continue;
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
