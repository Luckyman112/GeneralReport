import * as THREE from "three";

/** Клон-пехотинец из примитивов (присланная модель пришла со сломанным скином).
 * Рост ~1.85 м, лицом в +Z; ноги/руки — на шарнирах для шага и отдачи. */
export interface TrooperRig {
  root: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  arms: THREE.Group;
  torso: THREE.Group;
}

const armor = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.45, metalness: 0.05 });
const suit = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.9 });
const visor = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.2, metalness: 0.6 });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.5, metalness: 0.5 });
const marks = new Map<number, THREE.MeshStandardMaterial>();

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const G = {
  shin: box(0.15, 0.42, 0.17),
  thigh: box(0.17, 0.42, 0.19),
  boot: box(0.16, 0.1, 0.26),
  pelvis: box(0.36, 0.2, 0.22),
  belly: box(0.3, 0.22, 0.2),
  chest: box(0.42, 0.3, 0.26),
  pauldron: box(0.14, 0.08, 0.2),
  upperArm: box(0.11, 0.11, 0.3),
  foreArm: box(0.1, 0.1, 0.3),
  helmet: new THREE.SphereGeometry(0.135, 16, 12),
  dome: new THREE.CylinderGeometry(0.13, 0.14, 0.12, 16),
  visorH: box(0.2, 0.045, 0.04),
  visorV: box(0.05, 0.12, 0.04),
  gunBody: box(0.07, 0.11, 0.6),
  gunBarrel: new THREE.CylinderGeometry(0.02, 0.02, 0.32, 8),
  stripe: box(0.43, 0.05, 0.27),
};

function m(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function leg(side: number) {
  const hip = new THREE.Group();
  hip.position.set(side * 0.1, 0.92, 0);
  hip.add(m(G.thigh, armor, 0, -0.21, 0));
  const knee = new THREE.Group();
  knee.position.y = -0.44;
  knee.add(m(G.shin, armor, 0, -0.2, 0), m(G.boot, suit, 0, -0.43, 0.04));
  hip.add(knee);
  return { hip, knee };
}

export function makeTrooper(markColor = 0x2f6fd0): TrooperRig {
  let mark = marks.get(markColor);
  if (!mark) {
    mark = new THREE.MeshStandardMaterial({ color: markColor, roughness: 0.5 });
    marks.set(markColor, mark);
  }
  const root = new THREE.Group();
  const L = leg(-1);
  const R = leg(1);
  root.add(L.hip, R.hip, m(G.pelvis, suit, 0, 0.98, 0));

  const torso = new THREE.Group();
  torso.position.y = 1.05;
  torso.add(
    m(G.belly, armor, 0, 0.13, 0),
    m(G.chest, armor, 0, 0.38, 0),
    m(G.stripe, mark, 0, 0.47, 0),
    m(G.pauldron, mark, -0.27, 0.5, 0),
    m(G.pauldron, armor, 0.27, 0.5, 0),
  );
  const head = new THREE.Group();
  head.position.y = 0.66;
  head.add(m(G.helmet, armor), m(G.dome, armor, 0, 0.05, 0), m(G.visorH, visor, 0, 0.02, 0.12), m(G.visorV, visor, 0, -0.03, 0.125));
  torso.add(head);

  // руки и бластер — одним узлом у груди: целится вперёд, отдача двигает весь узел
  const arms = new THREE.Group();
  arms.position.set(0, 0.38, 0.08);
  const ua1 = m(G.upperArm, armor, -0.22, 0, 0.1);
  ua1.rotation.y = 0.5;
  const fa1 = m(G.foreArm, armor, -0.1, -0.03, 0.3);
  fa1.rotation.y = 0.9;
  const ua2 = m(G.upperArm, armor, 0.22, 0, 0.08);
  ua2.rotation.y = -0.35;
  const fa2 = m(G.foreArm, armor, 0.13, -0.05, 0.26);
  fa2.rotation.y = -0.6;
  const gun = new THREE.Group();
  gun.position.set(0.04, 0.02, 0.32);
  const barrel = m(G.gunBarrel, gunMat, 0, 0.02, 0.42);
  barrel.rotation.x = Math.PI / 2;
  gun.add(m(G.gunBody, gunMat), barrel);
  arms.add(ua1, fa1, ua2, fa2, gun);
  torso.add(arms);
  root.add(torso);
  return { root, hipL: L.hip, hipR: R.hip, kneeL: L.knee, kneeR: R.knee, arms, torso };
}

/** Бег — шаг ногами и наклон корпуса; на месте — стойка и отдача после выстрела. */
export function poseTrooper(r: TrooperRig, running: boolean, t: number, recoil: number) {
  const s = running ? Math.sin(t * 9) : 0;
  r.hipL.rotation.x = s * 0.7;
  r.hipR.rotation.x = -s * 0.7;
  r.kneeL.rotation.x = running ? Math.max(0, Math.sin(t * 9 + 1.6)) * 0.9 : 0.25;
  r.kneeR.rotation.x = running ? Math.max(0, -Math.sin(t * 9 + 1.6)) * 0.9 : 0.25;
  r.torso.rotation.x = running ? 0.18 : 0.06;
  r.torso.position.y = 1.05 + (running ? Math.abs(s) * 0.04 : 0) - (running ? 0 : 0.06);
  r.arms.position.z = 0.08 - recoil * 0.06;
  r.arms.rotation.x = -recoil * 0.12;
}
