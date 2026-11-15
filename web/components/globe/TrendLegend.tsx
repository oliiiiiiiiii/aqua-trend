"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { VarId } from "@/lib/types";
import { VARIABLES } from "@/lib/variables";
import { Provenance } from "@/components/ui/Provenance";
import { PLANET, rgbCss } from "./palette";

function fmt(x: number, decimals: number) {
  if (x === 0) return "0";
  const s = Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${x < 0 ? "−" : "+"}${s}`;
}
function decimalsFor(x: number) {
  return x >= 10 ? 0 : x >= 1 ? 1 : x >= 0.1 ? 2 : 3;
}

/** Legend for the 1° trend overlay. The scale is symmetric around zero at the 95th percentile of |Sen slope|. */
export default function TrendLegend({ variable, limitPerYear, className = "" }: { variable: VarId; limitPerYear: number; className?: string }) {
  const m = VARIABLES[variable];
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  // Collapsed by default when the globe's container is narrower than 640 px; the reader can still toggle it.
  const [narrow, setNarrow] = useState(false);
  const [choice, setChoice] = useState<boolean | null>(null);
  useEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host) return;
    const ro = new ResizeObserver(() => setNarrow(host.clientWidth < 640));
    ro.observe(host);
    setNarrow(host.clientWidth < 640);
    return () => ro.disconnect();
  }, []);
  const open = choice ?? !narrow;
  const lim = limitPerYear * 10;
  const d = decimalsFor(lim);
  const decr = m.increaseReads === "cool" ? "var(--viz-warm)" : "var(--viz-cool)";
  const incr = m.increaseReads === "cool" ? "var(--viz-cool)" : "var(--viz-warm)";
  const strong = `linear-gradient(90deg, ${decr}, var(--viz-map-mid), ${incr})`;
  const muted = `linear-gradient(90deg, color-mix(in srgb, ${decr} 28%, var(--viz-map-mid)), var(--viz-map-mid), color-mix(in srgb, ${incr} 28%, var(--viz-map-mid)))`;
  const toggle = (
    <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setChoice(!open)}
      className="shrink-0 rounded-ctl border border-line bg-paper px-2.5 py-1 text-[0.8125rem] font-semibold text-ink hover:bg-well">
      {open ? "Hide legend" : "Legend"}
    </button>
  );
  return (
    <div ref={rootRef} className={`w-[17.5rem] max-w-[calc(100%-1rem)] ${open ? "rounded-card border border-line bg-paper p-3 shadow-card" : "w-auto"} text-[0.8125rem] leading-snug text-ink ${className}`}>
      {!open && toggle}
      <div id={bodyId} hidden={!open}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-[0.9375rem] text-ink">{m.label}</p>
        <Provenance kind="real" className="shrink-0" />
      </div>
      <p className="mt-0.5 text-ink-2">Sen slope, {m.trendUnit}</p>
      <div className="mt-2" aria-hidden="true">
        <div className="h-2.5 rounded-sm" style={{ background: strong }} />
        <div className="mt-1 h-1.5 rounded-sm" style={{ background: muted }} />
      </div>
      <div className="tnum mt-1 flex justify-between text-ink-2">
        <span>{fmt(-lim, d)}</span><span>0</span><span>{fmt(lim, d)}</span>
      </div>
      <p className="sr-only">
        Colour scale from {fmt(-lim, d)} to {fmt(lim, d)} {m.trendUnit}; values beyond are clamped to the end colours.
      </p>
      <p className="mt-1.5 text-ink-2">2000–2025, 1° GLDAS cells. Scale ends at the 95th percentile of |slope|.</p>
      <ul className="mt-1.5 space-y-1 text-ink-2">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-1.5 w-5 shrink-0 rounded-sm" style={{ background: muted }} />
          Muted = Mann–Kendall p ≥ 0.05, preliminary, uncorrected
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-3 w-5 shrink-0 rounded-sm" style={{ background: rgbCss(PLANET.noData) }} />
          Grey = no GLDAS data on this land
        </li>
      </ul>
      <div className="mt-2 flex justify-end">{open && toggle}</div>
      </div>
    </div>
  );
}
