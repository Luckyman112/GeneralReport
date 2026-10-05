import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { MODELS, type ModelKey } from "./catalog";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export interface Prototype {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  skinned: boolean;
}

const cache = new Map<ModelKey, Promise<Prototype>>();

/** Приводит модель к реальному размеру и ставит «на пол» по центру, вперёд — +Z. */
function normalize(gltf: GLTF, key: ModelKey): Prototype {
  const spec = MODELS[key];
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const ref = "byHeight" in spec && spec.byHeight ? size.y : Math.max(size.x, size.y, size.z);
  const k = spec.size / (ref || 1);
  const center = box.getCenter(new THREE.Vector3());

  const pivot = new THREE.Group();
  pivot.name = key;
  root.position.set(-center.x, -box.min.y, -center.z);
  const holder = new THREE.Group();
  holder.add(root);
  holder.scale.setScalar(k);
  holder.rotation.y = spec.yaw ?? 0;
  pivot.add(holder);

  let skinned = false;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
      skinned = true;
      // кости скелета могут уезжать за исходный bbox — не даём мешу исчезать
      m.frustumCulled = false;
    }
    m.castShadow = true;
    m.receiveShadow = true;
  });
  return { scene: pivot, animations: gltf.animations, skinned };
}

export function loadModel(key: ModelKey): Promise<Prototype> {
  let p = cache.get(key);
  if (!p) {
    p = loader.loadAsync(MODELS[key].url).then((g) => normalize(g, key));
    cache.set(key, p);
  }
  return p;
}

/** Экземпляр модели: свой скелет для анимированных, общая геометрия и материалы. */
export function instantiate(proto: Prototype): THREE.Object3D {
  return proto.skinned ? cloneSkinned(proto.scene) : proto.scene.clone(true);
}

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, Promise<THREE.Texture>>();

export function loadTexture(url: string, srgb = true): Promise<THREE.Texture> {
  let p = texCache.get(url);
  if (!p) {
    p = texLoader.loadAsync(url).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      t.wrapS = THREE.RepeatWrapping;
      return t;
    });
    texCache.set(url, p);
  }
  return p;
}
