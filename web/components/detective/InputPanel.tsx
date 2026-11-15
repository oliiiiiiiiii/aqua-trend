"use client";
// Event-led input step. DetectiveApp owns URL state and passes values and callbacks in.
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { Catalog, Region } from "@/lib/types";
import type { PresetEvent, TimeRange } from "@/lib/detective/contracts";
import { RegionSearch } from "@/components/ui/RegionSearch";
import { formatArea } from "@/components/ui/regionUtils";
import { formatRange, ymIndex } from "@/lib/detective/url";
import { COPY } from "./copy/input";
import { useSharedStage } from "@/components/shell/HeroGlobe";
import { Timeline } from "./Timeline";
import { AnalyseButton, VariablePicker, type VariablePickerProps } from "./VariablePicker";

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
  /** variable suggestions: an overlay on the globe from 1024 px up, inline under the form below that */
  picker?: VariablePickerProps | null;
  /** Analyse was pressed: hide the picker while the shared progress overlay runs. */
  starting?: boolean;
}

const WIDE = "(min-width: 1024px)";
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);

export function InputPanel(p: InputPanelProps) {
  const { setInput, entering, formHidden, skip } = useSharedStage();
  const panel = useRef<HTMLDivElement>(null);
  const wide = useWide();
  const overlayId = useId();
  const overlayEl = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const focusIn = useRef(false);
  const lastKey = useRef(-Infinity);
  useEffect(() => {
    const note = () => { lastKey.current = performance.now(); };
    window.addEventListener("keydown", note, true);
    return () => window.removeEventListener("keydown", note, true);
  }, []);
  // Suggestions only need the event. Time and place are checked by Analyse.
  const ready = !!p.picker && p.hasPicker && !p.finding;
  const wasReady = useRef(false);
  useEffect(() => {
    const previous = wasReady.current;
    wasReady.current = ready;
    if (!ready) setOpen(false);
    else if (!previous) {
      const active = document.activeElement;
      const editing = (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && performance.now() - lastKey.current < 1500;
      focusIn.current = !editing;
      setOpen(true);
    }
  }, [ready]);
  useEffect(() => {
    if (!open || !focusIn.current) return;
    focusIn.current = false;
    // visibility only flips once the fade has started, so retry for a few frames until the tile takes focus
    let f = 0, tries = 0;
    const go = () => {
      const el = overlayEl.current;
      el?.querySelector<HTMLInputElement>("input[type=checkbox]:not(:disabled)")?.focus({ preventScroll: true });
      if (el && !el.contains(document.activeElement) && ++tries < 12) f = requestAnimationFrame(go);
    };
    f = requestAnimationFrame(go);
    return () => cancelAnimationFrame(f);
  }, [open]);
  const close = () => {
    const inside = overlayEl.current?.contains(document.activeElement);
    setOpen(false);
    if (inside || document.activeElement === document.body) trigger.current?.focus({ preventScroll: true });
  };
  const toggle = () => {
    if (open) { close(); return; }
    focusIn.current = true;
    setOpen(true);
  };
  const onOverlayKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape" && !p.starting) { e.stopPropagation(); close(); }
  };
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
        <div data-stage-pass className="relative mx-auto w-full max-w-[min(100%,calc(100dvh-10rem))]">
          <div data-stage-globe data-stage-pass className="aspect-square w-full" />
          {wide && ready && p.picker && (
            <div
              ref={overlayEl}
              id={overlayId}
              role="region"
              aria-label={COPY.picker.heading}
              inert={!open && !p.starting}
              onKeyDown={onOverlayKey}
              className={`absolute inset-x-0 top-0 max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain rounded-card border border-stage-line bg-stage/80 px-6 py-6 shadow-card backdrop-blur-xl transition-[opacity,transform,visibility] duration-250 ease-out motion-reduce:transition-none sm:px-8 ${
                open || p.starting ? "pointer-events-auto visible scale-100 opacity-100" : "pointer-events-none invisible scale-[0.97] opacity-0"
              }`}
            >
              {p.starting ? null : open ? <VariablePicker {...p.picker} layout="overlay" onClose={close} /> : null}
            </div>
          )}
        </div>
      </div>
      <div ref={panel} className="pointer-events-auto order-1 min-w-0 text-on-stage lg:order-2">
        <div data-stage-copy className="h-24 sm:h-28" />
        <form
          className={`mt-5 transition-[opacity,transform] duration-300 motion-reduce:transition-none ${formHidden ? "translate-y-3 opacity-0" : "translate-y-0 opacity-100"}`}
          onSubmit={(e) => { e.preventDefault(); if (p.event.trim() && !p.finding) p.onFind(); }}
          aria-label={COPY.formLabel}
        >
          <EventField {...p} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stage-line pb-5">
            <button
              ref={trigger}
              type="submit"
              disabled={!p.event.trim() || p.finding}
              aria-expanded={ready && open}
              aria-controls={ready ? overlayId : undefined}
              className={`min-h-11 rounded-ctl px-5 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 ${
                p.hasPicker ? "border border-stage-line bg-on-stage/5 text-on-stage hover:bg-on-stage/15" : "bg-action text-on-action hover:bg-action-hover"
              }`}
            >
              {p.finding ? COPY.find.busy : p.hasPicker ? COPY.find.again : COPY.find.go}
            </button>
          </div>
          <section className="border-b border-stage-line py-4" aria-label={COPY.steps.when}>
            <h2 className="text-sm font-semibold">{COPY.steps.when}</h2>
            <TimeField {...p} />
          </section>
          <section className="border-b border-stage-line py-4" aria-label={COPY.steps.where}>
            <h2 className="mb-2 text-sm font-semibold">{COPY.steps.where}</h2>
            <RegionField {...p} />
          </section>
        </form>
        {p.picker && (
          <>
            {!open && !p.starting && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={toggle} disabled={!ready} aria-expanded={false} aria-controls={overlayId}
                  className="min-h-11 text-sm text-on-stage underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                  {p.picker.checked.length} selected
                </button>
                <AnalyseButton picker={p.picker} />
                {p.picker.blocked && <span className="text-sm text-on-stage-2">{p.picker.blocked}</span>}
              </div>
            )}
            {!wide && (open || p.starting) && (
              <div ref={overlayEl} id={overlayId} role="region" aria-label={COPY.picker.heading} onKeyDown={onOverlayKey} className="relative mt-6">
                {p.starting ? null : <VariablePicker {...p.picker} layout="overlay" onClose={close} />}
              </div>
            )}
          </>
        )}
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
  // offer the text's period only when the chosen one is not already inside it (Jul–Sep 2022 is inside "2022")
  const inside = !!time && !!timeSuggestion && ymIndex(time.start) >= ymIndex(timeSuggestion.start) && ymIndex(time.end) <= ymIndex(timeSuggestion.end);
  const offer = timeSuggestion && !inside ? timeSuggestion : null;

  return (
    <div role="group" aria-labelledby={`${id}-t`}>
      <p id={`${id}-t`} className="sr-only">{COPY.steps.when}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p role="status" className="text-sm text-on-stage-2 tnum">{time ? formatRange(time) : COPY.when.choose}</p>
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
