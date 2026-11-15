// Small display helpers shared by the detective chart, conclusion card and trend panel (workstream B).
import type { TimeRange, YearMonth } from "@/lib/detective/contracts";
import { MINUS } from "@/components/charts/time";

/** Months since year 0 for "YYYY-MM" (Jan 2000 → 24000). */
export const ymIndex = (ym: YearMonth) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
export const ymFromIndex = (k: number): YearMonth => `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;

/** "2021-02..05" within one year, "2019-09..2020-01" across years. */
export function rangeLabel(r: TimeRange): string {
  if (r.start === r.end) return r.start;
  return r.start.slice(0, 4) === r.end.slice(0, 4) ? `${r.start}..${r.end.slice(5)}` : `${r.start}..${r.end}`;
}

/** Significant-figure-aware fixed number with a real minus sign. */
export function num(x: number | null | undefined, digits = 2, signed = false): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  const d = a === 0 ? 0 : a >= 100 ? Math.max(0, digits - 2) : a >= 10 ? Math.max(0, digits - 1) : a >= 1 ? digits : Math.min(4, digits - 1 + Math.max(1, -Math.floor(Math.log10(a))));
  const s = a.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const zero = Number(a.toFixed(d)) === 0;
  if (zero) return s;
  return x < 0 ? MINUS + s : signed ? "+" + s : s;
}

export function pValue(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  if (p < 0.001) return "< 0.001";
  return p.toFixed(p < 0.01 ? 3 : 2);
}

/** Units for which "x % of normal" makes no physical sense (interval scales, anomalies). */
const ABSOLUTE_UNITS = new Set(["°C", "K", "degC", "cm"]);
export const percentMakesSense = (unit: string) => !ABSOLUTE_UNITS.has(unit.trim());

/** Percentile for display: "< 1" and "> 99" at the extremes. */
export function pct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return p < 1 ? "< 1" : p > 99 ? "> 99" : String(Math.round(p));
}
