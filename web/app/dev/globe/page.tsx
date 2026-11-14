"use client";
// Harness for the globe work package: drive every prop with real data and watch the callbacks.
import { useEffect, useState } from "react";
import GlobeCanvas from "@/components/globe/GlobeCanvas";
import type { Catalog, LayerId, Region, VarId } from "@/lib/types";
import { LAYERS, LAYER_LABEL, loadCatalog, pickRegions, type PickResult } from "@/lib/data";
import { VARIABLES, VAR_ORDER } from "@/lib/variables";
import { THEMES, setTheme, useThemeId, type ThemeId } from "@/lib/theme";

const SAMPLE_IDS = [
  "named-sahel", "named-taiwan-main-island", "named-california-central-valley", "named-high-mountain-asia",
  "named-greenland", "named-arabian-aquifers-saudi", "b3-6030007000", "b3-1030034260", "b3-7030047060",
  "b3-3030009130", "ice-EAN", "sea-NPO",
];

const fmt = (x: number, d = 2) => x.toFixed(d);

export default function GlobeHarness() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [layer, setLayer] = useState<LayerId | null>("basin3");
  const [overlay, setOverlay] = useState<VarId | null>(null);
  const [selected, setSelected] = useState<Region | null>(null);
  const [interactive, setInteractive] = useState(true);
  const [pick, setPick] = useState<(PickResult & { zoom: number }) | null>(null);
  const [hover, setHover] = useState<string>("—");
  const [zoom, setZoom] = useState(1);
  const [log, setLog] = useState<string[]>([]);
  const theme = useThemeId();
  // ?view=lon,lat,zoom sets the starting camera (read once; it is not rendered into the markup)
  const [initialView] = useState(() => {
    if (typeof window === "undefined") return undefined;
    const v = new URLSearchParams(window.location.search).get("view")?.split(",").map(Number);
    return v && v.length === 3 && v.every(Number.isFinite) ? { lon: v[0], lat: v[1], zoom: v[2] } : undefined;
  });

  useEffect(() => {
    loadCatalog().then(setCatalog, (e) => setLog((l) => [`catalog failed: ${String(e)}`, ...l]));
  }, []);
  // let screenshots drive the harness through the query string: ?select=<id>&overlay=<var>&layer=<id|none>&static=1&view=lon,lat,zoom
  useEffect(() => {
    if (!catalog) return;
    const q = new URLSearchParams(window.location.search);
    const s = q.get("select"), o = q.get("overlay"), l = q.get("layer");
    if (s) setSelected(catalog.byId.get(s) ?? null);
    if (o && o in VARIABLES) setOverlay(o as VarId);
    if (l) setLayer(l === "none" ? null : (l as LayerId));
    if (q.get("static") === "1") setInteractive(false);
  }, [catalog]);

  const push = (s: string) => setLog((l) => [s, ...l].slice(0, 8));

  const ctl = "rounded-ctl border border-line bg-paper px-3 py-1.5 text-sm text-ink";

  return (
    <main className="stage-sky min-h-dvh on-stage">
      <div className="mx-auto grid max-w-[1400px] gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <GlobeCanvas
          className="h-[min(78vh,760px)] min-h-[360px] w-full"
          interactive={interactive}
          initialView={initialView}
          boundaryLayer={layer}
          overlay={overlay}
          selected={selected}
          onPick={async (p) => {
            push(`pick ${fmt(p.lon)}, ${fmt(p.lat)} @ zoom ${p.zoom}`);
            const r = await pickRegions(p.lon, p.lat, p.zoom);
            setPick({ ...r, zoom: p.zoom });
            if (r.primary) setSelected(r.primary);
          }}
          onHover={(h) => setHover(h ? `${fmt(h.lon)}, ${fmt(h.lat)} · ${h.region?.name ?? "no region"}` : "—")}
          onZoomChange={(z) => { setZoom(z); push(`zoom settled at ${z}`); }}
        />

        <aside className="space-y-4 rounded-card bg-paper p-4 text-sm text-ink shadow-card">
          <h1 className="font-display text-lg">Globe harness</h1>
          <label className="block">
            <span className="text-ink-2">Theme</span>
            <select className={`${ctl} mt-1 w-full`} value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)}>
              {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-2">Boundary layer</span>
            <select className={`${ctl} mt-1 w-full`} value={layer ?? ""} onChange={(e) => setLayer((e.target.value || null) as LayerId | null)}>
              <option value="">None</option>
              {LAYERS.map((l) => <option key={l} value={l}>{LAYER_LABEL[l]} ({l})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-2">Trend overlay</span>
            <select className={`${ctl} mt-1 w-full`} value={overlay ?? ""} onChange={(e) => setOverlay((e.target.value || null) as VarId | null)}>
              <option value="">Landscape</option>
              {VAR_ORDER.map((v) => <option key={v} value={v}>{VARIABLES[v].label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-2">Selected region</span>
            <select
              className={`${ctl} mt-1 w-full`}
              value={selected?.id ?? ""}
              onChange={(e) => setSelected(e.target.value ? catalog?.byId.get(e.target.value) ?? null : null)}
            >
              <option value="">None</option>
              {selected && !SAMPLE_IDS.includes(selected.id) && <option value={selected.id}>{selected.name}</option>}
              {SAMPLE_IDS.map((id) => <option key={id} value={id}>{catalog?.byId.get(id)?.name ?? id}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={interactive} onChange={(e) => setInteractive(e.target.checked)} />
            Interactive (off = landing hero)
          </label>

          <dl className="space-y-2 border-t border-line pt-3">
            <div><dt className="text-ink-3">Hover</dt><dd className="tnum">{hover}</dd></div>
            <div><dt className="text-ink-3">Zoom</dt><dd className="tnum">{zoom}</dd></div>
            <div>
              <dt className="text-ink-3">Last pick</dt>
              <dd className="tnum">
                {pick ? (
                  <>
                    {fmt(pick.lon)}, {fmt(pick.lat)} @ {pick.zoom} → {pick.primary?.name ?? "nothing"}
                    {pick.alternatives.length > 0 && (
                      <span className="block text-ink-2">also: {pick.alternatives.map((r) => r.name).join("; ")}</span>
                    )}
                  </>
                ) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Selected</dt>
              <dd>{selected ? `${selected.name} (${LAYER_LABEL[selected.type]}, grid ${selected.gridIndex ?? "none"})` : "—"}</dd>
            </div>
          </dl>
          <ul className="tnum space-y-0.5 border-t border-line pt-3 text-ink-2" aria-label="Event log">
            {log.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </aside>
      </div>
    </main>
  );
}
