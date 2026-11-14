// SYNTHETIC lead generator for the Aqua Trend demo. Owned by the leads package.
//
// The cross-dataset association engine described in the README does not exist yet. Everything produced here is
// INVENTED, deterministically, from a seed built out of the region id and the sorted targets (no Math.random, no clock).
// The only real inputs are the region's GLDAS series: synthetic candidate series are made by lagging / scaling / adding
// seeded noise to the real target anomalies, so the charts look like this region. Statistics (correlations, effective
// sample size, lag curves, p-values, Benjamini-Yekutieli q-values, split-period and block-bootstrap stability) are then
// REALLY computed from those synthetic series, so every number on screen is internally consistent - but none of it is
// a finding about the region. Candidate product names are real so the UI is realistic; the numbers are not.
import type { Lead, Region, RegionSeries, VarId } from "./types";
import { VARIABLES } from "./variables";

/* ============================================================================================================ types */

export type Scenario = "complete" | "complete-none" | "partial" | "insufficient";
export type Route = "temporal" | "lag" | "spatial" | "grouped";
export type LeadRoute = "temporal" | "lag" | "spatial-static" | "spatial-trend" | "grouped";

export interface DependencyFlag {
  code: "shared-source" | "redundant-quantity" | "vector-component" | "different-definition";
  label: string;
  text: string;
}

export interface CandidateMeta {
  id: string;
  name: string;
  /** short lower-case phrase used inside sentences */
  short: string;
  product: string;
  version: string;
  agency: string;
  domain: string;
  kind: "continuous" | "static" | "categorical";
  /** "YYYY-MM" */
  coverage: { start: string; end: string };
  resolution: string;
  unit: string;
  definition: string;
  /** analysis routes that apply to this kind of variable in principle */
  routes: Route[];
  /** synthetic value scale used to dress the invented series */
  mean: number;
  sd: number;
  decimals: number;
  flags?: Partial<Record<VarId | "*", DependencyFlag>>;
  /** other entry points that map to the same data */
  duplicateOf?: string;
  duplicateNote?: string;
  qualityOnly?: boolean;
  qualityNote?: string;
  /** minimum region area (km2) for the native resolution to resolve it */
  minAreaKm2?: number;
  note?: string;
}

export type OutcomeStatus = "analysed" | "quality-only" | "duplicate" | "not-applicable" | "failed" | "not-run";
export interface CandidateOutcome {
  status: OutcomeStatus;
  /** human reason (not applicable / failed / duplicate / quality) */
  reason?: string;
  duplicateOf?: string;
  routesTested: Route[];
  routesNotTested: { route: Route; reason: string }[];
  tests: number;
  passedCorrection: number;
  leads: number;
}
export interface CandidateRecord extends Omit<CandidateMeta, "flags" | "routes" | "mean" | "sd" | "decimals"> {
  routes: Route[];
  outcome: CandidateOutcome;
}

export interface Ledger {
  discovered: number;
  duplicatesMerged: number;
  identified: number;
  qualityOnly: number;
  fetched: number;
  failed: number;
  notApplicable: number;
  /** de-duplicated science candidates that can be analysed for at least one route in this region (incl. failed ones) */
  eligibleCandidates: number;
  targets: number;
  eligiblePairs: number;
  analysedPairs: number;
  pendingPairs: number;
  /** targets x eligible candidates x applicable routes, pending tests included */
  familySize: number;
  testsAnalysed: number;
  testsPending: number;
  familyFinal: boolean;
  corrected: number;
  passedCorrection: number;
  notSignificant: number;
  leadsRecommended: number;
  leadsUnstable: number;
  routesNotTestable: number;
}

export interface PolicyItem { label: string; value: string }
export interface Interval { r: number; lo: number; hi: number }

export interface LeadDetail extends Lead {
  rank: number;
  /** true while the run is partial: q-values are provisional and there is no final recommendation */
  provisional: boolean;
  title: string;
  route: LeadRoute;
  score: number;
  synthetic: true;
  targetInfo: { label: string; unit: string; definition: string; caveat: string };
  candidateInfo: {
    id: string; version: string; definition: string; unit: string; resolution: string; coverage: string; note?: string;
  };
  routeStatuses: { route: Route; label: string; status: "passed" | "insufficient" | "not-tested"; note: string }[];
  scope: {
    commonPeriod: { start: string; end: string; months: number } | null;
    dataEnd: string;
    rawN: number;
    effN: number;
    unitOfSample: "months" | "cells";
    effNMethod: string;
    resolution: string;
    area: string;
  };
  effect: { kind: "correlation" | "eta"; label: string; value: number; lo: number; hi: number; intervalNote: string };
  stats: { pRaw: number; q: number; familySize: number; pText: string; qText: string; method: string; qProvisional: boolean };
  lag: null | {
    months: number;
    leader: "candidate" | "target" | "same-month";
    supported: [number, number];
    curve: { lag: number; r: number }[];
    peaks: number[];
    ambiguous: boolean;
    text: string;
  };
  seasonal: null | {
    raw: Interval; deseason: Interval; detrended: Interval; note: string; seasonalDominated: boolean; atLag: number;
  };
  stability: {
    splitAgree: boolean; r1: number; r2: number; period1: string; period2: string;
    bootShare: number; boots: number; recommended: boolean; text: string;
  };
  dependencies: DependencyFlag[];
  notShown: string;
  /** anomaly series over the common period (temporal / lag leads) */
  series: null | {
    months: string[]; target: (number | null)[]; candidate: (number | null)[];
    targetUnit: string; candidateUnit: string; candidateDecimals: number; targetDecimals: number;
  };
  scatter: null | {
    kind: "numeric" | "category";
    points: { x: number; y: number; cls?: number }[];
    xLabel: string; yLabel: string; xUnit: string; yUnit: string;
    shown: number; total: number;
    categories?: { name: string; mean: number; n: number }[];
    fit?: { a: number; b: number };
  };
}

export interface SyntheticRun {
  synthetic: true;
  notice: string;
  generator: string;
  snapshot: string;
  regionId: string;
  regionName: string;
  targets: VarId[];
  scenario: Scenario;
  defaultScenario: Scenario;
  scenarioForced: boolean;
  ledger: Ledger;
  policy: PolicyItem[];
  candidates: CandidateRecord[];
  leads: LeadDetail[];
  status: {
    headline: string;
    message: string;
    searched: string;
    missing: { candidate: string; product: string; reason: string; retry: string; affects: string }[];
    untestable: { question: string; reason: string }[];
  };
  /** what the simulated progress screen shows while "analysing" (uncorrected, provisional) */
  provisional: { id: string; text: string; pText: string }[];
}

/* ===================================================================================================== constants */

export const SYNTHETIC_NOTICE =
  "These leads are generated examples that show how results will be presented. They are not findings about this region.";
export const SYNTHETIC_SNAPSHOT = "synthetic catalogue snapshot (demo)";
const GENERATOR = "aqua-trend lib/synthetic.ts, deterministic seeded generator v1";
const LAST_MONTH = "2026-07";

export const SCENARIO_LABEL: Record<Scenario, string> = {
  complete: "Complete, with leads",
  "complete-none": "Complete, no reliable association",
  partial: "Partial, a source failed",
  insufficient: "Insufficient data",
};
export const SCENARIOS: Scenario[] = ["complete", "complete-none", "partial", "insufficient"];

export const ROUTE_LABEL: Record<Route, string> = {
  temporal: "Temporal anomaly",
  lag: "Lagged association",
  spatial: "Spatial trend",
  grouped: "Grouped comparison",
};
export const LEAD_ROUTE_LABEL: Record<LeadRoute, string> = {
  temporal: "Temporal anomaly",
  lag: "Lagged association",
  "spatial-static": "Spatial trend",
  "spatial-trend": "Spatial trend",
  grouped: "Spatial trend (grouped)",
};

const BY_ALPHA = 0.05;
const LAG_MAX = 12;
const BOOTS = 200;
const BLOCK = 12;

export function policyItems(): PolicyItem[] {
  return [
    { label: "Before temporal association", value: "Remove the monthly seasonal cycle, then a linear trend, from both series; associate the anomalies." },
    { label: "Lag window", value: "−12 to +12 months, searched in both directions; the window is fixed before any association is computed." },
    { label: "Lag sign", value: "Positive lag means the candidate changes first. A lag is a statistical clue, not a cause." },
    { label: "Lag significance", value: "Maximum statistic over the whole supported window (approximated here), not the p-value of the best lag alone." },
    { label: "Multiple testing", value: "Benjamini–Yekutieli FDR at 0.05 over the whole family: targets × de-duplicated candidates × applicable routes." },
    { label: "Stability", value: `Split-period agreement and a moving-block bootstrap (${BOOTS} resamples, blocks of ${BLOCK}); a lead needs both.` },
    { label: "Ranking", value: "Effect size, stability and data quality. Never the smallest p. Relationship types are not merged into one score." },
    { label: "Common period", value: "Each target–candidate pair uses its own common period, fixed from coverage and quality, not from the result." },
  ];
}

/* ================================================================================================== random + math */

function hashStr(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class Rng {
  private f: () => number;
  constructor(seed: string) { this.f = mulberry32(hashStr(seed)); }
  u() { return this.f(); }
  range(a: number, b: number) { return a + (b - a) * this.f(); }
  int(a: number, b: number) { return Math.floor(this.range(a, b + 1)); }
  n() {
    const u = Math.max(1e-12, this.f()), v = this.f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

function erfc(x: number): number {
  // Numerical Recipes erfcc, relative error < 1.2e-7 everywhere (good in the far tail)
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const fin = (x: number) => Number.isFinite(x);
const clampR = (r: number) => Math.max(-0.999, Math.min(0.999, r));
function pFromR(r: number, nEff: number): number {
  const z = Math.atanh(clampR(r)) * Math.sqrt(Math.max(nEff - 3, 1));
  return Math.min(1, Math.max(1e-300, erfc(Math.abs(z) / Math.SQRT2)));
}
function interval(r: number, nEff: number): Interval {
  const se = 1.96 / Math.sqrt(Math.max(nEff - 3, 3));
  const z = Math.atanh(clampR(r));
  return { r, lo: Math.tanh(z - se), hi: Math.tanh(z + se) };
}
function pearson(a: ArrayLike<number>, b: ArrayLike<number>): { r: number; n: number } {
  let n = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) if (fin(a[i]) && fin(b[i])) { n++; sa += a[i]; sb += b[i]; }
  if (n < 3) return { r: 0, n };
  const ma = sa / n, mb = sb / n;
  let saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < a.length; i++) if (fin(a[i]) && fin(b[i])) {
    const da = a[i] - ma, db = b[i] - mb;
    saa += da * da; sbb += db * db; sab += da * db;
  }
  const d = Math.sqrt(saa * sbb);
  return { r: d > 0 ? sab / d : 0, n };
}
/** r(lag) = corr(y(t), x(t - lag)): positive lag = x (candidate) changes first */
function corrLag(y: number[], x: number[], lag: number): { r: number; n: number } {
  const a: number[] = [], b: number[] = [];
  for (let t = 0; t < y.length; t++) {
    const k = t - lag;
    if (k < 0 || k >= x.length) continue;
    a.push(y[t]); b.push(x[k]);
  }
  return pearson(a, b);
}
function lag1(x: number[]): number {
  const a: number[] = [], b: number[] = [];
  for (let t = 1; t < x.length; t++) { a.push(x[t]); b.push(x[t - 1]); }
  return Math.max(0, Math.min(0.95, pearson(a, b).r));
}
function effectiveN(n: number, a: number[], b: number[]): number {
  const k = lag1(a) * lag1(b);
  return Math.max(6, Math.min(n, (n * (1 - k)) / (1 + k)));
}
const mean = (v: number[]) => { let s = 0, n = 0; for (const x of v) if (fin(x)) { s += x; n++; } return n ? s / n : NaN; };
const sdev = (v: number[]) => {
  const m = mean(v); let s = 0, n = 0;
  for (const x of v) if (fin(x)) { s += (x - m) ** 2; n++; }
  return n > 1 ? Math.sqrt(s / (n - 1)) : 0;
};

interface Decomp { clim: number[]; deseason: number[]; anomaly: number[]; slopePerDecade: number }
function decompose(vals: ArrayLike<number>, moy: number[], s: number, e: number): Decomp {
  const n = vals.length, sum = new Array(12).fill(0), cnt = new Array(12).fill(0);
  for (let t = s; t <= e; t++) if (fin(vals[t])) { sum[moy[t]] += vals[t]; cnt[moy[t]]++; }
  const clim = sum.map((v, i) => (cnt[i] ? v / cnt[i] : 0));
  const des = new Array<number>(n).fill(NaN);
  for (let t = s; t <= e; t++) if (fin(vals[t])) des[t] = vals[t] - clim[moy[t]];
  let sx = 0, sy = 0, k = 0;
  for (let t = s; t <= e; t++) if (fin(des[t])) { sx += t / 120; sy += des[t]; k++; }
  const mx = k ? sx / k : 0, my = k ? sy / k : 0;
  let sxy = 0, sxx = 0;
  for (let t = s; t <= e; t++) if (fin(des[t])) { sxy += (t / 120 - mx) * (des[t] - my); sxx += (t / 120 - mx) ** 2; }
  const b = sxx > 0 ? sxy / sxx : 0;
  const anom = new Array<number>(n).fill(NaN);
  for (let t = s; t <= e; t++) if (fin(des[t])) anom[t] = des[t] - my - b * (t / 120 - mx);
  return { clim, deseason: des, anomaly: anom, slopePerDecade: b };
}

/* ============================================================================================ candidate catalogue */

const SHARED_GLDAS: DependencyFlag = {
  code: "shared-source",
  label: "Shared source model",
  text: "This candidate comes from the same GLDAS Noah model run as the target, and the model computes evapotranspiration from this very forcing. A strong association is expected by construction. It is not independent evidence of a mechanism.",
};
const REDUNDANT_RAIN: DependencyFlag = {
  code: "redundant-quantity",
  label: "Same physical quantity",
  text: "Both products estimate rainfall, and the GLDAS forcing field may be informed by satellite precipitation. Agreement checks consistency. It is not a new driver.",
};
const REDUNDANT_SOIL: DependencyFlag = {
  code: "redundant-quantity",
  label: "Same physical quantity",
  text: "Both are soil-moisture estimates for the near-surface layer (one modelled, one retrieved). Agreement checks the model against an observation. It is not a separate driver.",
};
const VECTOR: DependencyFlag = {
  code: "vector-component",
  label: "Vector component",
  text: "One component of a vector flux. East–west and north–south components are kept separate, never averaged or combined into one number.",
};
const GRACE_DEF: DependencyFlag = {
  code: "different-definition",
  label: "Different definition",
  text: "GRACE storage includes groundwater and surface water. The target is modelled soil, snow and canopy storage only, so they do not measure the same stock.",
};

export const CANDIDATES: CandidateMeta[] = [
  {
    id: "lst", name: "Land surface temperature (day)", short: "land-surface temperature", product: "MOD11C3", version: "v061", agency: "NASA",
    domain: "temperature", kind: "continuous", coverage: { start: "2000-03", end: "2026-06" }, resolution: "0.05° monthly, aggregated to the region",
    unit: "°C", definition: "Skin temperature of the land surface measured by MODIS on Terra at daytime overpass. Not air temperature.",
    routes: ["temporal", "lag", "spatial"], mean: 28, sd: 6, decimals: 1,
  },
  {
    id: "ndvi", name: "Vegetation index (NDVI)", short: "vegetation greenness (NDVI)", product: "MOD13C2", version: "v061", agency: "NASA",
    domain: "vegetation", kind: "continuous", coverage: { start: "2000-02", end: "2026-06" }, resolution: "0.05° monthly, aggregated to the region",
    unit: "index (0–1)", definition: "Normalised difference vegetation index from MODIS: how green the surface looks, a proxy for plant activity.",
    routes: ["temporal", "lag", "spatial"], mean: 0.45, sd: 0.15, decimals: 2,
  },
  {
    id: "tqv", name: "Total precipitable water", short: "total precipitable water", product: "M2TMNXSLV (TQV)", version: "v5.12.4", agency: "NASA GMAO",
    domain: "atmosphere", kind: "continuous", coverage: { start: "2000-01", end: "2026-06" }, resolution: "0.5° × 0.625° monthly, aggregated to the region",
    unit: "kg m⁻²", definition: "Water vapour in the whole air column above the surface, from the MERRA-2 reanalysis.",
    routes: ["temporal", "lag", "spatial"], mean: 25, sd: 8, decimals: 1,
  },
  {
    id: "uflxqv", name: "Vapour flux, east–west component", short: "east–west vapour transport", product: "M2TMNXINT (UFLXQV)", version: "v5.12.4", agency: "NASA GMAO",
    domain: "atmosphere", kind: "continuous", coverage: { start: "2000-01", end: "2026-06" }, resolution: "0.5° × 0.625° monthly, aggregated to the region",
    unit: "kg m⁻¹ s⁻¹", definition: "Vertically integrated eastward water-vapour flux. A vector component: positive means toward the east.",
    routes: ["temporal", "lag", "spatial"], mean: 20, sd: 60, decimals: 0, flags: { "*": VECTOR },
  },
  {
    id: "vflxqv", name: "Vapour flux, north–south component", short: "north–south vapour transport", product: "M2TMNXINT (VFLXQV)", version: "v5.12.4", agency: "NASA GMAO",
    domain: "atmosphere", kind: "continuous", coverage: { start: "2000-01", end: "2026-06" }, resolution: "0.5° × 0.625° monthly, aggregated to the region",
    unit: "kg m⁻¹ s⁻¹", definition: "Vertically integrated northward water-vapour flux. A vector component: positive means toward the north.",
    routes: ["temporal", "lag", "spatial"], mean: 5, sd: 40, decimals: 0, flags: { "*": VECTOR },
  },
  {
    id: "netrad", name: "Net surface radiation", short: "net surface radiation", product: "CERES_EBAF (sfc_net_tot_all_mon)", version: "Ed4.2", agency: "NASA",
    domain: "radiation", kind: "continuous", coverage: { start: "2000-03", end: "2026-03" }, resolution: "1° monthly, aggregated to the region",
    unit: "W m⁻²", definition: "Downward minus upward shortwave and longwave radiation at the surface (all-sky), from CERES.",
    routes: ["temporal", "lag", "spatial"], mean: 90, sd: 40, decimals: 0,
  },
  {
    id: "cloud", name: "Cloud fraction", short: "cloud fraction", product: "MOD08_M3 (Cloud_Fraction)", version: "v061", agency: "NASA",
    domain: "clouds", kind: "continuous", coverage: { start: "2000-03", end: "2026-06" }, resolution: "1° monthly, aggregated to the region",
    unit: "fraction (0–1)", definition: "Share of the sky covered by cloud as seen by MODIS Terra.",
    routes: ["temporal", "lag", "spatial"], mean: 0.5, sd: 0.18, decimals: 2,
  },
  {
    id: "aod", name: "Aerosol optical depth", short: "aerosol optical depth", product: "M2TMNXAER (TOTEXTTAU)", version: "v5.12.4", agency: "NASA GMAO",
    domain: "aerosol", kind: "continuous", coverage: { start: "2000-01", end: "2026-06" }, resolution: "0.5° × 0.625° monthly, aggregated to the region",
    unit: "dimensionless", definition: "How much sunlight the aerosols in the air column block at 550 nm, from MERRA-2.",
    routes: ["temporal", "lag", "spatial"], mean: 0.2, sd: 0.1, decimals: 2,
  },
  {
    id: "airs_tair", name: "Surface air temperature", short: "AIRS surface air temperature", product: "AIRS3STM (SurfAirTemp_A)", version: "v7", agency: "NASA",
    domain: "temperature", kind: "continuous", coverage: { start: "2002-09", end: "2026-05" }, resolution: "1° monthly, aggregated to the region",
    unit: "°C", definition: "Air temperature near the surface retrieved from the AIRS infrared sounder (daytime and night-time ascending).",
    routes: ["temporal", "lag", "spatial"], mean: 18, sd: 8, decimals: 1,
  },
  {
    id: "imerg", name: "Precipitation (satellite)", short: "satellite precipitation (IMERG)", product: "GPM_3IMERGM", version: "07", agency: "NASA",
    domain: "precipitation", kind: "continuous", coverage: { start: "2000-06", end: "2026-06" }, resolution: "0.1° monthly, aggregated to the region",
    unit: "mm day⁻¹", definition: "Monthly mean rain and snowfall rate from the GPM IMERG multi-satellite estimate.",
    routes: ["temporal", "lag", "spatial"], mean: 3, sd: 2, decimals: 2, flags: { precip: REDUNDANT_RAIN, p_minus_et: REDUNDANT_RAIN },
  },
  {
    id: "smap", name: "Soil moisture (retrieved)", short: "SMAP soil moisture", product: "SPL3SMP_E", version: "v6", agency: "NASA",
    domain: "soil", kind: "continuous", coverage: { start: "2015-04", end: "2026-06" }, resolution: "9 km (daily composites), monthly mean over the region",
    unit: "m³ m⁻³", definition: "Volumetric soil moisture in the top ~5 cm retrieved from L-band microwave brightness temperature.",
    routes: ["temporal", "lag", "spatial"], mean: 0.2, sd: 0.07, decimals: 3, flags: { soil_top: REDUNDANT_SOIL, root_zone: REDUNDANT_SOIL },
    note: "Short record (from April 2015): fewer months, so fewer effective samples and a narrower supported lag range.",
  },
  {
    id: "grace", name: "Terrestrial water storage anomaly", short: "GRACE water storage", product: "TELLUS_GRAC-GRFO_MASCON", version: "RL06.3", agency: "NASA JPL",
    domain: "gravity", kind: "continuous", coverage: { start: "2002-04", end: "2026-02" }, resolution: "3° mascons (about 300 km), monthly",
    unit: "cm water equivalent", definition: "Change in total land water (groundwater, soil, snow, surface water) from satellite gravity, relative to a baseline.",
    routes: ["temporal", "lag"], mean: 0, sd: 6, decimals: 1, minAreaKm2: 200000, flags: { tws: GRACE_DEF },
    note: "Native resolution is coarse, so it cannot resolve small regions. GRACE and GRACE-FO have a gap between 2017-06 and 2018-05.",
  },
  {
    id: "snowcov", name: "Snow cover", short: "snow cover", product: "MOD10CM (NDSI_Snow_Cover)", version: "v061", agency: "NASA NSIDC",
    domain: "cryosphere", kind: "continuous", coverage: { start: "2000-03", end: "2026-06" }, resolution: "0.05° monthly, aggregated to the region",
    unit: "% of area", definition: "Fraction of the surface covered by snow from MODIS. It is area, not depth or water content.",
    routes: ["temporal", "lag", "spatial"], mean: 30, sd: 25, decimals: 0,
  },
  {
    id: "srtm", name: "Elevation", short: "elevation", product: "SRTMGL1_NC", version: "v003", agency: "NASA JPL",
    domain: "terrain", kind: "static", coverage: { start: "2000-02", end: "2000-02" }, resolution: "30 m, aggregated to 1° cell means",
    unit: "m", definition: "Height above the EGM96 geoid from the 2000 Shuttle radar mission. Static: it has no time series, so it is compared across places only.",
    routes: ["spatial"], mean: 900, sd: 650, decimals: 0,
  },
  {
    id: "landcover", name: "Land cover type", short: "land cover class", product: "MCD12C1 (IGBP)", version: "v061", agency: "NASA",
    domain: "land cover", kind: "categorical", coverage: { start: "2001-01", end: "2024-12" }, resolution: "0.05° yearly, dominant class per 1° cell",
    unit: "class code", definition: "Dominant IGBP land-cover class. Categories: compared by group, never as a number.",
    routes: ["grouped"], mean: 0, sd: 1, decimals: 0,
  },
  {
    id: "nino34", name: "Niño 3.4 sea-surface temperature index", short: "Niño 3.4 index", product: "Niño 3.4 (ERSSTv5 anomaly)", version: "v5", agency: "NOAA (not NASA)",
    domain: "climate index", kind: "continuous", coverage: { start: "2000-01", end: "2026-06" }, resolution: "single global series, monthly",
    unit: "°C anomaly", definition: "Tropical Pacific sea-surface temperature anomaly, a standard El Niño index. One series for the whole globe, so it can only be compared over time.",
    routes: ["temporal", "lag"], mean: 0, sd: 1, decimals: 2,
    note: "Not a NASA product. Listed with its agency and used as a time-only candidate.",
  },
  {
    id: "gldas_tair", name: "Near-surface air temperature", short: "GLDAS near-surface air temperature", product: "GLDAS_NOAH10_M (Tair_f_inst)", version: "2.1", agency: "NASA GSFC / GES DISC",
    domain: "temperature", kind: "continuous", coverage: { start: "2000-01", end: "2026-07" }, resolution: "1° monthly, aggregated to the region",
    unit: "°C", definition: "Air temperature just above the ground in the Noah forcing. The same model run as the water targets.",
    routes: ["temporal", "lag", "spatial"], mean: 15, sd: 9, decimals: 1, flags: { "*": SHARED_GLDAS },
  },
  /* entries that are not independent science candidates */
  {
    id: "lst_portal", name: "Land surface temperature (day), second portal entry", short: "land-surface temperature", product: "MOD11C3", version: "v061",
    agency: "NASA", domain: "temperature", kind: "continuous", coverage: { start: "2000-03", end: "2026-06" }, resolution: "0.05° monthly",
    unit: "°C", definition: "Same MODIS product listed through a second data portal.", routes: ["temporal", "lag", "spatial"], mean: 28, sd: 6, decimals: 1,
    duplicateOf: "lst", duplicateNote: "Same product and version reached through a second portal; merged so it is not counted as independent evidence.",
  },
  {
    id: "ndvi_v006", name: "Vegetation index (NDVI), superseded version", short: "vegetation greenness (NDVI)", product: "MOD13C2", version: "v006",
    agency: "NASA", domain: "vegetation", kind: "continuous", coverage: { start: "2000-02", end: "2024-12" }, resolution: "0.05° monthly",
    unit: "index (0–1)", definition: "Earlier version of the same MODIS NDVI product.", routes: ["temporal", "lag", "spatial"], mean: 0.45, sd: 0.15, decimals: 2,
    duplicateOf: "ndvi", duplicateNote: "Superseded version of MOD13C2; the current version is analysed and this one is not allowed to replace it.",
  },
  {
    id: "lst_qc", name: "Land surface temperature quality flags", short: "LST quality flags", product: "MOD11C3 (QC_Day)", version: "v061",
    agency: "NASA", domain: "quality", kind: "categorical", coverage: { start: "2000-03", end: "2026-06" }, resolution: "0.05° monthly",
    unit: "flag", definition: "Quality-control bit flags of the land-surface-temperature product.", routes: [], mean: 0, sd: 1, decimals: 0,
    qualityOnly: true, qualityNote: "Used to mask low-quality MOD11C3 pixels and to check alignment. Quality fields are not treated as ordinary candidates.",
  },
];

const CAND = new Map(CANDIDATES.map((c) => [c.id, c]));
export const candidateById = (id: string) => CAND.get(id);

/* ============================================================================================= default scenarios */

const EXPLICIT_SCENARIO: Record<string, Scenario> = {
  "named-arabian-aquifers-saudi": "complete-none",
  "named-amazon-deforestation-arc": "partial",
  "named-aral-sea": "complete-none",
  "b3-1030034260": "partial",
  "named-california-central-valley": "complete",
  "named-sahel": "complete",
  "named-high-mountain-asia": "complete",
  "named-indo-gangetic-plain": "complete",
  "named-taiwan-main-island": "complete",
  "named-greenland": "complete",
  "b3-6030007000": "complete",
  "b3-7030047060": "complete",
  "b3-3030009130": "complete",
};

/** Deterministic default scenario of a region. series === null is always "insufficient". */
export function defaultScenario(region: Region, series: RegionSeries | null): Scenario {
  if (!series || !region.cells || region.cells < 2) return "insufficient";
  const ex = EXPLICIT_SCENARIO[region.id];
  if (ex) return ex;
  const h = hashStr(`scenario|${region.id}`) % 100;
  return h < 62 ? "complete" : h < 80 ? "complete-none" : "partial";
}

/* ============================================================================================ plausible plantings */

interface Plant {
  t: VarId; c: string; route: "temporal" | "lag" | "spatial" | "grouped";
  rho: number; lag?: number; two?: number; seas?: number; unstable?: boolean;
}
const PLANTS: Plant[] = [
  { t: "et", c: "gldas_tair", route: "temporal", rho: 0.62, seas: 1.2 },
  { t: "et", c: "lst", route: "lag", rho: 0.58, lag: 1 },
  { t: "et", c: "ndvi", route: "lag", rho: 0.52, lag: 2, two: 5 },
  { t: "et", c: "netrad", route: "temporal", rho: 0.44, seas: 3 },
  { t: "et", c: "cloud", route: "temporal", rho: -0.5 },
  { t: "et", c: "airs_tair", route: "lag", rho: 0.5, lag: 1 },
  { t: "et", c: "ndvi", route: "spatial", rho: 0.6 },
  { t: "precip", c: "imerg", route: "temporal", rho: 0.82 },
  { t: "precip", c: "tqv", route: "temporal", rho: 0.55 },
  { t: "precip", c: "cloud", route: "temporal", rho: 0.5 },
  { t: "precip", c: "nino34", route: "lag", rho: -0.5, lag: 3 },
  { t: "precip", c: "tqv", route: "spatial", rho: 0.5 },
  { t: "p_minus_et", c: "imerg", route: "temporal", rho: 0.8 },
  { t: "p_minus_et", c: "tqv", route: "temporal", rho: 0.5 },
  { t: "p_minus_et", c: "cloud", route: "temporal", rho: 0.46 },
  { t: "p_minus_et", c: "lst", route: "temporal", rho: -0.5, seas: 2 },
  { t: "runoff", c: "imerg", route: "lag", rho: 0.7, lag: 1, two: 3 },
  { t: "runoff", c: "smap", route: "lag", rho: 0.5, lag: 1 },
  { t: "runoff", c: "srtm", route: "spatial", rho: 0.55 },
  { t: "runoff", c: "landcover", route: "grouped", rho: 0.55 },
  { t: "runoff", c: "tqv", route: "lag", rho: 0.45, lag: 1 },
  { t: "soil_top", c: "smap", route: "temporal", rho: 0.75 },
  { t: "soil_top", c: "imerg", route: "lag", rho: 0.55, lag: 1 },
  { t: "soil_top", c: "lst", route: "temporal", rho: -0.5, seas: 2 },
  { t: "soil_top", c: "ndvi", route: "lag", rho: 0.5, lag: 2, unstable: true },
  { t: "root_zone", c: "smap", route: "lag", rho: 0.6, lag: 1 },
  { t: "root_zone", c: "ndvi", route: "lag", rho: 0.5, lag: 2, two: 4 },
  { t: "root_zone", c: "imerg", route: "lag", rho: 0.55, lag: 2 },
  { t: "root_zone", c: "lst", route: "temporal", rho: -0.45, seas: 2.5 },
  { t: "tws", c: "grace", route: "temporal", rho: 0.7 },
  { t: "tws", c: "imerg", route: "lag", rho: 0.5, lag: 2 },
  { t: "tws", c: "ndvi", route: "lag", rho: 0.45, lag: 3 },
  { t: "tws", c: "lst", route: "temporal", rho: -0.4, seas: 2 },
  { t: "swe", c: "snowcov", route: "temporal", rho: 0.8 },
  { t: "swe", c: "lst", route: "temporal", rho: -0.6, seas: 2.5 },
  { t: "swe", c: "srtm", route: "spatial", rho: 0.6 },
  { t: "swe", c: "airs_tair", route: "temporal", rho: -0.55 },
  { t: "swe", c: "lst", route: "spatial", rho: -0.5 },
];

/* ============================================================================================ pair computation */

const SPATIAL_MIN_CELLS = 8;
const LAND_CLASSES = ["Evergreen forest", "Cropland", "Grassland", "Shrubland", "Barren", "Built-up"];

interface TestRec {
  key: string; target: VarId; cand: CandidateMeta; route: Route; pending: boolean;
  r: number; lag: number; pRaw: number; nRaw: number; nEff: number; q: number; passed: boolean;
  pair?: TemporalPair; spatial?: SpatialData;
}
interface TemporalPair {
  s: number; e: number; moy: number[]; months: string[];
  yRaw: number[]; xRaw: number[]; yAnom: number[]; xAnom: number[]; yDes: number[]; xDes: number[];
  curve: { lag: number; r: number }[]; supported: number; bestLag: number; bestR: number;
  peaks: number[]; ambiguous: boolean; nPairs: number; nEff0: number;
  rho: number; planted: boolean; unstable: boolean;
}
interface SpatialData {
  kind: "numeric" | "category"; xs: number[]; ys: number[]; cls: number[]; trend: boolean; planted: boolean; unstable: boolean;
  total: number; classNames: string[]; eta: number;
}

function monthIdx(months: string[], ym: string): number {
  const i = months.indexOf(ym);
  if (i >= 0) return i;
  return ym < months[0] ? 0 : months.length - 1;
}

function ar1(rng: Rng, n: number, phi: number): number[] {
  const out = new Array<number>(n); let e = rng.n();
  const k = Math.sqrt(1 - phi * phi);
  for (let t = 0; t < n; t++) { e = phi * e + k * rng.n(); out[t] = e; }
  return out;
}

function buildTemporalPair(
  rng: Rng, months: string[], moy: number[], target: VarId, yRaw: Float32Array, yDecomp: Decomp, cand: CandidateMeta,
  plant: Plant | null,
): TemporalPair {
  const n = months.length;
  const s = monthIdx(months, cand.coverage.start);
  const e = Math.max(s, monthIdx(months, cand.coverage.end > LAST_MONTH ? LAST_MONTH : cand.coverage.end));
  // standardised real target anomaly, used as the "signal" the synthetic candidate partly follows
  const sd = sdev(yDecomp.anomaly) || 1;
  const z = yDecomp.anomaly.map((v) => (fin(v) ? v / sd : 0));
  const rho = plant ? plant.rho : 0;
  const lagL = plant?.route === "lag" ? plant.lag ?? 1 : 0;
  const phi = rng.range(0.25, 0.55);
  const noise = ar1(rng, n, phi);
  const unstable = !!plant?.unstable;
  const noiseScale = Math.sqrt(Math.max(0.12, 1 - rho * rho));
  const an = new Array<number>(n);
  const pickZ = (k: number) => (k >= 0 && k < n ? z[k] : 0);
  for (let t = 0; t < n; t++) {
    let sig: number;
    if (plant?.two) sig = rho * 0.74 * (pickZ(t + lagL) + pickZ(t + plant.two));
    else sig = rho * pickZ(t + lagL);
    if (unstable && t >= (s + e) / 2) sig *= 0.04;
    an[t] = sig + noise[t] * noiseScale;
  }
  // seasonal + trend parts of the invented raw candidate
  const climSd = sdev(yDecomp.clim) || 0;
  const desSd = sdev(yDecomp.deseason.filter(fin)) || 1;
  const phase = Math.round(rng.range(-1.4, 1.4));
  const useShared = climSd > 0.05 * desSd;
  const seasAmp = plant?.seas ?? rng.range(0.4, 1.8);
  const seasSign = plant ? Math.sign(rho) || 1 : rng.u() < 0.5 ? -1 : 1;
  const climMean = mean(yDecomp.clim);
  const own = rng.range(0, 12);
  const trendAmp = rng.range(0, 0.9) * (rng.u() < 0.5 ? -1 : 1);
  const raw = new Array<number>(n).fill(NaN);
  const comb = new Array<number>(n).fill(NaN);
  for (let t = s; t <= e; t++) {
    const m = moy[t];
    const sFix = useShared ? (yDecomp.clim[(m - phase + 12) % 12] - climMean) / climSd : Math.sin(((m + own) / 12) * 2 * Math.PI);
    const tr = (t - (s + e) / 2) / ((e - s + 1) / Math.sqrt(12));
    comb[t] = an[t] + seasSign * seasAmp * sFix + trendAmp * tr;
  }
  const cm = mean(comb), cd = sdev(comb) || 1;
  for (let t = s; t <= e; t++) raw[t] = cand.mean + (cand.sd * (comb[t] - cm)) / cd;
  // everything below is computed from the invented series, so charts and numbers agree
  const yWin = new Array<number>(n).fill(NaN);
  for (let t = s; t <= e; t++) yWin[t] = yRaw[t];
  const yD = decompose(yRaw, moy, s, e), xD = decompose(raw, moy, s, e);
  const ya = yD.anomaly, xa = xD.anomaly;
  const nPairs = ya.filter((v, i) => fin(v) && fin(xa[i])).length;
  const nEff0 = effectiveN(nPairs, ya, xa);
  const supported = Math.max(3, Math.min(LAG_MAX, Math.floor(nPairs / 20)));
  const curve: { lag: number; r: number }[] = [];
  for (let l = -LAG_MAX; l <= LAG_MAX; l++) curve.push({ lag: l, r: corrLag(ya, xa, l).r });
  let best = curve.find((c) => c.lag === 0)!;
  for (const c of curve) if (Math.abs(c.lag) <= supported && Math.abs(c.r) > Math.abs(best.r) + 1e-9) best = c;
  const inside = curve.filter((c) => Math.abs(c.lag) <= supported);
  const peaks: number[] = [];
  inside.forEach((c, i) => {
    const prev = inside[i - 1]?.r ?? 0, next = inside[i + 1]?.r ?? 0;
    const a = Math.abs(c.r);
    if (Math.sign(c.r) === Math.sign(best.r) && a >= Math.abs(prev) && a >= Math.abs(next) && a >= 0.85 * Math.abs(best.r)) peaks.push(c.lag);
  });
  const ambiguous = peaks.length >= 2 && Math.max(...peaks) - Math.min(...peaks) >= 2;
  return {
    s, e, moy, months, yRaw: yWin, xRaw: raw, yAnom: ya, xAnom: xa, yDes: yD.deseason, xDes: xD.deseason,
    curve, supported, bestLag: best.lag, bestR: best.r, peaks, ambiguous, nPairs, nEff0, rho, planted: !!plant, unstable,
  };
}

function buildSpatial(rng: Rng, region: Region, target: VarId, yDecomp: Decomp, cand: CandidateMeta, plant: Plant | null): SpatialData {
  const total = region.cells ?? 0;
  const n = Math.min(total, 150);
  const slope = yDecomp.slopePerDecade;
  const spread = 0.25 * (sdev(yDecomp.anomaly) || 1) + 0.3 * Math.abs(slope);
  const rho = plant ? plant.rho : 0;
  const unstable = !!plant?.unstable;
  const ys: number[] = [], xs: number[] = [], cls: number[] = [];
  const grouped = cand.kind === "categorical";
  const classNames = grouped ? LAND_CLASSES.slice(0, rng.int(3, 5)) : [];
  const shifts = classNames.map(() => rng.n());
  const zs: number[] = [];
  for (let i = 0; i < n; i++) zs.push(rng.n());
  for (let i = 0; i < n; i++) {
    const y = slope + spread * zs[i];
    ys.push(y);
    if (grouped) {
      const c = Math.min(classNames.length - 1, Math.floor(Math.pow(rng.u(), 1.3) * classNames.length));
      cls.push(c);
    } else {
      const std = rho * zs[i] + Math.sqrt(1 - rho * rho) * rng.n();
      const scale = cand.kind === "static" ? cand.sd : cand.sd * 0.1;
      let v = (cand.kind === "static" ? cand.mean : 0) + scale * std;
      if (cand.kind === "static") v = Math.max(0, v);
      xs.push(v);
    }
  }
  let eta = 0;
  if (grouped) {
    // class differences in the (synthetic) target trend, strength set by rho
    for (let i = 0; i < n; i++) ys[i] = slope + spread * (Math.sqrt(1 - rho * rho) * zs[i] + rho * shifts[cls[i]]);
    const gm = mean(ys);
    let ssb = 0, sst = 0;
    classNames.forEach((_, c) => {
      const g = ys.filter((_, i) => cls[i] === c);
      if (g.length) ssb += g.length * (mean(g) - gm) ** 2;
    });
    for (const y of ys) sst += (y - gm) ** 2;
    eta = sst > 0 ? Math.sqrt(ssb / sst) : 0;
    for (let i = 0; i < n; i++) xs.push(cls[i]);
  }
  return { kind: grouped ? "category" : "numeric", xs, ys, cls, trend: cand.kind === "continuous", planted: !!plant, unstable, total, classNames, eta };
}

/* ============================================================================================ stability */

function blockBootShare(a: number[], b: number[], r0: number, rng: Rng): number {
  const idx: number[] = [];
  for (let i = 0; i < a.length; i++) if (fin(a[i]) && fin(b[i])) idx.push(i);
  const m = idx.length, bl = Math.min(BLOCK, Math.max(2, Math.floor(m / 4)));
  const pa = idx.map((i) => a[i]), pb = idx.map((i) => b[i]);
  let keep = 0;
  for (let k = 0; k < BOOTS; k++) {
    const ra: number[] = [], rb: number[] = [];
    while (ra.length < m) {
      const st = Math.floor(rng.u() * Math.max(1, m - bl + 1));
      for (let j = 0; j < bl && ra.length < m; j++) { ra.push(pa[st + j]); rb.push(pb[st + j]); }
    }
    const r = pearson(ra, rb).r;
    if (Math.sign(r) === Math.sign(r0) && r !== 0) keep++;
  }
  return keep / BOOTS;
}

/* ============================================================================================ formatting helpers */

export function fmtP(p: number): string {
  if (p < 0.001) return "< 0.001";
  return p.toFixed(p < 0.01 ? 4 : 3).replace(/0+$/, "").replace(/\.$/, "");
}
export function fmtSigned(x: number, d = 2): string {
  const s = Math.abs(x).toFixed(d);
  return x < 0 && Number(s) !== 0 ? `−${s}` : x > 0 && Number(s) !== 0 ? `+${s}` : s;
}
export function fmtR(x: number): string { return fmtSigned(x, 2); }
export function lagPhrase(months: number): string {
  const m = Math.abs(months);
  return `${m} month${m === 1 ? "" : "s"}`;
}

/* ============================================================================================ lead text builders */

function seasonalNote(raw: Interval, des: Interval, det: Interval, passed: boolean): { note: string; dominated: boolean } {
  const rr = Math.abs(raw.r), dd = Math.abs(des.r), tt = Math.abs(det.r);
  const f = (i: Interval) => `${fmtR(i.r)} (${fmtR(i.lo)} to ${fmtR(i.hi)})`;
  if (rr >= 0.4 && tt < 0.6 * rr) {
    return {
      dominated: true,
      note: `The raw series move together (r = ${f(raw)}), but most of that is the shared seasonal cycle. After removing the cycle and the trend the link weakens to ${f(det)}${passed ? ", which still passes the correction" : ""}. This is consistent with a common seasonal rhythm, and the anomaly evidence is the part to weigh.`,
    };
  }
  if (dd >= 0.9 * rr && tt >= 0.9 * rr) {
    return {
      dominated: false,
      note: `Removing the seasonal cycle and the trend barely changes the association (raw ${fmtR(raw.r)}, adjusted ${fmtR(det.r)}), so the link is not just shared seasonality or a shared drift.`,
    };
  }
  if (dd - tt >= 0.15) {
    return {
      dominated: false,
      note: `Most of the raw link survives removing the seasonal cycle (${fmtR(des.r)}), but part of it is a shared long-term drift: after removing the trend too it is ${fmtR(det.r)}.`,
    };
  }
  if (tt > rr + 0.12) {
    return {
      dominated: false,
      note: `The seasonal cycle partly hides the link: raw ${fmtR(raw.r)}, anomaly ${fmtR(det.r)}. The adjusted value is the one the search uses.`,
    };
  }
  return {
    dominated: false,
    note: `Adjusting for the seasonal cycle and trend moves the association from ${fmtR(raw.r)} to ${fmtR(det.r)}; the intervals overlap, so the data cannot say how much of the raw link is seasonal.`,
  };
}

function leadTitle(t: VarId, c: CandidateMeta, route: LeadRoute, r: number, lag: number): string {
  const T = VARIABLES[t].label, X = c.short;
  const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (route === "temporal") {
    return `${T} and ${X} tend to ${r >= 0 ? "rise and fall together" : "move in opposite directions"} in the same month`;
  }
  if (route === "lag") {
    const dir = r >= 0 ? "" : ", in the opposite direction";
    if (lag > 0) return `${T} tends to follow ${X} by about ${lagPhrase(lag)}${dir}`;
    if (lag < 0) return `${sentence(X)} tends to follow ${T.toLowerCase()} by about ${lagPhrase(lag)}${dir}`;
    return `${T} and ${X} move together in the same month`;
  }
  if (route === "spatial-static") return `Places with higher ${X} tend to have ${r >= 0 ? "faster rising" : "slower rising"} ${T.toLowerCase()}`;
  if (route === "spatial-trend") return `Places where ${X} rises faster tend to have ${r >= 0 ? "faster rising" : "slower rising"} ${T.toLowerCase()}`;
  return `${T} trends differ between land-cover classes`;
}

/* ======================================================================================================= builder */

const NOT_SHOWN =
  "Synthetic example: this is not a finding about this region. Even a real association of this kind is a statistical clue and does not show that one variable causes the other.";

function byQ(ps: number[]): number[] {
  const m = ps.length;
  if (!m) return [];
  const c = Array.from({ length: m }, (_, i) => 1 / (i + 1)).reduce((a, b) => a + b, 0);
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const q = new Array<number>(m);
  let run = 1;
  for (let k = m - 1; k >= 0; k--) {
    const [p, i] = order[k];
    run = Math.min(run, (m * c * p) / (k + 1));
    q[i] = Math.min(1, run);
  }
  return q;
}

function emptyOutcome(status: OutcomeStatus, reason?: string, extra: Partial<CandidateOutcome> = {}): CandidateOutcome {
  return { status, reason, routesTested: [], routesNotTested: [], tests: 0, passedCorrection: 0, leads: 0, ...extra };
}

function candidateRecord(c: CandidateMeta, outcome: CandidateOutcome): CandidateRecord {
  const { flags: _f, mean: _m, sd: _s, decimals: _d, routes, ...rest } = c;
  void _f; void _m; void _s; void _d;
  return { ...rest, routes, outcome };
}

export function buildSyntheticRun(region: Region, series: RegionSeries | null, targets: VarId[], scenario?: Scenario): SyntheticRun {
  const sortedTargets = [...targets].sort();
  const seed = `${region.id}|${sortedTargets.join(",")}`;
  const def = defaultScenario(region, series);
  let scen: Scenario = scenario ?? def;
  if (!series || !region.cells || region.cells < 2) scen = "insufficient";
  const forced = scen !== def;

  const base = {
    synthetic: true as const, notice: SYNTHETIC_NOTICE, generator: GENERATOR, snapshot: SYNTHETIC_SNAPSHOT,
    regionId: region.id, regionName: region.name, targets, scenario: scen, defaultScenario: def, scenarioForced: forced,
    policy: policyItems(),
  };

  const dups = CANDIDATES.filter((c) => c.duplicateOf);
  const discovered = CANDIDATES.length;
  const science = CANDIDATES.filter((c) => !c.duplicateOf && !c.qualityOnly);
  const qualityOnly = CANDIDATES.filter((c) => c.qualityOnly);
  const identified = discovered - dups.length;

  /* ---------- insufficient: nothing to compare against ---------- */
  if (scen === "insufficient") {
    const noData = !series || !region.cells;
    const reason = noData
      ? "No GLDAS land-model cells fall inside this region, so there is no target series to compare against."
      : !series
        ? "No target series."
        : `Only ${region.cells} land-model cell${region.cells === 1 ? "" : "s"} fall inside this region.`;
    const candidates = CANDIDATES.map((c) => candidateRecord(c, c.duplicateOf
      ? emptyOutcome("duplicate", c.duplicateNote, { duplicateOf: c.duplicateOf })
      : c.qualityOnly ? emptyOutcome("quality-only", c.qualityNote)
        : emptyOutcome("not-run", "Not analysed: no target series to align it with.")));
    const untestable = targets.map((t) => ({
      question: `Does ${VARIABLES[t].label.toLowerCase()} here move with other NASA variables?`,
      reason: noData
        ? `${VARIABLES[t].label} comes from the GLDAS land model, which has no cells here (open ocean or ice sheet).`
        : forced
          ? "In this preview the run is simulated as having too few valid months after quality screening to align any candidate. This region itself has data."
          : `${VARIABLES[t].label} is modelled from too few cells here to form a regional series.`,
    }));
    return {
      ...base,
      ledger: {
        discovered, duplicatesMerged: dups.length, identified, qualityOnly: qualityOnly.length, fetched: 0, failed: 0, notApplicable: 0,
        eligibleCandidates: 0, targets: targets.length, eligiblePairs: 0, analysedPairs: 0, pendingPairs: 0, familySize: 0,
        testsAnalysed: 0, testsPending: 0, familyFinal: true, corrected: 0, passedCorrection: 0, notSignificant: 0,
        leadsRecommended: 0, leadsUnstable: 0, routesNotTestable: 0,
      },
      candidates, leads: [],
      status: {
        headline: "Insufficient data to test these questions",
        message: `${reason} This is different from "tested and not significant": nothing was tested.`,
        searched: "Candidates were inventoried (synthetic catalogue) but none could be paired with a target series.",
        missing: [], untestable,
      },
      provisional: [],
    };
  }

  /* ---------- regular runs ---------- */
  const months = series!.months;
  const n = months.length;
  const moy = months.map((m) => parseInt(m.slice(5), 10) - 1);
  const cells = region.cells ?? 0;
  const rngPlan = new Rng(`${seed}|plan|${scen}`);

  // per-target real decomposition (whole record)
  const tdec = new Map<VarId, Decomp>();
  for (const t of targets) tdec.set(t, decompose(series!.values[t], moy, 0, n - 1));
  const meanSwe = mean(Array.from(series!.values.swe).filter(fin));

  // applicability per candidate in this region
  const outcomes = new Map<string, CandidateOutcome>();
  const eligible: CandidateMeta[] = [];
  for (const c of science) {
    const notTested: { route: Route; reason: string }[] = [];
    let routes = [...c.routes];
    let na: string | null = null;
    if (c.minAreaKm2 && region.areaKm2 < c.minAreaKm2) {
      na = `Native resolution (${c.resolution.split(",")[0]}) cannot resolve a region of ${Math.round(region.areaKm2).toLocaleString("en-US")} km². Method reason, not a data gap.`;
    } else if (c.id === "snowcov" && (meanSwe < 0.5 || !fin(meanSwe))) {
      na = "No snow variation in this region (modelled snow water equivalent is about zero in every month), so there is nothing to associate with.";
    } else if (c.kind !== "continuous" && cells < SPATIAL_MIN_CELLS) {
      na = `Only ${cells} land-model cells: too few locations for a ${c.kind === "static" ? "spatial" : "grouped"} comparison.`;
    }
    if (na) { outcomes.set(c.id, emptyOutcome("not-applicable", na)); continue; }
    if (cells < SPATIAL_MIN_CELLS && routes.includes("spatial")) {
      routes = routes.filter((r) => r !== "spatial");
      notTested.push({ route: "spatial", reason: `Only ${cells} land-model cells (fewer than ${SPATIAL_MIN_CELLS}): too few locations for a spatial-trend comparison.` });
    }
    outcomes.set(c.id, emptyOutcome("analysed", undefined, { routesTested: routes, routesNotTested: notTested }));
    eligible.push(c);
  }

  // failed sources in a partial run
  const failedIds = new Set<string>();
  if (scen === "partial") {
    const pool = ["smap", "grace", "aod", "airs_tair"].filter((id) => eligible.some((c) => c.id === id));
    const pick = pool[Math.floor(rngPlan.u() * pool.length)] ?? eligible[eligible.length - 1].id;
    failedIds.add(pick);
  }
  const failureReason = (id: string) =>
    id === "smap" ? "Earthdata request timed out after 3 attempts (HTTP 504)." :
    id === "grace" ? "Granule index temporarily unavailable at the data centre (HTTP 503)." :
    "Request timed out after 3 attempts.";
  for (const id of failedIds) {
    const o = outcomes.get(id)!;
    o.status = "failed"; o.reason = failureReason(id);
  }

  // planting
  const planted: Plant[] = [];
  if (scen === "complete" || scen === "partial") {
    const perTarget = new Map<VarId, number>();
    const usable = (p: Plant) => {
      if (!targets.includes(p.t)) return false;
      const c = CAND.get(p.c);
      if (!c || !eligible.includes(c) || failedIds.has(c.id)) return false;
      if (!c.routes.includes(p.route)) return false;
      if ((p.route === "spatial" || p.route === "grouped") && cells < SPATIAL_MIN_CELLS) return false;
      return true;
    };
    const cand = PLANTS.filter(usable);
    for (const p of cand) {
      const must = p.t === "et" && p.c === "gldas_tair";
      if ((must || rngPlan.u() < 0.5) && (perTarget.get(p.t) ?? 0) < 3) { planted.push(p); perTarget.set(p.t, (perTarget.get(p.t) ?? 0) + 1); }
    }
    for (const p of cand) { if (planted.length >= 3) break; if (!planted.includes(p)) planted.push(p); }
  }
  const plantFor = (t: VarId, c: string, route: Route): Plant | null =>
    planted.find((p) => p.t === t && p.c === c && p.route === route) ?? null;
  const plantPair = (t: VarId, c: string): Plant | null =>
    planted.find((p) => p.t === t && p.c === c && (p.route === "temporal" || p.route === "lag")) ?? null;

  /* ---------- run all tests ---------- */
  const tests: TestRec[] = [];
  let routesNotTestable = 0;
  const pairKeys = new Set<string>();
  for (const t of targets) {
    const yDec = tdec.get(t)!;
    for (const c of eligible) {
      const pend = failedIds.has(c.id);
      const routes = outcomes.get(c.id)!.routesTested;
      routesNotTestable += outcomes.get(c.id)!.routesNotTested.length;
      pairKeys.add(`${t}|${c.id}`);
      let pair: TemporalPair | undefined;
      const hasTime = routes.includes("temporal") || routes.includes("lag");
      if (hasTime && !pend) {
        // Pairs that are not planted must behave as true nulls. A seeded stream that happens to track the target
        // by chance is redrawn (calibration of the synthetic generator), so a "no reliable association" run is
        // reproducibly empty and nulls never masquerade as leads.
        const pl = plantPair(t, c.id);
        for (let attempt = 0; attempt < 40; attempt++) {
          pair = buildTemporalPair(new Rng(`${seed}|${t}|${c.id}|${attempt}`), months, moy, t, series!.values[t], yDec, c, pl);
          if (pl) break;
          const worst = Math.max(...pair.curve.filter((k) => Math.abs(k.lag) <= pair!.supported).map((k) => Math.abs(k.r)));
          if (worst * Math.sqrt(pair.nEff0) < 2.6) break;
        }
      }
      for (const route of routes) {
        const key = `${t}|${c.id}|${route}`;
        const rec: TestRec = { key, target: t, cand: c, route, pending: pend, r: 0, lag: 0, pRaw: 1, nRaw: 0, nEff: 0, q: 1, passed: false };
        if (!pend) {
          if (route === "temporal" && pair) {
            const r = corrLag(pair.yAnom, pair.xAnom, 0);
            rec.r = r.r; rec.lag = 0; rec.nRaw = r.n; rec.nEff = Math.max(6, pair.nEff0 * (r.n / Math.max(1, pair.nPairs)));
            rec.pRaw = pFromR(r.r, rec.nEff); rec.pair = pair;
          } else if (route === "lag" && pair) {
            const l = pair.bestLag, r = corrLag(pair.yAnom, pair.xAnom, l);
            rec.r = r.r; rec.lag = l; rec.nRaw = r.n; rec.nEff = Math.max(6, pair.nEff0 * (r.n / Math.max(1, pair.nPairs)));
            const p1 = Math.min(1 - 1e-12, pFromR(r.r, rec.nEff));
            const K = 2 * pair.supported + 1;
            rec.pRaw = Math.min(1, -Math.expm1(K * Math.log1p(-p1)));
            rec.pair = pair;
          } else if (route === "spatial" || route === "grouped") {
            const pl = plantFor(t, c.id, route);
            let sp!: SpatialData, r = 0, nEffS = 5;
            for (let attempt = 0; attempt < 40; attempt++) {
              sp = buildSpatial(new Rng(`${seed}|${t}|${c.id}|${route}|${attempt}`), region, t, yDec, c, pl);
              r = sp.kind === "category" ? sp.eta : pearson(sp.xs, sp.ys).r;
              nEffS = Math.max(5, sp.ys.length / (2 + 3 * new Rng(`${seed}|${key}|neff`).u()));
              if (pl || Math.abs(r) * Math.sqrt(nEffS) < 2.2) break;
            }
            rec.r = r; rec.nRaw = sp.ys.length; rec.nEff = nEffS;
            rec.pRaw = pFromR(r, nEffS); rec.spatial = sp;
          }
        }
        tests.push(rec);
      }
    }
  }

  // Benjamini-Yekutieli over the whole planned family; pending tests count as p = 1 (the conservative bound)
  const qs = byQ(tests.map((t) => (t.pending ? 1 : t.pRaw)));
  tests.forEach((t, i) => { t.q = qs[i]; t.passed = !t.pending && t.q <= BY_ALPHA; });
  const familySize = tests.length;
  const analysedTests = tests.filter((t) => !t.pending);
  const pendingTests = tests.filter((t) => t.pending);
  const provisional = scen === "partial";

  /* ---------- leads from passing tests ---------- */
  const leads: LeadDetail[] = [];
  const byPair = new Map<string, TestRec[]>();
  for (const t of tests) { const k = `${t.target}|${t.cand.id}`; byPair.set(k, [...(byPair.get(k) ?? []), t]); }
  const leadsUnstable: string[] = [];

  const makeStability = (a: number[], b: number[], r: number, rng: Rng, months?: string[]) => {
    const idx: number[] = [];
    for (let i = 0; i < a.length; i++) if (fin(a[i]) && fin(b[i])) idx.push(i);
    const half = Math.floor(idx.length / 2);
    const i1 = idx.slice(0, half), i2 = idx.slice(half);
    const r1 = pearson(i1.map((i) => a[i]), i1.map((i) => b[i])).r;
    const r2 = pearson(i2.map((i) => a[i]), i2.map((i) => b[i])).r;
    const split = Math.sign(r1) === Math.sign(r) && Math.sign(r2) === Math.sign(r) && Math.min(Math.abs(r1), Math.abs(r2)) >= 0.4 * Math.abs(r);
    const share = blockBootShare(a, b, r, rng);
    const rec = split && share >= 0.8;
    const p1 = months ? `${months[i1[0]]} to ${months[i1[i1.length - 1]]}` : "first half of cells";
    const p2 = months ? `${months[i2[0]]} to ${months[i2[i2.length - 1]]}` : "second half of cells";
    return {
      splitAgree: split, r1, r2, period1: p1, period2: p2, bootShare: share, boots: BOOTS, recommended: rec,
      text: `Split-period check: ${p1} gives r = ${fmtR(r1)}, ${p2} gives r = ${fmtR(r2)} (${split ? "agree" : "do not agree"}). ` +
        `${Math.round(share * 100)}% of ${BOOTS} block-bootstrap resamples keep the sign${rec ? "" : "; a lead needs both checks, so it is not recommended"}.`,
    };
  };

  for (const [key, group] of byPair) {
    const [t, cid] = key.split("|") as [VarId, string];
    const c = CAND.get(cid)!;
    const tm = group.find((g) => g.route === "temporal");
    const lg = group.find((g) => g.route === "lag");
    const sp = group.find((g) => g.route === "spatial" || g.route === "grouped");
    const candidatesForCards: { rec: TestRec; route: LeadRoute }[] = [];
    if (lg && lg.passed && lg.lag !== 0) candidatesForCards.push({ rec: lg, route: "lag" });
    else if (tm && tm.passed) candidatesForCards.push({ rec: tm, route: "temporal" });
    else if (lg && lg.passed) candidatesForCards.push({ rec: lg, route: "temporal" });
    if (sp && sp.passed) candidatesForCards.push({ rec: sp, route: sp.route === "grouped" ? "grouped" : c.kind === "static" ? "spatial-static" : "spatial-trend" });

    for (const { rec, route } of candidatesForCards) {
      const pair = rec.pair, spd = rec.spatial;
      const vm = VARIABLES[t];
      const flagDef = c.flags?.[t] ?? c.flags?.["*"];
      const deps = flagDef ? [flagDef] : [];
      const srng = new Rng(`${seed}|${rec.key}|stab`);
      let stab: LeadDetail["stability"];
      let scope: LeadDetail["scope"];
      let effect: LeadDetail["effect"];
      let lag: LeadDetail["lag"] = null;
      let seasonal: LeadDetail["seasonal"] = null;
      let seriesOut: LeadDetail["series"] = null;
      let scatter: LeadDetail["scatter"] = null;
      let q = rec.q;
      const stats = (): LeadDetail["stats"] => ({
        pRaw: rec.pRaw, q, familySize, pText: fmtP(rec.pRaw), qText: fmtP(q),
        method: route === "lag"
          ? "Maximum correlation over the lag window, null simulated with the same preprocessing and lag search (approximated in this synthetic run); then Benjamini–Yekutieli across the family."
          : route === "temporal"
            ? "Correlation of anomalies with effective sample size from the lag-1 autocorrelation of both series; then Benjamini–Yekutieli across the family."
            : "Correlation across cells with an effective number of independent cells (approximating a spatially aware null); then Benjamini–Yekutieli across the family.",
        qProvisional: provisional,
      });
      if (pair && (route === "temporal" || route === "lag")) {
        const L = route === "lag" ? rec.lag : 0;
        const r = rec.r;
        const iv = interval(r, rec.nEff);
        effect = {
          kind: "correlation", label: "Correlation of anomalies", value: r, lo: iv.lo, hi: iv.hi,
          intervalNote: route === "lag"
            ? "Interval at the reported lag only. It does not account for having searched 25 lags, so it is indicative and too narrow."
            : "Interval from the effective sample size. Indicative only.",
        };
        const first = months[pair.s], last = months[pair.e];
        const dataEnd = c.coverage.end < months[n - 1] ? c.coverage.end : months[n - 1];
        scope = {
          commonPeriod: { start: first, end: last, months: pair.e - pair.s + 1 }, dataEnd,
          rawN: rec.nRaw, effN: rec.nEff, unitOfSample: "months",
          effNMethod: "Bretherton lag-1 autocorrelation correction applied to both anomaly series",
          resolution: `${c.resolution}; target is the monthly GLDAS regional mean`,
          area: `${cells} land-model cell${cells === 1 ? "" : "s"} (${region.cellEquiv?.toFixed(1) ?? "?"} cell-equivalents)${region.landFrac != null && region.landFrac < 0.95 ? `; land share ${(region.landFrac * 100).toFixed(0)}%` : ""}`,
        };
        const sr = makeStability(pair.yAnom.map((v, i) => (i >= pair.s && i <= pair.e ? v : NaN)), shiftBy(pair.xAnom, L), r, srng, months);
        stab = sr;
        // three-way comparison at the reported lag
        const raw = rawInterval(pair.yRaw, pair.xRaw, L, pair.nPairs);
        const des = rawInterval(pair.yDes, pair.xDes, L, pair.nPairs);
        const det = { ...iv, r };
        const note = seasonalNote(raw, des, det, rec.passed);
        seasonal = { raw, deseason: des, detrended: det, note: note.note, seasonalDominated: note.dominated, atLag: L };
        const lead = L > 0 ? "candidate" : L < 0 ? "target" : "same-month";
        const ambiguous = route === "lag" && pair.ambiguous;
        const peakTxt = pair.peaks.map((p) => (p > 0 ? `+${p}` : `${p}`)).join(" and ");
        lag = {
          months: L, leader: lead as "candidate" | "target" | "same-month", supported: [-pair.supported, pair.supported],
          curve: pair.curve, peaks: pair.peaks, ambiguous,
          text: route !== "lag" ? "Reported for the same month (lag 0). The full lag curve is shown for context."
            : (L > 0 ? `The candidate changes first; the target follows by about ${lagPhrase(L)}.` : L < 0 ? `The target changes first; the candidate follows by about ${lagPhrase(L)}.` : "No lead or lag at monthly resolution.")
            + (ambiguous ? ` Two near-equal peaks (lags ${peakTxt}) mean the reaction time is not precise: read it as a range, not as ${lagPhrase(L)}.` : "")
            + ` Supported lag range: ±${pair.supported} months (set by the length of the common record).`,
        };
        const mo: string[] = [], tg: (number | null)[] = [], cd: (number | null)[] = [];
        for (let i = pair.s; i <= pair.e; i++) {
          mo.push(months[i]);
          tg.push(fin(pair.yAnom[i]) ? pair.yAnom[i] : null);
          cd.push(fin(pair.xAnom[i]) ? pair.xAnom[i] : null);
        }
        seriesOut = { months: mo, target: tg, candidate: cd, targetUnit: vm.unit, candidateUnit: c.unit, targetDecimals: vm.decimals + 1, candidateDecimals: c.decimals + 1 };
      } else if (spd) {
        const grouped = spd.kind === "category";
        const pts = spd.xs.map((x, i) => ({ x, y: spd.ys[i], cls: grouped ? spd.cls[i] : undefined }));
        const iv = interval(rec.r, rec.nEff);
        effect = {
          kind: grouped ? "eta" : "correlation",
          label: grouped ? "Share of trend differences explained by class (eta)" : "Correlation across cells",
          value: rec.r, lo: grouped ? Math.max(0, iv.lo) : iv.lo, hi: iv.hi,
          intervalNote: "Interval uses the effective number of independent cells (spatial dependence reduces it) and does not include the uncertainty of each cell's trend estimate. Indicative only.",
        };
        scope = {
          commonPeriod: { start: months[0], end: months[n - 1], months: n }, dataEnd: c.kind === "static" ? "static (2000)" : c.coverage.end,
          rawN: rec.nRaw, effN: rec.nEff, unitOfSample: "cells",
          effNMethod: "Number of cells divided by a spatial-dependence factor (2 to 5) drawn for this synthetic run",
          resolution: `${c.resolution}; compared on the 1° GLDAS grid`,
          area: `${cells} land-model cell${cells === 1 ? "" : "s"}${spd.total > 150 ? `; ${150} of them shown and used in this synthetic example` : ""}`,
        };
        const fitted = grouped ? spd.cls.map((ci) => mean(spd.ys.filter((_, i) => spd.cls[i] === ci))) : spd.xs;
        stab = makeStability(spd.ys, fitted, rec.r, srng);
        if (grouped) stab = { ...stab, text: stab.text.replace(/Split-period/, "Split-sample").replace(/Split-sample check:/, "Split-sample check (two halves of the cells):") };
        else stab = { ...stab, text: stab.text.replace("Split-period check:", "Split-sample check (two halves of the cells):").replace(/block-bootstrap/, "spatial-block bootstrap") };
        const catMeans = grouped ? spd.classNames.map((name, ci) => {
          const g = pts.filter((p) => p.cls === ci);
          return { name, mean: mean(g.map((p) => p.y)), n: g.length };
        }) : undefined;
        let fit: { a: number; b: number } | undefined;
        if (!grouped) {
          const mx = mean(spd.xs), my = mean(spd.ys);
          let sxy = 0, sxx = 0;
          spd.xs.forEach((x, i) => { sxy += (x - mx) * (spd.ys[i] - my); sxx += (x - mx) ** 2; });
          const b = sxx > 0 ? sxy / sxx : 0;
          fit = { a: my - b * mx, b };
        }
        scatter = {
          kind: grouped ? "category" : "numeric", points: pts,
          xLabel: grouped ? `${c.name} (class)` : spd.trend ? `${c.name}: trend per decade` : c.name,
          yLabel: `${vm.label}: trend per decade`,
          xUnit: spd.trend ? `${c.unit} per decade` : c.unit, yUnit: vm.trendUnit, shown: pts.length, total: spd.total, categories: catMeans, fit,
        };
      } else continue;

      // not-tested / insufficient routes for this pair
      const routeStatuses: LeadDetail["routeStatuses"] = [];
      const outc = outcomes.get(c.id)!;
      for (const r of c.routes) {
        const g = group.find((x) => x.route === r);
        const label = ROUTE_LABEL[r];
        if (!g) {
          const nt = outc.routesNotTested.find((x) => x.route === r);
          routeStatuses.push({ route: r, label, status: "not-tested", note: nt?.reason ?? "Not tested in this region." });
          continue;
        }
        if (g === rec) { routeStatuses.push({ route: r, label, status: "passed", note: `q ${fmtP(g.q)}${provisional ? ", provisional" : ""}` }); continue; }
        if (g.passed) { routeStatuses.push({ route: r, label, status: "passed", note: `q ${fmtP(g.q)}` }); continue; }
        routeStatuses.push({
          route: r, label, status: "insufficient",
          note: `effect ${fmtR(g.r)}${g.route === "lag" ? ` at lag ${g.lag > 0 ? "+" : ""}${g.lag}` : ""}, p ${fmtP(g.pRaw)}, q ${fmtP(g.q)}; q needs to be 0.05 or lower`,
        });
      }

      const vmeta = VARIABLES[t];
      const flagsOut: DependencyFlag[] = [...deps];
      if (c.note && c.id === "smap") flagsOut.push({ code: "different-definition", label: "Short record", text: c.note });
      const lead: LeadDetail = {
        id: `${t}.${c.id}.${route}`,
        target: t,
        candidate: { name: c.name, product: `${c.product} ${c.version}`, agency: c.agency, domain: c.domain, kind: c.kind },
        relation: route === "lag" ? "lagged" : route === "temporal" ? "temporal-anomaly" : "spatial-trend",
        orbColorBy: t === "et" && c.id === "gldas_tair" ? "tair" : null,
        rank: 0, provisional, synthetic: true,
        title: leadTitle(t, c, route, rec.r, rec.lag),
        route, score: 0,
        targetInfo: { label: vmeta.label, unit: vmeta.unit, definition: vmeta.what, caveat: vmeta.caveat },
        candidateInfo: {
          id: c.id, version: c.version, definition: c.definition, unit: c.unit, resolution: c.resolution,
          coverage: c.kind === "static" ? "static (single epoch)" : `${c.coverage.start} to ${c.coverage.end}`, note: c.note,
        },
        routeStatuses, scope, effect, stats: stats(), lag, seasonal, stability: stab,
        dependencies: flagsOut, notShown: NOT_SHOWN, series: seriesOut, scatter,
      };
      const qual = Math.min(1, scope.effN / 150) * (flagsOut.some((f) => f.code !== "different-definition") ? 0.85 : 1);
      const stabScore = stab.bootShare * (stab.splitAgree ? 1 : 0.5);
      lead.score = Math.abs(effect.value) * (0.5 + 0.5 * stabScore) * qual;
      if (!stab.recommended) { leadsUnstable.push(lead.id); continue; }
      leads.push(lead);
    }
  }
  // ranking: effect size x stability x quality, never p; relationship types are ranked within their own group
  const order = targets.map((t, i) => [t, i] as const);
  const tIdx = (t: VarId) => order.find((o) => o[0] === t)![1];
  leads.sort((a, b) => tIdx(a.target) - tIdx(b.target) || b.score - a.score);
  leads.forEach((l, i) => { l.rank = i + 1; });

  /* ---------- outcomes + ledger ---------- */
  for (const t of tests) {
    const o = outcomes.get(t.cand.id)!;
    o.tests++;
    if (t.passed) o.passedCorrection++;
  }
  for (const l of leads) outcomes.get(l.candidateInfo.id)!.leads++;
  for (const c of CANDIDATES) {
    if (c.duplicateOf) outcomes.set(c.id, emptyOutcome("duplicate", c.duplicateNote, { duplicateOf: c.duplicateOf }));
    else if (c.qualityOnly) outcomes.set(c.id, emptyOutcome("quality-only", c.qualityNote));
  }
  const candidates = CANDIDATES.map((c) => candidateRecord(c, outcomes.get(c.id)!));
  const naCount = science.length - eligible.length;
  const pendingPairs = [...pairKeys].filter((k) => failedIds.has(k.split("|")[1])).length;
  const passedCorrection = analysedTests.filter((t) => t.passed).length;
  const ledger: Ledger = {
    discovered, duplicatesMerged: dups.length, identified, qualityOnly: qualityOnly.length,
    fetched: identified - failedIds.size, failed: failedIds.size, notApplicable: naCount,
    eligibleCandidates: eligible.length, targets: targets.length,
    eligiblePairs: pairKeys.size, analysedPairs: pairKeys.size - pendingPairs, pendingPairs,
    familySize, testsAnalysed: analysedTests.length, testsPending: pendingTests.length, familyFinal: !provisional,
    corrected: provisional ? 0 : analysedTests.length, passedCorrection, notSignificant: analysedTests.length - passedCorrection,
    leadsRecommended: provisional ? 0 : leads.length, leadsUnstable: leadsUnstable.length, routesNotTestable,
  };

  // uncorrected signals shown (and clearly marked provisional) while the simulated run is analysing
  const seenPair = new Set<string>();
  const prov = [...analysedTests].sort((a, b) => a.pRaw - b.pRaw)
    .filter((t) => { const k = `${t.target}|${t.cand.id}`; if (seenPair.has(k)) return false; seenPair.add(k); return true; })
    .slice(0, 3).map((t) => ({
    id: `${t.target}|${t.cand.id}`,
    text: `${VARIABLES[t.target].label} and ${t.cand.short}`,
    pText: `uncorrected ${fmtP(t.pRaw).startsWith("<") ? "p" : "p ="} ${fmtP(t.pRaw)}`,
  }));

  const searched = `${targets.length} target${targets.length === 1 ? "" : "s"} × ${eligible.length} candidates × applicable routes = ${familySize} tests in one family, ` +
    `drawn from ${identified} de-duplicated entries of a synthetic candidate list. This list is a demo catalogue, not a full search of the NASA archive.`;
  const missing = [...failedIds].map((id) => {
    const c = CAND.get(id)!;
    return {
      candidate: c.name, product: `${c.product} ${c.version}`, reason: outcomes.get(id)!.reason ?? "Request failed.",
      retry: "Retry 2 of 3 scheduled; results stay provisional until it succeeds.",
      affects: `${outcomes.get(id)!.routesTested.length * targets.length} tests in the family are pending and counted as p = 1 for now`,
    };
  });

  let headline: string, message: string;
  if (scen === "complete") {
    headline = leads.length ? `Search complete: ${leads.length} lead${leads.length === 1 ? "" : "s"} found` : "Search complete: no lead passed the stability checks";
    message = `The search is complete. ${passedCorrection} of ${analysedTests.length} tests passed the family-wide correction; ${leads.length} lead${leads.length === 1 ? "" : "s"} also passed the stability checks${leadsUnstable.length ? ` (${leadsUnstable.length} did not and ${leadsUnstable.length === 1 ? "is" : "are"} listed in the run record only)` : ""}. The FDR guarantee covers the family of tests, not each lead being right.`;
  } else if (scen === "complete-none") {
    headline = "No reliable association found";
    message = `The search is complete: ${analysedTests.length} tests were run and none passed the family-wide correction. This does not prove that there is no relationship. It means this search, with this record length and these candidates, found nothing reliable. The water trends above stand on their own.`;
  } else {
    headline = `Partial: ${failedIds.size} source failed`;
    message = `${failedIds.size} source failed, so results stay provisional until it is retried. ${leads.length} candidate lead${leads.length === 1 ? "" : "s"} below ${leads.length === 1 ? "is" : "are"} provisional and carry no final recommendation. The correction is not final because ${pendingTests.length} tests are still missing.`;
  }
  return {
    ...base, ledger, candidates, leads,
    status: { headline, message, searched, missing, untestable: [] },
    provisional: prov,
  };
}

/* ------------------------------------------------------------------------------------------------ helpers */

function shiftBy(x: number[], lag: number): number[] {
  // returns x'(t) = x(t - lag) so that pairing with y(t) at index t is a pairing at lag
  const out = new Array<number>(x.length).fill(NaN);
  for (let t = 0; t < x.length; t++) { const k = t - lag; if (k >= 0 && k < x.length) out[t] = x[k]; }
  return out;
}
function rawInterval(y: number[], x: number[], lag: number, nPairs: number): Interval {
  const xs = shiftBy(x, lag);
  const r = pearson(y, xs);
  const neff = Math.max(6, Math.min(nPairs, effectiveN(r.n, y.filter(fin), xs.filter(fin))));
  return interval(r.r, neff);
}

/** A plain-object record of the run that is safe to JSON.stringify and download. */
export function exportRunRecord(run: SyntheticRun): Record<string, unknown> {
  return {
    SYNTHETIC_DEMO_DATA: true,
    notice: `${run.notice} Every number in this file is synthetic demo data generated by ${run.generator}.`,
    snapshot: run.snapshot,
    region: { id: run.regionId, name: run.regionName },
    targets: run.targets,
    scenario: run.scenario,
    scenarioIsPreviewOverride: run.scenarioForced,
    status: run.status,
    coverageLedger: run.ledger,
    frozenPolicy: run.policy,
    candidates: run.candidates.map((c) => ({
      id: c.id, name: c.name, product: c.product, version: c.version, agency: c.agency, domain: c.domain, kind: c.kind,
      outcome: c.outcome,
    })),
    leads: run.leads.map((l) => ({
      id: l.id, synthetic: true, rank: l.rank, provisional: l.provisional, target: l.target, candidate: l.candidate,
      relation: l.relation, title: l.title, scope: l.scope, effect: l.effect, stats: l.stats, lag: l.lag, seasonal: l.seasonal,
      stability: l.stability, routeStatuses: l.routeStatuses, dependencies: l.dependencies, notShown: l.notShown,
    })),
  };
}
