"use client";
// The chosen variable's detail (the variable itself is picked in the VariableSelect dropdown above it): the layer and
// product switches over the chart, a one-row legend under its time axis, the Tests under that; the crystal ball in a
// column on the left, a slim statistics column on the right (verdict and the four live numbers), and "More statistics"
// opens the full panel as a drawer over the chart area (a bottom sheet on phones) so the chart never changes width.
// In a weeks window the chart is the daily view (monthly chart as its fallback). No frames: a hairline edge at most.
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import type { Catalog } from "@/lib/types";
import type { CategoryId, LayerId } from "@/lib/detective/contracts";
import { polarityIsArbitrary } from "@/lib/detective/polarity";
import { formatYm, ymIndex } from "@/lib/detective/url";
import type { VariableCatalog } from "@/lib/detective/series";
import { Segmented } from "@/components/ui/Segmented";
import VariableOrb from "../VariableOrb";
import { COPY } from "./copy";
import { AnomalyLegend } from "./bits";
import LaneChart, { type ChartLayer } from "./LaneChart";
import StatsPanel from "./StatsPanel";
import type { Span } from "./model";
import type { LaneModel, LaneReady } from "./types";
import TestsPanel, { type LabControl } from "./lab/TestsPanel";
import { useLabAnalysis } from "./lab/useLabRun";

export interface Shared {
  view: Span;
  event: Span;
  sel: Span;
  hover: { k: number; c: CategoryId } | null;
  onSel: (s: Span) => void;
  onCommit: (s: Span) => void;
  onHover: (c: CategoryId, k: number | null) => void;
}

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
  /** Tests state shared by every lane; no Tests table without it */
  lab?: LabControl;
  /**
   * Replaces the chart (the daily view of a weeks window). Called with the monthly chart, which it shows as its
   * fallback; the chart cell then sizes to its content instead of matching the ball's height.
   */
  renderChart?: (monthly: ReactNode) => ReactNode;
  /** baseline exclusion control, shown in "Baseline and method" */
  baselineControl?: ReactNode;
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
/** true once the grid puts the ball beside the chart */
const useWide = () => useSyncExternalStore(subscribeLg, () => window.matchMedia(LG).matches, () => false);

function LaneStatus({ lane, onRetry }: { lane: LaneModel; onRetry: () => void }) {
  const L = COPY.lanes;
  const r = lane.res;
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-ink-2">
      {r.kind === "loading" && <><span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-water" />{L.loading}</>}
      {r.kind === "nodata" && <span>{L.noData}{r.reason ? ` — ${r.reason}` : ""}</span>}
      {r.kind === "error" && (
        <>
          <span title={r.message}>{L.error}</span>
          <button type="button" onClick={onRetry} className="font-semibold text-link underline underline-offset-2 hover:no-underline">{L.retry}</button>
        </>
      )}
    </p>
  );
}

export function ExpandedLane(p: ExpandedProps) {
  const { lane, shared } = p;
  const wide = useWide();
  const r = lane.res;
  const [layer, setLayer] = useState<ChartLayer>("anomaly");
  const [more, setMore] = useState(false);
  const moreId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const analysis = useLabAnalysis(r.kind === "ready" ? r : null, shared.sel, p.lab?.test ?? "mean", p.lab?.whole ?? false);
  const overlay = layer === "anomaly" ? analysis?.run?.overlay ?? null : null;
  const L = COPY.lanes;

  const product = lane.choices.length > 1 && p.vc ? (
    <label className="flex min-w-0 items-baseline gap-2 text-sm text-ink-2">
      <span>{COPY.product}</span>
      <select
        value={lane.layer ?? ""}
        onChange={(e) => p.onLayer(e.target.value)}
        className="max-w-[15rem] min-w-0 border-b border-line bg-transparent py-0.5 pr-1 text-sm text-ink hover:border-ink-3"
      >
        {lane.choices.map((l) => (
          <option key={l} value={l}>{p.vc!.layers[l].product}{l === p.vc!.defaults[lane.c] ? COPY.productDefault : ""}</option>
        ))}
      </select>
    </label>
  ) : null;

  if (r.kind !== "ready") {
    return (
      <section id={`lanebox-${lane.c}`} aria-label={lane.name}>
        <LaneStatus lane={lane} onRetry={p.onRetry} />
        {product}
      </section>
    );
  }

  const monthly = (
    <LaneChart
      lane={r} layer={layer} polarity={lane.polarity}
      view={shared.view} event={shared.event} sel={shared.sel}
      hover={shared.hover?.k ?? null} showTip={shared.hover?.c === lane.c}
      height={wide ? 360 : undefined}
      label={COPY.chart.label(r.meta.name)}
      onSel={shared.onSel} onCommit={shared.onCommit} onHover={(k) => shared.onHover(lane.c, k)}
      onKeyDown={p.onKeyDown}
      overlay={overlay}
    />
  );

  return (
    <section id={`lanebox-${lane.c}`} aria-label={r.meta.name}>
      {r.meta.caveat && (
        <p role="note" className="mb-2 text-sm text-synthetic"><span aria-hidden="true">⚠ </span>{r.meta.caveat}</p>
      )}
      {r.outside && (
        <p role="status" className="mb-2 text-sm text-ink-2">
          {L.outsideLong(r.meta.product, formatYm(r.d.months[0]), formatYm(r.d.months[r.d.months.length - 1]))}
          {lane.choices.length > 1 ? ` ${L.tryOther}` : ""}
        </p>
      )}

      {/* desktop: ball | chart (+ legend, Tests) | slim statistics, the drawer overlaying the chart area from the right.
          Phones: controls, chart, legend, statistics, ball, Tests; the drawer is a bottom sheet */}
      <div className="relative flex flex-col gap-y-4 lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)_17rem] lg:items-start lg:gap-x-6">
        <div className="order-4 mx-auto w-full max-w-[14rem] sm:max-w-[16rem] lg:order-none lg:mx-0 lg:max-w-none">
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

        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-y-3">
          <div className="order-1 flex min-w-0 flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            {!p.renderChart && <Segmented legend={COPY.chart.layers} hideLegend tone="paper" look="underline" options={LAYERS} value={layer} onChange={setLayer} />}
            {product}
          </div>
          <div className="order-2 min-w-0">
            {p.renderChart ? p.renderChart(monthly) : monthly}
            {!p.renderChart && <Legend layer={layer} lane={lane} />}
          </div>
          {p.lab && (
            <div className="order-5 min-w-0 lg:mt-2">
              <TestsPanel lab={p.lab} analysis={analysis} months={r.d.months} unit={r.meta.unit} polarity={lane.polarity}
                onShowAnomaly={layer !== "anomaly" && !p.renderChart ? () => setLayer("anomaly") : undefined} />
            </div>
          )}
        </div>

        <aside aria-label={COPY.stats.heading} className="order-3 min-w-0 border-t border-line pt-3 lg:order-none lg:border-t-0 lg:pt-0">
          <StatsPanel
            d={lane.detail} unit={r.meta.unit} polarity={lane.polarity} expanded={false} open={more} moreId={moreId}
            onToggle={() => setMore(true)} triggerRef={trigger}
            baseline={r.baseline} trend={r.trend} relation={p.relation}
          />
        </aside>

        {more && (
          <StatsDrawer id={moreId} trigger={trigger} onClose={() => setMore(false)}>
            <StatsPanel
              d={lane.detail} unit={r.meta.unit} polarity={lane.polarity} live={false}
              baseline={r.baseline} trend={r.trend} relation={p.relation} onCsv={p.onCsv}
              baselineControl={p.baselineControl}
            />
          </StatsDrawer>
        )}
      </div>
    </section>
  );
}

/**
 * "More statistics": a non-modal dialog over the chart area (a bottom sheet on phones). Focus moves to its close button
 * and returns to the trigger; Esc, the close button or a press outside close it. Hairline edge, paper background, no
 * shadow or card.
 */
function StatsDrawer({ id, trigger, onClose, children }: {
  id: string; trigger: React.RefObject<HTMLButtonElement | null>; onClose: () => void; children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = trigger.current;
    closeBtn.current?.focus();
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close.current(); } };
    const down = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && !box.current?.contains(t) && !opener?.contains(t)) close.current();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down);
      opener?.focus();
    };
  }, [trigger]);
  return (
    <div
      ref={box} id={id} role="dialog" aria-label={COPY.stats.drawerLabel}
      className="fixed inset-x-0 bottom-0 z-30 max-h-[78vh] overflow-y-auto overscroll-contain border-t border-line bg-paper px-4 pt-3 pb-6 sm:px-6
        lg:absolute lg:inset-x-auto lg:top-0 lg:right-0 lg:bottom-0 lg:max-h-none lg:w-[27rem] lg:max-w-full lg:border-t-0 lg:border-l lg:px-6 lg:pt-0 lg:pb-4"
    >
      <div className="mb-3 flex items-center justify-between lg:sticky lg:top-0 lg:z-10 lg:-mx-6 lg:bg-paper lg:px-6 lg:pt-1 lg:pb-2">
        <h3 className="text-sm font-semibold text-ink">{COPY.stats.heading}</h3>
        <button ref={closeBtn} type="button" onClick={onClose} aria-label={COPY.stats.close}
          className="-mr-2 rounded-ctl px-2 py-1 text-sm font-semibold text-link hover:text-ink">
          {COPY.stats.close} <span aria-hidden="true">✕</span>
        </button>
      </div>
      {children}
    </div>
  );
}

/** one compact row under the chart's time axis: fills and guides with their meaning */
function Legend({ layer, lane }: { layer: ChartLayer; lane: LaneModel }) {
  const sw = (cls: string, style?: React.CSSProperties) => <span aria-hidden="true" className={`inline-block h-2.5 w-3 rounded-[2px] ${cls}`} style={style} />;
  const line = (dash: string | undefined, color: string, w = 1.5, op = 1) => (
    <svg width="16" height="8" aria-hidden="true"><line x1="0" x2="16" y1="4" y2="4" strokeWidth={w} strokeDasharray={dash} style={{ stroke: color, opacity: op }} /></svg>
  );
  const item = (mark: ReactNode, text: string) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{mark}{text}</span>;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2" style={{ paddingLeft: 52 }}>
      {layer === "anomaly" ? (
        <>
          <AnomalyLegend polarity={lane.polarity} arbitrary={polarityIsArbitrary(lane.c)} />
          {item(line("1 3", "var(--ink-3)", 1.5, 0.8), COPY.chart.sigma1)}
          {item(line("4 3", "var(--ink-3)"), COPY.chart.sigma2)}
        </>
      ) : (
        <>
          {item(line(undefined, "var(--viz-blue)", 2), layer === "observed" ? COPY.chart.observedSeries : layer === "seasonal" ? COPY.chart.seasonalSeries : COPY.chart.trendSeries)}
          {layer === "observed" && item(line("4 3", "var(--viz-ink)"), COPY.chart.normal)}
          {layer === "trend" && item(line(undefined, "var(--viz-ink)", 1.25, 0.5), COPY.chart.observedSeries)}
        </>
      )}
      {item(sw("", { background: "var(--action)", opacity: 0.45 }), COPY.chart.eventBand)}
      {item(sw("border-[1.5px] border-focus", { background: "color-mix(in srgb, var(--focus) 12%, transparent)" }), COPY.chart.selection)}
      {item(sw("", { background: "repeating-linear-gradient(45deg, color-mix(in srgb, var(--ink) 22%, transparent) 0 2px, transparent 2px 5px)" }), COPY.chart.missing)}
    </p>
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
