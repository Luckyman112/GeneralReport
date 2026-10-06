import * as THREE from "three";
import { armyOf } from "./catalog";
import type { FactionData } from "./types";

/** Цвет перекраски фракции. Республика, КНС и Банковский клан воюют своими
 * моделями и не перекрашиваются. У Дозора Смерти и пиратов свои только фрегат
 * (и истребитель у Дозора), остальное взято взаймы: такие модели красятся в цвет
 * фракции, свои — нет (см. catalog.ts::tintForModel). Любая другая фракция целиком
 * воюет чужими корпусами и перекрашивается. */
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
