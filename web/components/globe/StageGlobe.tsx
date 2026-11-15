"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GlobePoint } from "@/lib/contracts";
import type { Catalog, Region } from "@/lib/types";
import { loadGrid, rasterIndex } from "@/lib/data";
import { COPY } from "@/components/detective/copy/input";
const GlobeCanvas = dynamic(() => import("./GlobeCanvas"), { ssr: false });
const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
const fmtLon = (lon: number) => `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
/**
 * "pick": the detective's input stage; drag, zoom, a click selects the sub-basin under the pointer, the selection glows.
 * "home": the planet only turns (drag, no zoom, no picking) and keeps drifting while idle; coming back to it from "pick"
 * eases the camera back to its normal home view. "off": decorative.
 */
export type GlobeMode = "home" | "pick" | "off";
const HOME_LABEL = "Globe. Drag or use the arrow keys to turn the planet.";

/** The planet with sub-basin outlines only. */
export function SubBasinGlobe({ catalog, region, onRegion, mode }: { catalog: Catalog | null; region: Region | null; onRegion: (r: Region) => void; mode: GlobeMode }) {
  const interactive = mode !== "off";
  const [resetToken, setResetToken] = useState(0);
  const prevMode = useRef(mode);
  useEffect(() => {
    // the shared canvas outlives the route: leaving a zoomed-in input stage for home must not leave the planet zoomed
    if (prevMode.current !== "home" && mode === "home") setResetToken((t) => t + 1);
    prevMode.current = mode;
  }, [mode]);
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
      <div className="aspect-square w-full min-w-0">
        <GlobeCanvas
          className="h-full w-full"
          renderPadding={0.06}
          interactive={interactive}
          zoomEnabled={mode !== "home"}
          pickEnabled={mode === "pick"}
          autoRotate={mode === "home"}
          resetToken={resetToken}
          boundaryLayer="basin4"
          selected={region}
          onPick={onPick}
          onHover={onHover}
          ariaLabel={mode === "home" ? HOME_LABEL : COPY.where.globeAria}
        />
      </div>
      <p className="sr-only" aria-live="polite">{status}</p>
      <p className={`mt-[6%] min-h-[1.5rem] text-center text-sm text-on-stage-2 ${mode === "pick" ? "" : "hidden"}`}>
        {status ||
          (hover ? (
            <>
              <span className="font-semibold text-on-stage">{hover.name}</span> · {COPY.where.hoverSelect}
            </>
          ) : null)}
      </p>
    </div>
  );
}
