import * as THREE from "three";
import { loadTexture } from "./assets";
import { ATMOSPHERE, SURFACES, hashStr, surfaceUrl } from "./catalog";
import type { SystemData } from "./types";

export const MAX_ZONES = 12;
export const SUN_DIR = new THREE.Vector3(0.62, 0.34, 0.71).normalize();

// палитра планеты в 0..255 sRGB (как в 2D-карте), шейдер работает в линейном пространстве
const rgb = (c: number[] | undefined, fallback: THREE.Color) =>
  c && c.length === 3 ? new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace) : fallback.clone();

const SURFACE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SURFACE_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform bool uRecolor;
  uniform vec3 uSea, uLand, uHigh, uAtmo, uSun, uLights;
  uniform float uLightsAmt, uLava;
  uniform int uZones;
  uniform vec3 uZoneCol[${MAX_ZONES}];
  uniform float uZoneHot[${MAX_ZONES}];
  uniform float uZoneAmt, uTime;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  void main() {
    vec3 base = texture2D(map, vUv).rgb;
    // яркость считаем в sRGB: пороги суша/море/вершины подобраны под картинку, а не под линейные значения
    float lum = dot(pow(base, vec3(1.0 / 2.2)), vec3(0.299, 0.587, 0.114));
    vec3 col = base;
    if (uRecolor) {
      col = lum < 0.5 ? mix(uSea, uLand, smoothstep(0.0, 0.5, lum)) : mix(uLand, uHigh, smoothstep(0.5, 1.0, lum));
      col *= 0.75 + 0.5 * lum;
    }

    vec3 n = normalize(vNormalW);
    float ndl = dot(n, uSun);
    float day = smoothstep(-0.12, 0.35, ndl);
    float diffuse = clamp(ndl * 0.9 + 0.1, 0.0, 1.0);
    vec3 lit = col * (0.04 + 1.05 * diffuse);

    // ночная сторона: огни городов / светящаяся лава
    float night = 1.0 - smoothstep(-0.25, 0.1, ndl);
    lit += uLights * uLightsAmt * night * smoothstep(0.35, 0.9, lum);
    lit += vec3(1.0, 0.35, 0.08) * uLava * smoothstep(0.45, 0.85, base.r - base.g * 0.6) * (0.35 + 0.65 * night);

    // блик на «воде» (тёмные участки)
    vec3 h = normalize(uSun + vViewDir);
    float water = 1.0 - smoothstep(0.18, 0.4, lum);
    lit += vec3(0.9, 0.95, 1.0) * pow(max(dot(n, h), 0.0), 90.0) * water * day * 0.18;

    // атмосферная дымка по краю диска
    float rim = pow(1.0 - max(dot(n, vViewDir), 0.0), 2.6);
    lit = mix(lit, uAtmo * (0.25 + 0.9 * day), rim * 0.3);

    // сектора захвата — долготные доли, цвет владельца, граница светится
    if (uZones > 0) {
      float f = vUv.x * float(uZones);
      int idx = int(floor(f));
      vec3 zc = vec3(0.0);
      float hot = 0.0;
      for (int i = 0; i < ${MAX_ZONES}; i++) {
        if (i == idx) { zc = uZoneCol[i]; hot = uZoneHot[i]; }
      }
      float edge = min(fract(f), 1.0 - fract(f));
      float line = 1.0 - smoothstep(0.0, 0.004 * float(uZones), edge);
      float pulse = hot * (0.5 + 0.5 * sin(uTime * 3.0));
      lit = mix(lit, zc * (0.35 + 0.65 * day), uZoneAmt * (0.14 + 0.22 * pulse));
      lit += zc * line * uZoneAmt * 0.75;
    }

    gl_FragColor = vec4(lit, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const CLOUD_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uSun, uTint;
  uniform float uAmt;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    // текстуры облаков белые, плотность — в альфа-канале
    vec4 tx = texture2D(map, vUv);
    float c = tx.a * dot(tx.rgb, vec3(0.333));
    float a = smoothstep(0.2, 0.9, c) * uAmt;
    float ndl = dot(normalize(vNormalW), uSun);
    float light = clamp(ndl * 0.9 + 0.15, 0.03, 1.0);
    gl_FragColor = vec4(uTint * light, a * (0.25 + 0.75 * smoothstep(-0.3, 0.2, ndl)));
    #include <colorspace_fragment>
  }
`;

const ATMO_FRAG = /* glsl */ `
  uniform vec3 uColor, uSun;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vec3 n = normalize(vNormalW);
    float rim = pow(1.0 - abs(dot(n, vViewDir)), 3.0);
    float day = smoothstep(-0.45, 0.4, dot(n, uSun));
    gl_FragColor = vec4(uColor, rim * (0.15 + 0.85 * day) * 0.6);
  }
`;

export interface ZoneState {
  colors: THREE.Color[];
  hot: number[];
}

/** Порядок секторов: владельцы по убыванию доли, спорный — сразу после основного. */
export function zoneLayout(sys: SystemData, colorOf: (fid: string) => string, contested: string[]): ZoneState | null {
  const total = Math.min(MAX_ZONES, Math.max(0, Math.round(sys.zones || 0)));
  if (!total) return null;
  const holders = Object.entries(sys.zoneHolders || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const colors: THREE.Color[] = [];
  const owners: string[] = [];
  for (const [fid, n] of holders) for (let i = 0; i < n && colors.length < total; i++) {
    colors.push(new THREE.Color(colorOf(fid)));
    owners.push(fid);
  }
  const neutral = new THREE.Color(0x3a4658);
  while (colors.length < total) {
    colors.push(neutral.clone());
    owners.push("");
  }
  // горячая граница — сектор, который сейчас оспаривают (рядом с атакующим)
  const hot = owners.map(() => 0);
  if (contested.length) {
    const i = owners.findIndex((o, k) => contested.includes(o) && contested.some((c) => c !== o && owners[(k + 1) % owners.length] === c));
    if (i >= 0) hot[i] = 1;
    else hot[owners.findIndex((o) => contested.includes(o))] = 1;
  }
  return { colors, hot };
}

export class Planet {
  readonly group = new THREE.Group();
  private surface: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private clouds: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  private spin: THREE.Group;
  /** Основная текстура загружена — до этого шар рисуется пустым. */
  ready = false;

  constructor(private sys: SystemData) {
    this.spin = new THREE.Group();
    this.group.add(this.spin);
    const kind = SURFACES[sys.kind] ? sys.kind : "terran";
    const surf = SURFACES[kind];
    const atmo = new THREE.Color(ATMOSPHERE[kind] ?? 0x78afeb);
    const pal = sys.pal;
    const recolor = pal?.sea ? [pal.sea, pal.land, pal.high] : surf.recolor;

    const zoneCols = Array.from({ length: MAX_ZONES }, () => new THREE.Color());
    const uniforms = {
      map: { value: new THREE.Texture() },
      uRecolor: { value: Boolean(recolor) },
      uSea: { value: rgb(recolor?.[0], new THREE.Color(0.1, 0.2, 0.35)) },
      uLand: { value: rgb(recolor?.[1], new THREE.Color(0.3, 0.45, 0.25)) },
      uHigh: { value: rgb(recolor?.[2], new THREE.Color(0.8, 0.78, 0.7)) },
      uAtmo: { value: pal?.atmo ? rgb(pal.atmo, atmo) : atmo },
      uSun: { value: SUN_DIR.clone() },
      uLights: { value: new THREE.Color(1.0, 0.78, 0.42) },
      uLightsAmt: { value: kind === "urban" ? 1.6 : kind === "terran" ? 0.12 : 0 },
      uLava: { value: kind === "volcanic" ? 1.4 : 0 },
      uZones: { value: 0 },
      uZoneCol: { value: zoneCols },
      uZoneHot: { value: new Array(MAX_ZONES).fill(0) },
      uZoneAmt: { value: 1 },
      uTime: { value: 0 },
    };
    this.surface = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 96),
      new THREE.ShaderMaterial({ uniforms, vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG }),
    );
    this.spin.add(this.surface);

    const variants = surf.maps;
    const mapName = variants[hashStr(sys.id) % variants.length];
    const customSrc = pal?.src;
    loadTexture(customSrc || surfaceUrl(mapName))
      .catch(() => loadTexture(surfaceUrl(mapName)))
      .then((t) => {
        uniforms.map.value = t;
        // пользовательская картинка — уже в своих цветах, не перекрашиваем
        if (customSrc) uniforms.uRecolor.value = false;
        this.ready = true;
      });

    const cloudAmt = pal?.cloud ?? (kind === "desert" ? 0.25 : kind === "urban" ? 0.3 : 0.55);
    if (surf.clouds && cloudAmt > 0.02) {
      const cu = {
        map: { value: new THREE.Texture() },
        uSun: { value: SUN_DIR.clone() },
        uTint: { value: rgb(pal?.cloudCol, new THREE.Color(0.95, 0.97, 1)) },
        uAmt: { value: Math.min(0.85, cloudAmt) },
      };
      this.clouds = new THREE.Mesh(
        new THREE.SphereGeometry(1.012, 96, 64),
        new THREE.ShaderMaterial({
          uniforms: cu,
          vertexShader: SURFACE_VERT,
          fragmentShader: CLOUD_FRAG,
          transparent: true,
          depthWrite: false,
        }),
      );
      this.spin.add(this.clouds);
      loadTexture(surfaceUrl(surf.clouds), false).then((t) => (cu.map.value = t));
    }

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.07, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: uniforms.uAtmo.value.clone() }, uSun: { value: SUN_DIR.clone() } },
        vertexShader: SURFACE_VERT,
        fragmentShader: ATMO_FRAG,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.group.add(glow);
    this.spin.rotation.z = 0.32;
  }

  setZones(state: ZoneState | null) {
    const u = this.surface.material.uniforms;
    u.uZones.value = state ? state.colors.length : 0;
    if (!state) return;
    state.colors.forEach((c, i) => (u.uZoneCol.value as THREE.Color[])[i].copy(c));
    (u.uZoneHot.value as number[]).fill(0);
    state.hot.forEach((h, i) => ((u.uZoneHot.value as number[])[i] = h));
  }

  setZoneOverlay(on: boolean) {
    this.surface.material.uniforms.uZoneAmt.value = on ? 1 : 0;
  }

  update(dt: number, t: number) {
    this.surface.rotation.y += dt * 0.035;
    if (this.clouds) this.clouds.rotation.y += dt * 0.048;
    this.surface.material.uniforms.uTime.value = t;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}
