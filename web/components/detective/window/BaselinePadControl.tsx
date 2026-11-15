"use client";
// "Exclude ± [−] 12 [+] months from baseline": the months either side of the event that the normal and σ leave out
// (DetectiveQuery.padMonths, URL `pad`, 3–60). Separate from the view window. Lives in "Baseline and method".
import { useEffect, useId, useState } from "react";
import { PAD_MAX, PAD_MIN } from "@/lib/detective/url";
import { COPY } from "../copy/window";

export interface BaselinePadControlProps {
  value: number;
  onChange: (months: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

export default function BaselinePadControl({ value, onChange, min = PAD_MIN, max = PAD_MAX, className = "" }: BaselinePadControlProps) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]); // eslint-disable-line react-hooks/set-state-in-effect -- follow outside changes
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  const commit = (raw: string) => {
    const n = Number(raw);
    const next = Number.isFinite(n) && raw.trim() !== "" ? clamp(n) : value;
    setText(String(next));
    if (next !== value) onChange(next);
  };
  const step = (d: number) => { const n = clamp(value + d); if (n !== value) onChange(n); };
  const btn = "grid h-7 w-7 place-items-center rounded-full border border-line text-ink-2 hover:border-ink-3 hover:text-ink disabled:opacity-40";

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2 ${className}`} title={COPY.baselineTitle}>
      <label htmlFor={id}>{COPY.baseline} ±</label>
      <span className="inline-flex items-center gap-1">
        <button type="button" className={btn} aria-label={COPY.less} disabled={value <= min} onClick={() => step(-1)}>
          <span aria-hidden="true">−</span>
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={text}
          aria-label={COPY.baselineLabel}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(e.currentTarget.value); }}
          className="w-11 border-b border-line bg-transparent py-0.5 text-center font-semibold text-ink tnum [appearance:textfield] focus:border-focus [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button type="button" className={btn} aria-label={COPY.more} disabled={value >= max} onClick={() => step(1)}>
          <span aria-hidden="true">+</span>
        </button>
      </span>
      <span>{COPY.baselineAfter}</span>
    </div>
  );
}
