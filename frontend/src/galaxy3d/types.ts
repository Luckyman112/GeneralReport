/** Срез данных карты (DATA из galaxy-map.html), который нужен 3D-сценам. */

export interface Palette {
  sea?: number[];
  land?: number[];
  high?: number[];
  atmo?: number[];
  cloudCol?: number[];
  cloud?: number;
  src?: string;
}

export interface SystemData {
  id: string;
  name: string;
  kind: string;
  own: string;
  gar: number;
  zones?: number;
  zoneHolders?: Record<string, number>;
  pal?: Palette;
  /** Орбита: "" — пусто, id фракции — её флот стоит у планеты, "battle" — бой флотов. */
  orbit?: string;
  /** Кораблей во флоте владельца орбиты (0 — флота нет). */
  fleet?: number;
  /** Стороны и размер флотов в бою на орбите; по умолчанию — стороны идущего боя. */
  orbitAtt?: string;
  orbitDef?: string;
  fleetAtt?: number;
  fleetDef?: number;
}

export interface FactionData {
  id: string;
  name: string;
  color: string;
  army?: string;
}

/** Силы стороны в бою: пехота (бойцов), техника и авиация (машин). */
export interface Forces {
  inf?: number;
  veh?: number;
  air?: number;
}

export interface BattleData {
  sys: string;
  att: string;
  def: string;
  status: string;
  prog?: number;
  since?: string;
  forces?: { att?: Forces; def?: Forces };
  /** Сектор планеты, где идёт этот бой (1..zones); не задан — первый свободный. */
  zone?: number;
}

export interface BlockadeData {
  a: string;
  b: string;
  fac: string;
  str?: number;
}

/** Именной корабль у планеты (см. catalog.ts::UNIQUE_SHIPS). */
export interface UniqueShipData {
  key: string;
  name: string;
  fac?: string;
}

/** Станция у планеты (см. catalog.ts::STATIONS). */
export interface StationData {
  key: string;
  name: string;
  fac?: string;
}

export interface PlanetPayload {
  uniqueShips?: UniqueShipData[];
  stations?: StationData[];
  sys: SystemData;
  factions: FactionData[];
  /** Идущие бои на планете — их может быть несколько, по одному на сектор. */
  battles: BattleData[];
  blockades: BlockadeData[];
  /** Экранный центр и радиус диска планеты в пикселях холста карты. */
  layout: { x: number; y: number; r: number };
}

export const LIVE_STAGES = new Set(["deploy", "active", "skirmish", "retreat"]);

/** Силы из ручного ввода, а если их нет — из перевеса и гарнизона. */
export function resolveForces(b: BattleData, garrison: number): { att: Required<Forces>; def: Required<Forces> } {
  const prog = Number.isFinite(b.prog) ? (b.prog as number) : 50;
  const base = 12 + Math.min(30, garrison * 2);
  const derive = (share: number): Required<Forces> => ({
    inf: Math.max(4, Math.round(base * (0.35 + share))),
    veh: Math.max(1, Math.round(1 + 4 * share)),
    air: Math.max(1, Math.round(1 + 3 * share)),
  });
  const pick = (manual: Forces | undefined, auto: Required<Forces>): Required<Forces> => ({
    inf: Number.isFinite(manual?.inf) ? Math.max(0, manual!.inf!) : auto.inf,
    veh: Number.isFinite(manual?.veh) ? Math.max(0, manual!.veh!) : auto.veh,
    air: Number.isFinite(manual?.air) ? Math.max(0, manual!.air!) : auto.air,
  });
  return {
    att: pick(b.forces?.att, derive(prog / 100)),
    def: pick(b.forces?.def, derive(1 - prog / 100)),
  };
}
