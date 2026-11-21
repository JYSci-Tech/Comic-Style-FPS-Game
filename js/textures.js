import * as THREE from "three";

// Crisp negative mip bias (-0.25) + 16x anisotropy keeps 1024×1024 building ink linework razor-sharp up close and at oblique angles.
const filteredMap = THREE.ShaderChunk.map_fragment.replace("texture2D( map, vMapUv )", "texture2D( map, vMapUv, -0.25 )");
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
      nightMarket: this._makeCanvasTex(256, 256, (ctx) => this._drawNightMarketFacade(ctx, 256), true),
      oldQuarter: this._makeCanvasTex(256, 256, (ctx) => this._drawOldQuarterFacade(ctx, 256), true),
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
      14: this.toonMat({ map: this.textures.nightMarket }),
      15: this.toonMat({ map: this.textures.oldQuarter }),
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

  _makeCanvasTex(w, h, drawFn, repeat = false, supersample = 4) {
    // 4x 超采样 (1024×1024) 矢量渲染 + 16x 各向异性过滤，近距离紧贴建筑墙面也清晰锐利
    const c = document.createElement("canvas");
    c.width = w * supersample;
    c.height = h * supersample;
    const ctx = c.getContext("2d");
    ctx.scale(supersample, supersample);
    drawFn(ctx, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 16;
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
    // 12 层写实比例错缝红砖墙（带灰缝凹槽、砖面色差、高光倒角与精致网点排线）
    ctx.fillStyle = "#5c2420";
    ctx.fillRect(0, 0, s, s);
    const rows = 12;
    const cols = 6;
    const rh = s / rows;
    const bw = s / cols;
    const palette = ["#d44838", "#c43a2e", "#e05a44", "#b53328", "#cf4436"];
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (bw * 0.5);
      for (let col = -1; col <= cols; col++) {
        const bx = col * bw + off;
        const by = r * rh;
        const seed = Math.abs(r * 17 + col * 31);
        ctx.fillStyle = palette[seed % palette.length];
        ctx.fillRect(bx + 1.8, by + 1.8, bw - 3.6, rh - 3.6);
        // 砖块上沿高光与下沿暗面
        ctx.fillStyle = "rgba(255,190,155,0.28)";
        ctx.fillRect(bx + 2.5, by + 2.5, bw - 5.5, 2.4);
        ctx.fillStyle = "rgba(18,10,14,0.24)";
        ctx.fillRect(bx + 2.5, by + rh - 4.2, bw - 5.0, 2.0);
        // 细锐墨线勾边
        ctx.strokeStyle = "#161218";
        ctx.lineWidth = 1.6;
        ctx.strokeRect(bx + 0.8, by + 0.8, bw - 1.6, rh - 1.6);
      }
    }
    this._halftone(ctx, 0, s * 0.62, s, s * 0.38, "rgba(10,10,18,0.2)", 8, 1.8);
    this._hatch(ctx, 0, s * 0.82, s, s * 0.18, "rgba(10,10,18,0.38)", 9);
  }

  _drawNeonStore(ctx, s) {
    // 现代霓虹玻璃幕墙摩天楼（4×3 精密金属竖挺玻璃网格 + 室内百叶剪影 + 对角天空倒影 + 霓虹腰线）
    ctx.fillStyle = "#182440";
    ctx.fillRect(0, 0, s, s);
    this._halftone(ctx, 0, 0, s, s, "rgba(0,229,255,0.1)", 10, 1.8);

    const cols = 4;
    const rows = 3;
    const padX = 12;
    const padY = 14;
    const gap = 8;
    const winW = (s - padX * 2 - gap * (cols - 1)) / cols;
    const winH = (186 - padY - gap * (rows - 1)) / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = padX + c * (winW + gap);
        const wy = padY + r * (winH + gap);
        const lit = (r * 5 + c * 3) % 3 !== 0;
        ctx.fillStyle = lit ? ((r + c) % 2 === 0 ? "#00d8f5" : "#44ebff") : "#233c63";
        ctx.fillRect(wx, wy, winW, winH);

        // 玻璃内部百叶横纹与室内剪影
        ctx.fillStyle = lit ? "rgba(14,32,62,0.18)" : "rgba(8,14,28,0.35)";
        for (let by = wy + 6; by < wy + winH * 0.55; by += 6) {
          ctx.fillRect(wx + 2, by, winW - 4, 2);
        }
        // 锐利斜向天空高光反光条
        ctx.fillStyle = "rgba(255,255,255,0.48)";
        ctx.beginPath();
        ctx.moveTo(wx + 4, wy + winH - 2);
        ctx.lineTo(wx + winW * 0.45, wy + 2);
        ctx.lineTo(wx + winW * 0.65, wy + 2);
        ctx.lineTo(wx + winW * 0.2, wy + winH - 2);
        ctx.closePath();
        ctx.fill();

        // 窗框铝挺与墨线
        ctx.strokeStyle = "#101016";
        ctx.lineWidth = 3.2;
        ctx.strokeRect(wx, wy, winW, winH);
        ctx.strokeStyle = "#7a94bd";
        ctx.lineWidth = 1.4;
        ctx.strokeRect(wx + 2.5, wy + 2.5, winW - 5, winH - 5);
      }
    }

    // 下部金属裙墙与双色霓虹装饰光带
    ctx.fillStyle = "#263352";
    ctx.fillRect(0, 198, s, 58);
    ctx.fillStyle = "#ff2a44";
    ctx.fillRect(8, 206, s - 16, 16);
    ctx.fillStyle = "#ffe01b";
    ctx.fillRect(8, 226, s - 16, 8);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 206, s - 16, 16);
    ctx.strokeRect(0, 198, s, 58);
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, s - 5, s - 5);
  }

  _drawHazardSteel(ctx, s) {
    // 精密铆接工业钢板墙（双开护板 + 散热百叶栅格 + 高光铆钉 + 警示斜纹）
    ctx.fillStyle = "#5c6a7a";
    ctx.fillRect(0, 0, s, s);
    for (const px of [10, 132]) {
      ctx.fillStyle = "#7c8d9f";
      ctx.fillRect(px, 12, 114, 168);
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(px + 3, 15, 108, 6);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 3.5;
      ctx.strokeRect(px, 12, 114, 168);
      // 散热百叶孔
      for (let ly = 44; ly < 110; ly += 10) {
        ctx.fillStyle = "#252c38";
        ctx.fillRect(px + 18, ly, 78, 5);
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(px + 18, ly + 5, 78, 1.5);
      }
      // 四角精密铆钉
      for (const rx of [px + 10, px + 104]) {
        for (const ry of [24, 168]) {
          ctx.fillStyle = "#161a24";
          ctx.beginPath();
          ctx.arc(rx, ry, 4.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#c8d6e6";
          ctx.beginPath();
          ctx.arc(rx - 1, ry - 1, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    this._halftone(ctx, 10, 118, s - 20, 60, "rgba(12,12,18,0.2)", 9, 1.8);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 192, s, 64);
    ctx.clip();
    ctx.fillStyle = "#ffe01b";
    ctx.fillRect(0, 192, s, 64);
    ctx.fillStyle = "#101016";
    for (let x = -64; x < s + 64; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, 192);
      ctx.lineTo(x + 18, 192);
      ctx.lineTo(x - 14, s);
      ctx.lineTo(x - 32, s);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, s - 5, s - 5);
    ctx.beginPath();
    ctx.moveTo(0, 192);
    ctx.lineTo(s, 192);
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
    // 精细美式漫画街角商店 / 复古快餐店外墙（灯泡灯箱招牌 + 12道遮阳篷阴影 + 精绘橱窗漫画封面 + 瓷砖裙墙）
    ctx.fillStyle = "#1c2646";
    ctx.fillRect(0, 0, s, s);
    this._halftone(ctx, 0, 0, s, s, "rgba(255,224,27,0.1)", 10, 1.8);

    // 顶部复古灯泡灯箱招牌
    ctx.fillStyle = "#ffe01b";
    ctx.fillRect(14, 12, s - 28, 46);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 4.5;
    ctx.strokeRect(14, 12, s - 28, 46);
    for (let bx = 22; bx <= s - 22; bx += 14) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(bx, 18, 2.2, 0, Math.PI * 2);
      ctx.arc(bx, 52, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ff2a44";
    ctx.font = "900 26px Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("COMICS & DINER", s / 2, 44);

    // 12 道细条纹遮阳篷与底部投影
    const stripes = 12;
    const sw = (s - 20) / stripes;
    ctx.fillStyle = "rgba(10,10,18,0.4)";
    ctx.fillRect(10, 98, s - 20, 8);
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#ff2a44" : "#fff5d6";
      ctx.fillRect(10 + i * sw, 64, sw, 34);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 2.6;
      ctx.strokeRect(10 + i * sw, 64, sw, 34);
    }

    // 精致玻璃大橱窗 + 3 本带标题/爆炸星标的精绘漫画书封面陈列
    ctx.fillStyle = "#0e223a";
    ctx.fillRect(18, 106, s - 36, 108);
    ctx.fillStyle = "#00d8f5";
    ctx.fillRect(22, 110, s - 44, 100);
    const covers = [
      [34, "#ff2ebd", "#ffe01b", "ZAP!"],
      [102, "#ffe01b", "#ff2a44", "POW!"],
      [170, "#38e54d", "#1c2646", "INK!"],
    ];
    for (const [cx, bg, badge, txt] of covers) {
      ctx.fillStyle = bg;
      ctx.fillRect(cx, 122, 52, 74);
      ctx.fillStyle = badge;
      ctx.fillRect(cx + 4, 126, 44, 15);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(cx + 6, 146, 40, 32);
      ctx.fillStyle = "#101016";
      ctx.font = "900 12px Impact, sans-serif";
      ctx.fillText(txt, cx + 26, 167);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 3.2;
      ctx.strokeRect(cx, 122, 52, 74);
    }
    // 橱窗斜向玻璃反光
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.moveTo(26, 208);
    ctx.lineTo(74, 112);
    ctx.lineTo(94, 112);
    ctx.lineTo(46, 208);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 4.5;
    ctx.strokeRect(18, 106, s - 36, 108);

    // 底部釉面小方砖踢脚墙
    ctx.fillStyle = "#b8362c";
    ctx.fillRect(0, 220, s, 36);
    ctx.strokeStyle = "rgba(16,16,22,0.55)";
    ctx.lineWidth = 1.6;
    for (let tx = 0; tx < s; tx += 16) {
      ctx.strokeRect(tx, 220, 16, 18);
      ctx.strokeRect(tx, 238, 16, 18);
    }
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, s - 5, s - 5);
  }

  _drawApartmentFacade(ctx, s) {
    // 纽约褐石公寓楼高精细立面（错缝石块砌体 + 窗楣石托 + 六格推拉窗与百叶窗 + 铸铁护栏细节）
    ctx.fillStyle = "#bd7422";
    ctx.fillRect(0, 0, s, s);
    // 细腻褐石砖块砌缝
    const rows = 10;
    const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 24;
      for (let x = -24; x < s + 24; x += 48) {
        ctx.fillStyle = (r + Math.floor(x / 48)) % 2 === 0 ? "#cf822b" : "#c07522";
        ctx.fillRect(x + off + 1.5, r * rh + 1.5, 45, rh - 3);
        ctx.strokeStyle = "rgba(24,16,10,0.45)";
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x + off, r * rh, 48, rh);
      }
    }
    this._halftone(ctx, 0, s * 0.55, s, s * 0.45, "rgba(14,14,20,0.16)", 9, 1.8);

    // 雕花石材腰线
    for (const ly of [14, 124]) {
      ctx.fillStyle = "#f2ba49";
      ctx.fillRect(0, ly, s, 14);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(0, ly + 2, s, 3);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 3.5;
      ctx.strokeRect(0, ly, s, 14);
    }

    // 4 扇精致六格推拉公寓窗（带石材窗楣、窗台、百叶与玻璃反光）
    const winPositions = [
      [26, 40], [146, 40],
      [26, 150], [146, 150],
    ];
    winPositions.forEach(([wx, wy], idx) => {
      // 顶部石窗楣与底部石窗台
      ctx.fillStyle = "#e8c484";
      ctx.fillRect(wx - 6, wy - 8, 96, 8);
      ctx.fillRect(wx - 6, wy + 70, 96, 8);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 2.6;
      ctx.strokeRect(wx - 6, wy - 8, 96, 8);
      ctx.strokeRect(wx - 6, wy + 70, 96, 8);

      ctx.fillStyle = idx % 2 === 0 ? "#ffd94a" : "#42d9f5";
      ctx.fillRect(wx, wy, 84, 70);
      // 上半百叶窗横纹
      ctx.fillStyle = "rgba(20,24,38,0.22)";
      for (let by = wy + 5; by < wy + 30; by += 5) {
        ctx.fillRect(wx + 3, by, 78, 2);
      }
      // 斜向玻璃反光
      ctx.fillStyle = "rgba(255,255,255,0.52)";
      ctx.fillRect(wx + 7, wy + 6, 16, 58);

      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 4;
      ctx.strokeRect(wx, wy, 84, 70);
      // 六格木窗棂
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(wx + 28, wy);
      ctx.lineTo(wx + 28, wy + 70);
      ctx.moveTo(wx + 56, wy);
      ctx.lineTo(wx + 56, wy + 70);
      ctx.moveTo(wx, wy + 35);
      ctx.lineTo(wx + 84, wy + 35);
      ctx.stroke();
    });

    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, s - 5, s - 5);
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
    // ISSUE #2 落日唐人街超清立面：朱红漆木壁板 + 翡翠琉璃筒瓦檐 + 鎏金雕花回字窗格 + 霓虹牌匾
    ctx.fillStyle = "#961820";
    ctx.fillRect(0, 0, s, s);
    // 竖向朱红漆木板拼接细线
    ctx.strokeStyle = "rgba(28,6,8,0.42)";
    ctx.lineWidth = 1.6;
    for (let x = 16; x < s; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 42);
      ctx.lineTo(x, s);
      ctx.stroke();
    }
    this._halftone(ctx, 0, 120, s, 136, "rgba(20,6,10,0.2)", 9, 1.8);

    // 翡翠绿琉璃瓦带（逐片筒瓦脊线）与金黄檐带
    ctx.fillStyle = "#009e64";
    ctx.fillRect(0, 8, s, 24);
    for (let tx = 0; tx < s; tx += 16) {
      ctx.fillStyle = "#00c47c";
      ctx.fillRect(tx + 3, 10, 6, 20);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 2;
      ctx.strokeRect(tx, 8, 16, 24);
    }
    ctx.fillStyle = "#ffe01b";
    ctx.fillRect(0, 32, s, 10);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 3.5;
    ctx.strokeRect(0, 32, s, 10);

    // 顶部霓虹金匾（内嵌回纹金边）
    ctx.fillStyle = "#16121e";
    ctx.fillRect(22, 50, s - 44, 46);
    ctx.strokeStyle = "#ffe01b";
    ctx.lineWidth = 4;
    ctx.strokeRect(22, 50, s - 44, 46);
    ctx.strokeStyle = "#ff4d4d";
    ctx.lineWidth = 1.8;
    ctx.strokeRect(28, 56, s - 56, 34);
    ctx.fillStyle = "#ffdf2b";
    ctx.font = "900 26px Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("DRAGON ARCADE", s / 2, 82);

    // 左右两扇精细中式鎏金回字花格亮窗
    [22, 142].forEach((wx) => {
      ctx.fillStyle = "#ffae19";
      ctx.fillRect(wx, 110, 92, 118);
      ctx.fillStyle = "#fff3c4";
      ctx.fillRect(wx + 8, 118, 30, 102);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 4;
      ctx.strokeRect(wx, 110, 92, 118);
      ctx.lineWidth = 2.4;
      ctx.strokeRect(wx + 12, 122, 68, 94);
      ctx.strokeRect(wx + 24, 134, 44, 70);
      ctx.beginPath();
      ctx.moveTo(wx + 46, 110);
      ctx.lineTo(wx + 46, 228);
      ctx.moveTo(wx, 169);
      ctx.lineTo(wx + 92, 169);
      ctx.stroke();
    });

    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, s - 5, s - 5);
  }

  _drawHarborContainerFacade(ctx, s) {
    // ISSUE #4 布鲁克林海港超清集装箱立面：密排波纹钢肋 + 螺栓条 + 货运编号钢印 + 精密钢制卷帘门
    ctx.fillStyle = "#1b466e";
    ctx.fillRect(0, 0, s, s);

    for (let x = 8; x < s - 8; x += 14) {
      ctx.fillStyle = (x / 14) % 2 === 0 ? "#2a6496" : "#153758";
      ctx.fillRect(x, 12, 10, s - 24);
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fillRect(x + 1, 12, 2.5, s - 24);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x, 12, 10, s - 24);
    }
    this._halftone(ctx, 0, 120, s, 136, "rgba(10,12,18,0.22)", 9, 1.8);

    // 货运钢印编号牌（带铆钉与副标题）
    ctx.fillStyle = "#ff7a00";
    ctx.fillRect(20, 28, s - 40, 62);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 28, s - 40, 62);
    ctx.fillStyle = "#101016";
    ctx.font = "900 26px Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("HARBOR PIER 44", s / 2, 60);
    ctx.font = "900 13px Impact, sans-serif";
    ctx.fillText("CARGO SECTOR B-08 · MAX 32T", s / 2, 80);

    // 下部精密钢制货运卷帘门（密排压槽 + 锁扣把手）
    ctx.fillStyle = "#5c687a";
    ctx.fillRect(30, 108, s - 60, 140);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 4;
    ctx.strokeRect(30, 108, s - 60, 140);
    for (let y = 118; y < 246; y += 10) {
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fillRect(32, y + 1, s - 64, 2.5);
      ctx.strokeStyle = "#181d26";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(30, y);
      ctx.lineTo(s - 30, y);
      ctx.stroke();
    }
    ctx.fillStyle = "#ffe01b";
    ctx.fillRect(s / 2 - 22, 226, 44, 10);
    ctx.strokeRect(s / 2 - 22, 226, 44, 10);

    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, s - 5, s - 5);
  }

  _drawMarbleBankFacade(ctx, s) {
    // ISSUE #6 大都会古典白大理石金融大厦超清立面：精砌象牙石材 + 凹槽罗马壁柱 + 黄金装饰几何腰带 + 拱形格栅高窗
    ctx.fillStyle = "#e6dfd0";
    ctx.fillRect(0, 0, s, s);
    // 精细大理石石块分缝
    ctx.strokeStyle = "rgba(62,56,48,0.28)";
    ctx.lineWidth = 1.5;
    for (let y = 40; y < s; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    this._halftone(ctx, 0, 140, s, 116, "rgba(30,28,42,0.1)", 10, 1.8);

    // 黄金 Art-Deco 几何浮雕横梁
    ctx.fillStyle = "#d4af37";
    ctx.fillRect(0, 12, s, 26);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 3.5;
    ctx.strokeRect(0, 12, s, 26);
    ctx.strokeStyle = "#fff1b5";
    ctx.lineWidth = 1.8;
    for (let gx = 10; gx < s - 10; gx += 20) {
      ctx.strokeRect(gx, 18, 12, 14);
    }

    // 两侧古典竖向凹槽大理石罗马壁柱
    [10, s - 46].forEach((px) => {
      ctx.fillStyle = "#f7f4ec";
      ctx.fillRect(px, 38, 36, s - 44);
      for (let fx = px + 6; fx < px + 32; fx += 8) {
        ctx.fillStyle = "#d9d1c0";
        ctx.fillRect(fx, 44, 4, s - 56);
      }
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 3.5;
      ctx.strokeRect(px, 38, 36, s - 44);
    });

    // 中央深青色金融大厦拱顶高窗与精密金色窗棂
    ctx.fillStyle = "#142a46";
    ctx.fillRect(58, 52, s - 116, 184);
    ctx.fillStyle = "#00d8f5";
    ctx.fillRect(66, 60, s - 132, 168);
    ctx.fillStyle = "rgba(255,255,255,0.52)";
    ctx.beginPath();
    ctx.moveTo(70, 224);
    ctx.lineTo(122, 62);
    ctx.lineTo(148, 62);
    ctx.lineTo(96, 224);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 4.5;
    ctx.strokeRect(58, 52, s - 116, 184);

    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const vx of [s * 0.39, s * 0.5, s * 0.61]) {
      ctx.moveTo(vx, 54);
      ctx.lineTo(vx, 234);
    }
    for (const hy of [100, 144, 188]) {
      ctx.moveTo(60, hy);
      ctx.lineTo(s - 60, hy);
    }
    ctx.stroke();

    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, s - 5, s - 5);
  }

  _drawNightMarketFacade(ctx, s) {
    // ISSUE #7 霓虹九龙城夜市超清立面：16×16 釉面马赛克瓷砖 + 密集百叶防盗窗 + 空调外机扇叶 + 双色竖排霓虹灯牌 + 精细卷闸门
    ctx.fillStyle = "#222742";
    ctx.fillRect(0, 0, s, s);
    // 精细九龙城小瓷砖网格
    for (let ty = 0; ty < s; ty += 16) {
      for (let tx = 0; tx < s; tx += 16) {
        const shade = ((tx / 16 + ty / 16) % 3 === 0) ? "#2c3354" : ((tx / 16) % 2 === 0 ? "#242a46" : "#1f243d");
        ctx.fillStyle = shade;
        ctx.fillRect(tx + 1, ty + 1, 14, 14);
      }
    }
    this._halftone(ctx, 0, 120, s, 136, "rgba(8,8,18,0.22)", 9, 1.8);

    // 顶部霓虹荧光灯管条 + 金属支架
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(10, 14, s - 20, 9);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(14, 17, s - 28, 3);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 14, s - 20, 9);

    // 左侧暖黄百叶防盗窗
    ctx.fillStyle = "#ffae19";
    ctx.fillRect(18, 38, 88, 86);
    ctx.fillStyle = "#fff1b5";
    ctx.fillRect(24, 44, 34, 74);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 4;
    ctx.strokeRect(18, 38, 88, 86);
    ctx.lineWidth = 2.2;
    for (let y = 52; y < 122; y += 12) {
      ctx.beginPath();
      ctx.moveTo(18, y);
      ctx.lineTo(106, y);
      ctx.stroke();
    }
    for (const bx of [40, 62, 84]) {
      ctx.beginPath();
      ctx.moveTo(bx, 38);
      ctx.lineTo(bx, 124);
      ctx.stroke();
    }

    // 窗下银灰空调外机箱（带扇叶、散热栅与铜管）
    ctx.fillStyle = "#8a96ad";
    ctx.fillRect(22, 134, 80, 44);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 3;
    ctx.strokeRect(22, 134, 80, 44);
    ctx.fillStyle = "#1b2030";
    ctx.beginPath();
    ctx.arc(48, 156, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#6c7890";
    ctx.lineWidth = 1.6;
    for (let gy = 142; gy <= 170; gy += 6) {
      ctx.beginPath();
      ctx.moveTo(70, gy);
      ctx.lineTo(96, gy);
      ctx.stroke();
    }

    // 右侧高饱和品红/霓虹青双色竖排夜市大招牌
    ctx.fillStyle = "#140e24";
    ctx.fillRect(126, 34, 110, 146);
    ctx.strokeStyle = "#ff2ebd";
    ctx.lineWidth = 4;
    ctx.strokeRect(126, 34, 110, 146);
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 1.8;
    ctx.strokeRect(132, 40, 98, 134);

    ctx.fillStyle = "#ff2ebd";
    ctx.fillRect(140, 48, 82, 38);
    ctx.fillStyle = "#ffe01b";
    ctx.font = "900 24px Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("24H", 181, 76);

    ctx.fillStyle = "#00e5ff";
    ctx.font = "900 22px Impact, sans-serif";
    ctx.fillText("RAMEN", 181, 118);
    ctx.fillStyle = "#ff5c93";
    ctx.fillText("ARCADE", 181, 150);
    ctx.fillStyle = "#ffe01b";
    ctx.font = "900 12px Impact, sans-serif";
    ctx.fillText("KOWLOON DISTRICT", 181, 168);

    // 底部精密防盗卷闸门
    ctx.fillStyle = "#48526e";
    ctx.fillRect(14, 190, s - 28, 58);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 3.5;
    ctx.strokeRect(14, 190, s - 28, 58);
    ctx.lineWidth = 1.6;
    for (let y = 200; y < 246; y += 8) {
      ctx.beginPath();
      ctx.moveTo(14, y);
      ctx.lineTo(s - 14, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, s - 5, s - 5);
  }

  _drawOldQuarterFacade(ctx, s) {
    // ISSUE #8 老城运河与大巴扎超清立面：错缝石灰岩切块 + 逐片陶土筒瓦檐口 + 拱心石玻璃长窗 + 锻铁雕花阳台
    ctx.fillStyle = "#d4ad79";
    ctx.fillRect(0, 0, s, s);
    // 精细错缝石灰岩砌块
    const rows = 9;
    const rh = (s - 46) / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 26;
      for (let x = -26; x < s + 26; x += 52) {
        ctx.fillStyle = (r + Math.floor(x / 52)) % 2 === 0 ? "#dec090" : "#cfa571";
        ctx.fillRect(x + off + 1.5, 46 + r * rh + 1.5, 49, rh - 3);
        ctx.strokeStyle = "rgba(58,36,16,0.34)";
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x + off, 46 + r * rh, 52, rh);
      }
    }
    this._halftone(ctx, 0, 140, s, 116, "rgba(72,42,16,0.14)", 10, 1.8);

    // 顶部陶土筒瓦檐口（逐片瓦脊阴影）
    ctx.fillStyle = "#b84a2e";
    ctx.fillRect(0, 6, s, 26);
    for (let tx = 0; tx < s; tx += 16) {
      ctx.fillStyle = "#d65d3b";
      ctx.fillRect(tx + 3, 8, 7, 22);
      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 1.8;
      ctx.strokeRect(tx, 6, 16, 26);
    }
    ctx.fillStyle = "#f2dec0";
    ctx.fillRect(0, 32, s, 12);
    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 3.2;
    ctx.strokeRect(0, 32, s, 12);

    // 两扇欧式复古拱形玻璃长窗（带顶拱石 + 精细十字格栅 + 锻铁雕花阳台）
    [24, 144].forEach((wx) => {
      ctx.fillStyle = "#1f3a4d";
      ctx.beginPath();
      ctx.arc(wx + 44, 102, 44, Math.PI, 0);
      ctx.lineTo(wx + 88, 214);
      ctx.lineTo(wx, 214);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#ffdf8e";
      ctx.beginPath();
      ctx.arc(wx + 44, 104, 36, Math.PI, 0);
      ctx.lineTo(wx + 80, 204);
      ctx.lineTo(wx + 8, 204);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.48)";
      ctx.fillRect(wx + 15, 104, 16, 94);

      ctx.strokeStyle = "#101016";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(wx + 44, 102, 44, Math.PI, 0);
      ctx.lineTo(wx + 88, 214);
      ctx.lineTo(wx, 214);
      ctx.closePath();
      ctx.stroke();

      // 拱心楔石
      ctx.fillStyle = "#f2dec0";
      ctx.fillRect(wx + 37, 52, 14, 14);
      ctx.lineWidth = 2.2;
      ctx.strokeRect(wx + 37, 52, 14, 14);

      // 窗格精细木棂
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(wx + 44, 62);
      ctx.lineTo(wx + 44, 214);
      ctx.moveTo(wx + 8, 122);
      ctx.lineTo(wx + 80, 122);
      ctx.moveTo(wx + 8, 158);
      ctx.lineTo(wx + 80, 158);
      ctx.stroke();

      // 铸铁雕花阳台护栏
      ctx.fillStyle = "#161822";
      ctx.fillRect(wx - 4, 182, 96, 6);
      for (let bx = wx + 2; bx <= wx + 84; bx += 10) {
        ctx.fillRect(bx, 182, 3, 30);
      }
      ctx.fillRect(wx - 4, 210, 96, 6);
    });

    ctx.strokeStyle = "#101016";
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, s - 5, s - 5);
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
