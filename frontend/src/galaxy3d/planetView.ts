import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { instantiate, loadModel } from "./assets";
import { ARMIES, MODELS, armyOf, hashStr, type ArmyRoster, type ModelKey } from "./catalog";
import { Planet, SUN_DIR, zoneLayout } from "./planet";
import { applyTint, tintFor } from "./tint";
import { LIVE_STAGES, type FactionData, type PlanetPayload } from "./types";

/** Длины кораблей в радиусах планеты. Не реальный масштаб (там корабль был бы
 * невидимой точкой), но так, чтобы планета оставалась главной: линкор — около
 * десятой доли радиуса, истребитель едва различим. */
const LEN = { capital: 0.1, escort: 0.056, fighter: 0.014 };
/** Насколько планета крупнее диска 2D-карты после «приближения». */
const ZOOM = 1.3;

interface Bolt {
  line: THREE.Line;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  flash: boolean;
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

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/** Строй клином: ведущий впереди, остальные уступом назад и в стороны. */
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

/** Сцена у планеты: планета с секторами захвата, флот владельца орбиты, бой
 * флотов, блокады трасс. Клик по планете — `onPlanetClick` (наземный бой). */
export class PlanetView {
  onPlanetClick: (() => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  private controls: OrbitControls;
  private planet: Planet | null = null;
  private fleet = new THREE.Group();
  private fx = new THREE.Group();
  private bobbers: { obj: THREE.Object3D; base: THREE.Vector3; phase: number }[] = [];
  private fighters: Fighter[] = [];
  private gunners: [THREE.Object3D[], THREE.Object3D[]] = [[], []];
  private boltColor: [number, number] = [0x4fb0ff, 0xff4a3a];
  private bolts: Bolt[] = [];
  private flashes: Flash[] = [];
  private legend: HTMLDivElement;
  private raf = 0;
  private clock = new THREE.Timer();
  private layout = { x: 0, y: 0, r: 200 };
  private zoom = 1;
  private token = 0;
  private visible = false;
  private down: { x: number; y: number } | null = null;
  /** На планете идёт наземный бой — клик по ней его откроет, курсор подсказывает это. */
  private ground = false;

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
    // расстояние до планеты задаёт приближение (applyCamera), колесо не трогаем
    this.controls.enableZoom = false;
    this.controls.enableDamping = true;
    this.controls.rotateSpeed = 0.45;

    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
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
    this.renderer.domElement.style.cursor = this.ground && this.overPlanet(e) ? "pointer" : "";
  };

  /** Клик без перетаскивания по диску планеты. */
  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || !this.onPlanetClick) return;
    if (this.overPlanet(e)) this.onPlanetClick();
  };

  private resize = () => {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyCamera();
  };

  /** Центр планеты — там, где карта рисовала диск; радиус — диск × приближение. */
  private applyCamera() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.camera.setViewOffset(w, h, w / 2 - this.layout.x, h / 2 - this.layout.y, w, h);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    this.camera.position.setLength(h / 2 / (this.layout.r * this.zoom * Math.tan(fov / 2)));
    this.camera.updateProjectionMatrix();
  }

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
    this.zoom = 1;
    this.camera.position.set(0, 0.32, 5);
    this.resize();

    const fac = (fid: string): FactionData => p.factions.find((f) => f.id === fid) || { id: fid, name: fid, color: "#7a8ea5" };
    const colorOf = (fid: string) => fac(fid).color;
    const roster = (fid: string): ArmyRoster => ARMIES[armyOf(fac(fid))];
    const tag = (fid: string) => `<span style="color:${colorOf(fid)}">${fac(fid).name}</span>`;
    const sys = p.sys;
    const live = p.battle && LIVE_STAGES.has(p.battle.status) ? p.battle : null;
    this.ground = Boolean(live);

    this.planet = new Planet(sys);
    this.planet.setZones(zoneLayout(sys, colorOf, live ? [live.att, live.def] : []));
    this.scene.add(this.planet.group);
    this.visible = true;
    this.loop();

    const lines: string[] = [];
    // орбита: явная настройка системы; без неё бой на орбите идёт, пока идёт бой за планету
    const orbit = sys.orbit ?? (live ? "battle" : "");
    if (orbit === "battle") {
      const att = sys.orbitAtt || live?.att || "";
      const def = sys.orbitDef || live?.def || sys.own;
      if (att && def && att !== def) {
        const nA = Math.max(1, Math.min(8, sys.fleetAtt ?? 3));
        const nD = Math.max(1, Math.min(8, sys.fleetDef ?? 3));
        this.boltColor = [roster(att).bolt, roster(def).bolt];
        const tA = tintFor(fac(att)), tD = tintFor(fac(def));
        const fA = await this.formation(roster(att), nA, new THREE.Vector3(0.42, 0.22, 1.5), -1, token, 0, tA);
        const fD = await this.formation(roster(def), nD, new THREE.Vector3(-0.42, 0.12, 1.42), 1, token, 1, tD);
        if (!fA || !fD) return;
        await this.dogfight(roster(att), roster(def), Math.min(8, 2 + nA), Math.min(8, 2 + nD), token, [tA, tD]);
        if (token !== this.token) return;
        lines.push(`<b>Орбита</b> бой: ${tag(att)} против ${tag(def)}`);
      }
    } else if (orbit && orbit !== "battle") {
      const n = Math.max(0, Math.min(10, sys.fleet ?? 0));
      if (n > 0) {
        if (!(await this.formation(roster(orbit), n, new THREE.Vector3(0.62, 0.34, 1.42), -1, token, 0, tintFor(fac(orbit))))) return;
        lines.push(`<b>Орбита</b> ${tag(orbit)} · флот ${n} кор.`);
      } else lines.push(`<b>Орбита</b> под контролем ${tag(orbit)}, флота нет`);
    }

    // блокады трасс через систему — флот стоит строем на подходе к соседу
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
    if (live) lines.push(`<b>Наземный бой</b> ${tag(live.att)} против ${tag(live.def)}<br><span class="g3d-cta">⚔ Нажмите на планету, чтобы спуститься к бою</span>`);
    this.setLegend(lines.join("<br>"));
  }

  /** Флот строем: ведущий в `tip`, нос по ±X. side — к какой стороне боя относится (для залпов). */
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

  /** Истребители кружат над полем боя между флотами. */
  private async dogfight(a: ArmyRoster, b: ArmyRoster, nA: number, nB: number, token: number, tints: [THREE.Color | null, THREE.Color | null]) {
    const mid = new THREE.Vector3(0, 0.2, 1.5);
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
          center: mid.clone().add(new THREE.Vector3(r() * 0.3, r() * 0.14, r() * 0.18)),
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

  private fire(from: THREE.Vector3, to: THREE.Vector3, color: number, dur: number, flash: boolean) {
    const g = new THREE.BufferGeometry().setFromPoints([from.clone(), from.clone()]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending }));
    this.fx.add(line);
    // попадание с небольшим разбросом, а не точно в центр корабля
    const jitter = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.05);
    this.bolts.push({ line, from: from.clone(), to: to.clone().add(jitter), t: 0, dur, flash });
  }

  private boom(at: THREE.Vector3, size: number) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    sprite.position.copy(at);
    this.fx.add(sprite);
    this.flashes.push({ sprite, life: 0.45, max: 0.45, size });
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.getElapsed();
    this.planet?.update(dt, t);

    // плавное «приближение» после погружения
    if (Math.abs(ZOOM - this.zoom) > 0.001) {
      this.zoom += (ZOOM - this.zoom) * Math.min(1, dt * 2.2);
      this.applyCamera();
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

    // залпы линкоров и стрельба истребителей
    const [g0, g1] = this.gunners;
    if (g0.length && g1.length && Math.random() < dt * 5) {
      const side = Math.random() < 0.5 ? 0 : 1;
      const src = (side ? g1 : g0)[Math.floor(Math.random() * (side ? g1 : g0).length)];
      const dst = (side ? g0 : g1)[Math.floor(Math.random() * (side ? g0 : g1).length)];
      this.fire(src.position, dst.position, this.boltColor[side], 0.45, Math.random() < 0.45);
    }
    if (this.fighters.length > 1 && Math.random() < dt * 4) {
      const f = this.fighters[Math.floor(Math.random() * this.fighters.length)];
      const foes = this.fighters.filter((x) => x.side !== f.side);
      const foe = foes[Math.floor(Math.random() * foes.length)];
      if (foe) this.fire(f.obj.position, foe.obj.position, this.boltColor[f.side], 0.22, false);
    }

    for (const b of this.bolts) {
      b.t += dt / b.dur;
      const head = tmp.copy(b.from).lerp(b.to, Math.min(1, b.t));
      const tail = tmp2.copy(b.from).lerp(b.to, Math.max(0, b.t - 0.18));
      const pos = b.line.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, tail.x, tail.y, tail.z);
      pos.setXYZ(1, head.x, head.y, head.z);
      pos.needsUpdate = true;
      if (b.t >= 1 && b.flash) this.boom(b.to, 0.05 + Math.random() * 0.04);
    }
    this.bolts = this.bolts.filter((b) => {
      if (b.t < 1) return true;
      this.fx.remove(b.line);
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
      this.fx.remove(f.sprite);
      f.sprite.material.dispose();
      return false;
    });

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.visible && !document.hidden) this.raf = requestAnimationFrame(this.loop);
  };

  private clear() {
    cancelAnimationFrame(this.raf);
    if (this.planet) {
      this.scene.remove(this.planet.group);
      this.planet.dispose();
      this.planet = null;
    }
    this.fleet.clear();
    for (const b of this.bolts) {
      b.line.geometry.dispose();
      (b.line.material as THREE.Material).dispose();
    }
    for (const f of this.flashes) f.sprite.material.dispose();
    this.fx.clear();
    this.bolts = [];
    this.flashes = [];
    this.bobbers = [];
    this.fighters = [];
    this.gunners = [[], []];
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
  }
}
