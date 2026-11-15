"use client";
// Step 0 of the Trend Detective: the event (E), its period (T) and the sub-basin (L). Workstream C.
// Presentational: DetectiveApp owns the state (in the URL) and passes values and callbacks in.
import dynamic from "next/dynamic";
import { useCallback, useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { GlobePoint } from "@/lib/contracts";
import type { Catalog, Region } from "@/lib/types";
import type { PresetEvent, TimeRange } from "@/lib/detective/contracts";
import { loadGrid, rasterIndex } from "@/lib/data";
import { RegionSearch } from "@/components/explore/RegionSearch";
import { formatArea } from "@/components/explore/regionUtils";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { addMonths, formatRange, ym, ymFromIndex, ymIndex } from "@/lib/detective/url";

const GlobeCanvas = dynamic(() => import("@/components/globe/GlobeCanvas"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-on-stage-2" role="status">
      Loading the globe…
    </div>
  ),
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
const fmtLon = (lon: number) => `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;

export interface InputPanelProps {
  /* E */
  event: string;
  onEventChange: (text: string) => void;
  presets: readonly PresetEvent[];
  onPreset: (p: PresetEvent) => void;
  /* T */
  time: TimeRange | null;
  /**
   * A change made with the time picker (always wins over the suggestion from the text). An updater gets the period
   * as it is in the URL at that moment, so two quick edits (start, then end) do not overwrite each other.
   */
  onTimeChange: (next: TimeRange | ((current: TimeRange | null) => TimeRange)) => void;
  /** period read from the event text, offered when it differs from `time` */
  timeSuggestion: TimeRange | null;
  /** first and last month the timeline offers */
  bounds: TimeRange;
  padMonths: number;
  /* L */
  catalog: Catalog | null;
  catalogError: string | null;
  /** sub-basins that have a monthly series (the search list); null while loading */
  searchable: Region[] | null;
  /** Chinese country names by ISO code, for reading a place from Chinese event text */
  countryNames: ReadonlyMap<string, string> | null;
  region: Region | null;
  /** notes under the selected region (no data here, a link with an unknown id, …) */
  regionNote: ReactNode;
  onRegion: (r: Region) => void;
  /* Step 1 */
  onFind: () => void;
  finding: boolean;
  /** the Step 1 card, shown under the form */
  children?: ReactNode;
}

export function InputPanel(p: InputPanelProps) {
  return (
    <div className="mx-auto grid max-w-[90rem] items-start gap-5 px-4 pt-4 pb-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] lg:gap-8 lg:px-8 lg:pt-8">
      <div className="order-1 lg:col-start-2 lg:row-start-1">
        <h1 className="text-[2rem] leading-tight sm:text-[2.5rem]">Trend Detective</h1>
        <p className="mt-2 text-on-stage-2">
          Name an Earth event, when and where it happened. We pick NASA variables, remove the seasonal cycle and the
          long-term trend, and show whether the event stands out in the data.
        </p>
      </div>
      {/* phones: title, form, globe, variables; wide screens: the globe stays beside the right-hand column */}
      <div className="order-3 lg:sticky lg:top-4 lg:col-start-1 lg:row-span-3 lg:row-start-1">
        <SubBasinGlobe catalog={p.catalog} region={p.region} onRegion={p.onRegion} />
      </div>
      <div className="order-2 lg:col-start-2 lg:row-start-2">
        <form
          className="space-y-6 rounded-card bg-paper p-5 text-ink shadow-card sm:p-6"
          onSubmit={(e) => { e.preventDefault(); if (p.event.trim() && !p.finding) p.onFind(); }}
          aria-label="Event, period and sub-basin"
        >
          <EventField {...p} />
          <TimeField {...p} />
          <RegionField {...p} />
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <button
              type="submit"
              disabled={!p.event.trim() || p.finding}
              className="rounded-ctl bg-action px-5 py-2 font-semibold text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {p.finding ? "Finding variables…" : "Find variables"}
            </button>
            <span className="text-sm text-ink-3">{p.event.trim() ? "Step 1: suggest which variables to check." : "Describe the event first."}</span>
          </div>
        </form>
      </div>
      {p.children && <div className="order-4 lg:col-start-2 lg:row-start-3">{p.children}</div>}
    </div>
  );
}

function Step({ n }: { n: string }) {
  return (
    <span className="mr-2 inline-grid h-6 min-w-6 place-items-center rounded-full bg-well px-1.5 font-display text-sm text-ink tnum" aria-hidden="true">
      {n}
    </span>
  );
}

/* ------------------------------------------------------------------ E */

function EventField({ event, onEventChange, presets, onPreset }: InputPanelProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={`${id}-e`} className="flex items-center font-semibold">
        <Step n="E" />What happened?
      </label>
      <input
        id={`${id}-e`}
        type="text"
        value={event}
        onChange={(e) => onEventChange(e.target.value)}
        maxLength={300}
        autoComplete="off"
        placeholder="e.g. 2021 Taiwan drought, 2022 年 7 月巴基斯坦洪水"
        className="mt-2 w-full rounded-ctl border border-line bg-paper px-4 py-2.5 text-ink placeholder:text-ink-3"
      />
      {presets.length > 0 && (
        <div className="mt-3">
          <p className="text-sm text-ink-3" id={`${id}-p`}>Or open a ready-made case:</p>
          <ul className="mt-1.5 flex flex-wrap gap-2" aria-labelledby={`${id}-p`}>
            {presets.map((pr) => (
              <li key={pr.id}>
                <button
                  type="button"
                  onClick={() => onPreset(pr)}
                  title={pr.blurb}
                  className="rounded-ctl border border-line bg-well px-3 py-1 text-sm font-semibold text-link hover:border-link"
                >
                  {pr.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ T */

function TimeField({ time, onTimeChange, timeSuggestion, bounds, padMonths }: InputPanelProps) {
  const id = useId();
  const y0 = Number(bounds.start.slice(0, 4)), y1 = Number(bounds.end.slice(0, 4));
  const years = useMemo(() => Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i), [y0, y1]);
  const clamp = useCallback(
    (m: string) => ymFromIndex(Math.max(ymIndex(bounds.start), Math.min(ymIndex(bounds.end), ymIndex(m)))),
    [bounds],
  );
  /** set one end; the other end follows when the range would turn around */
  const set = (which: "start" | "end", year: number, month: number) => {
    const v = clamp(ym(year, month));
    onTimeChange((cur) => {
      const next = { ...(cur ?? { start: v, end: v }), [which]: v };
      return ymIndex(next.start) <= ymIndex(next.end) ? next : { start: v, end: v };
    });
  };
  // offer the text's period only when the chosen one is not already inside it (Jul–Sep 2022 is inside "2022")
  const inside = !!time && !!timeSuggestion && ymIndex(time.start) >= ymIndex(timeSuggestion.start) && ymIndex(time.end) <= ymIndex(timeSuggestion.end);
  const offer = timeSuggestion && !inside ? timeSuggestion : null;

  const part = (which: "start" | "end", label: string) => {
    const v = time?.[which];
    const year = v ? Number(v.slice(0, 4)) : NaN;
    const month = v ? Number(v.slice(5, 7)) : NaN;
    const fallbackYear = Number.isFinite(year) ? year : y1;
    const fallbackMonth = Number.isFinite(month) ? month : which === "start" ? 1 : 12;
    return (
      <fieldset className="flex min-w-0 items-center gap-1.5">
        <legend className="sr-only">{label}</legend>
        <span className="w-10 text-sm text-ink-2" aria-hidden="true">{label}</span>
        <select
          aria-label={`${label} month`}
          value={Number.isFinite(month) ? month : ""}
          onChange={(e) => set(which, fallbackYear, Number(e.target.value))}
          className="rounded-ctl border border-line bg-paper px-2.5 py-1.5 text-ink"
        >
          {!Number.isFinite(month) && <option value="" disabled>Month</option>}
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select
          aria-label={`${label} year`}
          value={Number.isFinite(year) ? year : ""}
          onChange={(e) => set(which, Number(e.target.value), fallbackMonth)}
          className="rounded-ctl border border-line bg-paper px-2.5 py-1.5 text-ink tnum"
        >
          {!Number.isFinite(year) && <option value="" disabled>Year</option>}
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </fieldset>
    );
  };

  return (
    <div role="group" aria-labelledby={`${id}-t`}>
      <p id={`${id}-t`} className="flex items-center font-semibold">
        <Step n="T" />When?
        {time && <span className="ml-2 font-normal text-ink-2">{formatRange(time)}</span>}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {part("start", "From")}
        {part("end", "To")}
      </div>
      <Timeline bounds={bounds} time={time} padMonths={padMonths} onChange={onTimeChange} />
      {offer && (
        <p className="mt-1 text-sm text-ink-2" role="status">
          Your text mentions <span className="font-semibold">{formatRange(offer)}</span>.{" "}
          <button type="button" onClick={() => onTimeChange(offer)} className="font-semibold text-link underline underline-offset-2 hover:no-underline">
            Use it
          </button>
        </p>
      )}
      {!time && !offer && <p className="mt-1 text-sm text-ink-3">Put a year in the event text, or pick months here.</p>}
    </div>
  );
}

/**
 * The record as a strip: the event period filled, event ± pad (the part left out of the baseline) lighter.
 * Drag to pick a month range; a click picks that calendar year. The selects above are the keyboard alternative.
 */
function Timeline({ bounds, time, padMonths, onChange }: { bounds: TimeRange; time: TimeRange | null; padMonths: number; onChange: (r: TimeRange) => void }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [drag, setDrag] = useState<{ anchor: number; at: number; moved: boolean } | null>(null);
  const a = ymIndex(bounds.start), b = ymIndex(bounds.end);
  const h = 40, padX = 6;
  const w = Math.max(0, width);
  const x = (i: number) => padX + ((i - a) / Math.max(1, b - a + 1)) * (w - 2 * padX);
  const toMonth = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const t = (clientX - r.left - padX) / Math.max(1, r.width - 2 * padX);
    return Math.max(a, Math.min(b, a + Math.floor(t * (b - a + 1))));
  };
  const shown = drag
    ? { start: ymFromIndex(Math.min(drag.anchor, drag.at)), end: ymFromIndex(Math.max(drag.anchor, drag.at)) }
    : time;
  const years: number[] = [];
  const y0 = Math.ceil(a / 12), y1 = Math.floor(b / 12);
  const step = w < 360 ? 10 : 5;
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) years.push(y);

  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = toMonth(e.clientX, e.currentTarget);
    setDrag({ anchor: m, at: m, moved: false });
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const m = toMonth(e.clientX, e.currentTarget);
    if (m !== drag.at) setDrag({ ...drag, at: m, moved: drag.moved || m !== drag.anchor });
  };
  const up = () => {
    if (!drag) return;
    if (drag.moved) {
      onChange({ start: ymFromIndex(Math.min(drag.anchor, drag.at)), end: ymFromIndex(Math.max(drag.anchor, drag.at)) });
    } else {
      const year = Math.floor(drag.anchor / 12);
      onChange({ start: ymFromIndex(Math.max(a, year * 12)), end: ymFromIndex(Math.min(b, year * 12 + 11)) });
    }
    setDrag(null);
  };

  return (
    <div ref={ref} className="mt-3 w-full select-none">
      {w > 0 && (
        <svg
          width={w}
          height={h}
          className="block cursor-crosshair touch-none"
          aria-hidden="true"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => setDrag(null)}
        >
          <rect x={padX} y={8} width={w - 2 * padX} height={12} rx={6} fill="var(--well)" stroke="var(--line)" />
          {shown && (
            <>
              <rect
                x={x(Math.max(a, ymIndex(addMonths(shown.start, -padMonths))))}
                y={8}
                width={Math.max(2, x(Math.min(b, ymIndex(addMonths(shown.end, padMonths))) + 1) - x(Math.max(a, ymIndex(addMonths(shown.start, -padMonths)))))}
                height={12}
                fill="var(--water)"
                opacity={0.25}
              />
              <rect
                x={x(ymIndex(shown.start))}
                y={5}
                width={Math.max(3, x(ymIndex(shown.end) + 1) - x(ymIndex(shown.start)))}
                height={18}
                rx={3}
                fill="var(--viz-orange)"
              />
            </>
          )}
          {years.map((y) => {
            const at = x(y * 12);
            // keep the end labels inside the strip
            const anchor = at < 18 ? "start" : at > w - 18 ? "end" : "middle";
            return (
              <g key={y}>
                <line x1={at} x2={at} y1={20} y2={25} stroke="var(--viz-axis)" />
                <text x={anchor === "start" ? Math.max(0, at - 2) : anchor === "end" ? Math.min(w, at + 2) : at} y={37} textAnchor={anchor} fontSize={11} fill="var(--ink-3)" className="tnum">{y}</text>
              </g>
            );
          })}
        </svg>
      )}
      <p className="text-xs text-ink-3">
        Drag on the strip to pick months, or click a year. Lighter blue: the ± {padMonths} months left out of the baseline.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ L */

function RegionField({ event, catalog, catalogError, searchable, countryNames, region, regionNote, onRegion }: InputPanelProps) {
  const subCatalog = useMemo<Catalog | null>(
    () => (catalog && searchable ? { ...catalog, regions: searchable } : null),
    [catalog, searchable],
  );
  const hints = useRegionHints(event, searchable, countryNames).filter((r) => r.id !== region?.id);
  return (
    <div>
      <p className="flex items-center font-semibold">
        <Step n="L" />Where?
      </p>
      <div className="mt-2 rounded-ctl bg-well px-4 py-2" aria-live="polite">
        {region ? (
          <p>
            <span className="font-semibold">{region.name}</span>
            <span className="block text-sm text-ink-3">
              Sub-basin {region.id} · <span className="tnum">{formatArea(region.areaKm2)}</span>
            </span>
          </p>
        ) : (
          <p className="text-ink-3">No sub-basin yet. Click one on the globe or search below.</p>
        )}
        {regionNote}
      </div>
      {hints.length > 0 && (
        <div className="mt-3">
          <p className="text-sm text-ink-3">Places in your text:</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {hints.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onRegion(r)}
                  className="rounded-ctl border border-line px-3 py-1 text-left text-sm hover:border-link"
                >
                  <span className="font-semibold text-link">{r.name}</span>{" "}
                  <span className="text-ink-3 tnum">{formatArea(r.areaKm2)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3">
        {subCatalog ? (
          <RegionSearch catalog={subCatalog} onSelect={onRegion} />
        ) : catalogError ? (
          <p role="alert" className="rounded-ctl bg-well px-4 py-2.5 text-ink-2">{catalogError}</p>
        ) : (
          <p role="status" className="rounded-ctl bg-well px-4 py-2.5 text-ink-3">Loading sub-basins…</p>
        )}
      </div>
    </div>
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const zhNorm = (s: string) => s.replace(/臺/g, "台");
/** everyday Chinese names that differ from catalog/countries.json */
const ZH_ALIASES: [string, string][] = [["澳洲", "AUS"], ["中國", "CHN"], ["韓國", "KOR"], ["美國", "USA"]];

/**
 * Sub-basins the event text seems to name: a river ("Indus") or a country in English ("Pakistan") or Chinese
 * ("巴基斯坦"). River hits first, then the largest basins; at most five.
 */
function useRegionHints(text: string, regions: Region[] | null, countryNames: ReadonlyMap<string, string> | null): Region[] {
  const index = useMemo(() => {
    if (!regions) return null;
    const enToIso = new Map<string, string>();
    const rivers = new Map<string, Region[]>();
    for (const r of regions) {
      // names from scripts/prep-data.mjs: "Indus basin (Pakistan)", "Basin 4370 (Taiwan)", "Island basin 123 (Fiji)";
      // the places in brackets are the first three of r.iso, in the same order
      const places = /\(([^()]*)\)\s*$/.exec(r.name)?.[1].split(", ").filter((s) => s && s !== "…") ?? [];
      places.forEach((name, i) => { const iso = r.iso?.[i]; if (iso && !enToIso.has(name.toLowerCase())) enToIso.set(name.toLowerCase(), iso); });
      const river = /^(.+?) basin\b/.exec(r.name)?.[1];
      if (river && river !== "Island") {
        const k = river.toLowerCase();
        rivers.set(k, [...(rivers.get(k) ?? []), r]);
      }
    }
    return { enToIso, rivers };
  }, [regions]);

  return useMemo(() => {
    const t = text.trim();
    if (!index || !regions || t.length < 2) return [];
    const lower = t.toLowerCase();
    const hit = (name: string) => new RegExp(`(^|[^\\p{L}])${escapeRe(name)}($|[^\\p{L}])`, "iu").test(lower);
    const fromRivers = [...index.rivers.entries()].filter(([k]) => k.length >= 3 && hit(k)).flatMap(([, rs]) => rs);
    const isos = new Set<string>();
    for (const [name, iso] of index.enToIso) if (name.length >= 4 && hit(name)) isos.add(iso);
    const zt = zhNorm(t);
    for (const [zh, iso] of ZH_ALIASES) if (zt.includes(zh)) isos.add(iso);
    if (countryNames) for (const [iso, zh] of countryNames) if (zh.length >= 2 && zt.includes(zhNorm(zh))) isos.add(iso);
    const byArea = (x: Region, y: Region) => y.areaKm2 - x.areaKm2;
    const fromCountries = isos.size ? regions.filter((r) => r.iso?.some((c) => isos.has(c))).sort(byArea) : [];
    const out: Region[] = [];
    for (const r of [...fromRivers.sort(byArea), ...fromCountries]) if (!out.includes(r)) out.push(r);
    return out.slice(0, 5);
  }, [text, index, regions, countryNames]);
}

/** The planet with sub-basin outlines only. A click selects the sub-basin under the pointer; the selection glows. */
function SubBasinGlobe({ catalog, region, onRegion }: { catalog: Catalog | null; region: Region | null; onRegion: (r: Region) => void }) {
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
    if (!cat) { setStatus("The sub-basin list is still loading. Try again in a moment."); return; }
    setStatus(`Looking up the sub-basin at ${fmtLat(lat)}, ${fmtLon(lon)}…`);
    try {
      const grid = await loadGrid("basin4");
      if (n !== seq.current) return;
      const g = grid[rasterIndex(lon, lat)];
      const r = g ? cat.byGrid.basin4[g] : undefined;
      if (!r) { setStatus(`No sub-basin at ${fmtLat(lat)}, ${fmtLon(lon)}. Sub-basins cover land only; try nearby land or search by name.`); return; }
      setStatus("");
      onRegionRef.current(r);
    } catch (e) {
      if (n === seq.current) setStatus(`Could not look up sub-basins: ${e instanceof Error ? e.message : String(e)}. Search by name instead.`);
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
          interactive
          boundaryLayer="basin4"
          selected={region}
          onPick={onPick}
          onHover={onHover}
          ariaLabel="Globe sub-basin picker. Drag or use the arrow keys to turn the planet, scroll or press plus and minus to zoom, click or press Enter to select the sub-basin at the centre."
        />
      </div>
      <p className="sr-only" aria-live="polite">{status}</p>
      <p className="min-h-[1.5rem] text-center text-sm text-on-stage-2">
        {status ||
          (hover ? (
            <>
              <span className="font-semibold text-on-stage">{hover.name}</span>. Click to select.
            </>
          ) : (
            "Drag to turn the planet, scroll or pinch to zoom, click a sub-basin to select it."
          ))}
      </p>
    </div>
  );
}
