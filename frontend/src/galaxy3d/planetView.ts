import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { instantiate, loadModel } from "./assets";
import { ARMIES, MODELS, armyOf, hashStr, type ArmyRoster, type ModelKey } from "./catalog";
import { Planet, SUN_DIR, zoneLayout } from "./planet";
import { applyTint, tintFor } from "./tint";
import { LIVE_STAGES, resolveForces, type FactionData, type Forces, type PlanetPayload } from "./types";

/** Длины кораблей на орбите — в радиусах планеты. Не реальный масштаб (там корабль
 * был бы невидимой точкой), но планета остаётся главной. */
const LEN = { capital: 0.1, escort: 0.056, fighter: 0.014 };
/** Наземная техника: метры модели → радиусы планеты. AT-TE (13 м) ≈ 0.025. */
const GROUND_K = 0.0019;
/** Камера при спуске к бою: высота над поверхностью (в радиусах планеты). */
const SURFACE_ALT = 0.5;
/** Половина ширины поля боя по долготе (в долях оборота) и по широте. */
const FIELD_U = 0.022;
const FIELD_V = 0.035;

interface Bolt {
  line: THREE.Line;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  impact: number; // размер вспышки при попадании, 0 — без вспышки
  parent: THREE.Object3D;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  size: number;
}

interface Fighter {
  obj: THREE.Object3D;
  side: 0 | 1;
  center: THREE.Vector3;
  rx: number;
  ry: number;
  rz: number;
  speed: number;
  phase: number;
  tilt: THREE.Quaternion;
}

/** Техника на поверхности: стоит, а шагающая (с анимацией) подходит к линии фронта. */
interface GroundUnit {
  obj: THREE.Object3D;
  side: 0 | 1;
  u: number;
  v: number;
  u1: number;
  dir: 1 | -1;
  speed: number; // доли оборота в секунду; 0 — стоит
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  flyer?: { a: number; r: number; speed: number; h: number };
}

interface Battle {
  att: string;
  def: string;
  forces: { att: Required<Forces>; def: Required<Forces> };
  u: number; // центр поля боя по долготе
  v: number;
  sector: number; // номер сектора (1..), 0 — планета не поделена
  sectors: number;
  rosters: [ArmyRoster, ArmyRoster];
  tints: [THREE.Color | null, THREE.Color | null];
  bombard: boolean;
  labels: [string, string]; // html-подписи сторон цветом фракции
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

async function ship(key: ModelKey, length: number, tint: THREE.Color | null): Promise<THREE.Object3D | null> {
  try {
    const o = instantiate(await loadModel(key));
    o.scale.setScalar(length / MODELS[key].size);
    return applyTint(o, tint);
  } catch {
    return null;
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Поставить объект на поверхность: «вверх» — по нормали, «вперёд» — вдоль
 * долготы в сторону dir (к противнику). Координаты — узла поверхности планеты. */
function placeOnSurface(obj: THREE.Object3D, u: number, v: number, dir: 1 | -1, h = 1) {
  const p = Planet.point(u, v, h);
  const up = p.clone().normalize();
  const phi = u * Math.PI * 2;
  const fwd = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi)).multiplyScalar(dir).normalize();
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
  const f2 = new THREE.Vector3().crossVectors(right, up).normalize();
  obj.position.copy(p);
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, f2));
}

/** Вид планеты. Два режима:
 *  - орбита: планета целиком, флоты стоят строем и стреляют, на поверхности в
 *    секторе боя вспышки, атакующие при необходимости бьют по планете;
 *  - поверхность (клик по планете, если идёт наземный бой): камера спускается к
 *    сектору боя, там стоят и перестреливаются техника и авиация сторон. */
export class PlanetView {
  /** Клик по планете, когда наземного боя нет (страница показывает подсказку). */
  onPlanetClick: (() => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.005, 100);
  private controls: OrbitControls;
  private planet: Planet | null = null;
  private fleet = new THREE.Group();
  private fx = new THREE.Group();
  private ground = new THREE.Group(); // крепится к поверхности планеты
  private bobbers: { obj: THREE.Object3D; base: THREE.Vector3; phase: number }[] = [];
  private fighters: Fighter[] = [];
  private gunners: [THREE.Object3D[], THREE.Object3D[]] = [[], []];
  private bombers: THREE.Object3D[] = [];
  private boltColor: [number, number] = [0x4fb0ff, 0xff4a3a];
  private bolts: Bolt[] = [];
  private flashes: Flash[] = [];
  private units: GroundUnit[] = [];
  private battle: Battle | null = null;
  private legend: HTMLDivElement;
  private backBtn: HTMLButtonElement;
  private orbitLegend = "";
  private raf = 0;
  private clock = new THREE.Timer();
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
    // подсветка со стороны камеры — тёмные корабли КНС иначе сливаются с космосом
    const fill = new THREE.DirectionalLight(0xcfe0ff, 1.2);
    fill.position.set(0, 0.3, 1);
    this.camera.add(fill);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, c);
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.enableDamping = true;
    this.controls.rotateSpeed = 0.45;

    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Идёт ли сейчас спуск к наземному бою (страница по Esc возвращает на орбиту). */
  isSurface() {
    return this.mode === "surface";
  }

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  private overPlanet(e: PointerEvent): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.ray.intersectsSphere(new THREE.Sphere(new THREE.Vector3(), 1));
  }

  private onMove = (e: PointerEvent) => {
    if (this.down) return;
    const clickable = this.mode === "orbit" && this.battle && this.overPlanet(e);
    this.renderer.domElement.style.cursor = clickable ? "pointer" : "";
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || this.mode !== "orbit" || this.camAnim) return;
    if (!this.overPlanet(e)) return;
    if (this.battle) this.enterSurface();
    else this.onPlanetClick?.();
  };

  private resize = () => {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, w / 2 - this.layout.x, h / 2 - this.layout.y, w, h);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    // орбита: радиус планеты на экране = диск 2D-карты (планета «достаточно далеко»)
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
    const live = p.battle && LIVE_STAGES.has(p.battle.status) ? p.battle : null;

    this.planet = new Planet(sys);
    this.planet.setZones(zoneLayout(sys, colorOf, live ? [live.att, live.def] : []));
    this.planet.surfaceNode.add(this.ground);
    this.scene.add(this.planet.group);
    this.visible = true;
    this.loop();

    if (live) {
      const forces = resolveForces(live, sys.gar || 0);
      const n = this.planet.zoneCount;
      const hot = this.planet.hotZone;
      const sector = n ? (hot >= 0 ? hot : 0) : -1;
      this.battle = {
        att: live.att,
        def: live.def,
        forces,
        u: sector >= 0 ? (sector + 0.5) / n : (hashStr(sys.id) % 1000) / 1000,
        v: 0.47,
        sector: sector >= 0 ? sector + 1 : 0,
        sectors: n,
        rosters: [roster(live.att), roster(live.def)],
        tints: [tintFor(fac(live.att)), tintFor(fac(live.def))],
        // нет авиации у одной из сторон — атакующие фрегаты работают по планете
        bombard: forces.att.air === 0 || forces.def.air === 0,
        labels: [tag(live.att), tag(live.def)],
      };
    }

    const lines: string[] = [];
    // орбита: явная настройка системы; без неё бой флотов идёт, пока идёт бой за планету
    const orbit = sys.orbit ?? (live ? "battle" : "");
    let attackerInOrbit = false;
    if (orbit === "battle") {
      const att = sys.orbitAtt || live?.att || "";
      const def = sys.orbitDef || live?.def || sys.own;
      if (att && def && att !== def) {
        const nA = Math.max(1, Math.min(8, sys.fleetAtt ?? 3));
        const nD = Math.max(1, Math.min(8, sys.fleetDef ?? 3));
        this.boltColor = [roster(att).bolt, roster(def).bolt];
        const tA = tintFor(fac(att)), tD = tintFor(fac(def));
        // флоты дальше от планеты и стоят — «по друг другу шмаляют»
        const fA = await this.formation(roster(att), nA, new THREE.Vector3(0.62, 0.3, 1.45), -1, token, 0, tA);
        const fD = await this.formation(roster(def), nD, new THREE.Vector3(-0.62, 0.18, 1.38), 1, token, 1, tD);
        if (!fA || !fD) return;
        await this.dogfight(roster(att), roster(def), Math.min(6, 1 + nA), Math.min(6, 1 + nD), token, [tA, tD]);
        if (token !== this.token) return;
        if (live && att === live.att) {
          attackerInOrbit = true;
          this.bombers = this.gunners[0];
        }
        lines.push(`<b>Орбита</b> бой: ${tag(att)} против ${tag(def)}`);
      }
    } else if (orbit) {
      const n = Math.max(0, Math.min(10, sys.fleet ?? 0));
      if (n > 0) {
        const before = this.fleet.children.length;
        if (!(await this.formation(roster(orbit), n, new THREE.Vector3(0.62, 0.34, 1.42), -1, token, null, tintFor(fac(orbit))))) return;
        if (live && orbit === live.att) {
          attackerInOrbit = true;
          this.bombers = this.fleet.children.slice(before);
        }
        lines.push(`<b>Орбита</b> ${tag(orbit)} · флот ${n} кор.`);
      } else lines.push(`<b>Орбита</b> под контролем ${tag(orbit)}, флота нет`);
    }

    // бомбардировка без своего флота на орбите — подводим пару крейсеров атакующих
    if (this.battle?.bombard && !attackerInOrbit) {
      const before = this.fleet.children.length;
      const ok = await this.formation(this.battle.rosters[0], 2, new THREE.Vector3(0.75, 0.55, 1.2), -1, token, null, this.battle.tints[0]);
      if (!ok) return;
      this.bombers = this.fleet.children.slice(before);
    }

    for (const bl of p.blockades) {
      const other = bl.a === sys.id ? bl.b : bl.a;
      const h = hashStr(other);
      const sign: 1 | -1 = h % 2 ? 1 : -1;
      const tip = new THREE.Vector3(sign * (1.25 + ((h >> 3) % 20) / 100), 0.5 * (((h >> 8) % 3) - 1) * 0.4, 0.95);
      const n = Math.min(6, Math.max(1, Math.round(bl.str || 1)));
      if (!(await this.formation(roster(bl.fac), n, tip, sign === 1 ? -1 : 1, token, null, tintFor(fac(bl.fac))))) return;
      lines.push(`<b>Блокада</b> ${tag(bl.fac)} · ${n} кор.`);
    }

    if (sys.zones) {
      const held = Object.entries(sys.zoneHolders || {}).filter(([, k]) => k > 0);
      lines.push(`<b>Поверхность</b> ${held.map(([fid, k]) => `${tag(fid)} ${k}/${sys.zones}`).join(" · ")}`);
    } else if (sys.own) lines.push(`<b>Поверхность</b> ${tag(sys.own)}`);
    if (this.battle) {
      const b = this.battle;
      lines.push(
        `<b>Наземный бой</b> ${tag(b.att)} против ${tag(b.def)}` +
          (b.sector ? ` · сектор ${b.sector} из ${b.sectors}` : "") +
          (b.bombard ? `<br><span class="g3d-cta">☄ ${fac(b.att).name} бьют по планете с орбиты</span>` : "") +
          `<br><span class="g3d-cta">⚔ Нажмите на планету, чтобы спуститься к бою</span>`,
      );
    }
    this.orbitLegend = lines.join("<br>");
    this.setLegend(this.orbitLegend);
  }

  /* ---------- спуск к наземному бою ---------- */

  private async enterSurface() {
    const b = this.battle;
    const planet = this.planet;
    if (!b || !planet) return;
    const token = this.token;
    this.mode = "surface";
    planet.spinning = false;
    planet.setCloseUp(true);
    this.fleet.visible = false;
    this.clearBolts();
    this.renderer.domElement.style.cursor = "";

    // куда смотреть: центр поля боя и точка над ним, чуть сбоку — под углом
    planet.group.updateMatrixWorld(true);
    const node = planet.surfaceNode;
    const target = node.localToWorld(Planet.point(b.u, b.v, 1));
    const up = target.clone().normalize();
    const north = new THREE.Vector3(0, 1, 0).projectOnPlane(up).normalize();
    // пологий ракурс с юга: линия фронта идёт слева направо, виден горизонт
    const pos = target.clone().addScaledVector(up, SURFACE_ALT * 0.42).addScaledVector(north, -SURFACE_ALT * 0.9);
    this.flyTo(pos, target, 1.4);
    this.controls.enableZoom = true;
    this.controls.minDistance = 0.12;
    this.controls.maxDistance = 1.4;

    const f = b.forces;
    const legend = (side: 0 | 1) => {
      const n = side === 0 ? f.att : f.def;
      return `техника ${Math.min(6, n.veh)} · авиация ${Math.min(3, n.air)}`;
    };
    this.setLegend(
      `<b>Наземный бой</b>${b.sector ? ` сектор ${b.sector} из ${b.sectors}` : ""}<br>` +
        `${b.labels[0]} против ${b.labels[1]}<br>` +
        `<span class="g3d-dim">атака: ${legend(0)} · оборона: ${legend(1)}</span>`,
    );
    this.backBtn.hidden = false;

    await this.spawnGround(token);
  }

  exitSurface() {
    if (this.mode !== "surface" || !this.planet) return;
    this.mode = "orbit";
    this.planet.spinning = true;
    this.planet.setCloseUp(false);
    this.fleet.visible = true;
    this.clearBolts();
    for (const u of this.units) this.ground.remove(u.obj);
    this.units = [];
    this.controls.enableZoom = false;
    const pos = new THREE.Vector3(0, 0.32, 5).normalize().multiplyScalar(this.orbitDist);
    this.flyTo(pos, new THREE.Vector3(), 1.1);
    this.setLegend(this.orbitLegend);
    this.backBtn.hidden = true;
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur: number) {
    this.controls.enabled = false;
    this.camAnim = { p0: this.camera.position.clone(), p1: pos, t0: this.controls.target.clone(), t1: target, t: 0, dur };
  }

  /** Техника обеих сторон на поле боя: строй против строя поперёк линии фронта. */
  private async spawnGround(token: number) {
    const b = this.battle!;
    const jobs: Promise<void>[] = [];
    for (const side of [0, 1] as const) {
      const r = b.rosters[side];
      const n = side === 0 ? b.forces.att : b.forces.def;
      const dir: 1 | -1 = side === 0 ? 1 : -1; // атакующие идут в +u
      const veh = Math.min(6, n.veh);
      for (let i = 0; i < veh; i++) {
        jobs.push(
          this.spawnUnit(r.vehicle, side, dir, b, token, {
            u: b.u - dir * FIELD_U * rand(0.75, 1.1),
            v: b.v + FIELD_V * ((i - (veh - 1) / 2) / Math.max(1, veh - 1)) * 1.6 + rand(-0.004, 0.004),
          }),
        );
      }
      const air = Math.min(3, n.air);
      for (let i = 0; i < air; i++) {
        jobs.push(
          this.spawnUnit(r.air, side, dir, b, token, null, {
            a: rand(0, Math.PI * 2),
            r: rand(0.35, 0.8),
            speed: rand(0.18, 0.32) * (i % 2 ? 1 : -1),
            h: rand(1.022, 1.034),
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
    at: { u: number; v: number } | null,
    flyer?: GroundUnit["flyer"],
  ) {
    let proto;
    try {
      proto = await loadModel(key);
    } catch {
      return;
    }
    if (token !== this.token || this.mode !== "surface") return;
    const obj = applyTint(instantiate(proto), b.tints[side], 0.45);
    obj.scale.setScalar(GROUND_K);
    let mixer: THREE.AnimationMixer | null = null;
    let action: THREE.AnimationAction | null = null;
    const clip = proto.animations.find((c) => c.duration > 0.1);
    if (clip && !flyer) {
      mixer = new THREE.AnimationMixer(obj);
      action = mixer.clipAction(clip);
      action.play();
      action.time = Math.random() * clip.duration;
    }
    const u = at ? at.u : b.u;
    const v = at ? at.v : b.v;
    // шагающие (есть анимация) подходят к линии фронта, остальные стоят
    const walks = Boolean(clip) && !flyer;
    const u1 = b.u - dir * FIELD_U * rand(0.22, 0.4);
    placeOnSurface(obj, u, v, dir);
    this.ground.add(obj);
    this.units.push({ obj, side, u, v, u1, dir, speed: walks ? rand(0.0006, 0.001) : 0, mixer, action, flyer });
  }

  /* ---------- общее ---------- */

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
      const s = await ship(capital ? army.capital : army.escort, capital ? LEN.capital : LEN.escort, tint);
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

  private async dogfight(a: ArmyRoster, b: ArmyRoster, nA: number, nB: number, token: number, tints: [THREE.Color | null, THREE.Color | null]) {
    const mid = new THREE.Vector3(0, 0.24, 1.45);
    for (const [side, army, n] of [
      [0, a, nA],
      [1, b, nB],
    ] as const) {
      for (let k = 0; k < n; k++) {
        const s = await ship(army.fighter, LEN.fighter, tints[side]);
        if (token !== this.token) return;
        if (!s) continue;
        this.fleet.add(s);
        const r = () => Math.random() * 2 - 1;
        this.fighters.push({
          obj: s,
          side,
          center: mid.clone().add(new THREE.Vector3(r() * 0.35, r() * 0.14, r() * 0.18)),
          rx: 0.1 + Math.random() * 0.18,
          ry: 0.04 + Math.random() * 0.08,
          rz: 0.06 + Math.random() * 0.12,
          speed: (0.9 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1),
          phase: Math.random() * Math.PI * 2,
          tilt: new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 0.5, r() * Math.PI, r() * 0.4)),
        });
      }
    }
  }

  private setLegend(html: string) {
    this.legend.innerHTML = html;
    this.legend.hidden = !html;
  }

  setZoneOverlay(on: boolean) {
    this.planet?.setZoneOverlay(on);
  }

  /** Выстрел: from/to — в координатах parent (мир или поверхность планеты). */
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

  /** Случайная точка на поле боя (координаты поверхности). */
  private fieldPoint(h = 1.001): THREE.Vector3 {
    const b = this.battle!;
    return Planet.point(b.u + rand(-FIELD_U, FIELD_U) * 1.2, b.v + rand(-FIELD_V, FIELD_V) * 1.4, h);
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.getElapsed();
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
    for (const f of this.fighters) {
      const a = f.phase + t * f.speed;
      tmp.set(Math.cos(a) * f.rx, Math.sin(a * 2) * f.ry, Math.sin(a) * f.rz).applyQuaternion(f.tilt).add(f.center);
      const a2 = a + Math.sign(f.speed) * 0.05;
      tmp2.set(Math.cos(a2) * f.rx, Math.sin(a2 * 2) * f.ry, Math.sin(a2) * f.rz).applyQuaternion(f.tilt).add(f.center);
      f.obj.position.copy(tmp);
      f.obj.lookAt(tmp2);
    }

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

  /** Орбита: флоты стреляют друг в друга, на поверхности в секторе боя вспышки,
   * атакующие при бомбардировке бьют по планете. */
  private orbitCombat(dt: number) {
    const [g0, g1] = this.gunners;
    if (g0.length && g1.length && Math.random() < dt * 4) {
      const side = Math.random() < 0.5 ? 0 : 1;
      const src = (side ? g1 : g0)[Math.floor(Math.random() * (side ? g1 : g0).length)];
      const dst = (side ? g0 : g1)[Math.floor(Math.random() * (side ? g0 : g1).length)];
      const jitter = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.025);
      this.fire(this.fx, src.position, dst.position.clone().add(jitter), this.boltColor[side], 0.45, Math.random() < 0.45 ? 0.07 : 0);
    }
    if (this.fighters.length > 1 && Math.random() < dt * 3) {
      const f = this.fighters[Math.floor(Math.random() * this.fighters.length)];
      const foes = this.fighters.filter((x) => x.side !== f.side);
      const foe = foes[Math.floor(Math.random() * foes.length)];
      if (foe) this.fire(this.fx, f.obj.position, foe.obj.position, this.boltColor[f.side], 0.22, 0);
    }
    const b = this.battle;
    if (!b || !this.planet) return;
    const node = this.planet.surfaceNode;
    // разрывы на поверхности в секторе боя
    if (Math.random() < dt * 2.5) this.boom(this.ground, this.fieldPoint(1.002), rand(0.02, 0.045));
    // бомбардировка с орбиты
    if (b.bombard && this.bombers.length && Math.random() < dt * 2.2) {
      const src = this.bombers[Math.floor(Math.random() * this.bombers.length)];
      const hit = this.fieldPoint(1.002);
      this.planet.group.updateMatrixWorld(true);
      const world = node.localToWorld(hit.clone());
      this.fire(this.fx, src.position, world, b.rosters[0].bolt, 0.6, 0);
      this.boom(this.ground, hit, 0.05);
    }
  }

  /** Поверхность: техника подходит к фронту и перестреливается, авиация кружит. */
  private groundCombat(dt: number) {
    const b = this.battle;
    if (!b) return;
    for (const u of this.units) {
      u.mixer?.update(dt);
      if (u.flyer) {
        const f = u.flyer;
        f.a += f.speed * dt;
        const uu = b.u + Math.cos(f.a) * FIELD_U * f.r * 1.6;
        const vv = b.v + Math.sin(f.a) * FIELD_V * f.r;
        const ahead = f.a + Math.sign(f.speed) * 0.08;
        const pos = Planet.point(uu, vv, f.h);
        const next = Planet.point(b.u + Math.cos(ahead) * FIELD_U * f.r * 1.6, b.v + Math.sin(ahead) * FIELD_V * f.r, f.h);
        // разворот в координатах поверхности: вверх — от центра планеты, вперёд — по ходу
        const up = pos.clone().normalize();
        const fwd = next.sub(pos).projectOnPlane(up).normalize();
        const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
        u.obj.position.copy(pos);
        u.obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
        continue;
      }
      if (u.speed > 0) {
        const left = (u.u1 - u.u) * u.dir;
        if (left > 0) {
          u.u += u.dir * Math.min(left, u.speed * dt);
          placeOnSurface(u.obj, u.u, u.v, u.dir);
        } else {
          u.speed = 0;
          // дошёл — шагать перестаёт (у AT-TE анимация ходьбы), стоит и стреляет
          if (u.action && u.obj.name !== "aat") u.action.paused = true;
        }
      }
    }
    // перестрелка: случайная пара противников
    const s0 = this.units.filter((u) => u.side === 0);
    const s1 = this.units.filter((u) => u.side === 1);
    if (s0.length && s1.length && Math.random() < dt * 7) {
      const side = Math.random() < 0.5 ? 0 : 1;
      const src = (side ? s1 : s0)[Math.floor(Math.random() * (side ? s1 : s0).length)];
      const dst = (side ? s0 : s1)[Math.floor(Math.random() * (side ? s0 : s1).length)];
      const from = src.obj.position.clone().multiplyScalar(1.004);
      const to = dst.obj.position.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.004));
      this.fire(this.ground, from, to, b.rosters[side].bolt, 0.35, Math.random() < 0.35 ? 0.012 : 0);
    }
    // бомбардировка видна и вблизи — заряды падают с неба
    if (b.bombard && Math.random() < dt * 1.6) {
      const hit = this.fieldPoint(1.001);
      const sky = Planet.point(b.u + rand(-0.03, 0.03), b.v - 0.06, 1.3);
      this.fire(this.ground, sky, hit, b.rosters[0].bolt, 0.5, 0.03);
    }
    // одиночные разрывы на поле
    if (Math.random() < dt * 1.2) this.boom(this.ground, this.fieldPoint(1.002), rand(0.01, 0.02));
  }

  private clearBolts() {
    for (const b of this.bolts) {
      b.parent.remove(b.line);
      b.line.geometry.dispose();
      (b.line.material as THREE.Material).dispose();
    }
    this.bolts = [];
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
    this.fighters = [];
    this.gunners = [[], []];
    this.bombers = [];
    this.battle = null;
    this.mode = "orbit";
    this.camAnim = null;
    this.controls.enabled = true;
    this.controls.enableZoom = false;
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
