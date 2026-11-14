"use client";
import { useId } from "react";
import { Provenance } from "@/components/ui/Provenance";
import { DATASET, VARIABLES, formatValue } from "@/lib/variables";
import type { Region, VarId } from "@/lib/types";
import { TAIR_DOMAIN, TAIR_GRADIENT_CSS, chooseScenery, encodingWords, monthLabel, readValue, sceneryWords, type OrbVariant } from "@/components/orb/encoding";
import type { OrbClimate } from "@/lib/contracts";
import { useMemo } from "react";

/**
 * Compact read-out for the crystal ball (use it with `<CrystalBall showLegend={false} />`): each target's value,
 * unit and encoding words, the "colour vapour by air temperature" toggle, and the Real / Illustrative badges.
 * The numbers and mapping words come from `components/orb/encoding.ts`, the same code the ball is drawn with.
 */
export function OrbReadout({
  region,
  climate,
  month,
  targets,
  values,
  colorBy,
  tairColour,
  onTairColourChange,
  leadColorBy,
  noSeries = false,
  playing = false,
  variant = "glass",
  rowRef,
  className = "",
}: {
  region: Region;
  /** long-term means (null without a series); only used to name the scenery */
  climate: OrbClimate | null;
  month: string;
  targets: VarId[];
  values: Partial<Record<VarId, number | null>>;
  /** what colours the vapour right now (see `useExploreState().colorBy`) */
  colorBy: VarId | null;
  tairColour: boolean;
  onTairColourChange: (on: boolean) => void;
  /** a selected lead that drives the vapour colour, if any */
  leadColorBy?: VarId | null;
  /** the region has no land-model series: every value is missing */
  noSeries?: boolean;
  playing?: boolean;
  /** diorama style drawn in the ball (default: glass ball) */
  variant?: OrbVariant;
  /** register each target row element (used to start leader lines) */
  rowRef?: (v: VarId, el: HTMLElement | null) => void;
  className?: string;
}) {
  const id = useId();
  const plan = useMemo(() => chooseScenery(region, climate), [region, climate]);
  const hasEt = targets.includes("et");
  const tempOn = colorBy === "tair" && hasEt;
  const tair = tempOn ? readValue("tair", values.tair) : null;
  const [lo, hi] = TAIR_DOMAIN;

  return (
    <section aria-label="Crystal ball read-out" className={`rounded-card bg-paper p-3.5 text-ink shadow-card ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="font-display text-lg leading-tight tnum" aria-live={playing ? "off" : "polite"}>{month ? monthLabel(month) : ""}</p>
        {!noSeries && <Provenance kind="real" className="!py-0 text-xs" />}
      </header>
      <p className="text-xs text-ink-3">{noSeries ? "No regional series" : `Regional monthly means, ${DATASET.short}`}</p>

      {noSeries && (
        <p className="mt-2 rounded-[10px] bg-well px-2.5 py-1.5 text-[0.8125rem] leading-snug text-ink-2">
          {region.surface === "ice"
            ? "The land model does not cover this ice sheet, so there are no monthly values. Missing, not frozen."
            : "No land-model cells in this region, so there are no monthly values. Missing, not zero."}
        </p>
      )}

      {targets.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">Choose up to three water targets to drive the ball.</p>
      ) : (
        <ul className="mt-2">
          {targets.map((v) => {
            const r = readValue(v, values[v]);
            const m = VARIABLES[v];
            return (
              <li key={v} ref={rowRef ? (el) => rowRef(v, el) : undefined} className="border-t border-line py-1.5 first:border-t-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-semibold leading-snug">
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(${m.color})` }} />
                    <span className="truncate" title={m.label}>{m.short}</span>
                  </span>
                  <span className="whitespace-nowrap text-base font-semibold tnum">
                    {r.missing ? (
                      <span className="text-ink-2">No data</span>
                    ) : (
                      <>{formatValue(v, r.value)} <span className="text-sm font-normal text-ink-2">{m.unit}</span></>
                    )}
                  </span>
                </div>
                <p className="ml-[1.125rem] text-xs leading-snug text-ink-2">
                  {r.missing
                    ? "Not in the series for this month. Drawn grey and hatched, not as zero."
                    : encodingWords(v, r, plan, variant)}
                  {r.flag && ` Clamped: ${r.flag} the shared display range (${m.domain[0]} to ${m.domain[1]} ${m.unit}).`}
                </p>
                {v === "runoff" && !r.missing && <p className="ml-[1.125rem] text-xs leading-snug text-ink-3">Modelled runoff generation, not a river.</p>}
                {v === "swe" && !r.missing && <p className="ml-[1.125rem] text-xs leading-snug text-ink-3">Water equivalent, not snow depth.</p>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-2 rounded-[10px] bg-well px-2.5 py-2">
        <label className={`flex items-center gap-2 text-sm ${hasEt && !leadColorBy ? "cursor-pointer" : "opacity-70"}`}>
          <input
            type="checkbox"
            checked={tairColour && hasEt}
            disabled={!hasEt || !!leadColorBy}
            onChange={(e) => onTairColourChange(e.target.checked)}
            aria-describedby={`${id}-tair`}
            className="h-4 w-4 accent-[var(--link)]"
          />
          Colour vapour by air temperature
        </label>
        <div id={`${id}-tair`}>
          {leadColorBy ? (
            <p className="mt-1 text-xs leading-snug text-ink-2">Vapour colour follows the selected lead: {VARIABLES[leadColorBy].label.toLowerCase()}.</p>
          ) : !hasEt ? (
            <p className="mt-1 text-xs leading-snug text-ink-2">Available when evapotranspiration is a target.</p>
          ) : tair ? (
            <>
              <div className="mt-1.5 flex items-baseline justify-between text-xs text-ink-2 tnum">
                <span className="whitespace-nowrap">{lo} °C</span>
                {!tair.missing && <span className="font-semibold text-ink">{formatValue("tair", tair.value, true)}</span>}
                <span className="whitespace-nowrap">{hi} °C</span>
              </div>
              <div className="relative mt-0.5 h-2 rounded-full border border-line" style={{ background: tair.missing ? "var(--viz-grid)" : TAIR_GRADIENT_CSS }}>
                {!tair.missing && <span aria-hidden="true" className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${tair.t * 100}%` }} />}
              </div>
              <p className="mt-1 text-xs leading-snug text-ink-2">{tair.missing ? "No air temperature this month, so the puffs are grey. " : ""}Puff colour is the regional air temperature, not the temperature of the vapour.</p>
            </>
          ) : (
            <p className="mt-1 text-xs leading-snug text-ink-2">Puffs are neutral.</p>
          )}
        </div>
      </div>

      <div className="mt-2 border-t border-line pt-2">
        <Provenance kind="illustrative" className="!py-0 text-xs" />
        <p className="mt-1 text-xs leading-snug text-ink-2">
          {sceneryWords(plan, variant)} Particles encode monthly rates at a fixed speed, not tracked water.
        </p>
      </div>
    </section>
  );
}
