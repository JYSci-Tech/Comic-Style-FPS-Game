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
        desc: "高速全自动能量连射，中近距火力压制",
      },
      {
        id: "sniper",
        name: "DEADEYE .50",
        magSize: 4,
        ammo: 4,
        reserve: 16,
        maxReserve: 24,
        damage: 95,
        headshotMult: 2.5,
        pellets: 1,
        spread: 0.016,
        adsSpread: 0.0004,
        fireRate: 1.05,
        reloadTime: 1.45,
        auto: false,
        recoilKick: 1.55,
        soundWord: "KRAK!",
        tracerColor: 0x38e54d,
        hipPos: new THREE.Vector3(0.3, -0.26, -0.5),
        adsPos: new THREE.Vector3(0.0, -0.145, -0.34),
        adsFov: 26,
        desc: "高倍瞄准镜栓动狙击，爆头一枪秒杀重装",
      },
    ];

    this.unlocked = [true, true, true, true];

    if (camera) {
      this.root = new THREE.Group();
      this.camera.add(this.root);
      this.models = [this._buildMagnum(), this._buildShotgun(), this._buildRaygun(), this._buildSniper()];
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

  _part(geo, color, emissive = 0x000000, outlineScale = 1.05, crease = false) {
    const mat = this.assets.toonMat({ color, emissive });
    const mesh = new THREE.Mesh(geo, mat);
    if (outlineScale > 1) this.assets.addOutline(mesh, outlineScale);
    if (crease) this.assets.addCreaseLines(mesh, 26);
    return mesh;
  }

  _buildGlovedHand(x = 0.008, y = -0.125, z = 0.125) {
    const hand = new THREE.Group();
    hand.position.set(x, y, z);

    // 掌部黑手套
    const palm = this._part(new THREE.BoxGeometry(0.105, 0.105, 0.12), 0x262330, 0, 1.05);
    hand.add(palm);

    // 3 节卷握手指骨节
    for (let i = 0; i < 3; i++) {
      const finger = this._part(new THREE.BoxGeometry(0.095, 0.024, 0.045), 0x343044, 0, 1.06);
      finger.position.set(0, 0.028 - i * 0.027, -0.055);
      hand.add(finger);
    }

    // 拇指扣在侧面
    const thumb = this._part(new THREE.BoxGeometry(0.032, 0.034, 0.072), 0x343044, 0, 1.06);
    thumb.position.set(-0.055, 0.045, -0.02);
    thumb.rotation.set(0.25, 0.2, 0.25);
    hand.add(thumb);

    // 漫画硬汉风衣袖口 + 金色护腕扣
    const cuff = this._part(new THREE.CylinderGeometry(0.058, 0.066, 0.06, 10), 0xffe01b, 0, 1.06);
    cuff.rotation.x = Math.PI / 2.2;
    cuff.position.set(0.015, -0.035, 0.095);
    hand.add(cuff);

    const sleeve = this._part(new THREE.CylinderGeometry(0.068, 0.082, 0.14, 10), 0x1c1a24, 0, 1.05);
    sleeve.rotation.x = Math.PI / 2.2;
    sleeve.position.set(0.025, -0.06, 0.18);
    hand.add(sleeve);

    return hand;
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

    // 重型八角钢制枪管 + 顶部散热镂空肋条
    const barrel = this._part(new THREE.CylinderGeometry(0.036, 0.04, 0.36, 8), 0xdce6ec, 0, 1.055);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.064, -0.19);
    group.add(barrel);

    // 枪管下方全长配重护套（Underlug）与退壳杆
    const underlug = this._part(new THREE.BoxGeometry(0.046, 0.046, 0.33), 0x8ea2b0, 0, 1.05, true);
    underlug.position.set(0, 0.024, -0.175);
    group.add(underlug);

    const ejectorRod = this._part(new THREE.CylinderGeometry(0.011, 0.011, 0.24, 8), 0x3b4854, 0, 1.08);
    ejectorRod.rotation.x = Math.PI / 2;
    ejectorRod.position.set(0, 0.016, -0.14);
    group.add(ejectorRod);

    // 枪口深邃黑膛口
    const bore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.012, 10),
      new THREE.MeshBasicMaterial({ color: 0x0b0b10 })
    );
    bore.rotation.x = Math.PI / 2;
    bore.position.set(0, 0.064, -0.372);
    group.add(bore);

    // 顶部通气肋条（主梁 + 3根立柱）
    const topRib = this._part(new THREE.BoxGeometry(0.03, 0.014, 0.34), 0x607482, 0, 1.06);
    topRib.position.set(0, 0.112, -0.185);
    group.add(topRib);
    [-0.07, -0.18, -0.29].forEach((z) => {
      const post = this._part(new THREE.BoxGeometry(0.026, 0.02, 0.03), 0x455663, 0, 1.06);
      post.position.set(0, 0.098, z);
      group.add(post);
    });

    // 红色发光前准星 + 后照门缺口
    const frontSight = this._part(new THREE.BoxGeometry(0.014, 0.03, 0.036), 0xff2a44, 0x660015, 1.08);
    frontSight.position.set(0, 0.132, -0.335);
    group.add(frontSight);

    const rearL = this._part(new THREE.BoxGeometry(0.014, 0.022, 0.024), 0x263238, 0, 1.08);
    rearL.position.set(-0.022, 0.112, 0.06);
    const rearR = this._part(new THREE.BoxGeometry(0.014, 0.022, 0.024), 0x263238, 0, 1.08);
    rearR.position.set(0.022, 0.112, 0.06);
    group.add(rearL, rearR);

    // 精细 6 发左轮弹巢组（弹巢本体 + 6 个黄铜弹壳底火 + 凹槽）
    const cylGroup = new THREE.Group();
    cylGroup.position.set(0, 0.032, 0.022);
    const cylCore = this._part(new THREE.CylinderGeometry(0.056, 0.056, 0.115, 12), 0xffe01b, 0, 1.055);
    cylCore.rotation.x = Math.PI / 2;
    cylGroup.add(cylCore);

    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const r = 0.035;
      // 弹巢外壁减重凹槽
      const flute = this._part(new THREE.CylinderGeometry(0.011, 0.011, 0.088, 6), 0xcfa410, 0, 1.0);
      flute.rotation.x = Math.PI / 2;
      flute.position.set(Math.cos(ang + Math.PI / 6) * 0.052, Math.sin(ang + Math.PI / 6) * 0.052, 0);
      cylGroup.add(flute);

      // 尾部可见的黄铜子弹底缘
      const rim = this._part(new THREE.CylinderGeometry(0.013, 0.013, 0.014, 8), 0xd49635, 0, 1.0);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(Math.cos(ang) * r, Math.sin(ang) * r, 0.056);
      cylGroup.add(rim);
    }
    group.add(cylGroup);

    // 上下机匣框架（留出弹巢窗）
    const topStrap = this._part(new THREE.BoxGeometry(0.064, 0.024, 0.17), 0x546e7a, 0, 1.05);
    topStrap.position.set(0, 0.095, 0.022);
    const rearFrame = this._part(new THREE.BoxGeometry(0.068, 0.12, 0.075), 0x546e7a, 0, 1.05, true);
    rearFrame.position.set(0, 0.035, 0.11);
    const bottomFrame = this._part(new THREE.BoxGeometry(0.064, 0.036, 0.17), 0x455a64, 0, 1.05);
    bottomFrame.position.set(0, -0.035, 0.025);
    group.add(topStrap, rearFrame, bottomFrame);

    // 可动击锤（开火时向后击发）
    const hammer = this._part(new THREE.BoxGeometry(0.02, 0.052, 0.036), 0x263238, 0, 1.08);
    hammer.position.set(0, 0.095, 0.145);
    hammer.rotation.x = -0.35;
    group.add(hammer);

    // 扳机护圈与扳机
    const guard = this._part(new THREE.TorusGeometry(0.036, 0.008, 6, 12), 0x37474f, 0, 1.08);
    guard.rotation.y = Math.PI / 2;
    guard.position.set(0, -0.068, 0.038);
    const trigger = this._part(new THREE.BoxGeometry(0.012, 0.036, 0.014), 0xffe01b, 0, 1.08);
    trigger.position.set(0, -0.062, 0.044);
    trigger.rotation.x = 0.25;
    group.add(guard, trigger);

    // 胡桃木握把 + 两侧防滑贴片 + 黄铜底盖
    const grip = this._part(new THREE.BoxGeometry(0.058, 0.185, 0.088), 0x9c421c, 0, 1.05, true);
    grip.position.set(0, -0.105, 0.13);
    grip.rotation.x = 0.34;
    const panelL = this._part(new THREE.BoxGeometry(0.068, 0.135, 0.066), 0xc45d2d, 0, 1.04);
    panelL.position.set(0, -0.105, 0.13);
    panelL.rotation.x = 0.34;
    const pommel = this._part(new THREE.BoxGeometry(0.066, 0.02, 0.094), 0xffe01b, 0, 1.06);
    pommel.position.set(0, -0.192, 0.16);
    pommel.rotation.x = 0.34;
    group.add(grip, panelL, pommel);

    group.add(this._buildGlovedHand(0.008, -0.115, 0.135));

    const muzzle = this._makeMuzzleStar(0xffe01b);
    muzzle.position.set(0, 0.064, -0.4);
    group.add(muzzle);

    return { group, muzzle, cylinder: cylGroup, hammer };
  }

  _buildShotgun() {
    const group = new THREE.Group();

    // 双联重型枪管 + 深邃枪口
    const barrelGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.56, 10);
    barrelGeo.rotateX(Math.PI / 2);
    const bL = this._part(barrelGeo, 0x546e7a, 0, 1.055);
    bL.position.set(-0.034, 0.06, -0.23);
    const bR = this._part(barrelGeo, 0x78909c, 0, 1.055);
    bR.position.set(0.034, 0.06, -0.23);
    group.add(bL, bR);

    [-0.034, 0.034].forEach((bx) => {
      const bore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.012, 8),
        new THREE.MeshBasicMaterial({ color: 0x0b0b10 })
      );
      bore.rotation.x = Math.PI / 2;
      bore.position.set(bx, 0.06, -0.512);
      group.add(bore);
    });

    // 顶部散热防烫罩 + 散热槽 + 黄铜珠准星
    const heatShield = this._part(new THREE.BoxGeometry(0.104, 0.022, 0.34), 0x2c3842, 0, 1.05);
    heatShield.position.set(0, 0.088, -0.24);
    group.add(heatShield);
    for (let i = 0; i < 5; i++) {
      const vent = new THREE.Mesh(
        new THREE.BoxGeometry(0.072, 0.026, 0.028),
        new THREE.MeshBasicMaterial({ color: 0x101016 })
      );
      vent.position.set(0, 0.088, -0.11 - i * 0.065);
      group.add(vent);
    }

    const clamp = this._part(new THREE.BoxGeometry(0.114, 0.088, 0.032), 0x263238, 0, 1.06);
    clamp.position.set(0, 0.034, -0.44);
    const bead = this._part(new THREE.SphereGeometry(0.014, 8, 8), 0xffe01b, 0x664400, 1.1);
    bead.position.set(0, 0.104, -0.49);
    group.add(clamp, bead);

    // 下置管状弹仓 + 前端旋盖
    const magTube = this._part(new THREE.CylinderGeometry(0.026, 0.026, 0.44, 10), 0x37474f, 0, 1.055);
    magTube.rotation.x = Math.PI / 2;
    magTube.position.set(0, 0.008, -0.22);
    const magCap = this._part(new THREE.CylinderGeometry(0.032, 0.032, 0.035, 8), 0xffe01b, 0, 1.06);
    magCap.rotation.x = Math.PI / 2;
    magCap.position.set(0, 0.008, -0.455);
    group.add(magTube, magCap);

    // 可动泵动护木组（带 5 道防滑木纹环）
    const pumpGroup = new THREE.Group();
    pumpGroup.position.set(0, -0.01, -0.2);
    const pumpCore = this._part(new THREE.BoxGeometry(0.106, 0.068, 0.21), 0xc8641e, 0, 1.05, true);
    pumpGroup.add(pumpCore);
    for (let i = -2; i <= 2; i++) {
      const rib = this._part(new THREE.BoxGeometry(0.114, 0.072, 0.016), 0x8f3f12, 0, 1.03);
      rib.position.z = i * 0.036;
      pumpGroup.add(rib);
    }
    group.add(pumpGroup);

    // 绯红漫画重型机匣 + 顶部皮卡汀尼导轨 + 黄色警戒条
    const receiver = this._part(new THREE.BoxGeometry(0.128, 0.118, 0.26), 0xff2a44, 0, 1.05, true);
    receiver.position.set(0, 0.02, 0.065);
    const stripe = this._part(new THREE.BoxGeometry(0.135, 0.028, 0.21), 0xffe01b, 0, 1.04);
    stripe.position.set(0, 0.03, 0.06);
    const rail = this._part(new THREE.BoxGeometry(0.056, 0.018, 0.22), 0x1e242b, 0, 1.06);
    rail.position.set(0, 0.088, 0.065);
    group.add(receiver, stripe, rail);

    // 右侧抛壳窗（内嵌红色待抛霰弹壳）
    const port = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.042, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x101016 })
    );
    port.position.set(0.064, 0.045, 0.04);
    group.add(port);

    // 左侧侧挂弹药架（4 枚红壳黄铜底霰弹）
    const saddle = this._part(new THREE.BoxGeometry(0.02, 0.046, 0.16), 0x1c1c24, 0, 1.06);
    saddle.position.set(-0.072, 0.015, 0.065);
    group.add(saddle);
    for (let i = 0; i < 4; i++) {
      const sz = 0.005 + i * 0.04;
      const shell = this._part(new THREE.CylinderGeometry(0.011, 0.011, 0.064, 8), 0xff2a44, 0, 1.05);
      shell.position.set(-0.082, 0.022, sz);
      const brass = this._part(new THREE.CylinderGeometry(0.012, 0.012, 0.018, 8), 0xffe01b, 0, 1.04);
      brass.position.set(-0.082, 0.054, sz);
      group.add(shell, brass);
    }

    // 扳机护圈
    const guard = this._part(new THREE.TorusGeometry(0.036, 0.009, 6, 12), 0x263238, 0, 1.08);
    guard.rotation.y = Math.PI / 2;
    guard.position.set(0, -0.055, 0.11);
    group.add(guard);

    // 实木枪托 + 黑色橡胶托垫
    const stock = this._part(new THREE.BoxGeometry(0.095, 0.135, 0.25), 0xb8541e, 0, 1.05, true);
    stock.position.set(0, -0.055, 0.26);
    stock.rotation.x = 0.24;
    const buttpad = this._part(new THREE.BoxGeometry(0.102, 0.142, 0.028), 0x1a1a22, 0, 1.05);
    buttpad.position.set(0, -0.085, 0.38);
    buttpad.rotation.x = 0.24;
    group.add(stock, buttpad);

    // 机匣底部装弹口（现实泵动霰弹枪从底部装填弹仓）
    const loadingPort = new THREE.Mesh(
      new THREE.BoxGeometry(0.058, 0.014, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x0b0b10 })
    );
    loadingPort.position.set(0, -0.04, 0.02);
    group.add(loadingPort);

    // 换弹时左手捏着红壳黄铜霰弹逐发塞入底部装弹口
    const reloadShellGroup = new THREE.Group();
    const rShellHull = this._part(new THREE.CylinderGeometry(0.014, 0.014, 0.072, 10), 0xff2a44, 0, 1.06);
    rShellHull.rotation.x = Math.PI / 2;
    rShellHull.position.set(0, 0, -0.012);
    const rShellBrass = this._part(new THREE.CylinderGeometry(0.015, 0.015, 0.022, 10), 0xffe01b, 0, 1.05);
    rShellBrass.rotation.x = Math.PI / 2;
    rShellBrass.position.set(0, 0, 0.032);
    const leftHand = this._part(new THREE.BoxGeometry(0.085, 0.075, 0.1), 0x262330, 0, 1.05);
    leftHand.position.set(-0.02, -0.048, 0.045);
    reloadShellGroup.add(rShellHull, rShellBrass, leftHand);
    reloadShellGroup.visible = false;
    group.add(reloadShellGroup);

    group.add(this._buildGlovedHand(0.012, -0.095, 0.18));

    const muzzle = this._makeMuzzleStar(0xff7a00);
    muzzle.scale.setScalar(1.55);
    muzzle.position.set(0, 0.06, -0.55);
    group.add(muzzle);

    return { group, muzzle, pump: pumpGroup, reloadShell: reloadShellGroup };
  }

  _buildRaygun() {
    const group = new THREE.Group();

    // 复古科幻流线型粉紫主枪身 + 金属机身侧翼
    const body = this._part(new THREE.CylinderGeometry(0.042, 0.098, 0.44, 12), 0xff2ebd, 0, 1.05);
    body.rotation.x = Math.PI / 2;
    body.position.set(0, 0.035, -0.11);
    group.add(body);

    // 侧面银色复古火箭尾翼（漫画射线枪灵魂！）
    [-1, 1].forEach((side) => {
      const fin = this._part(new THREE.BoxGeometry(0.016, 0.068, 0.24), 0xe2eaf2, 0, 1.06, true);
      fin.position.set(side * 0.095, 0.025, -0.02);
      fin.rotation.z = side * -0.25;
      group.add(fin);

      const trim = this._part(new THREE.BoxGeometry(0.02, 0.018, 0.2), 0x00f0ff, 0x006688, 1.04);
      trim.position.set(side * 0.098, 0.032, -0.03);
      group.add(trim);
    });

    // 顶部玻璃能量导管 + 青色发光等离子芯
    const conduit = this._part(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 10), 0x00f0ff, 0x0099bb, 1.06);
    conduit.rotation.x = Math.PI / 2;
    conduit.position.set(0, 0.112, -0.12);
    group.add(conduit);

    // 3 道金色渐缩粒子加速环 + 枪口三叉发射天线
    [-0.1, -0.2, -0.29].forEach((z, idx) => {
      const r = 0.092 - idx * 0.016;
      const ring = this._part(new THREE.TorusGeometry(r, 0.015, 8, 16), 0xffe01b, 0x332200, 1.06);
      ring.position.set(0, 0.035, z);
      group.add(ring);
    });

    // 枪口发光发射盘 + 3 根前伸触角
    const dish = this._part(new THREE.CylinderGeometry(0.056, 0.034, 0.03, 12), 0xffe01b, 0, 1.06);
    dish.rotation.x = Math.PI / 2;
    dish.position.set(0, 0.035, -0.34);
    const emitter = this._part(new THREE.SphereGeometry(0.034, 10, 10), 0x00f0ff, 0x00aacc, 1.08);
    emitter.position.set(0, 0.035, -0.365);
    group.add(dish, emitter);

    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const prong = this._part(new THREE.ConeGeometry(0.012, 0.085, 6), 0xe2eaf2, 0, 1.08);
      prong.rotation.x = -Math.PI / 2;
      prong.position.set(Math.cos(ang) * 0.048, 0.035 + Math.sin(ang) * 0.048, -0.375);
      group.add(prong);
    }

    // 可弹出能量电池核心组（外黄铜环 + 内发光菱形晶核）
    const coreGroup = new THREE.Group();
    coreGroup.position.set(0, 0.055, 0.075);
    const coreBall = this._part(new THREE.OctahedronGeometry(0.068, 1), 0x00f0ff, 0x0099bb, 1.06);
    const coreCage = this._part(new THREE.TorusGeometry(0.074, 0.01, 6, 14), 0xffe01b, 0, 1.06);
    coreCage.rotation.x = Math.PI / 2;
    coreGroup.add(coreBall, coreCage);
    group.add(coreGroup);

    // 尾部朝向玩家的漫画能量仪表盘
    const dialHousing = this._part(new THREE.CylinderGeometry(0.046, 0.046, 0.03, 12), 0x262236, 0, 1.06);
    dialHousing.rotation.x = Math.PI / 2;
    dialHousing.position.set(0, 0.045, 0.145);
    const dialFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.036, 12),
      new THREE.MeshBasicMaterial({ color: 0x38e54d })
    );
    dialFace.position.set(0, 0.045, 0.162);
    const needle = new THREE.Mesh(
      new THREE.BoxGeometry(0.006, 0.028, 0.004),
      new THREE.MeshBasicMaterial({ color: 0x101016 })
    );
    needle.position.set(0.008, 0.052, 0.164);
    needle.rotation.z = -0.5;
    group.add(dialHousing, dialFace, needle);

    // 科幻握把 + 护圈 + 手套
    const grip = this._part(new THREE.BoxGeometry(0.068, 0.17, 0.088), 0x2c2640, 0, 1.05, true);
    grip.position.set(0, -0.098, 0.095);
    grip.rotation.x = 0.28;
    const guard = this._part(new THREE.TorusGeometry(0.034, 0.008, 6, 10), 0xffe01b, 0, 1.08);
    guard.rotation.y = Math.PI / 2;
    guard.position.set(0, -0.052, 0.025);
    group.add(grip, guard);

    group.add(this._buildGlovedHand(0.006, -0.105, 0.11));

    const muzzle = this._makeMuzzleStar(0x00f0ff);
    muzzle.position.set(0, 0.035, -0.42);
    group.add(muzzle);

    return { group, muzzle, core: coreGroup, coreBall };
  }

  _buildSniper() {
    const group = new THREE.Group();

    // 超长精密重型枪管 + 镂空制退器
    const barrel = this._part(new THREE.CylinderGeometry(0.02, 0.026, 0.72, 10), 0x37474f, 0, 1.055);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.056, -0.34);
    group.add(barrel);

    // 枪口方形重型制退器（Muzzle Brake）
    const brake = this._part(new THREE.BoxGeometry(0.068, 0.048, 0.1), 0x222831, 0, 1.06, true);
    brake.position.set(0, 0.056, -0.71);
    const brakeAccent = this._part(new THREE.BoxGeometry(0.074, 0.016, 0.06), 0xffe01b, 0, 1.04);
    brakeAccent.position.set(0, 0.056, -0.71);
    group.add(brake, brakeAccent);

    // 前护木（战术绿 + 黄色漫画线条 + 折叠两脚架）
    const handguard = this._part(new THREE.BoxGeometry(0.074, 0.074, 0.34), 0x246b42, 0, 1.05, true);
    handguard.position.set(0, 0.032, -0.2);
    const stripe = this._part(new THREE.BoxGeometry(0.08, 0.018, 0.28), 0xffe01b, 0, 1.04);
    stripe.position.set(0, 0.036, -0.2);
    group.add(handguard, stripe);

    [-0.045, 0.045].forEach((bx) => {
      const leg = this._part(new THREE.CylinderGeometry(0.009, 0.009, 0.2, 6), 0x263238, 0, 1.08);
      leg.rotation.x = Math.PI / 2.2;
      leg.position.set(bx, -0.012, -0.3);
      group.add(leg);
    });

    // 重型精密机匣 + 顶部导轨
    const receiver = this._part(new THREE.BoxGeometry(0.082, 0.092, 0.28), 0x1e262e, 0, 1.05, true);
    receiver.position.set(0, 0.036, 0.07);
    const rail = this._part(new THREE.BoxGeometry(0.044, 0.018, 0.28), 0x546e7a, 0, 1.06);
    rail.position.set(0, 0.088, 0.05);
    group.add(receiver, rail);

    // 可动拉机柄（栓动击发后拉栓上膛）
    const boltGroup = new THREE.Group();
    boltGroup.position.set(0.048, 0.052, 0.11);
    const boltStem = this._part(new THREE.CylinderGeometry(0.008, 0.008, 0.055, 6), 0xcfd8dc, 0, 1.08);
    boltStem.rotation.z = Math.PI / 2;
    boltStem.position.x = 0.025;
    const boltKnob = this._part(new THREE.SphereGeometry(0.018, 8, 8), 0xffe01b, 0, 1.08);
    boltKnob.position.x = 0.055;
    boltGroup.add(boltStem, boltKnob);
    group.add(boltGroup);

    // 高倍率漫画狙击瞄准镜（镜筒 + 双镜环 + 调节旋钮 + 翠绿发光物镜）
    const scopeTube = this._part(new THREE.CylinderGeometry(0.028, 0.024, 0.34, 12), 0x1a1e26, 0, 1.055);
    scopeTube.rotation.x = Math.PI / 2;
    scopeTube.position.set(0, 0.145, 0.02);
    const scopeBell = this._part(new THREE.CylinderGeometry(0.04, 0.028, 0.09, 12), 0x263238, 0, 1.055);
    scopeBell.rotation.x = Math.PI / 2;
    scopeBell.position.set(0, 0.145, -0.17);
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.032, 12),
      new THREE.MeshBasicMaterial({ color: 0x38e54d })
    );
    lens.position.set(0, 0.145, 0.192);
    const turret = this._part(new THREE.CylinderGeometry(0.014, 0.014, 0.024, 8), 0xffe01b, 0, 1.08);
    turret.position.set(0, 0.18, 0.02);
    group.add(scopeTube, scopeBell, lens, turret);

    [-0.04, 0.08].forEach((rz) => {
      const mount = this._part(new THREE.BoxGeometry(0.052, 0.052, 0.024), 0xffe01b, 0, 1.06);
      mount.position.set(0, 0.115, rz);
      group.add(mount);
    });

    // 可拆卸重型直弹匣（换弹时向下拔出并拍回）
    const mag = this._part(new THREE.BoxGeometry(0.052, 0.14, 0.105), 0x2c3540, 0, 1.05, true);
    mag.position.set(0, -0.068, 0.01);
    mag.rotation.x = -0.12;
    const magBase = this._part(new THREE.BoxGeometry(0.06, 0.022, 0.112), 0xffe01b, 0, 1.05);
    magBase.position.set(0, -0.072, 0);
    mag.add(magBase);
    group.add(mag);

    // 战术枪托 + 贴腮垫 + 握把
    const stock = this._part(new THREE.BoxGeometry(0.072, 0.12, 0.28), 0x246b42, 0, 1.05, true);
    stock.position.set(0, 0.0, 0.3);
    const cheek = this._part(new THREE.BoxGeometry(0.078, 0.038, 0.14), 0x1a1e26, 0, 1.05);
    cheek.position.set(0, 0.072, 0.28);
    const grip = this._part(new THREE.BoxGeometry(0.064, 0.15, 0.078), 0x1e242c, 0, 1.05);
    grip.position.set(0, -0.082, 0.16);
    grip.rotation.x = 0.28;
    group.add(stock, cheek, grip);

    group.add(this._buildGlovedHand(0.008, -0.095, 0.17));

    const muzzle = this._makeMuzzleStar(0x38e54d);
    muzzle.scale.setScalar(1.35);
    muzzle.position.set(0, 0.056, -0.78);
    group.add(muzzle);

    return { group, muzzle, bolt: boltGroup, mag };
  }

  _buildPunchFist() {
    const g = new THREE.Group();
    // 英雄赤红漫画拳套主体
    const mainFist = this._part(new THREE.BoxGeometry(0.22, 0.18, 0.22), 0xff2a44, 0, 1.055, true);
    g.add(mainFist);

    // 4 个独立凸起指节（力量感更强）
    for (let i = 0; i < 4; i++) {
      const knuckle = this._part(new THREE.SphereGeometry(0.038, 8, 8), 0xff5268, 0, 1.08);
      knuckle.position.set(-0.075 + i * 0.05, 0.045, -0.105);
      g.add(knuckle);
    }

    // 卷握拇指
    const thumb = this._part(new THREE.BoxGeometry(0.07, 0.075, 0.14), 0xd91c34, 0, 1.06);
    thumb.position.set(0.125, -0.02, -0.04);
    thumb.rotation.y = -0.35;
    g.add(thumb);

    // 金色装甲护腕 + 铆钉 + 深色前臂袖
    const cuff = this._part(new THREE.CylinderGeometry(0.115, 0.125, 0.11, 10), 0xffe01b, 0, 1.06);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0, 0.155);
    const arm = this._part(new THREE.CylinderGeometry(0.1, 0.11, 0.2, 10), 0x22202e, 0, 1.05);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, -0.01, 0.29);
    g.add(cuff, arm);

    g.position.set(-0.28, -0.25, -0.45);
    return g;
  }

  _syncVisibility() {
    if (!this.models) return;
    const hideForScope = this.current?.id === "sniper" && this.adsAmount > 0.72 && !this.reloading;
    this.models.forEach((m, idx) => {
      m.group.visible = idx === this.currentIdx && !hideForScope;
    });
  }

  isScoped() {
    return this.current?.id === "sniper" && this.adsAmount > 0.72 && !this.reloading;
  }

  isUnlocked(idx) {
    return Boolean(this.unlocked[idx]);
  }

  setUnlocked(flags) {
    this.unlocked = this.weapons.map((_, i) => Boolean(flags[i]));
    if (!this.unlocked[0]) this.unlocked[0] = true;
    if (!this.isUnlocked(this.currentIdx)) {
      this.currentIdx = 0;
      this._syncVisibility();
    }
  }

  unlock(idx) {
    if (idx >= 0 && idx < this.weapons.length) {
      this.unlocked[idx] = true;
    }
  }

  resetAll(keepUnlocks = false) {
    this.weapons[0].ammo = 6;
    this.weapons[1].ammo = 6;
    this.weapons[1].reserve = 24;
    this.weapons[2].ammo = 24;
    this.weapons[2].reserve = 72;
    this.weapons[3].ammo = 4;
    this.weapons[3].reserve = 16;
    if (!keepUnlocks) this.unlocked = [true, true, true, true];
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
    this.weapons[3].reserve = Math.min(this.weapons[3].maxReserve, this.weapons[3].reserve + 8);
  }

  select(idx) {
    if (idx < 0 || idx >= this.weapons.length || idx === this.currentIdx || !this.isUnlocked(idx)) return;
    this.currentIdx = idx;
    this.autoReloadTimer = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.cooldown = 0.16;
    this.switchAnim = 1.0;
    this._syncVisibility();
  }

  cycle(dir) {
    const n = this.weapons.length;
    for (let step = 1; step <= n; step++) {
      const candidate = (this.currentIdx + dir * step + n * 4) % n;
      if (this.isUnlocked(candidate)) {
        this.select(candidate);
        return;
      }
    }
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
    else if (w.id === "sniper") this.audio.playSniper();
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

    // 武器位置、后坐力与三段式换弹夹动画
    const w = this.current;
    const m = this.currentModel;
    const basePos = new THREE.Vector3().lerpVectors(w.hipPos, w.adsPos, this.adsAmount);
    const bobScale = 1 - this.adsAmount * 0.72;
    const bobX = Math.cos(this.swayTime) * 0.014 * bobScale;
    const bobY = Math.abs(Math.sin(this.swayTime)) * 0.016 * bobScale;
    const switchDip = this.switchAnim * 0.28;

    let reloadPosX = 0;
    let reloadPosY = 0;
    let reloadPosZ = 0;
    let reloadRotX = 0;
    let reloadRotY = 0;
    let reloadRotZ = 0;

    if (this.reloading) {
      // p: 0 -> 1 换弹进度
      const p = Math.max(0, Math.min(1, 1 - this.reloadTimer / w.reloadTime));
      const arc = Math.sin(p * Math.PI);
      const snap = p > 0.82 ? Math.sin(((p - 0.82) / 0.18) * Math.PI) : 0;

      if (w.id === "magnum") {
        // 左轮侧倾甩出弹巢旋转装弹，再清脆合上
        reloadPosX = -0.05 * arc;
        reloadPosY = -0.09 * arc + snap * 0.03;
        reloadRotX = 0.28 * arc + snap * 0.15;
        reloadRotZ = 0.78 * arc;
        if (m.cylinder) {
          m.cylinder.position.x = -0.095 * Math.sin(Math.min(1, p * 1.15) * Math.PI);
          m.cylinder.rotation.z += dt * 18;
        }
      } else if (w.id === "shotgun") {
        // 真实泵动霰弹枪三段式换弹：侧翻露出底部装弹口 -> 左手逐发推入红壳霰弹 -> 回正拉动护木上膛一次
        if (p < 0.16) {
          const t = p / 0.16;
          reloadPosX = -0.04 * t;
          reloadPosY = -0.03 * t;
          reloadRotX = 0.24 * t;
          reloadRotZ = -0.72 * t;
          if (m.reloadShell) m.reloadShell.visible = false;
          if (m.pump) m.pump.position.z = -0.2;
        } else if (p < 0.76) {
          const insertPhase = (p - 0.16) / 0.6; // 0 -> 1 内塞入 3 发霰弹
          const shellProgress = (insertPhase * 3) % 1;
          const nudge = shellProgress > 0.55 ? Math.sin(((shellProgress - 0.55) / 0.45) * Math.PI) : 0;
          reloadPosX = -0.04;
          reloadPosY = -0.03 + nudge * 0.018;
          reloadRotX = 0.24 + nudge * 0.05;
          reloadRotZ = -0.72;
          if (m.pump) m.pump.position.z = -0.2;
          if (m.reloadShell) {
            m.reloadShell.visible = true;
            // 霰弹从下方抬起并沿枪管方向推入底部装弹口
            const lift = Math.min(1, shellProgress / 0.5);
            const push = Math.max(0, (shellProgress - 0.45) / 0.55);
            m.reloadShell.position.set(
              -0.02 * (1 - lift),
              -0.18 + lift * 0.135,
              0.08 - push * 0.11
            );
            m.reloadShell.rotation.set(0.15 * (1 - push), 0, 0);
          }
        } else {
          // 回正并单次果断拉栓上膛（chk-chk!）
          const t = (p - 0.76) / 0.24;
          const settle = Math.max(0, 1 - t * 2.2);
          reloadPosX = -0.04 * settle;
          reloadPosY = -0.03 * settle;
          reloadRotX = 0.24 * settle + Math.sin(t * Math.PI) * 0.12;
          reloadRotZ = -0.72 * settle;
          if (m.reloadShell) m.reloadShell.visible = false;
          if (m.pump) {
            const rack = t > 0.2 ? Math.sin(((t - 0.2) / 0.8) * Math.PI) * 0.11 : 0;
            m.pump.position.z = -0.2 + rack;
          }
        }
      } else if (w.id === "sniper") {
        // 栓动狙击枪换弹：微侧枪身 -> 拔下重型直弹匣 -> 拍回新弹匣 -> 拉动枪栓上膛
        if (p < 0.72) {
          const mp = p / 0.72;
          const drop = Math.sin(mp * Math.PI);
          reloadPosY = -0.05 * drop;
          reloadRotX = 0.22 * drop;
          reloadRotZ = 0.42 * drop;
          if (m.mag) m.mag.position.y = -0.068 - drop * 0.2;
          if (m.bolt) {
            m.bolt.position.z = 0.11;
            m.bolt.rotation.z = 0;
          }
        } else {
          const bp = (p - 0.72) / 0.28;
          const rack = Math.sin(bp * Math.PI);
          reloadRotX = 0.14 * rack;
          if (m.mag) m.mag.position.y = -0.068;
          if (m.bolt) {
            m.bolt.position.z = 0.11 + rack * 0.085;
            m.bolt.rotation.z = rack * 0.75;
          }
        }
      } else {
        // 射线枪倾斜弹出能量电池核心再拍回
        reloadPosY = -0.08 * arc + snap * 0.035;
        reloadRotX = 0.25 * arc;
        reloadRotY = -0.25 * arc;
        reloadRotZ = 0.62 * arc;
        if (m.core) {
          const drop = p < 0.72 ? Math.sin((p / 0.72) * Math.PI) : 0;
          m.core.position.y = 0.055 - drop * 0.16;
          m.core.scale.setScalar(1 + snap * 0.22);
        }
      }
    } else {
      // 非换弹状态平滑复位可动部件
      if (m.cylinder) m.cylinder.position.x += (0 - m.cylinder.position.x) * Math.min(1, dt * 16);
      if (m.reloadShell) m.reloadShell.visible = false;
      if (m.mag) m.mag.position.y += (-0.068 - m.mag.position.y) * Math.min(1, dt * 18);
      if (m.bolt) {
        // 狙击枪开火后自动拉栓动作
        const boltRack = w.id === "sniper" && this.cooldown > 0.22 && this.cooldown < 0.72
          ? Math.sin(((this.cooldown - 0.22) / 0.5) * Math.PI)
          : 0;
        m.bolt.position.z += (0.11 + boltRack * 0.085 - m.bolt.position.z) * Math.min(1, dt * 22);
        m.bolt.rotation.z += (boltRack * 0.75 - m.bolt.rotation.z) * Math.min(1, dt * 22);
      }
      if (m.pump) {
        // 霰弹枪开火后半段自动拉栓动作
        const pumpRack = w.id === "shotgun" && this.cooldown > 0.08 && this.cooldown < 0.38
          ? Math.sin(((this.cooldown - 0.08) / 0.3) * Math.PI) * 0.095
          : 0;
        const targetZ = -0.2 + pumpRack;
        m.pump.position.z += (targetZ - m.pump.position.z) * Math.min(1, dt * 22);
      }
      if (m.core) {
        m.core.position.y += (0.055 - m.core.position.y) * Math.min(1, dt * 16);
        m.core.scale.setScalar(1 + Math.sin(this.swayTime * 2) * 0.06);
      }
    }

    this.root.position.set(
      basePos.x + bobX + reloadPosX,
      basePos.y + bobY + reloadPosY - switchDip,
      basePos.z + this.recoil * 0.09 + reloadPosZ
    );
    this.root.rotation.set(
      this.recoil * 0.24 + reloadRotX,
      reloadRotY,
      reloadRotZ
    );

    // 开镜时隐藏狙击枪 3D 模型，让 2D 高倍狙击镜画面干净呈现
    this._syncVisibility();

    // 枪口闪光、左轮弹巢/击锤与射线枪晶核旋转
    m.muzzle.visible = this.muzzleFlash > 0;
    if (m.muzzle.visible) {
      m.muzzle.rotation.z += dt * 32;
    }
    if (m.cylinder && !this.reloading && this.recoil > 0.1) {
      m.cylinder.rotation.z += dt * 12;
    }
    if (m.hammer) {
      m.hammer.rotation.x = -0.35 - Math.min(0.65, this.recoil * 0.65);
    }
    if (m.coreBall) {
      m.coreBall.rotation.y += dt * (this.reloading ? 10 : 2.6);
      m.coreBall.rotation.x += dt * 1.4;
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
