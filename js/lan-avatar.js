import * as THREE from "three";

export const PLAYER_COLORS = [0x29c6ff, 0xff5c63, 0xffce39, 0x6de98c];

export function createLanAvatar(assets, tint) {
  const root = new THREE.Group();
  const part = (w, h, d, x, y, z, color) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), assets.toonMat({ color }));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    assets.addOutline(mesh, 1.08);
    root.add(mesh);
    return mesh;
  };
  const leftLeg = part(0.23, 0.72, 0.28, -0.18, 0.37, 0, 0x232332);
  const rightLeg = part(0.23, 0.72, 0.28, 0.18, 0.37, 0, 0x232332);
  const body = part(0.68, 0.73, 0.43, 0, 1.08, 0, tint);
  const head = part(0.48, 0.49, 0.46, 0, 1.69, 0, tint);
  part(0.38, 0.15, 0.05, 0, 1.73, -0.23, 0x151522);
  const leftArm = part(0.18, 0.57, 0.23, -0.44, 1.14, 0, tint);
  const rightArm = part(0.19, 0.24, 0.56, 0.44, 1.28, -0.18, tint);
  part(0.16, 0.17, 0.52, 0.44, 1.33, -0.49, 0x232332);
  return { root, head, leftLeg, rightLeg, hitboxes: [body, head, leftLeg, rightLeg, leftArm, rightArm] };
}
