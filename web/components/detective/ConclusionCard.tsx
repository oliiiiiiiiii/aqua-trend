"use client";
// One-sentence verdict for the event period, e.g.
// "2021-02..05 降水比正常少 62%（z = −2.4），1998 年以來第 1 低。"
import type { Decomposition, IntervalStats } from "@/lib/detective/contracts";
import { num, pct, percentMakesSense, rangeLabel, ymIndex } from "./format";

export interface ConclusionCardProps {
  /** variable name shown in the sentence, e.g. "降水" */
  name: string;
  unit: string;
  d: Decomposition;
  stats: IntervalStats;
  /** hypothesis from a preset or the AI: the expected direction of the anomaly */
  expected?: "high" | "low";
}

/** Mean of trend + seasonal over the interval: what "normal" would have been. */
function normalMean(d: Decomposition, stats: IntervalStats): number | null {
  const base = ymIndex(d.months[0]);
  const s = ymIndex(stats.range.start) - base, e = ymIndex(stats.range.end) - base;
  let sum = 0, k = 0;
  for (let i = Math.max(0, s); i <= Math.min(d.months.length - 1, e); i++) {
    if (d.raw[i] == null) continue;
    sum += d.trend[i] + d.seasonal[i];
    k++;
  }
  return k ? sum / k : null;
}

/** The sentence parts, exported so the overview tab or CSV export can reuse them. */
export function conclusionText(p: ConclusionCardProps): { sentence: string; strength: "strong" | "moderate" | "weak" | "none" } {
  const { name, unit, d, stats } = p;
  const when = rangeLabel(stats.range);
  if (stats.meanResidual == null || stats.meanZ == null) {
    return { sentence: `${when} 沒有足夠的${name}資料可以判斷。`, strength: "none" };
  }
  const r = stats.meanResidual;
  const dir = r < 0 ? "少" : "多";
  const nm = normalMean(d, stats);
  const allNonNeg = d.raw.every((v) => v == null || v >= 0);
  let amount: string;
  if (percentMakesSense(unit) && allNonNeg && nm != null && nm > 0) {
    amount = `${dir} ${Math.round(Math.abs(r / nm) * 100)}%`;
  } else {
    amount = `${r < 0 ? "低" : "高"} ${num(Math.abs(r))} ${unit}`;
  }
  let sentence = `${when} ${name}比正常${amount}（z = ${num(stats.meanZ, 1, true)}）`;
  if (stats.rank) {
    const since = d.months[0].slice(0, 4);
    sentence += `，${since} 年以來第 ${stats.rank.position} ${stats.rank.direction === "low" ? "低" : "高"}`;
  }
  sentence += "。";
  const az = Math.round(Math.abs(stats.meanZ) * 10) / 10; // same rounding as the sentence
  return { sentence, strength: az >= 2 ? "strong" : az >= 1 ? "moderate" : "weak" };
}

const STRENGTH: Record<string, string> = {
  strong: "非常不尋常（|z| ≥ 2）",
  moderate: "有點不尋常（1 ≤ |z| < 2）",
  weak: "在正常範圍內（|z| < 1）",
  none: "資料不足",
};

export default function ConclusionCard(p: ConclusionCardProps) {
  const { sentence, strength } = conclusionText(p);
  const z = p.stats.meanZ;
  const actual = z == null ? null : z < 0 ? "low" : "high";
  const match = p.expected && actual ? p.expected === actual : null;
  return (
    <section aria-label="結論" className="rounded-card border border-line bg-well px-4 py-3 sm:px-5 sm:py-4" style={{ borderRadius: "min(var(--r-card), 16px)" }}>
      <p className="text-[1.0625rem] leading-snug font-semibold text-ink tnum sm:text-lg">{sentence}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: strength === "strong" ? "var(--status-critical)" : strength === "moderate" ? "var(--status-warning)" : "var(--ink-3)" }} />
          {STRENGTH[strength]}
        </span>
        {p.stats.percentile != null && <span className="tnum">百分位 {pct(p.stats.percentile)}</span>}
        {p.expected && match != null && (
          <span className={match ? "font-semibold text-real" : "font-semibold text-synthetic"}>
            {match ? "✓" : "✗"} 預期偏{p.expected === "low" ? "低" : "高"}，實際偏{actual === "low" ? "低" : "高"}
          </span>
        )}
      </div>
    </section>
  );
}
