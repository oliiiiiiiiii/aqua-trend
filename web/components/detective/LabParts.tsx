"use client";
// Shared pieces for the analysis-lab result blocks (LabPanel, LabMore).
import { Fragment, type ReactNode } from "react";
import type { HistBin } from "@/lib/detective/lab";
import { num } from "./format";

/** Slope per month → per decade for ranges ≥ 10 years, else per year. */
export function slopeUnit(spanMonths: number): { k: number; label: string } {
  return spanMonths >= 120 ? { k: 120, label: "／十年" } : { k: 12, label: "／年" };
}

export const Sig = ({ p }: { p: number }) => {
  const s = p < 0.05;
  return <span className={`inline-block rounded-ctl px-2 py-0.5 text-xs font-semibold ${s ? "bg-real-bg text-real" : "bg-well text-ink-2"}`}>{s ? "顯著" : "不顯著"}（α = 0.05）</span>;
};

export function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tnum">
      {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-ink-2">{k}</dt><dd>{v}</dd></Fragment>))}
    </dl>
  );
}

export const Verdict = ({ children }: { children: ReactNode }) => <p className="mt-2">{children}</p>;
export const ci = (c: [number, number], k = 1) => `[${num(c[0] * k, 2, true)}, ${num(c[1] * k, 2, true)}]`;
export const corrected = (nEff: number, n: number, lag1: number | null) =>
  lag1 != null && lag1 > 0 && nEff < n
    ? <span className="text-ink-2">（月資料彼此相關，lag-1 r = {num(lag1, 2)}，已用有效樣本 {Math.round(nEff)}／{n} 修正）</span>
    : <span className="text-ink-2">（{n} 個月，未偵測到正自相關，不需修正）</span>;

export function Histogram({ bins, marks, curve, label }: {
  bins: HistBin[];
  marks: { at: number; dashed?: boolean; color: string }[];
  curve?: (x: number) => number;
  label: string;
}) {
  const W = 320, H = 90;
  if (!bins.length) return null;
  const lo = Math.min(bins[0].x0, ...marks.map((m) => m.at)), hi = Math.max(bins[bins.length - 1].x1, ...marks.map((m) => m.at));
  const sx = (v: number) => ((v - lo) / (hi - lo || 1)) * W;
  const top = Math.max(...bins.map((b) => b.count), 1);
  const total = bins.reduce((a, b) => a + b.count, 0);
  const w = bins[0].x1 - bins[0].x0;
  const curveTop = curve ? Math.max(top, ...bins.map((b) => curve((b.x0 + b.x1) / 2) * total * w)) : top;
  const sy = (c: number) => H - (c / curveTop) * (H - 4);
  let path = "";
  if (curve) for (let k = 0; k <= 60; k++) { const v = lo + ((hi - lo) * k) / 60; path += `${k ? "L" : "M"}${sx(v)},${sy(curve(v) * total * w)}`; }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block h-24 w-full max-w-md" preserveAspectRatio="none" aria-label={label}>
      {bins.map((b, k) => (
        <rect key={k} x={sx(b.x0) + 0.5} width={Math.max(0.5, sx(b.x1) - sx(b.x0) - 1)} y={sy(b.count)} height={H - sy(b.count)} style={{ fill: "var(--viz-blue)", opacity: 0.55 }} />
      ))}
      {curve && <path d={path} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--ink)" }} />}
      {marks.map((m, k) => (
        <line key={k} x1={sx(m.at)} x2={sx(m.at)} y1={0} y2={H} strokeWidth={2} strokeDasharray={m.dashed ? "4 3" : undefined} vectorEffect="non-scaling-stroke" style={{ stroke: m.color }} />
      ))}
    </svg>
  );
}


export interface ToolInfo { label: string; title: string; about: string; icon: ReactNode }

export const I = (children: ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const dot = (cx: number, cy: number) => <circle cx={cx} cy={cy} r={1.4} fill="currentColor" stroke="none" />;

/** A small line chart with optional dashed second line and shaded spans; x and y are data units. */
export function MiniLine({ xs, ys, ys2, spans = [], logX = false, zero = true, label, height = 96 }: {
  xs: number[];
  ys: number[];
  ys2?: number[];
  spans?: { x0: number; x1: number; color: string }[];
  logX?: boolean;
  zero?: boolean;
  label: string;
  height?: number;
}) {
  const W = 320, H = height;
  if (!xs.length) return null;
  const fx = (v: number) => (logX ? Math.log(v) : v);
  const xa = Math.min(...xs.map(fx)), xb = Math.max(...xs.map(fx));
  const all = [...ys, ...(ys2 ?? []), ...(zero ? [0] : [])];
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.06;
  const sx = (v: number) => ((fx(v) - xa) / (xb - xa || 1)) * W;
  const sy = (v: number) => H - ((v - lo + pad) / (hi - lo + 2 * pad)) * H;
  const path = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${sx(xs[i]).toFixed(2)},${sy(v).toFixed(2)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block w-full max-w-md" style={{ height: H }} preserveAspectRatio="none" aria-label={label}>
      {spans.map((s, k) => (
        <rect key={k} x={sx(s.x0)} width={Math.max(1, sx(s.x1) - sx(s.x0))} y={0} height={H} style={{ fill: s.color, opacity: 0.18 }} />
      ))}
      {zero && lo < 0 && hi > 0 && <line x1={0} x2={W} y1={sy(0)} y2={sy(0)} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--ink-3)" }} />}
      {ys2 && <path d={path(ys2)} fill="none" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" style={{ stroke: "var(--ink-2)" }} />}
      <path d={path(ys)} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--viz-blue)" }} />
    </svg>
  );
}
