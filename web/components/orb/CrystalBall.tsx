"use client";
// Crystal ball: a glass eco-sphere whose rain, vapour, soil, snow and runoff are driven by one month of a region's
// GLDAS series. Scenery is illustrative; every data-driven element has a legend row (OrbLegend).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CrystalBallProps, OrbAnchors } from "@/lib/contracts";
import { cssVar, useThemeId } from "@/lib/theme";
import type { VarId } from "@/lib/types";
import { MAX_TARGETS, VARIABLES } from "@/lib/variables";
import { seasonOf } from "./season";
import { HATCH_CSS, ariaSummary, chooseScenery, parseColor, readValue, sceneHasSoil, type OrbVariant, type Reading } from "./encoding";
import { NetGauge, StorageGauge } from "./Gauges";
import OrbLegend from "./OrbLegend";
import { OrbScene, type AnchorName, type ChannelInput, type FrameInput, type ThemeInput } from "./scene";

export interface CrystalBallExtraProps {
  /** render the HTML legend / read-out (default true). If false, render your own text alternative. */
  showLegend?: boolean;
  /** "auto" (default): legend beside the ball when the component is at least 44rem wide, below it otherwise */
  legendPlacement?: "auto" | "side" | "below";
  /** diorama style: "glass" (default, smooth landscape in a glass ball), "hex-glass" (hex-tile board in the ball) or "hex-island" (floating hex sky island, no glass) */
  variant?: OrbVariant;
}

function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useReducedMotion = () =>
  useSyncExternalStore(subscribeReduced, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);

function readTheme(night: boolean): ThemeInput {
  const c = (name: string) => parseColor(cssVar(name));
  return {
    cool: c("--viz-cool"), mid: c("--viz-mid"), warm: c("--viz-warm"),
    precip: c(VARIABLES.precip.color), runoff: c(VARIABLES.runoff.color),
    soilTop: c(VARIABLES.soil_top.color), rootZone: c(VARIABLES.root_zone.color),
    hatchA: c("--viz-grid"), hatchB: c("--viz-axis"), rim: c("--on-stage-2"), night,
  };
}

const MISSING_TEXT: Partial<Record<VarId, string>> = {
  precip: "No precipitation data",
  et: "No ET data",
  runoff: "No runoff data",
  swe: "No snow data",
};
const MISSING_ANCHOR: Partial<Record<VarId, AnchorName>> = { precip: "cloud", et: "puffs", runoff: "runoff", swe: "peak" };

export default function CrystalBall({
  className = "", region, climate, month, values, targets: rawTargets, colorBy, playing = false,
  showLegend = true, legendPlacement = "auto", variant = "glass", compact = false, onAnchors,
}: CrystalBallProps & CrystalBallExtraProps) {
  const targetKey = rawTargets.join(",");
  const targets = useMemo(
    () => targetKey.split(",").filter((v): v is VarId => v in VARIABLES && VARIABLES[v as VarId].target).slice(0, MAX_TARGETS),
    [targetKey],
  );
  const theme = useThemeId();
  const reduced = useReducedMotion();
  const noSeries = climate == null;
  const cKey = climate ? `${climate.precip}|${climate.et}|${climate.swe}|${climate.tair}` : "none";
  const plan = useMemo(() => chooseScenery(region, climate), [region, cKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const gaugesRef = useRef<HTMLDivElement>(null);
  const sceneAnchors = useRef<OrbAnchors>({});
  const anchorsCb = useRef(onAnchors);
  const lastKey = useRef("");
  const wantAnchors = !!onAnchors && !compact;
  const gaugeKey = targets.filter((t) => t === "tws" || t === "p_minus_et").join(",");
  const sceneRef = useRef<OrbScene | null>(null);
  const anchors = useRef<Partial<Record<AnchorName, HTMLElement | null>>>({});
  const reducedRef = useRef(reduced);
  const [gl, setGl] = useState<"init" | "ok" | "failed" | "lost">("init");
  const [ballR, setBallR] = useState(0);

  // scene anchors are relative to the canvas host; re-express them against the root and add the two DOM gauges
  const emitAnchors = useRef(() => {});
  useEffect(() => {
    anchorsCb.current = onAnchors;
    emitAnchors.current = () => {
      const cb = anchorsCb.current, root = rootRef.current, host = hostRef.current;
      if (!cb || !root || !host) return;
      const rr = root.getBoundingClientRect(), hr = host.getBoundingClientRect();
      const ox = hr.left - rr.left, oy = hr.top - rr.top;
      const out: OrbAnchors = {};
      for (const [id, a] of Object.entries(sceneAnchors.current) as [VarId, NonNullable<OrbAnchors[VarId]>][]) out[id] = { x: a.x + ox, y: a.y + oy, visible: a.visible };
      const figs = Array.from(gaugesRef.current?.children ?? []);
      ["tws", "p_minus_et"].forEach((id) => {
        const i = gaugeKey.split(",").indexOf(id);
        const g = i >= 0 ? figs[i]?.getBoundingClientRect() : undefined;
        if (g) out[id as VarId] = { x: g.left - rr.left, y: g.top - rr.top + g.height * 0.4, visible: true };
      });
      const key = Object.entries(out).map(([k, a]) => `${k}:${Math.round(a.x)},${Math.round(a.y)},${a.visible ? 1 : 0}`).join("|");
      if (key === lastKey.current) return;
      lastKey.current = key;
      cb(out);
    };
  });

  // per-target readings on the shared domains (the legend and the scene use the same numbers)
  const readings = useMemo(() => {
    const out: Partial<Record<VarId, Reading>> = {};
    // no land-model series: every channel is "no data", whatever the caller passed
    for (const id of targets) out[id] = readValue(id, noSeries ? null : values[id]);
    return out;
  }, [targets, values, noSeries]);
  const tempColour = colorBy === "tair" && targets.includes("et");
  const tair = tempColour ? readValue("tair", noSeries ? null : values.tair) : null;

  /* ---------------------------------------------------------------- scene lifecycle */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: OrbScene;
    try {
      scene = new OrbScene(host, { reducedMotion: reducedRef.current, getAnchor: (n) => anchors.current[n] ?? null, variant, compact,
        onAnchors: (a) => { sceneAnchors.current = a; emitAnchors.current(); },
      });
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- WebGL availability is only known after trying
      setGl("failed");
      return;
    }
    sceneRef.current = scene;
    sceneAnchors.current = {};
    scene.onContextLost = () => setGl("lost");
    setGl("ok");
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      scene.setSize(r.width, r.height);
      setBallR(scene.ballRadiusPx());
      emitAnchors.current();
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [variant, compact]);

  // gauges appear / move with the layout
  useEffect(() => {
    if (!wantAnchors) return;
    lastKey.current = "";
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => emitAnchors.current());
    ro.observe(root);
    emitAnchors.current();
    return () => ro.disconnect();
  }, [wantAnchors, gaugeKey, gl]);

  // scenery: only when the region or its climate changes
  const climateKey = `${region.id}|${plan.kind}|${plan.biome}|${plan.landSide}|${plan.islet}`;
  useEffect(() => {
    sceneRef.current?.setScenery(region.id, plan);
  }, [climateKey, gl, variant, compact]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reducedRef.current = reduced;
    sceneRef.current?.setReducedMotion(reduced);
  }, [reduced]);

  useEffect(() => {
    sceneRef.current?.setTheme(readTheme(theme === "night"));
  }, [theme, gl, variant, compact]);

  // data: cheap per-month update (eased inside the scene)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const ch = (id: VarId): ChannelInput => {
      const r = readings[id];
      return r ? { active: true, missing: r.missing, drawn: r.drawn } : { active: false, missing: false, drawn: 0 };
    };
    const frame: FrameInput = {
      precip: ch("precip"), et: ch("et"), runoff: ch("runoff"), soil_top: ch("soil_top"), root_zone: ch("root_zone"), swe: ch("swe"),
      tair: tair ? { active: true, missing: tair.missing, drawn: tair.drawn } : null,
    };
    scene.setFrame(frame);
  }, [readings, tair?.missing, tair?.drawn, gl, variant, compact]); // eslint-disable-line react-hooks/exhaustive-deps

  // illustrative leaf season from the region's average year (same every year); eased inside the scene
  const lat = region.centroid?.[1] ?? 0;
  const leaves = useMemo(
    () => seasonOf({ centroid: [0, lat] }, climate, month).state,
    [lat, month, climate?.tairClim, climate?.precipClim], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    sceneRef.current?.setLeaves(leaves);
  }, [leaves, gl, variant, compact]);

  const showLabels = gl === "ok" && ballR >= 120;
  const hasSoil = sceneHasSoil(plan, variant);
  const soilLabels = !compact && showLabels && hasSoil && targets.some((t) => t === "soil_top" || t === "root_zone" || t === "tws");
  const missingChips = gl === "ok" ? targets.filter((t) => readings[t]?.missing && MISSING_ANCHOR[t]) : [];
  useEffect(() => {
    sceneRef.current?.refresh();
  }, [soilLabels]);

  const gaugeReason = noSeries ? "GLDAS Noah is a land model: no data over open ocean / ice sheets." : undefined;
  const gauges = compact ? [] : targets.filter((t) => t === "tws" || t === "p_minus_et");
  const aria = ariaSummary(region.name, month, targets, noSeries ? {} : values, tempColour, plan);
  const webglNote =
    gl === "failed" ? "3D view unavailable: this browser could not start WebGL. All values for this month are listed below."
      : gl === "lost" ? "The 3D view stopped because the graphics context was lost. Reload the page to restore it; the values below are current."
        : null;

  const outer = legendPlacement === "side" ? "flex-row" : legendPlacement === "below" ? "flex-col" : "flex-col @min-[44rem]:flex-row";
  const ballSize = legendPlacement === "side" ? "min-h-[22rem] h-full" : legendPlacement === "below" ? "aspect-square" : "aspect-square @min-[44rem]:aspect-auto @min-[44rem]:h-full @min-[44rem]:min-h-[22rem]";
  const legendW = legendPlacement === "side" ? "w-[20rem]" : legendPlacement === "below" ? "w-full" : "w-full @min-[44rem]:w-[20rem] @min-[44rem]:max-h-full @min-[44rem]:overflow-y-auto";

  const setAnchor = (n: AnchorName) => (el: HTMLElement | null) => { anchors.current[n] = el; };
  const ctl = "grid h-9 w-9 place-items-center rounded-ctl border border-line bg-paper text-ink shadow-card hover:bg-well";
  const chip = "rounded-ctl border border-line px-2 py-0.5 text-[0.75rem] font-semibold leading-tight text-ink whitespace-nowrap shadow-card";

  if (compact) {
    // small static comparison orb: the same scene and data channels, no controls, no legend
    return (
      <div className={`@container ${className}`}>
        <div
          ref={hostRef}
          role="img"
          aria-label={gl === "failed" ? undefined : aria}
          aria-hidden={gl === "failed" ? true : undefined}
          className="relative aspect-square h-full w-full min-w-0 select-none overflow-hidden"
        >
          {gl === "failed" && (
            <div className="absolute inset-[8%] grid place-items-center rounded-full border border-dashed border-stage-line p-3 text-center text-xs text-on-stage-2">3D view unavailable</div>
          )}
          {/* small orb: one chip only, so several missing channels don't pile up on top of each other */}
          {missingChips.slice(0, 1).map((t) => (
            <div key={t} ref={setAnchor(MISSING_ANCHOR[t]!)} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 z-10">
              <div className={`-translate-x-1/2 -translate-y-1/2 ${chip}`} style={{ background: HATCH_CSS }}>
                <span className="rounded-[4px] bg-paper px-1">{missingChips.length > 1 ? "No data" : MISSING_TEXT[t]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`@container ${className}`}>
      <div className={`flex h-full w-full gap-4 ${outer}`}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center gap-3 @min-[28rem]:flex-row @min-[28rem]:items-stretch">
          <div
            ref={hostRef}
            role={gl === "ok" ? "application" : "img"}
            aria-roledescription={gl === "ok" ? "3D diorama" : undefined}
            aria-label={gl === "failed" ? undefined : `${aria} Arrow keys turn and tilt, plus and minus zoom, 0 resets.`}
            aria-hidden={gl === "failed" ? true : undefined}
            tabIndex={gl === "ok" ? 0 : undefined}
            onKeyDown={(e) => { if (e.target === e.currentTarget && sceneRef.current?.handleKey(e.nativeEvent)) e.preventDefault(); }}
            className={`relative w-full min-w-0 flex-1 select-none overflow-hidden focus-visible:outline-offset-[-3px] ${ballSize} ${gl === "ok" ? "cursor-grab" : ""}`}
          >
            {gl === "ok" && !compact && (
              <div className="absolute bottom-1 right-1 z-20 flex flex-col gap-1.5">
                <button type="button" className={ctl} aria-label="Zoom in" onClick={() => sceneRef.current?.zoomBy(1.4)}>
                  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                </button>
                <button type="button" className={ctl} aria-label="Zoom out" onClick={() => sceneRef.current?.zoomBy(1 / 1.4)}>
                  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                </button>
                <button type="button" className={ctl} aria-label="Reset view" onClick={() => sceneRef.current?.resetView()}>
                  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="9" r="6" /><path d="M9 1.5v3M9 13.5v3M1.5 9h3M13.5 9h3" /></svg>
                </button>
              </div>
            )}
            {gl === "failed" && (
              <div className="absolute inset-[8%] grid place-items-center rounded-full border border-dashed border-stage-line p-6 text-center text-sm text-on-stage-2">
                3D view unavailable in this browser
              </div>
            )}
            {missingChips.map((t) => (
              <div key={t} ref={setAnchor(MISSING_ANCHOR[t]!)} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 z-10">
                <div className={`-translate-x-1/2 -translate-y-1/2 ${chip}`} style={{ background: HATCH_CSS }}>
                  <span className="rounded-[4px] bg-paper px-1">{MISSING_TEXT[t]}</span>
                </div>
              </div>
            ))}
            {soilLabels && (
              <>
                {targets.includes("soil_top") && (
                  <div ref={setAnchor("soilTop")} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 z-10">
                    <div className={`-translate-y-1/2 translate-x-3 bg-paper ${chip}`}>0–10 cm</div>
                  </div>
                )}
                {targets.includes("root_zone") && (
                  <div ref={setAnchor("rootZone")} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 z-10">
                    <div className={`-translate-y-1/2 translate-x-4 bg-paper ${chip}`}>Root zone</div>
                  </div>
                )}
                <div ref={setAnchor("deep")} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 z-10">
                  <div className={`-translate-y-1/2 translate-x-8 bg-paper font-normal! text-ink-2! ${chip}`}>Deeper: not in this dataset</div>
                </div>
              </>
            )}
          </div>
          {gauges.length > 0 && (
            <div ref={gaugesRef} className="flex shrink-0 flex-row justify-center gap-3 @min-[28rem]:flex-col">
              {gauges.map((g) => (g === "tws" ? <StorageGauge key={g} r={readings.tws!} reason={gaugeReason} /> : <NetGauge key={g} r={readings.p_minus_et!} reason={gaugeReason} />))}
            </div>
          )}
        </div>
        {showLegend && !compact && (
          <OrbLegend
            className={`shrink-0 ${legendW}`}
            region={region}
            month={month}
            targets={targets}
            readings={readings}
            tair={tair}
            scenery={plan}
            noSeries={noSeries}
            playing={playing}
            webglNote={webglNote}
            variant={variant}
          />
        )}
      </div>
    </div>
  );
}
