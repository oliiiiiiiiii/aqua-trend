// Small pure helpers for the Explore workspace.
import type { Region, RegionSeries, VarId } from "@/lib/types";
import type { OrbClimate } from "@/lib/contracts";
import { MAX_TARGETS, TARGET_VARS, VAR_ORDER, type VarKind } from "@/lib/variables";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2015-07" -> "July 2015" (fixed English names: no locale-dependent output) */
export function formatMonth(ym: string | undefined, short = false): string {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const names = short ? MONTH_SHORT : MONTH_NAMES;
  return `${names[Number(m) - 1] ?? m} ${y}`;
}

export function formatArea(km2: number): string {
  if (km2 >= 1e6) return `${(km2 / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} million km²`;
  return `${Math.round(km2).toLocaleString("en-US", { maximumSignificantDigits: 3 })} km²`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export const KIND_WORDS: Record<VarKind, string> = {
  "flux-down": "flux in, from the air",
  "flux-up": "flux out, to the air",
  "flux-lateral": "flux out, sideways",
  net: "net flux",
  stock: "stock",
  temperature: "temperature",
};

/** mean of the finite values, NaN when there are none */
export function nanMean(a: Float32Array): number {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i]; if (Number.isFinite(x)) { s += x; n++; } }
  return n ? s / n : NaN;
}

export function climateOf(series: RegionSeries): OrbClimate {
  return {
    precip: nanMean(series.values.precip),
    et: nanMean(series.values.et),
    swe: nanMean(series.values.swe),
    tair: nanMean(series.values.tair),
    precipClim: monthlyClim(series, "precip"),
    tairClim: monthlyClim(series, "tair"),
  };
}

/** mean of each calendar month over all years, NaN skipped (index 0 = January) */
function monthlyClim(series: RegionSeries, v: VarId): number[] {
  const sum = new Array(12).fill(0), n = new Array(12).fill(0);
  const a = series.values[v];
  if (!a) return [];
  series.months.forEach((ym, i) => {
    const x = a[i];
    if (x == null || Number.isNaN(x)) return;
    const m = Number(ym.slice(5, 7)) - 1;
    sum[m] += x; n[m] += 1;
  });
  return sum.map((s, m) => (n[m] ? s / n[m] : NaN));
}

export function valuesAt(series: RegionSeries, i: number): Partial<Record<VarId, number | null>> {
  const out: Partial<Record<VarId, number | null>> = {};
  for (const v of VAR_ORDER) {
    const x = series.values[v]?.[i];
    out[v] = x == null || Number.isNaN(x) ? null : x;
  }
  return out;
}

export interface Suggestion { targets: VarId[]; reason: string }

/** A sensible starting trio from the region's long-term climate. The user can change it. */
export function suggestTargets(climate: OrbClimate | null): Suggestion {
  if (!climate || !Number.isFinite(climate.precip)) {
    return { targets: ["precip", "et", "root_zone"], reason: "A general starting set: water in, water out, and the soil that buffers them." };
  }
  if (climate.swe >= 10 || (Number.isFinite(climate.tair) && climate.tair < 5)) {
    return { targets: ["precip", "swe", "runoff"], reason: "Snow matters here, so the set follows water from precipitation into the snowpack and out as runoff." };
  }
  if (climate.precip < 1.5) {
    return { targets: ["precip", "et", "soil_top"], reason: "A dry region: little rain arrives and most of it goes back to the air, so the set tracks rain, ET and the thin topsoil layer that reacts first." };
  }
  return { targets: ["precip", "et", "root_zone"], reason: "Water in, water out, and the root-zone soil that buffers them." };
}

/** keep known targets only, in catalogue order, at most MAX_TARGETS */
export function cleanTargets(raw: string | null | undefined): VarId[] | null {
  if (!raw) return null;
  const want = new Set(raw.split(",").map((s) => s.trim()));
  const out = TARGET_VARS.filter((v) => want.has(v)).slice(0, MAX_TARGETS);
  return out.length ? out : null;
}

/** `text` is the full sentence; `short` is a few words for compact layouts */
export interface RegionWarning { id: string; text: string; short: string }

export function regionWarnings(r: Region): RegionWarning[] {
  const w: RegionWarning[] = [];
  if (!r.cells) {
    w.push({ id: "nodata", short: "No land-model data here", text: "No GLDAS land-model cells fall inside this boundary, so there is no regional series." });
  }
  if (r.fallback) {
    w.push({ id: "fallback", short: "Smaller than a grid cell: shows its 1° cell", text: "This region is smaller than the 1° grid. The series shows the 1° cell that contains it, not the region itself." });
  }
  if (r.cells && (r.cellEquiv ?? r.cells) < 4) {
    w.push({ id: "few", short: "Under four cells: indicative only", text: `Fewer than four full grid cells feed this series (${fmtEquiv(r.cellEquiv ?? r.cells)} cell-equivalents). Treat results as indicative only.` });
  }
  if (r.landFrac != null && r.landFrac < 0.8) {
    w.push({ id: "mixed", short: `Only ${Math.round(r.landFrac * 100)} % land or ice: series covers the land part`, text: `Only ${Math.round(r.landFrac * 100)} % of this boundary is land or ice. Only the land part has land-model data, so the series describes that part.` });
  }
  if (r.type === "named" && r.id !== "named-taiwan-main-island") {
    w.push({ id: "rect", short: "Rectangular study window", text: "A rectangular study window, not a natural boundary. Results describe the rectangle." });
  }
  if (r.type === "hex") {
    w.push({ id: "hex", short: "Hexagon of an even grid, not a natural boundary", text: "A hexagon of the global H3 grid: an even-sized sampling cell, not a natural boundary." });
  }
  return w;
}

export function fmtEquiv(x: number): string {
  return x.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** great-circle distance in km between two [lon, lat] points */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad, dLon = (b[0] - a[0]) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/* ---------------------------------------------------------------- search */

const TYPE_RANK: Record<Region["type"], number> = { named: 0, basin3: 1, basin4: 2, ice: 3, lme: 4, sea: 5, hex: 6 };

export interface SearchIndex { regions: Region[]; hay: string[] }

export function buildIndex(regions: Region[]): SearchIndex {
  return {
    regions,
    hay: regions.map((r) => `${r.name} ${r.id} ${(r.iso ?? []).join(" ")}`.toLowerCase()),
  };
}

/** in-memory ranked search over the whole catalogue */
export function searchRegions(index: SearchIndex, query: string, limit = 30): Region[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const scored: { r: Region; s: number }[] = [];
  for (let i = 0; i < index.regions.length; i++) {
    const h = index.hay[i];
    if (!terms.every((t) => h.includes(t))) continue;
    const r = index.regions[i];
    const name = r.name.toLowerCase();
    let s = 0;
    if (r.id.toLowerCase() === q) s += 1000;
    if (name === q) s += 500;
    if (name.startsWith(q)) s += 200;
    else if (name.includes(` ${terms[0]}`) || name.startsWith(terms[0])) s += 80;
    if (r.iso?.some((c) => c.toLowerCase() === q)) s += 60;
    s -= TYPE_RANK[r.type] * 12;
    s += Math.min(20, Math.log10(Math.max(1, r.areaKm2)) * 2);
    scored.push({ r, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.r);
}

export function countMatches(index: SearchIndex, query: string): number {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  let n = 0;
  for (const h of index.hay) if (terms.every((t) => h.includes(t))) n++;
  return n;
}

/* ------------------------------------------------------------ playback window */

/** years from..to (inclusive) and a within-year season startMonth..endMonth (1-12; startMonth > endMonth wraps into the next year) */
export interface PlayWindow { from: number; to: number; startMonth: number; endMonth: number }

export const SEASON_DEFAULT = "1-12";

/** "9-11" -> [9, 11]; anything else -> null */
export function parseSeason(raw: string | null | undefined): [number, number] | null {
  const m = raw?.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  return a >= 1 && a <= 12 && b >= 1 && b <= 12 ? [a, b] : null;
}

/** how many calendar months the season covers (1-12) */
export const seasonLength = (startMonth: number, endMonth: number) => ((endMonth - startMonth + 12) % 12) + 1;

/** "Sep to Nov" style label */
export function seasonLabel(startMonth: number, endMonth: number): string {
  if (startMonth === 1 && endMonth === 12) return "the whole year";
  return `${MONTH_NAMES[startMonth - 1]} to ${MONTH_NAMES[endMonth - 1]}`;
}

/** ascending indices into `months` that fall inside the window; months missing from the series are skipped */
export function windowIndices(months: string[], w: PlayWindow): number[] {
  const pos = new Map<string, number>();
  months.forEach((m, i) => pos.set(m, i));
  const out: number[] = [];
  const add = (y: number, m: number) => {
    const i = pos.get(`${y}-${String(m).padStart(2, "0")}`);
    if (i !== undefined) out.push(i);
  };
  const wrap = w.startMonth > w.endMonth;
  for (let y = w.from; y <= w.to; y++) {
    if (!wrap) for (let m = w.startMonth; m <= w.endMonth; m++) add(y, m);
    else {
      for (let m = w.startMonth; m <= 12; m++) add(y, m);
      for (let m = 1; m <= w.endMonth; m++) add(y + 1, m);
    }
  }
  return out;
}

/** first index in the ascending `seq` after `i` (null if none) */
export function nextIn(seq: number[], i: number): number | null {
  for (const x of seq) if (x > i) return x;
  return null;
}
/** last index in `seq` before `i` (null if none) */
export function prevIn(seq: number[], i: number): number | null {
  for (let k = seq.length - 1; k >= 0; k--) if (seq[k] < i) return seq[k];
  return null;
}

/** the same calendar month as `month` ("YYYY-MM") in `year`, as "YYYY-MM" */
export const sameMonthIn = (month: string, year: number) => `${year}-${month.slice(5, 7)}`;
