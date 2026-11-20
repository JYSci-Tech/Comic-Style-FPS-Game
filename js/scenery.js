import * as THREE from "three";
import { CELL_SIZE } from "./levels.js";

const CHUNK_SIZE = CELL_SIZE * 8;

export class StreetScenery {
  constructor(root, assets) {
    this.root = root;
    this.solidMaterial = assets.toonMat();
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
      cab,
    };
    this.batches = new Map();
  }

  addSolid(shape, color, position, scale) {
    this.add(shape, this.solidMaterial, position, scale, color);
  }

  add(shape, material, position, scale, color) {
    const [x, , z] = position;
    const key = [shape, material.id, Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)].join(":");
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { shape, material, instances: [] };
      this.batches.set(key, batch);
    }
    const matrix = new THREE.Matrix4().makeScale(...scale).setPosition(...position);
    batch.instances.push({ matrix, color });
  }

  addVehicle(type, x, ground, z) {
    const taxi = type === 0;
    const van = type === 1;
    const paint = taxi ? 0xffcb26 : van ? 0xcb303d : 0x2357a8;
    const ink = 0x20222d;
    const steel = 0x9ba8bd;
    const cream = 0xffe6b6;
    const part = (shape, color, dx, y, dz, w, h, d) => {
      this.addSolid(shape, color, [x + dx, ground + y, z + dz], [w, h, d]);
    };
    const box = (color, dx, y, dz, w, h, d) => part("box", color, dx, y, dz, w, h, d);

    box(ink, 0, 0.34, 0, 2.48, 0.25, 2.94);
    box(paint, 0, 0.64, 0, 2.66, 0.48, 3.01);
    box(steel, 0, 0.45, -1.52, 2.57, 0.14, 0.14);
    box(steel, 0, 0.45, 1.52, 2.57, 0.14, 0.14);
    box(ink, 0, 0.67, -1.515, 1.26, 0.18, 0.07);

    for (const side of [-1, 1]) {
      box(cream, side * 0.96, 0.70, -1.52, 0.43, 0.17, 0.10);
      box(0xff5644, side * 0.99, 0.67, 1.53, 0.39, 0.17, 0.10);
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

    part("cab", 0x36596d, 0, 1.11, 0.05, 2.17, 0.53, 1.82);
    box(taxi ? paint : cream, 0, 1.397, 0.05, 1.82, 0.07, 1.33);
    for (const side of [-1, 1]) {
      box(ink, side * 1.03, 1.095, 0.06, 0.07, 0.46, 0.12);
      box(paint, side * 1.23, 1.02, -0.55, 0.20, 0.11, 0.19);
    }
    box(ink, 0, 1.47, 0.05, 0.95, 0.10, 0.32);
    if (taxi) {
      box(cream, 0, 1.55, 0.05, 0.74, 0.15, 0.25);
    } else {
      box(0xff4753, -0.24, 1.54, 0.05, 0.43, 0.12, 0.25);
      box(0x19ceff, 0.24, 1.54, 0.05, 0.43, 0.12, 0.25);
    }
  }

  addStreetFixture(isLamp, x, ground, z) {
    const part = (shape, color, dx, y, w, h, d) => {
      this.addSolid(shape, color, [x + dx, ground + y, z], [w, h, d]);
    };
    if (isLamp) {
      const metal = 0x1c202c;
      part("cylinder", metal, 0, 0.12, 0.48, 0.24, 0.48);
      part("cylinder", metal, 0, 2.06, 0.16, 3.92, 0.16);
      part("cylinder", 0x8c9aa9, 0, 0.84, 0.23, 0.12, 0.23);
      part("box", metal, 0.43, 3.94, 0.93, 0.10, 0.10);
      part("box", metal, 0.90, 3.88, 0.58, 0.17, 0.38);
      part("box", 0xffd87a, 0.90, 3.76, 0.47, 0.09, 0.30);
    } else {
      const red = 0xdc3a43;
      part("cylinder", 0x6e2835, 0, 0.06, 0.48, 0.12, 0.48);
      part("cylinder", red, 0, 0.37, 0.33, 0.63, 0.33);
      part("cylinder", red, 0, 0.70, 0.42, 0.12, 0.42);
      part("wheel", 0xff8b71, 0, 0.44, 0.53, 0.23, 0.23);
      part("cylinder", 0xffb76c, 0, 0.79, 0.16, 0.07, 0.16);
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
