// Browser-side loaders for the bundle built by scripts/prep-data.mjs (public/data/gen).
// Everything is cached per session. Owned by the PM.
import type { Catalog, LayerId, Region, RegionSeries, TrendGrid, VarId } from "./types";

const BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/data`;
export const RASTER = { w: 1440, h: 720, px: 0.25 } as const;
export const LAYERS: LayerId[] = ["basin3", "basin4", "hex", "lme", "sea", "ice"];

const cache = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = make().catch((e) => { cache.delete(key); throw e; });
    cache.set(key, p);
  }
  return p;
}
async function bytes(path: string): Promise<ArrayBuffer> {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.arrayBuffer();
}

interface RawRegion {
  id: string; t: Region["type"]; n: string; s: Region["surface"]; a: number; c: [number, number];
  b?: [number, number, number, number]; iso?: string[]; p?: string; pf?: number; g?: number; lf?: number;
  k?: number; ke?: number; fb?: 1; sf?: [number, number, number]; sn?: number; cs?: number;
}

export function loadCatalog(): Promise<Catalog> {
  return once("catalog", async () => {
    const res = await fetch(`${BASE}/gen/catalog.json`);
    if (!res.ok) throw new Error(`Could not load the region catalogue (${res.status}). Run "npm run prep".`);
    const raw = await res.json();
    const regions: Region[] = (raw.regions as RawRegion[]).map((r) => ({
      id: r.id, type: r.t, name: r.n, surface: r.s, areaKm2: r.a, centroid: r.c, bbox: r.b, iso: r.iso,
      parent: r.p, pfaf: r.pf, gridIndex: r.g, landFrac: r.lf, cells: r.k, cellEquiv: r.ke, fallback: r.fb === 1,
      surfaceFrac: r.sf ? { land: r.sf[0], ocean: r.sf[1], ice: r.sf[2] } : undefined, snowFrac: r.sn, coastShare: r.cs,
    }));
    const byId = new Map(regions.map((r) => [r.id, r]));
    const byGrid = Object.fromEntries(LAYERS.map((l) => [l, [] as (Region | undefined)[]])) as Catalog["byGrid"];
    for (const r of regions) if (r.gridIndex && r.type !== "named") byGrid[r.type][r.gridIndex] = r;
    return { dataset: raw.dataset, grid: raw.grid, months: raw.months, vars: raw.vars, raster: raw.raster, regions, byId, byGrid };
  });
}

/** 1440 x 720 region-id raster (row 0 = north edge, col 0 = 180°W). 0 = no region of this layer. */
export function loadGrid(layer: LayerId): Promise<Uint16Array> {
  return once(`grid:${layer}`, async () => {
    const runs = new Uint16Array(await bytes(`gen/grid_${layer}.rle`));
    const grid = new Uint16Array(RASTER.w * RASTER.h);
    let o = 0;
    for (let i = 0; i < runs.length; i += 2) { grid.fill(runs[i + 1], o, o + runs[i]); o += runs[i]; }
    return grid;
  });
}

/** 1440 x 720 signed distance to the coast: 128 = shoreline, >128 land, 16 units per 0.25° pixel. */
export const loadLandSdf = () => once("sdf", async () => new Uint8Array(await bytes("gen/land_sdf.u8")));

/** 360 x 180 RGBA bytes: R = mean ET / 3.5 mm/day, G = mean SWE / 120 mm, B = (mean Tair + 30) / 65 °C, A = 255 real, 128 extrapolated, 0 none. */
export const loadClimate = () => once("climate", async () => new Uint8Array(await bytes("gen/climate.u8")));

/** Per-cell Sen slope (per year) and Mann-Kendall p from the packaged 2000-2025 annual means. */
export function loadTrendGrid(v: VarId): Promise<TrendGrid> {
  return once(`trend:${v}`, async () => {
    const f = new Float32Array(await bytes(`gen/trend_${v}.f32`));
    const n = 360 * 180;
    return { sen: f.subarray(0, n), p: f.subarray(n, 2 * n) };
  });
}

/** Regional monthly series for all nine variables, or null when the region has no GLDAS land cells. */
export function loadRegionSeries(region: Region, catalog: Catalog): Promise<RegionSeries | null> {
  if (!region.cells) return Promise.resolve(null);
  return once(`series:${region.id}`, async () => {
    const f = new Float32Array(await bytes(`gen/series/${region.id}.f32`));
    const m = catalog.months.length;
    const values = {} as RegionSeries["values"];
    catalog.vars.forEach((v, i) => { values[v] = f.subarray(i * m, (i + 1) * m); });
    return { regionId: region.id, months: catalog.months, values };
  });
}

export interface NamedFeature {
  id: string;
  /** polygons -> rings -> [lon, lat] */
  polygons: [number, number][][][];
}
export function loadNamedGeo(): Promise<NamedFeature[]> {
  return once("named", async () => {
    const res = await fetch(`${BASE}/geo/named.geojson`);
    const gj = await res.json();
    return gj.features.map((f: { properties: { id: string }; geometry: { type: string; coordinates: never } }) => ({
      id: f.properties.id,
      polygons: f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates,
    }));
  });
}

export function rasterIndex(lon: number, lat: number): number {
  const c = Math.min(RASTER.w - 1, Math.max(0, Math.floor((((lon + 540) % 360) - 0) / RASTER.px)));
  const r = Math.min(RASTER.h - 1, Math.max(0, Math.floor((90 - lat) / RASTER.px)));
  return r * RASTER.w + c;
}

function inRings(x: number, y: number, rings: [number, number][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export interface PickResult {
  lon: number;
  lat: number;
  /** the region that best fits the current zoom; null over open ocean with no layer hit */
  primary: Region | null;
  /** other analysis boundaries that contain the same point - overlapping layers, not independent evidence */
  alternatives: Region[];
}

/**
 * Resolve a point to regions across every layer.
 * Land: basin3 when zoomed out, basin4 when zoom >= 2. Ice sheets win over basins. Ocean: LME, then sea, then hex.
 */
export async function pickRegions(lon: number, lat: number, zoom = 1): Promise<PickResult> {
  const [catalog, named, ...grids] = await Promise.all([loadCatalog(), loadNamedGeo(), ...LAYERS.map(loadGrid)]);
  const i = rasterIndex(lon, lat);
  const hit = {} as Record<LayerId, Region | undefined>;
  LAYERS.forEach((l, k) => { const g = grids[k][i]; hit[l] = g ? catalog.byGrid[l][g] : undefined; });
  const namedHits = named
    .filter((f) => f.polygons.some((rings) => inRings(lon, lat, rings)))
    .map((f) => catalog.byId.get(f.id))
    .filter((r): r is Region => !!r)
    .sort((a, b) => a.areaKm2 - b.areaKm2);
  const order: (Region | undefined)[] = hit.ice
    ? [hit.ice, hit.hex]
    : hit.basin3 || hit.basin4
      ? zoom >= 2
        ? [hit.basin4, hit.basin3, ...namedHits, hit.hex]
        : [hit.basin3, hit.basin4, ...namedHits, hit.hex]
      : [hit.lme, hit.sea, ...namedHits, hit.hex];
  const all = order.filter((r): r is Region => !!r);
  for (const r of [...namedHits, hit.lme, hit.sea, hit.hex]) if (r && !all.includes(r)) all.push(r);
  return { lon, lat, primary: all[0] ?? null, alternatives: all.slice(1) };
}

export const LAYER_LABEL: Record<Region["type"], string> = {
  basin3: "Large river basin",
  basin4: "Sub-basin",
  hex: "H3 hexagon (res 2)",
  named: "Named study window",
  lme: "Large marine ecosystem",
  sea: "Sea region",
  ice: "Ice sheet",
};
