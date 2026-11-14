"use client";
import { useEffect, useState } from "react";
import type { Catalog, RegionType } from "@/lib/types";
import { LAYER_LABEL, loadCatalog } from "@/lib/data";

const ROWS: { type: RegionType; what: string; use: string }[] = [
  { type: "basin3", what: "River basins at Pfafstetter level 3.", use: "Default boundary on the globe when zoomed out." },
  { type: "basin4", what: "River basins at Pfafstetter level 4. Each one sits inside a level-3 basin.", use: "Drawn once you zoom in; links back to its parent basin." },
  { type: "hex", what: "Hexagons of the global H3 grid at resolution 2, over land, sea and ice.", use: "Even-sized sampling cells, useful where basins are a poor fit, such as deserts." },
  { type: "named", what: "Study windows with names. 41 are rectangles; the Taiwan main island one follows the coastline.", use: "Search entry points and featured examples." },
  { type: "lme", what: "Large marine ecosystems along the coasts.", use: "Ocean picks; only coastal land slivers have land-model data." },
  { type: "sea", what: "Ocean basins and seas.", use: "Ocean picks where no marine ecosystem applies." },
  { type: "ice", what: "The East and West Antarctic ice sheets.", use: "Picks over Antarctica, which GLDAS Noah does not cover." },
];

export function LayerTable() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    loadCatalog().then(setCat, (e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  const counts = new Map<RegionType, { n: number; withData: number }>();
  for (const r of cat?.regions ?? []) {
    const c = counts.get(r.type) ?? { n: 0, withData: 0 };
    c.n++;
    if (r.cells) c.withData++;
    counts.set(r.type, c);
  }
  const fmt = (x: number | undefined) => (x == null ? "…" : x.toLocaleString("en-US"));

  return (
    <>
      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full min-w-[44rem] border-collapse text-left text-[0.9375rem]">
          <caption className="sr-only">Region layers in the catalogue, with counts computed from the loaded catalogue</caption>
          <thead className="bg-well text-ink-2">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Layer</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Regions</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">With GLDAS data</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">What it is</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">How the site uses it</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ROWS.map((row) => (
              <tr key={row.type} className="align-top">
                <th scope="row" className="px-4 py-3 font-medium text-ink">{LAYER_LABEL[row.type]}</th>
                <td className="px-4 py-3 text-right tnum">{fmt(counts.get(row.type)?.n)}</td>
                <td className="px-4 py-3 text-right tnum">{fmt(counts.get(row.type)?.withData)}</td>
                <td className="px-4 py-3 text-ink-2">{row.what}</td>
                <td className="px-4 py-3 text-ink-2">{row.use}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-well">
              <th scope="row" className="px-4 py-2.5 font-semibold">All layers</th>
              <td className="px-4 py-2.5 text-right font-semibold tnum">{fmt(cat?.regions.length)}</td>
              <td className="px-4 py-2.5 text-right font-semibold tnum">{fmt(cat ? cat.regions.filter((r) => r.cells).length : undefined)}</td>
              <td colSpan={2} className="px-4 py-2.5 text-ink-2">Overlapping scopes, not a partition of the planet.</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {err && <p className="mt-2 text-sm text-ink-2" role="status">Counts could not be computed: {err}. Reload the page to try again.</p>}
    </>
  );
}
