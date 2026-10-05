import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { instantiate, loadModel } from "./assets";
import { ARMIES, MODELS, armyOf, hashStr, type ModelKey } from "./catalog";
import { Planet, SUN_DIR, zoneLayout } from "./planet";
import { LIVE_STAGES, type FactionData, type PlanetPayload } from "./types";

interface Orbiter {
  obj: THREE.Object3D;
  radius: number;
  speed: number;
  phase: number;
  tilt: THREE.Quaternion;
  bob: number;
}

interface Bolt {
  line: THREE.Line;
  life: number;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/** Корабль заданной длины (в радиусах планеты). */
async function ship(key: ModelKey, length: number): Promise<THREE.Object3D | null> {
  try {
    const proto = await loadModel(key);
    const o = instantiate(proto);
    o.scale.setScalar(length / MODELS[key].size);
    return o;
  } catch {
    return null;
  }
}

/** Сцена у планеты: сама планета с секторами, патруль владельца, флоты боя и блокад. */
export class PlanetView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  private controls: OrbitControls;
  private planet: Planet | null = null;
  private fleet = new THREE.Group();
  private orbiters: Orbiter[] = [];
  private shooters: { a: THREE.Object3D; b: THREE.Object3D; color: number }[] = [];
  private bolts: Bolt[] = [];
  private legend: HTMLDivElement;
  private raf = 0;
  private clock = new THREE.Timer();
  private layout = { x: 0, y: 0, r: 200 };
  private token = 0;
  private visible = false;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
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
    this.scene.add(this.fleet);
    // подсветка со стороны камеры — тёмные корабли (КНС) иначе сливаются с космосом
    const fill = new THREE.DirectionalLight(0xcfe0ff, 1.2);
    fill.position.set(0, 0.3, 1);
    this.camera.add(fill);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, c);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 9;
    this.controls.rotateSpeed = 0.5;

    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private resize = () => {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // центр планеты — в точке, где карта рисовала диск
    this.camera.setViewOffset(w, h, w / 2 - this.layout.x, h / 2 - this.layout.y, w, h);
    // дистанция так, чтобы радиус диска на экране совпал с layout.r
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = h / 2 / (this.layout.r * Math.tan(fov / 2));
    this.camera.position.setLength(dist);
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
    this.camera.position.set(0, 0.35, 5);
    this.resize();

    const colorOf = (fid: string) => p.factions.find((f) => f.id === fid)?.color || "#7a8ea5";
    const fac = (fid: string): FactionData => p.factions.find((f) => f.id === fid) || { id: fid, name: fid, color: "#7a8ea5" };

    this.planet = new Planet(p.sys);
    const live = p.battle && LIVE_STAGES.has(p.battle.status) ? p.battle : null;
    this.planet.setZones(zoneLayout(p.sys, colorOf, live ? [live.att, live.def] : []));
    this.scene.add(this.planet.group);

    const chips: string[] = [];
    const ring = (_radius: number, incl: number, node: number) =>
      new THREE.Quaternion().setFromEuler(new THREE.Euler(incl, node, 0, "YXZ"));

    // патруль владельца — когда нет боя
    if (!live && p.sys.own) {
      const army = ARMIES[armyOf(fac(p.sys.own))];
      const s = await ship(army.capital, 0.24);
      if (token !== this.token) return;
      if (s) this.addOrbiter(s, 1.55, 0.18, 0.4, ring(1.55, 0.35, 0.2));
    }

    // бой: два флота на встречных орбитах + истребители и перестрелка
    if (live) {
      const sides = [
        { fid: live.att, radius: 1.5, speed: 0.16, incl: 0.32, node: 0.1, phase: 0 },
        { fid: live.def, radius: 1.72, speed: -0.12, incl: 0.4, node: 0.6, phase: Math.PI * 0.85 },
      ];
      const caps: THREE.Object3D[][] = [[], []];
      for (const [i, side] of sides.entries()) {
        const army = ARMIES[armyOf(fac(side.fid))];
        const q = ring(side.radius, side.incl, side.node);
        const list = [
          { key: army.capital, len: 0.26, n: 2 },
          { key: army.escort, len: 0.15, n: 1 },
          { key: army.fighter, len: 0.035, n: 5 },
        ];
        for (const item of list) {
          for (let k = 0; k < item.n; k++) {
            const s = await ship(item.key, item.len);
            if (token !== this.token) return;
            if (!s) continue;
            const isFighter = item.key === army.fighter;
            const r = side.radius + (isFighter ? 0.12 + k * 0.04 : k * 0.05);
            const spread = isFighter ? 0.06 + k * 0.05 : 0.22 * k;
            this.addOrbiter(s, r, side.speed * (isFighter ? 2.4 : 1), side.phase + spread, q, isFighter ? 0.03 : 0.006);
            if (!isFighter) caps[i].push(s);
          }
        }
        chips.push(`<span style="color:${colorOf(side.fid)}">${fac(side.fid).name}</span>`);
      }
      for (const a of caps[0]) for (const b of caps[1]) {
        this.shooters.push({ a, b, color: ARMIES[armyOf(fac(live.att))].bolt });
        this.shooters.push({ a: b, b: a, color: ARMIES[armyOf(fac(live.def))].bolt });
      }
      this.setLegend(`<b>Бой на орбите</b> ${chips.join(" против ")}`);
    }

    // блокады трасс через эту систему — флот стоит строем на подходе к соседу
    for (const bl of p.blockades) {
      const army = ARMIES[armyOf(fac(bl.fac))];
      const count = Math.min(5, Math.max(1, Math.round(bl.str || 1)));
      const other = bl.a === p.sys.id ? bl.b : bl.a;
      // строй ставим на видимой полусфере (между планетой и камерой, слева или справа)
      const h = hashStr(other);
      const sideSign = h % 2 ? 1 : -1;
      const dir = new THREE.Vector3(sideSign * (0.75 + ((h >> 3) % 20) / 100), 0.18 * (((h >> 8) % 3) - 1), 0.62).normalize();
      for (let k = 0; k < count; k++) {
        const s = await ship(k === 0 ? army.capital : army.escort, k === 0 ? 0.28 : 0.17);
        if (token !== this.token) return;
        if (!s) continue;
        const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
        const pos = dir.clone().multiplyScalar(1.55 + 0.06 * (k % 2)).addScaledVector(side, (k - (count - 1) / 2) * 0.24);
        pos.y += (k % 2 ? 0.06 : -0.04);
        s.position.copy(pos);
        s.lookAt(pos.clone().addScaledVector(side, 1));
        s.userData.bob = { base: pos.y, phase: k };
        this.fleet.add(s);
      }
      this.setLegend(
        (this.legend.innerHTML ? this.legend.innerHTML + "<br>" : "") +
          `<b>Блокада</b> <span style="color:${colorOf(bl.fac)}">${fac(bl.fac).name}</span> · ${count} кор.`,
      );
    }

    this.visible = true;
    this.loop();
  }

  private setLegend(html: string) {
    this.legend.innerHTML = html;
    this.legend.hidden = !html;
  }

  private addOrbiter(obj: THREE.Object3D, radius: number, speed: number, phase: number, tilt: THREE.Quaternion, bob = 0.01) {
    this.fleet.add(obj);
    this.orbiters.push({ obj, radius, speed, phase, tilt, bob });
  }

  setZoneOverlay(on: boolean) {
    this.planet?.setZoneOverlay(on);
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.getElapsed();
    this.planet?.update(dt, t);

    for (const o of this.orbiters) {
      const a = o.phase + t * o.speed;
      tmp.set(Math.cos(a) * o.radius, Math.sin(t * 0.7 + o.phase) * o.bob, Math.sin(a) * o.radius).applyQuaternion(o.tilt);
      const da = Math.sign(o.speed) * 0.02;
      tmp2.set(Math.cos(a + da) * o.radius, 0, Math.sin(a + da) * o.radius).applyQuaternion(o.tilt);
      o.obj.position.copy(tmp);
      o.obj.lookAt(tmp2);
    }
    for (const s of this.fleet.children) {
      const bob = s.userData.bob;
      if (bob) s.position.y = bob.base + Math.sin(t * 0.6 + bob.phase) * 0.01;
    }

    // залпы между флотами
    if (this.shooters.length && Math.random() < dt * 6) {
      const sh = this.shooters[Math.floor(Math.random() * this.shooters.length)];
      const g = new THREE.BufferGeometry().setFromPoints([sh.a.position.clone(), sh.b.position.clone()]);
      const line = new THREE.Line(
        g,
        new THREE.LineBasicMaterial({ color: sh.color, transparent: true, blending: THREE.AdditiveBlending }),
      );
      this.scene.add(line);
      this.bolts.push({ line, life: 0.35 });
    }
    for (const b of this.bolts) {
      b.life -= dt;
      (b.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, b.life / 0.35);
    }
    this.bolts = this.bolts.filter((b) => {
      if (b.life > 0) return true;
      this.scene.remove(b.line);
      b.line.geometry.dispose();
      (b.line.material as THREE.Material).dispose();
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
    this.orbiters = [];
    this.shooters = [];
    for (const b of this.bolts) this.scene.remove(b.line);
    this.bolts = [];
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
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.legend.remove();
  }
}
