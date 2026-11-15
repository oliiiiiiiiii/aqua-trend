// Plain three.js crystal ball. The scenery is built once per region/climate; month changes only move eased targets,
// instance counts and uniforms (no geometry rebuild), so playback stays fluid.
import * as THREE from "three";
import {
  BEAD_STEP, MAX_BEADS, MAX_PARTICLES, PARTICLE_RATE, snowCapAllowed, snowSize, soilColor, tairColor, type OrbVariant, type RGB, type SceneryPlan,
} from "./encoding";
import { HEX_SOIL, hexSlots, type HexBoard } from "./hexboard";
import { HexRig } from "./hexrig";
import { makeLeafMaterial, type LeafMaterial } from "./leafmat";
import { NEUTRAL_LEAVES, lerpLeaf, type LeafState } from "./season";
import { VARIABLES } from "@/lib/variables";
import type { OrbAnchors } from "@/lib/contracts";
import type { VarId } from "@/lib/types";
import {
  FRONT_SECTOR, GROUND_Y, ISLE_IRR, R_GLASS, R_IN, RIM, SEABED_DEPTH, SOIL, SOIL_NEUTRAL,
  buildCloud, buildGround, buildPedestal, buildProps, buildSnowPatch, buildSoilCap, coastX, makeLayout, seeded, type Layout,
} from "./scenery";

export interface ChannelInput { active: boolean; missing: boolean; drawn: number }
export interface FrameInput {
  precip: ChannelInput; et: ChannelInput; runoff: ChannelInput;
  soil_top: ChannelInput; root_zone: ChannelInput; swe: ChannelInput;
  /** null = neutral white vapour; otherwise the air temperature that colours the puffs */
  tair: ChannelInput | null;
}
export interface ThemeInput {
  cool: RGB; mid: RGB; warm: RGB; precip: RGB; runoff: RGB; soilTop: RGB; rootZone: RGB;
  hatchA: RGB; hatchB: RGB; rim: RGB; night: boolean;
  temperatureTint?: { surface: "air" | "land" | "ocean"; color: RGB };
}
export type AnchorName = "cloud" | "puffs" | "runoff" | "peak" | "soilTop" | "rootZone" | "deep";
export interface Counts { precip: number; et: number; runoff: number }

const ZOOM_MIN = 0.85;
const ELEV_MIN = 5, ELEV_MAX = 70; // degrees above the horizon: never flips, never goes under the board
const FALL_SPEED = 0.6; // scene units per second, fixed: speed carries no meaning
const RISE_SPEED = 0.2;
const SLIDE_SPEED = 0.2;
const WATER_SHALLOW: [number, number, number] = [0.3, 0.82, 0.8];
const WATER_DEEP: [number, number, number] = [0.1, 0.55, 0.7];
const ARROW_TILT = (40 * Math.PI) / 180;
const ARROW_SCALE = 0.52; // runoff arrows are small, a flow field rather than a swarm
const COMPACT_COUNT_SCALE = 1;
const EASE_TAU = 0.1; // s; ~95 % of a change after 300 ms

const PARTICLE_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize((modelViewMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
// Flat colour with a light two-tone shade, so the hue stays close to the legend swatch.
const PARTICLE_FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uLight;
uniform float uShade;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 n = normalize(vN);
  float l = dot(n, normalize(uLight));
  float tone = l > 0.25 ? 1.0 : (l > -0.35 ? 0.9 : 0.8);
  float rim = pow(1.0 - clamp(dot(n, normalize(vV)), 0.0, 1.0), 3.0);
  vec3 c = uColor * mix(1.0, tone, uShade) + vec3(rim * 0.12 * uShade);
  gl_FragColor = vec4(c, uOpacity);
}`;

// GLSL twins of scenery.coastX / isleRadius, shared by the cut-away and the water surface
const SHORE_GLSL = /* glsl */ `
float coastAt(vec3 cs, float z) {
  return cs.x + cs.y * (0.75 * sin(z * 3.2 + cs.z) + 0.4 * sin(z * 7.7 + cs.z * 1.9 + 1.0) + 0.2 * sin(z * 16.1 + cs.z * 2.7 + 2.0));
}
float isleAt(vec3 isle, vec2 irr, vec2 p) {
  float a = atan(p.y - isle.y, p.x - isle.x);
  return isle.z * (1.0 + irr.y * (0.55 * sin(a * 3.0 + irr.x) + 0.3 * sin(a * 5.0 + irr.x * 2.0 + 1.0) + 0.15 * sin(a * 9.0 + irr.x * 3.0)));
}`;
const SOIL_VS = /* glsl */ `
varying vec3 vPos;
varying vec3 vWorld;
void main() {
  vPos = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const SOIL_FS = /* glsl */ `
${SHORE_GLSL}
uniform vec3 uTop; uniform vec3 uRoot; uniform vec3 uDeep;
uniform float uTopHatch; uniform float uRootHatch; uniform float uTopData; uniform float uRootData;
uniform vec3 uHatchA; uniform vec3 uHatchB;
uniform float uTopY; uniform float uRootY; uniform float uDpr;
uniform vec3 uLightW;
uniform float uSeaMode;   // 0 none, 1 coast (sea at +x), 2 open sea
uniform vec3 uCoast;      // c0, amp, phase
uniform float uIceCap;    // 1: the dry part of the cut-away is ice
uniform float uGroundY; uniform float uSeabed; uniform float uRim;
uniform vec3 uWaterTop; uniform vec3 uWaterDeep;
uniform vec3 uIsle; uniform vec2 uIsleIrr; uniform float uHasIsle;
varying vec3 vPos;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float ang = atan(vPos.z, vPos.x);
  float wob = 0.006 * sin(ang * 7.0) + 0.004 * sin(ang * 13.0 + 1.3);
  float y = vPos.y;
  // dd: distance from the shoreline measured on the rim at this angle (> 0 on land, < 0 in water), the same function the
  // ground uses, so the cross-section follows the very same coast profile as the surface above it
  vec2 pr = vec2(cos(ang), sin(ang)) * uRim;
  float dd = 10.0;
  if (uSeaMode > 1.5) dd = uHasIsle > 0.5 ? isleAt(uIsle, uIsleIrr, pr) - length(pr - uIsle.xy) : -1.0;
  else if (uSeaMode > 0.5) dd = coastAt(uCoast, pr.y) - pr.x;
  // ground surface under the rim, relative to the waterline (twin of scenery.makeLayout height without hills)
  float hs = 0.0;
  if (uSeaMode > 0.5) {
    if (uSeaMode > 1.5 && uIsleIrr.y < 0.001) hs = -uSeabed;
    else hs = dd <= 0.0 ? -0.03 - (uSeabed - 0.03) * smoothstep(0.0, 0.45, -dd) : -0.03 + 0.07 * smoothstep(0.0, 0.12, dd);
  }
  float surfY = uGroundY + min(hs, 0.0);
  float dep = surfY - y; // depth below the ground surface
  // strata follow the surface: the topsoil pinches out at the shore, the root zone thins out into the shelf, a sand layer covers the seabed
  float kTop = smoothstep(0.02, 0.14, dd);
  float bTop = (uGroundY - uTopY) * kTop + wob * kTop;
  float bRoot = (uGroundY - uRootY) * smoothstep(-0.05, 0.35, dd) + wob * 1.8 * smoothstep(0.0, 0.3, dd);
  float bSand = bRoot + 0.12 * (1.0 - smoothstep(0.1, 0.4, dd));
  vec3 sand = vec3(0.89, 0.8, 0.59) * (0.97 + 0.05 * sin(dep * 90.0));
  vec3 c; float hatch = 0.0; float data = 0.0;
  if (dep < 0.0) {
    // water column: translucent blue from the waterline down to the seabed, a little darker with depth
    c = mix(uWaterTop, uWaterDeep, clamp((uGroundY - y) / uSeabed, 0.0, 1.0) * 0.8);
    data = 0.5;
  } else if (dep < bTop && uIceCap < 0.5) { c = uTop; hatch = uTopHatch; data = uTopData; }
  else if (dep < bRoot) {
    if (uIceCap > 0.5) {
      float stripe = 0.5 + 0.5 * sin(dep * 70.0 + wob * 40.0);
      c = mix(vec3(0.88, 0.95, 1.0), vec3(0.76, 0.89, 0.98), stripe * smoothstep(bTop, bRoot, dep));
    } else { c = uRoot; hatch = uRootHatch; data = uRootData; }
  }
  else if (dep < bSand) c = sand;
  else {
    vec2 cell = floor(vec2(ang * 26.0, y * 34.0));
    float pk = hash(cell);
    if (uIceCap > 0.5) {
      float t = clamp((uRootY - y) / 0.5, 0.0, 1.0);
      c = mix(vec3(0.62, 0.8, 0.94), vec3(0.3, 0.42, 0.56), t) * (0.96 + 0.08 * step(0.7, pk));
    } else c = uDeep * (0.94 + 0.14 * step(0.82, pk) - 0.06 * step(pk, 0.1));
  }
  if (dep >= 0.0 && uIceCap < 0.5) {
    if (hatch > 0.5) {
      float s = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / (9.0 * uDpr)));
      c = mix(uHatchA, uHatchB, s);
    } else if (data < 0.5 && dep < bRoot) {
      // tiny pebbles in neutral earth, never in a data band (texture would read as a value change)
      float pk = hash(floor(vec2(ang * 40.0, y * 70.0)));
      c *= 0.96 + 0.08 * step(0.85, pk);
    }
    float seam = min(abs(dep - bTop) + 1.0 - kTop, abs(dep - bRoot) + 1.0 - smoothstep(-0.05, 0.1, dd));
    c *= mix(0.72, 1.0, smoothstep(0.0, 0.0045, seam));
  }
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(n, cameraPosition - vWorld) < 0.0) n = -n;
  float l = dot(n, normalize(uLightW));
  float tone = l > 0.45 ? 1.0 : (l > 0.05 ? 0.9 : 0.8);
  c *= mix(tone, 1.0, data * 0.6);
  gl_FragColor = vec4(c, 1.0);
}`;

const WATER_VS = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec2 vXZ;
void main() {
  vec3 p = position;
  vXZ = p.xz;
  p.y += 0.007 * sin(p.x * 9.0 + uTime * 1.1) + 0.006 * sin(p.z * 11.0 - uTime * 0.8) + 0.004 * sin((p.x + p.z) * 15.0 + uTime * 1.6);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const WATER_FS = /* glsl */ `
${SHORE_GLSL}
uniform vec3 uShallow; uniform vec3 uDeepW; uniform vec3 uFoam; uniform vec3 uLightW;
uniform float uSeaMode; uniform vec3 uCoast; uniform vec3 uIsle; uniform vec2 uIsleIrr; uniform float uHasIsle; uniform float uRim; uniform float uTime;
varying vec3 vWorld;
varying vec2 vXZ;
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453), b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453), d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  if (length(vXZ) > uRim) discard;
  float sd;
  if (uSeaMode > 1.5) sd = uHasIsle > 0.5 ? isleAt(uIsle, uIsleIrr, vXZ) - length(vXZ - uIsle.xy) : -1.0;
  else sd = coastAt(uCoast, vXZ.y) - vXZ.x;
  float n = vnoise(vXZ * 16.0 + vec2(uTime * 0.25, -uTime * 0.18));
  float sdw = sd + (n - 0.5) * 0.02; // the waterline wanders a little: no ruler-straight edge
  vec3 nrm = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (nrm.y < 0.0) nrm = -nrm;
  float l = dot(nrm, normalize(uLightW));
  float tone = l > 0.78 ? 1.1 : (l > 0.69 ? 1.0 : 0.9);
  float depth = smoothstep(0.0, 0.5, -sdw);
  vec3 col = mix(uShallow, uDeepW, pow(depth, 0.85)) * tone;
  // soft foam: a wide faint wash at the shore, a thin line, and a broken second line a little further out
  float wash = (1.0 - smoothstep(0.0, 0.1, -sdw)) * step(sdw, 0.0) * 0.28;
  float line = (1.0 - smoothstep(0.0, 0.026, abs(sdw + 0.012))) * (0.55 + 0.45 * n);
  float line2 = (1.0 - smoothstep(0.0, 0.014, abs(sdw + 0.07 + 0.01 * sin(uTime * 0.6)))) * smoothstep(0.55, 0.7, n) * 0.55;
  col = mix(col, uFoam, clamp(wash + line * 0.8 + line2, 0.0, 0.9));
  gl_FragColor = vec4(col, mix(0.34, 0.9, pow(depth, 0.7)));
}`;

const SKY_VS = /* glsl */ `
varying vec3 vPos;
void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = /* glsl */ `
uniform vec3 uHorizon; uniform vec3 uZenith; uniform float uGround;
varying vec3 vPos;
void main() {
  if (vPos.y < uGround - 0.02) discard;
  float t = smoothstep(uGround, 0.95, vPos.y);
  gl_FragColor = vec4(mix(uHorizon, uZenith, t), 1.0);
}`;

const GLASS_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
// Cheap fake glass: fresnel rim + a soft window highlight + a sharp glint + a faint bounce crescent.
const GLASS_FS = /* glsl */ `
uniform vec3 uRim; uniform float uRimStrength;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 n = normalize(vN);
  float ndv = clamp(dot(n, normalize(vV)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.6);
  vec2 p = n.xy;
  vec2 q = (p - vec2(-0.42, 0.5)) * mat2(0.8, 0.6, -0.6, 0.8);
  float win = smoothstep(0.26, 0.05, length(q * vec2(1.0, 2.1)));
  float glint = smoothstep(0.075, 0.0, length(p - vec2(-0.56, 0.62)));
  float lp = length(p);
  float cres = smoothstep(0.84, 0.95, lp) * (1.0 - smoothstep(0.95, 1.0, lp)) * smoothstep(0.35, 0.9, dot(p / max(lp, 1e-4), normalize(vec2(0.75, -0.66))));
  float rimA = fres * uRimStrength;
  float hiA = win * 0.32 + glint * 0.9 + cres * 0.38;
  float a = clamp(0.025 + rimA + hiA, 0.0, 0.96);
  vec3 col = (uRim * (rimA + 0.025) + vec3(1.0) * hiA) / max(a, 1e-3);
  gl_FragColor = vec4(col, a);
}`;

const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const srgb = (c: RGB) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
const vec3 = (c: RGB) => new THREE.Vector3(c[0], c[1], c[2]);

interface Slots { a: Float32Array; b: Float32Array; c: Float32Array; d: Float32Array; e: Float32Array }
function slots(n: number): Slots { return { a: new Float32Array(n), b: new Float32Array(n), c: new Float32Array(n), d: new Float32Array(n), e: new Float32Array(n) }; }
const GOLDEN = 0.6180339887;

export class OrbScene {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private diorama = new THREE.Group();
  private toonGradient: THREE.DataTexture;
  private propMat: THREE.MeshToonMaterial;
  private groundMat: THREE.MeshToonMaterial;
  private leafMat: LeafMaterial;
  private leaves: THREE.Mesh | null = null;
  private leafTarget: LeafState = NEUTRAL_LEAVES;
  private leafCur: LeafState = NEUTRAL_LEAVES;
  private leafSet = false;
  private compact: boolean;
  /** compact orbs draw about half as many particles (set to 1 for counts comparable with the full-size orb) */
  private countScale: number;
  private lastRender = 0;
  private cloudMat: THREE.MeshToonMaterial;
  private snowMat: THREE.MeshToonMaterial;
  private soilMat: THREE.ShaderMaterial;
  private skyMat: THREE.ShaderMaterial;
  private glassMat: THREE.ShaderMaterial;
  private dropMat: THREE.ShaderMaterial;
  private puffMat: THREE.ShaderMaterial;
  private streakMat: THREE.ShaderMaterial;
  private beadMat: THREE.ShaderMaterial;
  private waterMat: THREE.ShaderMaterial;
  private water: THREE.Mesh;
  private cloud: THREE.Mesh;
  private drops: THREE.InstancedMesh;
  private puffs: THREE.InstancedMesh;
  private streaks: THREE.InstancedMesh;
  private beadsTop: THREE.InstancedMesh;
  private beadsRoot: THREE.InstancedMesh;
  private ground: THREE.Mesh | null = null;
  private props: THREE.Mesh | null = null;
  private snow: THREE.Mesh | null = null;
  private snowAng: Float32Array | null = null;
  private snowQ: Float32Array | null = null;
  private snowShown = -1;
  private layout: Layout | null = null;
  private dropSlots = slots(MAX_PARTICLES.precip);
  private puffSlots = slots(MAX_PARTICLES.et);
  private streakSlots = slots(MAX_PARTICLES.runoff);
  private beadTopSlots = slots(MAX_BEADS.soil_top);
  private beadRootSlots = slots(MAX_BEADS.root_zone);
  private runMode: "radial" | "lanes" | "paths" | "none" = "radial";
  private variant: OrbVariant;
  private hexRig: HexRig | null = null;
  private hexBoard: HexBoard | null = null;
  private decoClouds: { mesh: THREE.Mesh; x: number; y: number; z: number; sp: number; ph: number }[] = [];

  private input: FrameInput | null = null;
  private theme: ThemeInput | null = null;
  private cur = { precip: 0, et: 0, runoff: 0, soil_top: 0, root_zone: 0, swe: 0, tair: 0 };
  private wasActive = new Set<string>();
  private counts: Counts = { precip: -1, et: -1, runoff: -1 };
  private soilShown = true;

  private reduced: boolean;
  private time = 0;
  private last = 0;
  private raf = 0;
  private visible = true;
  private pageVisible = true;
  // camera orbit (same feel as the globe: drag with inertia, clamped elevation, wheel / pinch zoom)
  private view = { yaw: 0, elev: 11, zoom: 1 };
  private vtgt = { yaw: 0, elev: 11, zoom: 1 };
  private vvel = { yaw: 0, elev: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number } | null = null;
  private dragging = false;
  private lastMove = 0;
  private touched = false;
  private swayK = 1;
  private baseD = 5;
  private zoomMax = 3;
  private camTarget = new THREE.Vector3(0, -0.2, 0);
  private dpr = 1;
  private size = { w: 1, h: 1 };
  private io: IntersectionObserver | null = null;
  private onCounts?: (c: Counts) => void;
  private getAnchor: (n: AnchorName) => HTMLElement | null;
  private disposed = false;
  private onAnchors?: (a: OrbAnchors) => void;
  private lastAnchors: OrbAnchors | null = null;
  private anchorsAt = 0;
  private anchorTimer = 0;

  constructor(host: HTMLElement, opts: { reducedMotion: boolean; getAnchor: (n: AnchorName) => HTMLElement | null; onCounts?: (c: Counts) => void; onAnchors?: (a: OrbAnchors) => void; variant?: OrbVariant; compact?: boolean }) {
    this.variant = opts.variant ?? "glass";
    this.compact = !!opts.compact;
    this.countScale = this.compact ? COMPACT_COUNT_SCALE : 1;
    const hexMode = this.variant !== "glass", inBall = this.variant !== "hex-island";
    this.reduced = opts.reducedMotion;
    this.getAnchor = opts.getAnchor;
    this.onCounts = opts.onCounts;
    this.onAnchors = this.compact ? undefined : opts.onAnchors;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "absolute inset-0 h-full w-full touch-pan-y";
    this.canvas.setAttribute("aria-hidden", "true");
    // throws when WebGL is unavailable; the component catches it and keeps the legend
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    host.appendChild(this.canvas);
    this.renderer.setClearColor(0x000000, 0);
    this.dpr = Math.min(this.compact ? 1.5 : 2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.dpr);

    const grad = new Uint8Array([110, 190, 255]);
    this.toonGradient = new THREE.DataTexture(grad, 3, 1, THREE.RedFormat);
    this.toonGradient.minFilter = this.toonGradient.magFilter = THREE.NearestFilter;
    this.toonGradient.generateMipmaps = false;
    this.toonGradient.needsUpdate = true;

    // lights
    const lightDir = new THREE.Vector3(-1.1, 2.0, 1.5).normalize();
    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x9a8466, 1.55));
    const sun = new THREE.DirectionalLight(0xfffaf0, 1.9);
    sun.position.copy(lightDir).multiplyScalar(5);
    this.scene.add(sun);

    this.propMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.toonGradient });
    this.groundMat = this.propMat.clone();
    this.leafMat = makeLeafMaterial(this.toonGradient);
    this.cloudMat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: this.toonGradient, emissive: 0x6a7480 });
    this.snowMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: this.toonGradient, emissive: 0x7d8a99 });

    // inner sky
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide,
      uniforms: { uHorizon: { value: new THREE.Vector3() }, uZenith: { value: new THREE.Vector3() }, uGround: { value: hexMode ? -0.97 : GROUND_Y } },
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(R_IN * 0.999, 48, 24), this.skyMat);
    sky.renderOrder = -1;
    if (inBall) this.scene.add(sky);

    // soil cut-away
    this.soilMat = new THREE.ShaderMaterial({
      vertexShader: SOIL_VS, fragmentShader: SOIL_FS,
      uniforms: {
        uTop: { value: vec3(SOIL_NEUTRAL.top) }, uRoot: { value: vec3(SOIL_NEUTRAL.root) }, uDeep: { value: vec3(SOIL_NEUTRAL.deep) },
        uTopHatch: { value: 0 }, uRootHatch: { value: 0 }, uTopData: { value: 0 }, uRootData: { value: 0 },
        uHatchA: { value: new THREE.Vector3(0.8, 0.8, 0.8) }, uHatchB: { value: new THREE.Vector3(0.6, 0.6, 0.6) },
        uTopY: { value: SOIL.topY }, uRootY: { value: SOIL.rootY }, uDpr: { value: this.dpr },
        uLightW: { value: lightDir.clone() },
        uSeaMode: { value: 0 }, uCoast: { value: new THREE.Vector3() }, uIceCap: { value: 0 },
        uIsle: { value: new THREE.Vector3() }, uIsleIrr: { value: new THREE.Vector2() }, uHasIsle: { value: 0 },
        uGroundY: { value: GROUND_Y }, uSeabed: { value: SEABED_DEPTH }, uRim: { value: RIM },
        uWaterTop: { value: new THREE.Vector3(...WATER_SHALLOW) }, uWaterDeep: { value: new THREE.Vector3(...WATER_DEEP) },
      },
    });
    if (!hexMode) this.diorama.add(new THREE.Mesh(buildSoilCap(), this.soilMat));

    this.cloud = new THREE.Mesh(buildCloud(), this.cloudMat);
    this.diorama.add(this.cloud);

    // water surface for sea and coast scenes: gentle faceted waves, drawn after the opaque scenery
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uShallow: { value: new THREE.Vector3(...WATER_SHALLOW) }, uDeepW: { value: new THREE.Vector3(...WATER_DEEP) },
        uFoam: { value: new THREE.Vector3(0.95, 1, 1) }, uLightW: { value: lightDir.clone() },
        uSeaMode: { value: 0 }, uCoast: { value: new THREE.Vector3() }, uIsle: { value: new THREE.Vector3() }, uIsleIrr: { value: new THREE.Vector2() }, uHasIsle: { value: 0 }, uRim: { value: RIM },
      },
    });
    const wg = new THREE.PlaneGeometry(RIM * 2.04, RIM * 2.04, 36, 36);
    wg.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(wg, this.waterMat);
    this.water.position.y = GROUND_Y;
    this.water.renderOrder = 5;
    this.water.visible = false;
    this.diorama.add(this.water);

    // particles
    const mkParticleMat = (shade: number, side: THREE.Side = THREE.FrontSide, opacity = 1) => new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, side, transparent: opacity < 1, depthWrite: opacity >= 1,
      uniforms: { uColor: { value: new THREE.Vector3(1, 1, 1) }, uLight: { value: new THREE.Vector3(-0.4, 0.8, 0.5) }, uShade: { value: shade }, uOpacity: { value: opacity } },
    });
    this.dropMat = mkParticleMat(0.6);
    this.puffMat = mkParticleMat(1);
    this.streakMat = mkParticleMat(0, THREE.DoubleSide, 0.8);
    // small teardrops: classic falling-drop silhouette, pointed tip UP and round belly below (about 0.032 tall)
    const dropGeo = (() => {
      const H = 0.032, r = 0.0074, c = H - r;
      const beta = Math.asin(r / c); // tangent from the tip to the belly
      const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
      const steps = 8;
      for (let k = 0; k <= steps; k++) {
        const a = -beta + ((Math.PI / 2 + beta) * k) / steps; // from the tangent point round the top of the belly
        pts.push(new THREE.Vector2(k === steps ? 0 : r * Math.cos(a), c + r * Math.sin(a)));
      }
      // the lathe is built tip-down; flip it so the tip trails upward like a real falling drop
      return new THREE.LatheGeometry(pts, 8).rotateX(Math.PI);
    })();
    this.beadMat = mkParticleMat(0.9);
    this.drops = new THREE.InstancedMesh(dropGeo, this.dropMat, MAX_PARTICLES.precip);
    // small soft wisps: a low-poly ellipsoid, stretched along its rise
    const puffGeo = new THREE.IcosahedronGeometry(0.0105, 1);
    puffGeo.scale(0.85, 1.6, 0.85);
    this.puffs = new THREE.InstancedMesh(puffGeo, this.puffMat, MAX_PARTICLES.et);
    // runoff arrow: a slim stem and a small head, lying nearly flat and pointing +z (about 0.04 long)
    const arrow = new THREE.Shape();
    arrow.moveTo(0, 0.058); arrow.lineTo(0.027, 0.012); arrow.lineTo(0.008, 0.012); arrow.lineTo(0.008, -0.068);
    arrow.lineTo(-0.008, -0.068); arrow.lineTo(-0.008, 0.012); arrow.lineTo(-0.027, 0.012); arrow.closePath();
    const arrowGeo = new THREE.ShapeGeometry(arrow);
    arrowGeo.rotateX(-Math.PI / 2);
    arrowGeo.rotateY(Math.PI); // tip toward +z
    this.streaks = new THREE.InstancedMesh(arrowGeo, this.streakMat, MAX_PARTICLES.runoff);
    this.beadsTop = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.beadMat, MAX_BEADS.soil_top);
    this.beadsRoot = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.beadMat, MAX_BEADS.root_zone);
    for (const m of [this.drops, this.puffs, this.streaks, this.beadsTop, this.beadsRoot]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.diorama.add(m);
    }
    this.scene.add(this.diorama);
    if (hexMode) {
      this.hexRig = new HexRig(this.diorama, this.soilMat.uniforms, this.propMat, this.snowMat, this.leafMat.material);
      if (!inBall) {
        // a few small clouds drift around the sky island (decoration: their size is never data-driven)
        const decoMat = this.cloudMat.clone();
        const spots: [number, number, number, number][] = [[-0.98, 0.3, -0.15, 0.5], [1.02, 0.0, 0.1, 0.42], [-0.72, -0.7, 0.45, 0.36], [0.8, 0.62, -0.4, 0.4]];
        spots.forEach(([x, y, z, k], i) => {
          const mesh = new THREE.Mesh(buildCloud(), decoMat);
          mesh.scale.setScalar(k);
          mesh.position.set(x, y, z);
          this.diorama.add(mesh);
          this.decoClouds.push({ mesh, x, y, z, sp: 0.05 + 0.02 * i, ph: i * 1.7 });
        });
      }
    }

    // pedestal + glass (not rotating)
    if (inBall) this.scene.add(new THREE.Mesh(buildPedestal(), this.propMat));
    this.glassMat = new THREE.ShaderMaterial({
      vertexShader: GLASS_VS, fragmentShader: GLASS_FS, transparent: true, depthWrite: false,
      uniforms: { uRim: { value: new THREE.Vector3(1, 1, 1) }, uRimStrength: { value: 0.55 } },
    });
    const glass = new THREE.Mesh(new THREE.SphereGeometry(R_GLASS, 64, 48), this.glassMat);
    glass.renderOrder = 10;
    if (inBall) this.scene.add(glass);

    // interaction + visibility
    this.view.elev = this.vtgt.elev = this.defaultElev();
    if (!this.compact) {
      this.canvas.addEventListener("pointerdown", this.onDown);
      this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
      window.addEventListener("pointermove", this.onMove);
      window.addEventListener("pointerup", this.onUp);
      window.addEventListener("pointercancel", this.onUp);
    }
    document.addEventListener("visibilitychange", this.onPage);
    this.io = new IntersectionObserver((e) => { this.visible = e.some((x) => x.isIntersecting); this.kick(); });
    this.io.observe(this.canvas);
    this.canvas.addEventListener("webglcontextlost", this.onLost);
  }

  /* ------------------------------------------------------------------------------------------- public API */
  setScenery(seed: string, plan: SceneryPlan) {
    if (this.hexRig) { this.setHexScenery(seed, plan); return; }
    const rnd = seeded(`${seed}|${plan.kind}|${plan.biome}|${plan.landSide}`);
    const L = makeLayout(plan, rnd);
    this.layout = L;
    for (const m of [this.ground, this.props, this.leaves, this.snow]) if (m) { this.diorama.remove(m); m.geometry.dispose(); }
    this.ground = new THREE.Mesh(buildGround(L, rnd), this.groundMat);
    const bp = buildProps(L, rnd);
    this.props = new THREE.Mesh(bp.props, this.propMat);
    this.leaves = bp.leaves ? new THREE.Mesh(bp.leaves, this.leafMat.material) : null;
    const snow = buildSnowPatch(rnd);
    this.snow = new THREE.Mesh(snow.geometry, this.snowMat);
    this.snow.visible = false;
    this.snowAng = snow.ang; this.snowQ = snow.q; this.snowShown = -1;
    this.diorama.add(this.ground, this.props, this.snow);
    if (this.leaves) this.diorama.add(this.leaves);
    this.cloud.position.set(L.cloud.x, L.cloud.y, L.cloud.z);
    // water + cut-away modes
    const U = this.soilMat.uniforms, W = this.waterMat.uniforms;
    this.water.visible = L.seaMode > 0;
    U.uSeaMode.value = W.uSeaMode.value = L.seaMode;
    U.uIceCap.value = L.iceCap ? 1 : 0;
    if (L.coast) { U.uCoast.value.set(L.coast.c0, L.coast.amp, L.coast.ph); W.uCoast.value.set(L.coast.c0, L.coast.amp, L.coast.ph); }
    W.uHasIsle.value = L.isle ? 1 : 0;
    if (L.isle) W.uIsle.value.set(L.isle.x, L.isle.z, L.isle.r);
    W.uIsleIrr.value.set(L.isleIrr ?? 0, L.isleIrr != null ? ISLE_IRR : 0);
    U.uHasIsle.value = W.uHasIsle.value; U.uIsle.value.copy(W.uIsle.value); U.uIsleIrr.value.copy(W.uIsleIrr.value);
    this.soilShown = L.soilCap;
    this.runMode = L.seaMode === 1 ? "lanes" : L.seaMode === 2 && !L.isle ? "none" : "radial";
    this.layoutSlots(seeded(`${seed}|slots`));
    this.kick();
  }

  private setHexScenery(seed: string, plan: SceneryPlan) {
    const b = this.hexRig!.set(plan, seed, this.variant as "hex-glass" | "hex-island");
    this.hexBoard = b;
    this.layout = b.layout;
    this.cloud.position.set(b.layout.cloud.x, b.layout.cloud.y, b.layout.cloud.z);
    this.water.visible = false;
    this.soilShown = b.hasStrata;
    this.runMode = b.landTiles.length ? "paths" : "none";
    this.layoutSlots(seeded(`${seed}|slots`));
    this.kick();
  }

  setFrame(input: FrameInput, immediate = false) {
    this.input = input;
    const ch: [keyof OrbScene["cur"], ChannelInput | null][] = [
      ["precip", input.precip], ["et", input.et], ["runoff", input.runoff], ["soil_top", input.soil_top],
      ["root_zone", input.root_zone], ["swe", input.swe], ["tair", input.tair],
    ];
    for (const [k, c] of ch) {
      const on = !!c && c.active && !c.missing;
      // a channel that just appeared (or came back from "no data") starts at its value: no fake ramp from zero
      if (on && (immediate || this.reduced || !this.wasActive.has(k))) this.cur[k] = c!.drawn;
      if (on) this.wasActive.add(k); else this.wasActive.delete(k);
    }
    this.kick();
  }

  /** illustrative seasonal leaf target (size and colour); eased in the render loop, snapped under reduced motion */
  setLeaves(s: LeafState) {
    this.leafTarget = s;
    if (!this.leafSet || this.reduced) { this.leafCur = s; this.leafMat.apply(s); this.leafSet = true; }
    this.kick();
  }

  setTheme(t: ThemeInput) {
    this.theme = t;
    this.glassMat.uniforms.uRim.value.copy(vec3(t.rim));
    this.glassMat.uniforms.uRimStrength.value = t.night ? 0.5 : 0.6;
    this.soilMat.uniforms.uHatchA.value.copy(vec3(t.hatchA));
    this.soilMat.uniforms.uHatchB.value.copy(vec3(t.hatchB));
    // natural daylight sky inside the glass; a little dimmer at night so the ball does not glare
    const horizon: RGB = t.night ? [0.78, 0.86, 0.9] : [0.9, 0.96, 0.97];
    const zenith: RGB = t.night ? [0.47, 0.66, 0.84] : [0.55, 0.78, 0.93];
    const tint = t.temperatureTint;
    const air = tint?.surface === "air" ? tint.color : null;
    this.skyMat.uniforms.uHorizon.value.copy(vec3(air ? mixRgb(horizon, air, 0.42) : horizon));
    this.skyMat.uniforms.uZenith.value.copy(vec3(air ?? zenith));
    const water = tint?.surface === "ocean" ? tint.color : null;
    this.waterMat.uniforms.uShallow.value.set(...(water ?? WATER_SHALLOW));
    this.waterMat.uniforms.uDeepW.value.set(...(water ? mixRgb(water, [0.05, 0.1, 0.21], 0.28) : WATER_DEEP));
    const ground = tint?.surface === "land" ? tint.color : null;
    if (this.groundMat.vertexColors !== !ground) {
      this.groundMat.vertexColors = !ground;
      this.groundMat.needsUpdate = true;
    }
    this.groundMat.color.copy(ground ? srgb(ground) : new THREE.Color(0xffffff));
    this.dropMat.uniforms.uColor.value.copy(vec3(t.precip));
    this.streakMat.uniforms.uColor.value.copy(vec3(t.runoff));
    this.beadMat.uniforms.uColor.value.copy(vec3(mixRgb(t.precip, [1, 1, 1], 0.3)));
    this.kick();
  }

  /** re-render once (e.g. after overlay labels mounted) */
  refresh() { this.kick(); }

  setReducedMotion(r: boolean) { this.reduced = r; if (r) this.time = 0; this.kick(); }

  setSize(w: number, h: number) {
    if (w < 2 || h < 2) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // whole ball plus pedestal (y from -1.2 to 1.0, base 0.84 wide, seen from 11 degrees above) with a small margin
    const island = this.variant === "hex-island";
    const halfV = island ? 1.08 : 1.3, halfH = island ? 1.1 : 1.04, margin = island ? 1.05 : 1.04;
    const d = Math.max((halfV * margin) / t, (halfH * margin) / (t * aspect));
    // the hex boards are looked at from higher up, so the tile tops read (the glass landscape is seen almost edge-on)
    this.camTarget.set(0, island ? -0.22 : -0.2, 0);
    this.baseD = d;
    // zoom in only as far as keeps the camera outside the glass (or at a sensible distance from the floating island)
    this.zoomMax = Math.max(1, Math.min(3.4, d / (island ? 1.5 : 2.0)));
    this.vtgt.zoom = Math.min(this.vtgt.zoom, this.zoomMax); this.view.zoom = Math.min(this.view.zoom, this.zoomMax);
    this.camera.updateProjectionMatrix();
    this.applyCamera();
    this.kick();
  }

  private defaultElev() { return this.variant === "glass" ? 11 : this.variant === "hex-island" ? 24 : 22; }

  private applyCamera() {
    const e = THREE.MathUtils.degToRad(this.view.elev), d = this.baseD / this.view.zoom, t = this.camTarget;
    this.camera.position.set(t.x, t.y + Math.sin(e) * d, t.z + Math.cos(e) * d);
    this.camera.lookAt(t);
    this.camera.updateMatrixWorld();
  }

  /** on-canvas zoom buttons */
  zoomBy(f: number) {
    this.vtgt.zoom = Math.min(this.zoomMax, Math.max(ZOOM_MIN, this.vtgt.zoom * f));
    this.touched = true;
    this.kick();
  }

  resetView() {
    this.vtgt = { yaw: 0, elev: this.defaultElev(), zoom: 1 };
    this.vvel = { yaw: 0, elev: 0 };
    this.touched = false;
    this.kick();
  }

  /** keyboard on the focused wrapper: arrows orbit, + / - zoom, 0 resets. Returns true when the key was used. */
  handleKey(e: KeyboardEvent): boolean {
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    const T = this.vtgt;
    switch (e.key) {
      case "ArrowLeft": T.yaw -= 0.25; break;
      case "ArrowRight": T.yaw += 0.25; break;
      case "ArrowUp": T.elev = Math.min(ELEV_MAX, T.elev + 5); break;
      case "ArrowDown": T.elev = Math.max(ELEV_MIN, T.elev - 5); break;
      case "+": case "=": this.zoomBy(1.35); return true;
      case "-": case "_": this.zoomBy(1 / 1.35); return true;
      case "0": this.resetView(); return true;
      default: return false;
    }
    this.touched = true;
    this.kick();
    return true;
  }

  /** one step of the camera easing / inertia; true while it is still moving */
  private stepView(dt: number): boolean {
    const v = this.view, t = this.vtgt, vel = this.vvel;
    let moving = false;
    if (!this.dragging && (vel.yaw || vel.elev)) {
      if (this.reduced) { vel.yaw = 0; vel.elev = 0; } else {
        t.yaw += vel.yaw * dt;
        t.elev = Math.min(ELEV_MAX, Math.max(ELEV_MIN, t.elev + vel.elev * dt));
        const decay = Math.exp(-dt * 4.5);
        vel.yaw *= decay; vel.elev *= decay;
        if (Math.abs(vel.yaw) < 0.01 && Math.abs(vel.elev) < 0.3) { vel.yaw = 0; vel.elev = 0; }
        moving = true;
      }
    }
    if (this.dragging) { v.yaw = t.yaw; v.elev = t.elev; } else {
      const k = this.reduced ? 1 : 1 - Math.exp(-dt * 6);
      const diff = Math.abs(t.yaw - v.yaw) + Math.abs(t.elev - v.elev) + Math.abs(t.zoom - v.zoom);
      if (diff > 1e-4) {
        v.yaw += (t.yaw - v.yaw) * k; v.elev += (t.elev - v.elev) * k; v.zoom += (t.zoom - v.zoom) * k;
        moving = true;
      } else { v.yaw = t.yaw; v.elev = t.elev; v.zoom = t.zoom; }
    }
    const sk = this.touched ? 0 : 1;
    if (Math.abs(sk - this.swayK) > 1e-3) { this.swayK += (sk - this.swayK) * (this.reduced ? 1 : 1 - Math.exp(-dt * 2)); moving = !this.reduced || moving; } else this.swayK = sk;
    this.applyCamera();
    return moving;
  }

  /** pixel radius of the glass on screen (for deciding whether in-ball labels fit) */
  ballRadiusPx(): number {
    const d = this.camera.position.length();
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return (R_GLASS / (d * t)) * (this.size.h / 2);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.anchorTimer);
    this.leafMat.material.dispose();
    this.groundMat.dispose();
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    document.removeEventListener("visibilitychange", this.onPage);
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.io?.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
    this.toonGradient.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  onContextLost?: () => void;

  /* ------------------------------------------------------------------------------------------- internals */
  private onLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(this.raf); this.raf = 0; if (!this.disposed) this.onContextLost?.(); };
  private onPage = () => { this.pageVisible = document.visibilityState !== "hidden"; this.kick(); };
  private onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragging = true; this.vvel = { yaw: 0, elev: 0 }; this.vtgt = { ...this.view }; this.lastMove = performance.now();
      this.canvas.style.cursor = "grabbing";
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.vtgt.zoom };
    }
  };
  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const z = Math.min(this.zoomMax, Math.max(ZOOM_MIN, this.pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, this.pinch.dist))));
      this.vtgt.zoom = this.view.zoom = z; this.touched = true;
      this.kick();
      return;
    }
    if (!this.dragging) return;
    const dYaw = dx * 0.008, dElev = dy * 0.3; // dragging down looks from higher up, like the globe
    this.vtgt.yaw += dYaw;
    this.vtgt.elev = Math.min(ELEV_MAX, Math.max(ELEV_MIN, this.vtgt.elev + dElev));
    this.view.yaw = this.vtgt.yaw; this.view.elev = this.vtgt.elev;
    const now = performance.now(), dt = Math.max(1, now - this.lastMove) / 1000;
    this.lastMove = now;
    this.vvel = { yaw: 0.6 * this.vvel.yaw + 0.4 * (dYaw / dt), elev: 0.6 * this.vvel.elev + 0.4 * (dElev / dt) };
    this.touched = true;
    this.kick();
  };
  private onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.canvas.releasePointerCapture?.(e.pointerId);
    if (this.pointers.size >= 1) return;
    this.dragging = false; this.pinch = null;
    this.canvas.style.cursor = "";
    if (this.reduced || performance.now() - this.lastMove > 120) this.vvel = { yaw: 0, elev: 0 };
    this.kick();
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault(); // wheel zooms only while the pointer is over the canvas
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.vtgt.zoom = Math.min(this.zoomMax, Math.max(ZOOM_MIN, this.vtgt.zoom * Math.exp(-dy * 0.0016)));
    this.touched = true;
    this.kick();
  };

  private kick() {
    if (this.disposed || this.raf || !this.visible || !this.pageVisible) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private layoutSlots(rnd: () => number) {
    const L = this.layout!;
    const h = (x: number, z: number) => Math.max(0, L.height(x, z));
    // drops: an ellipse under the cloud, falling to the ground (or the water) under each drop
    const D = this.dropSlots;
    for (let i = 0; i < D.a.length; i++) {
      let x = 0, z = 0;
      do { x = (rnd() * 2 - 1); z = (rnd() * 2 - 1); } while (x * x + z * z > 1);
      x = L.cloud.x + x * 0.22; z = L.cloud.z + z * 0.16;
      const top = L.cloud.y - 0.07, bottom = GROUND_Y + h(x, z) + 0.01;
      D.a[i] = x; D.b[i] = z; D.c[i] = top; D.d[i] = top - bottom; D.e[i] = (i * GOLDEN) % 1;
    }
    if (this.hexBoard) { this.layoutHexSlots(rnd); return; }
    // puffs: rise from anywhere on the disc except the rain column and the hilltop
    const P = this.puffSlots;
    for (let i = 0; i < P.a.length; i++) {
      let x = 0, z = 0;
      do { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.8; x = Math.sin(a) * r; z = Math.cos(a) * r; }
      while (Math.hypot(x - L.hill.x, z - L.hill.z) < 0.14 || Math.hypot(x - L.cloud.x, z - L.cloud.z) < 0.12);
      const y0 = GROUND_Y + h(x, z) + 0.03;
      const ceiling = Math.sqrt(Math.max(0, R_IN * R_IN - x * x - z * z)) - 0.1;
      const top = Math.min(ceiling, 0.5 + rnd() * 0.2);
      P.a[i] = x; P.b[i] = z; P.c[i] = y0; P.d[i] = Math.max(0.15, top - y0); P.e[i] = (i * GOLDEN) % 1;
    }
    // runoff arrows. radial: a = heading (from +z), b = start radius, c = length, d = unused. lanes (coast): a = z lane.
    const S = this.streakSlots;
    const Rm = RIM - 0.045;
    const cx = L.isle ? L.isle.x : 0, cz = L.isle ? L.isle.z : 0;
    for (let i = 0; i < S.a.length; i++) {
      if (this.runMode === "lanes") {
        const z = -0.12 + ((i * 0.7548776662) % 1) * 0.76;
        S.a[i] = z; S.b[i] = 0; S.c[i] = 1; S.d[i] = 0;
      } else {
        const ang = L.isle ? (rnd() * 2 - 1) * 1.45 : (rnd() * 2 - 1) * (FRONT_SECTOR - 0.1);
        const r0 = L.isle ? L.isle.r * 0.75 : 0.5 + rnd() * 0.12;
        const dx = Math.sin(ang), dz = Math.cos(ang), px = cx + dx * r0, pz = cz + dz * r0;
        const bq = px * dx + pz * dz, cc = px * px + pz * pz - Rm * Rm;
        const tMax = -bq + Math.sqrt(Math.max(0, bq * bq - cc));
        S.a[i] = ang; S.b[i] = r0; S.c[i] = Math.max(0.12, L.isle ? Math.min(0.5, tMax) : tMax);
      }
      S.e[i] = (i * GOLDEN) % 1;
    }
    // soil beads on the land part of the cut-away: low-discrepancy angles and depths, so any prefix is evenly spread
    const landAng = (a: number, margin: number) => {
      if (!L.coast) return true;
      const x = Math.cos(a) * RIM, z = Math.sin(a) * RIM;
      return x < coastX(L.coast, z) - margin;
    };
    const fill = (B: Slots, yHi: number, yLo: number, margin: number) => {
      let k = 0;
      for (let i = 0; i < B.a.length; i++) {
        let a = 0;
        do { a = (((k++ * GOLDEN) % 1) + rnd() * 0.02) * Math.PI * 2; } while (!landAng(a, margin) && k < 20000);
        B.a[i] = a;
        B.b[i] = yHi + (yLo - yHi) * ((i * 0.7548776662 + 0.12) % 1);
        B.c[i] = 0.75 + rnd() * 0.5;
      }
    };
    fill(this.beadTopSlots, GROUND_Y - 0.018, SOIL.topY + 0.016, 0.16); // topsoil is full thickness from 0.14 inland
    fill(this.beadRootSlots, SOIL.topY - 0.022, SOIL.rootY + 0.03, 0.38); // the root zone reaches full depth 0.35 inland
  }

  /** vapour, runoff paths and soil beads on the hex board (the rain drops are laid out by layoutSlots) */
  private layoutHexSlots(rnd: () => number) {
    const b = this.hexBoard!, L = this.layout!;
    const slotsOut = hexSlots(b, L.cloud, this.streakSlots.a.length, this.puffSlots.a.length, Math.max(this.beadTopSlots.a.length, this.beadRootSlots.a.length), rnd);
    const P = this.puffSlots, inBall = this.variant === "hex-glass";
    slotsOut.puffs.forEach((q, i) => {
      const ceiling = inBall ? Math.sqrt(Math.max(0, R_IN * R_IN - q.x * q.x - q.z * q.z)) - 0.1 : 0.7;
      const y0 = q.y + 0.03, top = Math.min(ceiling, 0.5 + rnd() * 0.2);
      P.a[i] = q.x; P.b[i] = q.z; P.c[i] = y0; P.d[i] = Math.max(0.15, top - y0); P.e[i] = (i * GOLDEN) % 1;
    });
    const S = this.streakSlots;
    slotsOut.runoff.forEach((q, i) => { S.a[i] = q.x; S.b[i] = q.z; S.c[i] = q.dx; S.d[i] = q.dz; S.e[i] = (i * GOLDEN) % 1; });
    const fill = (B: Slots, yHi: number, yLo: number) => {
      for (let i = 0; i < B.a.length; i++) {
        const q = slotsOut.beads[i];
        if (!q) { B.c[i] = 0; continue; }
        B.a[i] = q.edge; B.d[i] = q.f;
        B.b[i] = yHi + (yLo - yHi) * ((i * 0.7548776662 + 0.12) % 1);
        B.c[i] = 0.75 + rnd() * 0.5;
      }
    };
    fill(this.beadTopSlots, GROUND_Y - 0.004, HEX_SOIL.topY + 0.016);
    fill(this.beadRootSlots, HEX_SOIL.topY - 0.022, HEX_SOIL.rootY + 0.03);
  }

  private loop = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    if (this.compact && now - this.lastRender < 30) { if (this.visible && this.pageVisible) this.raf = requestAnimationFrame(this.loop); return; } // ~30 fps cap
    this.lastRender = now;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.reduced) this.time += dt;
    const e1 = this.ease(dt), e2 = this.easeLeaves(dt);
    const easing = e1 || e2;
    const orbiting = this.stepView(dt);
    this.update();
    this.renderer.render(this.scene, this.camera);
    this.placeAnchors();
    if (this.onAnchors) this.emitAnchors();
    const animate = !this.reduced || easing || orbiting;
    if (animate && this.visible && this.pageVisible) this.raf = requestAnimationFrame(this.loop);
  };

  private ease(dt: number): boolean {
    const inp = this.input;
    if (!inp) return false;
    const k = this.reduced ? 1 : 1 - Math.exp(-dt / EASE_TAU);
    let moving = false;
    const go = (key: keyof OrbScene["cur"], c: ChannelInput | null) => {
      if (!c || !c.active || c.missing) return;
      const d = c.drawn - this.cur[key];
      if (Math.abs(d) < 1e-4) { this.cur[key] = c.drawn; return; }
      this.cur[key] += d * k;
      moving = true;
    };
    go("precip", inp.precip); go("et", inp.et); go("runoff", inp.runoff); go("soil_top", inp.soil_top);
    go("root_zone", inp.root_zone); go("swe", inp.swe); go("tair", inp.tair);
    return moving;
  }

  private easeLeaves(dt: number): boolean {
    let moving = false;
    // leaves: ~0.4 s to settle on the new season
    const lt = this.leafTarget, lc = this.leafCur;
    const dl = Math.abs(lt.size - lc.size) + Math.abs(lt.amt - lc.amt) + Math.abs(lt.dark - lc.dark) + Math.abs(lt.snow - lc.snow)
      + Math.abs(lt.tint[0] - lc.tint[0]) + Math.abs(lt.tint[1] - lc.tint[1]) + Math.abs(lt.tint[2] - lc.tint[2]);
    if (dl > 1e-3) {
      this.leafCur = this.reduced ? lt : lerpLeaf(lc, lt, 1 - Math.exp(-dt / 0.13));
      this.leafMat.apply(this.leafCur);
      moving = true;
    } else if (dl > 0) { this.leafCur = lt; this.leafMat.apply(lt); }
    return moving;
  }

  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private n = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private s = new THREE.Vector3();
  private e = new THREE.Euler();
  private hd = new THREE.Vector3();
  private nrm = new THREE.Vector3();
  private tip = new THREE.Vector3();
  private side = new THREE.Vector3();

  private update() {
    const inp = this.input, th = this.theme, L = this.layout;
    const t = this.time;
    this.diorama.rotation.y = this.view.yaw + (this.reduced ? 0 : 0.26 * this.swayK * Math.sin(t * 0.21));
    this.waterMat.uniforms.uTime.value = t;
    if (this.hexRig) {
      this.hexRig.setTime(t);
      this.diorama.position.y = this.variant === "hex-island" && !this.reduced ? 0.016 * Math.sin(t * 0.8) : 0;
      for (const c of this.decoClouds) { c.mesh.position.set(c.x + 0.07 * Math.sin(t * c.sp * 3 + c.ph), c.y + 0.015 * Math.sin(t * 0.5 + c.ph), c.z); }
    }
    if (!inp || !th || !L) {
      this.drops.count = this.puffs.count = this.streaks.count = this.beadsTop.count = this.beadsRoot.count = 0;
      return;
    }
    const n = (c: ChannelInput, v: number, id: "precip" | "et" | "runoff") =>
      (c.active && !c.missing ? Math.min(MAX_PARTICLES[id], Math.max(0, Math.round((v / PARTICLE_RATE[id]) * this.countScale))) : 0);
    const nd = n(inp.precip, this.cur.precip, "precip");
    const np = n(inp.et, this.cur.et, "et");
    const ns = this.runMode === "none" ? 0 : n(inp.runoff, this.cur.runoff, "runoff");

    // drops: constant fall speed, appear under the cloud, shrink into the ground
    const D = this.dropSlots;
    for (let i = 0; i < nd; i++) {
      const u = (D.e[i] + (t * FALL_SPEED) / D.d[i]) % 1;
      const y = D.c[i] - u * D.d[i];
      const sc = Math.min(1, u / 0.06, (1 - u) / 0.05);
      this.v.set(D.a[i], y, D.b[i]);
      this.s.setScalar(Math.max(0.001, sc));
      this.m4.compose(this.v, this.q.identity(), this.s);
      this.drops.setMatrixAt(i, this.m4);
    }
    this.drops.count = nd;
    this.drops.instanceMatrix.needsUpdate = true;

    // puffs: rise at constant speed, swell, then fade out by shrinking
    const P = this.puffSlots;
    for (let i = 0; i < np; i++) {
      const u = (P.e[i] + (t * RISE_SPEED) / P.d[i]) % 1;
      const y = P.c[i] + u * P.d[i];
      const wob = 0.018 * Math.sin(t * 1.3 + i * 2.1) * u;
      const sc = (0.6 + 0.8 * u) * Math.min(1, u / 0.08, (1 - u) / 0.14);
      this.v.set(P.a[i] + wob, y, P.b[i] + wob * 0.5);
      this.s.setScalar(Math.max(0.001, sc));
      this.e.set(0, i * 1.3, 0);
      this.m4.compose(this.v, this.q.setFromEuler(this.e), this.s);
      this.puffs.setMatrixAt(i, this.m4);
    }
    this.puffs.count = np;
    this.puffs.instanceMatrix.needsUpdate = true;
    let puff: RGB = [0.93, 0.95, 0.99];
    if (inp.tair && inp.tair.active) {
      puff = inp.tair.missing ? th.hatchB : tairColor((this.cur.tair - VARIABLES.tair.domain[0]) / (VARIABLES.tair.domain[1] - VARIABLES.tair.domain[0]), th.cool, th.mid, th.warm);
    }
    this.puffMat.uniforms.uColor.value.set(puff[0], puff[1], puff[2]);

    // runoff arrows: slide toward the rim, or on a coast from the land into the sea
    const S = this.streakSlots;
    for (let i = 0; i < ns; i++) {
      let x: number, z: number, yaw: number, sc: number;
      if (this.runMode === "paths") {
        // hex board: from a land tile toward the sea (or the board edge), straight across the tiles
        const len = Math.hypot(S.c[i], S.d[i]);
        const u = (S.e[i] + (t * SLIDE_SPEED) / len) % 1;
        x = S.a[i] + S.c[i] * u; z = S.b[i] + S.d[i] * u; yaw = Math.atan2(S.c[i], S.d[i]);
        sc = Math.min(1, u / 0.1, (1 - u) / 0.08);
      } else if (this.runMode === "lanes" && L.coast) {
        z = S.a[i];
        const half = Math.sqrt(Math.max(0.01, RIM * RIM - z * z));
        const cx = coastX(L.coast, z);
        const x0 = Math.max(-half + 0.1, cx - 0.72), x1 = Math.min(half - 0.07, cx + 0.2), len = x1 - x0;
        const u = (S.e[i] + (t * SLIDE_SPEED) / len) % 1;
        x = x0 + u * len; yaw = Math.PI / 2;
        sc = Math.min(1, u / 0.1, (1 - u) / 0.1);
      } else {
        const u = (S.e[i] + (t * SLIDE_SPEED) / S.c[i]) % 1;
        const r = S.b[i] + u * S.c[i];
        const cx = L.isle ? L.isle.x : 0, cz = L.isle ? L.isle.z : 0;
        x = cx + Math.sin(S.a[i]) * r; z = cz + Math.cos(S.a[i]) * r; yaw = S.a[i];
        sc = Math.min(1, u / 0.1, (1 - u) / 0.08);
      }
      const onLand = L.height(x, z) > 0.004;
      const y = (onLand ? GROUND_Y + L.height(x, z) : GROUND_Y) + 0.02;
      // arrows lean back toward the camera (the view is nearly horizontal, a flat arrow would be a line)
      this.hd.set(Math.sin(yaw), 0, Math.cos(yaw));
      this.nrm.set(0, Math.cos(ARROW_TILT), Math.sin(ARROW_TILT));
      this.tip.copy(this.hd).addScaledVector(this.nrm, -this.hd.dot(this.nrm)).normalize();
      this.side.crossVectors(this.nrm, this.tip);
      this.m4.makeBasis(this.side, this.nrm, this.tip);
      this.q.setFromRotationMatrix(this.m4);
      this.v.set(x, y, z);
      this.s.setScalar(Math.max(0.001, sc * ARROW_SCALE));
      this.m4.compose(this.v, this.q, this.s);
      this.streaks.setMatrixAt(i, this.m4);
    }
    this.streaks.count = ns;
    this.streaks.instanceMatrix.needsUpdate = true;

    // cloud: illustrative, but greyed when the precipitation channel has no data
    this.cloudMat.color.copy(inp.precip.active && inp.precip.missing ? srgb(th.hatchB) : new THREE.Color(0xffffff));

    // soil bands: dry tan mixed toward water blue by the value, plus a count of water beads inside the band
    const U = this.soilMat.uniforms;
    const band = (c: ChannelInput, v: number, dom: [number, number], neutral: RGB) => {
      if (!c.active || !this.soilShown) return { col: neutral, hatch: 0, data: 0 };
      if (c.missing) return { col: neutral, hatch: 1, data: 1 };
      return { col: soilColor(th.precip, (v - dom[0]) / (dom[1] - dom[0])), hatch: 0, data: 1 };
    };
    const top = band(inp.soil_top, this.cur.soil_top, VARIABLES.soil_top.domain, SOIL_NEUTRAL.top);
    const root = band(inp.root_zone, this.cur.root_zone, VARIABLES.root_zone.domain, SOIL_NEUTRAL.root);
    U.uTop.value.set(...top.col); U.uTopHatch.value = top.hatch; U.uTopData.value = top.data;
    U.uRoot.value.set(...root.col); U.uRootHatch.value = root.hatch; U.uRootData.value = root.data;
    U.uDpr.value = this.dpr;
    const beads = (mesh: THREE.InstancedMesh, B: Slots, c: ChannelInput, v: number, step: number, size: number, max: number) => {
      const k = this.soilShown && c.active && !c.missing ? Math.min(max, Math.max(0, Math.round(v / step))) : 0;
      for (let i = 0; i < k; i++) {
        const y = B.b[i], r = Math.sqrt(Math.max(0, R_IN * R_IN - y * y)) + size * 0.25;
        if (this.hexBoard) { const [wx, wz, nx, nz] = this.hexBoard.wallPoint(B.a[i], B.d[i], y); this.v.set(wx + nx * size * 0.3, y, wz + nz * size * 0.3); }
        else this.v.set(Math.cos(B.a[i]) * r, y, Math.sin(B.a[i]) * r);
        this.s.setScalar(size * B.c[i] * 0.85 + size * 0.15);
        this.m4.compose(this.v, this.q.identity(), this.s);
        mesh.setMatrixAt(i, this.m4);
      }
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      return k;
    };
    beads(this.beadsTop, this.beadTopSlots, inp.soil_top, this.cur.soil_top, BEAD_STEP.soil_top, 0.012, MAX_BEADS.soil_top);
    beads(this.beadsRoot, this.beadRootSlots, inp.root_zone, this.cur.root_zone, BEAD_STEP.root_zone, 0.017, MAX_BEADS.root_zone);

    if (this.hexRig) {
      const on = inp.swe.active && !inp.swe.missing && this.cur.swe > 0.05;
      this.hexRig.setSnow(on ? snowSize(this.cur.swe) : null);
    }
    // snow cap: footprint and height both follow SWE (square-root size scale), placed on the main hill
    if (this.snow && this.snowAng && this.snowQ) {
      const on = inp.swe.active && !inp.swe.missing && this.cur.swe > 0.05 && snowCapAllowed(L.plan, !!L.isle);
      this.snow.visible = on;
      const f = on ? snowSize(this.cur.swe) : 0;
      if (on && Math.abs(f - this.snowShown) > 2e-3) {
        const p = this.snow.geometry.getAttribute("position") as THREE.BufferAttribute;
        const R = L.snow.rMax * (0.2 + 0.8 * f), H = L.snow.hMax * f;
        for (let i = 0; i < this.snowQ.length; i++) {
          const q = this.snowQ[i], a = this.snowAng[i];
          const x = L.hill.x + Math.sin(a) * q * R, z = L.hill.z + Math.cos(a) * q * R;
          const prof = Math.pow(Math.max(0, 1 - q * q), 0.7);
          p.setXYZ(i, x, GROUND_Y + Math.max(0.01, L.height(x, z)) + 0.006 + H * prof, z);
        }
        p.needsUpdate = true;
        this.snow.geometry.computeVertexNormals();
        this.snowShown = f;
      }
    }

    if (nd !== this.counts.precip || np !== this.counts.et || ns !== this.counts.runoff) {
      this.counts = { precip: nd, et: np, runoff: ns };
      this.canvas.dataset.drops = String(nd);
      this.canvas.dataset.puffs = String(np);
      this.canvas.dataset.streaks = String(ns);
      this.canvas.dataset.beadsTop = String(this.beadsTop.count);
      this.canvas.dataset.beadsRoot = String(this.beadsRoot.count);
      this.onCounts?.(this.counts);
    }
  }

  private placeHexAnchors(b: HexBoard, L: Layout) {
    const { w, h } = this.size;
    const peak = b.peaks[0] ?? { x: L.hill.x, y: GROUND_Y + Math.max(0.02, L.height(L.hill.x, L.hill.z)), z: L.hill.z, h: 0 };
    const pts: [AnchorName, number, number, number][] = [
      ["cloud", L.cloud.x, L.cloud.y - 0.2, L.cloud.z],
      ["puffs", b.anchors.puff[0], GROUND_Y + 0.3, b.anchors.puff[1]],
      ["runoff", b.anchors.run[0], GROUND_Y + 0.08, b.anchors.run[1]],
      ["peak", peak.x, peak.y + peak.h * 0.5 + 0.1, peak.z],
      ...(b.landEdges.length ? ([["soilTop", (GROUND_Y + 0.03 + HEX_SOIL.topY) / 2], ["rootZone", (HEX_SOIL.topY + HEX_SOIL.rootY) / 2], ["deep", (HEX_SOIL.rootY + b.y0) / 2]] as [AnchorName, number][]).map(([n, y]): [AnchorName, number, number, number] => {
        const [wx, wz] = b.wallPoint(b.labelEdge, 0.5, y);
        return [n, wx, y, wz];
      }) : []),
    ];
    for (const [name, x, y, z] of pts) {
      const el = this.getAnchor(name);
      if (!el) continue;
      this.v.set(x, y, z).applyMatrix4(this.diorama.matrixWorld).project(this.camera);
      el.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px)`;
      el.style.visibility = "visible";
    }
  }

  private placeAnchors() {
    const L = this.layout;
    if (!L) return;
    if (this.hexBoard) { this.placeHexAnchors(this.hexBoard, L); return; }
    const runAt: [number, number] = L.coast ? [L.coast.c0 - 0.12, 0.3] : L.isle ? [L.isle.x + 0.05, L.isle.z + 0.3] : [0, RIM * 0.8];
    const pts: [AnchorName, number, number, number][] = [
      ["cloud", L.cloud.x, L.cloud.y - 0.2, L.cloud.z],
      ["puffs", -0.4, 0.2, 0.15],
      ["runoff", runAt[0], GROUND_Y + 0.03, runAt[1]],
      ["peak", L.hill.x, GROUND_Y + Math.max(0.02, L.height(L.hill.x, L.hill.z)) + 0.1, L.hill.z],
    ];
    const soil: [AnchorName, number][] = [["soilTop", (GROUND_Y + SOIL.topY) / 2], ["rootZone", (SOIL.topY + SOIL.rootY) / 2], ["deep", -0.66]];
    const { w, h } = this.size;
    for (const [name, x, y, z] of pts) {
      const el = this.getAnchor(name);
      if (!el) continue;
      this.v.set(x, y, z).applyMatrix4(this.diorama.matrixWorld).project(this.camera);
      el.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px)`;
      el.style.visibility = "visible";
    }
    for (const [name, y] of soil) {
      const el = this.getAnchor(name);
      if (!el) continue;
      const r = Math.sqrt(Math.max(0, R_IN * R_IN - y * y));
      this.v.set(-r, y, 0).project(this.camera);
      el.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px)`;
      el.style.visibility = "visible";
    }
  }

  /** Representative on-screen point of each drawn channel (px in the host), emitted when something moved > 1 px, at most every ~100 ms. */
  private emitAnchors() {
    const L = this.layout, inp = this.input;
    if (!L || !inp || !this.onAnchors) return;
    const { w, h } = this.size;
    const hex = this.hexBoard;
    const out: OrbAnchors = {};
    const toPx = (v: THREE.Vector3) => ({ x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h });
    const put = (id: VarId, x: number, y: number, z: number, visible: boolean, local = false) => {
      this.v.set(x, y, z);
      if (!local) this.v.applyMatrix4(this.diorama.matrixWorld);
      this.v.project(this.camera);
      out[id] = { ...toPx(this.v), visible: visible && this.v.z < 1 };
    };
    /** point on a cut face / wall: visible only while the wall faces the camera */
    const wall = (id: VarId, x: number, y: number, z: number, nx: number, nz: number, present: boolean) => {
      this.v.set(x, y, z).applyMatrix4(this.diorama.matrixWorld);
      this.n.set(nx, 0, nz).transformDirection(this.diorama.matrixWorld);
      const facing = this.n.dot(this.v2.copy(this.camera.position).sub(this.v).normalize()) > 0.12;
      put(id, x, y, z, present && facing);
    };
    const swePresent = inp.swe.active && (inp.swe.missing || (hex ? this.cur.swe > 0.05 : !!this.snow?.visible));
    const cloud = L.cloud;
    if (inp.precip.active) put("precip", cloud.x, cloud.y - 0.4, cloud.z, true);
    if (inp.runoff.active) {
      if (hex) put("runoff", hex.anchors.run[0], GROUND_Y + 0.08, hex.anchors.run[1], this.runMode !== "none");
      else {
        const run: [number, number] = L.coast ? [L.coast.c0 - 0.12, 0.3] : L.isle ? [L.isle.x + 0.05, L.isle.z + 0.3] : [0, RIM * 0.8];
        put("runoff", run[0], GROUND_Y + 0.03, run[1], this.runMode !== "none");
      }
    }
    if (inp.et.active) {
      if (hex) put("et", hex.anchors.puff[0], GROUND_Y + 0.3, hex.anchors.puff[1], true);
      else put("et", -0.4, 0.2, 0.15, true);
    }
    if (inp.swe.active) {
      const peak = hex ? (hex.peaks[0] ?? { x: L.hill.x, y: GROUND_Y, z: L.hill.z, h: 0 }) : { x: L.hill.x, y: GROUND_Y + Math.max(0.02, L.height(L.hill.x, L.hill.z)), z: L.hill.z, h: 0 };
      put("swe", peak.x, peak.y + peak.h * 0.5 + 0.1, peak.z, swePresent);
    }
    const soilBands: [VarId, number, boolean][] = [
      ["soil_top", hex ? (GROUND_Y + 0.03 + HEX_SOIL.topY) / 2 : (GROUND_Y + SOIL.topY) / 2, inp.soil_top.active],
      ["root_zone", hex ? (HEX_SOIL.topY + HEX_SOIL.rootY) / 2 : (SOIL.topY + SOIL.rootY) / 2, inp.root_zone.active],
    ];
    for (const [id, y, active] of soilBands) {
      if (!active) continue;
      if (hex) {
        if (!this.soilShown || !hex.landEdges.length) { out[id] = { x: 0, y: 0, visible: false }; continue; }
        const [wx, wz, nx, nz] = hex.wallPoint(hex.labelEdge, 0.5, y);
        wall(id, wx, y, wz, nx, nz, true);
      } else if (!this.soilShown) out[id] = { x: 0, y: 0, visible: false };
      else put(id, -Math.sqrt(Math.max(0, R_IN * R_IN - y * y)), y, 0, true, true);
    }

    // emit only on a > 1 px move (or a visibility change), at most every 100 ms; a trailing timer flushes a throttled change
    const prev = this.lastAnchors;
    const ids = Object.keys(out) as VarId[];
    const moved = !prev || ids.length !== Object.keys(prev).length || ids.some((id) => {
      const a = out[id]!, b = prev[id];
      return !b || a.visible !== b.visible || (a.visible && Math.hypot(a.x - b.x, a.y - b.y) > 1);
    });
    if (!moved) return;
    const now = performance.now();
    if (now - this.anchorsAt < 100) {
      if (!this.anchorTimer) this.anchorTimer = window.setTimeout(() => { this.anchorTimer = 0; this.kick(); }, 100 - (now - this.anchorsAt) + 5);
      return;
    }
    this.anchorsAt = now;
    this.lastAnchors = out;
    this.onAnchors(out);
  }
}
