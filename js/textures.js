import * as THREE from "three";

// A small mip bias suppresses distant hatch shimmer while keeping the nearby ink linework.
const filteredMap = THREE.ShaderChunk.map_fragment.replace("texture2D( map, vMapUv )", "texture2D( map, vMapUv, 0.4 )");
function filterComicMap(shader) {
  shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", filteredMap);
}

// 美式漫画风 Three.js 赛璐璐材质、墨线描边与程序化高清贴图库
export class ComicAssets {
  constructor() {
    this.toonGradient = this._createToonGradient();
    this.inkMaterial = new THREE.MeshBasicMaterial({
      color: 0x0e0e14,
      side: THREE.BackSide,
    });
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: 0x0e0e14 });

    this.textures = {
      brick: this._makeCanvasTex(256, 256, (ctx) => this._drawBrick(ctx, 256), true),
      neon: this._makeCanvasTex(256, 256, (ctx) => this._drawNeonStore(ctx, 256), true),
      hazard: this._makeCanvasTex(256, 256, (ctx) => this._drawHazardSteel(ctx, 256), true),
      poster: this._makeCanvasTex(256, 256, (ctx) => this._drawWantedPoster(ctx, 256), true),
      lab: this._makeCanvasTex(256, 256, (ctx) => this._drawVillainLab(ctx, 256), true),
      crate: this._makeCanvasTex(256, 256, (ctx) => this._drawCrate(ctx, 256), true),
      asphalt: this._makeCanvasTex(256, 256, (ctx) => this._drawFloorAsphalt(ctx, 256), true),
      streetFloor: this._makeCanvasTex(256, 256, (ctx) => this._drawFloorStreetBlock(ctx, 256), true),
      sidewalk: this._makeCanvasTex(256, 256, (ctx) => this._drawSidewalkTile(ctx, 256), true),
      factoryFloor: this._makeCanvasTex(256, 256, (ctx) => this._drawFloorFactory(ctx, 256), true),
      labFloor: this._makeCanvasTex(256, 256, (ctx) => this._drawFloorLab(ctx, 256), true),
      barrel: this._makeCanvasTex(256, 256, (ctx) => this._drawBarrel(ctx, 256)),
      comicShop: this._makeCanvasTex(256, 256, (ctx) => this._drawComicShop(ctx, 256), true),
      apartment: this._makeCanvasTex(256, 256, (ctx) => this._drawApartmentFacade(ctx, 256), true),
      graffiti: this._makeCanvasTex(256, 256, (ctx) => this._drawStreetGraffiti(ctx, 256), true),
      viaduct: this._makeCanvasTex(256, 256, (ctx) => this._drawViaductWall(ctx, 256), true),
      chinatown: this._makeCanvasTex(256, 256, (ctx) => this._drawChinatownFacade(ctx, 256), true),
      container: this._makeCanvasTex(256, 256, (ctx) => this._drawHarborContainerFacade(ctx, 256), true),
      marbleBank: this._makeCanvasTex(256, 256, (ctx) => this._drawMarbleBankFacade(ctx, 256), true),
    };

    this.wallMaterials = {
      1: this.toonMat({ map: this.textures.brick }),
      2: this.toonMat({ map: this.textures.neon }),
      3: this.toonMat({ map: this.textures.hazard }),
      4: this.toonMat({ map: this.textures.poster }),
      5: this.toonMat({ map: this.textures.lab }),
      6: this.toonMat({ map: this.textures.crate }),
      7: this.toonMat({ map: this.textures.comicShop }),
      8: this.toonMat({ map: this.textures.apartment }),
      9: this.toonMat({ map: this.textures.graffiti }),
      11: this.toonMat({ map: this.textures.chinatown }),
      12: this.toonMat({ map: this.textures.container }),
      13: this.toonMat({ map: this.textures.marbleBank }),
      viaduct: this.toonMat({ map: this.textures.viaduct }),
      sidewalk: this.toonMat({ map: this.textures.sidewalk }),
    };
  }

  _createToonGradient() {
    // 3 阶硬切赛璐璐明暗色阶（高光 / 中间调 / 墨影）
    const colors = new Uint8Array([
      70, 70, 82, 255,
      178, 178, 188, 255,
      255, 255, 255, 255,
    ]);
    const tex = new THREE.DataTexture(colors, 3, 1, THREE.RGBAFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  toonMat(opts = {}) {
    const material = new THREE.MeshToonMaterial({
      gradientMap: this.toonGradient,
      ...opts,
    });
    if (opts.map?.generateMipmaps) material.onBeforeCompile = filterComicMap;
    return material;
  }

  // 给 3D 网格添加反向法线厚黑墨线描边（Inverted Hull）
  addOutline(mesh, scale = 1.055) {
    const outline = new THREE.Mesh(mesh.geometry, this.inkMaterial);
    outline.scale.setScalar(scale);
    outline.raycast = () => {}; // 不干扰子弹射线检测
    mesh.add(outline);
    return outline;
  }

  // 给建筑/箱体添加锐利漫画硬棱角墨线（复用缓存的 EdgesGeometry，大幅降低大图 CPU/GPU 开销）
  addCreaseLines(mesh, threshold = 20) {
    const edges = mesh.geometry.userData.edgeGeometries ??= new Map();
    if (!edges.has(threshold)) edges.set(threshold, new THREE.EdgesGeometry(mesh.geometry, threshold));
    const lines = new THREE.LineSegments(edges.get(threshold), this.edgeMaterial);
    lines.raycast = () => {};
    mesh.add(lines);
    return lines;
  }

  _makeCanvasTex(w, h, drawFn, repeat = false) {
    // 使用 2x 超采样 (512×512) 矢量渲染 + 8x 各向异性过滤，确保近距离观察路面与边墙依然锐利清晰
    const scale = 2;
    const c = document.createElement("canvas");
    c.width = w * scale;
    c.height = h * scale;
    const ctx = c.getContext("2d");
    ctx.scale(scale, scale);
    drawFn(ctx, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    if (repeat) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    }
    return tex;
  }

  _halftone(ctx, x, y, w, h, color = "rgba(12,12,18,0.22)", step = 12, radius = 3) {
    ctx.save();
    ctx.fillStyle = color;
    for (let yy = y; yy < y + h; yy += step) {
      const off = ((yy / step) % 2) * (step / 2);
      for (let xx = x + off; xx < x + w; xx += step) {
        ctx.beginPath();
        ctx.arc(xx, yy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _hatch(ctx, x, y, w, h, color = "rgba(14,14,20,0.4)", spacing = 12) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    for (let i = -h; i < w + h; i += spacing) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i - h, y + h);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawBrick(ctx, s) {
    ctx.fillStyle = "#c94136";
    ctx.fillRect(0, 0, s, s);
    const rows = 4;
    const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (s / 4);
      for (let col = -1; col < 3; col++) {
        const bx = col * (s / 2) + off;
        const by = r * rh;
        ctx.fillStyle = (r + col) % 2 === 0 ? "#df523e" : "#bd362c";
        ctx.fillRect(bx + 4, by + 4, s / 2 - 8, rh - 8);
        ctx.fillStyle = "#ff8566";
        ctx.fillRect(bx + 8, by + 8, s / 2 - 18, 8);
        ctx.strokeStyle = "#101016";
        ctx.lineWidth = 6;
        ctx.strokeRect(bx, by, s / 2, rh);
      }
    }
    this._halftone(ctx, 0, s * 0.55, s, s * 0.45, "rgba(10,10,18,0.24)", 12, 3);
    this._hatch(ctx, 0, s * 0.78, s, s * 0.22, "rgba(10,10,18,0.45)", 11);
  }

  _drawNeonStore(ctx, s) {
    ctx.fillStyle = "#26365c";
    ctx.fillRect(0, 0, s, s);
    this._halftone(ctx, 0, 0, s, s, "rgba(0,229,255,0.16)", 14, 3.2);

    ctx.fillStyle = "#ffe01b";
    ctx.fillRect(28, 36, 200, 124);
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(40, 48, 176, 100);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.moveTo(56, 148);
    ctx.lineTo(106, 48);
    ctx.lineTo(132, 48);
    ctx.lineTo(82, 148);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 8;
    ctx.strokeRect(28, 36, 200, 124);
    ctx.strokeRect(4, 4, s - 8, s - 8);

    ctx.fillStyle = "#ff2a44";
    ctx.fillRect(0, 198, s, 58);
    ctx.strokeRect(0, 198, s, 58);
  }

  _drawHazardSteel(ctx, s) {
    ctx.fillStyle = "#6c7b8b";
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = "#8a9bac";
    ctx.fillRect(14, 14, s - 28, 166);
    this._halftone(ctx, 14, 96, s - 28, 84, "rgba(12,12,18,0.22)", 12, 3);

    ctx.fillStyle = "#111";
    [28, s - 28].forEach((rx) => {
      [28, 162].forEach((ry) => {
        ctx.beginPath();
        ctx.arc(rx, ry, 7, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 190, s, 66);
    ctx.clip();
    ctx.fillStyle = "#ffe01b";
    ctx.fillRect(0, 190, s, 66);
    ctx.fillStyle = "#101016";
    for (let x = -64; x < s + 64; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 190);
      ctx.lineTo(x + 24, 190);
      ctx.lineTo(x - 10, s);
      ctx.lineTo(x - 34, s);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, s - 8, s - 8);
    ctx.beginPath();
    ctx.moveTo(0, 190);
    ctx.lineTo(s, 190);
    ctx.stroke();
  }

  _drawWantedPoster(ctx, s) {
    this._drawBrick(ctx, s);
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate(-0.05);
    ctx.fillStyle = "#fff5d6";
    ctx.fillRect(-74, -92, 148, 184);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 7;
    ctx.strokeRect(-74, -92, 148, 184);

    ctx.fillStyle = "#ff2a44";
    ctx.fillRect(-62, -80, 124, 30);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("WANTED!", 0, -57);

    ctx.fillStyle = "#5b2c83";
    ctx.fillRect(-52, -38, 104, 84);
    ctx.fillStyle = "#00ff99";
    ctx.beginPath();
    ctx.arc(-18, -2, 13, 0, Math.PI * 2);
    ctx.arc(18, -2, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 5;
    ctx.strokeRect(-52, -38, 104, 84);

    ctx.fillStyle = "#101016";
    ctx.font = "bold 20px Impact, sans-serif";
    ctx.fillText("DR. HALFTONE", 0, 74);
    ctx.restore();
  }

  _drawVillainLab(ctx, s) {
    ctx.fillStyle = "#3b1b61";
    ctx.fillRect(0, 0, s, s);
    this._halftone(ctx, 0, 0, s, s, "rgba(255,46,189,0.22)", 14, 3.6);

    [46, 162].forEach((x) => {
      ctx.fillStyle = "#101016";
      ctx.fillRect(x, 22, 48, 212);
      ctx.fillStyle = "#00ffaa";
      ctx.fillRect(x + 8, 30, 32, 196);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + 14, 38, 8, 180);
    });
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, s - 8, s - 8);
  }

  _drawCrate(ctx, s) {
    ctx.fillStyle = "#d98c2b";
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 9;
    ctx.strokeRect(6, 6, s - 12, s - 12);
    ctx.beginPath();
    ctx.moveTo(6, 6);
    ctx.lineTo(s - 6, s - 6);
    ctx.moveTo(s - 6, 6);
    ctx.lineTo(6, s - 6);
    ctx.stroke();

    ctx.fillStyle = "#f5b041";
    ctx.fillRect(42, 42, s - 84, s - 84);
    ctx.strokeRect(42, 42, s - 84, s - 84);
    this._hatch(ctx, 46, 134, s - 92, 76, "rgba(14,14,20,0.35)", 12);
  }

  _drawFloorAsphalt(ctx, s) {
    // 高清美漫柏油碎石路面底纹（无零散断线黄斑，标线由连通道路几何体独立绘制）
    ctx.fillStyle = "#232532";
    ctx.fillRect(0, 0, s, s);
    this._halftone(ctx, 0, 0, s, s, "rgba(10,10,16,0.22)", 16, 2.5);

    // 细微沥青骨料颗粒与漫风裂缝纹理
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    for (let i = 0; i < 36; i++) {
      const rx = ((i * 53) % (s - 12)) + 4;
      const ry = ((i * 97) % (s - 12)) + 4;
      ctx.fillRect(rx, ry, 5, 5);
    }
    ctx.strokeStyle = "rgba(12,13,20,0.4)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(42, 28);
    ctx.lineTo(54, 68);
    ctx.lineTo(36, 128);
    ctx.stroke();
  }

  _drawFloorStreetBlock(ctx, s) {
    this._drawFloorAsphalt(ctx, s);
  }

  _drawSidewalkTile(ctx, s) {
    // 高清美漫水泥人行道步砖（2×2 大方砖 + 倒角高光 + 粗黑墨线接缝 + 路沿石质感）
    ctx.fillStyle = "#8a92a8";
    ctx.fillRect(0, 0, s, s);
    this._halftone(ctx, 0, 0, s, s, "rgba(16,18,28,0.16)", 16, 2.2);

    const half = s / 2;
    for (let gz = 0; gz < 2; gz++) {
      for (let gx = 0; gx < 2; gx++) {
        const x0 = gx * half;
        const y0 = gz * half;
        ctx.fillStyle = (gx + gz) % 2 === 0 ? "#959db4" : "#868ea4";
        ctx.fillRect(x0 + 6, y0 + 6, half - 12, half - 12);
        // 漫画高光边
        ctx.fillStyle = "rgba(255,255,255,0.32)";
        ctx.fillRect(x0 + 8, y0 + 8, half - 20, 6);
        ctx.fillRect(x0 + 8, y0 + 8, 6, half - 20);
        // 墨线砖缝
        ctx.strokeStyle = "#181a24";
        ctx.lineWidth = 5;
        ctx.strokeRect(x0 + 3, y0 + 3, half - 6, half - 6);
      }
    }
  }

  _drawComicShop(ctx, s) {
    // 美式漫画街角商店 / 复古快餐店外墙（红黄遮阳篷 + COMICS! 招牌 + 橱窗海报）
    ctx.fillStyle = "#1d2747";
    ctx.fillRect(0, 0, s, s);
    this._halftone(ctx, 0, 0, s, s, "rgba(255,224,27,0.12)", 14, 3);

    // 顶部招牌灯箱
    ctx.fillStyle = "#ffe01b";
    ctx.fillRect(16, 14, s - 32, 46);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 7;
    ctx.strokeRect(16, 14, s - 32, 46);
    ctx.fillStyle = "#ff2a44";
    ctx.font = "900 30px Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("COMICS & DINER", s / 2, 48);

    // 红白条纹漫画遮阳篷
    const stripes = 8;
    const sw = (s - 24) / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#ff2a44" : "#fff5d6";
      ctx.fillRect(12 + i * sw, 68, sw, 34);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 5;
      ctx.strokeRect(12 + i * sw, 68, sw, 34);
    }

    // 亮青色大橱窗 + 漫画海报陈列
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(22, 112, s - 44, 104);
    ctx.fillStyle = "#ff2ebd";
    ctx.fillRect(36, 128, 52, 72);
    ctx.fillStyle = "#ffe01b";
    ctx.fillRect(102, 128, 52, 72);
    ctx.fillStyle = "#38e54d";
    ctx.fillRect(168, 128, 52, 72);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 6;
    ctx.strokeRect(36, 128, 52, 72);
    ctx.strokeRect(102, 128, 52, 72);
    ctx.strokeRect(168, 128, 52, 72);
    ctx.strokeRect(22, 112, s - 44, 104);

    // 底部踢脚墙
    ctx.fillStyle = "#c94136";
    ctx.fillRect(0, 222, s, 34);
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, s - 8, s - 8);
  }

  _drawApartmentFacade(ctx, s) {
    // 纽约/美漫街区装饰艺术公寓楼立面（暖黄褐砖墙 + 双联漫画窗 + 防火梯剪影）
    ctx.fillStyle = "#d4882a";
    ctx.fillRect(0, 0, s, s);
    this._halftone(ctx, 0, s * 0.45, s, s * 0.55, "rgba(14,14,20,0.22)", 12, 3);

    // 横向石材腰线
    ctx.fillStyle = "#f7b733";
    ctx.fillRect(0, 16, s, 18);
    ctx.fillRect(0, 124, s, 14);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 16, s, 18);
    ctx.strokeRect(0, 124, s, 14);

    // 4 扇漫画高对比公寓窗户
    const winPositions = [
      [28, 44], [144, 44],
      [28, 148], [144, 148],
    ];
    winPositions.forEach(([wx, wy], idx) => {
      ctx.fillStyle = idx % 2 === 0 ? "#ffe01b" : "#00e5ff";
      ctx.fillRect(wx, wy, 84, 68);
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillRect(wx + 8, wy + 8, 22, 52);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 7;
      ctx.strokeRect(wx, wy, 84, 68);
      // 十字窗框
      ctx.beginPath();
      ctx.moveTo(wx + 42, wy);
      ctx.lineTo(wx + 42, wy + 68);
      ctx.moveTo(wx, wy + 34);
      ctx.lineTo(wx + 84, wy + 34);
      ctx.stroke();
    });

    // 黑色铸铁防火梯斜线剪影
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(22, 114);
    ctx.lineTo(234, 114);
    ctx.moveTo(64, 114);
    ctx.lineTo(188, 228);
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, s - 8, s - 8);
  }

  _drawStreetGraffiti(ctx, s) {
    // 街头波普涂鸦红砖墙（INK CITY! 爆炸星标涂鸦）
    this._drawBrick(ctx, s);

    // 漫画爆炸底纹
    ctx.save();
    ctx.translate(s / 2, s / 2 + 6);
    ctx.fillStyle = "#00e5ff";
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 7;
    ctx.beginPath();
    const pts = 12;
    for (let i = 0; i < pts * 2; i++) {
      const a = (i / (pts * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? 104 : 66;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * (r * 0.78);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 波普字样
    ctx.rotate(-0.08);
    ctx.font = "900 40px Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 9;
    ctx.strokeStyle = "#101016";
    ctx.strokeText("INK CITY!", 0, -10);
    ctx.fillStyle = "#ffe01b";
    ctx.fillText("INK CITY!", 0, -10);

    ctx.font = "900 26px Impact, sans-serif";
    ctx.strokeText("BLOCK WAR", 0, 26);
    ctx.fillStyle = "#ff2ebd";
    ctx.fillText("BLOCK WAR", 0, 26);
    ctx.restore();
  }

  _drawViaductWall(ctx, s) {
    // 城市街区高清边墙 / 市政护栏墙（按每 4m 单元平铺：混凝土壁柱 + 浮雕嵌板 + 顶部铸铁栏杆 + 警示路沿）
    ctx.fillStyle = "#5c647a";
    ctx.fillRect(0, 0, s, s);
    this._halftone(ctx, 0, 72, s, s - 72, "rgba(10,12,20,0.22)", 12, 2.5);

    // 顶部深色铁艺栏杆带与城市天际透光格
    ctx.fillStyle = "#1e2230";
    ctx.fillRect(0, 0, s, 68);
    for (let x = 14; x < s - 14; x += 32) {
      ctx.fillStyle = "#384158";
      ctx.fillRect(x, 12, 18, 44);
      ctx.fillStyle = "#76829e";
      ctx.fillRect(x + 3, 15, 5, 38);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 4;
      ctx.strokeRect(x, 12, 18, 44);
    }

    // 中部市政石材壁柱与内凹浮雕墙板
    ctx.fillStyle = "#747d96";
    ctx.fillRect(18, 82, s - 36, 114);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(24, 88, s - 48, 10);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 6;
    ctx.strokeRect(18, 82, s - 36, 114);

    // 底部黄黑高对比市政防撞腰线
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 208, s, 44);
    ctx.clip();
    ctx.fillStyle = "#ffe01b";
    ctx.fillRect(0, 208, s, 44);
    ctx.fillStyle = "#101016";
    for (let x = -32; x < s + 32; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, 208);
      ctx.lineTo(x + 18, 208);
      ctx.lineTo(x - 6, 252);
      ctx.lineTo(x - 24, 252);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 7;
    ctx.strokeRect(3, 3, s - 6, s - 6);
    ctx.beginPath();
    ctx.moveTo(0, 68);
    ctx.lineTo(s, 68);
    ctx.moveTo(0, 208);
    ctx.lineTo(s, 208);
    ctx.stroke();
  }

  _drawChinatownFacade(ctx, s) {
    // ISSUE #2 落日唐人街专属立面：朱红漆墙 + 鎏金雕花窗格 + 翡翠绿飞檐腰线 + 霓虹牌匾
    ctx.fillStyle = "#9e1b24";
    ctx.fillRect(0, 0, s, s);
    this._halftone(ctx, 0, 0, s, s, "rgba(20,6,10,0.26)", 12, 2.8);

    // 翡翠绿与金黄琉璃檐口带
    ctx.fillStyle = "#00a86b";
    ctx.fillRect(0, 10, s, 22);
    ctx.fillStyle = "#ffe01b";
    ctx.fillRect(0, 32, s, 10);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 10, s, 22);
    ctx.strokeRect(0, 32, s, 10);

    // 顶部霓虹金匾
    ctx.fillStyle = "#16121e";
    ctx.fillRect(26, 52, s - 52, 46);
    ctx.strokeStyle = "#ffe01b";
    ctx.lineWidth = 6;
    ctx.strokeRect(26, 52, s - 52, 46);
    ctx.fillStyle = "#ffdf2b";
    ctx.font = "900 28px Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("DRAGON ARCADE", s / 2, 85);

    // 左右两扇中式鎏金花格亮窗
    [24, 140].forEach((wx) => {
      ctx.fillStyle = "#ffae19";
      ctx.fillRect(wx, 114, 92, 110);
      ctx.fillStyle = "#fff3c4";
      ctx.fillRect(wx + 10, 124, 30, 88);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 6;
      ctx.strokeRect(wx, 114, 92, 110);
      ctx.strokeRect(wx + 14, 128, 64, 82);
      ctx.beginPath();
      ctx.moveTo(wx + 46, 114);
      ctx.lineTo(wx + 46, 224);
      ctx.moveTo(wx, 169);
      ctx.lineTo(wx + 92, 169);
      ctx.stroke();
    });

    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, s - 8, s - 8);
  }

  _drawHarborContainerFacade(ctx, s) {
    // ISSUE #4 布鲁克林海港专属立面：深海蓝/锈橙波纹集装箱钢板与港口货运卷帘门
    ctx.fillStyle = "#1f4e78";
    ctx.fillRect(0, 0, s, s);

    // 竖向集装箱波纹压槽
    for (let x = 16; x < s - 12; x += 24) {
      ctx.fillStyle = (x / 24) % 2 === 0 ? "#2a6496" : "#173c5e";
      ctx.fillRect(x, 16, 16, s - 32);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, 16, 16, s - 32);
    }
    this._halftone(ctx, 0, 120, s, 136, "rgba(10,12,18,0.28)", 12, 2.8);

    // 货运钢印编号牌
    ctx.fillStyle = "#ff7a00";
    ctx.fillRect(24, 34, s - 48, 56);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 6;
    ctx.strokeRect(24, 34, s - 48, 56);
    ctx.fillStyle = "#101016";
    ctx.font = "900 30px Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("HARBOR PIER 44", s / 2, 73);

    // 下部钢制货运卷帘门
    ctx.fillStyle = "#5c6778";
    ctx.fillRect(32, 112, s - 64, 136);
    ctx.strokeRect(32, 112, s - 64, 136);
    for (let y = 128; y < 244; y += 18) {
      ctx.beginPath();
      ctx.moveTo(32, y);
      ctx.lineTo(s - 32, y);
      ctx.stroke();
    }

    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, s - 8, s - 8);
  }

  _drawMarbleBankFacade(ctx, s) {
    // ISSUE #6 大都会金融广场专属立面：古典象牙白大理石柱廊 + 黄金装饰艺术腰线 + 拱形高窗
    ctx.fillStyle = "#e8e2d5";
    ctx.fillRect(0, 0, s, s);
    this._halftone(ctx, 0, 130, s, 126, "rgba(30,28,42,0.14)", 14, 2.4);

    // 黄金 Art-Deco 浮雕横梁
    ctx.fillStyle = "#d4af37";
    ctx.fillRect(0, 14, s, 24);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 14, s, 24);

    // 两侧古典凹槽大理石壁柱
    [12, s - 44].forEach((px) => {
      ctx.fillStyle = "#f7f4ec";
      ctx.fillRect(px, 38, 32, s - 46);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 5;
      ctx.strokeRect(px, 38, 32, s - 46);
    });

    // 中央深青色金融大厦高窗与金色窗格
    ctx.fillStyle = "#142a46";
    ctx.fillRect(58, 54, s - 116, 178);
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(68, 64, s - 136, 158);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(76, 72, 26, 142);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 7;
    ctx.strokeRect(58, 54, s - 116, 178);
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(s / 2, 54);
    ctx.lineTo(s / 2, 232);
    ctx.moveTo(58, 142);
    ctx.lineTo(s - 58, 142);
    ctx.stroke();

    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, s - 8, s - 8);
  }

  // 根据关卡地图网格一次性烘焙整张街区「柏油马路 + 双黄中心线 + 斑马线 + 水泥人行道」高清贴图（仅 1 次 Draw Call！）
  createStreetNetworkTexture(map, mapW, mapH) {
    const cs = 64; // 每格 64×64 像素
    const c = document.createElement("canvas");
    c.width = mapW * cs;
    c.height = mapH * cs;
    const ctx = c.getContext("2d");

    const isBuilding = (gx, gz) => {
      if (gx <= 0 || gz <= 0 || gx >= mapW - 1 || gz >= mapH - 1) return false;
      const v = map[gz]?.[gx] || 0;
      return v > 0 && v !== 6 && v !== 10;
    };

    const isSidewalk = (gx, gz) => {
      if (gx < 0 || gz < 0 || gx >= mapW || gz >= mapH) return false;
      const v = map[gz][gx];
      if (v > 0 && v !== 6 && v !== 10) return false;
      // 紧贴外围护栏或紧贴街区建筑物四周的一圈为水泥人行道
      if (gx === 1 || gz === 1 || gx === mapW - 2 || gz === mapH - 2) return true;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (isBuilding(gx + dx, gz + dz)) return true;
        }
      }
      return false;
    };

    // 1. 铺设深灰黑柏油马路底色
    ctx.fillStyle = "#222430";
    ctx.fillRect(0, 0, c.width, c.height);
    this._halftone(ctx, 0, 0, c.width, c.height, "rgba(0,0,0,0.28)", 16, 2.4);

    // 2. 绘制每个格子的路面 / 水泥人行道与路沿石
    for (let z = 0; z < mapH; z++) {
      for (let x = 0; x < mapW; x++) {
        const px = x * cs;
        const py = z * cs;

        if (isSidewalk(x, z)) {
          // 浅灰暖色水泥人行道砖面
          ctx.fillStyle = "#7a8094";
          ctx.fillRect(px, py, cs, cs);
          ctx.fillStyle = "#8a90a6";
          ctx.fillRect(px + 4, py + 4, cs - 8, cs - 8);

          // 人行道十字方砖接缝
          ctx.strokeStyle = "#484c5c";
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 1, py + 1, cs - 2, cs - 2);
          ctx.beginPath();
          ctx.moveTo(px + cs / 2, py);
          ctx.lineTo(px + cs / 2, py + cs);
          ctx.moveTo(px, py + cs / 2);
          ctx.lineTo(px + cs, py + cs / 2);
          ctx.stroke();

          // 朝向柏油马路一侧绘制粗黑墨线 + 灰白路沿石（马路牙子）
          ctx.fillStyle = "#b8bfd4";
          ctx.strokeStyle = "#101016";
          ctx.lineWidth = 4;
          if (!isSidewalk(x, z - 1) && !isBuilding(x, z - 1)) {
            ctx.fillRect(px, py, cs, 8);
            ctx.strokeRect(px, py, cs, 8);
          }
          if (!isSidewalk(x, z + 1) && !isBuilding(x, z + 1)) {
            ctx.fillRect(px, py + cs - 8, cs, 8);
            ctx.strokeRect(px, py + cs - 8, cs, 8);
          }
          if (!isSidewalk(x - 1, z) && !isBuilding(x - 1, z)) {
            ctx.fillRect(px, py, 8, cs);
            ctx.strokeRect(px, py, 8, cs);
          }
          if (!isSidewalk(x + 1, z) && !isBuilding(x + 1, z)) {
            ctx.fillRect(px + cs - 8, py, 8, cs);
            ctx.strokeRect(px + cs - 8, py, 8, cs);
          }
        } else {
          // 柏油马路微接缝
          ctx.strokeStyle = "rgba(14,14,22,0.55)";
          ctx.lineWidth = 2;
          ctx.strokeRect(px, py, cs, cs);
        }
      }
    }

    // 3. 识别主干道与横向马路，自动绘制双黄中心线、车道虚线与十字路口斑马线
    // 统计每行/每列的纯马路宽度以找出东西向大道与南北向街道中心
    const roadRows = [];
    for (let z = 2; z < mapH - 2; z++) {
      let roadCount = 0;
      for (let x = 2; x < mapW - 2; x++) {
        if (!isSidewalk(x, z) && !isBuilding(x, z)) roadCount++;
      }
      if (roadCount >= Math.floor(mapW * 0.45)) roadRows.push(z);
    }

    const roadCols = [];
    for (let x = 2; x < mapW - 2; x++) {
      let roadCount = 0;
      for (let z = 2; z < mapH - 2; z++) {
        if (!isSidewalk(x, z) && !isBuilding(x, z)) roadCount++;
      }
      if (roadCount >= Math.floor(mapH * 0.42)) roadCols.push(x);
    }

    const rowSet = new Set(roadRows);
    const colSet = new Set(roadCols);

    // 将连续的马路行/列分组为独立街道走廊
    const groupContiguous = (arr) => {
      const groups = [];
      for (const v of arr) {
        if (!groups.length || v !== groups[groups.length - 1][groups[groups.length - 1].length - 1] + 1) {
          groups.push([v]);
        } else {
          groups[groups.length - 1].push(v);
        }
      }
      return groups;
    };

    const hRoadGroups = groupContiguous(roadRows);
    const vRoadGroups = groupContiguous(roadCols);

    // 绘制东西向马路的双黄中心线、车道白虚线与路口斑马线
    for (const grp of hRoadGroups) {
      const midZ = ((grp[0] + grp[grp.length - 1] + 1) / 2) * cs;
      for (let x = 2; x < mapW - 2; x++) {
        if (isSidewalk(x, grp[0]) || isBuilding(x, grp[0])) continue;
        const px = x * cs;
        const inIntersection = colSet.has(x);
        const prevInIntersection = colSet.has(x - 1);
        const nextInIntersection = colSet.has(x + 1);

        if (!inIntersection) {
          // 双黄马路中心线
          ctx.fillStyle = "#ffe01b";
          ctx.fillRect(px + 6, midZ - 6, cs - 12, 4);
          ctx.fillRect(px + 6, midZ + 2, cs - 12, 4);

          // 宽阔主干道两侧的车道白色分界虚线
          if (grp.length >= 3) {
            ctx.fillStyle = "rgba(255,255,255,0.72)";
            ctx.fillRect(px + 14, grp[0] * cs + cs - 3, cs - 28, 3);
            ctx.fillRect(px + 14, grp[grp.length - 1] * cs, cs - 28, 3);
          }

          // 靠近十字路口入口处绘制醒目的白色人行横道斑马线
          if (nextInIntersection || prevInIntersection) {
            const topY = grp[0] * cs + 8;
            const botY = (grp[grp.length - 1] + 1) * cs - 8;
            ctx.fillStyle = "#f2f5ff";
            ctx.strokeStyle = "#101016";
            ctx.lineWidth = 2;
            for (let yy = topY + 4; yy < botY - 8; yy += 14) {
              ctx.fillRect(px + 10, yy, cs - 20, 8);
              ctx.strokeRect(px + 10, yy, cs - 20, 8);
            }
          }
        }
      }
    }

    // 绘制南北向马路的双黄中心线与路口斑马线
    for (const grp of vRoadGroups) {
      const midX = ((grp[0] + grp[grp.length - 1] + 1) / 2) * cs;
      for (let z = 2; z < mapH - 2; z++) {
        if (isSidewalk(grp[0], z) || isBuilding(grp[0], z)) continue;
        const py = z * cs;
        const inIntersection = rowSet.has(z);
        const prevInIntersection = rowSet.has(z - 1);
        const nextInIntersection = rowSet.has(z + 1);

        if (!inIntersection) {
          ctx.fillStyle = "#ffe01b";
          ctx.fillRect(midX - 6, py + 6, 4, cs - 12);
          ctx.fillRect(midX + 2, py + 6, 4, cs - 12);

          if (nextInIntersection || prevInIntersection) {
            const leftX = grp[0] * cs + 8;
            const rightX = (grp[grp.length - 1] + 1) * cs - 8;
            ctx.fillStyle = "#f2f5ff";
            ctx.strokeStyle = "#101016";
            ctx.lineWidth = 2;
            for (let xx = leftX + 4; xx < rightX - 8; xx += 14) {
              ctx.fillRect(xx, py + 10, 8, cs - 20);
              ctx.strokeRect(xx, py + 10, 8, cs - 20);
            }
          }
        } else {
          // 十字路口中心绘制漫画圆形金属井盖
          ctx.save();
          ctx.fillStyle = "#3a3f52";
          ctx.strokeStyle = "#101016";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(midX, py + cs / 2, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  _drawFloorFactory(ctx, s) {
    ctx.fillStyle = "#39424e";
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "#141820";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, s - 6, s - 6);
    ctx.strokeRect(3, 3, s / 2 - 3, s / 2 - 3);
    ctx.strokeRect(s / 2, s / 2, s / 2 - 3, s / 2 - 3);
    this._halftone(ctx, 0, 0, s, s, "rgba(0,229,255,0.08)", 14, 2.2);
  }

  _drawFloorLab(ctx, s) {
    ctx.fillStyle = "#25173d";
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "#ff2ebd";
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, s - 12, s - 12);
    this._halftone(ctx, 12, 12, s - 24, s - 24, "rgba(0,255,170,0.14)", 16, 3);
  }

  _drawBarrel(ctx, s) {
    ctx.fillStyle = "#ff2a44";
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = "#1e1e28";
    ctx.fillRect(0, 32, s, 22);
    ctx.fillRect(0, 200, s, 22);
    ctx.fillStyle = "#ffe01b";
    ctx.fillRect(0, 90, s, 74);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 8;
    ctx.strokeRect(0, 90, s, 74);
    ctx.fillStyle = "#101016";
    ctx.font = "bold 48px Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TNT", s * 0.25, 144);
    ctx.fillText("TNT", s * 0.75, 144);
  }

  // 绘制左下角主角漫画头像（动态表情）
  drawPortrait(ctx, hp, hurtTimer, fireTimer) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = hurtTimer > 0 ? "#ff2a44" : "#00e5ff";
    ctx.fillRect(0, 0, w, h);
    this._halftone(ctx, 0, 0, w, h, "rgba(0,0,0,0.16)", 6, 1.5);

    ctx.strokeStyle = "#101014";
    ctx.lineWidth = 3;

    ctx.fillStyle = "#222";
    ctx.fillRect(16, 48, 32, 18);
    ctx.strokeRect(16, 48, 32, 18);

    ctx.fillStyle = "#ffd3b6";
    ctx.beginPath();
    ctx.arc(32, 32, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#14141c";
    ctx.beginPath();
    ctx.moveTo(13, 28);
    ctx.lineTo(17, 10);
    ctx.lineTo(30, 14);
    ctx.lineTo(42, 8);
    ctx.lineTo(52, 26);
    ctx.lineTo(45, 22);
    ctx.lineTo(20, 22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (hurtTimer > 0) {
      ctx.beginPath();
      ctx.moveTo(20, 27); ctx.lineTo(28, 33);
      ctx.moveTo(28, 27); ctx.lineTo(20, 33);
      ctx.moveTo(36, 27); ctx.lineTo(44, 33);
      ctx.moveTo(44, 27); ctx.lineTo(36, 33);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#101014";
      ctx.fillRect(17, 25, 13, 7);
      ctx.fillRect(34, 25, 13, 7);
      ctx.fillStyle = "#fff";
      ctx.fillRect(19, 27, 4, 2);
      ctx.fillRect(36, 27, 4, 2);
    }

    ctx.beginPath();
    if (hurtTimer > 0) {
      ctx.fillStyle = "#ff2a44";
      ctx.arc(32, 42, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (fireTimer > 0) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(24, 39, 16, 6);
      ctx.strokeRect(24, 39, 16, 6);
    } else if (hp < 35) {
      ctx.moveTo(24, 43);
      ctx.quadraticCurveTo(32, 38, 40, 43);
      ctx.stroke();
    } else {
      ctx.moveTo(24, 41);
      ctx.lineTo(39, 39);
      ctx.stroke();
    }
  }
}
