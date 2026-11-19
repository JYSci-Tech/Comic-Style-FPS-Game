import * as THREE from "three";

// 真 3D 赛璐璐 + 黑墨描边第一人称武器系统（支持右键机瞄 ADS & 近战重拳）
export class WeaponSystem3D {
  constructor(camera, assets, audio) {
    this.camera = camera;
    this.assets = assets;
    this.audio = audio;

    this.weapons = [
      {
        id: "magnum",
        name: "THE EQUALIZER",
        magSize: 6,
        ammo: 6,
        reserve: Infinity,
        maxReserve: Infinity,
        damage: 45,
        headshotMult: 2.2,
        pellets: 1,
        spread: 0.008,
        adsSpread: 0.001,
        fireRate: 0.34,
        reloadTime: 1.0,
        auto: false,
        recoilKick: 1.0,
        soundWord: "BLAM!",
        tracerColor: 0xffe01b,
        hipPos: new THREE.Vector3(0.28, -0.24, -0.48),
        adsPos: new THREE.Vector3(0.0, -0.155, -0.38),
        adsFov: 52,
      },
      {
        id: "shotgun",
        name: "THE BOOMSTICK",
        magSize: 6,
        ammo: 6,
        reserve: 24,
        maxReserve: 36,
        damage: 20,
        headshotMult: 1.6,
        pellets: 8,
        spread: 0.085,
        adsSpread: 0.055,
        fireRate: 0.66,
        reloadTime: 1.25,
        auto: false,
        recoilKick: 1.65,
        soundWord: "KRAK-BOOM!",
        tracerColor: 0xff7a00,
        hipPos: new THREE.Vector3(0.3, -0.27, -0.52),
        adsPos: new THREE.Vector3(0.0, -0.18, -0.44),
        adsFov: 60,
      },
      {
        id: "raygun",
        name: "ZAP-O-MATIC",
        magSize: 24,
        ammo: 24,
        reserve: 72,
        maxReserve: 96,
        damage: 22,
        headshotMult: 1.8,
        pellets: 1,
        spread: 0.022,
        adsSpread: 0.008,
        fireRate: 0.11,
        reloadTime: 1.05,
        auto: true,
        recoilKick: 0.52,
        soundWord: "ZAP!",
        tracerColor: 0x00f0ff,
        hipPos: new THREE.Vector3(0.28, -0.25, -0.48),
        adsPos: new THREE.Vector3(0.0, -0.165, -0.4),
        adsFov: 56,
      },
    ];

    if (camera) {
      this.root = new THREE.Group();
      this.camera.add(this.root);
      this.models = [this._buildMagnum(), this._buildShotgun(), this._buildRaygun()];
      this.models.forEach((m) => this.root.add(m.group));
      this.punchFist = this._buildPunchFist();
      this.camera.add(this.punchFist);
      this.punchFist.visible = false;
    }

    this.currentIdx = 0;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.recoil = 0;
    this.muzzleFlash = 0;
    this.swayTime = 0;
    this.switchAnim = 0;
    this.autoReloadTimer = 0;
    this.adsAmount = 0;
    this.isAds = false;
    this.punchTimer = 0;

    this._syncVisibility();
  }

  get current() {
    return this.weapons[this.currentIdx];
  }

  get currentModel() {
    return this.models[this.currentIdx];
  }

  _part(geo, color, emissive = 0x000000, outlineScale = 1.06) {
    const mat = this.assets.toonMat({ color, emissive });
    const mesh = new THREE.Mesh(geo, mat);
    this.assets.addOutline(mesh, outlineScale);
    return mesh;
  }

  _makeMuzzleStar(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const coneGeo = new THREE.ConeGeometry(0.055, 0.22, 4);
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(coneGeo, mat);
      const ang = (i / 6) * Math.PI * 2;
      spike.rotation.z = ang;
      spike.position.set(Math.cos(ang + Math.PI / 2) * 0.06, Math.sin(ang + Math.PI / 2) * 0.06, 0);
      g.add(spike);
    }
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), coreMat);
    g.add(core);
    g.visible = false;
    return g;
  }

  _buildMagnum() {
    const group = new THREE.Group();

    // 枪管
    const barrel = this._part(new THREE.BoxGeometry(0.075, 0.085, 0.36), 0xd8e2e8);
    barrel.position.set(0, 0.05, -0.18);
    group.add(barrel);

    // 顶部瞄准肋条 & 红点准星
    const rib = this._part(new THREE.BoxGeometry(0.04, 0.025, 0.34), 0x78909c);
    rib.position.set(0, 0.1, -0.18);
    group.add(rib);

    const sight = this._part(new THREE.BoxGeometry(0.02, 0.035, 0.025), 0xff2a44, 0x550011);
    sight.position.set(0, 0.12, -0.33);
    group.add(sight);

    // 金黄色左轮弹巢
    const cyl = this._part(new THREE.CylinderGeometry(0.062, 0.062, 0.12, 8), 0xffe01b);
    cyl.rotation.x = Math.PI / 2;
    cyl.position.set(0, 0.02, 0.03);
    group.add(cyl);

    // 机匣与木质握把
    const frame = this._part(new THREE.BoxGeometry(0.08, 0.11, 0.16), 0x546e7a);
    frame.position.set(0, 0.0, 0.05);
    group.add(frame);

    const grip = this._part(new THREE.BoxGeometry(0.072, 0.18, 0.095), 0xb85224);
    grip.position.set(0, -0.11, 0.11);
    grip.rotation.x = 0.28;
    group.add(grip);

    // 戴黑手套的手
    const hand = this._part(new THREE.BoxGeometry(0.11, 0.12, 0.14), 0x262230);
    hand.position.set(0.01, -0.13, 0.13);
    group.add(hand);

    const muzzle = this._makeMuzzleStar(0xffe01b);
    muzzle.position.set(0, 0.06, -0.4);
    group.add(muzzle);

    return { group, muzzle, cylinder: cyl };
  }

  _buildShotgun() {
    const group = new THREE.Group();

    // 双联重型枪管
    const barrelGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.52, 8);
    barrelGeo.rotateX(Math.PI / 2);
    const bL = this._part(barrelGeo, 0x607d8b);
    bL.position.set(-0.036, 0.05, -0.22);
    const bR = this._part(barrelGeo, 0x90a4ae);
    bR.position.set(0.036, 0.05, -0.22);
    group.add(bL, bR);

    // 红色金属机匣
    const body = this._part(new THREE.BoxGeometry(0.13, 0.11, 0.24), 0xff2a44);
    body.position.set(0, 0.01, 0.06);
    group.add(body);

    // 黄色漫画警戒条
    const stripe = this._part(new THREE.BoxGeometry(0.136, 0.032, 0.18), 0xffe01b);
    stripe.position.set(0, 0.02, 0.05);
    group.add(stripe);

    // 泵动木质护木
    const pump = this._part(new THREE.BoxGeometry(0.11, 0.075, 0.2), 0xd47528);
    pump.position.set(0, -0.02, -0.18);
    group.add(pump);

    // 枪托
    const stock = this._part(new THREE.BoxGeometry(0.1, 0.13, 0.22), 0xb85820);
    stock.position.set(0, -0.06, 0.22);
    stock.rotation.x = 0.22;
    group.add(stock);

    const muzzle = this._makeMuzzleStar(0xff7a00);
    muzzle.scale.setScalar(1.45);
    muzzle.position.set(0, 0.05, -0.52);
    group.add(muzzle);

    return { group, muzzle, pump };
  }

  _buildRaygun() {
    const group = new THREE.Group();

    // 复古科幻粉紫枪身
    const body = this._part(new THREE.ConeGeometry(0.095, 0.44, 8), 0xff2ebd);
    body.rotation.x = -Math.PI / 2;
    body.position.set(0, 0.03, -0.12);
    group.add(body);

    // 3 道金色散热能量环
    [-0.12, -0.21, -0.3].forEach((z, idx) => {
      const r = 0.095 - idx * 0.015;
      const ring = this._part(new THREE.TorusGeometry(r, 0.016, 6, 12), 0xffe01b);
      ring.position.set(0, 0.03, z);
      group.add(ring);
    });

    // 青色发光能量核心球
    const core = this._part(new THREE.SphereGeometry(0.072, 10, 10), 0x00f0ff, 0x0088aa);
    core.position.set(0, 0.05, 0.06);
    group.add(core);

    const grip = this._part(new THREE.BoxGeometry(0.075, 0.17, 0.09), 0x262236);
    grip.position.set(0, -0.1, 0.09);
    grip.rotation.x = 0.25;
    group.add(grip);

    const muzzle = this._makeMuzzleStar(0x00f0ff);
    muzzle.position.set(0, 0.03, -0.38);
    group.add(muzzle);

    return { group, muzzle, core };
  }

  _buildPunchFist() {
    const g = new THREE.Group();
    const glove = this._part(new THREE.BoxGeometry(0.24, 0.22, 0.26), 0xff2a44);
    const cuff = this._part(new THREE.CylinderGeometry(0.11, 0.12, 0.16, 8), 0xffe01b);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0, 0.18);
    g.add(glove, cuff);
    g.position.set(-0.28, -0.25, -0.45);
    return g;
  }

  _syncVisibility() {
    if (!this.models) return;
    this.models.forEach((m, idx) => {
      m.group.visible = idx === this.currentIdx;
    });
  }

  resetAll() {
    this.weapons[0].ammo = 6;
    this.weapons[1].ammo = 6;
    this.weapons[1].reserve = 24;
    this.weapons[2].ammo = 24;
    this.weapons[2].reserve = 72;
    this.currentIdx = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.cooldown = 0;
    this.recoil = 0;
    this.muzzleFlash = 0;
    this.isAds = false;
    this.adsAmount = 0;
    this.punchTimer = 0;
    this.autoReloadTimer = 0;
    this._syncVisibility();
  }

  addAmmo() {
    this.weapons[1].reserve = Math.min(this.weapons[1].maxReserve, this.weapons[1].reserve + 12);
    this.weapons[2].reserve = Math.min(this.weapons[2].maxReserve, this.weapons[2].reserve + 36);
  }

  select(idx) {
    if (idx < 0 || idx >= this.weapons.length || idx === this.currentIdx) return;
    this.currentIdx = idx;
    this.autoReloadTimer = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.cooldown = 0.16;
    this.switchAnim = 1.0;
    this._syncVisibility();
  }

  cycle(dir) {
    this.select((this.currentIdx + dir + this.weapons.length) % this.weapons.length);
  }

  startReload() {
    const w = this.current;
    if (this.reloading || w.ammo >= w.magSize || w.reserve <= 0) return false;
    this.reloading = true;
    this.reloadTimer = w.reloadTime;
    this.audio.playReload();
    return true;
  }

  triggerPunch() {
    if (this.punchTimer > 0) return false;
    this.punchTimer = 0.34;
    this.audio.playPunch();
    return true;
  }

  canFire() {
    if (this.reloading || this.cooldown > 0 || this.punchTimer > 0.12) return false;
    const w = this.current;
    if (w.ammo <= 0) {
      if (w.reserve > 0) this.startReload();
      else {
        this.audio.playDryFire();
        this.cooldown = 0.25;
      }
      return false;
    }
    return true;
  }

  consumeShot() {
    const w = this.current;
    w.ammo -= 1;
    this.cooldown = w.fireRate;
    this.recoil = w.recoilKick;
    this.muzzleFlash = 0.075;

    if (w.id === "magnum") this.audio.playMagnum();
    else if (w.id === "shotgun") this.audio.playShotgun();
    else this.audio.playRaygun();

    if (w.ammo === 0 && w.reserve > 0) {
      if (this.camera) {
        setTimeout(() => {
          if (this.current === w && w.ammo === 0 && !this.reloading) this.startReload();
        }, 170);
      } else {
        this.autoReloadTimer = 0.17;
      }
    }
    return w;
  }

  getMuzzleWorldPosition(target = new THREE.Vector3()) {
    return this.currentModel.muzzle.getWorldPosition(target);
  }

  update(dt, isMoving) {
    if (this.autoReloadTimer > 0) {
      this.autoReloadTimer -= dt;
      if (this.autoReloadTimer <= 0 && this.current.ammo === 0) this.startReload();
    }
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.muzzleFlash > 0) this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 5.8);
    if (this.switchAnim > 0) this.switchAnim = Math.max(0, this.switchAnim - dt * 5.0);

    this.swayTime += dt * (isMoving ? 9.5 : 2.1);

    // 平滑 ADS 机瞄插值
    const targetAds = this.isAds && !this.reloading ? 1 : 0;
    this.adsAmount += (targetAds - this.adsAmount) * Math.min(1, dt * 14);

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const w = this.current;
        const needed = w.magSize - w.ammo;
        if (w.reserve === Infinity) {
          w.ammo = w.magSize;
        } else {
          const take = Math.min(needed, w.reserve);
          w.ammo += take;
          w.reserve -= take;
        }
        this.reloading = false;
      }
    }

    this.punchTimer = Math.max(0, this.punchTimer - dt);
    if (!this.camera) return;

    // 武器位置、后坐力与动画
    const w = this.current;
    const m = this.currentModel;
    const basePos = new THREE.Vector3().lerpVectors(w.hipPos, w.adsPos, this.adsAmount);
    const bobScale = 1 - this.adsAmount * 0.72;
    const bobX = Math.cos(this.swayTime) * 0.014 * bobScale;
    const bobY = Math.abs(Math.sin(this.swayTime)) * 0.016 * bobScale;
    const reloadDip = this.reloading ? Math.sin((this.reloadTimer / w.reloadTime) * Math.PI) * 0.24 : 0;
    const switchDip = this.switchAnim * 0.28;

    this.root.position.set(
      basePos.x + bobX,
      basePos.y + bobY - reloadDip - switchDip,
      basePos.z + this.recoil * 0.09
    );
    this.root.rotation.set(
      this.recoil * 0.24 - reloadDip * 1.4,
      0,
      this.reloading ? 0.35 : 0
    );

    // 枪口闪光与旋转
    m.muzzle.visible = this.muzzleFlash > 0;
    if (m.muzzle.visible) {
      m.muzzle.rotation.z += dt * 32;
    }
    if (m.cylinder && this.recoil > 0.1) {
      m.cylinder.rotation.y += dt * 12;
    }
    if (m.core) {
      m.core.scale.setScalar(1 + Math.sin(this.swayTime * 2) * 0.06);
    }

    // 近战重拳动画
    if (this.punchTimer > 0) {
      const p = 1 - this.punchTimer / 0.34;
      const thrust = Math.sin(p * Math.PI);
      this.punchFist.visible = true;
      this.punchFist.position.set(-0.28 + thrust * 0.26, -0.24 + thrust * 0.12, -0.35 - thrust * 0.55);
      this.punchFist.rotation.set(0, -thrust * 0.3, thrust * 0.4);
    } else {
      this.punchFist.visible = false;
    }
  }
}
