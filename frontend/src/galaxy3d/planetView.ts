import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { instantiate, loadModel } from "./assets";
import { ARMIES, STATIONS, UNIQUE_SHIPS, armyOf, flightOf, hashStr, tintForModel, type ArmyRoster, type ModelKey } from "./catalog";
import { Planet, SUN_DIR, zoneLayout } from "./planet";
import { applyTint, tintFor } from "./tint";
import { LIVE_STAGES, resolveForces, type BattleData, type FactionData, type Forces, type PlanetPayload } from "./types";

/* Масштабы. Модели приведены к длине по Вукипедии (assets.ts), дальше один
 * коэффициент на класс: крупные корабли (Венатор ≈ 0.1 радиуса планеты), малые
 * (истребители — иначе их не видно) и наземная техника. Внутри класса
 * пропорции настоящие: Аркитенс в 3.5 раза короче Венатора. */
const SHIP_K = 0.1 / 1137;
const FIGHTER_K = 0.014 / 12.71;
const GROUND_K = 0.0014;
/** Дройдек в одном бою не больше трёх (решение пользователя). */
const DROID_MAX = 3;
/** Пехоты на сторону: две на каждую машину, от 2 до 8. */
const INFANTRY_MAX = 8;
/** Станции крупнее кораблей того же размера не рисуем: тот же коэффициент, что у кораблей. */
const STATION_K = SHIP_K;
/** Камера при спуске к бою: высота над поверхностью (в радиусах планеты). */
const SURFACE_ALT = 0.5;
/** Половина поля боя по долготе (доля оборота) и по широте. */
const FIELD_U = 0.022;
const FIELD_V = 0.035;
/** Пауза между выстрелами одной стороны, секунды (решение пользователя). */
const FIRE_MIN = 0.5;
const FIRE_MAX = 1.5;

interface Bolt {
  line: THREE.Line;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  impact: number;
  parent: THREE.Object3D;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  size: number;
}

let ionTex: THREE.Texture | null = null;
function ionTexture(): THREE.Texture {
  if (ionTex) return ionTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(235,250,255,1)");
  grad.addColorStop(0.3, "rgba(120,200,255,.85)");
  grad.addColorStop(1, "rgba(60,120,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  ionTex = new THREE.CanvasTexture(c);
  return ionTex;
}

/** Истребитель на орбите: только вперёд — заход на врага и дальше, без кругов. */
interface Fighter {
  obj: THREE.Object3D;
  side: 0 | 1;
  home: THREE.Vector3;
  goal: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  fired: boolean;
  bomber: boolean;
}

/** Ионная бомба: светящийся заряд летит к цели и рвётся голубой вспышкой. */
interface Bomb {
  sprite: THREE.Sprite;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  size: number;
  parent: THREE.Object3D;
}

/** strafe — заход над полем по прямой с пикированием; hover — висит у своих (LAAT). */
interface AirState {
  kind: "strafe" | "hover";
  v: number;
  t: number;
  dur: number;
  wait: number;
  phase: number;
  bomber?: boolean;
  dropped?: boolean;
}

interface GroundUnit {
  obj: THREE.Object3D;
  side: 0 | 1;
  u: number;
  v: number;
  u1: number;
  dir: 1 | -1;
  speed: number;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  air?: AirState;
}

interface Battle {
  att: string;
  def: string;
  forces: { att: Required<Forces>; def: Required<Forces> };
  u: number;
  v: number;
  sector: number; // номер сектора (1..), 0 — планета не поделена и бой один
  zoneIndex: number; // индекс сектора для подсветки, -1 — нет
  rosters: [ArmyRoster, ArmyRoster];
  tints: [THREE.Color | null, THREE.Color | null];
  bombard: boolean;
  labels: [string, string];
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

const WEDGE: [number, number, number][] = [
  [0, 0, 0],
  [1, 0.5, -0.8],
  [1, -0.4, 0.8],
  [2, 0.7, -1.6],
  [2, -0.6, 1.6],
  [2, 0.1, 0],
  [3, 0.6, -0.8],
  [3, -0.5, 0.8],
  [4, 0.2, -1.6],
  [4, -0.1, 1.6],
];

let flashTex: THREE.Texture | null = null;
function flashTexture(): THREE.Texture {
  if (flashTex) return flashTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,240,1)");
  grad.addColorStop(0.25, "rgba(255,200,120,.85)");
  grad.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  flashTex = new THREE.CanvasTexture(c);
  return flashTex;
}

/** Корабль в каноническом размере: k — коэффициент класса (SHIP_K/FIGHTER_K). */
async function ship(key: ModelKey, k: number, tint: THREE.Color | null): Promise<THREE.Object3D | null> {
  try {
    const o = instantiate(await loadModel(key));
    o.scale.setScalar(k);
    return applyTint(o, tint);
  } catch {
    return null;
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const cooldown = () => rand(FIRE_MIN, FIRE_MAX);

/** Разворот в координатах поверхности: вверх — от центра планеты, вперёд — fwd. */
function orient(obj: THREE.Object3D, pos: THREE.Vector3, fwd: THREE.Vector3) {
  const up = pos.clone().normalize();
  const f = fwd.clone().projectOnPlane(up).normalize();
  const right = new THREE.Vector3().crossVectors(up, f).normalize();
  obj.position.copy(pos);
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, f));
}

/** Направление «на восток» (рост долготы u) в точке поверхности. */
function east(u: number): THREE.Vector3 {
  const phi = u * Math.PI * 2;
  return new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
}

/** Вид планеты. Орбита: планета целиком, флоты стоят строем и стреляют, в
 * секторах с боями разрывы; атакующие бьют по планете с орбиты, только если
 * орбита за ними (не бой флотов) и у кого-то нет авиации. Клик по сектору с
 * боем — спуск к нему: техника стоит и перестреливается, истребители заходят
 * в атаку по прямой, LAAT висит над своими. */
export class PlanetView {
  onPlanetClick: (() => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.005, 100);
  private controls: OrbitControls;
  private planet: Planet | null = null;
  private fleet = new THREE.Group();
  private fx = new THREE.Group();
  private ground = new THREE.Group();
  private bobbers: { obj: THREE.Object3D; base: THREE.Vector3; phase: number }[] = [];
  private stations: THREE.Object3D[] = [];
  private fighters: Fighter[] = [];
  private gunners: [THREE.Object3D[], THREE.Object3D[]] = [[], []];
  private bombers = new Map<string, THREE.Object3D[]>();
  private boltColor: [number, number] = [0x4fb0ff, 0xff4a3a];
  private bolts: Bolt[] = [];
  private flashes: Flash[] = [];
  private bombs: Bomb[] = [];
  private units: GroundUnit[] = [];
  private battles: Battle[] = [];
  private current: Battle | null = null;
  private nextFire = new Map<string, number>();
  private legend: HTMLDivElement;
  private backBtn: HTMLButtonElement;
  private orbitLegend = "";
  private raf = 0;
  private clock = new THREE.Timer();
  private time = 0;
  private layout = { x: 0, y: 0, r: 200 };
  private orbitDist = 5;
  private token = 0;
  private visible = false;
  private down: { x: number; y: number } | null = null;
  private mode: "orbit" | "surface" = "orbit";
  private camAnim: { p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; t: number; dur: number } | null =
    null;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const c = this.renderer.domElement;
    c.className = "g3d-canvas";
    host.appendChild(c);

    this.legend = document.createElement("div");
    this.legend.className = "g3d-legend";
    this.legend.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-sector-battle]");
      if (b) this.goToBattle(this.battles[Number(b.dataset.sectorBattle)]);
    });
    host.appendChild(this.legend);

    this.backBtn = document.createElement("button");
    this.backBtn.type = "button";
    this.backBtn.className = "g3d-back";
    this.backBtn.textContent = "↑ К орбите";
    this.backBtn.hidden = true;
    this.backBtn.addEventListener("click", () => this.exitSurface());
    host.appendChild(this.backBtn);

    this.scene.add(new THREE.HemisphereLight(0xbfd2ee, 0x1a2230, 1.4));
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(10);
    this.scene.add(sun);
    this.scene.add(this.fleet, this.fx);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 1.2);
    fill.position.set(0, 0.3, 1);
    this.camera.add(fill);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, c);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.rotateSpeed = 0.45;
    this.orbitControls();

    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  isSurface() {
    return this.mode === "surface";
  }

  /** Ограничения камеры на орбите. Раньше после спуска оставался предел
   * дальности 1.4, и «К орбите» застревало у самой планеты (баг-репорт). */
  private orbitControls() {
    this.controls.enableZoom = false;
    this.controls.minDistance = 0;
    this.controls.maxDistance = Infinity;
  }

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  /** Точка попадания по планете (в координатах поверхности) или null. */
  private hitSurface(e: PointerEvent): THREE.Vector3 | null {
    if (!this.planet) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
    if (!hit) return null;
    this.planet.group.updateMatrixWorld(true);
    return this.planet.surfaceNode.worldToLocal(hit);
  }

  /** Бой в секторе под курсором; если планета не поделена — ближайший. */
  private battleAt(local: THREE.Vector3): Battle | null {
    if (!this.battles.length) return null;
    const u = (((Math.atan2(local.z, -local.x) / (Math.PI * 2)) % 1) + 1) % 1;
    const n = this.planet?.zoneCount || 0;
    if (n > 0) {
      const inSector = this.battles.find((b) => b.zoneIndex === Math.floor(u * n));
      if (inSector) return inSector;
      return this.battles.length === 1 ? this.battles[0] : null;
    }
    const d = (b: Battle) => Math.min(Math.abs(b.u - u), 1 - Math.abs(b.u - u));
    return [...this.battles].sort((a, b) => d(a) - d(b))[0];
  }

  private onMove = (e: PointerEvent) => {
    if (this.down) return;
    const local = this.mode === "orbit" && this.battles.length ? this.hitSurface(e) : null;
    this.renderer.domElement.style.cursor = local && this.battleAt(local) ? "pointer" : "";
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || this.mode !== "orbit" || this.camAnim) return;
    const local = this.hitSurface(e);
    if (!local) return;
    const b = this.battleAt(local);
    if (b) this.goToBattle(b);
    else if (this.battles.length) this.toast("В этом секторе тихо. Бои идут в секторах " + this.battles.map((x) => x.sector).join(", "));
    else this.onPlanetClick?.();
  };

  private toast(text: string) {
    const t = document.createElement("div");
    t.className = "g3d-toast";
    t.textContent = text;
    this.host.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  private resize = () => {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, w / 2 - this.layout.x, h / 2 - this.layout.y, w, h);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    this.orbitDist = h / 2 / (this.layout.r * Math.tan(fov / 2));
    if (this.mode === "orbit" && !this.camAnim) this.camera.position.setLength(this.orbitDist);
    this.camera.updateProjectionMatrix();
  };

  private onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else if (this.visible) this.loop();
  };

  setLayout(l: { x: number; y: number; r: number }) {
    this.layout = l;
    this.resize();
  }

  async show(p: PlanetPayload) {
    const token = ++this.token;
    this.clear();
    this.layout = p.layout;
    this.mode = "orbit";
    this.camera.position.set(0, 0.32, 5);
    this.controls.target.set(0, 0, 0);
    this.resize();

    const fac = (fid: string): FactionData => p.factions.find((f) => f.id === fid) || { id: fid, name: fid, color: "#7a8ea5" };
    const colorOf = (fid: string) => fac(fid).color;
    const roster = (fid: string): ArmyRoster => ARMIES[armyOf(fac(fid))];
    const tag = (fid: string) => `<span style="color:${colorOf(fid)}">${fac(fid).name}</span>`;
    const sys = p.sys;
    const lives: BattleData[] = (p.battles || []).filter((b) => LIVE_STAGES.has(b.status));

    this.planet = new Planet(sys);
    this.planet.setZones(zoneLayout(sys, colorOf, []));
    this.planet.surfaceNode.add(this.ground);
    this.scene.add(this.planet.group);
    this.visible = true;
    this.loop();

    const lead = lives[0] || null;
    const orbit = sys.orbit ?? (lead ? "battle" : "");

    // сектор каждого боя: заданный в бою, иначе первый свободный
    const n = this.planet.zoneCount;
    const used = new Set<number>();
    const wanted = lives.map((b) => (n && b.zone && b.zone >= 1 && b.zone <= n ? b.zone - 1 : -1));
    wanted.forEach((z) => z >= 0 && used.add(z));
    this.battles = lives.map((lb, i) => {
      let z = wanted[i];
      if (n && z < 0) {
        z = [...Array(n).keys()].find((k) => !used.has(k)) ?? i % n;
        used.add(z);
      }
      const forces = resolveForces(lb, sys.gar || 0);
      const u = n ? (z + 0.5) / n : lives.length > 1 ? (i + 0.5) / lives.length : (hashStr(sys.id) % 1000) / 1000;
      return {
        att: lb.att,
        def: lb.def,
        forces,
        u,
        v: 0.47,
        sector: n ? z + 1 : lives.length > 1 ? i + 1 : 0,
        zoneIndex: n ? z : -1,
        rosters: [roster(lb.att), roster(lb.def)],
        tints: [tintFor(fac(lb.att)), tintFor(fac(lb.def))],
        // обстрел с орбиты: орбита за атакующими (не бой флотов) и у кого-то нет авиации
        bombard: orbit === lb.att && (forces.att.air === 0 || forces.def.air === 0),
        labels: [tag(lb.att), tag(lb.def)],
      };
    });
    this.planet.setHot(this.battles.map((b) => b.zoneIndex));

    const lines: string[] = [];
    if (orbit === "battle") {
      const att = sys.orbitAtt || lead?.att || "";
      const def = sys.orbitDef || lead?.def || sys.own;
      if (att && def && att !== def) {
        const nA = Math.max(1, Math.min(8, sys.fleetAtt ?? 3));
        const nD = Math.max(1, Math.min(8, sys.fleetDef ?? 3));
        this.boltColor = [roster(att).bolt, roster(def).bolt];
        const tA = tintFor(fac(att)), tD = tintFor(fac(def));
        const homeA = new THREE.Vector3(0.62, 0.3, 1.45);
        const homeD = new THREE.Vector3(-0.62, 0.18, 1.38);
        if (!(await this.formation(roster(att), nA, homeA, -1, token, 0, tA))) return;
        if (!(await this.formation(roster(def), nD, homeD, 1, token, 1, tD))) return;
        await this.attackRuns(roster(att), roster(def), Math.min(6, 1 + nA), Math.min(6, 1 + nD), homeA, homeD, token, [tA, tD]);
        if (token !== this.token) return;
        lines.push(`<b>Орбита</b> бой флотов: ${tag(att)} против ${tag(def)}`);
      }
    } else if (orbit) {
      const nShips = Math.max(0, Math.min(10, sys.fleet ?? 0));
      if (nShips > 0) {
        const before = this.fleet.children.length;
        if (!(await this.formation(roster(orbit), nShips, new THREE.Vector3(0.62, 0.34, 1.42), -1, token, null, tintFor(fac(orbit))))) return;
        this.bombers.set(orbit, this.fleet.children.slice(before));
        lines.push(`<b>Орбита</b> ${tag(orbit)} · флот ${nShips} кор.`);
      } else lines.push(`<b>Орбита</b> под контролем ${tag(orbit)}, флота нет`);
    }
    // без кораблей на орбите обстреливать нечем
    for (const b of this.battles) if (b.bombard && !this.bombers.get(b.att)?.length) b.bombard = false;

    for (const bl of p.blockades) {
      const other = bl.a === sys.id ? bl.b : bl.a;
      const h = hashStr(other);
      const sign: 1 | -1 = h % 2 ? 1 : -1;
      const tip = new THREE.Vector3(sign * (1.25 + ((h >> 3) % 20) / 100), 0.5 * (((h >> 8) % 3) - 1) * 0.4, 0.95);
      const cnt = Math.min(6, Math.max(1, Math.round(bl.str || 1)));
      if (!(await this.formation(roster(bl.fac), cnt, tip, sign === 1 ? -1 : 1, token, null, tintFor(fac(bl.fac))))) return;
      lines.push(`<b>Блокада</b> ${tag(bl.fac)} · ${cnt} кор.`);
    }

    // именные корабли — ровно один экземпляр, висит у планеты чуть в стороне
    for (const [i, u] of (p.uniqueShips || []).entries()) {
      const spec = UNIQUE_SHIPS[u.key];
      if (!spec) continue;
      const s = await ship(spec.model, FIGHTER_K * 1.6, u.fac ? tintFor(fac(u.fac)) : null);
      if (token !== this.token) return;
      if (!s) continue;
      const pos = new THREE.Vector3(-0.25 - i * 0.12, 0.62, 1.42);
      s.position.copy(pos);
      s.lookAt(pos.clone().add(new THREE.Vector3(1, -0.15, 0.4)));
      this.fleet.add(s);
      this.bobbers.push({ obj: s, base: pos, phase: i * 2.3 });
      lines.push(`<b>Именной корабль</b> ${u.name || spec.title}${u.fac ? " · " + tag(u.fac) : ""}`);
    }

    // станции висят ниже плоскости флотов и медленно вращаются
    for (const [i, st] of (p.stations || []).entries()) {
      const spec = STATIONS[st.key];
      if (!spec) continue;
      const own = st.key === "xq6" ? "rep" : "sep";
      const tint = st.fac && armyOf(fac(st.fac)) !== own ? tintFor(fac(st.fac)) : null;
      const s = await ship(spec.model, STATION_K, tint);
      if (token !== this.token) return;
      if (!s) continue;
      const side = i % 2 ? 1 : -1;
      const pos = new THREE.Vector3(side * (0.95 + Math.floor(i / 2) * 0.22), -0.42 - Math.floor(i / 2) * 0.05, 1.2);
      s.position.copy(pos);
      s.rotation.x = 0.35;
      this.fleet.add(s);
      this.bobbers.push({ obj: s, base: pos, phase: i * 1.3 + 0.5 });
      this.stations.push(s);
      lines.push(`<b>Станция</b> ${st.name || spec.title}${st.fac ? " · " + tag(st.fac) : ""}`);
    }

    if (sys.zones) {
      const held = Object.entries(sys.zoneHolders || {}).filter(([, k]) => k > 0);
      lines.push(`<b>Поверхность</b> ${held.map(([fid, k]) => `${tag(fid)} ${k}/${sys.zones}`).join(" · ")}`);
    } else if (sys.own) lines.push(`<b>Поверхность</b> ${tag(sys.own)}`);
    this.battles.forEach((b, i) => {
      const where = b.sector ? `сектор ${b.sector}` : "наземный бой";
      lines.push(
        `<button type="button" class="g3d-sector" data-sector-battle="${i}">⚔ ${where}</button> ${b.labels[0]} против ${b.labels[1]}` +
          (b.bombard ? ` <span class="g3d-cta">☄ обстрел с орбиты</span>` : ""),
      );
    });
    if (this.battles.length) lines.push(`<span class="g3d-cta">Нажмите на сектор с боем, чтобы спуститься к нему</span>`);
    this.orbitLegend = lines.join("<br>");
    this.setLegend(this.orbitLegend);
  }

  /* ---------- спуск к бою ---------- */

  private goToBattle(b: Battle | undefined) {
    if (!b || !this.planet) return;
    if (this.mode === "surface" && this.current === b) return;
    this.enterSurface(b);
  }

  private async enterSurface(b: Battle) {
    const planet = this.planet!;
    const token = this.token;
    this.mode = "surface";
    this.current = b;
    planet.spinning = false;
    planet.setCloseUp(true);
    this.fleet.visible = false;
    this.clearBolts();
    for (const u of this.units) this.ground.remove(u.obj);
    this.units = [];
    this.renderer.domElement.style.cursor = "";

    planet.group.updateMatrixWorld(true);
    const target = planet.surfaceNode.localToWorld(Planet.point(b.u, b.v, 1));
    const up = target.clone().normalize();
    const north = new THREE.Vector3(0, 1, 0).projectOnPlane(up).normalize();
    // пологий ракурс с юга: линия фронта идёт слева направо
    const pos = target.clone().addScaledVector(up, SURFACE_ALT * 0.42).addScaledVector(north, -SURFACE_ALT * 0.9);
    this.controls.enableZoom = true;
    this.controls.minDistance = 0.12;
    this.controls.maxDistance = 1.4;
    this.flyTo(pos, target, 1.4);

    const f = b.forces;
    const cnt = (x: Required<Forces>) => `техника ${Math.min(6, x.veh)} · авиация ${Math.min(3, x.air)}`;
    const others = this.battles
      .map((x, i) => (x === b ? "" : `<button type="button" class="g3d-sector" data-sector-battle="${i}">→ сектор ${x.sector}</button>`))
      .filter(Boolean)
      .join(" ");
    this.setLegend(
      `<b>Наземный бой</b>${b.sector ? ` · сектор ${b.sector}` : ""}<br>${b.labels[0]} против ${b.labels[1]}<br>` +
        `<span class="g3d-dim">атака: ${cnt(f.att)} · оборона: ${cnt(f.def)}</span>` +
        (others ? `<br>${others}` : ""),
    );
    this.backBtn.hidden = false;
    await this.spawnGround(b, token);
  }

  exitSurface() {
    if (this.mode !== "surface" || !this.planet) return;
    this.mode = "orbit";
    this.current = null;
    this.planet.spinning = true;
    this.planet.setCloseUp(false);
    this.fleet.visible = true;
    this.clearBolts();
    for (const u of this.units) this.ground.remove(u.obj);
    this.units = [];
    this.orbitControls();
    const pos = new THREE.Vector3(0, 0.32, 5).normalize().multiplyScalar(this.orbitDist);
    this.flyTo(pos, new THREE.Vector3(), 1.1);
    this.setLegend(this.orbitLegend);
    this.backBtn.hidden = true;
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur: number) {
    this.controls.enabled = false;
    this.camAnim = { p0: this.camera.position.clone(), p1: pos, t0: this.controls.target.clone(), t1: target, t: 0, dur };
  }

  private async spawnGround(b: Battle, token: number) {
    const jobs: Promise<void>[] = [];
    for (const side of [0, 1] as const) {
      const r = b.rosters[side];
      const n = side === 0 ? b.forces.att : b.forces.def;
      const dir: 1 | -1 = side === 0 ? 1 : -1;
      const veh = Math.min(6, n.veh);
      for (let i = 0; i < veh; i++) {
        const v = b.v + FIELD_V * ((i - (veh - 1) / 2) / Math.max(1, veh - 1)) * 1.6 + rand(-0.004, 0.004);
        const key = r.vehicle2 && i % 2 === 1 ? r.vehicle2 : r.vehicle;
        jobs.push(this.spawnUnit(key, side, dir, b, token, b.u - dir * FIELD_U * rand(0.75, 1.1), v));
      }
      if (r.infantry) {
        // цепь пехоты ближе всех к фронту, в два неровных ряда
        const ni = Math.min(INFANTRY_MAX, Math.max(2, veh * 2));
        for (let i = 0; i < ni; i++) {
          const v = b.v + FIELD_V * ((i - (ni - 1) / 2) / Math.max(1, ni - 1)) * 1.3 + rand(-0.002, 0.002);
          const row = i % 2 ? 0.5 : 0.56;
          jobs.push(this.spawnUnit(r.infantry, side, dir, b, token, b.u - dir * FIELD_U * (row + rand(-0.02, 0.02)), v));
        }
      }
      if (r.droid && veh > 0) {
        const nd = Math.min(DROID_MAX, veh);
        for (let i = 0; i < nd; i++) {
          const v = b.v + FIELD_V * ((i - (nd - 1) / 2) / Math.max(1, nd - 1)) * 1.1 + rand(-0.003, 0.003);
          jobs.push(this.spawnUnit(r.droid, side, dir, b, token, b.u - dir * FIELD_U * rand(0.6, 0.7), v));
        }
      }
      const air = Math.min(3, n.air);
      for (let i = 0; i < air; i++) {
        // у армии с бомбардировщиками каждый второй самолёт — бомбардировщик
        const bomber = Boolean(r.bomber) && i % 2 === 1;
        const key = bomber ? r.bomber! : r.air;
        const kind = bomber ? "strafe" : flightOf(r.air);
        const v = b.v + FIELD_V * ((i - (air - 1) / 2) / Math.max(1, air - 1)) * 1.2;
        jobs.push(
          this.spawnUnit(key, side, dir, b, token, b.u - dir * FIELD_U * rand(0.55, 0.8), v, {
            kind,
            v,
            t: kind === "strafe" ? rand(-0.6, 0.4) : 0,
            dur: rand(3.8, 5.2),
            wait: 0,
            phase: rand(0, Math.PI * 2),
            bomber,
          }),
        );
      }
    }
    await Promise.allSettled(jobs);
  }

  private async spawnUnit(
    key: ModelKey,
    side: 0 | 1,
    dir: 1 | -1,
    b: Battle,
    token: number,
    u: number,
    v: number,
    air?: AirState,
  ) {
    let proto;
    try {
      proto = await loadModel(key);
    } catch {
      return;
    }
    if (token !== this.token || this.mode !== "surface" || this.current !== b) return;
    const obj = applyTint(instantiate(proto), tintForModel(b.rosters[side], key, b.tints[side]), 0.45);
    obj.scale.setScalar(GROUND_K);
    let mixer: THREE.AnimationMixer | null = null;
    let action: THREE.AnimationAction | null = null;
    const clip = proto.animations.find((c) => c.duration > 0.1);
    if (clip && !air) {
      mixer = new THREE.AnimationMixer(obj);
      action = mixer.clipAction(clip);
      action.play();
      action.time = Math.random() * clip.duration;
    }
    const walks = Boolean(clip) && !air;
    const u1 = b.u - dir * FIELD_U * rand(0.22, 0.4);
    orient(obj, Planet.point(u, v, air ? 1.028 : 1), east(u).multiplyScalar(dir));
    this.ground.add(obj);
    this.units.push({ obj, side, u, v, u1, dir, speed: walks ? rand(0.0006, 0.001) : 0, mixer, action, air });
  }

  /* ---------- орбита ---------- */

  private async formation(
    army: ArmyRoster,
    n: number,
    tip: THREE.Vector3,
    facing: 1 | -1,
    token: number,
    side: 0 | 1 | null,
    tint: THREE.Color | null,
  ): Promise<boolean> {
    const spacing = 0.15;
    for (let k = 0; k < n; k++) {
      const capital = k === 0 || k % 3 === 1;
      const key = capital ? army.capital : army.escort;
      const s = await ship(key, SHIP_K, tintForModel(army, key, tint));
      if (token !== this.token) return false;
      if (!s) continue;
      const [row, dy, dz] = WEDGE[k % WEDGE.length];
      const pos = tip.clone().add(new THREE.Vector3(-facing * row * spacing, dy * 0.05, dz * spacing * 0.55));
      s.position.copy(pos);
      s.lookAt(pos.clone().add(new THREE.Vector3(facing, 0, 0.12)));
      this.fleet.add(s);
      this.bobbers.push({ obj: s, base: pos, phase: k * 1.7 + tip.x });
      if (side !== null) this.gunners[side].push(s);
    }
    return true;
  }

  /** Истребители заходят в атаку по прямой: от своего строя сквозь строй врага
   * и дальше, потом новый заход. Кругов не делают (решение пользователя). */
  private async attackRuns(
    a: ArmyRoster,
    b: ArmyRoster,
    nA: number,
    nB: number,
    homeA: THREE.Vector3,
    homeB: THREE.Vector3,
    token: number,
    tints: [THREE.Color | null, THREE.Color | null],
  ) {
    for (const [side, army, n, home, goal] of [
      [0, a, nA, homeA, homeB],
      [1, b, nB, homeB, homeA],
    ] as const) {
      for (let k = 0; k < n; k++) {
        // каждый второй в армии с бомбардировщиками — бомбардировщик
        const bomber = Boolean(army.bomber) && k % 2 === 1;
        const key = bomber ? army.bomber! : army.fighter;
        const s = await ship(key, FIGHTER_K, tintForModel(army, key, tints[side]));
        if (token !== this.token) return;
        if (!s) continue;
        this.fleet.add(s);
        const f: Fighter = {
          obj: s,
          side,
          home: home.clone(),
          goal: goal.clone(),
          from: new THREE.Vector3(),
          to: new THREE.Vector3(),
          t: 0,
          dur: 1,
          fired: false,
          bomber,
        };
        this.newRun(f);
        f.t = Math.random();
        this.fighters.push(f);
      }
    }
  }

  private newRun(f: Fighter) {
    const jitter = () => new THREE.Vector3(rand(-1, 1) * 0.12, rand(-1, 1) * 0.1, rand(-1, 1) * 0.12);
    f.from.copy(f.home).add(jitter());
    f.to.copy(f.goal).addScaledVector(f.goal.clone().sub(f.home), 0.45).add(jitter());
    f.dur = f.from.distanceTo(f.to) / rand(0.35, 0.5);
    f.t = 0;
    f.fired = false;
  }

  private setLegend(html: string) {
    this.legend.innerHTML = html;
    this.legend.hidden = !html;
  }

  setZoneOverlay(on: boolean) {
    this.planet?.setZoneOverlay(on);
  }

  private fire(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, color: number, dur: number, impact: number) {
    const g = new THREE.BufferGeometry().setFromPoints([from.clone(), from.clone()]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending }));
    parent.add(line);
    this.bolts.push({ line, from: from.clone(), to: to.clone(), t: 0, dur, impact, parent });
  }

  private boom(parent: THREE.Object3D, at: THREE.Vector3, size: number) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    sprite.position.copy(at);
    parent.add(sprite);
    this.flashes.push({ sprite, life: 0.5, max: 0.5, size });
  }

  /** Сброс ионной бомбы: светящийся заряд летит к цели и рвётся голубой вспышкой. */
  private dropBomb(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, dur: number, size: number) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ionTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    sprite.position.copy(from);
    sprite.scale.setScalar(size * 0.25);
    parent.add(sprite);
    this.bombs.push({ sprite, from: from.clone(), to: to.clone(), t: 0, dur, size, parent });
  }

  private ionBoom(parent: THREE.Object3D, at: THREE.Vector3, size: number) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ionTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    sprite.position.copy(at);
    parent.add(sprite);
    this.flashes.push({ sprite, life: 0.7, max: 0.7, size });
  }

  /** Готова ли группа стрелков к выстрелу: пауза 0.5–1.5 с между выстрелами. */
  private ready(key: string): boolean {
    const next = this.nextFire.get(key);
    if (next === undefined) {
      this.nextFire.set(key, this.time + cooldown());
      return false;
    }
    if (this.time < next) return false;
    this.nextFire.set(key, this.time + cooldown());
    return true;
  }

  private fieldPoint(b: Battle, h = 1.001): THREE.Vector3 {
    return Planet.point(b.u + rand(-FIELD_U, FIELD_U) * 1.2, b.v + rand(-FIELD_V, FIELD_V) * 1.4, h);
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.getElapsed();
    this.time = t;
    this.planet?.update(dt, t);

    if (this.camAnim) {
      const a = this.camAnim;
      a.t += dt / a.dur;
      const k = a.t >= 1 ? 1 : a.t * a.t * (3 - 2 * a.t);
      this.camera.position.lerpVectors(a.p0, a.p1, k);
      this.controls.target.lerpVectors(a.t0, a.t1, k);
      if (a.t >= 1) {
        this.camAnim = null;
        this.controls.enabled = true;
      }
    }

    for (const b of this.bobbers) {
      b.obj.position.set(b.base.x + Math.sin(t * 0.21 + b.phase) * 0.006, b.base.y + Math.sin(t * 0.5 + b.phase) * 0.008, b.base.z);
    }
    for (const s of this.stations) s.rotation.y += dt * 0.08;

    if (this.mode === "orbit") this.orbitCombat(dt);
    else this.groundCombat(dt);

    for (const b of this.bolts) {
      b.t += dt / b.dur;
      const head = tmp.copy(b.from).lerp(b.to, Math.min(1, b.t));
      const tail = tmp2.copy(b.from).lerp(b.to, Math.max(0, b.t - 0.2));
      const pos = b.line.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, tail.x, tail.y, tail.z);
      pos.setXYZ(1, head.x, head.y, head.z);
      pos.needsUpdate = true;
      if (b.t >= 1 && b.impact > 0) this.boom(b.parent, b.to, b.impact);
    }
    this.bolts = this.bolts.filter((b) => {
      if (b.t < 1) return true;
      b.parent.remove(b.line);
      b.line.geometry.dispose();
      (b.line.material as THREE.Material).dispose();
      return false;
    });
    for (const m of this.bombs) {
      m.t += dt / m.dur;
      // бомба падает с ускорением
      m.sprite.position.copy(m.from).lerp(m.to, Math.min(1, m.t * m.t));
      if (m.t >= 1) this.ionBoom(m.parent, m.to, m.size);
    }
    this.bombs = this.bombs.filter((m) => {
      if (m.t < 1) return true;
      m.parent.remove(m.sprite);
      m.sprite.material.dispose();
      return false;
    });
    for (const f of this.flashes) {
      f.life -= dt;
      const k = 1 - f.life / f.max;
      f.sprite.scale.setScalar(f.size * (0.5 + k));
      f.sprite.material.opacity = Math.max(0, 1 - k);
    }
    this.flashes = this.flashes.filter((f) => {
      if (f.life > 0) return true;
      f.sprite.parent?.remove(f.sprite);
      f.sprite.material.dispose();
      return false;
    });

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.visible && !document.hidden) this.raf = requestAnimationFrame(this.loop);
  };

  private orbitCombat(dt: number) {
    // строй против строя — у каждой стороны свой темп
    const [g0, g1] = this.gunners;
    if (g0.length && g1.length) {
      for (const side of [0, 1] as const) {
        if (!this.ready(`fleet-${side}`)) continue;
        const src = pick(side ? g1 : g0);
        const dst = pick(side ? g0 : g1);
        const jitter = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.025);
        this.fire(this.fx, src.position, dst.position.clone().add(jitter), this.boltColor[side], 0.45, Math.random() < 0.4 ? 0.07 : 0);
      }
    }
    // истребители: прямые заходы, по одному выстрелу за заход на подлёте
    for (const f of this.fighters) {
      f.t += dt / f.dur;
      if (f.t >= 1) this.newRun(f);
      const p = tmp.copy(f.from).lerp(f.to, f.t);
      f.obj.position.copy(p);
      f.obj.lookAt(tmp2.copy(f.to));
      if (!f.fired && f.t > 0.3 && f.t < 0.55) {
        f.fired = true;
        const foes = this.gunners[f.side === 0 ? 1 : 0];
        if (foes.length && f.bomber) {
          // бомбардировщик не стреляет — сбрасывает ионную бомбу на корабль
          const target = pick(foes).position.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.02));
          this.dropBomb(this.fx, f.obj.position, target, 0.9, 0.08);
        } else if (foes.length && Math.random() < 0.7) {
          this.fire(this.fx, f.obj.position, pick(foes).position, this.boltColor[f.side], 0.22, 0);
        }
      }
    }
    if (!this.planet) return;
    for (let i = 0; i < this.battles.length; i++) {
      const b = this.battles[i];
      if (Math.random() < dt * 1.2) this.boom(this.ground, this.fieldPoint(b, 1.002), rand(0.02, 0.04));
      const ships = this.bombers.get(b.att);
      if (b.bombard && ships?.length && this.ready(`bomb-${i}`)) {
        const hit = this.fieldPoint(b, 1.002);
        this.planet.group.updateMatrixWorld(true);
        this.fire(this.fx, pick(ships).position, this.planet.surfaceNode.localToWorld(hit.clone()), b.rosters[0].bolt, 0.6, 0);
        this.boom(this.ground, hit, 0.05);
      }
    }
  }

  private groundCombat(dt: number) {
    const b = this.current;
    if (!b) return;
    for (const u of this.units) {
      u.mixer?.update(dt);
      if (u.air) this.flyUnit(u, b, dt);
      else if (u.speed > 0) {
        const left = (u.u1 - u.u) * u.dir;
        if (left > 0) {
          u.u += u.dir * Math.min(left, u.speed * dt);
          orient(u.obj, Planet.point(u.u, u.v, 1), east(u.u).multiplyScalar(u.dir));
        } else {
          u.speed = 0;
          if (u.action && u.obj.name !== "aat") u.action.paused = true;
        }
      }
    }
    // перестрелка: у каждой стороны свой темп, 0.5–1.5 с между выстрелами
    for (const side of [0, 1] as const) {
      const mine = this.units.filter((u) => u.side === side && u.obj.visible && (!u.air || this.canShoot(u)));
      const foes = this.units.filter((u) => u.side !== side && !u.air);
      if (!mine.length || !foes.length || !this.ready(`ground-${side}`)) continue;
      const src = pick(mine);
      const dst = pick(foes);
      const from = src.obj.position.clone().multiplyScalar(1.004);
      const to = dst.obj.position.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.004));
      this.fire(this.ground, from, to, b.rosters[side].bolt, 0.35, Math.random() < 0.4 ? 0.012 : 0);
    }
    if (b.bombard && this.ready("ground-bomb")) {
      const hit = this.fieldPoint(b, 1.001);
      const sky = Planet.point(b.u + rand(-0.03, 0.03), b.v - 0.06, 1.3);
      this.fire(this.ground, sky, hit, b.rosters[0].bolt, 0.5, 0.03);
    }
    if (Math.random() < dt * 0.6) this.boom(this.ground, this.fieldPoint(b, 1.002), rand(0.01, 0.018));
  }

  /** Самолёт стреляет только на подлёте (заход) или когда висит (LAAT). */
  private canShoot(u: GroundUnit): boolean {
    const a = u.air!;
    if (a.bomber) return false; // бомбардировщик не стреляет
    return a.kind === "hover" || (a.t > 0.25 && a.t < 0.6);
  }

  private flyUnit(u: GroundUnit, b: Battle, dt: number) {
    const a = u.air!;
    if (a.kind === "hover") {
      // висит над своими, почти не смещаясь, развернувшись к противнику
      a.phase += dt;
      const front = b.u - u.dir * FIELD_U * 0.45;
      if ((front - u.u) * u.dir > 0) u.u += u.dir * Math.min((front - u.u) * u.dir, 0.0004 * dt);
      const pos = Planet.point(u.u + Math.sin(a.phase * 0.4) * 0.0008, a.v, 1.028 + Math.sin(a.phase * 0.9) * 0.0012);
      orient(u.obj, pos, east(u.u).multiplyScalar(u.dir));
      return;
    }
    // заход: из своего тыла через поле боя и дальше, с пикированием над фронтом
    if (a.wait > 0) {
      a.wait -= dt;
      u.obj.visible = false;
      return;
    }
    u.obj.visible = true;
    a.t += dt / a.dur;
    if (a.t >= 1) {
      a.t = 0;
      a.wait = rand(0.3, 1.6);
      a.v = b.v + rand(-FIELD_V, FIELD_V);
      a.dropped = false;
      return;
    }
    // над позициями противника бомбардировщик сбрасывает пару ионных бомб
    if (a.bomber && !a.dropped && a.t > 0.5) {
      a.dropped = true;
      const foes = this.units.filter((x) => x.side !== u.side && !x.air);
      for (let k = 0; k < 2; k++) {
        const target = foes.length
          ? pick(foes).obj.position.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.006))
          : Planet.point(b.u + u.dir * FIELD_U * rand(0.3, 0.9), a.v + rand(-0.01, 0.01), 1.001);
        this.dropBomb(this.ground, u.obj.position, target, rand(0.55, 0.8), 0.024);
      }
    }
    const at = (k: number) =>
      Planet.point(b.u - u.dir * FIELD_U * 1.9 + u.dir * FIELD_U * 3.8 * k, a.v, 1.05 - 0.032 * Math.sin(Math.PI * k));
    const k0 = Math.max(0, a.t);
    const pos = at(k0);
    const next = at(Math.min(1, k0 + 0.02));
    orient(u.obj, pos, next.sub(pos));
  }

  private clearBolts() {
    for (const b of this.bolts) {
      b.parent.remove(b.line);
      b.line.geometry.dispose();
      (b.line.material as THREE.Material).dispose();
    }
    this.bolts = [];
    for (const m of this.bombs) {
      m.parent.remove(m.sprite);
      m.sprite.material.dispose();
    }
    this.bombs = [];
  }

  private clear() {
    cancelAnimationFrame(this.raf);
    this.clearBolts();
    for (const f of this.flashes) {
      f.sprite.parent?.remove(f.sprite);
      f.sprite.material.dispose();
    }
    this.flashes = [];
    this.ground.clear();
    this.ground.removeFromParent();
    this.units = [];
    if (this.planet) {
      this.scene.remove(this.planet.group);
      this.planet.dispose();
      this.planet = null;
    }
    this.fleet.clear();
    this.fleet.visible = true;
    this.fx.clear();
    this.bobbers = [];
    this.stations = [];
    this.fighters = [];
    this.gunners = [[], []];
    this.bombers = new Map();
    this.battles = [];
    this.current = null;
    this.nextFire = new Map();
    this.mode = "orbit";
    this.camAnim = null;
    this.controls.enabled = true;
    this.orbitControls();
    this.backBtn.hidden = true;
    this.orbitLegend = "";
    this.setLegend("");
    this.controls.reset();
  }

  hide() {
    this.visible = false;
    this.token++;
    this.clear();
  }

  dispose() {
    this.hide();
    const c = this.renderer.domElement;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.controls.dispose();
    this.renderer.dispose();
    c.remove();
    this.legend.remove();
    this.backBtn.remove();
  }
}
