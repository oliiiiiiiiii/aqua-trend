"use client";
// Charts for the leads panel. Self-contained SVG (d3-scale / d3-shape only). Every chart carries a synthetic mark, a
// text read-out for hover/keyboard, and a table alternative. Text wears ink tokens; marks wear identity colours.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import { line as d3line } from "d3-shape";
import type { LeadDetail } from "@/lib/synthetic";
import { fmtR, fmtSigned, lagPhrase } from "@/lib/synthetic";
import { VARIABLES } from "@/lib/variables";
import { Provenance } from "@/components/ui/Provenance";

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Frame shared by every chart: title, provenance mark, read-out row, table alternative. */
export function ChartFrame({
  title, note, marks, readout, children, table, tableLabel = "Show as a table",
}: {
  title: string; note?: ReactNode; marks: ReactNode; readout?: ReactNode; children: ReactNode; table: ReactNode; tableLabel?: string;
}) {
  return (
    <figure className="m-0 min-w-0">
      <figcaption className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[0.9375rem] font-semibold text-ink">{title}</span>
        {marks}
      </figcaption>
      {note && <p className="mb-2 mt-0 text-[0.8125rem] leading-snug text-ink-2">{note}</p>}
      {children}
      {readout !== undefined && (
        <p className="tnum mb-0 mt-1 min-h-[2.4em] text-[0.8125rem] leading-snug text-ink-2" aria-live="polite">{readout}</p>
      )}
      <details className="mt-1 text-[0.8125rem]">
        <summary className="cursor-pointer text-link underline-offset-2 hover:underline">{tableLabel}</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-ctl border border-line bg-well">{table}</div>
      </details>
    </figure>
  );
}

export const SyntheticMark = ({ children = "Synthetic" }: { children?: ReactNode }) => (
  <Provenance kind="synthetic" className="!px-2 !py-0 !text-xs">{children}</Provenance>
);

const tableCls = "tnum w-full border-collapse text-left text-[0.8125rem]";
const th = "sticky top-0 bg-well px-2 py-1 font-semibold text-ink-2";
const td = "border-t border-line px-2 py-1 text-ink";

/* ------------------------------------------------------------------------------------------------ lag curve */

export function LagChart({ lead }: { lead: LeadDetail }) {
  const lag = lead.lag!;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = Math.max(260, width), h = 210;
  const m = { l: 40, r: 18, t: 14, b: 50 };
  const ymax = useMemo(() => Math.min(1, Math.max(0.4, Math.round(Math.ceil((Math.max(...lag.curve.map((c) => Math.abs(c.r))) + 0.04) / 0.2) * 0.2 * 10) / 10)), [lag.curve]);
  const x = (l: number) => m.l + ((l + 12) / 24) * (w - m.l - m.r);
  const bw = Math.max(3, ((w - m.l - m.r) / 25) * 0.62);
  const y = scaleLinear().domain([-ymax, ymax]).range([h - m.b, m.t]);
  const color = `var(${VARIABLES[lead.target].color})`;
  const active = hover ?? lag.months;
  const cur = lag.curve.find((c) => c.lag === active)!;
  const who = active > 0 ? "candidate changes first" : active < 0 ? "target changes first" : "same month";
  const inRange = Math.abs(active) <= lag.supported[1];
  const readout = (
    <>
      <strong className="font-semibold text-ink">Lag {active > 0 ? "+" : ""}{active} month{Math.abs(active) === 1 ? "" : "s"}: r = {fmtR(cur.r)}</strong>
      {" "}({who}{inRange ? "" : "; outside the supported lag range, shown for context only"}).{" "}
      {hover === null ? "Reported lag. Hover or use the arrow keys to read other lags." : ""}
    </>
  );
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { setHover(Math.max(-12, active - 1)); e.preventDefault(); }
    if (e.key === "ArrowRight") { setHover(Math.min(12, active + 1)); e.preventDefault(); }
    if (e.key === "Escape") setHover(null);
  };
  const ticks = [-12, -6, 0, 6, 12];
  return (
    <ChartFrame
      title="Association at each lag"
      marks={<SyntheticMark>Synthetic example</SyntheticMark>}
      note={`Correlation of the anomalies at lags from −12 to +12 months. Positive lag: the candidate changes first. The shaded band is the supported lag range (±${lag.supported[1]} months).${lag.ambiguous ? " There are two near-equal peaks, both marked." : ""}`}
      readout={readout}
      table={
        <table className={tableCls}>
          <thead><tr><th className={th}>Lag (months)</th><th className={th}>Who changes first</th><th className={th}>r</th><th className={th}>Note</th></tr></thead>
          <tbody>
            {lag.curve.map((c) => (
              <tr key={c.lag}>
                <td className={td}>{c.lag > 0 ? `+${c.lag}` : c.lag}</td>
                <td className={td}>{c.lag > 0 ? "candidate" : c.lag < 0 ? "target" : "same month"}</td>
                <td className={td}>{fmtR(c.r)}</td>
                <td className={td}>{c.lag === lag.months ? "reported lag" : lag.peaks.includes(c.lag) ? "near-equal peak" : Math.abs(c.lag) > lag.supported[1] ? "outside supported range" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div ref={ref} className="w-full">
        <svg
          width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)}
          aria-label={`Lag curve, synthetic. Reported lag ${lag.months} months, r ${fmtR(lag.curve.find((c) => c.lag === lag.months)!.r)}. ${lag.ambiguous ? "Two near-equal peaks. " : ""}Use arrow keys to read each lag; a table follows.`}
          className="block max-w-full"
          onPointerLeave={() => setHover(null)}
        >
          <rect x={x(lag.supported[0]) - ((w - m.l - m.r) / 25) / 2} y={m.t} width={x(lag.supported[1]) - x(lag.supported[0]) + (w - m.l - m.r) / 25} height={h - m.b - m.t} style={{ fill: "var(--viz-grid)" }} opacity={0.55} />
          {[-ymax, -ymax / 2, 0, ymax / 2, ymax].map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} style={{ stroke: t === 0 ? "var(--viz-axis)" : "var(--viz-grid)" }} strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={m.l - 6} y={y(t) + 4} textAnchor="end" className="fill-ink-3 tnum" fontSize={11}>{t === 0 ? "0" : fmtSigned(t, 1)}</text>
            </g>
          ))}
          {lag.curve.map((c) => {
            const isRep = c.lag === lag.months, isPeak = lag.peaks.includes(c.lag) && lag.ambiguous;
            const y0 = y(0), y1 = y(c.r);
            const top = Math.min(y0, y1), hh = Math.max(1.5, Math.abs(y1 - y0));
            return (
              <g key={c.lag}>
                <rect
                  x={x(c.lag) - bw / 2} y={top} width={bw} height={hh} rx={Math.min(3, bw / 2)}
                  style={{ fill: isRep || isPeak ? color : "var(--viz-axis)" }}
                  opacity={hover === c.lag ? 1 : isRep || isPeak ? 0.95 : 0.8}
                  stroke={isPeak && !isRep ? "var(--ink)" : "none"} strokeWidth={1.5}
                />
                {(isRep || isPeak) && (
                  <text x={x(c.lag)} y={c.r >= 0 ? top - 4 : top + hh + 12} textAnchor="middle" className="fill-ink tnum" fontSize={11} fontWeight={600}>
                    {c.lag > 0 ? `+${c.lag}` : c.lag}
                  </text>
                )}
                <rect
                  x={x(c.lag) - (w - m.l - m.r) / 50} y={m.t} width={(w - m.l - m.r) / 25} height={h - m.b - m.t} fill="transparent"
                  onPointerEnter={() => setHover(c.lag)} onPointerMove={() => setHover(c.lag)}
                />
              </g>
            );
          })}
          {hover !== null && <rect x={x(hover) - bw / 2 - 2} y={m.t} width={bw + 4} height={h - m.b - m.t} fill="none" style={{ stroke: "var(--ink-3)" }} strokeDasharray="3 3" />}
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={h - m.b + 15} textAnchor="middle" className="fill-ink-2 tnum" fontSize={11}>{t > 0 ? `+${t}` : t}</text>
          ))}
          <text x={(m.l + w - m.r) / 2} y={h - m.b + 29} textAnchor="middle" className="fill-ink-3" fontSize={11}>lag in months</text>
          <text x={m.l} y={h - 6} textAnchor="start" className="fill-ink-2" fontSize={11} fontWeight={600}>target changes first</text>
          <text x={w - m.r} y={h - 6} textAnchor="end" className="fill-ink-2" fontSize={11} fontWeight={600}>candidate changes first</text>
          <text x={m.l + 4} y={m.t + 10} className="fill-ink-3" fontSize={10.5}>Synthetic example</text>
        </svg>
      </div>
    </ChartFrame>
  );
}

/* --------------------------------------------------------------------------------------- seasonal comparison */

export function SeasonChart({ lead }: { lead: LeadDetail }) {
  const s = lead.seasonal!;
  const [ref, width] = useWidth<HTMLDivElement>();
  const w = Math.max(260, width);
  const m = { l: 18, r: 18, t: 6, b: 34 };
  const rowH = 46, h = m.t + rowH * 3 + m.b;
  const x = scaleLinear().domain([-1, 1]).range([m.l, w - m.r]);
  const rows = [
    { key: "raw", label: "Raw values", iv: s.raw },
    { key: "des", label: "Seasonal cycle removed", iv: s.deseason },
    { key: "det", label: "Seasonal cycle and trend removed (used for the search)", iv: s.detrended },
  ];
  const color = `var(${VARIABLES[lead.target].color})`;
  const [hov, setHov] = useState<string | null>(null);
  const ro = rows.find((r) => r.key === hov);
  return (
    <ChartFrame
      title="Before and after removing the seasonal cycle"
      marks={<SyntheticMark>Synthetic example</SyntheticMark>}
      note={`Correlation with its interval, at ${s.atLag === 0 ? "the same month" : `lag ${s.atLag > 0 ? "+" : ""}${s.atLag} months`}. Wide intervals on raw values are expected: raw monthly series are strongly autocorrelated.`}
      readout={ro ? <><strong className="font-semibold text-ink">{ro.label}: r = {fmtR(ro.iv.r)}</strong> (interval {fmtR(ro.iv.lo)} to {fmtR(ro.iv.hi)}).</> : "Hover a row to read it. All three values are also printed on the chart."}
      table={
        <table className={tableCls}>
          <thead><tr><th className={th}>Version of the data</th><th className={th}>r</th><th className={th}>Lower</th><th className={th}>Upper</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key}><td className={td}>{r.label}</td><td className={td}>{fmtR(r.iv.r)}</td><td className={td}>{fmtR(r.iv.lo)}</td><td className={td}>{fmtR(r.iv.hi)}</td></tr>
          ))}</tbody>
        </table>
      }
    >
      <div ref={ref} className="w-full">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" className="block max-w-full" onPointerLeave={() => setHov(null)}
          aria-label={`Three correlations, synthetic: raw ${fmtR(s.raw.r)}, seasonal cycle removed ${fmtR(s.deseason.r)}, seasonal cycle and trend removed ${fmtR(s.detrended.r)}.`}>
          {[-1, -0.5, 0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={m.t} y2={h - m.b} style={{ stroke: t === 0 ? "var(--viz-axis)" : "var(--viz-grid)" }} strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={x(t)} y={h - m.b + 14} textAnchor="middle" className="fill-ink-3 tnum" fontSize={11}>{t === 0 ? "0" : fmtSigned(t, 1)}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const cy = m.t + i * rowH + 31;
            const labelRight = r.iv.r < 0;
            return (
              <g key={r.key} onPointerEnter={() => setHov(r.key)} opacity={hov && hov !== r.key ? 0.55 : 1}>
                <rect x={0} y={m.t + i * rowH} width={w} height={rowH} fill="transparent" />
                <text x={labelRight ? w - m.r : m.l} y={m.t + i * rowH + 13} textAnchor={labelRight ? "end" : "start"} className="fill-ink-2" fontSize={11.5} style={{ paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 4 }}>{r.label}</text>
                <line x1={x(r.iv.lo)} x2={x(r.iv.hi)} y1={cy} y2={cy} style={{ stroke: color }} strokeWidth={2.5} strokeLinecap="round" />
                <circle cx={x(r.iv.r)} cy={cy} r={5} style={{ fill: color, stroke: "var(--paper)" }} strokeWidth={2} />
                <text x={x(r.iv.r)} y={cy - 9} textAnchor="middle" className="fill-ink tnum" fontSize={11.5} fontWeight={600}>{fmtR(r.iv.r)}</text>
              </g>
            );
          })}
          <text x={w - m.r} y={h - 4} textAnchor="end" className="fill-ink-3" fontSize={10.5}>Synthetic example</text>
          <text x={m.l} y={h - 4} textAnchor="start" className="fill-ink-3" fontSize={10.5}>correlation, r</text>
        </svg>
      </div>
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------------------------------------ scatter */

export function ScatterChart({ lead }: { lead: LeadDetail }) {
  const sc = lead.scatter!;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = Math.max(260, width), h = Math.min(320, Math.max(230, w * 0.62));
  const m = { l: 46, r: 12, t: 12, b: 44 };
  const cat = sc.kind === "category";
  const xs = sc.points.map((p) => p.x), ys = sc.points.map((p) => p.y);
  const xdom: [number, number] = cat ? [-0.5, (sc.categories?.length ?? 1) - 0.5] : [Math.min(...xs), Math.max(...xs)];
  const x = scaleLinear().domain(xdom).range([m.l, w - m.r]);
  if (!cat) x.nice();
  const y = scaleLinear().domain([Math.min(...ys), Math.max(...ys)]).nice().range([h - m.b, m.t]);
  const color = `var(${VARIABLES[lead.target].color})`;
  const jit = (i: number) => (((i * 2654435761) % 1000) / 1000 - 0.5) * 0.55;
  const px = (p: { x: number }, i: number) => x(cat ? p.x + jit(i) : p.x);
  const hp = hover !== null ? sc.points[hover] : null;
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = -1, bd = 28 * 28;
    sc.points.forEach((p, i) => { const dx = px(p, i) - mx, dy = y(p.y) - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
    setHover(best < 0 ? null : best);
  };
  const dec = (v: number, u: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(u));
  const xTicks = cat ? [] : x.ticks(5);
  const fitLine = sc.fit && d3line<[number, number]>()([[x.domain()[0], sc.fit.a + sc.fit.b * x.domain()[0]], [x.domain()[1], sc.fit.a + sc.fit.b * x.domain()[1]]].map(([a, b]) => [x(a), y(b)] as [number, number]));
  return (
    <ChartFrame
      title={cat ? "Trend of the target in each land-cover class" : "Trend of the target against the candidate, cell by cell"}
      marks={<SyntheticMark>Synthetic example</SyntheticMark>}
      note={`One mark per 1° land-model cell${sc.total > sc.shown ? ` (${sc.shown} of ${sc.total} cells shown)` : ` (${sc.shown} cells)`}. Neighbouring cells are not independent, so the effective sample is much smaller than the count of marks.`}
      readout={hp ? (
        <><strong className="font-semibold text-ink">Cell {hover! + 1}:</strong> {cat ? sc.categories?.[hp.cls ?? 0]?.name : `${sc.xLabel} ${dec(hp.x, 2)} ${sc.xUnit}`}; target trend {fmtSigned(hp.y, 3)} {sc.yUnit}.</>
      ) : "Hover near a mark to read it."}
      tableLabel="Show cells as a table"
      table={
        <table className={tableCls}>
          <thead><tr><th className={th}>Cell</th><th className={th}>{cat ? "Class" : `${sc.xLabel} (${sc.xUnit})`}</th><th className={th}>Target trend ({sc.yUnit})</th></tr></thead>
          <tbody>{sc.points.map((p, i) => (
            <tr key={i}><td className={td}>{i + 1}</td><td className={td}>{cat ? sc.categories?.[p.cls ?? 0]?.name : dec(p.x, 2)}</td><td className={td}>{fmtSigned(p.y, 3)}</td></tr>
          ))}</tbody>
        </table>
      }
    >
      <div ref={ref} className="w-full">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" className="block max-w-full touch-pan-y" onPointerMove={move} onPointerLeave={() => setHover(null)}
          aria-label={`Scatter of ${sc.shown} cells, synthetic. Effect ${fmtR(lead.effect.value)}. A table of the cells follows.`}>
          {y.ticks(4).map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} style={{ stroke: t === 0 ? "var(--viz-axis)" : "var(--viz-grid)" }} strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={m.l - 6} y={y(t) + 4} textAnchor="end" className="fill-ink-3 tnum" fontSize={11}>{Math.abs(t) < 1e-9 ? "0" : fmtSigned(t, Math.abs(t) < 1 ? 2 : 1).replace(/^\+/, "")}</text>
            </g>
          ))}
          {cat
            ? sc.categories?.map((c, i) => (
              <g key={c.name}>
                <text x={x(i)} y={h - m.b + 15} textAnchor="middle" className="fill-ink-2" fontSize={11}>{c.name.length > 11 && w < 420 ? `${c.name.slice(0, 10)}…` : c.name}</text>
                <line x1={x(i) - 22} x2={x(i) + 22} y1={y(c.mean)} y2={y(c.mean)} style={{ stroke: "var(--ink)" }} strokeWidth={2.5} strokeLinecap="round" />
              </g>
            ))
            : xTicks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={h - m.b} y2={h - m.b + 4} style={{ stroke: "var(--viz-axis)" }} />
                <text x={x(t)} y={h - m.b + 16} textAnchor="middle" className="fill-ink-3 tnum" fontSize={11}>{dec(t, 2)}</text>
              </g>
            ))}
          {fitLine && <path d={fitLine} fill="none" style={{ stroke: "var(--ink-3)" }} strokeWidth={1.5} strokeDasharray="5 4" />}
          {sc.points.map((p, i) => (
            <circle key={i} cx={px(p, i)} cy={y(p.y)} r={hover === i ? 5.5 : 3.6} style={{ fill: color, stroke: "var(--paper)" }} strokeWidth={1.5} opacity={hover === null || hover === i ? 0.85 : 0.5} />
          ))}
          <text x={(m.l + w - m.r) / 2} y={h - 8} textAnchor="middle" className="fill-ink-2" fontSize={11}>{sc.xLabel}{cat ? "" : ` (${sc.xUnit})`}</text>
          <text x={m.l} y={m.t + 2} className="fill-ink-3" fontSize={10.5} dy={-2}>{sc.yLabel} ({sc.yUnit})</text>
          <text x={w - m.r} y={m.t + 22} textAnchor="end" className="fill-ink-3" fontSize={10.5}>Synthetic example</text>
        </svg>
      </div>
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------------------------- two aligned series */

export function SeriesChart({ lead }: { lead: LeadDetail }) {
  const se = lead.series!;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = Math.max(260, width), ph = 92, gap = 26;
  const m = { l: 44, r: 10, t: 16, b: 24 };
  const n = se.months.length;
  const x = scaleLinear().domain([0, n - 1]).range([m.l, w - m.r]);
  const mk = (vals: (number | null)[]) => {
    const f = vals.filter((v): v is number => v !== null);
    const a = Math.max(...f.map(Math.abs)) * 1.1 || 1;
    return scaleLinear().domain([-a, a]).range([ph, 0]);
  };
  const yT = useMemo(() => mk(se.target), [se.target]);
  const yC = useMemo(() => mk(se.candidate), [se.candidate]);
  const lineT = d3line<number | null>().defined((v) => v !== null).x((_, i) => x(i)).y((v) => yT(v as number));
  const lineC = d3line<number | null>().defined((v) => v !== null).x((_, i) => x(i)).y((v) => yC(v as number));
  const h = m.t + ph + gap + m.t + ph + m.b;
  const top2 = m.t + ph + gap + m.t;
  const years = se.months.map((mo, i) => [mo, i] as const).filter(([mo]) => mo.endsWith("-01") && Number(mo.slice(0, 4)) % (n > 200 ? 5 : 2) === 0);
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(x.invert(e.clientX - r.left));
    setHover(i < 0 || i >= n ? null : i);
  };
  const tcol = `var(${VARIABLES[lead.target].color})`;
  const f = (v: number | null, d: number) => (v === null ? "missing" : fmtSigned(v, d));
  const ticks = (sc: ReturnType<typeof scaleLinear>) => { const [a] = sc.domain() as [number, number]; const t = Math.abs(a) * 0.8; return [-t, 0, t]; };
  return (
    <ChartFrame
      title="The two anomaly series, side by side in time"
      marks={<><Provenance kind="real" className="!px-2 !py-0 !text-xs">Target: real GLDAS</Provenance><SyntheticMark>Candidate: synthetic</SyntheticMark></>}
      note={<>Two charts with their own scales, aligned on the same months ({se.months[0]} to {se.months[n - 1]}). Both show anomalies: seasonal cycle and linear trend removed. The candidate is plotted unshifted{lead.lag && lead.lag.months !== 0 ? `, so the ${lagPhrase(lead.lag.months)} lag is not applied here` : ""}.</>}
      readout={hover !== null ? (
        <><strong className="font-semibold text-ink">{se.months[hover]}</strong>: target {f(se.target[hover], se.targetDecimals)} {se.targetUnit}; candidate (synthetic) {f(se.candidate[hover], se.candidateDecimals)} {se.candidateUnit}.</>
      ) : "Move across the charts to read both series for one month."}
      tableLabel="Show monthly values as a table"
      table={
        <table className={tableCls}>
          <thead><tr><th className={th}>Month</th><th className={th}>{VARIABLES[lead.target].short} anomaly, real ({se.targetUnit})</th><th className={th}>{lead.candidate.name} anomaly, synthetic ({se.candidateUnit})</th></tr></thead>
          <tbody>{se.months.map((mo, i) => (
            <tr key={mo}><td className={td}>{mo}</td><td className={td}>{f(se.target[i], se.targetDecimals)}</td><td className={td}>{f(se.candidate[i], se.candidateDecimals)}</td></tr>
          ))}</tbody>
        </table>
      }
    >
      <div ref={ref} className="w-full">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" className="block max-w-full touch-pan-y" onPointerMove={move} onPointerLeave={() => setHover(null)}
          aria-label={`Two anomaly series over ${n} months: the target (real data) and the candidate (synthetic). Values are in the table below.`}>
          {[{ y: yT, off: m.t, label: `${VARIABLES[lead.target].short} anomaly (${se.targetUnit})`, tag: "Real GLDAS data", d: lineT(se.target), stroke: tcol, dash: undefined as string | undefined, vals: se.target },
            { y: yC, off: top2, label: `${lead.candidate.name} anomaly (${se.candidateUnit})`, tag: "Synthetic example", d: lineC(se.candidate), stroke: "var(--ink-2)", dash: "5 3", vals: se.candidate }].map((p, k) => (
            <g key={k} transform={`translate(0,${p.off})`}>
              {ticks(p.y).map((t, j) => (
                <g key={j}>
                  <line x1={m.l} x2={w - m.r} y1={p.y(t)} y2={p.y(t)} style={{ stroke: t === 0 ? "var(--viz-axis)" : "var(--viz-grid)" }} strokeWidth={t === 0 ? 1.5 : 1} />
                  <text x={m.l - 6} y={p.y(t) + 4} textAnchor="end" className="fill-ink-3 tnum" fontSize={10.5}>{t === 0 ? "0" : fmtSigned(t, Math.abs(t) < 1 ? 2 : 1).replace(/^\+/, "")}</text>
                </g>
              ))}
              <path d={p.d ?? ""} fill="none" style={{ stroke: p.stroke }} strokeWidth={1.6} strokeDasharray={p.dash} strokeLinejoin="round" />
              <text x={m.l} y={-5} className="fill-ink-2" fontSize={11} fontWeight={600}>{p.label}</text>
              <text x={w - m.r} y={-5} textAnchor="end" className="fill-ink-3" fontSize={10.5}>{p.tag}</text>
              {hover !== null && p.vals[hover] !== null && (
                <circle cx={x(hover)} cy={p.y(p.vals[hover] as number)} r={4} style={{ fill: p.stroke, stroke: "var(--paper)" }} strokeWidth={2} />
              )}
            </g>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={h - m.b} style={{ stroke: "var(--ink-3)" }} strokeDasharray="3 3" />}
          {years.map(([mo, i]) => (
            <text key={mo} x={x(i)} y={h - 6} textAnchor="middle" className="fill-ink-3 tnum" fontSize={11}>{mo.slice(0, 4)}</text>
          ))}
        </svg>
      </div>
    </ChartFrame>
  );
}

export { fmtR };
