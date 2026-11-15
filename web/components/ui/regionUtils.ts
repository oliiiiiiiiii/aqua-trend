// Small pure helpers shared by the detective page: formatting, climate summary, region search.
import type { Region, RegionSeries, VarId } from "@/lib/types";
import type { OrbClimate } from "@/lib/contracts";
import { VAR_ORDER, type VarKind } from "@/lib/variables";

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
