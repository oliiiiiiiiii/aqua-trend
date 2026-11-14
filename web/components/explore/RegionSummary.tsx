"use client";
import type { Catalog, Region, RegionSeries } from "@/lib/types";
import { LAYER_LABEL } from "@/lib/data";
import { fmtEquiv, formatArea, formatCount, formatMonth, regionWarnings } from "./regionUtils";

/** Plain text on the stage (no card): name, type, area, cells, a few short warnings. */
export function RegionSummary({
  region,
  catalog,
  series,
  alternatives,
  onSelect,
  className = "",
}: {
  region: Region;
  catalog: Catalog;
  /** undefined while loading, null when there is no series */
  series: RegionSeries | null | undefined;
  /** other regions that contain the last clicked point */
  alternatives: Region[];
  onSelect: (r: Region) => void;
  className?: string;
}) {
  const parent = region.parent ? catalog.byId.get(region.parent) : undefined;
  const warnings = regionWarnings(region);
  const missing = series ? countMissing(series) : 0;
  const link = "rounded-ctl text-left underline underline-offset-2 hover:no-underline";

  return (
    <section id="region" aria-labelledby="region-h" className={`on-stage scroll-mt-20 ${className}`}>
      <h1 id="region-h" className="text-2xl leading-tight sm:text-[1.75rem]">{region.name}</h1>
      <p className="mt-1 text-[0.9375rem] leading-snug">{LAYER_LABEL[region.type]}</p>
      <p className="text-[0.9375rem] leading-snug tnum">{formatArea(region.areaKm2)}</p>
      <p className="text-[0.9375rem] leading-snug tnum">
        {region.cells ? (
          <>
            {formatCount(region.cells)} GLDAS 1° {region.cells === 1 ? "cell" : "cells"}
            {region.cellEquiv != null && region.cellEquiv !== region.cells && <>, {fmtEquiv(region.cellEquiv)} cell-equivalents</>}
          </>
        ) : (
          "No GLDAS cells"
        )}
      </p>
      {series && (
        <p className="text-[0.9375rem] leading-snug text-on-stage-2 tnum">
          {formatMonth(series.months[0], true)} to {formatMonth(series.months[series.months.length - 1], true)}
          {missing > 0 ? `, ${missing} months missing` : ""}
        </p>
      )}
      {region.iso?.length ? (
        <p className="text-[0.9375rem] leading-snug text-on-stage-2">
          <span className="sr-only">ISO codes: </span>
          {region.iso.slice(0, 6).join(", ")}
          {region.iso.length > 6 ? ` and ${region.iso.length - 6} more` : ""}
        </p>
      ) : null}
      {parent && (
        <p className="text-[0.9375rem] leading-snug">
          Inside{" "}
          <button type="button" onClick={() => onSelect(parent)} className={link}>{parent.name}</button>
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Things to keep in mind about this region">
          {warnings.map((w) => (
            <li key={w.id} title={w.text} className="border-l-2 border-[color:var(--status-warning)] pl-2 text-[0.8125rem] leading-snug">
              <span className="sr-only">{w.text}</span>
              <span aria-hidden="true">{w.short}</span>
            </li>
          ))}
        </ul>
      )}

      {alternatives.length > 0 && (
        <details className="mt-2 text-[0.8125rem]">
          <summary className="cursor-pointer rounded-ctl">Other boundaries at this point ({alternatives.length})</summary>
          <p className="mt-1 leading-snug text-on-stage-2">Different scopes of the same place, not independent evidence.</p>
          <ul className="mt-1 space-y-0.5">
            {alternatives.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onSelect(r)} className={link}>{r.name}</button>
                <span className="text-on-stage-2"> {LAYER_LABEL[r.type].toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function countMissing(s: RegionSeries): number {
  const a = s.values.precip;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Number.isNaN(a[i])) n++;
  return n;
}
