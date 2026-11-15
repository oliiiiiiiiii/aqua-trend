"use client";
// Step 3: everything for one variable — header, conclusion card, layer switch, number line,
// interval read-out and the (collapsed) long-term trend panel.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { AnalysisApi, CategoryId, Decomposition, TimeRange, TrendStats } from "@/lib/detective/contracts";
import { Segmented } from "@/components/explore/Segmented";
import SeriesChart, { clampView, zoomView, type ChartLayer, type MonthSelection, type ViewWindow } from "./SeriesChart";
import ConclusionCard from "./ConclusionCard";
import TrendPanel from "./TrendPanel";
import LabPanel, { type LabRangeSource } from "./LabPanel";
import { BASELINE_SENSITIVE, baselineShare, holm, primaryP, runLabTool, type LabOutcome, type LabToolId } from "@/lib/detective/lab";
import { num, pct, rangeLabel, ymIndex } from "./format";

/** Display metadata for one variable (built by the page from categories.ts + variables.json). */
export interface VariableMeta {
  category: CategoryId;
  /** short name, e.g. "降水" */
  name: string;
  /** one plain-language sentence for students */
  definition: string;
  /** product, e.g. "GPM IMERG" */
  product: string;
  /** optional source kind shown after the product, e.g. "觀測" or "模式" */
  kind?: string;
  unit: string;
  /** must be shown when not null */
  caveat: string | null;
}

export interface VariableTabProps {
  meta: VariableMeta;
  d: Decomposition;
  event: TimeRange;
  padMonths: number;
  trend: TrendStats;
  /** passed in (not imported) so the tab can run on fake data */
  intervalStats: AnalysisApi["intervalStats"];
  /** hypothesis direction from a preset or the AI */
  expected?: "high" | "low";
  initialLayer?: ChartLayer;
  /** extra controls for the header, e.g. the page's layer (product) switcher */
  headerExtra?: ReactNode;
}

const LAYERS: { value: ChartLayer; label: string; title: string }[] = [
  { value: "raw", label: "原始", title: "每月的原始數值，虛線是「正常值」（趨勢＋季節）" },
  { value: "seasonal", label: "季節", title: "每年重複的季節循環" },
  { value: "trend", label: "趨勢", title: "基準期擬合的長期直線趨勢" },
  { value: "residual", label: "殘差", title: "扣掉趨勢和季節後剩下的異常" },
];

const btn = "rounded-ctl border border-line bg-paper px-3 py-1 text-sm text-ink hover:bg-well disabled:opacity-40";
const btnOn = "rounded-ctl border border-focus bg-well px-3 py-1 text-sm font-semibold text-ink";

export default function VariableTab(p: VariableTabProps) {
  const { meta, d, event, padMonths } = p;
  const n = d.months.length;
  const base = n ? ymIndex(d.months[0]) : 0;

  const eventView = useCallback((): ViewWindow => {
    const s = ymIndex(event.start) - base, e = ymIndex(event.end) - base;
    return clampView([s - padMonths, e + 1 + padMonths], n);
  }, [event, base, padMonths, n]);

  const [layer, setLayer] = useState<ChartLayer>(p.initialLayer ?? "residual");
  const [view, setView] = useState<ViewWindow>(eventView);
  const [selection, setSelection] = useState<MonthSelection | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [labTool, setLabTool] = useState<LabToolId | null>(null);
  const [labSource, setLabSource] = useState<LabRangeSource>("all");
  // tools pressed on the current range, for the multiple-testing log (reset when the range changes)
  const [labUsed, setLabUsed] = useState<{ key: string; tools: LabToolId[] }>({ key: "", tools: [] });
  const onSelectionChange = useCallback((s: MonthSelection | null) => {
    setSelection(s);
    if (s) setLabSource("selection");
  }, []);

  const eventStats = useMemo(() => p.intervalStats(d, event), [p.intervalStats, d, event]); // eslint-disable-line react-hooks/exhaustive-deps
  const selRange: TimeRange | null = selection ? { start: d.months[selection[0]], end: d.months[selection[1]] } : null;
  const selStats = useMemo(() => (selRange ? p.intervalStats(d, selRange) : null), [selRange?.start, selRange?.end, d]); // eslint-disable-line react-hooks/exhaustive-deps

  // the lab range: the selection, the event, or the whole record (inclusive month indices)
  const source: LabRangeSource = labSource === "selection" && !selection ? "all" : labSource;
  const [labStart, labEnd] = source === "selection" && selection
    ? selection
    : source === "event"
      ? [Math.max(0, ymIndex(event.start) - base), Math.min(n - 1, ymIndex(event.end) - base)]
      : [0, n - 1];
  const labKey = `${labStart}..${labEnd}`;
  const usedTools = useMemo(() => {
    const prior = labUsed.key === labKey ? labUsed.tools : [];
    return labTool && !prior.includes(labTool) ? [...prior, labTool] : prior;
  }, [labUsed, labKey, labTool]);
  const labOutcomes = useMemo(() => {
    const out = new Map<LabToolId, LabOutcome>();
    if (n) for (const t of usedTools) out.set(t, runLabTool(t, d, labStart, labEnd));
    return out;
  }, [usedTools, d, labStart, labEnd, n]);
  const labOutcome = labTool ? labOutcomes.get(labTool) ?? null : null;
  const labLog = useMemo(() => {
    const entries = usedTools.map((tool) => {
      const o = labOutcomes.get(tool);
      return { tool, p: o?.kind === "ok" ? primaryP(o.stats) : null };
    });
    const withP = entries.filter((e) => e.p != null && Number.isFinite(e.p));
    const keep = holm(withP.map((e) => e.p as number));
    return entries.map((e) => ({ ...e, holm: keep[withP.indexOf(e)] ?? false }));
  }, [usedTools, labOutcomes]);
  const pickLabTool = (t: LabToolId | null) => {
    setLabTool(t);
    if (t) setLabUsed({ key: labKey, tools: usedTools.includes(t) ? usedTools : [...usedTools, t] });
  };
  const labBaseline = useMemo(() => baselineShare(d, labStart, labEnd), [d, labStart, labEnd]);
  const overlay = labOutcome?.kind === "ok" ? labOutcome.segments : undefined;
  const overlayBands = labOutcome?.kind === "ok" ? labOutcome.bands : undefined;

  const full = view[0] <= 0 && view[1] >= n;
  const record = n ? `${d.months[0]}..${d.months[n - 1]}` : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="text-xl text-ink">{meta.name}</h2>
          <span className="text-sm text-ink-2">
            （{meta.product}{meta.kind ? `，${meta.kind}` : ""}）· {meta.unit}
          </span>
          {p.headerExtra}
        </div>
        <p className="mt-0.5 text-sm text-ink-2">{meta.definition}</p>
        {meta.caveat && (
          <p role="note" className="mt-2 rounded-ctl bg-synthetic-bg px-3 py-1.5 text-sm text-synthetic" style={{ borderRadius: "min(var(--r-ctl), 10px)" }}>
            <span aria-hidden="true">⚠ </span>注意：{meta.caveat}
          </p>
        )}
      </header>

      <ConclusionCard name={meta.name} unit={meta.unit} d={d} stats={eventStats} expected={p.expected} />

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented legend="圖層" hideLegend tone="paper" options={LAYERS} value={layer} onChange={setLayer} />
          <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="數線工具">
            <button type="button" className={btn} onClick={() => setView(zoomView(view, 0.6, (view[0] + view[1]) / 2, n))} aria-label="放大">＋</button>
            <button type="button" className={btn} onClick={() => setView(zoomView(view, 1 / 0.6, (view[0] + view[1]) / 2, n))} aria-label="縮小" disabled={full}>－</button>
            <button type="button" className={btn} onClick={() => setView(eventView())}>事件</button>
            <button type="button" className={btn} onClick={() => setView([0, n])} disabled={full}>全時段</button>
            <button type="button" className={selectMode ? btnOn : btn} aria-pressed={selectMode} onClick={() => setSelectMode((v) => !v)} title="開啟後拖曳＝選取區間；也可以按住 Shift 拖曳">
              選取
            </button>
          </div>
        </div>

        <SeriesChart
          d={d} layer={layer} unit={meta.unit} event={event}
          view={view} onViewChange={setView}
          selection={selection} onSelectionChange={onSelectionChange}
          selectMode={selectMode}
          label={`${meta.name}數線`}
          overlay={overlay}
          overlayBands={overlayBands}
        />

        <Legend layer={layer} />

        <div aria-live="polite" className="min-h-[2.75rem] rounded-card bg-well px-3 py-2 text-sm text-ink tnum" style={{ borderRadius: "min(var(--r-card), 12px)" }}>
          {selStats && selRange ? (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
              <span className="font-semibold">選取 {rangeLabel(selRange)}（{selStats.n} 個月）</span>
              <span>平均異常 {num(selStats.meanResidual, 2, true)} {meta.unit}</span>
              <span>z = {num(selStats.meanZ, 1, true)}</span>
              <span>百分位 {pct(selStats.percentile)}</span>
              {selStats.rank && <span>第 {selStats.rank.position}／{selStats.rank.of} {selStats.rank.direction === "low" ? "低" : "高"}</span>}
              <button type="button" className="ml-auto text-link underline underline-offset-2" onClick={() => onSelectionChange(null)}>清除</button>
            </div>
          ) : (
            <span className="text-ink-2">拖曳平移、滾輪縮放；按住 Shift 拖曳（或開啟「選取」）來選一段時間，看它有多不尋常。</span>
          )}
        </div>
      </div>

      <LabPanel
        tool={labTool} onToolChange={pickLabTool}
        source={source} onSourceChange={setLabSource}
        hasSelection={selection != null}
        range={n && labEnd >= labStart ? { start: d.months[labStart], end: d.months[labEnd] } : null}
        outcome={labOutcome}
        unit={meta.unit}
        months={d.months}
        spanMonths={labEnd - labStart}
        baselineWarning={labTool != null && BASELINE_SENSITIVE.has(labTool) && labBaseline >= 0.8}
        onShowResidual={layer !== "residual" ? () => setLayer("residual") : undefined}
        log={labLog}
      />

      <TrendPanel stats={p.trend} unit={meta.unit} record={record} />
    </div>
  );
}

function Legend({ layer }: { layer: ChartLayer }) {
  const item = (sw: ReactNode, text: string) => (
    <span className="inline-flex items-center gap-1.5">{sw}{text}</span>
  );
  const lineSw = (c: string, dashed = false) => (
    <svg width="16" height="8" aria-hidden="true"><line x1="0" x2="16" y1="4" y2="4" strokeWidth="2.5" strokeDasharray={dashed ? "4 3" : undefined} style={{ stroke: `var(${c})` }} /></svg>
  );
  const box = (c: string, o = 1) => <span aria-hidden="true" className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: `var(${c})`, opacity: o }} />;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {layer === "raw" && <>{item(lineSw("--viz-blue"), "原始值")}{item(lineSw("--viz-ink", true), "正常值（趨勢＋季節）")}</>}
      {layer === "seasonal" && item(lineSw("--viz-blue"), "季節循環")}
      {layer === "trend" && <>{item(lineSw("--viz-blue"), "長期趨勢（基準期擬合）")}{item(lineSw("--viz-ink"), "原始值")}</>}
      {layer === "residual" && <>{item(box("--viz-warm"), "高於正常")}{item(box("--viz-cool"), "低於正常")}{item(lineSw("--ink-3", true), "±2σ")}</>}
      {item(box("--action", 0.45), "事件期間")}
      {item(box("--ink", 0.12), "缺值")}
    </div>
  );
}
