import * as THREE from "three";
import { Planet } from "./planet";
import type { SystemData } from "./types";

interface Entry {
  key: string;
  planet: Planet;
  canvas: HTMLCanvasElement;
  drawn: boolean;
  last: number;
}

/** 3D-планеты для узлов 2D-карты: один общий невидимый WebGL-холст рисует
 * шары по очереди (несколько за кадр) и копирует их в обычные canvas, которые
 * карта рисует через drawImage вместо плоских спрайтов. */
export class PlanetSprites {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1.12, 1.12, 1.12, -1.12, 0.1, 10);
  private entries = new Map<string, Entry>();
  private queue: string[] = [];
  private cursor = 0;

  constructor(private px = 128) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(px, px, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);
  }

  /** Готовая картинка планеты или null, пока текстура не загрузилась (карта рисует 2D-спрайт). */
  get(sys: SystemData): HTMLCanvasElement | null {
    const key = JSON.stringify([sys.kind, sys.pal || null]);
    let e = this.entries.get(sys.id);
    if (!e || e.key !== key) {
      if (e) e.planet.dispose();
      const planet = new Planet(sys);
      planet.setZoneOverlay(false);
      const canvas = e?.canvas || document.createElement("canvas");
      canvas.width = canvas.height = this.px;
      e = { key, planet, canvas, drawn: false, last: performance.now() };
      this.entries.set(sys.id, e);
      if (!this.queue.includes(sys.id)) this.queue.push(sys.id);
    }
    return e.drawn ? e.canvas : null;
  }

  /** Перерисовать `budget` планет (по кругу) — так каждая медленно вращается. */
  tick(now: number, budget = 4) {
    const n = this.queue.length;
    for (let i = 0; i < Math.min(budget, n); i++) {
      const id = this.queue[this.cursor % n];
      this.cursor = (this.cursor + 1) % n;
      const e = this.entries.get(id);
      if (!e || !e.planet.ready) continue;
      e.planet.update(Math.min(2, (now - e.last) / 1000) * 3, now / 1000);
      e.last = now;
      this.scene.add(e.planet.group);
      this.renderer.render(this.scene, this.camera);
      this.scene.remove(e.planet.group);
      const ctx = e.canvas.getContext("2d")!;
      ctx.clearRect(0, 0, this.px, this.px);
      ctx.drawImage(this.renderer.domElement, 0, 0);
      e.drawn = true;
    }
  }

  /** Забыть системы, которых больше нет на карте. */
  prune(ids: Set<string>) {
    for (const [id, e] of this.entries) {
      if (ids.has(id)) continue;
      e.planet.dispose();
      this.entries.delete(id);
    }
    this.queue = this.queue.filter((id) => ids.has(id));
  }

  dispose() {
    for (const e of this.entries.values()) e.planet.dispose();
    this.entries.clear();
    this.renderer.dispose();
  }
}
