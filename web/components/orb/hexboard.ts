// Hex-tile diorama (Overcooked-map style): the ground is a board of chunky hexagonal prisms coloured by biome.
// Nothing here is data-driven. The board is derived once from the scenery plan (encoding.chooseScenery) and seeded by the
// region id, so it is stable while months play. Data enters only through scene.ts (particles, soil bands, snow caps).
import * as THREE from "three";
import { SNOW_ISLET_MIN, snowCapAllowed, type SceneryPlan } from "./encoding";
import {
  Builder, GROUND_Y, PAL, PLAN, SAND, SNOWY, addProp, smooth, makeHeight, pick, seeded,
  type Kind, type Layout, type Style,
} from "./scenery";

/** soil strata of the hex board's side faces (thinner than the glass cut-away: the board is shown from higher up) */
export const HEX_SOIL = { topY: GROUND_Y - 0.04, rootY: GROUND_Y - 0.19 };
export type HexVariant = "hex-glass" | "hex-island";
export type TileKind = "water" | "beach" | "land" | "ice";
const SQ3 = Math.sqrt(3);
const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]; // edge k faces angle 60k degrees (x toward z)
const WATER_SHALLOW = "#a8ddcf";
const WATER_FLOOR_DEEP = "#4aa7ae";
const STEP_BROWN = "#8a6a48";
const ROCK_TONES = ["#8d7f72", "#9a8a7a", "#7b6e63", "#a89886"];
const ROOT_TONES = ["#6b4a32", "#7a5232", "#5d4029"];

export interface HexTile {
  q: number; r: number; x: number; z: number;
  kind: TileKind;
  /** top face height above GROUND_Y (the waterline); water tiles sit below it */
  top: number;
  /** water: 0 shallow .. 1 deep */
  depth: number;
  nb: (HexTile | null)[];
  color: THREE.Color;
  shore?: boolean;
  ph: number;
}

export interface SnowPeak { x: number; y: number; z: number; r: number; h: number; from: number }
export interface HexBoard {
  variant: HexVariant;
  s: number;
  tiles: HexTile[];
  /** land tiles (land, beach, ice): where vapour rises and runoff starts */
  landTiles: HexTile[];
  waterTiles: HexTile[];
  layout: Layout;
  /** whether the side faces carry soil strata (not ice, not open sea) */
  hasStrata: boolean;
  islet: boolean;
  /** toon mesh: tile tops, bevels and the steps between tiles */
  top: THREE.BufferGeometry;
  /** strata shader mesh: the outside faces of the board and the tapered underside */
  sides: THREE.BufferGeometry;
  /** water surface and the side faces of the water body, null without water */
  water: THREE.BufferGeometry | null;
  props: THREE.BufferGeometry;
  /** canopy of the props as a separate mesh (seasonal scale and colour in the shader), null without trees */
  leaves: THREE.BufferGeometry | null;
  /** roots and floating rock bits (sky island only) */
  extras: THREE.BufferGeometry | null;
  peaks: SnowPeak[];
  /** outward-facing boundary edges of land tiles, where the soil bands are visible */
  landEdges: { a: [number, number]; b: [number, number]; ya: number; nx: number; nz: number }[];
  /** point on the outside wall at height y (x, z, outward normal) for edge i of `landEdges`, f along the edge */
  wallPoint: (i: number, f: number, y: number) => [number, number, number, number];
  /** index of the land edge where the soil labels point */
  labelEdge: number;
  /** world points for the missing-data chips */
  anchors: { run: [number, number]; puff: [number, number] };
  /** bottom of the soil strata (top of the rock body), y */
  y0: number;
  /** lowest y of the underside */
  yBottom: number;
  /** half-width of the board */
  radius: number;
}

/** tile under a point (world x, z), or null off the board */
export function tileAt(index: Map<number, HexTile>, s: number, x: number, z: number): HexTile | null {
  const fq = ((SQ3 / 3) * x - z / 3) / s, fr = (2 / 3) * z / s;
  let q = Math.round(fq), r = Math.round(fr);
  const fs = -fq - fr, ds = Math.round(fs);
  const dq = Math.abs(q - fq), dr = Math.abs(r - fr), dsa = Math.abs(ds - fs);
  if (dq > dr && dq > dsa) q = -r - ds; else if (dr > dsa) r = -q - ds;
  return index.get(key(q, r)) ?? null;
}
const key = (q: number, r: number) => (q + 32) * 64 + (r + 32);

/* ------------------------------------------------------------------------------------------------- geometry helpers */
type V3 = [number, number, number];
interface SoupAttrs { kind?: number; top?: number; vari?: number; extra?: number[] }
class Soup {
  pos: number[] = [];
  col: number[] = [];
  kind: number[] = [];
  top: number[] = [];
  vari: number[] = [];
  extra: number[] = [];
  private c = new THREE.Color();
  tri(a: V3, b: V3, c: V3, hint: V3, color: THREE.Color | string, attrs?: SoupAttrs) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { const t = b; b = c; c = t; }
    const col = typeof color === "string" ? this.c.set(color) : color;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(col.r, col.g, col.b);
      this.kind.push(attrs?.kind ?? 0); this.top.push(attrs?.top ?? 0); this.vari.push(attrs?.vari ?? 0);
      if (attrs?.extra) this.extra.push(...attrs.extra);
    }
  }
  quad(a: V3, b: V3, c: V3, d: V3, hint: V3, color: THREE.Color | string, attrs?: SoupAttrs) {
    this.tri(a, b, c, hint, color, attrs);
    this.tri(a, c, d, hint, color, attrs);
  }
  geometry(withSide: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    if (!withSide) { g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3)); g.computeVertexNormals(); return g; }
    g.setAttribute("aKind", new THREE.Float32BufferAttribute(this.kind, 1));
    g.setAttribute("aTop", new THREE.Float32BufferAttribute(this.top, 1));
    g.setAttribute("aVar", new THREE.Float32BufferAttribute(this.vari, 1));
    return g;
  }
}

const corner = (t: { x: number; z: number }, k: number, rad: number): [number, number] => {
  const a = ((60 * k - 30) * Math.PI) / 180;
  return [t.x + rad * Math.cos(a), t.z + rad * Math.sin(a)];
};
const edgeDir = (k: number): [number, number] => [Math.cos((60 * k * Math.PI) / 180), Math.sin((60 * k * Math.PI) / 180)];

/* ------------------------------------------------------------------------------------------------- the board */
export function buildHexBoard(plan: SceneryPlan, seed: string, variant: HexVariant): HexBoard {
  const rnd = seeded(`${seed}|hex|${plan.kind}|${plan.biome}|${plan.landSide}`);
  const glass = variant === "hex-glass";
  const s = glass ? 0.086 : 0.086;
  const N = 5;
  const iceLand = plan.kind === "ice" || ((plan.kind === "coast" || plan.kind === "island") && plan.landSide === "ice");
  const style: Style = iceLand ? "ice" : plan.biome;
  const pal = PAL[style];
  const [pa, pb, pc] = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];

  /* ---- tile set: a hex-edged blob (the outline is never a circle) */
  const index = new Map<number, HexTile>();
  const tiles: HexTile[] = [];
  const reach = N * SQ3 * s;
  for (let q = -N; q <= N; q++) {
    for (let r = -N; r <= N; r++) {
      if (Math.abs(q + r) > N) continue;
      const x = s * SQ3 * (q + r / 2), z = s * 1.5 * r;
      const th = Math.atan2(z, x);
      const bound = 0.93 + 0.07 * (0.5 * Math.sin(3 * th + pa) + 0.3 * Math.sin(5 * th + pb) + 0.2 * Math.sin(8 * th + pc));
      if (Math.hypot(x, z) > reach * bound) continue;
      const t: HexTile = { q, r, x, z, kind: "land", top: 0.05, depth: 0, nb: [], color: new THREE.Color(), ph: rnd() };
      index.set(key(q, r), t);
      tiles.push(t);
    }
  }
  const link = () => { for (const t of tiles) t.nb = DIRS.map(([dq, dr]) => index.get(key(t.q + dq, t.r + dr)) ?? null); };
  link();
  const isBoundary = (t: HexTile) => t.nb.some((n) => !n);
  const nearest = (x: number, z: number) => tiles.reduce((b, t) => (Math.hypot(t.x - x, t.z - z) < Math.hypot(b.x - x, b.z - z) ? t : b), tiles[0]);
  const setWaterByKey = (keyOf: (t: HexTile) => number, frac: number) => {
    const sorted = [...tiles].sort((a, b) => keyOf(b) - keyOf(a));
    const n = Math.round(sorted.length * frac);
    for (let i = 0; i < n; i++) sorted[i].kind = "water";
  };
  const wob = (th: number) => 0.5 * Math.sin(3 * th + pa) + 0.3 * Math.sin(5 * th + pb + 1) + 0.2 * Math.sin(8 * th + pc);

  let islet = false;
  let isletCentre: HexTile | null = null;
  if (plan.kind === "sea") {
    for (const t of tiles) t.kind = "water";
    if (plan.islet) {
      islet = true;
      const c = nearest(-0.2, -0.16);
      c.kind = "land";
      isletCentre = c;
      const n = 2 + Math.round(4 * Math.min(1, (plan.share.land + plan.share.ice) * 4));
      const around = c.nb.filter((x): x is HexTile => !!x).sort(() => rnd() - 0.5).slice(0, n);
      for (const t of around) t.kind = "beach";
    }
  } else if (plan.kind === "island") {
    // sea around about two thirds of the board's circumference; land reaches the edge along the remaining third (a wedge toward the camera)
    setWaterByKey((t) => Math.hypot(t.x, t.z) / (1 + 0.15 * wob(Math.atan2(t.z, t.x))), 0.45);
    const phi0 = -0.45 + (rnd() - 0.5) * 0.3; // from +z toward -x: front left, where the strata are seen
    const wedge = (t: HexTile) => {
      const a = Math.atan2(t.x, t.z) - phi0;
      const d = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      return d < (Math.PI / 3) * (1 + 0.16 * wob(Math.atan2(t.z, t.x) * 2));
    };
    for (const t of tiles) {
      if (wedge(t) && Math.hypot(t.x, t.z) > 0) t.kind = "land";
      else if (isBoundary(t)) t.kind = "water";
    }
  } else if (plan.kind === "coast") {
    const amp = 0.1, phs = rnd() * 6.28;
    const shore = (z: number) => amp * (0.75 * Math.sin(z * 3.2 + phs) + 0.4 * Math.sin(z * 7.7 + phs * 1.9 + 1) + 0.2 * Math.sin(z * 16.1 + phs * 2.7 + 2));
    setWaterByKey((t) => t.x - shore(t.z), 0.5); // half land, half sea, sea on the +x side
  }
  // keep one connected landmass (plus the islet): stray land specks become sea
  if (plan.kind === "island" || plan.kind === "coast") {
    const seen = new Set<HexTile>();
    let best: HexTile[] = [];
    for (const t of tiles) {
      if (t.kind === "water" || seen.has(t)) continue;
      const comp: HexTile[] = [], stack = [t];
      seen.add(t);
      while (stack.length) { const u = stack.pop()!; comp.push(u); for (const n of u.nb) if (n && n.kind !== "water" && !seen.has(n)) { seen.add(n); stack.push(n); } }
      if (comp.length > best.length) best = comp;
    }
    const keep = new Set(best);
    for (const t of tiles) if (t.kind !== "water" && !keep.has(t)) t.kind = "water";
  }
  if (iceLand) for (const t of tiles) if (t.kind !== "water") t.kind = "ice";
  const hasWater = tiles.some((t) => t.kind === "water");
  const dist = (src: (t: HexTile) => boolean, out: Map<HexTile, number>) => {
    const q: HexTile[] = [];
    for (const t of tiles) if (src(t)) { out.set(t, 0); q.push(t); }
    for (let i = 0; i < q.length; i++) for (const n of q[i].nb) if (n && !out.has(n)) { out.set(n, out.get(q[i])! + 1); q.push(n); }
  };
  const toWater = new Map<HexTile, number>(), toLand = new Map<HexTile, number>(), toEdge = new Map<HexTile, number>();
  dist((t) => t.kind === "water", toWater);
  dist((t) => t.kind !== "water", toLand);
  dist(isBoundary, toEdge);
  // beach: land tiles that touch water (ice keeps its kind and just sits lower); the islet's middle tile stays grass
  for (const t of tiles) {
    if (t.kind === "water") continue;
    if (t.nb.some((n) => n && n.kind === "water")) { t.shore = true; if (t.kind === "land") t.kind = "beach"; }
  }
  if (isletCentre) isletCentre.kind = "land";
  const landTiles = tiles.filter((t) => t.kind !== "water");
  const waterTiles = tiles.filter((t) => t.kind === "water");

  /* ---- hill, cloud */
  const inner = landTiles.filter((t) => t.kind !== "beach");
  const pool = (inner.length ? inner : landTiles).slice();
  const dEdge = (t: HexTile) => Math.min(toWater.get(t) ?? 9, toEdge.get(t) ?? 9);
  const score = new Map(pool.map((t) => [t, dEdge(t) * 0.55 - t.z * 2.2 + rnd() * 0.5]));
  pool.sort((a, b) => score.get(b)! - score.get(a)!);
  const hillT = pool[Math.min(pool.length - 1, Math.floor(rnd() * 3))] ?? tiles[0];
  const hill = { x: hillT.x, z: hillT.z };
  const cands = landTiles.filter((t) => t !== hillT && Math.hypot(t.x - hill.x, t.z - hill.z) > 0.26 && Math.hypot(t.x - hill.x, t.z - hill.z) < 0.55 && t.z < 0.35 && t.z > -0.3);
  const ct = cands.length ? cands[Math.floor(rnd() * cands.length)] : null;
  const cloud = { x: ct ? ct.x : hill.x + 0.3, y: 0.52, z: ct ? ct.z : hill.z + 0.1 };
  if (plan.kind === "sea" && !islet) { cloud.x = 0.1; cloud.z = 0; }

  /* ---- heights and colours: one flat colour per biome class (position noise only), so equal neighbours merge into one surface */
  const H = makeHeight(style, rnd, hill, cloud);
  const q = (v: number, st: number) => Math.round(v / st) * st;
  const hasStrata = !iceLand && plan.kind !== "sea";
  const snowy = style !== "ice" && (plan.kind !== "sea" || (islet && plan.snow >= SNOW_ISLET_MIN)) ? plan.snow : 0;
  for (const t of tiles) {
    if (t.kind === "water") {
      const dl = toLand.get(t) ?? 9;
      t.depth = islet || plan.kind !== "sea" ? Math.min(1, Math.max(0, (dl - 1) / 3)) : 1;
      t.top = -0.045 - 0.04 * t.depth;
      continue;
    }
    const hh = q(0.55 * H(t.x, t.z), 0.03);
    if (t.kind === "beach") t.top = 0.022;
    else if (t.shore && iceLand) t.top = 0.03;
    else if (plan.kind === "sea") t.top = 0.075; // an islet is a low mound, not a tower
    else t.top = Math.min(0.24, 0.05 + hh + (t === hillT ? 0.03 : 0));
    if (t.kind === "beach") t.color.set(SAND[0]);
    else {
      const high = t.top > 0.05 + (style === "alpine" ? 0.1 : 0.06);
      t.color.set((high ? pal.high : pal.ground)[0]);
      if (snowy >= 0.12 && rnd() < Math.min(0.95, snowy * (high ? 1.6 : 0.5))) t.color.set(SNOWY[0]);
    }
  }
  const posNoise = (x: number, z: number) => 0.5 * Math.sin(x * 11 + 1.7 * Math.sin(z * 7 + pa)) + 0.5 * Math.sin(z * 13 - x * 6 + pb);
  const shade = (c: THREE.Color, x: number, z: number) => c.clone().offsetHSL(0, 0, 0.035 * posNoise(x, z));
  // smooth water depth (land counts as 0): a function of position, so the sea floor and the water have no tile pattern
  const depthAt = (x: number, z: number) => {
    let sw = 0, sd = 0;
    for (const t of tiles) {
      const w = 1.9 * s - Math.hypot(t.x - x, t.z - z);
      if (w > 0) { sw += w; sd += w * (t.kind === "water" ? t.depth : 0); }
    }
    return sw > 0 ? sd / sw : 0;
  };
  const floorY = (x: number, z: number) => GROUND_Y - 0.045 - 0.04 * depthAt(x, z);
  const floorColor = (x: number, z: number) => new THREE.Color(WATER_SHALLOW).lerp(new THREE.Color(WATER_FLOOR_DEEP), depthAt(x, z)).offsetHSL(0, 0, 0.012 * posNoise(x, z));

  /* ---- tops and the steps between tiles (toon mesh): no bevels, no grooves */
  const top = new Soup(), sides = new Soup(), water = new Soup();
  const Y0 = HEX_SOIL.rootY - 0.17;
  const yBottom = Y0 - (glass ? 0.42 : 0.62); // sky island: a short, quickly tapering rock body (user: "underside too bulky")
  const wallTop = GROUND_Y - 0.1; // below this the outside wall stops following the hex edges
  const Ytop = (t: HexTile) => GROUND_Y + t.top;
  const sideKind = (t: HexTile) => (t.kind === "water" ? 2 : t.kind === "ice" ? 1 : 0);
  const brownC = new THREE.Color(STEP_BROWN), iceStep = new THREE.Color("#9ec8e4");
  const stepColor = (t: HexTile) => {
    const c = t.color.clone();
    if (t.kind === "land") c.lerp(brownC, 0.5); else if (t.kind === "ice") c.lerp(iceStep, 0.5); else c.multiplyScalar(0.86);
    return c.multiplyScalar(0.92);
  };
  type BEdge = { t: HexTile; k: number; a: [number, number]; b: [number, number]; ya: number; yb: number; kind: number };
  const bEdges: BEdge[] = [];
  for (const t of tiles) {
    const y = Ytop(t);
    for (let k = 0; k < 6; k++) {
      const A = corner(t, k, s), B = corner(t, k + 1, s);
      const [dx, dz] = edgeDir(k);
      const n = t.nb[k];
      if (t.kind === "water") {
        const c: V3 = [t.x, floorY(t.x, t.z), t.z];
        const va: V3 = [A[0], floorY(A[0], A[1]), A[1]], vb: V3 = [B[0], floorY(B[0], B[1]), B[1]];
        top.tri(c, va, vb, [0, 1, 0], floorColor(t.x, t.z));
        // per-vertex colours: re-write the three entries just pushed
        const base = top.col.length - 9;
        for (const [i, pt] of [[0, c], [1, va], [2, vb]] as [number, V3][]) { const cc = floorColor(pt[0], pt[2]); top.col[base + i * 3] = cc.r; top.col[base + i * 3 + 1] = cc.g; top.col[base + i * 3 + 2] = cc.b; }
        if (!n) bEdges.push({ t, k, a: A, b: B, ya: va[1], yb: vb[1], kind: 2 });
        continue;
      }
      const c: V3 = [t.x, y, t.z];
      top.tri(c, [A[0], y, A[1]], [B[0], y, B[1]], [0, 1, 0], shade(t.color, t.x, t.z));
      const base = top.col.length - 9;
      for (const [i, pt] of [[1, A], [2, B]] as [number, [number, number]][]) { const cc = shade(t.color, pt[0], pt[1]); top.col[base + i * 3] = cc.r; top.col[base + i * 3 + 1] = cc.g; top.col[base + i * 3 + 2] = cc.b; }
      if (!n) bEdges.push({ t, k, a: A, b: B, ya: y, yb: y, kind: sideKind(t) });
      else if (n.kind === "water") {
        top.quad([A[0], y, A[1]], [B[0], y, B[1]], [B[0], floorY(B[0], B[1]), B[1]], [A[0], floorY(A[0], A[1]), A[1]], [dx, 0, dz], stepColor(t));
      } else if (Ytop(n) < y - 1e-4) {
        top.quad([A[0], y, A[1]], [B[0], y, B[1]], [B[0], Ytop(n), B[1]], [A[0], Ytop(n), A[1]], [dx, 0, dz], stepColor(t));
      }
    }
  }

  /* ---- water surface (transparent) + the side faces of the water body */
  if (waterTiles.length) {
    for (const t of waterTiles) {
      const c: V3 = [t.x, GROUND_Y, t.z];
      for (let k = 0; k < 6; k++) {
        const [X0, Z0] = corner(t, k, s), [X1, Z1] = corner(t, k + 1, s);
        const n = t.nb[k];
        const foam = n && n.kind !== "water" ? 1 : 0;
        // extra attributes per vertex: foam (0 centre, 1 on an edge that touches land), unused phase, smooth depth, side flag
        const ex = (f: number, x: number, z: number, side = 0) => ({ extra: [f, 0, depthAt(x, z), side] });
        water.tri(c, [X0, GROUND_Y, Z0], [X1, GROUND_Y, Z1], [0, 1, 0], "#ffffff", ex(0, t.x, t.z));
        const base = water.extra.length - 12;
        water.extra[base + 4] = foam; water.extra[base + 8] = foam; // the two corner vertices (the centre keeps 0)
        water.extra[base + 6] = depthAt(X0, Z0); water.extra[base + 10] = depthAt(X1, Z1);
        if (!n) {
          const [dx, dz] = edgeDir(k);
          water.quad([X0, GROUND_Y, Z0], [X1, GROUND_Y, Z1], [X1, floorY(X1, Z1), Z1], [X0, floorY(X0, Z0), Z0], [dx, 0, dz], "#ffffff", ex(0, t.x, t.z, 1));
        }
      }
    }
  }

  /* ---- outside wall and underside: one continuous mass. The hex outline holds only at the top; below the waterline the
          wall eases into a smooth, noise-displaced outline, then tapers into a single rocky body. */
  const ck = (p: [number, number]) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  const starts = new Map<string, BEdge[]>();
  for (const e of bEdges) { const kk = ck(e.a); (starts.get(kk) ?? starts.set(kk, []).get(kk)!).push(e); }
  const smoothAt = new Map<string, [number, number]>(); // corner -> position on the smooth outline
  const used = new Set<BEdge>();
  for (const e0 of bEdges) {
    if (used.has(e0)) continue;
    const loop: BEdge[] = [];
    for (let e: BEdge | undefined = e0; e && !used.has(e); e = starts.get(ck(e.b))?.find((x) => !used.has(x))) { used.add(e); loop.push(e); }
    const n = loop.length, W = 3;
    const pts = loop.map((e) => e.a);
    const rs = pts.map((p) => Math.hypot(p[0], p[1])), th = pts.map((p) => Math.atan2(p[1], p[0]));
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let d = -W; d <= W; d++) sum += rs[(i + d + n * 4) % n];
      const r = (sum / (2 * W + 1)) * (1 + 0.035 * wob(th[i] * 1.3) + 0.02 * Math.sin(th[i] * 11 + pc));
      smoothAt.set(ck(pts[i]), [r * Math.cos(th[i]), r * Math.sin(th[i])]);
    }
  }
  const smoothOf = (p: [number, number]) => smoothAt.get(ck(p)) ?? p;
  const blend = (y: number) => smooth(wallTop, wallTop - 0.12, y);
  const bodyXZ = (p: [number, number], y: number): [number, number] => {
    const S = smoothOf(p), bl = blend(y);
    let x = p[0] + (S[0] - p[0]) * bl, z = p[1] + (S[1] - p[1]) * bl;
    if (y < Y0) {
      const u = Math.min(1, (Y0 - y) / (Y0 - yBottom)), w = smooth(Y0, Y0 - 0.1, y);
      const th = Math.atan2(S[1], S[0]);
      const sc = Math.max(0.02, Math.pow(1 - u, glass ? 0.85 : 1.7) * (1 + 0.14 * Math.sin(th * 2 + y * 5 + pa) + 0.08 * Math.sin(th * 5 - y * 9 + pb)));
      const k = 1 + (sc - 1) * w;
      x = x * k + 0.05 * Math.sin(y * 3.2 + pa) * w * u; z = z * k + 0.05 * Math.cos(y * 2.6 + pb) * w * u;
    }
    return [x, z];
  };
  const levels = [wallTop, wallTop - 0.05, wallTop - 0.12, Y0];
  for (let i = 1; i <= 9; i++) levels.push(Y0 + (yBottom - Y0) * (i / 9));
  const vari = (x: number, y: number, z: number) => 0.5 + 0.5 * Math.sin(x * 13 + y * 9) * Math.cos(z * 11 - y * 5);
  const landEdges: HexBoard["landEdges"] = [];
  bEdges.forEach((e) => {
    const [dx, dz] = edgeDir(e.k);
    const [ax, az] = e.a, [bx, bz] = e.b;
    // the hex-edged part of the wall: from the tile top down to the common level
    sides.quad([ax, e.ya, az], [bx, e.yb, bz], [bx, wallTop, bz], [ax, wallTop, az], [dx, 0, dz], "#ffffff", { kind: e.kind, top: Math.max(e.ya, e.yb), vari: vari(ax, wallTop, az) });
    for (let i = 0; i + 1 < levels.length; i++) {
      const y0 = levels[i], y1 = levels[i + 1];
      const a0 = bodyXZ(e.a, y0), b0 = bodyXZ(e.b, y0), a1 = bodyXZ(e.a, y1), b1 = bodyXZ(e.b, y1);
      const kind = y1 < Y0 - 1e-6 ? 3 : e.kind;
      sides.quad([a0[0], y0, a0[1]], [b0[0], y0, b0[1]], [b1[0], y1, b1[1]], [a1[0], y1, a1[1]], [(a0[0] + b0[0]) / 2, 0, (a0[1] + b0[1]) / 2], "#ffffff", { kind, top: Math.max(e.ya, e.yb), vari: vari(a1[0], y1, a1[1]) });
    }
    const lb = levels[levels.length - 1], pa0 = bodyXZ(e.a, lb), pb0 = bodyXZ(e.b, lb);
    sides.tri([pa0[0], lb, pa0[1]], [pb0[0], lb, pb0[1]], [0, lb - 0.02, 0], [0, -1, 0], "#ffffff", { kind: 3, vari: 0.5 });
    if (e.kind !== 2) landEdges.push({ a: e.a, b: e.b, ya: e.ya, nx: dx, nz: dz });
  });
  const wallPoint = (i: number, f: number, y: number): [number, number, number, number] => {
    const e = landEdges[i % landEdges.length];
    const pa0 = bodyXZ(e.a, y), pb0 = bodyXZ(e.b, y);
    const x = pa0[0] + (pb0[0] - pa0[0]) * f, z = pa0[1] + (pb0[1] - pa0[1]) * f;
    const l = Math.hypot(x, z) || 1;
    return [x, z, x / l, z / l];
  };

  /* ---- props on tiles (toy props, deterministic) */
  const b = new Builder();
  const small: Kind[] = ["bush", "rock", "tuft", "flower", "iceChunk"];
  const weights = PLAN[style];
  const total = weights.reduce((a, [, w]) => a + w, 0);
  const tall = new Set<Kind>(["round", "bigRound", "conifer", "acacia", "cactus", "mesa", "boulder", "iceBlock", "iceShard"]);
  const peaksSrc = [...landTiles].sort((a, b2) => b2.top - a.top);
  const peakTiles = new Set<HexTile>(peaksSrc.slice(0, 3));
  const capAllowed = snowCapAllowed(plan, islet);
  for (const t of landTiles) {
    const y = Ytop(t) - 0.006;
    const ox = (rnd() - 0.5) * s * 0.7, oz = (rnd() - 0.5) * s * 0.7;
    const front = t.z > 0.12 || (plan.kind !== "sea" && t.nb.some((n) => n && n.kind === "water") && t.z > -0.05);
    if (peakTiles.has(t) && capAllowed) continue; // the snow cap sits here
    if (t.kind === "beach") {
      if (style !== "taiga" && style !== "alpine" && style !== "ice" && rnd() < (front ? 0.14 : 0.3)) addPalm(b, t.x + ox * 0.5, y, t.z + oz * 0.5, rnd);
      else if (rnd() < 0.22) addProp(b, "rock", t.x + ox, y, t.z + oz, pal, rnd);
      continue;
    }
    if (rnd() > (style === "desert" ? 0.5 : 0.66)) continue;
    let pickK: Kind = weights[0][0];
    let u = rnd() * total;
    for (const [k, w] of weights) { u -= w; if (u <= 0) { pickK = k; break; } }
    if (pickK === "mesa" && (t.z > -0.1 || rnd() > 0.5)) pickK = "boulder";
    if (tall.has(pickK) && front) pickK = style === "ice" ? "iceChunk" : small[Math.floor(rnd() * 4)];
    addProp(b, pickK, t.x + ox, y, t.z + oz, pal, rnd);
  }

  /* ---- snow caps: the highest land tiles (sizes follow SWE in the scene) */
  const peaks: SnowPeak[] = capAllowed
    ? peaksSrc.slice(0, 3).map((t, i) => ({ x: t.x, y: Ytop(t), z: t.z, r: s * 0.98, h: [0.2, 0.15, 0.12][i], from: [0, 0.22, 0.45][i] }))
    : [];

  /* ---- sky-island extras: dangling roots and a few small floating rocks */
  let extras: THREE.BufferGeometry | null = null;
  if (!glass) {
    const e2 = new Builder();
    // roots hang from the flank of the rock body (it narrows downward, so they dangle free)
    const loopEdges = bEdges.filter((e) => e.kind !== 2);
    for (let i = 0; i < 5 && loopEdges.length; i++) {
      const e = loopEdges[Math.floor(rnd() * loopEdges.length)];
      const yr = Y0 - 0.12 - rnd() * 0.42 * (Y0 - yBottom);
      const [px, pz] = bodyXZ(e.a, yr);
      let x = px, z = pz, yy = yr + 0.01;
      const segs = 3 + Math.floor(rnd() * 2), col = pick(rnd, ROOT_TONES);
      let rad = 0.014 + rnd() * 0.01;
      for (let sgi = 0; sgi < segs; sgi++) {
        const len = 0.07 + rnd() * 0.05, lean = (rnd() - 0.5) * 0.5;
        e2.add(new THREE.CylinderGeometry(rad, rad * 0.7, len, 5), col, [x, yy - len / 2, z], [1, 1, 1], [lean, 0, lean * 0.6]);
        x += Math.sin(lean) * len * 0.5; z += Math.sin(lean * 0.6) * len * 0.5; yy -= len * 0.95; rad *= 0.7;
      }
    }
    const nBits = 6;
    for (let i = 0; i < nBits; i++) {
      const a = (i / nBits) * Math.PI * 2 + rnd() * 0.8, rr = 0.88 + rnd() * 0.3, yy = -0.35 - rnd() * 0.8;
      const sz = 0.03 + rnd() * 0.04;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      e2.add(new THREE.DodecahedronGeometry(sz, 0), pick(rnd, ROCK_TONES), [x, yy, z], [1, 0.8, 0.95], [rnd(), rnd() * 6, 0]);
      if (rnd() < 0.5) e2.add(new THREE.CylinderGeometry(sz * 0.8, sz * 0.85, sz * 0.4, 6), pick(rnd, pal.ground), [x, yy + sz * 0.78, z], [1, 1, 1], [0, rnd(), 0]);
    }
    extras = e2.build();
  }

  /* ---- anchors, label spot */
  let labelEdge = 0, bs = -99;
  landEdges.forEach((e, i) => {
    const mx = (e.a[0] + e.b[0]) / 2, mz = (e.a[1] + e.b[1]) / 2;
    if (mz < 0.05) return;
    const sc = -mx + 0.6 * mz + (rnd() - 0.5) * 0.05;
    if (sc > bs) { bs = sc; labelEdge = i; }
  });
  const nearWater = landTiles.filter((t) => t.nb.some((n) => n && n.kind === "water"));
  const runT = (nearWater.length ? nearWater : landTiles)[0] ?? tiles[0];
  const puffT = landTiles.find((t) => t !== hillT && t.z > -0.1) ?? hillT;

  const layout: Layout = {
    plan, style, hill, cloud, coast: null, isle: null, seaMode: hasWater ? 2 : 0,
    height: () => 0,
    inland: () => 1,
    snow: { rMax: s, hMax: 0.2 },
    soilCap: hasStrata, iceCap: iceLand,
  };
  layout.height = (x, z) => tileAt(index, s, x, z)?.top ?? -0.1;

  return {
    variant, s, tiles, landTiles, waterTiles, layout, hasStrata, islet,
    top: top.geometry(false), sides: sides.geometry(true),
    water: waterTiles.length ? waterGeometry(water) : null,
    props: b.build(), leaves: b.buildLeaves(), extras, peaks, landEdges, wallPoint, labelEdge,
    anchors: { run: [runT.x, runT.z], puff: [puffT.x, puffT.z] },
    y0: Y0, yBottom, radius: reach + s,
  };
}

function waterGeometry(w: Soup): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(w.pos, 3));
  const n = w.pos.length / 3;
  const foam = new Float32Array(n), ph = new Float32Array(n), depth = new Float32Array(n), side = new Float32Array(n);
  for (let i = 0; i < n; i++) { foam[i] = w.extra[i * 4]; ph[i] = w.extra[i * 4 + 1]; depth[i] = w.extra[i * 4 + 2]; side[i] = w.extra[i * 4 + 3]; }
  g.setAttribute("aFoam", new THREE.BufferAttribute(foam, 1));
  g.setAttribute("aPh", new THREE.BufferAttribute(ph, 1));
  g.setAttribute("aDepth", new THREE.BufferAttribute(depth, 1));
  g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  return g;
}

/** a beach palm: leaning trunk and a crown of drooping fronds */
function addPalm(b: Builder, x: number, y: number, z: number, rnd: () => number) {
  const lean = (rnd() - 0.5) * 0.5, ry = rnd() * 6.28, s = 0.9 + rnd() * 0.3;
  const trunk = "#9a6b43";
  let tx = x, ty = y;
  for (let i = 0; i < 3; i++) {
    const len = 0.045 * s;
    b.add(new THREE.CylinderGeometry(0.009, 0.012, len, 5), trunk, [tx + Math.sin(lean) * len * 0.5, ty + len * 0.5, z], [1, 1, 1], [0, 0, -lean]);
    tx += Math.sin(lean) * len; ty += Math.cos(lean) * len;
  }
  for (let i = 0; i < 6; i++) {
    const a = ry + (i / 6) * Math.PI * 2;
    b.add(new THREE.ConeGeometry(0.014, 0.1 * s, 4), i % 2 ? "#3f9d4a" : "#58b24f", [tx + Math.cos(a) * 0.035, ty - 0.004, z + Math.sin(a) * 0.035], [1, 1, 0.35], [Math.sin(a) * 1.25, a, -Math.cos(a) * 1.25], { pivot: [tx, ty - 0.004, z], kind: 2 });
  }
  b.add(new THREE.IcosahedronGeometry(0.009, 0), "#6b4a32", [tx, ty - 0.012, z + 0.008]);
}

/* ------------------------------------------------------------------------------------------------- slots for the scene */
export interface HexSlots {
  /** runoff arrow: start x, z, run dx, dz, phase */
  runoff: { x: number; z: number; dx: number; dz: number }[];
  /** vapour wisp: x, z, ground y */
  puffs: { x: number; z: number; y: number }[];
  /** soil beads on the outside faces: x, z, outward normal */
  beads: { edge: number; f: number }[];
}

const GOLD = 0.6180339887;
export function hexSlots(board: HexBoard, cloud: { x: number; z: number }, nRun: number, nPuff: number, nBead: number, rnd: () => number): HexSlots {
  const land = board.landTiles;
  const out: HexSlots = { runoff: [], puffs: [], beads: [] };
  if (land.length) {
    const order = [...land].sort(() => rnd() - 0.5);
    // targets: the water tiles, or (no water) the outer edge of the board
    const targets: [number, number][] = board.waterTiles.length
      ? board.waterTiles.map((t) => [t.x, t.z])
      : board.landEdges.map((e) => [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2] as [number, number]);
    const w = board.waterTiles.length > 0;
    const sources = order;
    for (let i = 0; i < nRun; i++) {
      const t = sources[i % sources.length];
      const x = t.x + (rnd() - 0.5) * board.s * 0.8, z = t.z + (rnd() - 0.5) * board.s * 0.8;
      let bd = 1e9, tx = 0, tz = 0;
      for (const [px, pz] of targets) { const d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; tx = px; tz = pz; } }
      const len = Math.min(0.85, Math.max(0.16, bd - (w ? board.s * 0.5 : 0)));
      const ux = bd > 1e-4 ? (tx - x) / bd : 0, uz = bd > 1e-4 ? (tz - z) / bd : 1;
      out.runoff.push({ x, z, dx: ux * len, dz: uz * len });
    }
    for (let i = 0; i < nPuff; i++) {
      let t = land[Math.floor(rnd() * land.length)], g = 0;
      while (g++ < 8 && Math.hypot(t.x - cloud.x, t.z - cloud.z) < 0.14) t = land[Math.floor(rnd() * land.length)];
      out.puffs.push({ x: t.x + (rnd() - 0.5) * board.s * 1.2, z: t.z + (rnd() - 0.5) * board.s * 1.2, y: GROUND_Y + t.top });
    }
  }
  const E = board.landEdges;
  if (E.length) for (let i = 0; i < nBead; i++) {
    const u = ((i * GOLD + rnd() * 0.02) % 1) * E.length;
    out.beads.push({ edge: Math.floor(u) % E.length, f: u - Math.floor(u) });
  }
  return out;
}

