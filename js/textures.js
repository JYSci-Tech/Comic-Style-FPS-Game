import * as THREE from "three";

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
      brick: this._makeCanvasTex(256, 256, (ctx) => this._drawBrick(ctx, 256)),
      neon: this._makeCanvasTex(256, 256, (ctx) => this._drawNeonStore(ctx, 256)),
      hazard: this._makeCanvasTex(256, 256, (ctx) => this._drawHazardSteel(ctx, 256)),
      poster: this._makeCanvasTex(256, 256, (ctx) => this._drawWantedPoster(ctx, 256)),
      lab: this._makeCanvasTex(256, 256, (ctx) => this._drawVillainLab(ctx, 256)),
      crate: this._makeCanvasTex(256, 256, (ctx) => this._drawCrate(ctx, 256)),
      asphalt: this._makeCanvasTex(256, 256, (ctx) => this._drawFloorAsphalt(ctx, 256), true),
      factoryFloor: this._makeCanvasTex(256, 256, (ctx) => this._drawFloorFactory(ctx, 256), true),
      labFloor: this._makeCanvasTex(256, 256, (ctx) => this._drawFloorLab(ctx, 256), true),
      barrel: this._makeCanvasTex(256, 256, (ctx) => this._drawBarrel(ctx, 256)),
    };

    this.wallMaterials = {
      1: this.toonMat({ map: this.textures.brick }),
      2: this.toonMat({ map: this.textures.neon }),
      3: this.toonMat({ map: this.textures.hazard }),
      4: this.toonMat({ map: this.textures.poster }),
      5: this.toonMat({ map: this.textures.lab }),
      6: this.toonMat({ map: this.textures.crate }),
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
    return new THREE.MeshToonMaterial({
      gradientMap: this.toonGradient,
      ...opts,
    });
  }

  // 给 3D 网格添加反向法线厚黑墨线描边（Inverted Hull）
  addOutline(mesh, scale = 1.055) {
    const outline = new THREE.Mesh(mesh.geometry, this.inkMaterial);
    outline.scale.setScalar(scale);
    outline.raycast = () => {}; // 不干扰子弹射线检测
    mesh.add(outline);
    return outline;
  }

  // 给建筑/箱体添加锐利漫画硬棱角墨线
  addCreaseLines(mesh, threshold = 20) {
    const edges = new THREE.EdgesGeometry(mesh.geometry, threshold);
    const lines = new THREE.LineSegments(edges, this.edgeMaterial);
    lines.raycast = () => {};
    mesh.add(lines);
    return lines;
  }

  _makeCanvasTex(w, h, drawFn, repeat = false) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    drawFn(ctx, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
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
    ctx.fillStyle = "#2b2c3a";
    ctx.fillRect(0, 0, s, s);
    this._halftone(ctx, 0, 0, s, s, "rgba(0,0,0,0.25)", 16, 2.5);
    ctx.strokeStyle = "#181822";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, s - 4, s - 4);
    // 偶尔的路面黄漆标线感
    ctx.fillStyle = "rgba(255, 224, 27, 0.25)";
    ctx.fillRect(118, 24, 20, 76);
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
