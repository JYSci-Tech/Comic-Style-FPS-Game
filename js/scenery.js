import * as THREE from "three";
import { CELL_SIZE } from "./levels.js";

// 64m 空间分块：兼顾大图视锥剔除效率，同时将巨型街区的 InstancedMesh Draw Call 压缩 3~4 倍
const CHUNK_SIZE = CELL_SIZE * 16;
const _tmpScale = new THREE.Vector3();
const _segStart = new THREE.Vector3();
const _segEnd = new THREE.Vector3();
const _segMid = new THREE.Vector3();
const _segDir = new THREE.Vector3();
const _segQuat = new THREE.Quaternion();
const _upAxis = new THREE.Vector3(0, 1, 0);

export class StreetScenery {
  constructor(root, assets) {
    this.root = root;
    this.solidMaterial = assets.toonMat();
    this.emissiveMaterial = new THREE.MeshBasicMaterial();
    // The cab's narrower roof leaves real sloping windshields below the roof trim.
    const cab = new THREE.BoxGeometry(1, 1, 1);
    const positions = cab.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      if (positions.getY(i) <= 0) continue;
      positions.setX(i, positions.getX(i) * 0.82);
      positions.setZ(i, positions.getZ(i) * 0.70);
    }
    cab.computeVertexNormals();
    this.shapes = {
      box: new THREE.BoxGeometry(1, 1, 1),
      paint: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      wheel: new THREE.CylinderGeometry(0.5, 0.5, 1, 12).rotateZ(Math.PI / 2),
      cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
      cone: new THREE.ConeGeometry(0.5, 1, 10),
      pyramid: new THREE.ConeGeometry(0.707, 1, 4).rotateY(Math.PI / 4),
      sphere: new THREE.SphereGeometry(0.5, 12, 10),
      foliage: new THREE.DodecahedronGeometry(0.5, 0),
      cab,
    };
    this.batches = new Map();
  }

  addSolid(shape, color, position, scale, rotY = 0) {
    this.add(shape, this.solidMaterial, position, scale, color, rotY);
  }

  addEmissive(shape, color, position, scale, rotY = 0) {
    this.add(shape, this.emissiveMaterial, position, scale, color, rotY);
  }

  add(shape, material, position, scale, color, rotY = 0) {
    const [x, , z] = position;
    const key = [shape, material.id, Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)].join(":");
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { shape, material, instances: [] };
      this.batches.set(key, batch);
    }
    const matrix = new THREE.Matrix4();
    if (rotY) {
      _tmpScale.set(scale[0], scale[1], scale[2]);
      matrix.makeRotationY(rotY).scale(_tmpScale).setPosition(position[0], position[1], position[2]);
    } else {
      matrix.makeScale(scale[0], scale[1], scale[2]).setPosition(position[0], position[1], position[2]);
    }
    batch.instances.push({ matrix, color });
  }

  // 在任意两个 3D 空间点之间合批绘制一根精准对齐的圆柱绳索/斜撑杆（用于垂坠悬链电线、吊绳、斜拉索）
  addSegment(color, p1, p2, thickness = 0.045, emissive = false) {
    _segStart.set(p1[0], p1[1], p1[2]);
    _segEnd.set(p2[0], p2[1], p2[2]);
    _segDir.subVectors(_segEnd, _segStart);
    const len = _segDir.length();
    if (len < 1e-4) return;
    _segMid.addVectors(_segStart, _segEnd).multiplyScalar(0.5);
    _segDir.divideScalar(len);
    _segQuat.setFromUnitVectors(_upAxis, _segDir);
    _tmpScale.set(thickness, len, thickness);

    const material = emissive ? this.emissiveMaterial : this.solidMaterial;
    const key = ["cylinder", material.id, Math.floor(_segMid.x / CHUNK_SIZE), Math.floor(_segMid.z / CHUNK_SIZE)].join(":");
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { shape: "cylinder", material, instances: [] };
      this.batches.set(key, batch);
    }
    const matrix = new THREE.Matrix4().compose(_segMid, _segQuat, _tmpScale);
    batch.instances.push({ matrix, color });
  }

  _makePartHelper(x, ground, z, rotY = 0) {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    return (shape, color, dx, y, dz, w, h, d, extraRotY = 0, emissive = false) => {
      const wx = x + dx * c + dz * s;
      const wz = z - dx * s + dz * c;
      if (emissive) {
        this.addEmissive(shape, color, [wx, ground + y, wz], [w, h, d], rotY + extraRotY);
      } else {
        this.addSolid(shape, color, [wx, ground + y, wz], [w, h, d], rotY + extraRotY);
      }
    };
  }

  // 精细悬挂挂灯组件（带顶部线夹 + 真实垂直吊绳 + 金属灯帽 + 多肋发光灯体 + 底部流苏或复古工业灯罩）
  addHangingLantern(x, cableY, z, dropLen, color, style = "lantern") {
    const ink = 0x161822;
    const gold = 0xffcf33;
    const ropeY = cableY - dropLen * 0.5;
    const topY = cableY - dropLen;

    // 1. 线缆挂扣 + 垂直吊绳（清晰可见的纤细黑色吊绳）
    this.addSolid("box", ink, [x, cableY, z], [0.10, 0.10, 0.10]);
    this.addSolid("cylinder", ink, [x, ropeY, z], [0.036, dropLen, 0.036]);

    if (style === "bulb") {
      // 复古工业暗巷/海港搪瓷罩吊灯：金属挂环 + 宽沿锥形搪瓷灯罩 + 铜灯座 + 暖亮爱迪生灯泡
      this.addSolid("cylinder", 0x3b4458, [x, topY - 0.04, z], [0.12, 0.10, 0.12]);
      this.addSolid("cone", 0x262c3b, [x, topY - 0.16, z], [0.58, 0.22, 0.58]);
      this.addEmissive("cylinder", 0xfff1c4, [x, topY - 0.27, z], [0.48, 0.04, 0.48]);
      this.addEmissive("sphere", color, [x, topY - 0.34, z], [0.24, 0.28, 0.24]);
      return;
    }

    // 中式/九龙城夜市精细雕花笼灯：挂环 + 鎏金上盖 + 饱满双层发光灯笼身 + 十字灯骨骨架 + 下金托 + 飘垂流苏穗
    this.addSolid("cylinder", gold, [x, topY - 0.03, z], [0.10, 0.08, 0.10]);
    this.addSolid("cylinder", ink, [x, topY - 0.10, z], [0.30, 0.09, 0.30]);
    this.addSolid("cylinder", gold, [x, topY - 0.15, z], [0.34, 0.05, 0.34]);

    const bodyY = topY - 0.44;
    // 饱满发光灯笼球体 + 中央高光腰环
    this.addEmissive("sphere", color, [x, bodyY, z], [0.58, 0.54, 0.58]);
    this.addEmissive("cylinder", 0xfff2c2, [x, bodyY, z], [0.59, 0.12, 0.59]);
    // 4 道竖向暗金/墨线灯骨筋条（呈现精致手工扎制灯笼质感）
    this.addSolid("box", ink, [x, bodyY, z], [0.60, 0.46, 0.045], 0);
    this.addSolid("box", ink, [x, bodyY, z], [0.60, 0.46, 0.045], Math.PI / 2);
    this.addSolid("box", gold, [x, bodyY, z], [0.59, 0.44, 0.03], Math.PI / 4);
    this.addSolid("box", gold, [x, bodyY, z], [0.59, 0.44, 0.03], -Math.PI / 4);

    // 底部金托与双节垂坠红金流苏穗
    this.addSolid("cylinder", gold, [x, topY - 0.72, z], [0.30, 0.06, 0.30]);
    this.addSolid("cylinder", ink, [x, topY - 0.77, z], [0.24, 0.06, 0.24]);
    this.addSolid("cylinder", gold, [x, topY - 0.86, z], [0.045, 0.14, 0.045]);
    this.addSolid("cone", color === 0xffcf26 ? 0xd92027 : gold, [x, topY - 1.02, z], [0.13, 0.24, 0.13]);
  }

  addVehicle(type, x, ground, z, rotY = 0) {
    const v = ((type % 4) + 4) % 4;
    const taxi = v === 0;
    const van = v === 1;
    const police = v === 2;
    const coupe = v === 3;
    const paint = taxi ? 0xffcb26 : van ? 0xcb303d : police ? 0x2357a8 : 0x00b49d;
    const ink = 0x20222d;
    const steel = 0x9ba8bd;
    const cream = 0xffe6b6;
    const part = this._makePartHelper(x, ground, z, rotY);
    const box = (color, dx, y, dz, w, h, d, er = 0, em = false) => part("box", color, dx, y, dz, w, h, d, er, em);

    box(ink, 0, 0.34, 0, 2.48, 0.25, 2.94);
    box(paint, 0, 0.64, 0, 2.66, 0.48, 3.01);
    box(steel, 0, 0.45, -1.52, 2.57, 0.14, 0.14);
    box(steel, 0, 0.45, 1.52, 2.57, 0.14, 0.14);
    box(ink, 0, 0.67, -1.515, 1.26, 0.18, 0.07);

    for (const side of [-1, 1]) {
      box(0xfff1c1, side * 0.96, 0.70, -1.52, 0.43, 0.17, 0.10, 0, true);
      box(0xff4238, side * 0.99, 0.67, 1.53, 0.39, 0.17, 0.10, 0, true);
      box(ink, side * 1.34, 0.62, 0, 0.06, 0.11, 0.97);
      box(steel, side * 1.36, 0.78, 0.13, 0.06, 0.06, 0.25);
      for (const axle of [-0.94, 0.95]) {
        part("wheel", ink, side * 1.29, 0.31, axle, 0.34, 0.60, 0.60);
        part("wheel", steel, side * 1.468, 0.31, axle, 0.055, 0.32, 0.32);
      }
    }

    if (van) {
      part("cab", 0x334d61, 0, 1.11, -0.78, 2.13, 0.50, 1.12);
      box(cream, 0, 1.22, 0.59, 2.44, 0.79, 1.70);
      box(paint, 0, 1.20, 1.451, 1.94, 0.52, 0.07);
      box(steel, 0, 1.19, 1.497, 0.065, 0.42, 0.06);
      return;
    }

    if (coupe) {
      box(0xffe01b, 0, 0.90, -0.82, 0.52, 0.05, 1.35);
      part("cab", 0x264458, 0, 1.04, 0.18, 2.02, 0.42, 1.56);
      box(paint, 0, 1.27, 0.18, 1.66, 0.06, 1.12);
      box(ink, 0, 1.05, 1.38, 2.28, 0.09, 0.32);
      for (const side of [-0.82, 0.82]) {
        box(ink, side, 0.92, 1.36, 0.12, 0.24, 0.18);
      }
      return;
    }

    part("cab", 0x36596d, 0, 1.11, 0.05, 2.17, 0.53, 1.82);
    box(taxi ? paint : cream, 0, 1.397, 0.05, 1.82, 0.07, 1.33);
    for (const side of [-1, 1]) {
      box(ink, side * 1.03, 1.095, 0.06, 0.07, 0.46, 0.12);
      box(paint, side * 1.23, 1.02, -0.55, 0.20, 0.11, 0.19);
    }
    box(ink, 0, 1.47, 0.05, 0.95, 0.10, 0.32);
    if (taxi) {
      box(0xffe97d, 0, 1.55, 0.05, 0.74, 0.15, 0.25, 0, true);
    } else {
      box(0xff3848, -0.24, 1.54, 0.05, 0.43, 0.12, 0.25, 0, true);
      box(0x19dcff, 0.24, 1.54, 0.05, 0.43, 0.12, 0.25, 0, true);
    }
  }

  // 精细铸铁路灯（带阶梯底座、装饰环箍、斜撑悬臂、复古灯罩与暖光灯泡）& 精细消防栓（带法兰螺栓底座、双侧水口盖、主阀门盖与顶帽）
  addStreetFixture(isLamp, x, ground, z, rotY = 0) {
    const part = this._makePartHelper(x, ground, z, rotY);
    if (isLamp) {
      const metal = 0x1c202c;
      const trim = 0x5c687e;
      part("cylinder", metal, 0, 0.10, 0, 0.56, 0.20, 0.56);
      part("cylinder", metal, 0, 0.38, 0, 0.36, 0.42, 0.36);
      part("cylinder", trim, 0, 0.62, 0, 0.30, 0.08, 0.30);
      part("cylinder", metal, 0, 2.32, 0, 0.15, 3.45, 0.15);
      part("cylinder", trim, 0, 1.45, 0, 0.21, 0.09, 0.21);
      part("cylinder", trim, 0, 3.85, 0, 0.22, 0.10, 0.22);
      // 悬臂横杆 + 三角斜撑 + 吊挂复古灯罩
      part("box", metal, 0.48, 3.96, 0, 1.04, 0.09, 0.09);
      part("box", trim, 0.28, 3.74, 0, 0.52, 0.06, 0.06);
      part("cylinder", metal, 0.94, 3.88, 0, 0.08, 0.16, 0.08);
      part("cone", metal, 0.94, 3.74, 0, 0.62, 0.22, 0.62);
      part("sphere", 0xffe896, 0.94, 3.58, 0, 0.30, 0.34, 0.30, 0, true);
    } else {
      const red = 0xdc323c;
      const dark = 0x731d26;
      const brass = 0xe8b861;
      part("cylinder", dark, 0, 0.06, 0, 0.54, 0.12, 0.54);
      part("cylinder", red, 0, 0.16, 0, 0.42, 0.12, 0.42);
      part("cylinder", red, 0, 0.44, 0, 0.33, 0.48, 0.33);
      part("cylinder", dark, 0, 0.69, 0, 0.44, 0.08, 0.44);
      part("sphere", red, 0, 0.77, 0, 0.36, 0.18, 0.36);
      part("cylinder", brass, 0, 0.88, 0, 0.13, 0.09, 0.13);
      // 双侧消防水带接口与六角铜盖
      part("wheel", red, 0, 0.48, 0, 0.54, 0.19, 0.19);
      part("wheel", brass, 0, 0.48, 0, 0.60, 0.14, 0.14);
      // 正面主接口盖
      part("cylinder", brass, 0, 0.46, 0.19, 0.17, 0.12, 0.17);
      // 底座螺栓圆点
      for (const bx of [-0.20, 0.20]) {
        part("cylinder", brass, bx, 0.13, 0.16, 0.05, 0.04, 0.05);
        part("cylinder", brass, bx, 0.13, -0.16, 0.05, 0.04, 0.05);
      }
    }
  }

  // 街口红绿灯悬臂信号柱（带遮光罩与发光灯珠）
  addTrafficLight(x, ground, z, rotY = 0) {
    const part = this._makePartHelper(x, ground, z, rotY);
    const pole = 0x262c3b;
    const housing = 0x161822;
    part("cylinder", pole, 0, 0.14, 0, 0.52, 0.28, 0.52);
    part("cylinder", pole, 0, 2.35, 0, 0.18, 4.4, 0.18);
    part("box", pole, 1.15, 4.35, 0, 2.35, 0.14, 0.14);
    part("box", housing, 2.05, 4.10, 0, 0.44, 1.08, 0.38);
    for (const [ly, col] of [[4.38, 0xff2a44], [4.10, 0xffe01b], [3.82, 0x2ee568]]) {
      part("sphere", col, 2.05, ly, 0.18, 0.22, 0.22, 0.10, 0, true);
      part("box", housing, 2.05, ly + 0.12, 0.26, 0.26, 0.05, 0.16);
    }
    part("box", housing, 0.28, 2.55, 0, 0.32, 0.50, 0.30);
    part("box", 0xff8c1a, 0.28, 2.65, 0.15, 0.16, 0.16, 0.06, 0, true);
    part("box", 0x00e5ff, 0.28, 2.45, 0.15, 0.16, 0.16, 0.06, 0, true);
  }

  // 精细街边复古漫画报刊亭 / 夜市小吃摊位（阶梯书架 + 遮阳篷吊灯 + 装饰支架）
  addNewsstand(x, ground, z, rotY = 0, accentColor = 0xff2a44) {
    const part = this._makePartHelper(x, ground, z, rotY);
    const wood = 0x5c3a24;
    const darkWood = 0x3b2416;
    const ink = 0x1b1d28;
    const cream = 0xfff0cc;
    part("box", darkWood, 0, 0.10, 0, 2.22, 0.20, 1.18);
    part("box", wood, 0, 0.58, 0, 2.15, 0.86, 1.10);
    // 柜台正面护墙木板竖缝
    for (const px of [-0.72, -0.24, 0.24, 0.72]) {
      part("box", darkWood, px, 0.58, 0.56, 0.06, 0.78, 0.04);
    }
    part("box", cream, 0, 1.06, 0.12, 2.30, 0.11, 1.26);
    // 柜台前沿小报摊阶梯陈列
    part("box", 0xffe01b, -0.68, 1.15, 0.50, 0.42, 0.08, 0.26);
    part("box", 0x00e5ff, 0.0, 1.15, 0.50, 0.42, 0.08, 0.26);
    part("box", 0xff2ebd, 0.68, 1.15, 0.50, 0.42, 0.08, 0.26);
    // 四角细铁柱与背板
    for (const sx of [-0.98, 0.98]) {
      part("box", ink, sx, 1.66, -0.46, 0.11, 1.24, 0.11);
      part("box", ink, sx, 1.66, 0.46, 0.09, 1.24, 0.09);
    }
    part("box", 0x262c40, 0, 1.66, -0.48, 2.02, 1.18, 0.09);
    // 双层彩色漫画书报陈列架
    for (const rowY of [1.34, 1.82]) {
      part("box", darkWood, 0, rowY - 0.18, -0.36, 1.86, 0.06, 0.16);
      part("box", 0xffe01b, -0.60, rowY, -0.37, 0.38, 0.34, 0.06);
      part("box", 0x00e5ff, -0.18, rowY, -0.37, 0.38, 0.34, 0.06);
      part("box", 0xff2ebd, 0.24, rowY, -0.37, 0.38, 0.34, 0.06);
      part("box", 0x38e54d, 0.64, rowY, -0.37, 0.34, 0.34, 0.06);
    }
    // 顶部条纹遮阳篷与棚下吊灯
    part("box", accentColor, 0, 2.34, 0.08, 2.52, 0.24, 1.58);
    for (const sx of [-0.90, -0.30, 0.30, 0.90]) {
      part("box", cream, sx, 2.34, 0.87, 0.30, 0.26, 0.06);
    }
    part("cylinder", ink, 0, 2.12, 0.15, 0.04, 0.22, 0.04);
    part("sphere", 0xffe985, 0, 1.98, 0.15, 0.22, 0.20, 0.22, 0, true);
    // 顶部高亮灯牌
    part("box", ink, 0, 2.66, 0.12, 1.54, 0.40, 0.20);
    part("box", 0xffe96b, 0, 2.66, 0.12, 1.42, 0.30, 0.24, 0, true);
  }

  // 公交候车亭（玻璃钢框架 + 板条长椅 + 发光漫画灯箱 + 站牌）
  addBusShelter(x, ground, z, rotY = 0, accentColor = 0x00e5ff) {
    const part = this._makePartHelper(x, ground, z, rotY);
    const steel = 0x2a3346;
    const glass = 0x7bc9e8;
    part("box", steel, -1.25, 1.25, -0.45, 0.13, 2.5, 0.13);
    part("box", steel, 0.0, 1.25, -0.45, 0.09, 2.5, 0.09);
    part("box", steel, 1.25, 1.25, -0.45, 0.13, 2.5, 0.13);
    part("box", glass, 0, 1.32, -0.46, 2.36, 1.92, 0.06);
    part("box", steel, 0, 2.52, 0.12, 2.90, 0.15, 1.44);
    part("box", accentColor, 0, 2.56, 0.84, 2.78, 0.10, 0.10, 0, true);
    // 多条木板候车长椅 + 靠背
    for (const sz of [-0.22, -0.06, 0.10]) {
      part("box", 0xb86e36, -0.22, 0.54, sz, 1.66, 0.06, 0.12);
    }
    part("box", 0xa8602c, -0.22, 0.84, -0.32, 1.66, 0.18, 0.06);
    for (const lx of [-0.82, 0.38]) {
      part("box", steel, lx, 0.28, -0.06, 0.10, 0.52, 0.42);
    }
    // 侧翼发光海报灯箱 + 顶灯
    part("box", steel, 1.26, 1.25, 0.12, 0.22, 2.38, 1.14);
    part("box", 0xffe86b, 1.26, 1.34, 0.12, 0.26, 1.48, 0.86, 0, true);
    part("box", 0xfff5cc, -0.22, 2.43, 0.08, 1.2, 0.06, 0.24, 0, true);
  }

  // 精细露天咖啡遮阳伞圆桌（含铁艺十字脚 + 桌边咖啡杯碟 + 多瓣遮阳伞顶尖 + 两把带靠背欧式铁艺餐椅）
  addCafeTable(x, ground, z, rotY = 0, umbrellaColor = 0xff5a2a) {
    const part = this._makePartHelper(x, ground, z, rotY);
    const iron = 0x202430;
    const wood = 0xc9884c;
    const cream = 0xfff3d4;
    // 铁艺十字铸铁底座与桌柱
    part("box", iron, 0, 0.05, 0, 0.72, 0.08, 0.12);
    part("box", iron, 0, 0.05, 0, 0.12, 0.08, 0.72);
    part("cylinder", iron, 0, 0.45, 0, 0.10, 0.82, 0.10);
    // 圆桌面与金属包边 + 桌上的咖啡杯碟
    part("cylinder", iron, 0, 0.85, 0, 1.16, 0.08, 1.16);
    part("cylinder", wood, 0, 0.87, 0, 1.10, 0.07, 1.10);
    part("cylinder", cream, -0.24, 0.92, 0.18, 0.22, 0.03, 0.22);
    part("cylinder", cream, -0.24, 0.98, 0.18, 0.13, 0.11, 0.13);
    part("cylinder", cream, 0.26, 0.92, -0.14, 0.22, 0.03, 0.22);
    part("cylinder", 0xff5a2a, 0.26, 0.98, -0.14, 0.13, 0.11, 0.13);
    // 伞杆、伞骨与遮阳伞顶
    part("cylinder", iron, 0, 1.72, 0, 0.065, 1.76, 0.065);
    part("cone", umbrellaColor, 0, 2.50, 0, 2.30, 0.68, 2.30);
    part("cylinder", cream, 0, 2.16, 0, 2.26, 0.09, 2.26);
    part("sphere", 0xffcf33, 0, 2.86, 0, 0.14, 0.16, 0.14);
    // 两把带靠背与四腿的欧式铁艺小椅
    for (const side of [-1, 1]) {
      const cx = side * 0.84;
      part("cylinder", wood, cx, 0.52, 0.06, 0.46, 0.06, 0.46);
      part("cylinder", iron, cx, 0.51, 0.06, 0.50, 0.04, 0.50);
      for (const lx of [-0.16, 0.16]) {
        for (const lz of [-0.14, 0.14]) {
          part("cylinder", iron, cx + lx, 0.25, 0.06 + lz, 0.045, 0.50, 0.045);
        }
      }
      // 椅背立杆与横档
      part("cylinder", iron, cx + side * 0.20, 0.78, -0.08, 0.045, 0.52, 0.045);
      part("cylinder", iron, cx + side * 0.20, 0.78, 0.20, 0.045, 0.52, 0.045);
      part("box", wood, cx + side * 0.20, 0.96, 0.06, 0.06, 0.16, 0.38);
    }
  }

  // 高精细街头微细节杂物（0: 精细垃圾箱+滚轮+双开盖+系口垃圾袋  1: 复古四足邮筒+带橱窗报箱  2: 满载饮料罐的霓虹自动贩卖机  3: 带闪烁警示灯路障+橡胶底锥桶  4: 多格玻璃窗+内含听筒的经典电话亭  5: 木条果蔬货箱+水果+陶罐堆）
  addStreetClutter(variant, x, ground, z, rotY = 0) {
    const v = ((variant % 6) + 6) % 6;
    const part = this._makePartHelper(x, ground, z, rotY);
    const ink = 0x1a1d28;
    const steel = 0x8d99ae;
    if (v === 0) {
      // 【精细商用铁皮垃圾箱】：四底轮 + 加强筋肋条箱体 + 上沿防撞翻边 + 侧插槽 + 双开塑料盖（一侧微敞）+ 圆鼓扎口黑垃圾袋
      const green = 0x256847;
      const darkGreen = 0x1a4b33;
      // 4 个万向滚轮
      for (const wx of [-0.56, 0.56]) {
        for (const wz of [-0.34, 0.34]) {
          part("wheel", ink, wx, 0.10, wz, 0.12, 0.20, 0.20);
        }
      }
      // 底座框与主箱体
      part("box", ink, 0, 0.20, 0, 1.54, 0.08, 0.98);
      part("box", green, 0, 0.68, 0, 1.48, 0.90, 0.92);
      // 4 道竖向冲压加强肋 + 顶部外翻加厚口沿
      for (const rx of [-0.52, -0.18, 0.18, 0.52]) {
        part("box", darkGreen, rx, 0.68, 0.47, 0.08, 0.84, 0.06);
        part("box", darkGreen, rx, 0.68, -0.47, 0.08, 0.84, 0.06);
      }
      part("box", darkGreen, 0, 1.14, 0, 1.58, 0.10, 1.02);
      // 两侧叉车清运插槽 + 黄色反光贴
      for (const sx of [-0.77, 0.77]) {
        part("box", ink, sx, 0.64, 0, 0.09, 0.24, 0.56);
        part("box", 0xffe01b, sx * 0.97, 0.96, 0.42, 0.06, 0.12, 0.16);
      }
      // 双开黑色塑料盖（左盖闭合，右盖微掀露出一角垃圾袋）
      part("box", ink, -0.38, 1.22, -0.02, 0.72, 0.08, 0.94);
      part("box", 0x353a4a, -0.38, 1.27, 0.36, 0.24, 0.05, 0.08);
      part("box", ink, 0.38, 1.28, -0.10, 0.72, 0.08, 0.90, 0.08);
      part("sphere", 0x2c303e, 0.36, 1.15, 0.16, 0.42, 0.30, 0.38);
      // 垃圾箱旁圆鼓鼓的扎口黑色垃圾袋（球体 + 顶部蝴蝶结扎口）与歪斜纸箱
      part("sphere", 0x222530, -0.48, 0.24, 0.68, 0.48, 0.42, 0.44);
      part("cone", 0x2e3242, -0.48, 0.49, 0.68, 0.18, 0.14, 0.18);
      part("sphere", 0x1b1e28, 0.12, 0.20, 0.72, 0.40, 0.36, 0.38);
      part("cone", 0x2b2f3d, 0.12, 0.41, 0.72, 0.15, 0.12, 0.15);
      part("box", 0xb8844c, 0.62, 0.21, 0.66, 0.44, 0.38, 0.38, -0.26);
      part("box", 0x8f6232, 0.62, 0.40, 0.66, 0.46, 0.04, 0.08, -0.26);
    } else if (v === 1) {
      // 【精细复古美漫四足蓝邮筒 + 带玻璃橱窗投币报箱】
      const blue = 0x1e56ad;
      const darkBlue = 0x143b78;
      for (const lx of [-0.46, -0.02]) {
        for (const lz of [-0.18, 0.18]) {
          part("box", darkBlue, lx, 0.16, lz, 0.08, 0.32, 0.08);
        }
      }
      part("box", blue, -0.24, 0.74, 0, 0.56, 0.88, 0.52);
      part("cylinder", blue, -0.24, 1.18, 0, 0.54, 0.26, 0.54);
      part("box", darkBlue, -0.24, 1.00, 0.28, 0.42, 0.16, 0.08);
      part("box", steel, -0.24, 1.04, 0.33, 0.28, 0.04, 0.04);
      part("box", 0xffe01b, -0.24, 0.72, 0.27, 0.38, 0.12, 0.04);
      part("box", 0xfff5dc, -0.24, 0.52, 0.27, 0.26, 0.18, 0.03);
      // 旁侧红色投币报纸售卖箱（底座 + 玻璃窗内嵌头版报纸 + 铬银把手）
      part("box", ink, 0.42, 0.14, 0.04, 0.34, 0.28, 0.34);
      part("box", 0xd62d3a, 0.42, 0.68, 0.04, 0.48, 0.84, 0.44);
      part("box", ink, 0.42, 0.76, 0.26, 0.38, 0.44, 0.04);
      part("box", 0xfff5db, 0.42, 0.76, 0.28, 0.32, 0.38, 0.03);
      part("box", 0xff2a44, 0.42, 0.89, 0.295, 0.28, 0.08, 0.02);
      part("box", steel, 0.42, 0.48, 0.28, 0.24, 0.05, 0.05);
      part("box", 0xffe01b, 0.42, 1.12, 0.04, 0.50, 0.08, 0.46);
    } else if (v === 2) {
      // 【精细霓虹自动贩卖机】：支脚 + 透明玻璃橱窗内陈列 3 层 12 罐彩色饮料 + 发光顶牌 + 按键面板 + 推板取货口
      part("box", ink, -0.44, 0.05, -0.28, 0.12, 0.10, 0.12);
      part("box", ink, 0.44, 0.05, -0.28, 0.12, 0.10, 0.12);
      part("box", ink, -0.44, 0.05, 0.28, 0.12, 0.10, 0.12);
      part("box", ink, 0.44, 0.05, 0.28, 0.12, 0.10, 0.12);
      part("box", 0x1d2640, 0, 1.12, 0, 1.14, 2.04, 0.76);
      part("box", 0xff2ebd, 0, 1.98, 0.39, 0.98, 0.22, 0.06, 0, true);
      // 玻璃展示柜凹槽 + 3 排彩色汽水罐
      part("box", 0x0f1526, -0.14, 1.38, 0.35, 0.68, 0.88, 0.10);
      const canCols = [0xff2a44, 0x00e5ff, 0xffe01b, 0x38e54d];
      for (let r = 0; r < 3; r++) {
        const sy = 1.12 + r * 0.26;
        part("box", steel, -0.14, sy - 0.08, 0.38, 0.64, 0.03, 0.08);
        for (let c = 0; c < 4; c++) {
          part("cylinder", canCols[(r + c) % 4], -0.36 + c * 0.145, sy, 0.38, 0.09, 0.16, 0.09, 0, true);
        }
      }
      // 右侧投币按键区与发光显示屏
      part("box", 0x2c3754, 0.36, 1.32, 0.39, 0.24, 0.64, 0.04);
      part("box", 0x00e5ff, 0.36, 1.54, 0.41, 0.16, 0.10, 0.03, 0, true);
      part("box", 0xffe01b, 0.36, 1.32, 0.41, 0.14, 0.22, 0.03);
      // 下部取货翻板口
      part("box", ink, -0.10, 0.48, 0.37, 0.76, 0.34, 0.08);
      part("box", steel, -0.10, 0.56, 0.40, 0.66, 0.12, 0.04);
    } else if (v === 3) {
      // 【精细道路施工路障】：A字铁架 + 双层反光条纹横板 + 顶部双颗发光琥珀警示闪灯 + 橡胶方底反光锥桶
      for (const lx of [-0.70, 0.70]) {
        part("box", ink, lx, 0.48, -0.10, 0.09, 0.96, 0.07);
        part("box", ink, lx, 0.48, 0.10, 0.09, 0.96, 0.07);
        part("box", steel, lx, 0.05, 0, 0.14, 0.08, 0.44);
      }
      for (const by of [0.84, 0.50]) {
        part("box", 0xff7a00, 0, by, 0, 1.70, 0.20, 0.10);
        for (const sx of [-0.56, 0, 0.56]) {
          part("box", 0xfff7e6, sx, by, 0.01, 0.22, 0.18, 0.11);
        }
      }
      // 顶部两盏发光警示灯
      for (const lx of [-0.68, 0.68]) {
        part("cylinder", ink, lx, 0.99, 0, 0.14, 0.08, 0.14);
        part("sphere", 0xffae19, lx, 1.09, 0, 0.18, 0.18, 0.18, 0, true);
      }
      // 两只带黑色重型橡胶底座与白色反光环的交通锥桶
      for (const [cx, cz] of [[-1.12, 0.26], [1.08, -0.18]]) {
        part("box", ink, cx, 0.04, cz, 0.46, 0.08, 0.46);
        part("cone", 0xff5a1f, cx, 0.38, cz, 0.36, 0.64, 0.36);
        part("cylinder", 0xffffff, cx, 0.44, cz, 0.22, 0.12, 0.22);
      }
    } else if (v === 4) {
      // 【精细英美漫画经典红色电话亭】：石材踏步底座 + 3×4 细格子玻璃窗 + 四面发光 PHONE 顶额 + 亭内公用电话机与听筒 + 拱顶
      const red = 0xcf1e2e;
      part("box", 0x3b4052, 0, 0.07, 0, 1.14, 0.14, 1.14);
      // 四角立柱与底裙
      for (const sx of [-0.46, 0.46]) {
        for (const sz of [-0.46, 0.46]) {
          part("box", red, sx, 1.24, sz, 0.14, 2.24, 0.14);
        }
      }
      part("box", red, 0, 0.38, 0, 1.00, 0.52, 1.00);
      // 透明浅蓝玻璃体与细窗格
      part("box", 0x8adcf7, 0, 1.38, 0, 0.88, 1.48, 0.88);
      for (const gy of [0.96, 1.34, 1.72]) {
        part("box", red, 0, gy, 0.46, 0.86, 0.05, 0.05);
        part("box", red, 0.46, gy, 0, 0.05, 0.05, 0.86);
        part("box", red, -0.46, gy, 0, 0.05, 0.05, 0.86);
      }
      part("box", red, 0, 1.34, 0.46, 0.05, 1.46, 0.05);
      // 亭内清晰可见的银黑公用投币电话机与听筒
      part("box", ink, 0, 1.34, -0.32, 0.32, 0.44, 0.18);
      part("box", steel, 0, 1.44, -0.22, 0.18, 0.14, 0.06);
      part("box", ink, -0.18, 1.36, -0.26, 0.08, 0.28, 0.08);
      // 四面发光 PHONE 顶额 + 经典圆弧顶冠
      part("box", red, 0, 2.24, 0, 1.06, 0.28, 1.06);
      part("box", 0xfff1a8, 0, 2.24, 0.53, 0.74, 0.16, 0.04, 0, true);
      part("box", 0xfff1a8, 0.53, 2.24, 0, 0.04, 0.16, 0.74, 0, true);
      part("box", 0xfff1a8, -0.53, 2.24, 0, 0.04, 0.16, 0.74, 0, true);
      part("box", red, 0, 2.44, 0, 1.12, 0.12, 1.12);
      part("sphere", red, 0, 2.52, 0, 0.92, 0.24, 0.92);
    } else {
      // 【精细夜市/巴扎木条果蔬货箱与陶罐堆】：带角柱与板条的敞口木箱 + 满箱红橙苹果水果 + 细颈双耳陶罐
      const wood = 0xc27b38;
      const darkWood = 0x8a511e;
      // 左侧敞口木条果箱（满载橙子与青瓜）
      part("box", darkWood, -0.34, 0.06, 0, 0.80, 0.08, 0.76, 0.10);
      part("box", wood, -0.34, 0.28, 0, 0.76, 0.42, 0.72, 0.10);
      part("box", darkWood, -0.34, 0.50, 0, 0.82, 0.07, 0.78, 0.10);
      for (const [fx, fz, fcol] of [[-0.50, -0.14, 0xff7a00], [-0.26, -0.12, 0xff5a1f], [-0.42, 0.14, 0xffae19], [-0.18, 0.12, 0x38c958], [-0.34, 0.0, 0xff3b30]]) {
        part("sphere", fcol, fx, 0.56, fz, 0.20, 0.19, 0.20);
      }
      // 右侧错落小木箱与精制宽腹细颈陶罐
      part("box", 0xa86026, 0.44, 0.28, 0.14, 0.64, 0.56, 0.64, -0.24);
      part("box", darkWood, 0.44, 0.28, 0.14, 0.68, 0.08, 0.68, -0.24);
      part("sphere", 0xd64933, 0.44, 0.74, 0.14, 0.40, 0.44, 0.40);
      part("cylinder", 0xb83724, 0.44, 0.98, 0.14, 0.16, 0.14, 0.16);
      part("cylinder", 0xffe01b, 0.44, 1.06, 0.14, 0.22, 0.05, 0.22);
      // 地面旁侧小陶瓮
      part("sphere", 0xe08e36, 0.04, 0.20, 0.56, 0.34, 0.36, 0.34);
      part("cylinder", 0xc27222, 0.04, 0.40, 0.56, 0.16, 0.10, 0.16);
    }
  }

  // 合批实例化行道树（带石材树池 + 多球团漫画树冠）
  addTree(x, ground, z, scale = 1.0, leafColor = 0x2ecc71, planter = true) {
    const s = scale;
    if (planter) {
      this.addSolid("box", 0x8b93a8, [x, ground + 0.18, z], [1.45 * s, 0.36, 1.45 * s]);
      this.addSolid("box", 0x5c3c24, [x, ground + 0.32, z], [1.18 * s, 0.14, 1.18 * s]);
    }
    this.addSolid("cylinder", 0x6b4328, [x, ground + 1.25 * s, z], [0.34 * s, 2.3 * s, 0.34 * s]);
    this.addSolid("foliage", leafColor, [x, ground + 2.85 * s, z], [2.25 * s, 2.05 * s, 2.25 * s], 0.3);
    this.addSolid("foliage", leafColor, [x + 0.55 * s, ground + 2.55 * s, z - 0.38 * s], [1.45 * s, 1.35 * s, 1.45 * s], 1.1);
    this.addSolid("foliage", leafColor, [x - 0.52 * s, ground + 2.62 * s, z + 0.42 * s], [1.35 * s, 1.25 * s, 1.35 * s], 2.0);
  }

  // 街边石材绿篱花坛（大都会金融广场 / 老城运河大道）
  addPlanterHedge(x, ground, z, rotY = 0, leafColor = 0x2ea859) {
    const part = this._makePartHelper(x, ground, z, rotY);
    part("box", 0xc8c2b2, 0, 0.24, 0, 2.1, 0.48, 0.85);
    part("box", 0x999284, 0, 0.50, 0, 2.22, 0.08, 0.94);
    part("foliage", leafColor, -0.52, 0.82, 0, 0.95, 0.78, 0.82, 0.4);
    part("foliage", leafColor, 0.0, 0.92, 0, 1.05, 0.88, 0.85, 1.1);
    part("foliage", leafColor, 0.52, 0.82, 0, 0.95, 0.78, 0.82, 2.0);
  }

  // 美式漫画经典铁艺防火逃生梯（市中心暗巷与公寓楼立面细节）
  addFireEscape(x, ground, z, rotY = 0, floors = 2) {
    const part = this._makePartHelper(x, ground, z, rotY);
    const iron = 0x1a1d28;
    for (let f = 0; f < floors; f++) {
      const y = 3.2 + f * 3.1;
      part("box", iron, 0, y, 0.48, 2.6, 0.10, 0.92);
      part("box", iron, 0, y + 0.48, 0.92, 2.6, 0.08, 0.08);
      part("box", iron, -1.26, y + 0.48, 0.48, 0.08, 0.88, 0.92);
      part("box", iron, 1.26, y + 0.48, 0.48, 0.08, 0.88, 0.92);
      for (const bx of [-0.8, -0.3, 0.2, 0.7]) {
        part("box", iron, bx, y + 0.25, 0.92, 0.06, 0.48, 0.06);
      }
      if (f < floors - 1) {
        part("box", iron, 0.25, y + 1.55, 0.62, 0.14, 3.3, 0.14, 0.35);
      }
    }
  }

  // 工业墨水巨罐（ISSUE #3 墨水工厂专属细节）
  addIndustrialVat(x, ground, z, inkColor = 0x00e5ff) {
    const steel = 0x4b576b;
    const dark = 0x1b202e;
    this.addSolid("cylinder", steel, [x, ground + 1.35, z], [1.65, 2.5, 1.65]);
    this.addSolid("cylinder", dark, [x, ground + 0.18, z], [1.85, 0.36, 1.85]);
    this.addSolid("cylinder", dark, [x, ground + 1.4, z], [1.76, 0.16, 1.76]);
    this.addSolid("cylinder", dark, [x, ground + 2.58, z], [1.82, 0.22, 1.82]);
    this.addEmissive("cylinder", inkColor, [x, ground + 1.92, z], [1.72, 0.42, 1.72]);
    this.addSolid("cylinder", steel, [x, ground + 3.2, z], [0.32, 1.15, 0.32]);
  }

  // 反派实验室能量培养舱 / 服务器机柜（ISSUE #9 半调博士实验室专属细节）
  addLabPod(x, ground, z, rotY = 0, glowColor = 0x00ff99) {
    const part = this._makePartHelper(x, ground, z, rotY);
    const frame = 0x261d3d;
    part("cylinder", frame, 0, 0.24, 0, 1.38, 0.48, 1.38);
    part("cylinder", glowColor, 0, 1.65, 0, 0.98, 2.35, 0.98, 0, true);
    part("cylinder", frame, 0, 2.95, 0, 1.42, 0.42, 1.42);
    part("box", 0xff2ebd, 0, 0.32, 0.66, 0.48, 0.18, 0.12, 0, true);
    part("cylinder", frame, 0, 3.65, 0, 0.26, 1.1, 0.26);
  }

  // 高空天台无线电信号塔与发光警示灯（ISSUE #5 霓虹天台专属细节）
  addRadioMast(x, ground, z, height = 6.5, beaconColor = 0xff2a44) {
    const steel = 0x3b485e;
    this.addSolid("box", 0x222634, [x, ground + 0.4, z], [1.5, 0.8, 1.5]);
    this.addSolid("cylinder", steel, [x, ground + height * 0.5, z], [0.24, height, 0.24]);
    this.addSolid("box", steel, [x, ground + height * 0.42, z], [1.4, 0.12, 0.12]);
    this.addSolid("box", steel, [x, ground + height * 0.68, z], [1.1, 0.12, 0.12]);
    this.addSolid("cone", 0xdce4f0, [x + 0.45, ground + height * 0.62, z], [1.15, 0.48, 1.15], 0.4);
    this.addEmissive("sphere", beaconColor, [x, ground + height + 0.25, z], [0.48, 0.48, 0.48]);
  }

  // 建筑屋顶工业细节（空调机组 / 排风管 / 卫星天线 / 广告钢架）
  addRooftopDetail(variant, x, y, z, bw, bd) {
    const v = ((variant % 4) + 4) % 4;
    const steel = 0x7c8799;
    const dark = 0x242838;
    if (v === 0) {
      this.addSolid("box", steel, [x - bw * 0.18, y + 0.55, z + bd * 0.16], [1.6, 1.0, 1.2]);
      this.addSolid("box", dark, [x - bw * 0.18, y + 0.62, z + bd * 0.16 + 0.62], [0.9, 0.62, 0.08]);
      this.addSolid("box", steel, [x + bw * 0.15, y + 0.45, z - bd * 0.18], [1.3, 0.8, 1.1]);
      this.addSolid("box", 0x5c6678, [x, y + 0.32, z], [bw * 0.45, 0.36, 0.36]);
    } else if (v === 1) {
      this.addSolid("box", dark, [x + bw * 0.12, y + 0.75, z - bd * 0.12], [1.8, 1.4, 1.6]);
      this.addSolid("cylinder", steel, [x - bw * 0.15, y + 1.8, z + bd * 0.15], [0.16, 3.6, 0.16]);
      this.addSolid("cone", 0xdce4f0, [x - bw * 0.15, y + 2.9, z + bd * 0.15], [1.25, 0.55, 1.25]);
    } else if (v === 2) {
      const signColor = bw > bd ? 0xff2ebd : 0x00e5ff;
      this.addSolid("box", dark, [x - bw * 0.25, y + 1.4, z], [0.18, 2.8, 0.18]);
      this.addSolid("box", dark, [x + bw * 0.25, y + 1.4, z], [0.18, 2.8, 0.18]);
      this.addEmissive("box", signColor, [x, y + 2.15, z], [Math.max(2.6, bw * 0.68), 1.45, 0.28]);
      this.addEmissive("box", 0xffe01b, [x, y + 2.15, z + 0.16], [Math.max(2.0, bw * 0.5), 0.72, 0.08]);
    } else {
      this.addSolid("box", 0x6f7e94, [x, y + 0.5, z], [Math.min(3.4, bw * 0.55), 0.9, Math.min(2.6, bd * 0.48)]);
      this.addEmissive("box", 0x9ae8ff, [x, y + 0.96, z], [Math.min(3.0, bw * 0.48), 0.16, Math.min(2.2, bd * 0.42)]);
      this.addSolid("cylinder", dark, [x + bw * 0.22, y + 0.9, z + bd * 0.18], [0.46, 1.6, 0.46]);
    }
  }

  build() {
    const tint = new THREE.Color();
    for (const { shape, material, instances } of this.batches.values()) {
      const mesh = new THREE.InstancedMesh(this.shapes[shape], material, instances.length);
      instances.forEach(({ matrix, color }, index) => {
        mesh.setMatrixAt(index, matrix);
        if (color !== undefined) mesh.setColorAt(index, tint.setHex(color));
      });
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = material.isMeshToonMaterial;
      this.root.add(mesh);
    }
    this.batches.clear();
  }
}
