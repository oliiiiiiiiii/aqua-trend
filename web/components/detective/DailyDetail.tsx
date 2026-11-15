"use client";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import type { TimeRange } from "@/lib/detective/contracts";
import { DAILY_MAX_MONTHS, shortDailyRange, supportsDaily, type DailyRequest, type DailySeries } from "@/lib/detective/daily";
import { DailyLoadError, completedDailyRange, dailyRequestKey, requestDailySeries, type DailyProgress } from "@/lib/detective/daily-client";
import { ChartTooltip, TipRow } from "@/components/charts/ChartTooltip";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { num } from "./format";

type Load =
  | { key: string; status: "loading"; progress?: DailyProgress }
  | { key: string; status: "ready"; series: DailySeries }
  | { key: string; status: "error"; code: DailyLoadError["code"]; progress?: DailyProgress };

const cache = new Map<string, { series: DailySeries; savedAt: number }>();
const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const monthlyNote = "z 值、歷史排名、季節分解與長期趨勢仍以月資料計算；每日資料用來查看事件細節。";

function remember(key: string, series: DailySeries) {
  if (!series.values.some(finite)) return;
  cache.delete(key);
  cache.set(key, { series, savedAt: Date.now() });
  if (cache.size > 20) cache.delete(cache.keys().next().value!);
}

export default function DailyDetail({ region, layer, time, product }: {
  region: string; layer: string; time: TimeRange; product?: string;
}) {
  const range = useMemo(() => shortDailyRange(time), [time.start, time.end]);
  const completedRange = useMemo(() => range ? completedDailyRange(range) : null, [range]);
  const request = useMemo<DailyRequest | null>(() => completedRange && supportsDaily(layer)
    ? { region, layer, ...completedRange } : null, [region, layer, completedRange]);
  const requestKey = request ? dailyRequestKey(request) : "";
  const [attempt, setAttempt] = useState(0);
  const key = `${requestKey}|${attempt}`;
  const [state, setState] = useState<Load | null>(null);
  const identity = useRef(0);
  const titleId = useId();

  useEffect(() => {
    const id = ++identity.current;
    if (!request) return;
    const controller = new AbortController();
    const live = () => !controller.signal.aborted && identity.current === id;
    const cached = cache.get(requestKey);
    if (cached && Date.now() - cached.savedAt < 5 * 60_000) {
      setState({ key, status: "ready", series: cached.series });
      return () => controller.abort();
    }
    setState({ key, status: "loading" });
    let progress: DailyProgress | undefined;
    const timer = setTimeout(() => {
      void requestDailySeries(request, controller.signal, (update) => {
        if (!live()) return;
        progress = update;
        setState({ key, status: "loading", progress });
      }).then((series) => {
        if (!live()) return;
        remember(requestKey, series);
        setState({ key, status: "ready", series });
      }, (error: unknown) => {
        if (!live()) return;
        setState({ key, status: "error", code: error instanceof DailyLoadError ? error.code : "failed", progress });
      });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [request, requestKey, key]);

  if (!supportsDaily(layer)) return (
    <p className="mb-4 text-sm text-ink-2">{product ?? layer} 尚未提供每日明細，以下使用月資料。</p>
  );
  if (!range) return (
    <p className="mb-4 text-sm text-ink-2">目前使用月資料。事件期間縮至 {DAILY_MAX_MONTHS} 個月以內時，會自動載入每日原始值。</p>
  );

  const current = state?.key === key ? state : null;
  const series = current?.status === "ready" ? current.series : current?.progress?.series ?? null;
  const dailyProduct = series?.source.dataset ?? (layer === "p_imerg" ? "GPM IMERG 日降雨" : "GLDAS Noah 2.1 日資料");
  const completedDays = current?.status === "ready" ? current.series.dates.length : current?.progress?.completedDays ?? 0;
  const observed = series?.values.filter(finite).length ?? 0;
  const loading = !!request && (!current || current.status === "loading");
  const retry = () => { cache.delete(requestKey); setAttempt((value) => value + 1); };

  return (
    <section aria-labelledby={titleId} className="mb-5 min-w-0 rounded-card bg-paper p-4 text-ink shadow-card sm:p-5">
      <h2 id={titleId} className="text-lg font-semibold">每日原始值</h2>
      <p className="mt-1 break-words text-sm text-ink-2">{dailyProduct} · <span className="tnum">{range.start} 至 {range.end}</span></p>
      <p className="mt-2 text-sm text-ink-2">{monthlyNote}</p>
      {!completedRange && <p className="mt-4 text-sm text-ink-2">這段期間尚無已結束的 UTC 日期，暫不載入每日資料。</p>}
      {completedRange && completedRange.end !== range.end && <p className="mt-2 text-sm text-ink-2">每日資料僅包含已結束的 UTC 日期，本次顯示至 {completedRange.end}。</p>}
      {loading && <p role="status" aria-busy="true" className={`mt-4 text-sm text-ink-2 ${series ? "" : "min-h-24"}`}>
        {series ? `已取得 ${completedDays} / ${series.dates.length} 天，正在載入下一段。` : "正在取得每日資料，可先查看下方月資料。"}
      </p>}
      {current?.status === "error" && (
        <div className="mt-4" role="status">
          <p className="text-sm text-ink-2">{current.code === "unavailable"
            ? "每日資料服務目前無法使用，可繼續查看下方月資料。"
            : current.code === "timeout"
              ? "每日資料尚未準備完成。可稍後重試，或繼續查看下方月資料。"
              : "無法取得這段期間的每日資料，可繼續查看下方月資料。"}</p>
          {series && <p className="mt-1 text-sm text-ink-2">已取得 {completedDays} / {series.dates.length} 天，保留以下部分資料。</p>}
          <button type="button" onClick={retry} className="mt-3 min-h-11 cursor-pointer rounded-ctl bg-action px-4 py-2 font-semibold text-on-action hover:bg-action-hover active:underline">重試每日資料</button>
        </div>
      )}
      {series && (
        <>
          <p role="status" className="mt-4 text-sm text-ink-2">
            每日覆蓋：已取得的 {completedDays} 天中，<span className="font-semibold text-ink tnum">{observed} 天有值</span>，缺值 {completedDays - observed} 天。
            {completedDays < series.dates.length && `另有 ${series.dates.length - completedDays} 天尚未載入。`}
            缺值不視為 0，也不插補。
          </p>
          {observed > 0 ? <DailyChart key={requestKey} series={series} completedDays={completedDays} /> : (
            <p className="my-5 text-sm text-ink-2">{completedDays < series.dates.length ? "目前取得的日期沒有每日觀測值，其餘日期尚未載入。" : "此期間沒有每日觀測值。請選擇其他期間，或查看下方月資料。"}</p>
          )}
          <details className="mt-3 border-t border-line pt-1">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-link hover:underline">逐日數值表（{series.unit}）</summary>
            <div className="max-h-72 overflow-auto border border-line" style={{ borderRadius: "min(var(--r-ctl), 8px)" }}>
              <table className="w-full text-left text-sm tnum">
                <caption className="sr-only">{dailyProduct} 每日原始值，{series.start} 至 {series.end}，單位 {series.unit}</caption>
                <thead className="sticky top-0 bg-paper text-ink-2"><tr><th scope="col" className="px-3 py-2 font-semibold">日期</th><th scope="col" className="px-3 py-2 text-right font-semibold">數值（{series.unit}）</th></tr></thead>
                <tbody>{series.dates.map((date, i) => <tr key={date} className="border-t border-line"><th scope="row" className="px-3 py-2 font-normal">{date}</th><td className="px-3 py-2 text-right">{i >= completedDays ? "尚未載入" : finite(series.values[i]) ? num(series.values[i]) : "缺值"}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
          <div className="mt-3 space-y-1 break-words text-xs leading-relaxed text-ink-2">
            <p>來源資料集：<a href={series.source.url} target="_blank" rel="noreferrer" className="cursor-pointer text-link underline underline-offset-2 hover:no-underline">{series.source.dataset}</a>（{series.source.provider}）</p>
            <p>{series.source.aggregation}；{series.source.spatialMethod}</p>
            <p>最近取得時間：<time dateTime={series.retrievedAt}>{new Date(series.retrievedAt).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</time></p>
          </div>
        </>
      )}
    </section>
  );
}

function DailyChart({ series, completedDays }: { series: DailySeries; completedDays: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = series.dates.length;
  const height = 240, top = 24, bottom = 30, right = 24;
  const values = series.values;
  const observed = values.filter(finite);
  let low = Math.min(...observed), high = Math.max(...observed);
  const padding = high === low ? Math.max(0.5, Math.abs(low) * 0.05) : (high - low) * 0.08;
  low -= padding; high += padding;
  const innerHeight = height - top - bottom;
  const y = scaleLinear().domain([low, high]).range([innerHeight, 0]).nice(4);
  const ticks = y.ticks(4);
  const labels = ticks.map((value) => num(value));
  const left = Math.max(42, Math.max(...labels.map((label) => label.length)) * 7 + 12);
  const innerWidth = Math.max(20, width - left - right);
  const x = scaleLinear().domain([-0.5, n - 0.5]).range([0, innerWidth]);
  const indexes = Array.from({ length: n }, (_, i) => i);
  const path = line<number>().defined((i) => finite(values[i])).x((i) => x(i)).y((i) => y(values[i]!))(indexes) ?? "";
  const count = Math.max(2, Math.min(n, Math.floor(innerWidth / 82)));
  const xTicks = [...new Set(Array.from({ length: count }, (_, i) => Math.round(i * (n - 1) / (count - 1))))];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") setHover((value) => Math.min(n - 1, (value ?? -1) + 1));
    else if (event.key === "ArrowLeft") setHover((value) => Math.max(0, (value ?? n) - 1));
    else if (event.key === "Home") setHover(0);
    else if (event.key === "End") setHover(n - 1);
    else if (event.key === "Escape") setHover(null);
    else return;
    event.preventDefault();
  };
  const valueAt = (index: number) => index >= completedDays ? "尚未載入" : finite(values[index]) ? `${num(values[index])} ${series.unit}` : "缺值";
  const readout = hover === null ? null : `${series.dates[hover]}：${valueAt(hover)}`;

  return (
    <div ref={ref} className="relative mt-3" style={{ height, borderRadius: "min(var(--r-ctl), 8px)" }} role="group" tabIndex={0}
      aria-label="每日原始值折線圖。左右方向鍵逐日查看，Home 和 End 跳至首尾，Esc 清除。亦可開啟下方逐日數值表。"
      onKeyDown={onKeyDown} onBlur={() => setHover(null)}>
      <span className="sr-only" aria-live="polite">{readout}</span>
      {width > 0 && <svg width={width} height={height} aria-hidden="true" className="block">
        <g transform={`translate(${left},${top})`}>
          {completedDays < n && <g>
            <rect x={x(completedDays - 0.5)} width={innerWidth - x(completedDays - 0.5)} height={innerHeight} style={{ fill: "var(--well)" }} />
            {innerWidth - x(completedDays - 0.5) > 72 && <text x={x((completedDays + n - 1) / 2)} y={16} textAnchor="middle" style={{ fill: "var(--ink-2)", fontSize: 11 }}>尚未載入</text>}
          </g>}
          {ticks.map((tick, i) => <g key={tick}>
            <line x2={innerWidth} y1={y(tick)} y2={y(tick)} style={{ stroke: "var(--viz-grid)" }} />
            <text x={-8} y={y(tick)} dy="0.32em" textAnchor="end" className="tnum" style={{ fill: "var(--ink-2)", fontSize: 11 }}>{labels[i]}</text>
          </g>)}
          <text x={-left + 2} y={-10} style={{ fill: "var(--ink-2)", fontSize: 11 }}>{series.unit}</text>
          <path d={path} fill="none" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--viz-blue)" }} />
          {indexes.filter((i) => finite(values[i]) && !finite(values[i - 1]) && !finite(values[i + 1])).map((i) =>
            <circle key={i} cx={x(i)} cy={y(values[i]!)} r={3} style={{ fill: "var(--viz-blue)" }} />)}
          {hover !== null && <g>
            <line x1={x(hover)} x2={x(hover)} y2={innerHeight} style={{ stroke: "var(--ink-3)" }} />
            {finite(values[hover]) && <circle cx={x(hover)} cy={y(values[hover]!)} r={4} strokeWidth={2} style={{ fill: "var(--viz-blue)", stroke: "var(--paper)" }} />}
          </g>}
          <line x2={innerWidth} y1={innerHeight} y2={innerHeight} style={{ stroke: "var(--viz-axis)" }} />
          {xTicks.map((i, index) => <text key={i} x={x(i)} y={innerHeight + 19} textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"} className="tnum" style={{ fill: "var(--ink-2)", fontSize: 11 }}>{series.dates[i].slice(5)}</text>)}
          <rect width={innerWidth} height={innerHeight} fill="transparent" style={{ cursor: "crosshair", touchAction: "pan-y" }}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setHover(Math.max(0, Math.min(n - 1, Math.round(x.invert(event.clientX - bounds.left)))));
            }} onPointerLeave={() => setHover(null)} />
        </g>
      </svg>}
      {width > 0 && hover !== null && <ChartTooltip x={left + x(hover)} width={width}>
        <div className="mb-1 font-semibold tnum">{series.dates[hover]}</div>
        <TipRow color="--viz-blue" value={valueAt(hover)} label="每日原始值" />
      </ChartTooltip>}
    </div>
  );
}
