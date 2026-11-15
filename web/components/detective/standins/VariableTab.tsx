"use client";
// STAND-IN for workstream B (web/components/detective/VariableTab.tsx): a plain residual line with the event shaded
// and the numbers as text, so the C flow can be checked end to end. No zoom, selection or layer views - those are B's.
// Delete at integration.
import { useMemo, useState } from "react";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { formatP } from "@/lib/stats";
import { addMonths, formatRange, ymIndex } from "@/lib/detective/url";
import type { VariableTabProps } from "../wiring";

const fmt = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

export default function StandinVariableTab({ meta, decomposition: d, event, padMonths, eventStats: s, trend, expected }: VariableTabProps) {
  const [full, setFull] = useState(false);
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const h = 220, m = { t: 12, r: 12, b: 24, l: 44 };

  const view = useMemo(() => {
    const first = ymIndex(d.months[0]), last = ymIndex(d.months[d.months.length - 1]);
    const a = full ? first : Math.max(first, ymIndex(addMonths(event.start, -padMonths)));
    const b = full ? last : Math.min(last, ymIndex(addMonths(event.end, padMonths)));
    const pts = d.months.map((mo, i) => ({ x: ymIndex(mo), y: d.residual[i] })).filter((p) => p.x >= a && p.x <= b);
    const ys = pts.map((p) => p.y).filter((y): y is number => y !== null);
    const lim = Math.max(1e-9, ...ys.map(Math.abs));
    return { a, b, pts, lim };
  }, [d, event, padMonths, full]);

  const w = Math.max(0, width);
  const x = scaleLinear().domain([view.a, Math.max(view.a + 1, view.b)]).range([m.l, w - m.r]);
  const y = scaleLinear().domain([-view.lim * 1.1, view.lim * 1.1]).range([h - m.b, m.t]).nice(4);
  const path = line<{ x: number; y: number | null }>().defined((p) => p.y !== null).x((p) => x(p.x)).y((p) => y(p.y as number))(view.pts) ?? "";
  const e0 = x(ymIndex(event.start) - 0.5), e1 = x(ymIndex(event.end) + 0.5);
  const years = [] as number[];
  for (let yr = Math.ceil(view.a / 12); yr * 12 <= view.b; yr++) years.push(yr);
  const step = Math.max(1, Math.ceil(years.length / Math.max(1, Math.floor(w / 70))));

  const dir = s.meanResidual == null ? null : s.meanResidual < 0 ? "below" : "above";
  const hypothesis = expected && dir ? ((expected === "low") === (dir === "below") ? "matches" : "does not match") : null;

  return (
    <div className="space-y-4">
      <p className="rounded-ctl bg-synthetic-bg px-3 py-1 text-sm text-synthetic">Placeholder view (workstream B builds the real chart and tools).</p>
      <div>
        <p className="text-ink-2">
          <span className="font-semibold text-ink">{meta.name}</span> · {meta.product}{!meta.nasa && " (non-NASA)"} · {meta.unit}
        </p>
        <p className="text-sm text-ink-3">{meta.definition}</p>
        {meta.caveat && <p className="mt-1 border-l-4 border-[color:var(--status-warning)] bg-well py-1 pr-2 pl-3 text-sm text-ink-2">{meta.caveat}</p>}
      </div>
      <div className="rounded-card border border-line bg-paper p-4">
        <p className="font-display text-lg">
          {s.meanResidual == null
            ? `No ${meta.name.toLowerCase()} data during ${formatRange(event)}.`
            : `${formatRange(event)}: ${meta.name.toLowerCase()} was ${fmt(Math.abs(s.meanResidual))} ${meta.unit} ${dir} normal (z = ${fmt(s.meanZ, 1)})` +
              (s.rank ? `, the ${ordinal(s.rank.position)} ${s.rank.direction === "low" ? "lowest" : "highest"} of ${s.rank.of} periods of this length since ${d.months[0].slice(0, 4)}.` : ".")}
        </p>
        {hypothesis && <p className="mt-1 text-sm text-ink-2">The expected direction ({expected}) {hypothesis} the data.</p>}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between gap-2 text-sm text-ink-3">
          <span>Residual (data − trend − seasonal cycle), {meta.unit}</span>
          <button type="button" onClick={() => setFull((f) => !f)} className="rounded-ctl border border-line px-3 py-0.5 text-ink hover:bg-well">
            {full ? `Event ± ${padMonths} months` : "Full record"}
          </button>
        </div>
        <div ref={ref} className="w-full">
          {w > 0 && (
            <svg width={w} height={h} role="img" aria-label={`Residual of ${meta.name}, event period shaded`}>
              <rect x={e0} y={m.t} width={Math.max(1, e1 - e0)} height={h - m.t - m.b} fill="var(--viz-orange)" opacity={0.16} />
              {y.ticks(4).map((t) => (
                <g key={t}>
                  <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} />
                  <text x={m.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-ink)" className="tnum">{t}</text>
                </g>
              ))}
              {years.filter((_, i) => i % step === 0).map((yr) => (
                <text key={yr} x={x(yr * 12)} y={h - 6} textAnchor="middle" fontSize={11} fill="var(--viz-ink)" className="tnum">{yr}</text>
              ))}
              <path d={path} fill="none" stroke="var(--viz-blue)" strokeWidth={1.75} />
            </svg>
          )}
        </div>
      </div>
      <details className="rounded-card border border-line p-4">
        <summary className="cursor-pointer font-semibold">Long-term trend</summary>
        <p className="mt-2 text-ink-2 tnum">
          Sen&apos;s slope {fmt(trend.senPerDecade)} {meta.unit} per decade, 95% CI [{fmt(trend.ci95?.[0] ?? null)}, {fmt(trend.ci95?.[1] ?? null)}],
          Mann–Kendall p = {formatP(trend.mkP)}: {trend.significant == null ? "not available" : trend.significant ? "significant" : "not significant"}.
        </p>
      </details>
    </div>
  );
}
