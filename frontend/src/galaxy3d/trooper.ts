import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Клон-пехотинец из примитивов (присланная модель пришла со сломанным скином).
 * Рост ~1.85 м, лицом в +Z; ноги и руки — на шарнирах для шага и отдачи.
 *
 * Детали собраны в несколько слитых геометрий (одна на материал на подвижный
 * узел) — иначе на поле боя под сотню бойцов выходило бы под тысячу вызовов
 * отрисовки. Геометрии строятся один раз на весь модуль, бойцы их переиспользуют. */
export interface TrooperRig {
  root: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  arms: THREE.Group;
  torso: THREE.Group;
}

const armor = new THREE.MeshStandardMaterial({ color: 0xeceadf, roughness: 0.42, metalness: 0.06 });
const suit = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.92 });
const visor = new THREE.MeshStandardMaterial({ color: 0x070a0d, roughness: 0.18, metalness: 0.7 });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.5, metalness: 0.5 });
const marks = new Map<number, THREE.MeshStandardMaterial>();

type Vec3 = [number, number, number];
interface Place {
  p?: Vec3;
  r?: Vec3;
  s?: Vec3;
}

const mat4 = (t: Place) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...(t.p || [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(t.r || [0, 0, 0]))),
    new THREE.Vector3(...(t.s || [1, 1, 1])),
  );

/** Слить детали в одну геометрию; каждая деталь — своя форма и своё место. */
function weld(parts: [THREE.BufferGeometry, Place][]): THREE.BufferGeometry {
  const geos = parts.map(([g, t]) => g.clone().applyMatrix4(mat4(t)));
  const out = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  if (!out) throw new Error("не удалось собрать деталь бойца");
  out.computeVertexNormals();
  return out;
}

const sph = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/** Капсула лежит вдоль +Z (у Three она по умолчанию вдоль Y). */
const capZ = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 3, 10).rotateX(Math.PI / 2);
const capY = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 3, 10);

/* ---------- голова и корпус (узел torso, его начало — на уровне пояса) ---------- */
const HEAD_Y = 0.66;

// Шлем: купол, выдвинутая вперёд «морда», дыхательный блок, гребень и боковые блоки.
const HELMET: [THREE.BufferGeometry, Place][] = [
  [sph(0.104, 18, 12), { p: [0, HEAD_Y + 0.008, -0.004], s: [1, 1.06, 1.12] }],
  [sph(0.09, 16, 10), { p: [0, HEAD_Y - 0.052, 0.022], s: [0.95, 0.8, 1.08] }],
  [box(0.066, 0.062, 0.05), { p: [0, HEAD_Y - 0.055, 0.094] }],
  [box(0.03, 0.072, 0.056), { p: [-0.102, HEAD_Y - 0.008, -0.008] }],
  [box(0.03, 0.072, 0.056), { p: [0.102, HEAD_Y - 0.008, -0.008] }],
  [capY(0.046, 0.06), { p: [0, HEAD_Y - 0.125, -0.008] }],
];

const TORSO_ARMOR = weld([
  ...HELMET,
  // грудь — бочкообразная, плечевые скосы отдельными шарами
  [sph(0.25, 16, 12), { p: [0, 0.375, 0], s: [1, 0.78, 0.6] }],
  [sph(0.112, 12, 8), { p: [-0.225, 0.435, 0], s: [1, 0.85, 0.95] }],
  [sph(0.112, 12, 8), { p: [0.225, 0.435, 0], s: [1, 0.85, 0.95] }],
  // пояс и набедренные пластины
  [box(0.33, 0.075, 0.235), { p: [0, 0.025, 0] }],
  [box(0.15, 0.16, 0.08), { p: [0, -0.06, 0.1], r: [0.18, 0, 0] }],
  [box(0.13, 0.14, 0.07), { p: [0, -0.05, -0.1], r: [-0.18, 0, 0] }],
  // ранец
  [box(0.195, 0.2, 0.085), { p: [0, 0.36, -0.165] }],
  [capZ(0.028, 0.06), { p: [-0.065, 0.47, -0.2] }],
  [capZ(0.028, 0.06), { p: [0.065, 0.47, -0.2] }],
]);

const TORSO_SUIT = weld([
  // чёрный комбинезон: шея, живот, бёдра под бронёй
  [capY(0.06, 0.09), { p: [0, 0.555, 0] }],
  [capY(0.145, 0.1), { p: [0, 0.16, 0], s: [1, 1, 0.78] }],
  [capY(0.11, 0.08), { p: [0, -0.07, 0], s: [1.35, 1, 0.9] }],
]);

const TORSO_VISOR = weld([
  [box(0.155, 0.046, 0.05), { p: [0, HEAD_Y + 0.02, 0.085] }],
  [box(0.05, 0.1, 0.05), { p: [0, HEAD_Y - 0.032, 0.088] }],
]);

// цветные части — одна геометрия, материал подставляется по фракции
const TORSO_MARK = weld([
  [sph(0.112, 12, 8), { p: [-0.28, 0.44, 0], s: [1, 0.66, 1.02] }],
  [box(0.21, 0.05, 0.04), { p: [0, 0.45, 0.125], r: [0.1, 0, 0] }],
  [box(0.021, 0.058, 0.15), { p: [0, HEAD_Y + 0.072, 0.012], r: [0.12, 0, 0] }],
]);

const TORSO_SHOULDER_R = weld([[sph(0.112, 12, 8), { p: [0.28, 0.44, 0], s: [1, 0.66, 1.02] }]]);

/* ---------- руки: один узел у груди, ствол смотрит вперёд ---------- */
const ARMS_ARMOR = weld([
  [capZ(0.052, 0.17), { p: [-0.185, 0.005, 0.1], r: [0, 0.42, 0] }],
  [capZ(0.047, 0.19), { p: [-0.085, -0.045, 0.28], r: [0.1, 0.9, 0] }],
  [capZ(0.052, 0.16), { p: [0.195, -0.005, 0.085], r: [0, -0.28, 0] }],
  [capZ(0.047, 0.18), { p: [0.115, -0.06, 0.255], r: [0.1, -0.52, 0] }],
  // наплечные манжеты
  [capY(0.058, 0.028), { p: [-0.225, 0.055, 0.015], r: [0, 0, 0.2] }],
  [capY(0.058, 0.028), { p: [0.225, 0.045, 0.01], r: [0, 0, -0.2] }],
]);
const ARMS_SUIT = weld([
  [box(0.075, 0.075, 0.085), { p: [-0.015, -0.062, 0.385], r: [0, 0.28, 0] }],
  [box(0.075, 0.075, 0.085), { p: [0.075, -0.075, 0.345], r: [0, -0.18, 0] }],
]);
const GUN = weld([
  [box(0.07, 0.11, 0.42), { p: [0, 0, 0.05] }],
  [box(0.05, 0.1, 0.1), { p: [0, -0.09, 0.02], r: [0.25, 0, 0] }],
  [new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8).rotateX(Math.PI / 2), { p: [0, 0.015, 0.4] }],
  [box(0.03, 0.05, 0.12), { p: [0, 0.075, 0.08] }],
]);

/* ---------- ноги ---------- */
const THIGH = weld([
  [capY(0.077, 0.26), { p: [0, -0.2, 0] }],
  [sph(0.082, 12, 8), { p: [0, -0.4, 0.01], s: [1, 0.9, 1.05] }],
]);
const SHIN_ARMOR = weld([
  [capY(0.068, 0.24), { p: [0, -0.19, 0] }],
  [box(0.125, 0.13, 0.06), { p: [0, -0.16, 0.055] }],
]);
const SHIN_SUIT = weld([
  [box(0.145, 0.085, 0.23), { p: [0, -0.4, 0.035] }],
  [box(0.13, 0.06, 0.07), { p: [0, -0.43, 0.14] }],
]);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

function leg(side: number) {
  const hip = new THREE.Group();
  hip.position.set(side * 0.1, 0.92, 0);
  hip.add(mesh(THIGH, armor));
  const knee = new THREE.Group();
  knee.position.y = -0.44;
  knee.add(mesh(SHIN_ARMOR, armor), mesh(SHIN_SUIT, suit));
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
  root.add(L.hip, R.hip);

  const torso = new THREE.Group();
  torso.position.y = 1.05;
  torso.add(
    mesh(TORSO_SUIT, suit),
    mesh(TORSO_ARMOR, armor),
    mesh(TORSO_SHOULDER_R, armor),
    mesh(TORSO_MARK, mark),
    mesh(TORSO_VISOR, visor),
  );

  const arms = new THREE.Group();
  arms.position.set(0, 0.38, 0.08);
  const gun = mesh(GUN, gunMat);
  gun.position.set(0.04, 0.0, 0.33);
  arms.add(mesh(ARMS_ARMOR, armor), mesh(ARMS_SUIT, suit), gun);
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
