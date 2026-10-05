import * as THREE from "three";
import { instantiate, loadModel } from "./assets";
import { ARMIES, MODELS, type ArmyId } from "./catalog";

/** Корабль армии, отрисованный сверху-сбоку в прозрачную картинку, носом вправо
 * (для блокад на 2D-карте вместо плоских силуэтов). */
export async function shipSprites(px = 160): Promise<Record<ArmyId, HTMLCanvasElement>> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(px, px, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const out = {} as Record<ArmyId, HTMLCanvasElement>;
  try {
    for (const army of Object.keys(ARMIES) as ArmyId[]) {
      const key = ARMIES[army].capital;
      const proto = await loadModel(key);
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xaabbdd, 0.9));
      const sun = new THREE.DirectionalLight(0xffffff, 2.8);
      sun.position.set(-2, 4, 3);
      scene.add(sun);
      const ship = instantiate(proto);
      ship.scale.setScalar(2 / MODELS[key].size);
      ship.rotation.y = Math.PI / 2;
      scene.add(ship);
      const box = new THREE.Box3().setFromObject(ship);
      const c = box.getCenter(new THREE.Vector3());
      ship.position.sub(c);
      const cam = new THREE.OrthographicCamera(-1.1, 1.1, 1.1, -1.1, 0.1, 20);
      cam.position.set(0, 5, 2.6);
      cam.lookAt(0, 0, 0);
      renderer.clear();
      renderer.render(scene, cam);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = px;
      canvas.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
      out[army] = canvas;
    }
  } finally {
    renderer.dispose();
  }
  return out;
}
