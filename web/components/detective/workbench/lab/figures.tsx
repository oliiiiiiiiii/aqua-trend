"use client";
// Small inline figures of the "Tests" result card: autocorrelation by lag, histogram with a normal
// curve, bootstrap / permutation distributions, cumulative anomaly, anomaly by calendar month and the
// periodogram. Thin marks, tokens only, the same axis text as LaneChart; hovering a mark shows its
// value (SVG title). No frames: the figure sits on the panel with a baseline hairline only.
import type { ReactNode } from "react";
import type {
  AcfResult, BootstrapResult, CusumResult, HistBin, MonthlyResult, NormalityResult, PermutationResult, SpectrumResult,
} from "@/lib/detective/lab";
import type { AnalogResult, BocpdResult, DiscordResult, ForecastResult, GpResult, HmmResult, IForestResult } from "@/lib/detective/ml";
import type { YearMonth } from "@/lib/detective/contracts";
import { formatYm } from "@/lib/detective/url";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { num } from "../../format";
import { COPY } from "../copy";
import { anomalyColor } from "../types";
import { bandColor } from "./overlay";

const H = 104, TOP = 8, BOTTOM = 18, LEFT = 38, RIGHT = 10;
const axisText = { fill: "var(--ink-2)", fontSize: 10 } as const;
const mutedText = { ...axisText, fill: "var(--ink-3)" } as const;
const F = COPY.lab.fig;

function Frame({ label, children, height = H }: { label: string; children: (w: number) => ReactNode; height?: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  return (
    <div ref={ref} role="img" aria-label={label} className="mt-3 w-full max-w-[32rem]" style={{ height }}>
      {width > 0 && <svg width={width} height={height} className="block overflow-visible">{children(width)}</svg>}
    </div>
  );
}

type Swatch = "bar" | "curve" | "est" | "ci" | "zero" | "dash" | "dot" | "band";

function FigLegend({ items }: { items: { swatch: Swatch; text: string; color?: string }[] }) {
  const vline = (sw: Swatch) => (
    <line x1={7} x2={7} y1={0} y2={10} strokeWidth={sw === "est" ? 2 : 1} strokeDasharray={sw === "ci" ? "3 2" : sw === "zero" ? "1 2" : undefined}
      style={{ stroke: sw === "zero" ? "var(--ink-3)" : "var(--ink)" }} />
  );
  return (
    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
      {items.map((it) => (
        <span key={it.text} className="inline-flex items-center gap-1.5">
          <svg width="14" height="10" aria-hidden="true">
            {it.swatch === "bar" ? <rect x={2} y={1} width={10} height={8} rx={1} style={{ fill: it.color ?? "var(--viz-blue)", opacity: 0.75 }} />
              : it.swatch === "band" ? <rect x={0} y={0} width={14} height={10} style={{ fill: it.color ?? "var(--ink)", opacity: 0.18 }} />
              : it.swatch === "curve" ? <line x1={0} x2={14} y1={5} y2={5} strokeWidth={1.75} style={{ stroke: it.color ?? "var(--viz-ink)" }} />
              : it.swatch === "dash" ? <line x1={0} x2={14} y1={5} y2={5} strokeWidth={1.25} strokeDasharray="4 3" style={{ stroke: "var(--ink-2)" }} />
              : it.swatch === "dot" ? <circle cx={7} cy={5} r={2.5} style={{ fill: it.color ?? "var(--viz-blue)" }} />
              : vline(it.swatch)}
          </svg>
          {it.text}
        </span>
      ))}
    </p>
  );
}

/* ------------------------------------------------------------------ ACF */

export function AcfFigure({ s }: { s: AcfResult }) {
  const ih = H - TOP - BOTTOM;
  const rs = s.acf.filter((r): r is number => r != null);
  const M = Math.min(1, Math.ceil(Math.max(s.band, ...rs.map(Math.abs)) * 1.15 * 10) / 10) || 1;
  const y = (r: number) => TOP + ih / 2 - (r / M) * (ih / 2);
  return (
    <Frame label={F.acf}>
      {(w) => {
        const iw = w - LEFT - RIGHT, step = iw / s.acf.length;
        const bw = Math.max(2, Math.min(8, step * 0.45));
        const cx = (k: number) => LEFT + step * (k + 0.5);
        return (
          <>
            <rect x={LEFT} width={iw} y={y(s.band)} height={y(-s.band) - y(s.band)} style={{ fill: "var(--ink)", opacity: 0.06 }} />
            {[s.band, -s.band].map((b) => (
              <line key={b} x1={LEFT} x2={LEFT + iw} y1={y(b)} y2={y(b)} strokeWidth={1} strokeDasharray="3 3" style={{ stroke: "var(--ink-3)" }} />
            ))}
            <line x1={LEFT} x2={LEFT + iw} y1={y(0)} y2={y(0)} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
            {[M, -M].map((v) => (
              <text key={v} x={LEFT - 5} y={y(v)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>{num(v, 1, true)}</text>
            ))}
            {s.acf.map((r, k) => r == null ? null : (
              <rect key={k} x={cx(k) - bw / 2} width={bw} y={Math.min(y(0), y(r))} height={Math.max(0.75, Math.abs(y(r) - y(0)))} rx={1}
                style={{ fill: Math.abs(r) > s.band ? "var(--viz-blue)" : "var(--ink-3)" }}>
                <title>{F.bar(k + 1, num(r, 2, true))}</title>
              </rect>
            ))}
            {[0, 5, 11].filter((k) => k < s.acf.length).map((k) => (
              <text key={k} x={cx(k)} y={H - 4} textAnchor="middle" className="tnum" style={axisText}>{k + 1}</text>
            ))}
            <text x={(cx(5) + cx(11)) / 2} y={H - 4} textAnchor="middle" style={mutedText}>{F.lag}</text>
            <text x={LEFT + iw} y={y(s.band) - 3} textAnchor="end" style={mutedText}>{F.band}</text>
          </>
        );
      }}
    </Frame>
  );
}

/* ------------------------------------------------------------------ histograms */

interface Mark { at: number; kind: "est" | "ci" | "zero"; label?: string }

function Histogram({ bins, label, marks = [], curve, fmt }: {
  bins: HistBin[];
  label: string;
  marks?: Mark[];
  /** expected count per bin at x (normal curve) */
  curve?: (x: number) => number;
  fmt: (v: number) => string;
}) {
  if (!bins.length) return null;
  const ih = H - TOP - BOTTOM;
  let lo = bins[0].x0, hi = bins[bins.length - 1].x1;
  for (const m of marks) { lo = Math.min(lo, m.at); hi = Math.max(hi, m.at); }
  const top = Math.max(1, ...bins.map((b) => b.count), ...(curve ? bins.map((b) => curve((b.x0 + b.x1) / 2)) : []));
  const y = (c: number) => TOP + ih - (c / top) * ih;
  return (
    <Frame label={label}>
      {(w) => {
        const iw = w - LEFT - RIGHT;
        const x = (v: number) => LEFT + ((v - lo) / (hi - lo || 1)) * iw;
        let path = "";
        if (curve) for (let k = 0; k <= 80; k++) { const v = lo + ((hi - lo) * k) / 80; path += `${k ? "L" : "M"}${x(v).toFixed(1)} ${y(curve(v)).toFixed(1)}`; }
        const ticks = marks.filter((m) => m.label);
        return (
          <>
            {bins.map((b, k) => {
              const x0 = x(b.x0) + 1, x1 = x(b.x1) - 1;
              return b.count > 0 && (
                <rect key={k} x={x0} width={Math.max(0.75, x1 - x0)} y={y(b.count)} height={y(0) - y(b.count)} rx={1} style={{ fill: "var(--viz-blue)", opacity: 0.75 }}>
                  <title>{F.bin(fmt(b.x0), fmt(b.x1), b.count)}</title>
                </rect>
              );
            })}
            <line x1={LEFT} x2={LEFT + iw} y1={y(0)} y2={y(0)} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
            {curve && <path d={path} fill="none" strokeWidth={1.5} strokeLinejoin="round" style={{ stroke: "var(--viz-ink)" }} />}
            {marks.map((m, i) => (
              <line key={i} x1={x(m.at)} x2={x(m.at)} y1={TOP - 2} y2={y(0)} strokeWidth={m.kind === "est" ? 2 : 1}
                strokeDasharray={m.kind === "ci" ? "4 3" : m.kind === "zero" ? "1 3" : undefined}
                style={{ stroke: m.kind === "zero" ? "var(--ink-3)" : "var(--ink)" }} />
            ))}
            {ticks.map((m, i) => (
              <text key={i} x={x(m.at)} y={H - 4} textAnchor={i === 0 && ticks.length > 1 ? "end" : i === ticks.length - 1 && ticks.length > 1 ? "start" : "middle"}
                className="tnum" style={axisText}>{m.label}</text>
            ))}
            {!ticks.length && (
              <>
                <text x={LEFT} y={H - 4} textAnchor="start" className="tnum" style={axisText}>{fmt(lo)}</text>
                <text x={LEFT + iw} y={H - 4} textAnchor="end" className="tnum" style={axisText}>{fmt(hi)}</text>
              </>
            )}
            <text x={LEFT - 5} y={y(top)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>{Math.round(top)}</text>
            <text x={LEFT - 5} y={y(0)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>0</text>
          </>
        );
      }}
    </Frame>
  );
}

export function NormalFigure({ s, unit }: { s: NormalityResult; unit: string }) {
  const w = s.hist.length ? s.hist[0].x1 - s.hist[0].x0 : 1;
  const pdf = (x: number) => (s.sd > 0 ? Math.exp(-((x - s.mean) ** 2) / (2 * s.sd * s.sd)) / (s.sd * Math.sqrt(2 * Math.PI)) : 0);
  return (
    <>
      <Histogram bins={s.hist} label={F.hist} curve={(x) => pdf(x) * s.n * w} fmt={(v) => `${num(v, 2, true)} ${unit}`} />
      <FigLegend items={[{ swatch: "bar", text: COPY.chart.anomalySeries }, { swatch: "curve", text: F.normal }]} />
    </>
  );
}

/** keep 0 on the axis only when it is not far outside the distribution */
const nearZero = (bins: HistBin[]) => {
  if (!bins.length) return false;
  const lo = bins[0].x0, hi = bins[bins.length - 1].x1, span = hi - lo;
  return 0 >= lo - 1.5 * span && 0 <= hi + 1.5 * span;
};

export function BootFigure({ s, k, unit }: { s: BootstrapResult; k: number; unit: string }) {
  const b = s.slope;
  const fmt = (v: number) => num(v * k, 2, true);
  const zero = nearZero(b.hist);
  const marks: Mark[] = [
    { at: b.ci95[0], kind: "ci", label: fmt(b.ci95[0]) },
    { at: b.est, kind: "est" },
    { at: b.ci95[1], kind: "ci", label: fmt(b.ci95[1]) },
    ...(zero ? [{ at: 0, kind: "zero" as const }] : []),
  ];
  return (
    <>
      <Histogram bins={b.hist} label={F.boot} marks={marks} fmt={(v) => `${fmt(v)} ${unit}`} />
      <FigLegend items={[{ swatch: "est", text: F.est }, { swatch: "ci", text: F.ci }, ...(zero ? [{ swatch: "zero" as const, text: "0" }] : [])]} />
    </>
  );
}

export function PermFigure({ s, k, unit }: { s: PermutationResult; k: number; unit: string }) {
  const fmt = (v: number) => num(v * k, 2, true);
  const marks: Mark[] = [
    { at: -s.slope, kind: "ci", label: fmt(-s.slope) },
    { at: 0, kind: "zero" },
    { at: s.slope, kind: "est", label: fmt(s.slope) },
  ].sort((a, b) => a.at - b.at) as Mark[];
  return (
    <>
      <Histogram bins={s.hist} label={F.perm} marks={marks} fmt={(v) => `${fmt(v)} ${unit}`} />
      <FigLegend items={[{ swatch: "bar", text: F.shuffled }, { swatch: "est", text: F.observed }, { swatch: "ci", text: `−${F.observed}` }]} />
    </>
  );
}

/* ------------------------------------------------------------------ line figures */

export function CusumFigure({ s, months, polarity }: { s: CusumResult; months: readonly YearMonth[]; polarity: "cool" | "warm" }) {
  if (!s.points.length) return null;
  const ih = H - TOP - BOTTOM;
  const xs = s.points.map((p) => p.x), cs = s.points.map((p) => p.c);
  const x0 = xs[0], x1 = xs[xs.length - 1] + 1;
  let lo = Math.min(0, ...cs), hi = Math.max(0, ...cs);
  if (lo === hi) { lo -= 1; hi += 1; }
  const y = (v: number) => TOP + ih - ((v - lo) / (hi - lo)) * ih;
  const deficitColor = anomalyColor(false, polarity), surplusColor = anomalyColor(true, polarity);
  return (
    <>
      <Frame label={F.cusum}>
        {(w) => {
          const iw = w - LEFT - RIGHT;
          const x = (m: number) => LEFT + ((m - x0) / (x1 - x0 || 1)) * iw;
          const cx = (m: number) => x(m + 0.5);
          // the running sum, broken at missing months
          let d = "", prev: number | null = null;
          for (const p of s.points) { d += `${prev != null && p.x === prev + 1 ? "L" : "M"}${cx(p.x).toFixed(1)} ${y(p.c).toFixed(1)}`; prev = p.x; }
          const band = (r: { from: number; to: number } | null, color: string) =>
            r && <rect x={x(r.from)} width={Math.max(1, x(r.to + 1) - x(r.from))} y={TOP} height={ih} style={{ fill: color, opacity: 0.16 }} />;
          return (
            <>
              {band(s.deficit, deficitColor)}
              {band(s.surplus, surplusColor)}
              <line x1={LEFT} x2={LEFT + iw} y1={y(0)} y2={y(0)} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
              <path d={d} fill="none" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--viz-ink)" }} />
              {[hi, lo].map((v) => (
                <text key={v} x={LEFT - 5} y={y(v)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>{num(v, 2, true)}</text>
              ))}
              <text x={LEFT} y={H - 4} className="tnum" style={axisText}>{months[x0] ? formatYm(months[x0]) : ""}</text>
              <text x={LEFT + iw} y={H - 4} textAnchor="end" className="tnum" style={axisText}>{months[x1 - 1] ? formatYm(months[x1 - 1]) : ""}</text>
            </>
          );
        }}
      </Frame>
      <FigLegend items={[
        { swatch: "curve", text: F.cusum },
        ...(s.deficit ? [{ swatch: "band" as const, text: COPY.lab.cell.deficit, color: deficitColor }] : []),
        ...(s.surplus ? [{ swatch: "band" as const, text: COPY.lab.cell.surplus, color: surplusColor }] : []),
      ]} />
    </>
  );
}

const PERIOD_TICKS = [3, 6, 12, 24, 60, 120, 240];

export function SpectrumFigure({ s }: { s: SpectrumResult }) {
  if (!s.freq.length) return null;
  const ih = H - TOP - BOTTOM;
  // period on a log axis, long periods on the left
  const periods = s.freq.map((f) => 1 / f);
  const pMin = Math.min(...periods), pMax = Math.max(...periods);
  const top = Math.max(...s.power, ...s.threshold) * 1.08;
  const y = (v: number) => TOP + ih - (v / top) * ih;
  return (
    <>
      <Frame label={F.spectrum}>
        {(w) => {
          const iw = w - LEFT - RIGHT;
          const x = (p: number) => LEFT + ((Math.log(pMax) - Math.log(p)) / (Math.log(pMax) - Math.log(pMin) || 1)) * iw;
          const path = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(periods[i]).toFixed(1)} ${y(v).toFixed(1)}`).join("");
          return (
            <>
              <line x1={LEFT} x2={LEFT + iw} y1={y(0)} y2={y(0)} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
              <path d={path(s.threshold)} fill="none" strokeWidth={1.25} strokeDasharray="4 3" style={{ stroke: "var(--ink-2)" }} />
              <path d={path(s.power)} fill="none" strokeWidth={1.5} strokeLinejoin="round" style={{ stroke: "var(--viz-blue)" }} />
              {s.peaks.map((pk, i) => (
                <circle key={i} cx={x(pk.period)} cy={y(pk.power)} r={3.5} strokeWidth={1.5}
                  style={{ fill: pk.significant ? "var(--viz-blue)" : "var(--paper)", stroke: "var(--viz-blue)" }}>
                  <title>{`${F.period(pk.period)}: ${num(pk.power, 2)}`}</title>
                </circle>
              ))}
              {PERIOD_TICKS.filter((p) => p >= pMin && p <= pMax).map((p) => (
                <g key={p}>
                  <line x1={x(p)} x2={x(p)} y1={y(0)} y2={y(0) + 3} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
                  <text x={x(p)} y={H - 4} textAnchor="middle" className="tnum" style={axisText}>{F.period(p)}</text>
                </g>
              ))}
              <text x={LEFT - 5} y={y(Math.floor(top))} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>{Math.floor(top)}</text>
              <text x={LEFT - 5} y={y(0)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>0</text>
            </>
          );
        }}
      </Frame>
      <FigLegend items={[{ swatch: "curve", text: F.power, color: "var(--viz-blue)" }, { swatch: "dash", text: F.redNoise }]} />
    </>
  );
}

const MONTH_INITIAL = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export function MonthlyFigure({ s, polarity, unit }: { s: MonthlyResult; polarity: "cool" | "warm"; unit: string }) {
  const ih = H - TOP - BOTTOM;
  const vals = s.byMonth.flatMap((g) => g.values);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const y = (v: number) => TOP + ih - ((v - lo) / (hi - lo)) * ih;
  return (
    <>
      <Frame label={F.monthly}>
        {(w) => {
          const iw = w - LEFT - RIGHT, col = iw / 12;
          return (
            <>
              <line x1={LEFT} x2={LEFT + iw} y1={y(0)} y2={y(0)} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
              {s.byMonth.map((g, m) => (
                <g key={m}>
                  {g.values.map((v, k) => (
                    <circle key={k} cx={LEFT + col * (m + 0.5) + ((k % 5) - 2) * Math.min(2.5, col / 8)} cy={y(v)} r={2}
                      style={{ fill: anomalyColor(v >= 0, polarity), opacity: 0.7 }} />
                  ))}
                  {Number.isFinite(g.mean) && (
                    <line x1={LEFT + col * m + col * 0.18} x2={LEFT + col * (m + 1) - col * 0.18} y1={y(g.mean)} y2={y(g.mean)} strokeWidth={2} strokeLinecap="round" style={{ stroke: "var(--ink)" }}>
                      <title>{`${MONTH_INITIAL[m]}: ${num(g.mean, 2, true)} ${unit} (n = ${g.n})`}</title>
                    </line>
                  )}
                  <text x={LEFT + col * (m + 0.5)} y={H - 4} textAnchor="middle" style={axisText}>{MONTH_INITIAL[m]}</text>
                </g>
              ))}
              {[hi, lo].map((v) => (
                <text key={v} x={LEFT - 5} y={y(v)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>{num(v, 2, true)}</text>
              ))}
            </>
          );
        }}
      </Frame>
      <FigLegend items={[
        { swatch: "dot", text: COPY.chart.aboveNormal, color: anomalyColor(true, polarity) },
        { swatch: "dot", text: COPY.chart.belowNormal, color: anomalyColor(false, polarity) },
        { swatch: "curve", text: F.monthMean, color: "var(--ink)" },
      ]} />
    </>
  );
}

/* ------------------------------------------------------------------ machine-learning figures */

const FM = COPY.lab.ml.fig;
type Num = number | null | undefined;
const fin = (v: Num): v is number => v != null && Number.isFinite(v);

/** a polyline broken at missing values */
function brokenPath(vals: readonly Num[], x: (k: number) => number, y: (v: number) => number): string {
  let d = "", pen = false;
  vals.forEach((v, k) => {
    if (!fin(v)) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(k).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** first and last month under a time-based figure */
function MonthEnds({ x0, x1, months, left, right, y }: { x0: number; x1: number; months: readonly YearMonth[]; left: number; right: number; y: number }) {
  return (
    <>
      <text x={left} y={y} className="tnum" style={axisText}>{months[x0] ? formatYm(months[x0]) : ""}</text>
      <text x={right} y={y} textAnchor="end" className="tnum" style={axisText}>{months[x1] ? formatYm(months[x1]) : ""}</text>
    </>
  );
}

/** [lo, hi] of the finite values, widened a little; never empty */
function extent(vals: readonly Num[], keepZero = false): [number, number] {
  let lo = keepZero ? 0 : Infinity, hi = keepZero ? 0 : -Infinity;
  for (const v of vals) if (fin(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) return [0, 1];
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

function YEnds({ lo, hi, y, left, digits = 2 }: { lo: number; hi: number; y: (v: number) => number; left: number; digits?: number }) {
  return (
    <>
      {[hi, lo].map((v) => (
        <text key={v} x={left - 5} y={y(v)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>{num(v, digits, true)}</text>
      ))}
    </>
  );
}

export function AnalogFigure({ s }: { s: AnalogResult }) {
  const ih = H - TOP - BOTTOM;
  const L = s.query.length;
  const [lo, hi] = extent([...s.query, ...s.matches.flatMap((m) => m.values)]);
  const y = (v: number) => TOP + ih - ((v - lo) / (hi - lo)) * ih;
  const dash = [undefined, "5 3", "1.5 3"];
  return (
    <>
      <Frame label={FM.analog}>
        {(w) => {
          const iw = w - LEFT - RIGHT - 8;
          const x = (k: number) => LEFT + (L > 1 ? (k / (L - 1)) * iw : iw / 2);
          return (
            <>
              {lo < 0 && hi > 0 && <line x1={LEFT} x2={LEFT + iw} y1={y(0)} y2={y(0)} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />}
              {s.matches.map((m, i) => (
                <g key={m.start}>
                  <path d={brokenPath(m.values, x, y)} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dash[i]} style={{ stroke: "var(--viz-blue)" }} />
                  {(() => { const last = [...m.values].reverse().find(fin); return last != null && <text x={LEFT + iw + 4} y={y(last)} dy="0.32em" style={{ ...axisText, fill: "var(--viz-blue)", fontWeight: 700 }}>{i + 1}</text>; })()}
                </g>
              ))}
              <path d={brokenPath(s.query, x, y)} fill="none" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--ink)" }} />
              <YEnds lo={lo} hi={hi} y={y} left={LEFT} />
              <text x={LEFT} y={H - 4} className="tnum" style={axisText}>{FM.monthOfSpan(1)}</text>
              <text x={LEFT + iw} y={H - 4} textAnchor="end" className="tnum" style={axisText}>{FM.monthOfSpan(L)}</text>
            </>
          );
        }}
      </Frame>
      <FigLegend items={[{ swatch: "curve", text: FM.range, color: "var(--ink)" }, { swatch: "curve", text: COPY.lab.band.similar, color: "var(--viz-blue)" }]} />
    </>
  );
}

export function HmmFigure({ s, months, polarity }: { s: HmmResult; months: readonly YearMonth[]; polarity: "cool" | "warm" }) {
  const n = s.path.length;
  if (!n) return null;
  const SH = 40, h = SH + 22;
  const lowC = bandColor("low", polarity), highC = bandColor("high", polarity);
  return (
    <>
      <Frame label={FM.hmm} height={h}>
        {(w) => {
          const iw = w - LEFT - RIGHT, col = iw / n;
          return (
            <>
              <rect x={LEFT} y={TOP} width={iw} height={SH} style={{ fill: "var(--ink)", opacity: 0.05 }} />
              {s.pHigh.map((ph, k) => {
                const pl = s.pLow[k];
                const x = LEFT + col * k, bw = Math.max(0.75, col - (col > 4 ? 0.5 : 0));
                return (
                  <g key={k}>
                    {ph > 0.01 && <rect x={x} width={bw} y={TOP} height={SH * ph} style={{ fill: highC, opacity: 0.85 }} />}
                    {pl > 0.01 && <rect x={x} width={bw} y={TOP + SH * (1 - pl)} height={SH * pl} style={{ fill: lowC, opacity: 0.85 }} />}
                    <rect x={x} width={Math.max(col, 1)} y={TOP} height={SH} fill="transparent">
                      <title>{FM.pState(months[s.start + k] ? formatYm(months[s.start + k]) : "", Math.round(pl * 100), Math.round(ph * 100))}</title>
                    </rect>
                  </g>
                );
              })}
              <text x={LEFT - 5} y={TOP} dy="0.9em" textAnchor="end" style={axisText}>{FM.pHigh.split(" ")[0]}</text>
              <text x={LEFT - 5} y={TOP + SH} textAnchor="end" style={axisText}>{FM.pLow.split(" ")[0]}</text>
              <MonthEnds x0={s.start} x1={s.start + n - 1} months={months} left={LEFT} right={LEFT + iw} y={h - 4} />
            </>
          );
        }}
      </Frame>
      <FigLegend items={[{ swatch: "band", text: FM.pLow, color: lowC }, { swatch: "band", text: FM.pHigh, color: highC }]} />
    </>
  );
}

export function ForecastFigure({ s, months }: { s: ForecastResult; months: readonly YearMonth[] }) {
  const n = s.forecast.length;
  const ih = H - TOP - BOTTOM;
  const [lo, hi] = extent([...s.lo, ...s.hi, ...s.actual], true);
  const y = (v: number) => TOP + ih - ((v - lo) / (hi - lo)) * ih;
  return (
    <>
      <Frame label={FM.forecast}>
        {(w) => {
          const iw = w - LEFT - RIGHT;
          const x = (k: number) => LEFT + (n > 1 ? (k / (n - 1)) * iw : iw / 2);
          const poly = s.hi.map((v, k) => `${k ? "L" : "M"}${x(k).toFixed(1)} ${y(v).toFixed(1)}`).join("")
            + s.lo.map((_, k) => { const j = n - 1 - k; return `L${x(j).toFixed(1)} ${y(s.lo[j]).toFixed(1)}`; }).join("") + "Z";
          return (
            <>
              <line x1={LEFT} x2={LEFT + iw} y1={y(0)} y2={y(0)} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
              <path d={poly} style={{ fill: "var(--ink)", opacity: 0.1 }} />
              <path d={brokenPath(s.forecast, x, y)} fill="none" strokeWidth={1.5} strokeDasharray="5 3" style={{ stroke: "var(--ink)" }} />
              <path d={brokenPath(s.actual, x, y)} fill="none" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--viz-blue)" }} />
              {s.actual.map((v, k) => fin(v) && (v < s.lo[k] || v > s.hi[k]) && (
                <circle key={k} cx={x(k)} cy={y(v)} r={3} strokeWidth={1.5} style={{ fill: "var(--paper)", stroke: "var(--viz-blue)" }} />
              ))}
              <YEnds lo={lo} hi={hi} y={y} left={LEFT} />
              <MonthEnds x0={s.start} x1={s.start + n - 1} months={months} left={LEFT} right={LEFT + iw} y={H - 4} />
            </>
          );
        }}
      </Frame>
      <FigLegend items={[
        { swatch: "curve", text: FM.observed, color: "var(--viz-blue)" },
        { swatch: "dash", text: FM.forecastLine },
        { swatch: "band", text: FM.band },
      ]} />
    </>
  );
}

export function DiscordFigure({ s, months }: { s: DiscordResult; months: readonly YearMonth[] }) {
  if (!s.profile.length) return null;
  const ih = H - TOP - BOTTOM;
  const w0 = s.windows.find((q) => q.m === s.profileM);
  const x0 = s.profile[0].x, x1 = s.profile[s.profile.length - 1].x;
  const hi = Math.max(...s.profile.map((p) => p.d), w0?.typical ?? 0) * 1.08 || 1;
  const y = (v: number) => TOP + ih - (v / hi) * ih;
  const peak = s.profile.reduce((b, p) => (p.d > b.d ? p : b), s.profile[0]);
  return (
    <>
      <Frame label={FM.discord}>
        {(w) => {
          const iw = w - LEFT - RIGHT;
          const x = (m: number) => LEFT + (x1 > x0 ? ((m - x0) / (x1 - x0)) * iw : iw / 2);
          const d = s.profile.map((p, i) => `${i && p.x === s.profile[i - 1].x + 1 ? "L" : "M"}${x(p.x).toFixed(1)} ${y(p.d).toFixed(1)}`).join("");
          return (
            <>
              <line x1={LEFT} x2={LEFT + iw} y1={y(0)} y2={y(0)} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
              {w0 && Number.isFinite(w0.typical) && <line x1={LEFT} x2={LEFT + iw} y1={y(w0.typical)} y2={y(w0.typical)} strokeWidth={1.25} strokeDasharray="4 3" style={{ stroke: "var(--ink-2)" }} />}
              <path d={d} fill="none" strokeWidth={1.75} strokeLinejoin="round" style={{ stroke: "var(--viz-blue)" }} />
              <circle cx={x(peak.x)} cy={y(peak.d)} r={3.5} strokeWidth={1.5} style={{ fill: "var(--viz-blue)", stroke: "var(--paper)" }}>
                <title>{FM.score(months[peak.x] ? formatYm(months[peak.x]) : "", num(peak.d, 2))}</title>
              </circle>
              <YEnds lo={0} hi={hi} y={y} left={LEFT} />
              <MonthEnds x0={x0} x1={x1} months={months} left={LEFT} right={LEFT + iw} y={H - 4} />
            </>
          );
        }}
      </Frame>
      <FigLegend items={[{ swatch: "curve", text: FM.discord.split(":")[0], color: "var(--viz-blue)" }, { swatch: "dash", text: FM.typical }]} />
    </>
  );
}

export function IforestFigure({ s, months, polarity }: { s: IForestResult; months: readonly YearMonth[]; polarity: "cool" | "warm" }) {
  const n = s.scores.length;
  const ih = H - TOP - BOTTOM;
  const vals = s.scores.filter(fin);
  if (!vals.length) return null;
  const hi = Math.max(...vals, s.threshold) * 1.08, lo = Math.max(0, Math.min(...vals, s.threshold) * 0.8);
  const y = (v: number) => TOP + ih - ((Math.max(v, lo) - lo) / (hi - lo)) * ih;
  const flagged = new Map(s.flagged.map((f) => [f.x, f.value]));
  return (
    <>
      <Frame label={FM.iforest}>
        {(w) => {
          const iw = w - LEFT - RIGHT, col = iw / n, bw = Math.max(1, col - (col > 4 ? 1 : 0));
          return (
            <>
              <line x1={LEFT} x2={LEFT + iw} y1={y(lo)} y2={y(lo)} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
              {s.scores.map((v, k) => {
                if (!fin(v)) return null;
                const f = flagged.get(s.start + k);
                const fill = f != null ? bandColor(f >= 0 ? "high" : "low", polarity) : "var(--ink-3)";
                return (
                  <rect key={k} x={LEFT + col * k} width={bw} y={y(v)} height={Math.max(0.75, y(lo) - y(v))} style={{ fill, opacity: f != null ? 0.95 : 0.55 }}>
                    <title>{FM.score(months[s.start + k] ? formatYm(months[s.start + k]) : "", num(v, 2))}</title>
                  </rect>
                );
              })}
              <line x1={LEFT} x2={LEFT + iw} y1={y(s.threshold)} y2={y(s.threshold)} strokeWidth={1.25} strokeDasharray="4 3" style={{ stroke: "var(--ink)" }} />
              <text x={LEFT + iw} y={y(s.threshold) - 3} textAnchor="end" style={mutedText}>{FM.cutoff}</text>
              <YEnds lo={lo} hi={hi} y={y} left={LEFT} />
              <MonthEnds x0={s.start} x1={s.start + n - 1} months={months} left={LEFT} right={LEFT + iw} y={H - 4} />
            </>
          );
        }}
      </Frame>
      <FigLegend items={[
        { swatch: "bar", text: COPY.lab.band.flaggedHigh, color: bandColor("high", polarity) },
        { swatch: "bar", text: COPY.lab.band.flaggedLow, color: bandColor("low", polarity) },
        { swatch: "dash", text: FM.cutoff },
      ]} />
    </>
  );
}

export function BocpdFigure({ s, months }: { s: BocpdResult; months: readonly YearMonth[] }) {
  if (!s.prob.length) return null;
  const ih = H - TOP - BOTTOM;
  const x0 = s.prob[0].x, x1 = s.prob[s.prob.length - 1].x;
  const y = (p: number) => TOP + ih - p * ih;
  const changes = new Set(s.changes.map((c) => c.x));
  return (
    <>
      <Frame label={FM.bocpd}>
        {(w) => {
          const iw = w - LEFT - RIGHT, col = iw / (x1 - x0 + 1), bw = Math.max(1, col - (col > 4 ? 1 : 0));
          const x = (m: number) => LEFT + (m - x0) * col;
          return (
            <>
              <line x1={LEFT} x2={LEFT + iw} y1={y(0)} y2={y(0)} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
              <line x1={LEFT} x2={LEFT + iw} y1={y(0.5)} y2={y(0.5)} strokeWidth={1} strokeDasharray="1 3" style={{ stroke: "var(--ink-3)" }} />
              {s.prob.map((q) => (
                <rect key={q.x} x={x(q.x)} width={bw} y={y(q.p)} height={Math.max(0.5, y(0) - y(q.p))} style={{ fill: changes.has(q.x) ? "var(--ink)" : "var(--viz-blue)", opacity: changes.has(q.x) ? 1 : 0.7 }}>
                  <title>{FM.prob(months[q.x] ? formatYm(months[q.x]) : "", Math.round(q.p * 100))}</title>
                </rect>
              ))}
              {s.changes.map((c) => <circle key={c.x} cx={x(c.x) + col / 2} cy={y(1) - 1} r={3} style={{ fill: "var(--ink)" }} />)}
              {[1, 0].map((v) => <text key={v} x={LEFT - 5} y={y(v)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>{v * 100} %</text>)}
              <MonthEnds x0={x0} x1={x1} months={months} left={LEFT} right={LEFT + iw} y={H - 4} />
            </>
          );
        }}
      </Frame>
      <FigLegend items={[{ swatch: "bar", text: FM.probability }, { swatch: "dot", text: FM.change, color: "var(--ink)" }]} />
    </>
  );
}

export function GpFigure({ s, months, residual }: { s: GpResult; months: readonly YearMonth[]; residual: readonly Num[] }) {
  const n = s.mean.length;
  const ih = H - TOP - BOTTOM;
  const obs = Array.from({ length: n }, (_, k) => residual[s.start + k]);
  const [lo, hi] = extent([...s.lo, ...s.hi, ...obs], true);
  const y = (v: number) => TOP + ih - ((v - lo) / (hi - lo)) * ih;
  return (
    <>
      <Frame label={FM.gp}>
        {(w) => {
          const iw = w - LEFT - RIGHT;
          const x = (k: number) => LEFT + (n > 1 ? (k / (n - 1)) * iw : iw / 2);
          const poly = s.hi.map((v, k) => `${k ? "L" : "M"}${x(k).toFixed(1)} ${y(v).toFixed(1)}`).join("")
            + s.lo.map((_, k) => { const j = n - 1 - k; return `L${x(j).toFixed(1)} ${y(s.lo[j]).toFixed(1)}`; }).join("") + "Z";
          return (
            <>
              <line x1={LEFT} x2={LEFT + iw} y1={y(0)} y2={y(0)} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
              <path d={poly} style={{ fill: "var(--viz-blue)", opacity: 0.18 }} />
              {obs.map((v, k) => fin(v) && <circle key={k} cx={x(k)} cy={y(v)} r={1.8} style={{ fill: "var(--ink-3)" }} />)}
              <path d={brokenPath(s.mean, x, y)} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--viz-blue)" }} />
              <YEnds lo={lo} hi={hi} y={y} left={LEFT} />
              <MonthEnds x0={s.start} x1={s.start + n - 1} months={months} left={LEFT} right={LEFT + iw} y={H - 4} />
            </>
          );
        }}
      </Frame>
      <FigLegend items={[
        { swatch: "dot", text: FM.observed, color: "var(--ink-3)" },
        { swatch: "curve", text: FM.smooth, color: "var(--viz-blue)" },
        { swatch: "band", text: FM.band, color: "var(--viz-blue)" },
      ]} />
    </>
  );
}
