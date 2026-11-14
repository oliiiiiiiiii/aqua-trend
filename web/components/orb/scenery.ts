// Illustrative low-poly diorama inside the crystal ball. Nothing in this file is driven by data: the scenery plan is
// picked once from the region's surface shares and long-term means (encoding.chooseScenery) and the layout is seeded by
// the region id, so the scenery is stable while months play. Natural scenery colours are fixed constants on purpose (they are not UI colours).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SNOW_ISLET_MIN, type Biome, type RGB, type SceneryPlan } from "./encoding";

export const R_GLASS = 1;
export const R_IN = 0.965;
export const GROUND_Y = -0.12;
export const RIM = Math.sqrt(R_IN * R_IN - GROUND_Y * GROUND_Y);
export const RIM_SEGMENTS = 96;
export const HILL = { x: -0.3, z: -0.3 };
export const CLOUD = { x: 0.27, y: 0.5, z: 0.05 };
/** soil strata (object-space y of the lower boundary of each band) */
export const SOIL = { topY: GROUND_Y - 0.075, rootY: GROUND_Y - 0.36 };
/** front sector kept clear of props so runoff streaks stay readable (angle from +z, toward the camera) */
export const FRONT_SECTOR = 1.2;

/* ------------------------------------------------------------------------------------------------- random */
export function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------------------------------------- palettes */
export interface Palette { ground: string[]; high: string[]; canopy: string[]; trunk: string; rock: string[]; accent: string[]; highFrom: number }
export type Style = Biome | "ice";
export const PAL: Record<Style, Palette> = {
  lush: { ground: ["#3f9f3a", "#4cae3f", "#58b945", "#45a53c"], high: ["#3a9236", "#348a33"], canopy: ["#2e9e45", "#43b14d", "#5cc24a", "#2a8a3c", "#7ccf4a"], trunk: "#8a5a3b", rock: ["#8d8f8a", "#a3a49d"], accent: ["#f6c445", "#ef7f6a", "#ffffff"], highFrom: 0.16 },
  temperate: { ground: ["#8cc95a", "#99d063", "#80bf53", "#a3d76c"], high: ["#76b04d", "#6ca747"], canopy: ["#4fa843", "#62b84a", "#78c255", "#3f9a3f"], trunk: "#8a5a3b", rock: ["#9aa0a3", "#b3b7b6"], accent: ["#ffffff", "#f6c445", "#f08fa0"], highFrom: 0.18 },
  savanna: { ground: ["#d3bd66", "#c8b35c", "#dcc878", "#c1af59"], high: ["#bba15a", "#c6a862"], canopy: ["#7f9c3c", "#8fac45", "#6f8f36"], trunk: "#7a5232", rock: ["#b88a5a", "#a57a4f"], accent: ["#a9a24a", "#c2b252"], highFrom: 0.1 },
  desert: { ground: ["#f1d58e", "#ecc97b", "#f5dea2", "#e7c275"], high: ["#e3b86c", "#dbab62"], canopy: ["#5fa858", "#6cb563"], trunk: "#7a5232", rock: ["#c98f5a", "#b8794a", "#d39c66"], accent: ["#f08fa0", "#f6c445"], highFrom: 0.1 },
  taiga: { ground: ["#86a56d", "#93b078", "#7c9b63", "#9cb782"], high: ["#8f9c86", "#a3ab98"], canopy: ["#2e6b4f", "#3a7a58", "#2a5f47", "#41835f"], trunk: "#6b4a32", rock: ["#9aa3ab", "#848d96"], accent: ["#c4b06a"], highFrom: 0.2 },
  alpine: { ground: ["#8fb26a", "#9dbd75", "#84a862", "#a6c27d"], high: ["#9ea4a8", "#b4b8ba", "#8b9196"], canopy: ["#2e6b4f", "#3a7a58", "#41835f"], trunk: "#6b4a32", rock: ["#9aa3ab", "#848d96", "#b0b5b8"], accent: [], highFrom: 0.17 },
  ice: { ground: ["#b7dcf2", "#c6e4f6", "#aad4ed", "#cfe8f7"], high: ["#dff0fa", "#e9f5fc"], canopy: ["#cfe8f7"], trunk: "#6b4a32", rock: ["#7d8a98", "#6b7785"], accent: [], highFrom: 0.1 },
};
export const SAND = ["#efdca4", "#e8d296", "#f4e5b6"];
export const SEABED_DEEP = "#3d9aa6";
export const SNOWY = ["#f4f8fb", "#e8f0f6", "#fbfdff"];
export const ICE_BLOCK = ["#f1faff", "#dcf0fb", "#c4e4f6", "#e6f6ff"];
/** depth of the seabed below the waterline, scene units */
export const SEABED_DEPTH = 0.12;
/** neutral soil colours (sRGB) for bands that are not selected, and the deep part that GLDAS Noah does not cover */
export const SOIL_NEUTRAL: Record<"top" | "root" | "deep", RGB> = { top: [0.5, 0.34, 0.23], root: [0.6, 0.43, 0.3], deep: [0.46, 0.43, 0.4] };
export const WOOD = { light: "#a8754a", dark: "#7a5232", ring: "#c99a63" };

/* ------------------------------------------------------------------------------------------------- height */
interface Bump { x: number; z: number; a: number; s: number; sharp: boolean }
export type HeightFn = (x: number, z: number) => number;

const HILLS: Record<Style, { a: number; s: number; sharp: boolean; n: number; bump: [number, number]; bumpSharp: boolean }> = {
  lush: { a: 0.24, s: 0.19, sharp: false, n: 5, bump: [0.04, 0.1], bumpSharp: false },
  temperate: { a: 0.3, s: 0.19, sharp: false, n: 4, bump: [0.04, 0.12], bumpSharp: false },
  savanna: { a: 0.15, s: 0.22, sharp: false, n: 3, bump: [0.02, 0.06], bumpSharp: false },
  desert: { a: 0.13, s: 0.2, sharp: false, n: 0, bump: [0, 0], bumpSharp: false },
  taiga: { a: 0.25, s: 0.2, sharp: false, n: 4, bump: [0.03, 0.08], bumpSharp: false },
  alpine: { a: 0.5, s: 0.16, sharp: true, n: 2, bump: [0.14, 0.26], bumpSharp: true },
  ice: { a: 0.12, s: 0.3, sharp: false, n: 4, bump: [0.03, 0.08], bumpSharp: false },
};

type XZ = { x: number; z: number };
export function makeHeight(style: Style, rnd: () => number, hill: XZ = HILL, cloud: XZ = CLOUD, maxX = Infinity): HeightFn {
  const p = HILLS[style];
  const bumps: Bump[] = [{ x: hill.x, z: hill.z, a: p.a, s: p.s, sharp: p.sharp }];
  let guard = 0;
  while (bumps.length < p.n + 1 && guard++ < 200) {
    const ang = rnd() * Math.PI * 2, r = 0.15 + rnd() * 0.45;
    const x = Math.sin(ang) * r, z = Math.cos(ang) * r;
    if (Math.hypot(x - hill.x, z - hill.z) < 0.3 || z > 0.3 || x > maxX) continue;
    if (Math.hypot(x - cloud.x, z - cloud.z) < 0.22) continue; // keep the rain column on low ground
    bumps.push({ x, z, a: p.bump[0] + rnd() * (p.bump[1] - p.bump[0]), s: p.bumpSharp ? 0.11 : 0.1 + rnd() * 0.08, sharp: p.bumpSharp });
  }
  const dunePhase = rnd() * 6;
  return (x, z) => {
    const r = Math.hypot(x, z);
    const f = 1 - smooth(0.5, 0.9, r);
    let h = 0;
    for (const b of bumps) {
      const d2 = (x - b.x) ** 2 + (z - b.z) ** 2;
      h += b.sharp ? b.a * Math.exp(-Math.sqrt(d2) / b.s) : b.a * Math.exp(-d2 / (2 * b.s * b.s));
    }
    if (style === "desert") h += 0.045 * Math.pow(0.5 + 0.5 * Math.sin(x * 8 + Math.sin(z * 3.5 + dunePhase) * 1.6 + dunePhase), 3);
    if (style === "ice") h += 0.05 * (1 - smooth(0.55, 0.95, r)) + 0.012 * Math.sin(x * 9 + dunePhase) * Math.sin(z * 7 - dunePhase);
    return Math.max(0, h) * f;
  };
}

/* ------------------------------------------------------------------------------------------------- layout */
export interface Coast { c0: number; amp: number; ph: number }
/** x of the shoreline at depth z: sea lies at x greater than this */
export const coastX = (c: Coast, z: number) =>
  c.c0 + c.amp * (0.75 * Math.sin(z * 3.2 + c.ph) + 0.4 * Math.sin(z * 7.7 + c.ph * 1.9 + 1) + 0.2 * Math.sin(z * 16.1 + c.ph * 2.7 + 2));
export interface Isle { x: number; z: number; r: number }
/** island outline: radius wobbles with the angle (three harmonics), so the shore is never a circle. GLSL twin in scene.ts. */
export const ISLE_IRR = 0.1;
export const isleRadius = (i: Isle, ph: number, x: number, z: number) => {
  const a = Math.atan2(z - i.z, x - i.x);
  return i.r * (1 + ISLE_IRR * (0.55 * Math.sin(a * 3 + ph) + 0.3 * Math.sin(a * 5 + ph * 2 + 1) + 0.15 * Math.sin(a * 9 + ph * 3)));
};
export interface Layout {
  plan: SceneryPlan;
  style: Style;
  hill: XZ;
  cloud: { x: number; y: number; z: number };
  coast: Coast | null;
  isle: Isle | null;
  /** phase of the irregular island outline (set for the "island" kind only) */
  isleIrr?: number;
  /** 0 = no water, 1 = coast (sea at +x), 2 = open sea */
  seaMode: 0 | 1 | 2;
  /** terrain top minus GROUND_Y; negative = seabed below the waterline */
  height: HeightFn;
  /** > 0 inside land (distance from the shore), < 0 in water; 1 everywhere on a dry scene */
  inland: (x: number, z: number) => number;
  /** snow cap footprint radius and height at full SWE */
  snow: { rMax: number; hMax: number };
  /** the cut-away carries soil strata (otherwise ice or water) */
  soilCap: boolean;
  /** the dry part of the cut-away is ice */
  iceCap: boolean;
}

/** x such that the share `s` of the ground disc lies at x > c */
function coastOffset(s: number): number {
  const R = RIM, frac = (c: number) => (R * R * Math.acos(c / R) - c * Math.sqrt(R * R - c * c)) / (Math.PI * R * R);
  let lo = -R, hi = R;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (frac(m) > s) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

export function makeLayout(plan: SceneryPlan, rnd: () => number): Layout {
  const iceLand = plan.kind === "ice" || (plan.kind === "coast" && plan.landSide === "ice");
  const style: Style = iceLand ? "ice" : plan.biome;
  const base = { plan, style, cloud: { ...CLOUD } };
  const rMax = style === "alpine" ? 0.2 : 0.24;
  if (plan.kind === "coast") {
    const c: Coast = { c0: coastOffset(Math.min(0.78, Math.max(0.12, plan.share.sea))), amp: 0.06 + rnd() * 0.04, ph: rnd() * 6.28 };
    const hill = { x: Math.min(c.c0 - 0.3, Math.max(-0.56, (-RIM * 0.72 + c.c0) / 2)), z: -0.2 };
    const cloud = { ...CLOUD, x: Math.min(0.42, Math.max(-0.3, c.c0 - 0.12)) };
    const land = makeHeight(style, rnd, hill, cloud, c.c0 - 0.18);
    const d = (x: number, z: number) => coastX(c, z) - x;
    return {
      ...base, cloud, hill, coast: c, isle: null, seaMode: 1,
      height: (x, z) => {
        const dd = d(x, z);
        const b = dd <= 0 ? -0.03 - (SEABED_DEPTH - 0.03) * smooth(0, 0.45, -dd) : -0.03 + 0.07 * smooth(0, 0.12, dd);
        return b + land(x, z) * smooth(0.06, 0.3, dd);
      },
      inland: d, snow: { rMax: Math.min(rMax, 0.8 * Math.max(0.1, c.c0 - hill.x - 0.08)), hMax: 0.3 }, soilCap: !iceLand, iceCap: iceLand,
    };
  }
  if (plan.kind === "island") {
    // land in the middle of the disc with a beach ring and sea all around (about 30 % of the disc is sea)
    const hill = { x: -0.18, z: -0.2 }, cloud = { ...CLOUD };
    const isle: Isle = { x: 0, z: 0, r: RIM * Math.sqrt(Math.min(0.8, Math.max(0.55, 1 - plan.share.sea))) };
    const land = makeHeight(style, rnd, hill, cloud);
    const iph = rnd() * 6.28;
    const d = (x: number, z: number) => isleRadius(isle, iph, x, z) - Math.hypot(x - isle.x, z - isle.z);
    return {
      ...base, cloud, hill, coast: null, isle, isleIrr: iph, seaMode: 2,
      height: (x, z) => {
        const dd = d(x, z);
        const b = dd <= 0 ? -0.03 - (SEABED_DEPTH - 0.03) * smooth(0, 0.45, -dd) : -0.03 + 0.07 * smooth(0, 0.12, dd);
        return b + land(x, z) * smooth(0.06, 0.3, dd);
      },
      inland: d, snow: { rMax, hMax: 0.3 }, soilCap: false, iceCap: false,
    };
  }
  if (plan.kind === "sea") {
    const hill = { x: -0.3, z: -0.28 };
    const rs = 0.13 + 0.09 * Math.min(1, (plan.share.land + plan.share.ice) * 4), sg = rs / 1.27;
    const isle: Isle | null = plan.islet ? { ...hill, r: rs } : null;
    return {
      ...base, hill, coast: null, isle, seaMode: 2,
      height: (x, z) => -SEABED_DEPTH + 0.012 * Math.sin(x * 6 + z * 4) + (isle ? (SEABED_DEPTH + 0.15) * Math.exp(-((x - hill.x) ** 2 + (z - hill.z) ** 2) / (2 * sg * sg)) : 0),
      inland: (x, z) => (isle ? isle.r - Math.hypot(x - isle.x, z - isle.z) : -1),
      snow: { rMax: rs * 0.62, hMax: 0.1 }, soilCap: false, iceCap: false,
    };
  }
  return {
    ...base, hill: HILL, coast: null, isle: null, seaMode: 0,
    height: makeHeight(style, rnd, HILL, CLOUD),
    inland: () => 1, snow: { rMax, hMax: 0.3 }, soilCap: !iceLand, iceCap: iceLand,
  };
}

/* ------------------------------------------------------------------------------------------------- builder */
const tmpColor = new THREE.Color();
/** Leaf kinds: crowns that follow the season (0), conifers that stay evergreen (1), palm fronds that react a little (2). */
export type LeafKind = 0 | 1 | 2;
export interface LeafSpec { pivot: [number, number, number]; kind: LeafKind }
export class Builder {
  parts: THREE.BufferGeometry[] = [];
  leafParts: THREE.BufferGeometry[] = [];
  /** `leaf`: the part is canopy; it goes to a separate merged mesh whose shader scales it about `pivot` and recolours it by season */
  add(src: THREE.BufferGeometry, color: string, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0], leaf?: LeafSpec) {
    const g = src.index ? src.toNonIndexed() : src.clone();
    src.dispose();
    g.deleteAttribute("uv");
    g.deleteAttribute("normal");
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    g.applyMatrix4(m);
    g.computeVertexNormals();
    const n = g.getAttribute("position").count;
    tmpColor.set(color);
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = tmpColor.r; c[i * 3 + 1] = tmpColor.g; c[i * 3 + 2] = tmpColor.b; }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    if (leaf) {
      const pv = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { pv[i * 4] = leaf.pivot[0]; pv[i * 4 + 1] = leaf.pivot[1]; pv[i * 4 + 2] = leaf.pivot[2]; pv[i * 4 + 3] = leaf.kind; }
      g.setAttribute("aPivot", new THREE.BufferAttribute(pv, 4));
      this.leafParts.push(g);
    } else this.parts.push(g);
  }
  build(): THREE.BufferGeometry {
    const g = this.parts.length ? mergeGeometries(this.parts) : new THREE.BufferGeometry();
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    return g;
  }
  /** the canopy parts as one mesh (null when there is none) */
  buildLeaves(): THREE.BufferGeometry | null {
    const g = this.leafParts.length ? mergeGeometries(this.leafParts) : null;
    this.leafParts.forEach((p) => p.dispose());
    this.leafParts = [];
    return g;
  }
}
export const pick = <T,>(rnd: () => number, a: T[]) => a[Math.floor(rnd() * a.length) % a.length];

/* ------------------------------------------------------------------------------------------------- ground */
/** beach -> wet sand -> shallow turquoise -> deeper water, as a continuous ramp over the terrain height above the waterline */
const SHORE_STOPS: [number, string][] = [[0.06, "#f0deaa"], [0.025, "#ead59b"], [0, "#d8c48c"], [-0.025, "#a6dccb"], [-0.06, "#77c9bd"], [-SEABED_DEPTH, SEABED_DEEP]];
const shoreTmp = new THREE.Color();
function shoreColor(cy: number, out: THREE.Color): THREE.Color {
  if (cy >= SHORE_STOPS[0][0]) return out.set(SHORE_STOPS[0][1]);
  for (let k = 1; k < SHORE_STOPS.length; k++) {
    if (cy >= SHORE_STOPS[k][0]) {
      const [y0, c0] = SHORE_STOPS[k - 1], [y1, c1] = SHORE_STOPS[k];
      return out.set(c0).lerp(shoreTmp.set(c1), (y0 - cy) / (y0 - y1));
    }
  }
  return out.set(SEABED_DEEP);
}

export function buildGround(L: Layout, rnd: () => number): THREE.BufferGeometry {
  const h = L.height;
  const K = 12;
  const counts = [1, 6, 12, 24, 48, 48, 48, 48, 48, 96, 96, 96, 96];
  const rings: [number, number][][] = [];
  for (let k = 0; k <= K; k++) {
    const c = counts[k], r = (RIM * k) / K, ring: [number, number][] = [];
    for (let j = 0; j < c; j++) {
      let a = (j / c) * Math.PI * 2, rr = r;
      if (k > 0 && k < K) { a += (rnd() - 0.5) * 0.55 * ((Math.PI * 2) / c); rr += (rnd() - 0.5) * 0.5 * (RIM / K); }
      ring.push([rr * Math.sin(a), rr * Math.cos(a)]);
    }
    rings.push(ring);
  }
  const tris: [number, number][][] = [];
  for (let k = 0; k < K; k++) {
    const A = rings[k], B = rings[k + 1];
    if (A.length === 1) { for (let j = 0; j < B.length; j++) tris.push([A[0], B[j], B[(j + 1) % B.length]]); continue; }
    if (B.length === A.length * 2) {
      for (let i = 0; i < A.length; i++) {
        const a0 = A[i], a1 = A[(i + 1) % A.length], b0 = B[2 * i], b1 = B[2 * i + 1], b2 = B[(2 * i + 2) % B.length];
        tris.push([a0, b0, b1], [a0, b1, a1], [a1, b1, b2]);
      }
    } else {
      for (let i = 0; i < A.length; i++) {
        const a0 = A[i], a1 = A[(i + 1) % A.length], b0 = B[i], b1 = B[(i + 1) % B.length];
        if ((i + k) % 2) tris.push([a0, b0, b1], [a0, b1, a1]); else tris.push([a0, b0, a1], [a1, b0, b1]);
      }
    }
  }
  const pal = PAL[L.style];
  // snow touches only on land (never on open water); an islet gets them only when the region's snowFrac is high
  const snowy = L.style !== "ice" && (L.plan.kind !== "sea" || (!!L.isle && L.plan.snow >= SNOW_ISLET_MIN)) ? L.plan.snow : 0;
  const pos = new Float32Array(tris.length * 9), col = new Float32Array(tris.length * 9);
  const sea = new THREE.Color(), land = new THREE.Color();
  tris.forEach((t, i) => {
    const v = t.map(([x, z]) => [x, GROUND_Y + h(x, z), z]);
    // make every face point up
    const cross = (v[1][2] - v[0][2]) * (v[2][0] - v[0][0]) - (v[1][0] - v[0][0]) * (v[2][2] - v[0][2]);
    if (cross < 0) [v[1], v[2]] = [v[2], v[1]];
    const cy = (v[0][1] + v[1][1] + v[2][1]) / 3 - GROUND_Y;
    const cx = (v[0][0] + v[1][0] + v[2][0]) / 3, cz = (v[0][2] + v[1][2] + v[2][2]) / 3;
    // land colour of the face (also used inland on scenes with water)
    const high = cy > pal.highFrom + (rnd() - 0.5) * 0.05;
    land.set(pick(rnd, high ? pal.high : pal.ground));
    // snowy touches where a large share of the precipitation falls as snow: high faces first, then scattered
    if (snowy >= 0.12 && rnd() < Math.min(0.95, snowy * (cy > pal.highFrom * 0.6 ? 1.6 : 0.5))) land.set(pick(rnd, SNOWY));
    // a slightly lighter lip at the rim reads as the edge of the diorama
    if (Math.hypot(cx, cz) > RIM * 0.93) land.offsetHSL(0, -0.04, 0.05);
    const jit = (rnd() - 0.5) * 0.03;
    for (let j = 0; j < 3; j++) {
      if (L.seaMode) shoreColor(v[j][1] - GROUND_Y, sea).lerp(land, smooth(0.045, 0.085, v[j][1] - GROUND_Y)); // per-vertex ramp: smooth beach and seabed
      else sea.copy(land);
      sea.offsetHSL(0, 0, jit);
      pos.set(v[j], i * 9 + j * 3);
      col.set([sea.r, sea.g, sea.b], i * 9 + j * 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------------------------------------- props */
export type Kind = "iceBlock" | "iceShard" | "iceChunk" | "round" | "bigRound" | "conifer" | "acacia" | "cactus" | "rock" | "bush" | "tuft" | "flower" | "mesa" | "boulder";
export const PLAN: Record<Style, [Kind, number][]> = {
  lush: [["bigRound", 15], ["round", 6], ["bush", 9], ["flower", 6], ["rock", 2]],
  temperate: [["round", 10], ["bush", 6], ["flower", 6], ["rock", 3]],
  savanna: [["acacia", 5], ["tuft", 16], ["bush", 3], ["rock", 3]],
  desert: [["mesa", 1], ["cactus", 5], ["rock", 6], ["boulder", 2], ["flower", 2]],
  taiga: [["conifer", 17], ["rock", 4], ["bush", 3]],
  alpine: [["conifer", 7], ["boulder", 3], ["rock", 7]],
  ice: [["iceBlock", 9], ["iceShard", 7], ["iceChunk", 8], ["rock", 2]],
};
export const SPACING: Record<Kind, number> = { round: 0.12, bigRound: 0.13, conifer: 0.1, acacia: 0.2, cactus: 0.14, rock: 0.07, bush: 0.07, tuft: 0.05, flower: 0.04, mesa: 0.3, boulder: 0.14, iceBlock: 0.13, iceShard: 0.1, iceChunk: 0.07 };

export function addProp(b: Builder, kind: Kind, x: number, y: number, z: number, pal: Palette, rnd: () => number) {
  const s = 0.85 + rnd() * 0.35, ry = rnd() * Math.PI * 2;
  switch (kind) {
    case "round":
    case "bigRound": {
      const k = kind === "bigRound" ? 1.25 : 1;
      b.add(new THREE.CylinderGeometry(0.016, 0.024, 0.1, 6), pal.trunk, [x, y + 0.05 * s * k, z], [s * k, s * k, s * k], [0, ry, 0]);
      // pivot at the trunk top so a shrinking crown stays seated on the trunk instead of floating above it
      const lf: LeafSpec = { pivot: [x, y + 0.095 * s * k, z], kind: 0 };
      b.add(new THREE.IcosahedronGeometry(0.072, 0), pick(rnd, pal.canopy), [x, y + 0.14 * s * k, z], [s * k, s * k * 1.08, s * k], [rnd(), ry, rnd()], lf);
      if (rnd() < 0.55) b.add(new THREE.IcosahedronGeometry(0.046, 0), pick(rnd, pal.canopy), [x + 0.045 * s * k, y + 0.105 * s * k, z + 0.02], [s * k, s * k, s * k], [rnd(), ry, 0], lf);
      break;
    }
    case "conifer": {
      const k = s * (0.9 + rnd() * 0.3), col = pick(rnd, pal.canopy);
      b.add(new THREE.CylinderGeometry(0.012, 0.016, 0.06, 5), pal.trunk, [x, y + 0.03 * k, z], [k, k, k]);
      const lf: LeafSpec = { pivot: [x, y, z], kind: 1 };
      b.add(new THREE.ConeGeometry(0.068, 0.11, 7), col, [x, y + 0.1 * k, z], [k, k, k], [0, ry, 0], lf);
      b.add(new THREE.ConeGeometry(0.052, 0.095, 7), col, [x, y + 0.16 * k, z], [k, k, k], [0, ry + 0.4, 0], lf);
      b.add(new THREE.ConeGeometry(0.035, 0.075, 7), col, [x, y + 0.215 * k, z], [k, k, k], [0, ry + 0.8, 0], lf);
      break;
    }
    case "acacia": {
      const lean = (rnd() - 0.5) * 0.25;
      b.add(new THREE.CylinderGeometry(0.009, 0.015, 0.15, 5), pal.trunk, [x, y + 0.075 * s, z], [s, s, s], [lean, ry, 0]);
      b.add(new THREE.IcosahedronGeometry(0.085, 0), pick(rnd, pal.canopy), [x + Math.sin(lean) * -0.05, y + 0.16 * s, z], [s * 1.5, s * 0.38, s * 1.3], [0, ry, 0], { pivot: [x + Math.sin(lean) * -0.05, y + 0.14 * s, z], kind: 0 });
      break;
    }
    case "cactus": {
      const g = pick(rnd, pal.canopy), k = s * 1.05;
      b.add(new THREE.CylinderGeometry(0.022, 0.024, 0.15, 7), g, [x, y + 0.075 * k, z], [k, k, k]);
      b.add(new THREE.IcosahedronGeometry(0.022, 0), g, [x, y + 0.15 * k, z], [k, k * 0.8, k]);
      const side = rnd() < 0.5 ? 1 : -1;
      b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 6), g, [x + side * 0.03 * k, y + 0.07 * k, z], [k, k, k], [0, 0, Math.PI / 2]);
      b.add(new THREE.CylinderGeometry(0.012, 0.013, 0.06, 6), g, [x + side * 0.048 * k, y + 0.095 * k, z], [k, k, k]);
      if (rnd() < 0.6) {
        b.add(new THREE.CylinderGeometry(0.011, 0.011, 0.035, 6), g, [x - side * 0.028 * k, y + 0.095 * k, z], [k, k, k], [0, 0, Math.PI / 2]);
        b.add(new THREE.CylinderGeometry(0.011, 0.012, 0.045, 6), g, [x - side * 0.044 * k, y + 0.115 * k, z], [k, k, k]);
      }
      if (pal.accent.length && rnd() < 0.7) b.add(new THREE.IcosahedronGeometry(0.012, 0), pal.accent[0], [x, y + 0.168 * k, z]);
      break;
    }
    case "rock":
      b.add(new THREE.DodecahedronGeometry(0.032, 0), pick(rnd, pal.rock), [x, y + 0.008, z], [s, s * 0.7, s * 0.9], [rnd(), ry, rnd() * 0.4]);
      break;
    case "boulder":
      b.add(new THREE.DodecahedronGeometry(0.06, 0), pick(rnd, pal.rock), [x, y + 0.02, z], [s, s * 0.75, s * 0.95], [rnd(), ry, rnd() * 0.3]);
      break;
    case "bush":
      b.add(new THREE.IcosahedronGeometry(0.036, 0), pick(rnd, pal.canopy), [x, y + 0.02, z], [s, s * 0.8, s], [rnd(), ry, 0], { pivot: [x, y + 0.006, z], kind: pal === PAL.taiga || pal === PAL.alpine ? 1 : 0 });
      break;
    case "tuft": {
      const col = pick(rnd, pal.accent.length ? pal.accent : pal.canopy);
      for (let i = 0; i < 3; i++) b.add(new THREE.ConeGeometry(0.009, 0.05, 4), col, [x + (i - 1) * 0.01, y + 0.022, z], [s, s, s], [(i - 1) * 0.35, ry, (i - 1) * 0.2]);
      break;
    }
    case "flower": {
      if (!pal.accent.length) break;
      b.add(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 4), pick(rnd, pal.canopy), [x, y + 0.015, z]);
      b.add(new THREE.IcosahedronGeometry(0.011, 0), pick(rnd, pal.accent), [x, y + 0.032, z]);
      break;
    }
    case "iceBlock": {
      const col = pick(rnd, ICE_BLOCK), w = 0.07 + rnd() * 0.05, hh = 0.04 + rnd() * 0.05;
      b.add(new THREE.BoxGeometry(w, hh, w * (0.7 + rnd() * 0.5)), col, [x, y + hh * 0.42, z], [1, 1, 1], [(rnd() - 0.5) * 0.35, ry, (rnd() - 0.5) * 0.35]);
      if (rnd() < 0.5) b.add(new THREE.BoxGeometry(w * 0.55, hh * 0.8, w * 0.5), pick(rnd, ICE_BLOCK), [x + w * 0.45, y + hh * 0.3, z + w * 0.2], [1, 1, 1], [0, ry + 0.6, (rnd() - 0.5) * 0.4]);
      break;
    }
    case "iceShard": {
      const k = 0.8 + rnd() * 0.7;
      b.add(new THREE.OctahedronGeometry(0.04, 0), pick(rnd, ICE_BLOCK), [x, y + 0.055 * k, z], [0.8 * k, 2.1 * k, 0.8 * k], [(rnd() - 0.5) * 0.3, ry, (rnd() - 0.5) * 0.3]);
      if (rnd() < 0.6) b.add(new THREE.OctahedronGeometry(0.03, 0), pick(rnd, ICE_BLOCK), [x + 0.04, y + 0.03 * k, z + 0.015], [0.8, 1.7, 0.8], [0, ry + 0.5, 0.35]);
      break;
    }
    case "iceChunk":
      b.add(new THREE.DodecahedronGeometry(0.035, 0), pick(rnd, ICE_BLOCK), [x, y + 0.012, z], [s, s * 0.65, s * 0.9], [rnd(), ry, rnd() * 0.4]);
      break;
    case "mesa": {
      const rock = pal.rock[1] ?? pal.rock[0];
      b.add(new THREE.CylinderGeometry(0.1, 0.13, 0.13, 7), rock, [x, y + 0.055, z], [1, 1, 0.85], [0, ry, 0]);
      b.add(new THREE.CylinderGeometry(0.075, 0.1, 0.07, 7), pal.rock[0], [x, y + 0.155, z], [1, 1, 0.85], [0, ry + 0.3, 0]);
      b.add(new THREE.CylinderGeometry(0.077, 0.077, 0.012, 7), pal.ground[0], [x, y + 0.195, z], [1, 1, 0.85], [0, ry + 0.3, 0]);
      break;
    }
  }
}

export function buildProps(L: Layout, rnd: () => number): { props: THREE.BufferGeometry; leaves: THREE.BufferGeometry | null } {
  const b = new Builder(), pal = PAL[L.style], h = L.height;
  const placed: [number, number, number][] = [];
  const hillPeak = h(L.hill.x, L.hill.z);
  const hill = L.hill;
  // partial scenes carry proportionally fewer props: the land share of the disc, and a handful on an islet
  const bigIsle = L.plan.kind === "island";
  const scale = L.seaMode === 1 || bigIsle ? Math.max(0.25, 1 - L.plan.share.sea) : 1;
  for (const [kind0, n0] of PLAN[L.style]) {
    if (L.seaMode === 2 && !bigIsle && (!L.isle || ["mesa", "boulder", "bigRound", "iceBlock", "iceChunk"].includes(kind0))) continue;
    const n = L.seaMode === 2 && !bigIsle ? Math.max(1, Math.round(n0 * 0.1)) : Math.max(1, Math.round(n0 * scale));
    const kind = kind0;
    let made = 0, guard = 0;
    while (made < n && guard++ < 900) {
      let x: number, z: number;
      if (L.isle) {
        const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * L.isle.r * (bigIsle ? 0.92 : 0.75);
        x = L.isle.x + Math.sin(ang) * r; z = L.isle.z + Math.cos(ang) * r;
      } else {
        const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.84;
        x = Math.sin(ang) * r; z = Math.cos(ang) * r;
      }
      const r = Math.hypot(x, z);
      const small = kind === "flower" || kind === "tuft" || kind === "rock" || kind === "iceChunk";
      if (L.seaMode === 1) {
        if (L.inland(x, z) < (small ? 0.1 : 0.2)) continue; // keep the beach and the sea clear
        if (z > -0.15 && z < 0.72 && !small && kind !== "bush") continue; // runoff lane toward the sea
      } else if (L.seaMode === 2) {
        if (L.inland(x, z) < (bigIsle ? (small ? 0.1 : 0.2) : 0.04)) continue;
        if (bigIsle) {
          const front = Math.abs(Math.atan2(x, z)) < FRONT_SECTOR && r > 0.46; // keep the runoff view clear
          if (front && !small) continue;
        }
      } else {
        const front = Math.abs(Math.atan2(x, z)) < FRONT_SECTOR && r > 0.46;
        if (front && !small) continue;
        if (front && r > 0.55) continue;
      }
      const dh = Math.hypot(x - hill.x, z - hill.z);
      if ((!L.isle || bigIsle) && dh < (kind === "rock" ? 0.12 : 0.22)) continue; // the hilltop holds the snow cap
      if ((!L.isle || bigIsle) && Math.abs(x - hill.x) < 0.17 && z > hill.z && z < hill.z + 0.65 && !small && kind !== "bush") continue; // keep the line of sight to the hilltop
      const y = Math.max(0, h(x, z));
      if ((kind === "conifer" || kind === "round") && y > hillPeak * 0.55 && L.style === "alpine") continue;
      if (kind === "mesa" && (r < 0.45 || z > 0)) continue;
      const sp = SPACING[kind];
      if (placed.some(([px, pz, ps]) => Math.hypot(px - x, pz - z) < Math.max(sp, ps) * 0.9)) continue;
      placed.push([x, z, sp]);
      addProp(b, kind, x, GROUND_Y + y - 0.006, z, pal, rnd);
      made++;
    }
  }
  return { props: b.build(), leaves: b.buildLeaves() };
}

/* ------------------------------------------------------------------------------------------------- fixed pieces */
export function buildCloud(): THREE.BufferGeometry {
  const b = new Builder();
  const lobes: [number, number, number, number][] = [
    [0, 0, 0, 0.12], [-0.12, -0.025, 0.01, 0.09], [0.125, -0.03, -0.01, 0.085], [0.04, 0.07, -0.01, 0.085], [-0.06, 0.045, 0.03, 0.07], [0.02, -0.02, 0.07, 0.08],
  ];
  for (const [x, y, z, r] of lobes) b.add(new THREE.IcosahedronGeometry(r, 1), "#ffffff", [x, y, z], [1.05, 0.85, 0.9]);
  return b.build();
}

export function buildPedestal(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(new THREE.CylinderGeometry(0.8, 0.84, 0.07, 28), WOOD.dark, [0, -1.17, 0]);
  b.add(new THREE.CylinderGeometry(0.6, 0.76, 0.27, 28), WOOD.light, [0, -1.0, 0]);
  b.add(new THREE.CylinderGeometry(0.575, 0.6, 0.05, 28), WOOD.ring, [0, -0.85, 0]);
  return b.build();
}

/** Soil cut-away: the lower cap of the sphere, from the ground line to the bottom. Same segment count as the ground rim. */
export function buildSoilCap(): THREE.BufferGeometry {
  const th0 = Math.acos(GROUND_Y / R_IN);
  const pts: THREE.Vector2[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const th = Math.PI - (i / N) * (Math.PI - th0);
    pts.push(new THREE.Vector2(Math.max(1e-4, R_IN * Math.sin(th)), R_IN * Math.cos(th)));
  }
  return new THREE.LatheGeometry(pts, RIM_SEGMENTS);
}

/**
 * Snow cap on the main hilltop, as unit-disc vertices (q = 0 centre .. 1 rim). The scene places them for a given SWE:
 * footprint radius and height both scale with `snowSize(swe)`, so the cap grows in every direction with the value.
 */
export function buildSnowPatch(rnd: () => number) {
  const rings = 6, seg = 16;
  const pts: { a: number; q: number }[][] = [];
  for (let k = 0; k <= rings; k++) {
    const ring: { a: number; q: number }[] = [];
    const n = k === 0 ? 1 : seg;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + (k % 2) * (Math.PI / seg);
      const wob = k === rings ? 0.82 + rnd() * 0.36 : 1;
      ring.push({ a, q: (k / rings) * wob });
    }
    pts.push(ring);
  }
  const tris: { a: number; q: number }[][] = [];
  for (let k = 0; k < rings; k++) {
    const A = pts[k], B = pts[k + 1];
    if (A.length === 1) { for (let j = 0; j < B.length; j++) tris.push([A[0], B[j], B[(j + 1) % B.length]]); continue; }
    for (let i = 0; i < A.length; i++) {
      const a0 = A[i], a1 = A[(i + 1) % A.length], b0 = B[i], b1 = B[(i + 1) % B.length];
      tris.push([a0, b0, b1], [a0, b1, a1]);
    }
  }
  const n = tris.length * 3;
  const ang = new Float32Array(n), q = new Float32Array(n);
  tris.forEach((t, i) => {
    let v = t;
    const x = (p: { a: number; q: number }) => Math.sin(p.a) * p.q, z = (p: { a: number; q: number }) => Math.cos(p.a) * p.q;
    const cross = (z(v[1]) - z(v[0])) * (x(v[2]) - x(v[0])) - (x(v[1]) - x(v[0])) * (z(v[2]) - z(v[0]));
    if (cross < 0) v = [v[0], v[2], v[1]];
    v.forEach((p, j) => { ang[i * 3 + j] = p.a; q[i * 3 + j] = p.q; });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  return { geometry: g, ang, q };
}
