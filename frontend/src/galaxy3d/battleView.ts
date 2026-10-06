import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { instantiate, loadModel, loadTexture } from "./assets";
import { ARMIES, ATMOSPHERE, GROUND, SURFACES, armyOf, surfaceUrl, type ArmyId, type ModelKey } from "./catalog";
import { applyTint, tintFor } from "./tint";
import { makeTrooper, poseTrooper, type TrooperRig } from "./trooper";
import { resolveForces, type BattleData, type FactionData, type SystemData } from "./types";

export interface BattlePayload {
  battle: BattleData;
  sys: SystemData;
  factions: FactionData[];
}

type SideIdx = 0 | 1;

interface Soldier {
  side: SideIdx;
  obj: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  rig: TrooperRig | null;
  state: "advance" | "fight" | "dead" | "wait";
  z: number;
  targetX: number;
  speed: number;
  timer: number;
  phase: number;
}

interface Vehicle {
  side: SideIdx;
  obj: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  targetX: number;
  speed: number;
  timer: number;
  hover: boolean;
}

interface Flyer {
  side: SideIdx;
  obj: THREE.Object3D;
  center: THREE.Vector3;
  rx: number;
  rz: number;
  alt: number;
  speed: number;
  phase: number;
  timer: number;
}

interface Bolt {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  big: boolean;
}

interface Burst {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  size: number;
}

let glowTex: THREE.Texture | null = null;
function glow(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,220,160,.85)");
  grd.addColorStop(0.6, "rgba(255,120,40,.25)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class BattleView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.3, 900);
  private controls: OrbitControls;
  private clock = new THREE.Timer();
  private raf = 0;
  private soldiers: Soldier[] = [];
  private vehicles: Vehicle[] = [];
  private flyers: Flyer[] = [];
  private bolts: Bolt[] = [];
  private bursts: Burst[] = [];
  private boltGeo = new THREE.CapsuleGeometry(0.05, 1.1, 2, 6);
  private boltMat: THREE.MeshBasicMaterial[] = [];
  private frontX = 0;
  private strength: [number, number] = [1, 1];
  private armies: [ArmyId, ArmyId] = ["rep", "sep"];
  private hud: HTMLDivElement;
  private alive = true;
  private shake = 0;

  constructor(
    private host: HTMLElement,
    private p: BattlePayload,
    private onClose: () => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.className = "g3d-battle-canvas";
    host.appendChild(this.renderer.domElement);

    this.hud = document.createElement("div");
    this.hud.className = "g3d-battle-hud";
    host.appendChild(this.hud);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 140;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;

    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onKey);
    this.resize();
    void this.build();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.onClose();
  };

  private resize = () => {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private faction(fid: string): FactionData {
    return this.p.factions.find((f) => f.id === fid) || { id: fid, name: fid, color: "#7a8ea5" };
  }

  private async build() {
    const { battle, sys } = this.p;
    const kind = SURFACES[sys.kind] ? sys.kind : "terran";
    const forces = resolveForces(battle, sys.gar || 0);
    const att = this.faction(battle.att);
    const def = this.faction(battle.def);
    this.armies = [armyOf(att), armyOf(def)];
    const power = (f: { inf: number; veh: number; air: number }) => f.inf + f.veh * 6 + f.air * 4 + 1;
    this.strength = [power(forces.att), power(forces.def)];
    const share = this.strength[0] / (this.strength[0] + this.strength[1]);
    // перевес атакующего толкает линию фронта к обороняющимся
    this.frontX = (share - 0.5) * 2 * 16;

    this.renderHud(att, def, forces, share);
    this.buildWorld(kind);

    const mobile = this.host.clientWidth < 820;
    const capInf = mobile ? 12 : 30;
    const sides: [SideIdx, typeof forces.att][] = [
      [0, forces.att],
      [1, forces.def],
    ];
    const jobs: Promise<void>[] = [];
    for (const [side, f] of sides) {
      const roster = ARMIES[this.armies[side]];
      jobs.push(this.spawnInfantry(side, roster.infantry, Math.min(capInf, f.inf)));
      jobs.push(this.spawnVehicles(side, roster.vehicle, Math.min(mobile ? 2 : 5, f.veh)));
      jobs.push(this.spawnFlyers(side, roster.air, Math.min(mobile ? 2 : 4, f.air)));
    }
    this.boltMat = this.armies.map(
      (a) => new THREE.MeshBasicMaterial({ color: ARMIES[a].bolt, toneMapped: false }),
    );
    await Promise.allSettled(jobs);
    if (!this.alive) return;
    this.controls.target.set(this.frontX, 1.5, 0);
    this.camera.position.set(this.frontX - 26, 17, 34);
    this.loop();
  }

  private buildWorld(kind: string) {
    const atmo = new THREE.Color(ATMOSPHERE[kind] ?? 0x78afeb);
    const sky = atmo.clone().multiplyScalar(0.35).lerp(new THREE.Color(0x05070c), 0.35);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 60, 230);

    const hemi = new THREE.HemisphereLight(atmo.clone().lerp(new THREE.Color(0xffffff), 0.4), 0x2a2218, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
    sun.position.set(-40, 70, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 50;
    sc.bottom = -50;
    sc.far = 220;
    this.scene.add(sun);

    const groundMat = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.95 });
    const land = this.p.sys.pal?.land;
    loadTexture(surfaceUrl(GROUND[kind] ?? "terran-a")).then((t) => {
      // карта планеты: у полюсов шапки и растяжение — для земли берём середину,
      // а зеркальный повтор прячет швы между плитками
      const img = t.image as HTMLImageElement;
      const crop = document.createElement("canvas");
      crop.width = img.width;
      crop.height = Math.round(img.height * 0.5);
      crop.getContext("2d")!.drawImage(img, 0, img.height * 0.25, img.width, img.height * 0.5, 0, 0, crop.width, crop.height);
      const g = new THREE.CanvasTexture(crop);
      g.colorSpace = THREE.SRGBColorSpace;
      g.anisotropy = 8;
      g.wrapS = g.wrapT = THREE.MirroredRepeatWrapping;
      g.repeat.set(5, 10);
      groundMat.map = g;
      // своя палитра планеты (pal) подкрашивает землю, без неё — родные цвета
      groundMat.color.set(land ? new THREE.Color().setRGB(land[0] / 255, land[1] / 255, land[2] / 255, THREE.SRGBColorSpace).lerp(new THREE.Color(1, 1, 1), 0.45) : 0xffffff);
      groundMat.needsUpdate = true;
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500, 1, 1), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // укрытия: валуны и обломки вдоль линии фронта
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5b5448, roughness: 1, flatShading: true });
    for (let i = 0; i < 46; i++) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.6, 2.4), 0), rockMat);
      r.position.set(this.frontX + rand(-26, 26), 0.3, rand(-34, 34));
      r.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      r.scale.y = rand(0.4, 0.8);
      r.castShadow = r.receiveShadow = true;
      this.scene.add(r);
    }
  }

  private renderHud(att: FactionData, def: FactionData, forces: ReturnType<typeof resolveForces>, share: number) {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const side = (f: FactionData, n: { inf: number; veh: number; air: number }, cls: string) =>
      `<div class="g3d-side ${cls}"><b style="color:${f.color}">${esc(f.name)}</b>` +
      `<span>пехота ${n.inf} · техника ${n.veh} · авиация ${n.air}</span></div>`;
    const pct = Math.round(share * 100);
    const z = this.p.sys.zones ? ` · секторов ${this.p.sys.zones}` : "";
    this.hud.innerHTML =
      `<div class="g3d-top"><div class="g3d-title"><span class="g3d-eyebrow">Бой · ${esc(this.p.sys.name)}${z}</span>` +
      `</div><button type="button" class="g3d-close" aria-label="Закрыть">×</button></div>` +
      `<div class="g3d-sides">${side(att, forces.att, "att")}${side(def, forces.def, "def")}</div>` +
      `<div class="g3d-bar" title="Перевес сил"><i style="width:${pct}%;background:${att.color}"></i><i style="width:${100 - pct}%;background:${def.color}"></i></div>` +
      `<div class="g3d-bar-labels"><span>${pct}%</span><span>перевес сил</span><span>${100 - pct}%</span></div>` +
      `<div class="g3d-hint">Перетащите — повернуть камеру · колесо — приблизить · Esc — закрыть</div>`;
    this.hud.querySelector(".g3d-close")!.addEventListener("click", () => this.onClose());
  }

  private dir(side: SideIdx) {
    return side === 0 ? 1 : -1;
  }

  /** Цвет для перекраски чужих корпусов (см. tint.ts); у Республики и КНС — null. */
  private tint(side: SideIdx) {
    return tintFor(this.faction(side === 0 ? this.p.battle.att : this.p.battle.def));
  }

  private async spawnInfantry(side: SideIdx, key: ModelKey | "trooper", n: number) {
    if (n <= 0) return;
    const proto = key === "trooper" ? null : await loadModel(key).catch(() => null);
    if (key !== "trooper" && !proto) return;
    if (!this.alive) return;
    const mark = new THREE.Color(this.faction(side === 0 ? this.p.battle.att : this.p.battle.def).color).getHex();
    for (let i = 0; i < n; i++) {
      const rig = proto ? null : makeTrooper(mark);
      const obj = rig ? rig.root : applyTint(instantiate(proto!), this.tint(side), 0.45);
      let mixer: THREE.AnimationMixer | null = null;
      if (proto && proto.animations.length) {
        mixer = new THREE.AnimationMixer(obj);
        const a = mixer.clipAction(proto.animations[0]);
        a.play();
        a.time = Math.random() * proto.animations[0].duration;
      }
      const s: Soldier = {
        side,
        obj,
        mixer,
        rig,
        state: "advance",
        z: rand(-24, 24),
        targetX: 0,
        speed: rand(3.2, 4.4),
        timer: rand(0.5, 2),
        phase: Math.random() * 10,
      };
      this.placeAtRear(s, true);
      this.scene.add(obj);
      this.soldiers.push(s);
    }
  }

  private placeAtRear(s: Soldier, initial = false) {
    const d = this.dir(s.side);
    const back = initial ? rand(6, 30) : rand(30, 42);
    s.obj.position.set(this.frontX - d * back, 0, s.z);
    s.targetX = this.frontX - d * rand(3, 14);
    s.obj.rotation.set(0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    s.obj.visible = true;
    s.state = initial && Math.random() < 0.6 ? "fight" : "advance";
    if (s.state === "fight") s.obj.position.x = s.targetX;
  }

  private async spawnVehicles(side: SideIdx, key: ModelKey, n: number) {
    if (n <= 0) return;
    const proto = await loadModel(key).catch(() => null);
    if (!proto || !this.alive) return;
    const d = this.dir(side);
    const tint = this.tint(side);
    for (let i = 0; i < n; i++) {
      const obj = applyTint(instantiate(proto), tint, 0.45);
      let mixer: THREE.AnimationMixer | null = null;
      let action: THREE.AnimationAction | null = null;
      const clip = proto.animations.find((c) => c.duration > 0.1);
      if (clip) {
        mixer = new THREE.AnimationMixer(obj);
        action = mixer.clipAction(clip);
        action.play();
        action.time = Math.random() * clip.duration;
      }
      const hover = key === "aat";
      const z = -20 + (40 * (i + 0.5)) / n + rand(-3, 3);
      obj.position.set(this.frontX - d * rand(26, 40), hover ? 0.6 : 0, z);
      obj.rotation.y = d > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.scene.add(obj);
      this.vehicles.push({ side, obj, mixer, action, targetX: this.frontX - d * rand(14, 22), speed: key === "atte" ? 1.4 : 2.6, timer: rand(1, 3), hover });
    }
  }

  private async spawnFlyers(side: SideIdx, key: ModelKey, n: number) {
    if (n <= 0) return;
    const proto = await loadModel(key).catch(() => null);
    if (!proto || !this.alive) return;
    const d = this.dir(side);
    const tint = this.tint(side);
    for (let i = 0; i < n; i++) {
      const obj = applyTint(instantiate(proto), tint, 0.45);
      this.scene.add(obj);
      this.flyers.push({
        side,
        obj,
        center: new THREE.Vector3(this.frontX - d * rand(4, 14), 0, rand(-10, 10)),
        rx: rand(26, 40),
        rz: rand(18, 30),
        alt: rand(18, 32),
        speed: (key === "laat" ? 0.18 : 0.32) * (i % 2 ? 1 : -1),
        phase: Math.random() * Math.PI * 2,
        timer: rand(1, 4),
      });
    }
  }

  private enemyTarget(side: SideIdx): THREE.Vector3 {
    const enemies = this.soldiers.filter((s) => s.side !== side && s.state === "fight");
    if (enemies.length && Math.random() < 0.8) {
      const e = enemies[Math.floor(Math.random() * enemies.length)];
      return e.obj.position.clone().add(new THREE.Vector3(rand(-1.2, 1.2), 1.1, rand(-1.2, 1.2)));
    }
    const d = this.dir(side);
    return new THREE.Vector3(this.frontX + d * rand(3, 14), rand(0, 1.5), rand(-24, 24));
  }

  private fire(side: SideIdx, from: THREE.Vector3, to: THREE.Vector3, big = false) {
    const mesh = new THREE.Mesh(this.boltGeo, this.boltMat[side]);
    mesh.scale.setScalar(big ? 2.6 : 1);
    mesh.position.copy(from);
    mesh.lookAt(to);
    mesh.rotateX(Math.PI / 2);
    this.scene.add(mesh);
    const dist = from.distanceTo(to);
    this.bolts.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur: dist / (big ? 70 : 95), big });
  }

  private burst(at: THREE.Vector3, size: number, color = 0xffc070) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    sprite.position.copy(at);
    sprite.scale.setScalar(size * 0.3);
    this.scene.add(sprite);
    this.bursts.push({ sprite, life: 0.5 + size * 0.04, max: 0.5 + size * 0.04, size });
  }

  private kill(s: Soldier) {
    s.state = "dead";
    s.timer = rand(2.5, 4);
    s.obj.userData.fall = 0;
  }

  private loop = () => {
    if (!this.alive) return;
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.getElapsed();
    const [p0, p1] = this.strength;
    // кто слабее — гибнет чаще: так бой по кругу показывает перевес
    const deathRate: [number, number] = [0.05 * (p1 / p0) ** 0.8, 0.05 * (p0 / p1) ** 0.8];

    for (const s of this.soldiers) {
      const d = this.dir(s.side);
      s.mixer?.update(dt * (s.state === "advance" ? 1 : 0.35));
      if (s.state === "advance") {
        s.obj.position.x += d * s.speed * dt;
        if ((d > 0 && s.obj.position.x >= s.targetX) || (d < 0 && s.obj.position.x <= s.targetX)) {
          s.state = "fight";
          s.timer = rand(0.3, 1.5);
        }
        if (s.rig) poseTrooper(s.rig, true, t + s.phase, 0);
      } else if (s.state === "fight") {
        s.timer -= dt;
        let recoil = 0;
        if (s.timer <= 0) {
          const from = s.obj.position.clone().add(new THREE.Vector3(d * 0.6, 1.3, 0));
          this.fire(s.side, from, this.enemyTarget(s.side));
          s.timer = rand(0.7, 2.4);
          recoil = 1;
        }
        if (s.rig) poseTrooper(s.rig, false, t + s.phase, recoil);
        s.obj.rotation.y = (d > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(t * 0.7 + s.phase) * 0.15;
        if (Math.random() < deathRate[s.side] * dt) {
          this.burst(s.obj.position.clone().add(new THREE.Vector3(0, 1.1, 0)), 3, 0xffd2a0);
          this.kill(s);
        }
      } else if (s.state === "dead") {
        s.timer -= dt;
        const fall = Math.min(1, (s.obj.userData.fall += dt * 2.4));
        s.obj.rotation.z = -d * fall * (Math.PI / 2) * 0.95;
        if (s.timer <= 0) {
          s.obj.visible = false;
          s.state = "wait";
          s.timer = rand(1.5, 4);
        }
      } else if (s.state === "wait") {
        s.timer -= dt;
        if (s.timer <= 0) {
          s.obj.rotation.z = 0;
          s.z = rand(-24, 24);
          this.placeAtRear(s);
        }
      }
    }

    for (const v of this.vehicles) {
      const d = this.dir(v.side);
      const moving = (d > 0 && v.obj.position.x < v.targetX) || (d < 0 && v.obj.position.x > v.targetX);
      if (moving) v.obj.position.x += d * v.speed * dt;
      if (v.action) v.action.timeScale = moving ? 1 : 0.12;
      v.mixer?.update(dt);
      if (v.hover) v.obj.position.y = 0.6 + Math.sin(t * 1.6 + v.obj.position.z) * 0.12;
      v.timer -= dt;
      if (v.timer <= 0) {
        const from = v.obj.position.clone().add(new THREE.Vector3(d * 4, v.hover ? 2.2 : 5, 0));
        const to = new THREE.Vector3(this.frontX + d * rand(4, 24), 0.2, rand(-24, 24));
        this.fire(v.side, from, to, true);
        v.timer = rand(1.8, 3.6);
      }
    }

    for (const f of this.flyers) {
      const a = f.phase + t * f.speed;
      const pos = new THREE.Vector3(f.center.x + Math.cos(a) * f.rx, f.alt + Math.sin(t * 0.6 + f.phase) * 2, f.center.z + Math.sin(a) * f.rz);
      const ahead = new THREE.Vector3(
        f.center.x + Math.cos(a + Math.sign(f.speed) * 0.05) * f.rx,
        pos.y,
        f.center.z + Math.sin(a + Math.sign(f.speed) * 0.05) * f.rz,
      );
      f.obj.position.copy(pos);
      f.obj.lookAt(ahead);
      f.obj.rotateZ(-Math.sign(f.speed) * 0.35);
      f.timer -= dt;
      if (f.timer <= 0) {
        this.fire(f.side, pos.clone(), this.enemyTarget(f.side));
        f.timer = rand(1.2, 3);
      }
    }

    for (const b of this.bolts) {
      b.t += dt / Math.max(0.05, b.dur);
      b.mesh.position.lerpVectors(b.from, b.to, Math.min(1, b.t));
    }
    this.bolts = this.bolts.filter((b) => {
      if (b.t < 1) return true;
      this.scene.remove(b.mesh);
      this.burst(b.to, b.big ? 11 : 2.2, b.big ? 0xffb060 : 0xffe0b0);
      if (b.big) this.shake = Math.min(0.6, this.shake + 0.25);
      return false;
    });

    for (const e of this.bursts) {
      e.life -= dt;
      const k = 1 - e.life / e.max;
      e.sprite.scale.setScalar(e.size * (0.3 + k * 0.9));
      (e.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - k);
    }
    this.bursts = this.bursts.filter((e) => {
      if (e.life > 0) return true;
      this.scene.remove(e.sprite);
      (e.sprite.material as THREE.Material).dispose();
      return false;
    });

    this.controls.update();
    if (this.shake > 0.001) {
      this.camera.position.x += rand(-1, 1) * this.shake * 0.25;
      this.camera.position.y += rand(-1, 1) * this.shake * 0.25;
      this.shake *= 0.86;
    }
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKey);
    this.controls.dispose();
    this.boltGeo.dispose();
    this.boltMat.forEach((m) => m.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hud.remove();
  }
}
