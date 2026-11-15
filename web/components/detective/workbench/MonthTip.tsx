"use client";
// Tooltip body for one month of one variable: month, observed, normal, anomaly, z.
import { TipRow } from "@/components/charts/ChartTooltip";
import { formatYm } from "@/lib/detective/url";
import { num } from "../format";
import { isNum } from "./axis";
import { COPY } from "./copy";
import type { LaneReady } from "./types";

export function MonthTip({ lane, k }: { lane: LaneReady; k: number }) {
  const { d, base, meta } = lane;
  const i = k - base;
  const inRecord = i >= 0 && i < d.months.length;
  const raw = inRecord ? d.raw[i] : null;
  const normal = inRecord ? d.trend[i] + d.seasonal[i] : null;
  const r = inRecord ? d.residual[i] : null;
  const z = inRecord ? d.z[i] : null;
  const u = meta.unit;
  return (
    <>
      <div className="mb-1 font-semibold tnum">{formatYm(`${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`)}</div>
      <TipRow color="--viz-blue" value={isNum(raw) ? `${num(raw)} ${u}` : COPY.chart.missing} label={COPY.chart.observedSeries} />
      {isNum(normal) && <TipRow color="--viz-ink" dashed value={`${num(normal)} ${u}`} label={COPY.chart.normal} />}
      {isNum(r) && <TipRow value={`${num(r, 2, true)} ${u}`} label={COPY.chart.anomalySeries} />}
      {isNum(z) && <TipRow value={`${num(z, 1, true)}σ`} label={COPY.chart.z} />}
    </>
  );
}
