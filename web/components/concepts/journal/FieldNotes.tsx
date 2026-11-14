"use client";
import { useId } from "react";
import type { ExploreState } from "@/components/explore/useExploreState";
import { TAIR_DOMAIN, TAIR_GRADIENT_CSS, readValue } from "@/components/orb/encoding";
import { formatValue } from "@/lib/variables";

/** The vapour-colour toggle with its scale, written as a note under the targets. */
export function VapourNote({ s }: { s: ExploreState }) {
  const id = useId();
  const hasEt = s.targets.includes("et");
  const lead = s.selectedLead?.orbColorBy ?? null;
  const tair = s.colorBy === "tair" && hasEt ? readValue("tair", s.values.tair) : null;
  const [lo, hi] = TAIR_DOMAIN;
  return (
    <div className="border-t border-[var(--on-stage)] pt-2.5">
      <label className={`flex items-start gap-2 text-[0.9375rem] ${hasEt && !lead ? "cursor-pointer" : "opacity-70"}`}>
        <input
          type="checkbox"
          checked={s.tairColour && hasEt}
          disabled={!hasEt || !!lead}
          onChange={(e) => s.setTairColour(e.target.checked)}
          aria-describedby={`${id}-t`}
          className="mt-1 h-4 w-4 accent-[var(--leaf)]"
        />
        Colour vapour by air temperature
      </label>
      <div id={`${id}-t`} className="mt-1 text-[0.8125rem] leading-snug text-ink-2">
        {lead ? (
          <p>Vapour colour follows the selected lead.</p>
        ) : !hasEt ? (
          <p>Available when evapotranspiration is a target.</p>
        ) : tair ? (
          <>
            <div className="flex items-baseline justify-between tnum">
              <span>{lo} °C</span>
              {!tair.missing && <span className="font-semibold text-ink">{formatValue("tair", tair.value, true)}</span>}
              <span>{hi} °C</span>
            </div>
            <div className="relative mt-0.5 h-2 border border-[var(--on-stage)]" style={{ background: tair.missing ? "var(--viz-grid)" : TAIR_GRADIENT_CSS }}>
              {!tair.missing && <span aria-hidden="true" className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${tair.t * 100}%` }} />}
            </div>
            <p className="mt-1">{tair.missing ? "No air temperature this month, so the puffs are grey. " : ""}Puff colour is the regional air temperature, not the temperature of the vapour.</p>
          </>
        ) : (
          <p>Puffs are neutral.</p>
        )}
      </div>
    </div>
  );
}
