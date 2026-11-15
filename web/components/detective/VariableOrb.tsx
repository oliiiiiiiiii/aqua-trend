"use client";
// The web-demo crystal ball, driven by one detective variable for one month (UI/UX refresh).
// Props are the contract with the analysis workbench; see docs/ux-refresh.md "Crystal ball".
//
// The ball is created once per region; a month change only changes its props. Variables the ball draws (rain, vapour,
// runoff, soil water, snow) drive their channel with the detective series' own value; everything else keeps the ball as
// scenery and gets a generic gauge. A text read-out under the ball carries the numbers for every variable.
// No frames: the ball has no stage-coloured plate (transparent canvas on the page background) and the read-out is plain
// text under a hairline.
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { Catalog, Region, VarId } from "@/lib/types";
import type { OrbClimate } from "@/lib/contracts";
import type { CategoryId, Decomposition, LayerId } from "@/lib/detective/contracts";
import { climateOf, formatMonth } from "@/components/ui/regionUtils";
import { Segmented } from "@/components/ui/Segmented";
import { HATCH_CSS } from "@/components/orb/encoding";
import { loadRegionSeries } from "@/lib/data";
import { num } from "./format";
import { COPY } from "./copy/orb";
import { ballValue, gaugeOf, mapToBall, readMonth, type GaugeModel, type OrbMode } from "./orbMapping";

export interface VariableOrbProps {
  /** the sub-basin (basin4) being analysed; null while the region catalogue loads */
  region: Region | null;
  catalog: Catalog | null;
  category: CategoryId;
  layer: LayerId;
  /** display name and unit of the variable, e.g. "Soil moisture", "mm" */
  name: string;
  unit: string;
  d: Decomposition;
  /** index into d.months of the month to show */
  monthIndex: number;
  /** which way "above normal" reads for this variable (see anomalyPolarity in docs/ux-refresh.md) */
  highReads: "cool" | "warm";
  className?: string;
}

// a faint disc where the ball will be: no square plate
const Skeleton = () => (
  <div role="status" aria-label={COPY.loading} className="mx-auto aspect-square h-full max-h-full animate-pulse rounded-full bg-well/70" />
);
const CrystalBall = dynamic(() => import("@/components/orb/CrystalBall"), { ssr: false, loading: Skeleton });

/* one request per region, shared by every orb on the page */
const climates = new Map<string, Promise<OrbClimate | null>>();
function climateFor(region: Region, catalog: Catalog): Promise<OrbClimate | null> {
  let p = climates.get(region.id);
  if (!p) {
    p = loadRegionSeries(region, catalog).then((s) => (s ? climateOf(s) : null));
    p.catch(() => climates.delete(region.id));
    climates.set(region.id, p);
  }
  return p;
}

function useClimate(region: Region | null, catalog: Catalog | null) {
  const [state, setState] = useState<{ id: string; climate: OrbClimate | null } | null>(null);
  const id = region?.id ?? null;
  useEffect(() => {
    if (!region || !catalog) return;
    let live = true;
    // a failed load reads like a region without land-model data: the ball stays as scenery
    climateFor(region, catalog).then(
      (climate) => live && setState({ id: region.id, climate }),
      () => live && setState({ id: region.id, climate: null }),
    );
    return () => { live = false; };
  }, [region, catalog]);
  return id != null && state?.id === id ? state : null;
}

function Gauge({ g, mode, highReads }: { g: GaugeModel | null; mode: OrbMode; highReads: "cool" | "warm" }) {
  const lowReads = highReads === "cool" ? "warm" : "cool";
  const missing = g == null || g.pos == null;
  const colour = mode === "normal" || g?.sign == null || g.sign === "at" ? "var(--viz-mid)" : `var(--viz-${g.sign === "above" ? highReads : lowReads})`;
  return (
    <div aria-hidden="true" className="mt-3">
      <div className="relative h-3 rounded-full border border-line bg-well" style={missing ? { background: HATCH_CSS } : undefined}>
        {!missing && (
          <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out" style={{ width: `${Math.max(2, g!.pos! * 100)}%`, background: colour }} />
        )}
        {g?.normalPos != null && (
          <div className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${g.normalPos * 100}%` }} />
        )}
      </div>
      {g && (
        <div className="mt-1 flex justify-between text-[0.6875rem] leading-none text-ink-3 tnum">
          <span>{num(g.lo)}</span>
          <span>{num(g.hi)}</span>
        </div>
      )}
    </div>
  );
}

export default function VariableOrb({ region, catalog, category, layer, name, unit, d, monthIndex, highReads, className = "" }: VariableOrbProps) {
  const [mode, setMode] = useState<OrbMode>("observed");
  const loaded = useClimate(region, catalog);

  const mapping = useMemo(() => mapToBall(category, layer, unit), [category, layer, unit]);
  const read = readMonth(d, monthIndex);
  const month = read.month;
  const monthText = month ? formatMonth(month) : "";
  const monthShort = month ? formatMonth(month, true) : "";
  const ch = mapping.channel;
  const bv = ballValue(mapping, read, mode);
  const values = useMemo(() => (ch ? ({ [ch]: bv } as Partial<Record<VarId, number | null>>) : {}), [ch, bv]);
  const targets = useMemo<VarId[]>(() => (ch ? [ch] : []), [ch]);
  const gauge = useMemo(() => (ch ? null : gaugeOf(d, read, mode)), [ch, d, read.observed, read.normal, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (x: number | null) => (x == null ? COPY.noData : `${num(x)} ${unit}`);
  const anomaly = read.observed != null && read.normal != null ? read.observed - read.normal : null;
  const anomalyText = anomaly == null ? null : anomaly === 0 ? COPY.atNormal : (anomaly > 0 ? COPY.above : COPY.below)(`${num(Math.abs(anomaly))} ${unit}`);
  const range = gaugeOf(d, read, mode);

  return (
    <section aria-label={COPY.ballName(name, monthText)} className={`flex min-w-0 flex-col gap-3 ${className}`}>
      {/* the ball sits on the page itself: the WebGL canvas clears to transparent, so no stage plate behind it */}
      <div className="aspect-square w-full">
        {region && catalog && loaded && month ? (
          <CrystalBall
            className="h-full w-full"
            region={region}
            climate={loaded.climate}
            month={month}
            values={values}
            targets={targets}
            colorBy={null}
            showLegend={false}
            legendPlacement="below"
            onPaper
          />
        ) : (
          <Skeleton />
        )}
      </div>

      <div className="border-t border-line pt-2 text-ink">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h4 className="whitespace-nowrap text-[0.8125rem] font-semibold leading-tight tnum" title={monthText}>{monthShort}</h4>
          <Segmented
            legend={COPY.switchLegend}
            hideLegend
            tone="paper"
            look="underline"
            value={mode}
            onChange={setMode}
            options={[{ value: "observed", label: COPY.observed }, { value: "normal", label: COPY.normal, title: COPY.normalShown }]}
          />
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 text-sm tnum">
          <div className={mode === "observed" ? "" : "text-ink-2"}>
            <dt className="text-[0.6875rem] text-ink-3">{COPY.observedLabel}</dt>
            <dd className={`font-semibold ${read.observed == null ? "text-ink-2" : ""}`}>{fmt(read.observed)}</dd>
          </div>
          <div className={mode === "normal" ? "" : "text-ink-2"}>
            <dt className="text-[0.6875rem] text-ink-3">{COPY.normalLabel}</dt>
            <dd className="font-semibold">{fmt(read.normal)}</dd>
          </div>
        </dl>
        {anomalyText && <p className="mt-1 text-[0.8125rem] text-ink-2 tnum">{anomalyText}</p>}
        {!ch && <Gauge g={gauge} mode={mode} highReads={highReads} />}
        {!ch && range && <p className="mt-1.5 text-[0.6875rem] leading-tight text-ink-3 tnum">{COPY.range(num(range.lo), `${num(range.hi)} ${unit}`)}</p>}
        <p className="mt-1.5 text-[0.6875rem] leading-tight text-ink-3">
          {ch ? COPY.drives(COPY.channel[ch]) : [COPY.scenery, COPY.unmapped[mapping.reason]].filter(Boolean).map((t) => t.replace(/\.$/, "")).join(". ") + "."}
        </p>
      </div>
    </section>
  );
}
