"use client";
import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import type { GlobePoint } from "@/lib/contracts";
import type { Catalog, Region } from "@/lib/types";
import { loadGrid, rasterIndex } from "@/lib/data";
import { COPY } from "@/components/detective/copy/input";
const GlobeCanvas = dynamic(() => import("./GlobeCanvas"), { ssr: false });
const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
const fmtLon = (lon: number) => `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
/** The planet with sub-basin outlines only. A click selects the sub-basin under the pointer; the selection glows. */
export function SubBasinGlobe({ catalog, region, onRegion, interactive }: { catalog: Catalog | null; region: Region | null; onRegion: (r: Region) => void; interactive: boolean }) {
  const [hover, setHover] = useState<Region | null>(null);
  const [status, setStatus] = useState("");
  const seq = useRef(0);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const onRegionRef = useRef(onRegion);
  onRegionRef.current = onRegion;

  const onPick = useCallback(async ({ lon, lat }: GlobePoint & { zoom: number }) => {
    const n = ++seq.current;
    const cat = catalogRef.current;
    if (!cat) { setStatus(COPY.where.pickLoading); return; }
    setStatus(COPY.where.lookup(fmtLat(lat), fmtLon(lon)));
    try {
      const grid = await loadGrid("basin4");
      if (n !== seq.current) return;
      const g = grid[rasterIndex(lon, lat)];
      const r = g ? cat.byGrid.basin4[g] : undefined;
      if (!r) { setStatus(COPY.where.noBasinAt(fmtLat(lat), fmtLon(lon))); return; }
      setStatus("");
      onRegionRef.current(r);
    } catch (e) {
      if (n === seq.current) setStatus(COPY.where.lookupFailed(e instanceof Error ? e.message : String(e)));
    }
  }, []);
  const onHover = useCallback((hit: (GlobePoint & { region: Region | null }) | null) => {
    const r = hit?.region ?? null;
    setHover((prev) => (prev?.id === r?.id ? prev : r));
  }, []);

  return (
    <div className="on-stage flex min-w-0 flex-col gap-3">
      <div className="mx-auto aspect-square w-full max-w-[min(100%,calc(100dvh-10rem))] min-w-0">
        <GlobeCanvas
          className="h-full w-full"
          interactive={interactive}
          boundaryLayer="basin4"
          selected={region}
          onPick={onPick}
          onHover={onHover}
          ariaLabel={COPY.where.globeAria}
        />
      </div>
      <p className="sr-only" aria-live="polite">{status}</p>
      <p className={`min-h-[1.5rem] text-center text-sm text-on-stage-2 ${interactive ? "" : "invisible"}`}>
        {status ||
          (hover ? (
            <>
              <span className="font-semibold text-on-stage">{hover.name}</span> · {COPY.where.hoverSelect}
            </>
          ) : (
            COPY.where.hint
          ))}
      </p>
    </div>
  );
}
