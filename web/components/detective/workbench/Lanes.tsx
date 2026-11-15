"use client";
// The lane list: a shared time axis, collapsed lanes (name · strip · numbers) and one expanded lane
// (product switch, crystal ball, large chart, statistics). Every lane uses the same grid columns and
// chart gutters, so a month sits at the same x everywhere.
import { useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import type { Catalog } from "@/lib/types";
import type { CategoryId, LayerId } from "@/lib/detective/contracts";
import { polarityIsArbitrary } from "@/lib/detective/polarity";
import { formatYm, ymIndex } from "@/lib/detective/url";
import type { VariableCatalog } from "@/lib/detective/series";
import { Segmented } from "@/components/ui/Segmented";
import { useElementHeight, useElementWidth } from "@/components/charts/useElementWidth";
import VariableOrb from "../VariableOrb";
import { COPY } from "./copy";
import { GUTTER_L, timeScale, timeTicks } from "./axis";
import { AnomalyLegend, LaneNumbers } from "./bits";
import LaneStrip, { STRIP_H } from "./LaneStrip";
import LaneChart, { type ChartLayer } from "./LaneChart";
import StatsPanel from "./StatsPanel";
import type { Span } from "./model";
import type { LaneModel, LaneReady } from "./types";
// Tests (lab): one hook + one panel; see lab/TestsPanel.tsx
import TestsPanel, { type LabControl } from "./lab/TestsPanel";
import { useLabRun } from "./lab/useLabRun";

/** the three lane columns; the container sets --lane-label and --lane-nums */
export const LANE_GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 lg:grid-cols-[var(--lane-label)_minmax(0,1fr)_var(--lane-nums)]";
export const LANE_VARS = "[--lane-label:16.5rem] [--lane-nums:11.5rem] xl:[--lane-label:18.5rem]";
const LANE_PAD = "px-2 sm:px-3";

export interface Shared {
  view: Span;
  event: Span;
  sel: Span;
  hover: { k: number; c: CategoryId } | null;
  onSel: (s: Span) => void;
  onCommit: (s: Span) => void;
  onHover: (c: CategoryId, k: number | null) => void;
}

/* ------------------------------------------------------------------ shared axis + column heads */

export function AxisRow({ view, event }: { view: Span; event: Span }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const t = timeScale(view, width || 600);
  const h = 30;
  const x0 = Math.max(0, t.x(event.s)), x1 = Math.min(t.iw, t.x(event.e + 1));
  const L = COPY.lanes;
  return (
    <div className={`${LANE_GRID} ${LANE_PAD} sticky top-0 z-10 items-end border-b border-line bg-paper pb-1 md:top-[var(--toolbar-h,0px)]`} aria-hidden="true">
      <div className="hidden lg:block" />
      <div ref={ref} className="col-span-2 min-w-0 lg:col-span-1" style={{ height: h }}>
        {width > 0 && (
          <svg width={width} height={h} className="block">
            <g transform={`translate(${GUTTER_L},0)`}>
              {x1 > x0 && (
                <g>
                  <rect x={x0} width={x1 - x0} y={h - 6} height={6} style={{ fill: "var(--action)", opacity: 0.5 }} />
                  <text x={(x0 + x1) / 2} y={9} textAnchor="middle" style={{ fill: "var(--ink)", fontSize: 11, fontWeight: 600 }}>{L.event}</text>
                </g>
              )}
              {timeTicks(t).map((tk) => (
                <g key={tk.at} transform={`translate(${t.x(tk.at)},0)`}>
                  <line y1={h - 5} y2={h} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
                  <text y={h - 9} textAnchor="middle" className="tnum" style={{ fill: "var(--ink-2)", fontSize: 11, fontWeight: tk.major ? 600 : 400 }}>{tk.label}</text>
                </g>
              ))}
            </g>
          </svg>
        )}
      </div>
      <div className="hidden grid-cols-[3.6rem_3.6rem_auto] gap-x-1.5 text-xs text-ink-3 lg:grid">
        <span className="text-right">{L.colMeanZ}</span>
        <span className="text-right">{L.colP}</span>
        <span className="pl-1">{L.colVerdict}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ lane header bits */

function NameBlock({ lane, children }: { lane: LaneModel; children?: ReactNode }) {
  const meta = lane.res.kind === "ready" ? lane.res.meta : null;
  return (
    <span className="flex min-w-0 flex-col items-start text-left">
      <span className="flex max-w-full items-center gap-1.5">
        {children}
        <span className="truncate font-semibold text-ink">{meta?.name ?? lane.name}</span>
        {meta?.caveat && (
          <span title={meta.caveat} className="shrink-0 text-sm text-synthetic">
            <span aria-hidden="true">⚠</span>
            <span className="sr-only">{COPY.lanes.caveat}: {meta.caveat}</span>
          </span>
        )}
      </span>
      {meta && <span title={`${meta.product} · ${meta.unit}`} className="max-w-full truncate text-xs text-ink-2">{meta.product} · {meta.unit}</span>}
    </span>
  );
}

function StripStatus({ lane, onRetry }: { lane: LaneModel; onRetry: () => void }) {
  const L = COPY.lanes;
  const r = lane.res;
  return (
    <div className="flex items-center gap-2 text-sm text-ink-3" style={{ height: STRIP_H, paddingLeft: GUTTER_L }}>
      {r.kind === "loading" && <><span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-water" />{L.loading}</>}
      {r.kind === "nodata" && <span title={r.reason ?? undefined}>{L.noData}</span>}
      {r.kind === "error" && (
        <>
          <span title={r.message} className="text-ink-2">{L.error}</span>
          <button type="button" onClick={onRetry} className="rounded-ctl border border-line px-2 py-0.5 text-xs font-semibold text-ink hover:bg-well">{L.retry}</button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ collapsed lane */

export function CollapsedLane({ lane, shared, onExpand, onRetry }: { lane: LaneModel; shared: Shared; onExpand: () => void; onRetry: () => void }) {
  const r = lane.res;
  const id = `lane-${lane.c}`;
  return (
    <li className={`${LANE_GRID} ${LANE_PAD} items-center gap-y-1 border-b border-line py-2`}>
      <button
        type="button"
        id={id}
        aria-expanded={false}
        aria-label={COPY.lanes.expand(lane.res.kind === "ready" ? lane.res.meta.name : lane.name)}
        onClick={onExpand}
        className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 rounded-[6px] py-0.5 text-left hover:bg-well"
      >
        <span aria-hidden="true" className="w-3 shrink-0 text-ink-3">▸</span>
        <NameBlock lane={lane} />
      </button>
      <div className="col-start-2 row-start-1 cursor-pointer lg:col-start-3" onClick={onExpand}>
        <LaneNumbers d={lane.detail} polarity={lane.polarity} expected={lane.expected} />
      </div>
      <div className="col-span-2 col-start-1 row-start-2 min-w-0 lg:col-span-1 lg:col-start-2 lg:row-start-1">
        {r.kind === "ready" ? (
          <>
            <LaneStrip
              lane={r} name={r.meta.name} polarity={lane.polarity}
              view={shared.view} event={shared.event} sel={shared.sel}
              hover={shared.hover?.k ?? null} showTip={shared.hover?.c === lane.c}
              onSel={shared.onSel} onCommit={shared.onCommit} onHover={(k) => shared.onHover(lane.c, k)} onTap={onExpand}
            />
            {r.outside && <p className="text-xs text-synthetic" style={{ paddingLeft: GUTTER_L }}>{COPY.lanes.outside}</p>}
          </>
        ) : <StripStatus lane={lane} onRetry={onRetry} />}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ expanded lane */

export interface ExpandedProps {
  lane: LaneModel;
  shared: Shared;
  vc: VariableCatalog | null;
  catalog: Catalog | null;
  regionId: string;
  relation: string;
  onLayer: (l: LayerId) => void;
  onRetry: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onCsv?: () => void;
  /** Tests state shared by every lane; no Tests area without it */
  lab?: LabControl;
}

const LAYERS: { value: ChartLayer; label: string; title: string }[] = [
  { value: "anomaly", label: COPY.chart.anomaly, title: COPY.chart.anomalyTitle },
  { value: "observed", label: COPY.chart.observed, title: COPY.chart.observedTitle },
  { value: "seasonal", label: COPY.chart.seasonal, title: COPY.chart.seasonalTitle },
  { value: "trend", label: COPY.chart.trend, title: COPY.chart.trendTitle },
];

const LG = "(min-width: 1024px)";
const subscribeLg = (cb: () => void) => {
  const m = window.matchMedia(LG);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** true once the lane grid puts the ball beside the chart */
const useWide = () => useSyncExternalStore(subscribeLg, () => window.matchMedia(LG).matches, () => false);

export function ExpandedLane(p: ExpandedProps) {
  const { lane, shared } = p;
  const wide = useWide();
  const [cellRef, cellH] = useElementHeight<HTMLDivElement>();
  const r = lane.res;
  const [layer, setLayer] = useState<ChartLayer>("anomaly");
  const labRun = useLabRun(r.kind === "ready" ? r : null, shared.sel, p.lab?.test ?? null, p.lab?.whole ?? false);
  const L = COPY.lanes;
  const sw = (cls: string, style?: React.CSSProperties) => <span aria-hidden="true" className={`inline-block h-2.5 w-3 rounded-[2px] ${cls}`} style={style} />;

  return (
    <li id={`lanebox-${lane.c}`} className={`${LANE_PAD} my-1.5 scroll-mt-12 rounded-card bg-well py-3 md:scroll-mt-[calc(var(--toolbar-h,0px)+3rem)]`} style={{ borderRadius: "min(var(--r-card), 14px)" }}>
      <div className={`${LANE_GRID} items-start gap-y-2`}>
        <h2 className="col-start-1 row-start-1 min-w-0 text-base">
          <button type="button" id={`lane-${lane.c}`} aria-expanded={true} className="flex min-w-0 max-w-full items-center gap-1.5 text-left font-[family-name:var(--font-body-active)]">
            <span aria-hidden="true" className="w-3 shrink-0 text-ink-3">▾</span>
            <NameBlock lane={lane} />
          </button>
        </h2>
        <div className="col-start-2 row-start-1 lg:col-start-3">
          <LaneNumbers d={lane.detail} polarity={lane.polarity} expected={lane.expected} />
        </div>
        <div className="col-span-2 col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 lg:col-span-1 lg:col-start-2 lg:row-start-1" style={{ paddingLeft: 0 }}>
          {r.kind === "ready" && <Segmented legend={COPY.chart.layers} hideLegend tone="paper" options={LAYERS} value={layer} onChange={setLayer} />}
          {lane.choices.length > 1 && p.vc && (
            <label className="flex min-w-0 items-center gap-2 text-sm text-ink-2">
              <span>{COPY.product}</span>
              <select
                value={lane.layer ?? ""}
                onChange={(e) => p.onLayer(e.target.value)}
                className="max-w-[14rem] min-w-0 rounded-ctl border border-line bg-paper px-2.5 py-1 text-sm text-ink"
              >
                {lane.choices.map((l) => (
                  <option key={l} value={l}>{p.vc!.layers[l].product}{l === p.vc!.defaults[lane.c] ? COPY.productDefault : ""}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {r.kind === "ready" && r.meta.caveat && (
        <p role="note" className="mt-2 text-sm text-synthetic"><span aria-hidden="true">⚠ </span>{r.meta.caveat}</p>
      )}
      {r.kind === "ready" && r.outside && (
        <p role="status" className="mt-1 text-sm text-ink-2">
          {L.outsideLong(r.meta.product, formatYm(r.d.months[0]), formatYm(r.d.months[r.d.months.length - 1]))}
          {lane.choices.length > 1 ? ` ${L.tryOther}` : ""}
        </p>
      )}

      {r.kind !== "ready" ? (
        <div className="mt-2"><StripStatus lane={lane} onRetry={p.onRetry} /></div>
      ) : (
        <>
          {/* phones and tablets: chart, statistics, legend, then the ball; desktop: ball | chart | legend, statistics below */}
          <div className={`mt-3 flex flex-col gap-y-3 lg:grid lg:grid-cols-[var(--lane-label)_minmax(0,1fr)_var(--lane-nums)] lg:gap-x-3 lg:gap-y-3`}>
            <div className="order-4 mx-auto w-full max-w-[14rem] sm:max-w-[16rem] lg:order-none lg:col-start-1 lg:row-start-1 lg:max-w-none">
              <VariableOrb
                region={p.catalog?.byId.get(p.regionId) ?? null}
                catalog={p.catalog}
                category={lane.c}
                layer={r.meta.layer}
                name={r.meta.name}
                unit={r.meta.unit}
                d={r.d}
                monthIndex={orbMonth(r, shared, lane)}
                highReads={lane.polarity}
                className="w-full"
              />
            </div>
            {/* on desktop the cell is as tall as the ball column (at least 360 px) and the chart fills it */}
            <div ref={cellRef} className="order-1 min-w-0 lg:relative lg:order-none lg:col-start-2 lg:row-start-1 lg:min-h-[360px]">
              <div className="lg:absolute lg:inset-0">
                <LaneChart
                  lane={r} layer={layer} polarity={lane.polarity}
                  view={shared.view} event={shared.event} sel={shared.sel}
                  hover={shared.hover?.k ?? null} showTip={shared.hover?.c === lane.c}
                  height={wide && cellH > 0 ? cellH : undefined}
                  label={COPY.chart.label(r.meta.name)}
                  onSel={shared.onSel} onCommit={shared.onCommit} onHover={(k) => shared.onHover(lane.c, k)}
                  onKeyDown={p.onKeyDown}
                  overlay={layer === "anomaly" ? labRun?.overlay : null}
                />
              </div>
            </div>
            <div className="order-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2 lg:order-none lg:col-start-3 lg:row-start-1 lg:flex-col lg:pt-6">
              {layer === "anomaly" ? <AnomalyLegend polarity={lane.polarity} arbitrary={polarityIsArbitrary(lane.c)} /> : (
                <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1.5"><svg width="14" height="8" aria-hidden="true"><line x1="0" x2="14" y1="4" y2="4" strokeWidth="2" style={{ stroke: "var(--viz-blue)" }} /></svg>
                    {layer === "observed" ? COPY.chart.observedSeries : layer === "seasonal" ? COPY.chart.seasonalSeries : COPY.chart.trendSeries}</span>
                  {layer === "observed" && <span className="inline-flex items-center gap-1.5"><svg width="14" height="8" aria-hidden="true"><line x1="0" x2="14" y1="4" y2="4" strokeWidth="1.5" strokeDasharray="4 3" style={{ stroke: "var(--viz-ink)" }} /></svg>{COPY.chart.normal}</span>}
                  {layer === "trend" && <span className="inline-flex items-center gap-1.5"><svg width="14" height="8" aria-hidden="true"><line x1="0" x2="14" y1="4" y2="4" strokeWidth="1.25" style={{ stroke: "var(--viz-ink)", opacity: 0.5 }} /></svg>{COPY.chart.observedSeries}</span>}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">{sw("", { background: "var(--action)", opacity: 0.45 })}{COPY.chart.eventBand}</span>
              <span className="inline-flex items-center gap-1.5">{sw("border-[1.5px] border-focus", { background: "color-mix(in srgb, var(--focus) 12%, transparent)" })}{COPY.chart.selection}</span>
              <span className="inline-flex items-center gap-1.5">{sw("", { background: "repeating-linear-gradient(45deg, color-mix(in srgb, var(--ink) 22%, transparent) 0 2px, transparent 2px 5px)" })}{COPY.chart.missing}</span>
            </div>
            <div className="order-2 min-w-0 lg:order-none lg:col-span-3 lg:row-start-2">
              <StatsPanel
                d={lane.detail} unit={r.meta.unit} polarity={lane.polarity} expected={lane.expected}
                baseline={r.baseline} trend={r.trend} relation={p.relation} onCsv={p.onCsv}
                tests={p.lab && (
                  <TestsPanel lab={p.lab} run={labRun} months={r.d.months} unit={r.meta.unit} polarity={lane.polarity}
                    onShowAnomaly={layer !== "anomaly" ? () => setLayer("anomaly") : undefined} />
                )}
              />
            </div>
          </div>
        </>
      )}
    </li>
  );
}

/** the month the crystal ball shows: hovered, else the selection's peak, else its last month */
function orbMonth(r: LaneReady, shared: Shared, lane: LaneModel): number {
  const n = r.d.months.length;
  const clamp = (i: number) => Math.max(0, Math.min(n - 1, i));
  const h = shared.hover?.k;
  if (h != null && h - r.base >= 0 && h - r.base < n) return h - r.base;
  const peak = lane.detail?.peak?.month;
  if (peak) return clamp(ymIndex(peak) - r.base);
  return clamp(shared.sel.e - r.base);
}
