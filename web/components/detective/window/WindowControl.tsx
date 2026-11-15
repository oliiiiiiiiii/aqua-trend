"use client";
// View window: a unit choice (days · weeks · months · years), a native range slider for ± n, the value as text, and an
// "All" shortcut for the whole record. It only changes how much is SHOWN; the baseline exclusion is BaselinePadControl.
//
// Days and weeks mean the daily view around the selection (see daily/DailyView): the monthly chart then covers
// windowMonths(value) months.
import { useId, useState } from "react";
import { WINDOW_LIMITS, WINDOW_UNITS, convertWindow, windowLabel, type ViewWindow, type WindowUnit } from "@/lib/detective/window";
import { COPY } from "../copy/window";

export interface WindowControlProps {
  value: ViewWindow;
  /** fires on every slider step (cheap: it only changes the view) */
  onChange: (w: ViewWindow) => void;
  /** the window "All" returns to; defaults to the last non-all value seen */
  fallback?: Exclude<ViewWindow, "all">;
  /** hide the visible "Window" label (it stays for screen readers) */
  hideLabel?: boolean;
  className?: string;
}

export default function WindowControl({ value, onChange, fallback, hideLabel = false, className = "" }: WindowControlProps) {
  const uid = useId();
  const [last, setLast] = useState<Exclude<ViewWindow, "all">>(value === "all" ? (fallback ?? { unit: "month", n: 12 }) : value);
  if (value !== "all" && (value.unit !== last.unit || value.n !== last.n)) setLast(value);
  const all = value === "all";
  const cur = all ? (fallback ?? last) : value;
  const lim = WINDOW_LIMITS[cur.unit];

  const setUnit = (u: WindowUnit) => onChange(u === cur.unit ? cur : convertWindow(cur, u));
  const setN = (n: number) => onChange({ unit: cur.unit, n });

  return (
    <div role="group" aria-labelledby={`${uid}-l`} className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 ${className}`} title={COPY.windowTitle}>
      <span id={`${uid}-l`} className={hideLabel ? "sr-only" : "text-sm text-ink-2"}>{COPY.window}</span>

      <fieldset className="flex items-center">
        <legend className="sr-only">{COPY.unit}</legend>
        {WINDOW_UNITS.map((u) => {
          const on = !all && cur.unit === u;
          return (
            <label
              key={u}
              title={COPY.unitTitle[u]}
              className={`relative cursor-pointer px-1.5 py-1 text-sm whitespace-nowrap has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus ${on ? "font-semibold text-ink" : "text-ink-2 hover:text-ink"}`}
              style={{ borderRadius: 4 }}
            >
              <input type="radio" name={`${uid}-unit`} value={u} checked={on} onChange={() => setUnit(u)} className="sr-only" />
              {COPY.units[u]}
              <span aria-hidden="true" className={`absolute inset-x-1.5 -bottom-px h-0.5 rounded-full ${on ? "bg-ink" : "bg-transparent"}`} />
            </label>
          );
        })}
      </fieldset>

      <span className="flex min-w-0 flex-[1_1_11rem] items-center gap-2.5">
        <input
          type="range"
          min={lim.min}
          max={lim.max}
          step={1}
          value={cur.n}
          aria-label={COPY.slider}
          aria-valuetext={windowLabel(cur)}
          onChange={(e) => setN(Number(e.target.value))}
          className={`h-6 min-w-[6rem] flex-1 cursor-pointer accent-focus ${all ? "opacity-45" : ""}`}
        />
        <output aria-live="polite" className={`w-[5.75rem] shrink-0 text-sm tnum whitespace-nowrap ${all ? "text-ink-3" : "font-semibold text-ink"}`}>
          {windowLabel(cur)}
        </output>
      </span>

      <button
        type="button"
        aria-pressed={all}
        title={COPY.allTitle}
        onClick={() => onChange(all ? cur : "all")}
        className={`border-b-2 pb-px text-sm whitespace-nowrap ${all ? "border-ink font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
      >
        {COPY.all}
      </button>
    </div>
  );
}
