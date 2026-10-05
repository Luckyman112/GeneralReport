/** Что чем рисуется. Армия — набор моделей, который фракция выставляет на поле
 * боя и в космосе; фракция на карте выбирает армию полем `army` (по умолчанию
 * Республика — клоны, все остальные — дроиды КНС, пока нет своих моделей). */

export type ArmyId = "rep" | "sep";

export interface ModelSpec {
  url: string;
  /** Размер по самой длинной оси (или по высоте для пехоты), в метрах. */
  size: number;
  /** Мерить по высоте, а не по самой длинной оси (пехота в Т-позе шире, чем выше). */
  byHeight?: boolean;
  /** Поворот, чтобы «вперёд» смотрело в +Z. */
  yaw?: number;
}

export const MODELS = {
  b1: { url: "/models/units/b1.glb", size: 1.9, byHeight: true, yaw: 0 },
  atte: { url: "/models/vehicles/atte.glb", size: 13, yaw: 0 },
  aat: { url: "/models/vehicles/aat.glb", size: 9.5, yaw: 0 },
  laat: { url: "/models/ships/laat.glb", size: 17, yaw: Math.PI },
  arc170: { url: "/models/ships/arc170.glb", size: 13, yaw: 0 },
  vulture: { url: "/models/ships/vulture.glb", size: 6, yaw: 0 },
  venator: { url: "/models/ships/venator.glb", size: 1137, yaw: -Math.PI / 2 },
  arquitens: { url: "/models/ships/arquitens.glb", size: 325, yaw: 0 },
  providence: { url: "/models/ships/providence.glb", size: 1088, yaw: 0 },
} satisfies Record<string, ModelSpec>;

export type ModelKey = keyof typeof MODELS;

export interface ArmyRoster {
  label: string;
  /** "trooper" — клон из примитивов (см. trooper.ts). */
  infantry: ModelKey | "trooper";
  vehicle: ModelKey;
  air: ModelKey;
  capital: ModelKey;
  escort: ModelKey;
  fighter: ModelKey;
  bolt: number;
}

export const ARMIES: Record<ArmyId, ArmyRoster> = {
  rep: {
    label: "Республика",
    infantry: "trooper",
    vehicle: "atte",
    air: "laat",
    capital: "venator",
    escort: "arquitens",
    fighter: "arc170",
    bolt: 0x4fb0ff,
  },
  sep: {
    label: "КНС",
    infantry: "b1",
    vehicle: "aat",
    air: "vulture",
    capital: "providence",
    escort: "providence",
    fighter: "vulture",
    bolt: 0xff4a3a,
  },
};

export function armyOf(faction: { id: string; army?: string } | null | undefined): ArmyId {
  if (faction?.army === "rep" || faction?.army === "sep") return faction.army;
  return faction?.id === "rep" ? "rep" : "sep";
}

/** Карты поверхности по типу планеты (из присланных моделей), варианты выбираются по id. */
export const SURFACES: Record<string, { maps: string[]; clouds?: string; recolor?: [number, number, number][] }> = {
  terran: { maps: ["terran-a"], clouds: "clouds-a" },
  ocean: {
    maps: ["terran-a"],
    clouds: "clouds-b",
    recolor: [
      [10, 40, 78],
      [28, 92, 120],
      [170, 205, 210],
    ],
  },
  desert: { maps: ["desert-a", "desert-b", "desert-c"], clouds: "clouds-c" },
  volcanic: { maps: ["volcanic-a"] },
  ice: {
    maps: ["ice-a"],
    clouds: "clouds-a",
    recolor: [
      [120, 150, 180],
      [205, 225, 240],
      [250, 252, 255],
    ],
  },
  urban: { maps: ["urban-a"], clouds: "clouds-c" },
  gas: { maps: ["gas-a", "gas-b"] },
};

/** Текстура земли для диорамы боя — без тёмных рамок по краям (они видны при повторе). */
export const GROUND: Record<string, string> = {
  terran: "terran-a",
  ocean: "terran-a",
  desert: "desert-a",
  volcanic: "volcanic-a",
  ice: "ice-a",
  urban: "ice-a",
  gas: "desert-b",
};

export const ATMOSPHERE: Record<string, number> = {
  terran: 0x78afeb,
  ocean: 0x6eb9f0,
  desert: 0xdcaa6e,
  volcanic: 0xff6a2a,
  ice: 0xcfe6ff,
  urban: 0x9ab8e8,
  gas: 0x8fb8d8,
};

export const surfaceUrl = (name: string) => `/models/planets/${name}.webp`;

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
