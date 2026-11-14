"use client";
// Harness for the leads package: real catalogue + real series, synthetic leads, on a paper surface.
//   /dev/leads?region=named-sahel&targets=et,precip&scenario=complete&lead=lag&record=1&skip=1
// lead = an index, a relation (temporal-anomaly | lagged | spatial-trend) or a lead id; opens that lead.
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadCatalog, loadRegionSeries } from "@/lib/data";
import type { Catalog, Lead, Region, RegionSeries, VarId } from "@/lib/types";
import { MAX_TARGETS, TARGET_VARS, VARIABLES } from "@/lib/variables";
import { buildSyntheticRun, type Scenario } from "@/lib/synthetic";
import { THEMES, setTheme, useThemeId } from "@/lib/theme";
import LeadsPanel from "@/components/leads/LeadsPanel";

const PICKS = [
  "named-california-central-valley", "named-sahel", "named-high-mountain-asia", "named-indo-gangetic-plain",
  "named-amazon-deforestation-arc", "named-arabian-aquifers-saudi", "named-aral-sea", "named-taiwan-main-island",
  "named-greenland", "b3-6030007000", "b3-1030034260", "b3-7030047060", "b3-3030009130", "ice-EAN", "sea-NPO",
];
const sel = "max-w-full rounded-ctl border border-line bg-paper px-3 py-1.5 text-sm text-ink";

export default function LeadsHarness() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [regionId, setRegionId] = useState("named-sahel");
  const [targets, setTargets] = useState<VarId[]>(["et", "precip"]);
  const [series, setSeries] = useState<RegionSeries | null | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [init, setInit] = useState<{ scenario?: Scenario; skip: boolean; record: boolean; lead: string | null } | null>(null);
  const theme = useThemeId();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("region")) setRegionId(q.get("region")!);
    const t = (q.get("targets") ?? "").split(",").filter((x): x is VarId => x in VARIABLES && VARIABLES[x as VarId].target);
    if (t.length) setTargets(t.slice(0, MAX_TARGETS));
    setInit({ scenario: (q.get("scenario") as Scenario) || undefined, skip: q.get("skip") === "1", record: q.get("record") === "1", lead: q.get("lead") });
  }, []);
  useEffect(() => { loadCatalog().then(setCatalog).catch((e) => setError(String(e))); }, []);

  const region: Region | undefined = catalog?.byId.get(regionId);
  useEffect(() => {
    if (!catalog || !region) return;
    setSeries(undefined);
    loadRegionSeries(region, catalog).then(setSeries).catch((e) => setError(String(e)));
  }, [catalog, region]);

  // ?lead= opens one lead on load (for screenshots)
  useEffect(() => {
    if (!init?.lead || !region || series === undefined) return;
    const run = buildSyntheticRun(region, series, targets, init.scenario);
    const k = init.lead;
    const hit = /^\d+$/.test(k) ? run.leads[Number(k)] : run.leads.find((l) => l.id === k || l.relation === k || l.route === k);
    if (hit) setSelected(hit.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [init, region, series]);

  const toggle = (v: VarId) => setTargets((cur) => (cur.includes(v) ? (cur.length > 1 ? cur.filter((x) => x !== v) : cur) : cur.length >= MAX_TARGETS ? cur : [...cur, v]));
  const options = useMemo(() => (catalog ? PICKS.filter((id) => catalog.byId.has(id)) : []), [catalog]);
  const onSelect = useCallback((l: Lead | null) => setSelected(l ? l.id : null), []);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <p className="mb-4">Developer preview. This page combines real regional series with synthetic example leads.</p>
      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-card bg-paper p-4 text-ink shadow-card">
        <label className="min-w-0 max-w-full text-sm">
          <span className="mb-1 block font-semibold">Region</span>
          <select className={sel} value={regionId} onChange={(e) => { setRegionId(e.target.value); setSelected(null); }}>
            {options.map((id) => <option key={id} value={id}>{catalog!.byId.get(id)!.name} ({id})</option>)}
          </select>
        </label>
        <fieldset className="m-0 min-w-0 border-0 p-0 text-sm">
          <legend className="mb-1 p-0 font-semibold">Targets (max {MAX_TARGETS})</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {TARGET_VARS.map((v) => (
              <label key={v} className="flex items-center gap-1.5">
                <input type="checkbox" checked={targets.includes(v)} onChange={() => { toggle(v); setSelected(null); }} />
                {VARIABLES[v].short}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Theme</span>
          <select className={sel} value={theme} onChange={(e) => setTheme(e.target.value as typeof THEMES[number]["id"])}>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <p className="m-0 w-full text-sm text-ink-2">Selected lead id (controlled by the harness): <code data-testid="selected">{selected ?? "none"}</code></p>
      </div>
      <div className="rounded-card bg-paper p-4 text-ink shadow-card @container sm:p-6">
        {error && <p role="alert" className="text-ink">{error}</p>}
        {region && series !== undefined && init ? (
          <LeadsPanel
            region={region} series={series} targets={targets} selectedLeadId={selected} onSelectLead={onSelect}
            initialScenario={init.scenario} skipRun={init.skip} initialRecordOpen={init.record}
          />
        ) : !error && <p className="text-ink-2">Loading the catalogue and the region series.</p>}
      </div>
    </main>
  );
}
