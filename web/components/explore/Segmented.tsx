"use client";
import { useId, type ReactNode } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** A labelled radio group drawn as a segmented control. `tone` picks stage or paper colours. */
export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  tone = "stage",
  hideLegend = false,
  className = "",
  gridOnMobile = false,
}: {
  legend: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  tone?: "stage" | "paper";
  hideLegend?: boolean;
  className?: string;
  /** two-column grid below the sm breakpoint, for long option lists */
  gridOnMobile?: boolean;
}) {
  const name = useId();
  const stage = tone === "stage";
  return (
    <fieldset className={`min-w-0 ${className}`}>
      <legend className={hideLegend ? "sr-only" : `mb-1.5 text-sm ${stage ? "text-on-stage-2" : "text-ink-2"}`}>{legend}</legend>
      <div
        className={`max-w-full gap-0.5 border p-0.5 ${gridOnMobile ? "grid grid-cols-2 rounded-card sm:inline-flex sm:rounded-ctl" : "inline-flex flex-wrap rounded-ctl"} ${stage ? "border-stage-line" : "border-line bg-well"}`}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label
              key={o.value}
              title={o.title}
              className={`cursor-pointer rounded-ctl px-3 py-1 text-center text-sm whitespace-nowrap has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-1 ${
                stage
                  ? `has-[:focus-visible]:outline-on-stage ${on ? "bg-on-stage font-semibold text-stage" : "text-on-stage hover:bg-stage-line"}`
                  : `has-[:focus-visible]:outline-focus ${on ? "bg-paper font-semibold text-ink shadow-card ring-1 ring-line" : "text-ink-2 hover:text-ink"}`
              }`}
            >
              <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} className="sr-only" />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
