"use client";
// Event-led input step. DetectiveApp owns URL state and passes values and callbacks in.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { Catalog, Region } from "@/lib/types";
import type { PresetEvent, TimeRange } from "@/lib/detective/contracts";
import { RegionSearch } from "@/components/ui/RegionSearch";
import { formatArea } from "@/components/ui/regionUtils";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { addMonths, formatRange, ym, ymFromIndex, ymIndex } from "@/lib/detective/url";
import { COPY } from "./copy/input";
import { useSharedStage } from "@/components/shell/HeroGlobe";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export interface InputPanelProps {
  /* What */
  event: string;
  onEventChange: (text: string) => void;
  presets: readonly PresetEvent[];
  onPreset: (p: PresetEvent) => void;
  /* When */
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
  /* Where */
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
  /* Find */
  onFind: () => void;
  finding: boolean;
  /** variable suggestions are already showing */
  hasPicker: boolean;
  /** variable suggestions, shown under the form */
  children?: ReactNode;
}

export function InputPanel(p: InputPanelProps) {
  const { setInput, entering, formHidden, skip } = useSharedStage();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setInput({ catalog: p.catalog, region: p.region, onRegion: p.onRegion });
  }, [setInput, p.catalog, p.region, p.onRegion]);
  useEffect(() => () => setInput(null), [setInput]);
  useEffect(() => {
    if (!entering) panel.current?.querySelector("textarea")?.focus({ preventScroll: true });
  }, [entering]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (entering && (e.isComposing || e.key === "Process")) {
        skip();
        panel.current?.querySelector("textarea")?.focus({ preventScroll: true });
        return;
      }
      if (e.target instanceof Element && e.target.closest('[role="application"]')) return;
      if (!entering || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      skip();
      if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        p.onEventChange(p.event + e.key);
        panel.current?.querySelector("textarea")?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entering, skip, p.event, p.onEventChange]);
  return (
    <div data-stage-pass className="mx-auto grid max-w-[90rem] items-start gap-6 px-4 pt-8 pb-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)] lg:gap-12 lg:px-8 lg:pt-12">
      <div data-stage-pass className="order-2 pb-14 lg:order-1">
        <div data-stage-globe data-stage-pass className="mx-auto aspect-square w-full max-w-[min(100%,calc(100dvh-10rem))]" />
      </div>
      <div ref={panel} className="pointer-events-auto order-1 min-w-0 text-on-stage lg:order-2">
        <div data-stage-copy className="h-32 sm:h-36" />
        <form
          className={`mt-5 transition-[opacity,transform] duration-300 motion-reduce:transition-none ${formHidden ? "translate-y-3 opacity-0" : "translate-y-0 opacity-100"}`}
          onSubmit={(e) => { e.preventDefault(); if (p.event.trim() && !p.finding) p.onFind(); }}
          aria-label={COPY.formLabel}
        >
          <EventField {...p} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stage-line pb-5">
            <p className="text-xs text-on-stage-2">{COPY.what.hint}</p>
            <button
              type="submit"
              disabled={!p.event.trim() || p.finding}
              className="min-h-11 rounded-ctl bg-action px-5 py-2 font-semibold text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50"
            >
              {p.finding ? COPY.find.busy : p.hasPicker ? COPY.find.again : COPY.find.go}
            </button>
          </div>
          <details className="group border-b border-stage-line py-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm text-on-stage-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <span className="ml-1 font-semibold">{COPY.steps.when}</span>
              <span className="ml-3 tnum">{p.time ? formatRange(p.time) : COPY.when.choose}</span>
            </summary>
            <div className="pb-2"><TimeField {...p} /></div>
          </details>
          <details className="group border-b border-stage-line py-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm text-on-stage-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <span className="ml-1 font-semibold">{COPY.steps.where}</span>
              <span className="ml-3">{p.region ? p.region.name : COPY.where.none}</span>
            </summary>
            <div className="pb-2"><RegionField {...p} /></div>
          </details>
        </form>
        {p.children && <div className="mt-6">{p.children}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ What */

function EventField({ event, onEventChange }: InputPanelProps) {
  const { skip } = useSharedStage();
  const id = useId();
  return (
    <div>
      <label htmlFor={`${id}-e`} className="sr-only">{COPY.what.label}</label>
      <textarea
        id={`${id}-e`}
        rows={3}
        value={event}
        onChange={(e) => { skip(); onEventChange(e.target.value); }}
        onCompositionStart={skip}
        maxLength={300}
        autoComplete="off"
        placeholder={COPY.what.placeholder}
        aria-describedby={`${id}-hint`}
        className="min-h-40 w-full resize-y rounded-ctl border border-stage-line bg-on-stage/5 px-4 py-4 font-display text-2xl leading-snug text-on-stage placeholder:text-on-stage-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:text-3xl"
      />
      <span id={`${id}-hint`} className="sr-only">{COPY.what.hint}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ When */

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
        <span className="text-sm text-on-stage-2" aria-hidden="true">{label}</span>
        <select
          aria-label={`${label} month`}
          value={Number.isFinite(month) ? month : ""}
          onChange={(e) => set(which, fallbackYear, Number(e.target.value))}
          className="rounded-ctl border border-line bg-paper px-2 py-1.5 text-ink"
        >
          {!Number.isFinite(month) && <option value="" disabled>{COPY.when.month}</option>}
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select
          aria-label={`${label} year`}
          value={Number.isFinite(year) ? year : ""}
          onChange={(e) => set(which, Number(e.target.value), fallbackMonth)}
          className="rounded-ctl border border-line bg-paper px-2 py-1.5 text-ink tnum"
        >
          {!Number.isFinite(year) && <option value="" disabled>{COPY.when.year}</option>}
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </fieldset>
    );
  };

  return (
    <div role="group" aria-labelledby={`${id}-t`}>
      <p id={`${id}-t`} className="sr-only">{COPY.steps.when}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {part("start", COPY.when.from)}
        {part("end", COPY.when.to)}
        {offer && (
          <button
            type="button"
            onClick={() => onTimeChange(offer)}
            title={`${COPY.when.useText} ${formatRange(offer)}`}
            className="rounded-full border border-line px-3 py-1 text-sm hover:border-link"
          >
            <span className="text-on-stage-2">{COPY.when.use}</span> <span className="font-semibold text-link tnum">{formatRange(offer)}</span>
          </button>
        )}
      </div>
      <Timeline bounds={bounds} time={time} padMonths={padMonths} onChange={onTimeChange} />
    </div>
  );
}

/**
 * The record as a strip: the event period as an orange bar with handles, event ± pad (the part left out of the
 * baseline) lighter blue. Drag to pick a month range; a click picks that calendar year. The selects above are the
 * keyboard alternative.
 */
function Timeline({ bounds, time, padMonths, onChange }: { bounds: TimeRange; time: TimeRange | null; padMonths: number; onChange: (r: TimeRange) => void }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [drag, setDrag] = useState<{ anchor: number; at: number; moved: boolean } | null>(null);
  const a = ymIndex(bounds.start), b = ymIndex(bounds.end);
  const h = 44, padX = 8;
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

  const sx = shown ? x(ymIndex(shown.start)) : 0;
  const ex = shown ? x(ymIndex(shown.end) + 1) : 0;
  const barW = Math.max(4, ex - sx);
  return (
    <div ref={ref} className="mt-2 w-full select-none" title={COPY.when.stripTitle}>
      {w > 0 && (
        <svg
          width={w}
          height={h}
          className="block cursor-grab touch-none active:cursor-grabbing"
          aria-hidden="true"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => setDrag(null)}
        >
          <rect x={padX} y={9} width={w - 2 * padX} height={12} rx={6} fill="var(--well)" stroke="var(--line)" />
          {shown && (
            <>
              <rect
                x={x(Math.max(a, ymIndex(addMonths(shown.start, -padMonths))))}
                y={9}
                width={Math.max(2, x(Math.min(b, ymIndex(addMonths(shown.end, padMonths))) + 1) - x(Math.max(a, ymIndex(addMonths(shown.start, -padMonths)))))}
                height={12}
                fill="var(--water)"
                opacity={0.3}
              />
              <rect x={sx} y={6} width={barW} height={18} rx={3} fill="var(--viz-orange)" />
              {/* grab handles on both edges */}
              {[sx, sx + barW].map((hx, k) => (
                <rect key={k} x={hx - 2.5} y={2} width={5} height={26} rx={2.5} fill="var(--paper)" stroke="var(--viz-orange)" strokeWidth={1.5} />
              ))}
            </>
          )}
          {years.map((y) => {
            const at = x(y * 12);
            // keep the end labels inside the strip
            const anchor = at < 18 ? "start" : at > w - 18 ? "end" : "middle";
            return (
              <g key={y}>
                <line x1={at} x2={at} y1={22} y2={28} stroke="var(--viz-axis)" />
                <text x={anchor === "start" ? Math.max(0, at - 2) : anchor === "end" ? Math.min(w, at + 2) : at} y={41} textAnchor={anchor} fontSize={11} fill="var(--ink-3)" className="tnum">{y}</text>
              </g>
            );
          })}
        </svg>
      )}
      <p className="flex flex-wrap gap-x-4 text-xs text-on-stage-2">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm" style={{ background: "var(--viz-orange)" }} aria-hidden="true" />{COPY.when.legendEvent}</span>
        <span className="inline-flex items-center gap-1.5" title={COPY.when.legendBaselineTitle(padMonths)}>
          <span className="h-2.5 w-4 rounded-sm bg-water opacity-30" aria-hidden="true" />{COPY.when.legendBaseline} (±{padMonths} mo)
        </span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ Where */

function RegionField({ event, catalog, catalogError, searchable, countryNames, region, regionNote, onRegion }: InputPanelProps) {
  const id = useId();
  const subCatalog = useMemo<Catalog | null>(
    () => (catalog && searchable ? { ...catalog, regions: searchable } : null),
    [catalog, searchable],
  );
  const hints = useRegionHints(event, searchable, countryNames).filter((r) => r.id !== region?.id);
  return (
    <div role="group" aria-labelledby={`${id}-h`}>
      <p id={`${id}-h`} className="text-xs text-on-stage-2">{region ? `${region.name} · ${formatArea(region.areaKm2)}` : COPY.where.subBasin}</p>
      <div className="mt-2 [&_input]:mt-0 [&>div>label]:sr-only [&>div>p[id$=-hint]]:sr-only" >
        {subCatalog ? (
          <RegionSearch catalog={subCatalog} onSelect={onRegion} />
        ) : catalogError ? (
          <p role="alert" className="py-2 text-on-stage-2">{catalogError}</p>
        ) : (
          <p role="status" className="py-2 text-on-stage-2">{COPY.where.loading}</p>
        )}
      </div>
      {regionNote}
      {hints.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label={COPY.where.placesInText}>
          {hints.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onRegion(r)}
                className="rounded-full border border-line px-3 py-1 text-left text-sm hover:border-link"
              >
                <span className="font-semibold text-link">{r.name}</span>{" "}
                <span className="text-on-stage-2 tnum">{formatArea(r.areaKm2)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
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
