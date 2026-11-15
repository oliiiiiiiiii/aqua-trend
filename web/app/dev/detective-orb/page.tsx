"use client";
// Harness for VariableOrb on real data.
//   /dev/detective-orb?r=b4-4040046370&c=precip&m=2021-04&t=2021-02..2021-05&pad=12&l=<layer>
import { useEffect, useMemo, useState } from "react";
import VariableOrb from "@/components/detective/VariableOrb";
import { CATEGORIES } from "@/lib/detective/categories";
import { decompose } from "@/lib/detective/analysis";
import { loadVariableCatalog, loadSeries, categoryAvailability, regionLayers } from "@/lib/detective/series";
import { isCategory, isRegionId } from "@/lib/detective/url";
import { loadCatalog } from "@/lib/data";
import type { CategoryId, Decomposition, LayerId, TimeRange } from "@/lib/detective/contracts";
import type { Catalog } from "@/lib/types";
import { THEMES, setTheme, useThemeId } from "@/lib/theme";

const HIGH_WARM = new Set<CategoryId>(["tair", "vpd", "energy", "wind", "sst", "aod", "fire", "so2", "ozone"]);

export default function DetectiveOrbHarness() {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [data, setData] = useState<{ d: Decomposition; unit: string; layer: LayerId } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mi, setMi] = useState(0);
  const theme = useThemeId();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the query string once on mount
    setQ(new URLSearchParams(window.location.search));
    loadCatalog().then(setCatalog, (e) => setError(String(e)));
  }, []);

  const rid = q?.get("r") && isRegionId(q.get("r")!) ? q.get("r")! : "b4-4040046370";
  const cat: CategoryId = q?.get("c") && isCategory(q.get("c")!) ? (q.get("c") as CategoryId) : "precip";
  const [ts, te] = (q?.get("t") ?? "2021-02..2021-05").split("..");
  const event: TimeRange = { start: ts, end: te ?? ts };
  const pad = Number(q?.get("pad") ?? 12);
  const wantLayer = q?.get("l") ?? undefined;
  const month = q?.get("m");

  useEffect(() => {
    if (!q) return;
    let live = true;
    (async () => {
      const [vc, avail] = await Promise.all([loadVariableCatalog(), regionLayers(rid)]);
      const layer = categoryAvailability(vc, avail, wantLayer ? { [cat]: wantLayer } : {}).layer[cat];
      if (!layer) throw new Error(`${rid} has no ${cat} series`);
      const s = await loadSeries(rid, layer);
      const d = decompose(s, event, pad);
      if (!live) return;
      setData({ d, unit: s.unit, layer });
      const i = month ? d.months.indexOf(month) : -1;
      setMi(i >= 0 ? i : d.months.indexOf(event.start));
    })().catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [q, rid, cat, ts, te, pad, wantLayer]); // eslint-disable-line react-hooks/exhaustive-deps

  const region = catalog?.byId.get(rid) ?? null;
  const d = data?.d;
  const label = useMemo(() => (d ? d.months[mi] : ""), [d, mi]);

  return (
    <div className="min-h-dvh px-4 py-6 text-ink sm:px-8">
      <h1 className="text-xl">Detective crystal ball harness</h1>
      <p className="mt-1 text-sm text-ink-2">{rid} · {cat} · {data?.layer ?? "…"} · {CATEGORIES[cat].name.en}</p>
      {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
      {d && (
        <label className="mt-3 flex max-w-xs items-center gap-2 text-sm">
          Month
          <input type="range" min={0} max={d.months.length - 1} value={mi} onChange={(e) => setMi(+e.target.value)} className="min-w-0 flex-1" aria-valuetext={label} />
          <span className="tnum w-16">{label}</span>
        </label>
      )}
      <div className="mt-2 flex gap-2 text-sm">
        {THEMES.map(({ id }) => (
          <button key={id} type="button" onClick={() => setTheme(id)} aria-pressed={theme === id} className="rounded-ctl border border-line px-3 py-1 aria-pressed:bg-well">{id}</button>
        ))}
      </div>
      <div className="mt-5 w-full max-w-[20rem]">
        {d && data ? (
          <VariableOrb
            region={region}
            catalog={catalog}
            category={cat}
            layer={data.layer}
            name={CATEGORIES[cat].name.en}
            unit={data.unit}
            d={d}
            monthIndex={mi}
            highReads={HIGH_WARM.has(cat) ? "warm" : "cool"}
          />
        ) : (
          !error && <p className="text-sm text-ink-2">Loading…</p>
        )}
      </div>
    </div>
  );
}
