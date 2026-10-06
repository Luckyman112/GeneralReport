/** Что чем рисуется. Армия — набор моделей, который фракция выставляет на поле
 * боя и в космосе; фракция на карте выбирает армию полем `army` (по умолчанию
 * Республика — клоны, все остальные — дроиды КНС, пока нет своих моделей). */

export type ArmyId = "rep" | "sep" | "bank" | "dw" | "pirate";

export interface ModelSpec {
  url: string;
  /** Длина корпуса (нос–корма) по Вукипедии, в метрах; у пехоты — рост. Мерится
   * именно по оси «вперёд», а не по самой длинной: у ARC-170 и LAAT размах
   * крыльев больше длины, и масштаб по наибольшей оси их ужимал. */
  size: number;
  /** Мерить по высоте (пехота). */
  byHeight?: boolean;
  /** Поворот, чтобы «вперёд» смотрело в +Z. */
  yaw?: number;
  /** Как летает: strafe — только вперёд, заходами в атаку (истребители);
   * hover — зависает и стреляет с места, почти не смещаясь (LAAT). */
  flight?: "strafe" | "hover";
}

export const MODELS = {
  // размеры — Вукипедия (длина, у B1 — рост)
  b1: { url: "/models/units/b1.glb", size: 1.93, byHeight: true, yaw: 0 },
  atte: { url: "/models/vehicles/atte.glb", size: 22.02, yaw: 0 },
  aat: { url: "/models/vehicles/aat.glb", size: 9.19, yaw: 0 },
  // AT-AP — шагоход Республики, ходит вторым типом наземки рядом с AT-TE
  atap: { url: "/models/vehicles/atap.glb", size: 15.24, yaw: 0 },
  // дроид-разрушитель КНС; рост 1.83 м, в бою не больше трёх (решение пользователя)
  droideka: { url: "/models/units/droideka.glb", size: 1.83, byHeight: true, yaw: -Math.PI / 2 },
  laat: { url: "/models/ships/laat.glb", size: 17.69, yaw: Math.PI, flight: "hover" },
  arc170: { url: "/models/ships/arc170.glb", size: 12.71, yaw: 0, flight: "strafe" },
  vulture: { url: "/models/ships/vulture.glb", size: 6.96, yaw: 0, flight: "strafe" },
  // бомбардировщик КНС: не стреляет, только сбрасывает ионные бомбы (решение пользователя)
  hyena: { url: "/models/ships/hyena.glb", size: 12.5, yaw: 0, flight: "strafe" },
  venator: { url: "/models/ships/venator.glb", size: 1137, yaw: -Math.PI / 2 },
  arquitens: { url: "/models/ships/arquitens.glb", size: 325, yaw: 0 },
  providence: { url: "/models/ships/providence.glb", size: 1088, yaw: 0 },
  // фрегат Межгалактического банковского клана — только в их наборе
  munificent: { url: "/models/ships/munificent.glb", size: 825, yaw: 0 },
  // Дозор Смерти: фрегат Lancer (250 м) и истребитель. У концепт-модели истребителя
  // канонической длины нет — взят масштаб мандалорского Fang fighter (10.56 м)
  lancer: { url: "/models/ships/lancer.glb", size: 250, yaw: 0 },
  dwfighter: { url: "/models/ships/dw_fighter.glb", size: 10.56, yaw: -Math.PI / 2, flight: "strafe" },
  // пираты: штурмовой фрегат (Assault Frigate Mk I, 700 м)
  piratefrigate: { url: "/models/ships/pirate_frigate.glb", size: 700, yaw: 0 },
  // станции (раздел «Станции» на карте): XQ6 — Республики, вторая — КНС
  xq6: { url: "/models/stations/xq6.glb", size: 936, yaw: 0 },
  cisstation: { url: "/models/stations/cis_station.glb", size: 936, yaw: 0 },
  // «Раб-1» (Firespray-31) — именной, существует в одном экземпляре: в армии не
  // входит, на карте стоит там, куда его поставили (DATA.uniqueShips). Летит
  // «стоя», 21.5 м — это его вертикальный размер.
  slave1: { url: "/models/ships/slave1.glb", size: 21.5, byHeight: true, yaw: 0 },
} satisfies Record<string, ModelSpec>;

/** Именные корабли — по одному экземпляру на всю галактику. */
export const UNIQUE_SHIPS: Record<string, { model: ModelKey; title: string }> = {
  slave1: { model: "slave1", title: "«Раб-1» (Firespray-31)" },
};

/** Типы станций. В отличие от именных кораблей, станций одного типа может быть сколько угодно. */
export const STATIONS: Record<string, { model: ModelKey; title: string }> = {
  xq6: { model: "xq6", title: "Платформа XQ6" },
  cis: { model: "cisstation", title: "Станция КНС" },
};

export function flightOf(key: ModelKey): "strafe" | "hover" {
  const spec: ModelSpec = MODELS[key];
  return spec.flight || "strafe";
}

export type ModelKey = keyof typeof MODELS;

export interface ArmyRoster {
  label: string;
  /** Пехота — пока не используется (бой идёт техникой на поверхности планеты). */
  infantry: ModelKey | null;
  vehicle: ModelKey;
  /** Второй тип наземки: чередуется с основным. */
  vehicle2?: ModelKey;
  /** Дройдеки и т. п.: выходят впереди техники, не больше трёх за бой. */
  droid?: ModelKey;
  air: ModelKey;
  capital: ModelKey;
  escort: ModelKey;
  fighter: ModelKey;
  /** Бомбардировщик: часть авиации, сбрасывает бомбы вместо стрельбы. */
  bomber?: ModelKey;
  bolt: number;
  /** Свои модели армии: их не перекрашивают в цвет фракции, чужие (взятые взаймы) — перекрашивают. */
  own?: ModelKey[];
}

export const ARMIES: Record<ArmyId, ArmyRoster> = {
  rep: {
    label: "Республика",
    // клоны убраны (решение пользователя), нужна нормальная GLB-модель
    infantry: null,
    vehicle: "atte",
    vehicle2: "atap",
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
    droid: "droideka",
    air: "vulture",
    capital: "providence",
    escort: "providence",
    fighter: "vulture",
    bomber: "hyena",
    bolt: 0xff4a3a,
  },
  // Банковский клан: свой фрегат Munificent (Вукипедия: принадлежность —
  // InterGalactic Banking Clan), остальное — техника КНС, в которую клан входит
  bank: {
    label: "Банковский клан",
    infantry: "b1",
    vehicle: "aat",
    air: "vulture",
    capital: "munificent",
    escort: "munificent",
    fighter: "vulture",
    bomber: "hyena",
    droid: "droideka",
    bolt: 0xff4a3a,
  },
  // Дозор Смерти: свой фрегат и истребитель, наземка взята у КНС и перекрашена
  dw: {
    label: "Дозор Смерти",
    infantry: null,
    vehicle: "aat",
    air: "dwfighter",
    capital: "lancer",
    escort: "lancer",
    fighter: "dwfighter",
    bolt: 0x5fd0ff,
    own: ["lancer", "dwfighter"],
  },
  // пираты: свой фрегат, остальное взаймы (перекрашивается)
  pirate: {
    label: "Пираты",
    infantry: null,
    vehicle: "aat",
    air: "vulture",
    capital: "piratefrigate",
    escort: "piratefrigate",
    fighter: "vulture",
    bolt: 0xffb43a,
    own: ["piratefrigate"],
  },
};

/** Дозор Смерти и пираты узнаются по названию, если армия не выбрана явно. */
export function isDeathWatch(faction: { name?: string } | null | undefined): boolean {
  return /дозор|death\s*watch|мандалор|mandalor/i.test(faction?.name || "");
}
export function isPirates(faction: { name?: string } | null | undefined): boolean {
  return /пират|pirate/i.test(faction?.name || "");
}

/** Банковский клан узнаём по названию — у него нет фиксированного id на карте. */
export function isBankingClan(faction: { name?: string } | null | undefined): boolean {
  return /банков|banking/i.test(faction?.name || "");
}

export function armyOf(faction: { id: string; army?: string; name?: string } | null | undefined): ArmyId {
  const a = faction?.army;
  if (a === "rep" || a === "sep" || a === "dw" || a === "pirate") return a;
  // Munificent — исключительно банковский: чужой фракции его набор не выдаём
  if (a === "bank" || isBankingClan(faction)) return isBankingClan(faction) ? "bank" : "sep";
  if (faction?.id === "rep") return "rep";
  if (isDeathWatch(faction)) return "dw";
  if (isPirates(faction)) return "pirate";
  return "sep";
}

/** Цвет перекраски для конкретной модели: свои модели армии не перекрашиваются. */
export function tintForModel<T>(army: ArmyRoster, key: ModelKey, tint: T | null): T | null {
  return army.own?.includes(key) ? null : tint;
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
