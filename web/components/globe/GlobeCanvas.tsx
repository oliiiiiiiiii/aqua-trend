"use client";
// Toy-planet region picker (plain three.js). Contract: GlobeCanvasProps in lib/contracts.ts.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GlobeCanvasProps } from "@/lib/contracts";
import { useReducedMotion } from "@/components/explore/hooks";
import { cssVar, useThemeId } from "@/lib/theme";
import { GlobeEngine, type EngineCallbacks, type ThemeColors, type TrendInfo, type View } from "./engine";
import { PLANET, parseCssColor } from "./palette";
import TrendLegend from "./TrendLegend";

export interface GlobeCanvasExtraProps {
  /** where the camera starts and where "Reset view" returns; default { lon: 15, lat: 18, zoom: 1 } */
  initialView?: View;
  /** override the accessible name of the interactive globe */
  ariaLabel?: string;
  /** show the on-canvas zoom buttons (default true when interactive) */
  showControls?: boolean;
  motionPaused?: boolean;
}

const DEFAULT_VIEW: View = { lon: 15, lat: 18, zoom: 1 };
const DEFAULT_LABEL =
  "Globe region picker. Drag or use the arrow keys to turn the planet, scroll or press plus and minus to zoom, click or press Enter to pick the place at the centre.";

function readTheme(): ThemeColors {
  return {
    select: parseCssColor(cssVar("--action"), [1, 0.81, 0.25]),
    hover: PLANET.haloLight,
    diverging: {
      cool: parseCssColor(cssVar("--viz-cool"), [0.16, 0.47, 0.84]),
      warm: parseCssColor(cssVar("--viz-warm"), [0.89, 0.29, 0.28]),
      mid: parseCssColor(cssVar("--viz-map-mid"), [0.93, 0.94, 0.95]),
    },
  };
}

const reducedQuery = "(prefers-reduced-motion: reduce)";

export default function GlobeCanvas({
  className = "",
  interactive = true,
  boundaryLayer = null,
  selected = null,
  overlay = null,
  onPick,
  onHover,
  onZoomChange,
  initialView = DEFAULT_VIEW,
  ariaLabel = DEFAULT_LABEL,
  showControls = true,
  motionPaused = false,
}: GlobeCanvasProps & GlobeCanvasExtraProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GlobeEngine | null>(null);
  const cbRef = useRef<EngineCallbacks>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [trend, setTrend] = useState<TrendInfo | null>(null);
  const [cursor, setCursor] = useState("");
  const themeId = useThemeId();
  const reducedMotion = useReducedMotion();
  const initialRef = useRef({ interactive, initialView, motionPaused });

  useLayoutEffect(() => {
    cbRef.current = { onPick, onHover, onZoomChange };
  });

  // create once per mount
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: GlobeEngine;
    try {
      engine = new GlobeEngine(host, {
        interactive: initialRef.current.interactive,
        reducedMotion: initialRef.current.motionPaused || window.matchMedia(reducedQuery).matches,
        initialView: initialRef.current.initialView,
        theme: readTheme(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      return;
    }
    engineRef.current = engine;
    engine.setCallbacks({
      onPick: (p) => cbRef.current.onPick?.(p),
      onHover: (h) => cbRef.current.onHover?.(h),
      onZoomChange: (z) => cbRef.current.onZoomChange?.(z),
    });
    engine.onTrend = setTrend;
    engine.onCursor = setCursor;
    let alive = true;
    engine.load().then(
      () => { if (alive) setStatus("ready"); },
      (e) => {
        if (!alive) return;
        setError(`The planet data could not be loaded (${e instanceof Error ? e.message : String(e)}).`);
        setStatus("error");
      },
    );
    return () => {
      alive = false;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => { engineRef.current?.setReducedMotion(reducedMotion || motionPaused); }, [reducedMotion, motionPaused]);
  useEffect(() => { engineRef.current?.setInteractive(interactive); }, [interactive]);
  useEffect(() => { void engineRef.current?.setBoundaryLayer(boundaryLayer ?? null).catch(() => {}); }, [boundaryLayer]);
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    if (!overlay) setTrend(null);
    void e.setOverlay(overlay ?? null).catch(() => {});
  }, [overlay]);
  const selectedKey = selected?.id ?? null;
  const selectedRef = useRef(selected);
  useLayoutEffect(() => { selectedRef.current = selected; });
  useEffect(() => {
    void engineRef.current?.setSelected(selectedRef.current ?? null).catch(() => {});
  }, [selectedKey]);
  useEffect(() => { engineRef.current?.setTheme(readTheme()); }, [themeId]);

  const live = interactive && status !== "error";
  const btn =
    "grid h-10 w-10 place-items-center rounded-ctl border border-line bg-paper text-ink shadow-card hover:bg-well";

  return (
    <div className={`relative overflow-hidden ${className}`} aria-hidden={interactive ? undefined : true}>
      <div
        ref={hostRef}
        className="group absolute inset-0 rounded-card focus-visible:outline-offset-[-3px]"
        role={live ? "application" : undefined}
        aria-roledescription={live ? "globe" : undefined}
        aria-label={live ? ariaLabel : undefined}
        tabIndex={live ? 0 : -1}
        style={{ cursor: live ? cursor || "grab" : "default" }}
        onKeyDown={(e) => {
          if (engineRef.current?.handleKey(e.nativeEvent)) e.preventDefault();
        }}
      >
        {live && status === "ready" && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 hidden h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-on-stage shadow-card group-focus-visible:block"
          />
        )}
      </div>

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="grid aspect-square w-[min(60%,60vh)] place-items-center rounded-full border border-stage-line bg-on-stage/5">
            <p className="text-sm text-on-stage-2">Loading the planet…</p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center p-4" role="alert">
          <div className="max-w-sm rounded-card border border-line bg-paper p-4 text-sm text-ink shadow-card">
            <p className="font-display text-base">The 3D globe could not start</p>
            <p className="mt-1 text-ink-2">{error}</p>
            <p className="mt-2 text-ink-2">You can still choose a region from the region list.</p>
          </div>
        </div>
      )}

      {live && showControls && status === "ready" && (
        <div className="absolute bottom-3 right-3 flex flex-col gap-2">
          <button type="button" className={btn} aria-label="Zoom in" onClick={() => engineRef.current?.zoomBy(1.5)}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <button type="button" className={btn} aria-label="Zoom out" onClick={() => engineRef.current?.zoomBy(1 / 1.5)}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <button type="button" className={btn} aria-label="Reset view" onClick={() => engineRef.current?.resetView()}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="9" cy="9" r="6" />
              <path d="M9 1.5v3M9 13.5v3M1.5 9h3M13.5 9h3" />
            </svg>
          </button>
        </div>
      )}

      {overlay && trend && trend.variable === overlay && status === "ready" && (
        <TrendLegend className="absolute bottom-3 left-3" variable={overlay} limitPerYear={trend.scale.limit} />
      )}
    </div>
  );
}
