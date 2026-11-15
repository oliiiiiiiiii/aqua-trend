// Turns one regional monthly series into everything a target block shows. Pure; no React.
import type { RegionSeries, VarId } from "@/lib/types";
import { VARIABLES, type VariableMeta } from "@/lib/variables";
import {
  AUTOCORR_WARN, annualMeans, deseasonalise, monthlyClimatology, summariseTrend,
  type AnnualMeans, type Climatology, type TrendSummary,
} from "@/lib/stats";
import { MINUS, plain } from "@/components/charts/time";

/** Evidence wording tiers. Our own reading aids on a preliminary test, stated in the panel footnote. */
export const TIER_CLEAR_P = 0.01;
export const TIER_SUGGESTIVE_P = 0.05;
export const MIN_YEARS = 10;

export type Tier = "clear" | "suggestive" | "none" | "insufficient";
export type Direction = "rising" | "falling" | "flat";

export interface TargetAnalysis {
  id: VarId;
  meta: VariableMeta;
  values: Float32Array;
  anomalies: Float64Array;
  clim: Climatology;
  annual: AnnualMeans;
  trend: TrendSummary;
  tier: Tier;
  direction: Direction;
  /** Sen slope x 10, in the variable's unit per decade */
  perDecade: number;
  perDecadeLow: number;
  perDecadeHigh: number;
  /** Sen slope per decade as a percentage of the mean of the annual means, or null when that is not meaningful */
  pctPerDecade: number | null;
  /** the 95 % interval of the Sen slope excludes zero */
  intervalExcludesZero: boolean;
  highAutocorr: boolean;
  missingMonths: number;
}

export function tierOf(p: number, n: number): Tier {
  if (n < MIN_YEARS || !Number.isFinite(p)) return "insufficient";
  if (p < TIER_CLEAR_P) return "clear";
  if (p < TIER_SUGGESTIVE_P) return "suggestive";
  return "none";
}

/** Percent of the mean is only shown for stocks and fluxes whose mean is well away from zero. */
export function percentIsMeaningful(meta: VariableMeta, meanOfAnnual: number): boolean {
  if (meta.id === "tair" || meta.id === "p_minus_et" || meta.kind === "temperature" || meta.kind === "net") return false;
  const span = meta.domain[1] - meta.domain[0];
  return Number.isFinite(meanOfAnnual) && Math.abs(meanOfAnnual) >= 0.05 * span;
}

export function analyseTarget(series: RegionSeries, id: VarId): TargetAnalysis {
  const meta = VARIABLES[id];
  const values = series.values[id];
  const months = series.months;
  const clim = monthlyClimatology(months, values);
  const trend = summariseTrend(months, values);
  const tier = tierOf(trend.mk.p, trend.n);
  const { slope, ciLow, ciHigh } = trend.sen;
  const perDecade = slope * 10, perDecadeLow = ciLow * 10, perDecadeHigh = ciHigh * 10;
  let missing = 0;
  for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) missing++;
  return {
    id, meta, values,
    anomalies: deseasonalise(months, values, clim),
    clim,
    annual: annualMeans(months, values),
    trend, tier,
    direction: !Number.isFinite(slope) || slope === 0 ? "flat" : slope > 0 ? "rising" : "falling",
    perDecade, perDecadeLow, perDecadeHigh,
    pctPerDecade: percentIsMeaningful(meta, trend.meanOfAnnual) ? (perDecade / trend.meanOfAnnual) * 100 : null,
    intervalExcludesZero: ciLow > 0 || ciHigh < 0,
    highAutocorr: Number.isFinite(trend.lag1) && trend.lag1 > AUTOCORR_WARN,
    missingMonths: missing,
  };
}

/** Decimals that give the larger of the numbers two significant digits (shared by a slope and its interval). */
export function slopeDecimals(...xs: number[]): number {
  const ref = Math.max(...xs.filter(Number.isFinite).map(Math.abs), 0);
  if (ref === 0) return 2;
  return Math.max(0, Math.min(5, 1 - Math.floor(Math.log10(ref))));
}

export function fmtSlope(x: number, d: number): string {
  return plain(x, d);
}

export const TIER_LABEL: Record<Tier, string> = {
  clear: "Clear trend",
  suggestive: "Suggestive trend",
  none: "No clear trend",
  insufficient: "Too few complete years",
};

/** Plain-language headline, e.g. "Rising 0.12 mm/day per decade" or "No clear trend". */
export function headline(a: TargetAnalysis): string {
  if (a.tier === "insufficient") return "Not enough complete years for a trend";
  if (a.tier === "none") return "No clear trend";
  const d = slopeDecimals(a.perDecade, a.perDecadeLow, a.perDecadeHigh);
  const word = a.direction === "rising" ? "rising" : "falling";
  const amount = `${fmtSlope(Math.abs(a.perDecade), d)} ${a.meta.trendUnit}`;
  return a.tier === "clear" ? `${word[0].toUpperCase()}${word.slice(1)} ${amount}` : `Possibly ${word} ${amount}`;
}

/** The rate sentence under the headline; always the Sen slope with the Sen interval. */
export function rateLine(a: TargetAnalysis): string {
  if (a.tier === "insufficient") return `Only ${a.trend.n} complete years; at least ${MIN_YEARS} are needed.`;
  const d = slopeDecimals(a.perDecade, a.perDecadeLow, a.perDecadeHigh);
  const est = `${fmtSlope(a.perDecade, d)} ${a.meta.trendUnit}`;
  const iv = `${fmtSlope(a.perDecadeLow, d)} to ${fmtSlope(a.perDecadeHigh, d)}`;
  const zero = a.intervalExcludesZero ? "" : ", which includes zero";
  let s = `Sen slope ${est} (95 % interval ${iv}${zero}).`;
  if (a.pctPerDecade != null && Number.isFinite(a.pctPerDecade)) {
    const p = a.pctPerDecade;
    const txt = Math.abs(p) < 0.1 ? "less than 0.1" : plain(Math.abs(p), Math.abs(p) < 10 ? 1 : 0);
    s += ` About ${p < 0 ? MINUS : p > 0 ? "+" : ""}${txt} % of the ${a.trend.firstYear}–${a.trend.lastYear} mean per decade.`;
  }
  return s;
}
