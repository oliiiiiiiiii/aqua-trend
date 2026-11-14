// Three.js meshes and shaders for the hex board (see hexboard.ts for the layout). Owned by OrbScene when its variant is a hex one.
import * as THREE from "three";
import { GROUND_Y } from "./scenery";
import { HEX_SOIL, buildHexBoard, type HexBoard, type HexVariant } from "./hexboard";
import type { SceneryPlan } from "./encoding";

const SIDE_VS = /* glsl */ `
attribute float aKind; attribute float aTop; attribute float aVar;
varying vec3 vPos; varying vec3 vWorld; varying float vKind; varying float vTop; varying float vVar;
void main() {
  vPos = position; vKind = aKind; vTop = aTop; vVar = aVar;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
// The outside faces of the board: soil strata (data bands, same uniforms as the glass cut-away), ice, sea floor and rock.
const SIDE_FS = /* glsl */ `
uniform vec3 uTop; uniform vec3 uRoot; uniform vec3 uDeep;
uniform float uTopHatch; uniform float uRootHatch; uniform float uTopData; uniform float uRootData;
uniform vec3 uHatchA; uniform vec3 uHatchB;
uniform float uTopY; uniform float uRootY; uniform float uDpr;
uniform vec3 uLightW;
varying vec3 vPos; varying vec3 vWorld; varying float vKind; varying float vTop; varying float vVar;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float y = vPos.y;
  float wob = 0.005 * sin(vPos.x * 37.0 + vPos.z * 23.0) + 0.004 * sin(vPos.x * 61.0 - vPos.z * 47.0 + 1.3);
  float bTop = uTopY + wob;
  float bRoot = uRootY + wob * 1.8;
  vec2 cell = floor(vec2((vPos.x + vPos.z) * 26.0, y * 34.0));
  float pk = hash(cell);
  vec3 c; float hatch = 0.0; float data = 0.0;
  vec3 rock = uDeep * (0.94 + 0.14 * step(0.82, pk) - 0.06 * step(pk, 0.1)) * (0.9 + 0.2 * vVar);
  if (vKind < 0.5) {
    if (y > bTop) { c = uTop; hatch = uTopHatch; data = uTopData; }
    else if (y > bRoot) { c = uRoot; hatch = uRootHatch; data = uRootData; }
    else { c = rock; }
    if (hatch > 0.5) {
      float s = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / (9.0 * uDpr)));
      c = mix(uHatchA, uHatchB, s);
    } else if (data < 0.5 && y > bRoot) {
      c *= 0.96 + 0.08 * step(0.85, hash(floor(vec2((vPos.x + vPos.z) * 40.0, y * 70.0))));
    }
    float seam = min(abs(y - bTop), abs(y - bRoot));
    c *= mix(0.72, 1.0, smoothstep(0.0, 0.0045, seam));
  } else if (vKind < 1.5) {
    float stripe = 0.5 + 0.5 * sin(y * 70.0 + wob * 40.0);
    if (y > bRoot) c = mix(vec3(0.88, 0.95, 1.0), vec3(0.76, 0.89, 0.98), stripe * smoothstep(bTop, bRoot, y));
    else c = mix(vec3(0.62, 0.8, 0.94), vec3(0.3, 0.42, 0.56), clamp((bRoot - y) / 0.5, 0.0, 1.0)) * (0.96 + 0.08 * step(0.7, pk));
  } else if (vKind < 2.5) {
    // sea floor under the water body, then rock
    c = y > vTop - 0.05 ? vec3(0.86, 0.77, 0.56) * (0.93 + 0.1 * pk) : rock;
  } else {
    c = rock * mix(1.0, 0.7, smoothstep(uRootY, uRootY - 0.9, y));
  }
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(n, cameraPosition - vWorld) < 0.0) n = -n;
  float l = dot(n, normalize(uLightW));
  float tone = l > 0.45 ? 1.0 : (l > 0.05 ? 0.9 : 0.8);
  c *= mix(tone, 1.0, data * 0.6);
  gl_FragColor = vec4(c, 1.0);
}`;

const WATER_VS = /* glsl */ `
attribute float aFoam; attribute float aPh; attribute float aDepth; attribute float aSide;
uniform float uTime; uniform float uLevel;
varying float vFoam; varying float vPh; varying float vDepth; varying float vSide; varying vec2 vXZ; varying float vY;
void main() {
  vec3 p = position;
  vXZ = p.xz; vY = p.y; vFoam = aFoam; vPh = aPh; vDepth = aDepth; vSide = aSide;
  if (p.y > uLevel - 0.001) p.y += 0.0045 * sin(uTime * 1.1 + aPh * 6.283);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const WATER_FS = /* glsl */ `
uniform vec3 uShallow; uniform vec3 uDeepW; uniform vec3 uFoam; uniform float uTime; uniform float uLevel;
varying float vFoam; varying float vPh; varying float vDepth; varying float vSide; varying vec2 vXZ; varying float vY;
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453), b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453), d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  if (vSide > 0.5) {
    float t = clamp((uLevel - vY) / 0.12, 0.0, 1.0);
    gl_FragColor = vec4(mix(uShallow, uDeepW, 0.15 + 0.85 * t) * 0.93, 0.8);
    return;
  }
  float n = vnoise(vXZ * 20.0 + vec2(uTime * 0.2, -uTime * 0.15));
  float shimmer = sin(uTime * 0.9 + vPh * 6.283 + vXZ.x * 6.0 + vXZ.y * 4.0);
  vec3 col = mix(uShallow, uDeepW, vDepth * 0.9) * (1.0 + 0.045 * shimmer);
  float glint = smoothstep(0.93, 1.0, sin(vXZ.x * 17.0 + vXZ.y * 11.0 + uTime * 1.3 + vPh * 6.0)) * smoothstep(0.4, 0.8, n);
  col += vec3(0.55) * glint * 0.2;
  float f = vFoam + (n - 0.5) * 0.25;
  float line = smoothstep(0.6, 0.9, f);
  float wash = smoothstep(0.25, 1.0, vFoam) * 0.22;
  col = mix(col, uFoam, clamp(wash + line * 0.8, 0.0, 0.9));
  gl_FragColor = vec4(col, mix(0.5, 0.86, vDepth) + line * 0.12);
}`;

export const HEX_WATER_SHALLOW: [number, number, number] = [0.3, 0.82, 0.8];
export const HEX_WATER_DEEP: [number, number, number] = [0.1, 0.55, 0.7];

const CAP_GEO = (() => {
  const g = new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  return g;
})();

export class HexRig {
  readonly group = new THREE.Group();
  board: HexBoard | null = null;
  private sideMat: THREE.ShaderMaterial;
  private waterMat: THREE.ShaderMaterial;
  private meshes: THREE.Mesh[] = [];
  private caps: THREE.Mesh[] = [];

  /** `shared`: the soil uniforms of OrbScene (the bands are driven by the same values as in the glass cut-away) */
  constructor(parent: THREE.Object3D, shared: Record<string, THREE.IUniform>, private toon: THREE.Material, private snowMat: THREE.Material, private leafMat: THREE.Material) {
    const pick = (...names: string[]) => Object.fromEntries(names.map((n) => [n, shared[n]]));
    this.sideMat = new THREE.ShaderMaterial({
      vertexShader: SIDE_VS, fragmentShader: SIDE_FS,
      uniforms: { ...pick("uTop", "uRoot", "uDeep", "uTopHatch", "uRootHatch", "uTopData", "uRootData", "uHatchA", "uHatchB", "uDpr", "uLightW"), uTopY: { value: HEX_SOIL.topY }, uRootY: { value: HEX_SOIL.rootY } },
    });
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uLevel: { value: GROUND_Y },
        uShallow: { value: new THREE.Vector3(...HEX_WATER_SHALLOW) }, uDeepW: { value: new THREE.Vector3(...HEX_WATER_DEEP) }, uFoam: { value: new THREE.Vector3(0.95, 1, 1) },
      },
    });
    parent.add(this.group);
  }

  set(plan: SceneryPlan, seed: string, variant: HexVariant): HexBoard {
    this.clear();
    const b = buildHexBoard(plan, seed, variant);
    this.board = b;
    const add = (g: THREE.BufferGeometry | null, m: THREE.Material, order = 0) => {
      if (!g) return;
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = order;
      this.group.add(mesh);
      this.meshes.push(mesh);
    };
    add(b.top, this.toon);
    add(b.sides, this.sideMat);
    add(b.props, this.toon);
    add(b.leaves, this.leafMat);
    add(b.extras, this.toon);
    add(b.water, this.waterMat, 5);
    for (const p of b.peaks) {
      const m = new THREE.Mesh(CAP_GEO, this.snowMat);
      m.position.set(p.x, p.y - 0.004, p.z);
      m.visible = false;
      this.group.add(m);
      this.caps.push(m);
    }
    return b;
  }

  /** snow caps: f = snowSize(swe) in 0..1, or null for none. Footprint and height both grow with f. */
  setSnow(f: number | null) {
    const b = this.board;
    if (!b) return;
    this.caps.forEach((m, i) => {
      const p = b.peaks[i];
      const on = f != null && f > 0 && f >= p.from;
      m.visible = on;
      if (!on) return;
      const k = f! * (i === 0 ? 1 : 0.8);
      m.scale.set(p.r * (0.35 + 0.65 * k), p.h * Math.max(0.12, k), p.r * (0.35 + 0.65 * k));
    });
  }

  setTime(t: number) { this.waterMat.uniforms.uTime.value = t; }

  private clear() {
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); }
    for (const m of this.caps) this.group.remove(m);
    this.meshes = []; this.caps = [];
    this.board = null;
  }

  dispose() {
    this.clear();
    this.sideMat.dispose();
    this.waterMat.dispose();
  }
}
