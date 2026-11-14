"use client";
// Harness for the evidence package: real catalogue + real series on a paper surface.
//   /dev/evidence?region=named-sahel&targets=precip,et&month=200&view=anomaly&table=1
import { useEffect, useMemo, useState } from "react";
import { loadCatalog, loadRegionSeries } from "@/lib/data";
import type { Catalog, Region, RegionSeries, VarId } from "@/lib/types";
import { MAX_TARGETS, TARGET_VARS, VARIABLES } from "@/lib/variables";
import { THEMES, setTheme, useThemeId } from "@/lib/theme";
import TrendPanel from "@/components/evidence/TrendPanel";
import type { ChartView } from "@/components/charts/TimeSeriesChart";

const PICKS = [
  "named-california-central-valley", "named-sahel", "named-high-mountain-asia", "named-indo-gangetic-plain",
  "named-amazon-deforestation-arc", "named-arabian-aquifers-saudi", "named-aral-sea", "named-taiwan-main-island",
  "named-greenland", "b3-6030007000", "b3-1030034260", "b3-7030047060", "b3-3030009130", "ice-EAN", "sea-NPO",
];

const sel = "max-w-full rounded-ctl border border-line bg-paper px-3 py-1.5 text-sm text-ink";

export default function EvidenceHarness() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [regionId, setRegionId] = useState("named-sahel");
  const [targets, setTargets] = useState<VarId[]>(["precip"]);
  const [month, setMonth] = useState(200);
  const [series, setSeries] = useState<RegionSeries | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [initView, setInitView] = useState<ChartView>("monthly");
  const [initTable, setInitTable] = useState(false);
  const [ready, setReady] = useState(false);
  const theme = useThemeId();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("region")) setRegionId(q.get("region")!);
    const t = (q.get("targets") ?? "").split(",").filter((x): x is VarId => x in VARIABLES && VARIABLES[x as VarId].target);
    if (t.length) setTargets(t.slice(0, MAX_TARGETS));
    if (q.get("month")) setMonth(Number(q.get("month")));
    if (q.get("view")) setInitView(q.get("view") as ChartView);
    if (q.get("table")) setInitTable(true);
    setReady(true);
  }, []);
  useEffect(() => { loadCatalog().then(setCatalog).catch((e) => setError(String(e))); }, []);

  const region: Region | undefined = catalog?.byId.get(regionId);
  useEffect(() => {
    if (!catalog || !region) return;
    setSeries(undefined);
    loadRegionSeries(region, catalog).then(setSeries).catch((e) => setError(String(e)));
  }, [catalog, region]);

  const toggle = (v: VarId) => setTargets((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : cur.length >= MAX_TARGETS ? cur : [...cur, v]));
  const options = useMemo(() => (catalog ? PICKS.filter((id) => catalog.byId.has(id)) : []), [catalog]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-card bg-paper p-4 text-ink shadow-card">
        <label className="min-w-0 max-w-full text-sm">
          <span className="mb-1 block font-semibold">Region</span>
          <select className={sel} value={regionId} onChange={(e) => setRegionId(e.target.value)}>
            {options.map((id) => <option key={id} value={id}>{catalog!.byId.get(id)!.name} ({id})</option>)}
            {!options.includes(regionId) && <option value={regionId}>{regionId}</option>}
          </select>
        </label>
        <fieldset className="text-sm">
          <legend className="mb-1 font-semibold">Targets (max {MAX_TARGETS})</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {TARGET_VARS.map((v) => (
              <label key={v} className="flex items-center gap-1.5">
                <input type="checkbox" checked={targets.includes(v)} disabled={!targets.includes(v) && targets.length >= MAX_TARGETS} onChange={() => toggle(v)} />
                {VARIABLES[v].short}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="min-w-48 flex-1 text-sm">
          <span className="mb-1 block font-semibold">Month {series ? series.months[Math.min(month, series.months.length - 1)] : ""}</span>
          <input type="range" min={0} max={318} value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-full" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Theme</span>
          <select className={sel} value={theme} onChange={(e) => setTheme(e.target.value as (typeof THEMES)[number]["id"])}>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <div className="rounded-card bg-paper p-5 text-ink shadow-card sm:p-7">
        {error && <p role="alert" className="text-ink">Could not load data: {error}</p>}
        {!error && (!catalog || !ready || series === undefined) && <p className="text-ink-2">Loading the regional series.</p>}
        {!error && catalog && region && series === null && <p className="text-ink-2">{region.name} has no GLDAS land-model cells, so there is no series to show.</p>}
        {!error && catalog && region && series && ready && (
          <TrendPanel key={`${region.id}`} region={region} series={series} targets={targets} monthIndex={month} onMonthChange={setMonth} defaultView={initView} defaultShowTable={initTable} />
        )}
      </div>
    </main>
  );
}
