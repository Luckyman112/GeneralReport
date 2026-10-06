import * as THREE from "three";
import { armyOf } from "./catalog";
import type { FactionData } from "./types";

/** Модели есть только у Республики и КНС. Любая другая фракция (пираты, Дозор
 * Смерти, банковский клан) воюет чужими корпусами, поэтому её технику красим в
 * её собственный цвет — иначе на карте у всех одинаковые «Провиденсы» и понять,
 * чьи они, нельзя. У самих Республики и КНС корпуса остаются родными. */
export function tintFor(faction: FactionData | null | undefined): THREE.Color | null {
  if (!faction || faction.id === "rep" || faction.id === "sep") return null;
  // у Банковского клана свой фрегат — его не перекрашиваем
  if (armyOf(faction) === "bank") return null;
  try {
    return new THREE.Color(faction.color);
  } catch {
    return null;
  }
}

const cache = new Map<string, THREE.Material>();

/** Подменить материалы копиями, смещёнными к цвету фракции. Копии общие для всех
 * экземпляров одной модели и одного цвета, так что лишних материалов не плодим. */
export function applyTint(obj: THREE.Object3D, color: THREE.Color | null, amount = 0.55) {
  if (!color) return obj;
  const hex = color.getHexString();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.Material | THREE.Material[];
    const one = (mat: THREE.Material): THREE.Material => {
      const key = `${mat.uuid}:${hex}:${amount}`;
      let out = cache.get(key);
      if (!out) {
        out = mat.clone();
        const c = (out as THREE.MeshStandardMaterial).color;
        if (c) c.lerp(color, amount);
        cache.set(key, out);
      }
      return out;
    };
    m.material = Array.isArray(src) ? src.map(one) : one(src);
  });
  return obj;
}
