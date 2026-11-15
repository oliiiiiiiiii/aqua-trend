"use client";
// Harness for the crystal-ball package, on real GLDAS data.
// Query string for screenshots: ?region=<id>&month=2015-07&targets=precip,et&colorBy=tair&missing=all|precip,et&play=1&noseries=1
// variant=glass|hex-glass|hex-island (or orb=glass|hex|island) picks the diorama style.
// compact=1 also shows two compact comparison orbs (first and last month shown) beside the main one.
// noseries=1 passes climate = null as for a region without land-model data (the "no data" state).
import { useEffect, useMemo, useState } from "react";
import CrystalBall from "@/components/orb/CrystalBall";
import { climateOf, valuesAt } from "@/components/ui/regionUtils";
import { VARIANT_LABEL, type OrbVariant } from "@/components/orb/encoding";
import type { OrbClimate } from "@/lib/contracts";
import { loadCatalog, loadRegionSeries } from "@/lib/data";
import type { Catalog, RegionSeries, VarId } from "@/lib/types";
import { MAX_TARGETS, TARGET_VARS, VARIABLES } from "@/lib/variables";

const REGIONS = [
  "named-sahel", "named-amazon-deforestation-arc", "named-arabian-aquifers-saudi",
  "named-high-mountain-asia", "b3-3030009130", "named-california-central-valley",
  "named-taiwan-island", "lme-23", "sea-NPO", "ice-EAN", "named-greenland",
];

function mean(a: Float32Array): number {
  let s = 0, n = 0;
  for (const x of a) if (Number.isFinite(x)) { s += x; n++; }
  return n ? s / n : NaN;
}

export default function OrbHarness() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [regionId, setRegionId] = useState(REGIONS[0]);
  const [series, setSeries] = useState<RegionSeries | null>(null);
  /** id of the region whose series request has finished (a null series is a valid answer: no land-model cells) */
  const [loaded, setLoaded] = useState<string | null>(null);
  const [mi, setMi] = useState(0);
  const [targets, setTargets] = useState<VarId[]>(["precip", "et", "soil_top"]);
  const [colorBy, setColorBy] = useState<VarId | null>("tair");
  const [missing, setMissing] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [showCompact, setShowCompact] = useState(false);
  const [forceNull, setForceNull] = useState(false);
  const [variant, setVariant] = useState<OrbVariant>("glass");
  const [initMonth, setInitMonth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    /* eslint-disable react-hooks/set-state-in-effect -- read the query string once on mount */
    if (q.get("region")) setRegionId(q.get("region")!);
    if (q.get("targets")) setTargets(q.get("targets")!.split(",").filter((v) => TARGET_VARS.includes(v as VarId)).slice(0, MAX_TARGETS) as VarId[]);
    if (q.has("colorBy")) setColorBy(q.get("colorBy") === "tair" ? "tair" : null);
    if (q.get("missing")) setMissing(q.get("missing")!.split(","));
    if (q.get("play") === "1") setPlaying(true);
    if (q.get("compact") === "1") setShowCompact(true);
    if (q.get("noseries") === "1") setForceNull(true);
    const v = q.get("variant") ?? q.get("orb");
    setVariant(v === "hex-glass" || v === "hex" ? "hex-glass" : v === "hex-island" || v === "island" ? "hex-island" : "glass");
    setInitMonth(q.get("month") ?? "2015-07");
    /* eslint-enable react-hooks/set-state-in-effect */
    loadCatalog().then(setCatalog, (e) => setError(String(e)));
  }, []);

  const region = catalog?.byId.get(regionId) ?? null;
  useEffect(() => {
    if (!catalog || !region) return;
    let live = true;
    loadRegionSeries(region, catalog).then((s) => {
      if (!live) return;
      setSeries(s);
      setLoaded(region.id);
      if (initMonth) { const i = catalog.months.indexOf(initMonth); if (i >= 0) setMi(i); setInitMonth(null); }
    }, (e) => setError(String(e)));
    return () => { live = false; };
  }, [catalog, region, initMonth]);

  useEffect(() => {
    if (!playing || !catalog) return;
    const id = setInterval(() => setMi((i) => (i + 1) % catalog.months.length), 250);
    return () => clearInterval(id);
  }, [playing, catalog]);

  const climate: OrbClimate | null = useMemo(
    () => (series && !forceNull ? { ...climateOf(series), precip: mean(series.values.precip), et: mean(series.values.et), swe: mean(series.values.swe), tair: mean(series.values.tair) } : null),
    [series, forceNull],
  );
  const month = catalog?.months[mi] ?? "2000-01";
  const values = useMemo(() => {
    const out: Partial<Record<VarId, number | null>> = {};
    if (!series || forceNull) return out;
    for (const v of Object.keys(VARIABLES) as VarId[]) {
      const x = series.values[v][mi];
      out[v] = missing.includes("all") || missing.includes(v) ? null : Number.isFinite(x) ? x : null;
    }
    return out;
  }, [series, mi, missing, forceNull]);

  const toggleTarget = (v: VarId) =>
    setTargets((t) => (t.includes(v) ? t.filter((x) => x !== v) : t.length >= MAX_TARGETS ? t : [...t, v]));
  const forceAll = missing.includes("all");

  return (
    <div className="stage-sky on-stage min-h-dvh px-4 py-6 sm:px-8">
      <h1 className="font-display text-2xl text-on-stage">Crystal ball harness</h1>
      {error && <p className="mt-2 text-on-stage">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-on-stage">
        <label className="flex items-center gap-2">Region
          <select className="rounded-ctl bg-paper px-3 py-1 text-ink" value={regionId} onChange={(e) => { setRegionId(e.target.value); setSeries(null); setLoaded(null); }}>
            {REGIONS.map((id) => <option key={id} value={id}>{catalog?.byId.get(id)?.name ?? id}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">Month
          <input type="range" min={0} max={(catalog?.months.length ?? 1) - 1} value={mi} onChange={(e) => setMi(+e.target.value)} className="w-48" aria-valuetext={month} />
          <span className="tnum w-16">{month}</span>
        </label>
        <button type="button" className="rounded-ctl bg-action px-4 py-1.5 font-semibold text-on-action hover:bg-action-hover" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause history" : "Play history"}
        </button>
        <label className="flex items-center gap-2"><input type="checkbox" checked={colorBy === "tair"} onChange={(e) => setColorBy(e.target.checked ? "tair" : null)} /> Colour vapour by air temperature</label>
        <div role="group" aria-label="Diorama" className="flex items-center gap-1">
          Diorama
          {(Object.keys(VARIANT_LABEL) as OrbVariant[]).map((v) => (
            <button key={v} type="button" aria-pressed={variant === v} onClick={() => setVariant(v)}
              className={`rounded-ctl px-3 py-1 font-semibold ${variant === v ? "bg-paper text-ink" : "border border-stage-line text-on-stage"}`}>
              {VARIANT_LABEL[v]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={forceAll} onChange={(e) => setMissing(e.target.checked ? ["all"] : [])} /> Force missing values</label>
      </div>
      <fieldset className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-on-stage">
        <legend className="sr-only">Targets (max 3)</legend>
        {TARGET_VARS.map((v) => (
          <label key={v} className="flex items-center gap-1.5">
            <input type="checkbox" checked={targets.includes(v)} disabled={!targets.includes(v) && targets.length >= MAX_TARGETS} onChange={() => toggleTarget(v)} />
            {VARIABLES[v].short}
          </label>
        ))}
      </fieldset>
      <div className="mt-6">
        {region && loaded === region.id ? (
          <div className="flex items-center gap-4">
            {showCompact && <CrystalBall compact className="h-[13rem] w-[13rem] shrink-0" region={region} climate={climate} month={catalog?.months[0] ?? "2000-01"} values={valuesAt(series!, 0)} targets={targets} colorBy={colorBy} variant={variant} />}
            <CrystalBall className="min-w-0 flex-1 lg:h-[42rem]" region={region} climate={climate} month={month} values={values} targets={targets} colorBy={colorBy} playing={playing} variant={variant} />
            {showCompact && <CrystalBall compact className="h-[13rem] w-[13rem] shrink-0" region={region} climate={climate} month={catalog?.months[catalog.months.length - 1] ?? "2000-01"} values={valuesAt(series!, catalog!.months.length - 1)} targets={targets} colorBy={colorBy} variant={variant} />}
          </div>
        ) : (
          <p className="text-on-stage-2">Loading region series…</p>
        )}
      </div>
    </div>
  );
}
