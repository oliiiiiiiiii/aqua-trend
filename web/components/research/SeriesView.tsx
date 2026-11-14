"use client";
import { useId, useRef, useState } from "react";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { MonthField } from "./MonthField";
import {
  numberText,
  periodText,
  validateMonths,
  type Analysis,
  type Datum,
  type Period,
} from "@/lib/research";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
type View = "Original history" | "Fixed seasonal pattern" | "Anomalies and fit";
const H = 200,
  left = 63,
  right = 19,
  top = 17,
  bottom = 32;
const plotH = H - top - bottom;
function asMonth(time: string, end = false) {
  return time.length === 4 ? time + (end ? "-12" : "-01") : time.slice(0, 7);
}
function monthIndex(time: string) {
  return Number(time.slice(0, 4)) * 12 + Number(asMonth(time).slice(5, 7)) - 1;
}

export function SeriesView({ item, onApply }: { item: Analysis; onApply: (period: Period) => void }) {
  const id = useId();
  const [plotRef, width] = useElementWidth<HTMLDivElement>();
  const W = Math.max(180, width || 760);
  const plotW = W - left - right;
  const [view, setView] = useState<View>("Original history");
  const [start, setStart] = useState(item.analysis_period?.start ?? "");
  const [end, setEnd] = useState(item.analysis_period?.end ?? "");
  const [issue, setIssue] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [windowMode, setWindowMode] = useState("history");
  const [cursor, setCursor] = useState<number | null>(null);
  const dragStart = useRef<number | null>(null);
  const history = item.full_history;
  if (!history?.times?.length)
    return <p className="text-ink-2">No prepared time series is available for this result.</p>;

  const seasonal = view === "Fixed seasonal pattern";
  const anomaly = view === "Anomalies and fit";
  const range = item.analysis_period;
  const annual = history.times.every((t) => t.length === 4);
  const viewStart =
    windowMode === "analysis" && range && !seasonal
      ? history.times.findIndex((t) => asMonth(t, true) >= range.start)
      : 0;
  const viewEnd =
    windowMode === "analysis" && range && !seasonal
      ? history.times.filter((t) => asMonth(t) <= range.end).length
      : history.times.length;
  const from = Math.max(0, viewStart);
  const to = viewStart === -1 ? 0 : viewEnd;
  const ticks = seasonal ? months : history.times.slice(from, to);
  const values = seasonal
    ? (item.seasonal_pattern ?? [])
    : anomaly
      ? (history.anomalies ?? []).slice(from, to)
      : history.values.slice(from, to);
  const fit = anomaly ? (history.fitted ?? []).slice(from, to) : [];
  const finite = [...values, ...fit].filter((v): v is number => v != null && Number.isFinite(v));
  const low = finite.length ? Math.min(...finite) : 0;
  const high = finite.length ? Math.max(...finite) : 1;
  const pad = high === low ? Math.abs(high) * 0.05 || 1 : 0;
  const min = low - pad,
    max = high + pad;
  const coords = ticks.map((t, i) => (seasonal ? i : monthIndex(t)));
  const first = coords[0],
    last = coords[coords.length - 1];
  const x = (t: number) => left + (last === first ? 0.5 : (t - first) / (last - first)) * plotW;
  const y = (v: number) => H - bottom - ((v - min) / (max - min)) * plotH;
  function path(data: Datum[]) {
    let connected = false;
    return data
      .map((v, i) => {
        if (v == null || !Number.isFinite(v)) {
          connected = false;
          return "";
        }
        const cmd = connected ? "L" : "M";
        connected = true;
        return `${cmd}${x(coords[i]).toFixed(2)},${y(v).toFixed(2)}`;
      })
      .join(" ");
  }
  function nearest(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const p = ((event.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < coords.length; i++)
      if (Math.abs(x(coords[i]) - p) < Math.abs(x(coords[best]) - p)) best = i;
    return best;
  }
  const shadeStart = range ? Math.max(first, monthIndex(range.start)) : 0;
  const shadeEnd = range ? Math.min(last, monthIndex(range.end)) : -1;
  const current = cursor === null || !ticks.length ? null : Math.max(0, Math.min(cursor, ticks.length - 1));
  const changeView = (next: View) => {
    setView(next);
    setCursor(null);
  };
  return (
    <div ref={plotRef} className="research-series">
      <div role="group" aria-label={item.label + " chart view"} className="view-choices">
        {(["Original history", "Fixed seasonal pattern", "Anomalies and fit"] as View[])
          .filter(
            (v) =>
              v === "Original history" ||
              (v === "Fixed seasonal pattern"
                ? !!item.seasonal_pattern?.length
                : !!history.anomalies?.some((x) => x != null) || !!history.fitted?.some((x) => x != null)),
          )
          .map((v) => (
            <button type="button" key={v} aria-pressed={view === v} onClick={() => changeView(v)}>
              {annual && v === "Anomalies and fit" ? "Annual series and fit" : v}
            </button>
          ))}
      </div>
      {!seasonal && range && (
        <label className="plot-window">
          Plot window
          <select
            value={windowMode}
            onChange={(e) => {
              setWindowMode(e.target.value);
              setCursor(null);
            }}
          >
            <option value="history">Full available history</option>
            <option value="analysis">Analysis period</option>
          </select>
        </label>
      )}
      <figure className="mt-4">
        <figcaption className="mb-1 font-semibold">
          {annual && anomaly ? "Annual series and fit" : view}{" "}
          {item.unit && <span className="font-normal text-ink-2">({item.unit})</span>}
        </figcaption>
        {finite.length > 0 ? (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-labelledby={id + "-plot"}
            tabIndex={0}
            className="series-plot"
            style={{ touchAction: "pan-y" }}
            onPointerDown={(e) => {
              if (!seasonal) {
                dragStart.current = nearest(e);
                e.currentTarget.setPointerCapture(e.pointerId);
              }
            }}
            onPointerCancel={() => {
              dragStart.current = null;
            }}
            onPointerMove={(e) => setCursor(nearest(e))}
            onPointerUp={(e) => {
              const firstIndex = dragStart.current;
              dragStart.current = null;
              if (firstIndex == null) return;
              const lastIndex = nearest(e);
              setCursor(lastIndex);
              if (firstIndex === lastIndex) return;
              setStart(asMonth(ticks[Math.min(firstIndex, lastIndex)]));
              setEnd(asMonth(ticks[Math.max(firstIndex, lastIndex)], true));
              setIssue("");
              setRangeOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              setCursor(
                Math.max(0, Math.min(ticks.length - 1, (current ?? 0) + (e.key === "ArrowRight" ? 1 : -1))),
              );
            }}
          >
            <title id={id + "-plot"}>
              {item.label}. {view}. Use arrow keys to read individual values.
            </title>
            {!seasonal && range && shadeEnd >= shadeStart && (
              <rect
                x={x(shadeStart)}
                y={top}
                width={Math.max(1, x(shadeEnd) - x(shadeStart))}
                height={plotH}
                fill="var(--well)"
              />
            )}
            {[max, (max + min) / 2, min].map((v, i) => (
              <g key={i}>
                <line
                  x1={left}
                  x2={W - right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="var(--viz-axis)"
                  strokeDasharray="3 4"
                />
                <text x={left - 9} y={y(v) + 4} textAnchor="end">
                  {numberText(v)}
                </text>
              </g>
            ))}
            <path
              d={path(values)}
              fill="none"
              stroke="var(--viz-blue)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            {values.map((v, i) =>
              v != null && values[i - 1] == null && values[i + 1] == null ? (
                <circle key={i} cx={x(coords[i])} cy={y(v)} r="2.5" fill="var(--viz-blue)" />
              ) : null,
            )}
            {anomaly && (
              <path
                d={path(fit)}
                fill="none"
                stroke="var(--viz-orange)"
                strokeWidth="2"
                strokeDasharray="6 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {current != null && (
              <line
                x1={x(coords[current])}
                x2={x(coords[current])}
                y1={top}
                y2={H - bottom}
                stroke="var(--ink)"
              />
            )}
            {Array.from(new Set([0, Math.floor((ticks.length - 1) / 2), ticks.length - 1])).map((i) => (
              <text
                key={i}
                x={x(coords[i])}
                y={H - 8}
                textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
              >
                {ticks[i]}
              </text>
            ))}
          </svg>
        ) : (
          <p className="py-6 text-ink-2">No valid values in this view.</p>
        )}
        <p className="text-sm text-ink-2" aria-live="polite">
          {current != null
            ? `${ticks[current]} · ${numberText(values[current])} ${item.unit ?? ""}`
            : seasonal
              ? "Monthly means from the registered historical reference."
              : `Shaded analysis range · ${periodText(range)}`}
          {anomaly && " · Dashed line shows the fitted trend."}
        </p>
      </figure>
      {!seasonal && (
        <details
          className="research-details"
          open={rangeOpen}
          onToggle={(e) => setRangeOpen(e.currentTarget.open)}
        >
          <summary>Choose a new analysis period</summary>
          <p className="mb-3 text-sm text-ink-2">
            Drag across the chart or enter two months. Applying the range runs a new study with updated
            trends, indicators and adjusted evidence.
          </p>
          <div className="chart-range">
            <div className="month-pair">
              <MonthField
                label="From"
                value={start}
                onChange={(value) => {
                  setIssue("");
                  setStart(value);
                }}
              />
              <MonthField
                label="Through"
                value={end}
                onChange={(value) => {
                  setIssue("");
                  setEnd(value);
                }}
              />
            </div>
            <button
              type="button"
              className="research-button"
              onClick={() => {
                const issue = validateMonths({ start, end }, false);
                if (issue) {
                  setIssue(issue);
                  return;
                }
                setIssue("");
                onApply({ start, end });
              }}
            >
              Apply range and rerun
            </button>
          </div>
          {issue && <p role="alert">{issue}</p>}
        </details>
      )}
      <details className="research-details" onToggle={(e) => setTableOpen(e.currentTarget.open)}>
        <summary>View values in a table</summary>
        {tableOpen && (
          <div className="table-scroll" tabIndex={0} aria-label={item.label + " data table"}>
            <table>
              <caption className="sr-only">
                {item.label}, {view} ({item.unit})
              </caption>
              <thead>
                <tr>
                  <th scope="col">{seasonal ? "Month" : "Time"}</th>
                  <th scope="col">{seasonal ? "Reference mean" : "Original"}</th>
                  {seasonal ? (
                    <th scope="col">Reference samples</th>
                  ) : (
                    <>
                      <th scope="col">{annual ? "Fitting series" : "Anomaly"}</th>
                      <th scope="col">Fit</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {ticks.map((t, i) => (
                  <tr key={t}>
                    <th scope="row">{t}</th>
                    <td>{numberText(seasonal ? values[i] : history.values[from + i])}</td>
                    {seasonal ? (
                      <td>{numberText(item.baseline?.counts?.[i])}</td>
                    ) : (
                      <>
                        <td>{numberText(history.anomalies?.[from + i])}</td>
                        <td>{numberText(history.fitted?.[from + i])}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}
