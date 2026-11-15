"use client";
// The chosen variable's detail (the variable itself is picked in the VariableSelect dropdown above it): the layer and
// product switches over the chart, a one-row legend under its time axis, the Tests under that; the crystal ball in a
// column on the left, a slim statistics column on the right (verdict and the four live numbers, one per row). A pull tab
// on that column's left edge draws it out leftward over the chart like a curtain, revealing the other statistics, so the
// chart never changes width (phones: a bottom sheet that slides up).
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
import StatsPanel, { StatsExtras, StatsMetrics } from "./StatsPanel";
import type { Span } from "./model";
import type { LaneModel, LaneReady } from "./types";
import TestsPanel, { type LabControl } from "./lab/TestsPanel";
import { useLabAnalysis } from "./lab/useLabRun";
import { BandLegend } from "./lab/overlay";
import type { LabOverlay } from "./lab/tests";

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
  const closeMore = () => setMore(false);
  const analysis = useLabAnalysis(r.kind === "ready" ? r : null, shared.sel, p.lab?.test ?? "mean", p.lab?.whole ?? false);
  const overlay = analysis?.run?.overlay ?? null; // bands show on every layer; LaneChart keeps fit lines for Anomaly
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

      {/* desktop: ball | chart (+ legend) | slim statistics; row 2: Tests full width | slim statistics, the drawer overlaying the chart area from the right.
          Phones: controls, chart, legend, statistics, ball, Tests; the drawer is a bottom sheet */}
      <div className="relative flex flex-col gap-y-4 lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)_17rem] lg:items-start lg:gap-x-6">
        <div className="order-4 mx-auto w-full max-w-[14rem] sm:max-w-[16rem] lg:order-none lg:col-start-1 lg:row-start-1 lg:mx-0 lg:max-w-none">
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

        <div className="contents lg:col-start-2 lg:row-start-1 lg:flex lg:min-w-0 lg:flex-col lg:gap-y-3">
          <div className="order-1 flex min-w-0 flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            {!p.renderChart && <Segmented legend={COPY.chart.layers} hideLegend tone="paper" look="underline" options={LAYERS} value={layer} onChange={setLayer} />}
            {product}
          </div>
          <div className="order-2 min-w-0">
            {p.renderChart ? p.renderChart(monthly) : monthly}
            {!p.renderChart && <Legend layer={layer} lane={lane} overlay={overlay} />}
          </div>
        </div>

        {p.lab && (
          <div className="order-5 min-w-0 lg:col-span-3 lg:row-start-2 lg:mt-1">
            <TestsPanel lab={p.lab} analysis={analysis} months={r.d.months} unit={r.meta.unit} polarity={lane.polarity}
              onShowAnomaly={layer !== "anomaly" && !p.renderChart ? () => setLayer("anomaly") : undefined} />
          </div>
        )}

        {wide ? (
          <aside aria-label={COPY.stats.heading} className="relative min-w-0 lg:col-start-3 lg:row-start-1 lg:self-stretch">
            {/* in-flow, invisible copy of the metrics: gives the closed row its height; the curtain is absolutely sized to it */}
            <div aria-hidden="true" inert className="invisible w-full pl-10">
              <StatsMetrics d={lane.detail} unit={r.meta.unit} polarity={lane.polarity} live={false} />
            </div>
            <StatsCurtain
              id={moreId} open={more} onToggle={() => setMore((m) => !m)} onClose={closeMore} trigger={trigger}
              metrics={<StatsMetrics d={lane.detail} unit={r.meta.unit} polarity={lane.polarity} />}
              extras={<StatsExtras d={lane.detail} unit={r.meta.unit} baseline={r.baseline} trend={r.trend} relation={p.relation} onCsv={p.onCsv} baselineControl={p.baselineControl} polarity={lane.polarity} />}
            />
          </aside>
        ) : (
          <>
            <aside aria-label={COPY.stats.heading} className="order-3 min-w-0 border-t border-line pt-3">
              <StatsPanel
                d={lane.detail} unit={r.meta.unit} polarity={lane.polarity} expanded={false} open={more} moreId={moreId}
                onToggle={() => setMore(true)} triggerRef={trigger}
                baseline={r.baseline} trend={r.trend} relation={p.relation}
              />
            </aside>
            {more && (
              <StatsSheet id={moreId} trigger={trigger} onClosed={closeMore}>
                <StatsExtras d={lane.detail} unit={r.meta.unit} baseline={r.baseline} trend={r.trend} relation={p.relation} onCsv={p.onCsv} baselineControl={p.baselineControl} polarity={lane.polarity} />
              </StatsSheet>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const CURTAIN_MS = 280;

/**
 * Desktop "More statistics": the statistics column with a pull tab on its left edge. Opening widens the column to the
 * left over the chart (it overlays, the chart keeps its width) and reveals the extra statistics beside the four metrics.
 * The tab (aria-expanded) toggles it; Esc or a press outside pushes it back. Hairline edge, paper background, no shadow.
 */
function StatsCurtain({ id, open, onToggle, onClose, trigger, metrics, extras }: {
  id: string; open: boolean; onToggle: () => void; onClose: () => void;
  trigger: React.RefObject<HTMLButtonElement | null>; metrics: ReactNode; extras: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close.current(); trigger.current?.focus(); } };
    const down = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && !box.current?.contains(t)) close.current();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down);
    };
  }, [open, trigger]);
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = () => {
    const el = scroller.current;
    setMore(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [open]);
  const S = COPY.stats;
  return (
    <div
      ref={box}
      style={{ transitionDuration: `${CURTAIN_MS}ms` }}
      className={`absolute inset-y-0 right-0 z-20 flex border-l border-line bg-paper transition-[width] ease-out motion-reduce:transition-none ${
        open ? "w-[42rem] max-w-[calc(100vw-3rem)]" : "w-[17rem]"
      }`}
    >
      <button
        type="button" ref={trigger} onClick={onToggle} aria-expanded={open} aria-controls={id}
        aria-label={open ? S.less : S.more} title={open ? S.less : S.more}
        className="group flex w-6 shrink-0 cursor-pointer flex-col items-center gap-3 pt-3 text-ink-3 hover:bg-well hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className={`transition-transform ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`} style={{ transitionDuration: `${CURTAIN_MS}ms` }}>
          <path d="M7.5 2L3.5 6l4 4" />
        </svg>
        <span aria-hidden="true" className="text-xs font-semibold tracking-wide [writing-mode:vertical-rl]">{open ? S.lessTab : S.moreTab}</span>
      </button>
      <div
        id={id} role="region" aria-label={S.drawerLabel} inert={!open} aria-hidden={!open}
        style={{ transitionDuration: "0s", transitionDelay: open ? "0s" : `${CURTAIN_MS}ms` }}
        className="relative min-w-0 flex-1 overflow-hidden"
      >
        <div
          ref={scroller} tabIndex={open ? 0 : -1} onScroll={measure}
          className="stats-scroll h-full w-[25rem] overflow-y-auto overscroll-contain px-4 pb-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <h3 className="mb-2 font-[family-name:var(--font-body-active)] text-sm font-semibold text-ink">{S.moreHeading}</h3>
          {extras}
        </div>
        <div aria-hidden="true" style={{ opacity: more ? 1 : 0 }}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-paper to-transparent transition-opacity duration-150" />
      </div>
      <div className="w-[15.5rem] shrink-0 pr-0 pl-3">{metrics}</div>
    </div>
  );
}

/**
 * Phone "More statistics": a bottom sheet that slides up (and back down) as a non-modal dialog. Focus moves to its close
 * button and returns to the trigger; Esc, the close button or a press outside close it.
 */
function StatsSheet({ id, trigger, onClosed, children }: {
  id: string; trigger: React.RefObject<HTMLButtonElement | null>; onClosed: () => void; children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(false);
  const timer = useRef<number | null>(null);
  const done = useRef(onClosed);
  done.current = onClosed;
  const close = useRef(() => {});
  close.current = () => {
    if (timer.current != null) return;
    setShown(false);
    timer.current = window.setTimeout(() => done.current(), CURTAIN_MS);
  };
  useEffect(() => {
    const opener = trigger.current;
    const raf = requestAnimationFrame(() => setShown(true));
    closeBtn.current?.focus();
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close.current(); } };
    const down = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && !box.current?.contains(t) && !opener?.contains(t)) close.current();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down);
    return () => {
      cancelAnimationFrame(raf);
      if (timer.current != null) window.clearTimeout(timer.current);
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down);
      opener?.focus();
    };
  }, [trigger]);
  return (
    <div
      ref={box} id={id} role="dialog" aria-label={COPY.stats.drawerLabel}
      style={{ transitionDuration: `${CURTAIN_MS}ms` }}
      className={`fixed inset-x-0 bottom-0 z-30 max-h-[78vh] overflow-y-auto overscroll-contain border-t border-line bg-paper px-4 pt-3 pb-6 transition-transform ease-out motion-reduce:transition-none sm:px-6 ${
        shown ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-[family-name:var(--font-body-active)] text-sm font-semibold text-ink">{COPY.stats.moreHeading}</h3>
        <button ref={closeBtn} type="button" onClick={() => close.current()} aria-label={COPY.stats.close}
          className="-mr-2 rounded-ctl px-2 py-1 text-sm font-semibold text-link hover:text-ink">
          {COPY.stats.close} <span aria-hidden="true">✕</span>
        </button>
      </div>
      {children}
    </div>
  );
}

/** one compact row under the chart's time axis: fills and guides with their meaning */
function Legend({ layer, lane, overlay }: { layer: ChartLayer; lane: LaneModel; overlay: LabOverlay | null }) {
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
      <BandLegend overlay={overlay} polarity={lane.polarity} />
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
