"use client";
// Empty globe anchors share the layout-owned canvas; only expanded variables cover the disc.
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Catalog, Region } from "@/lib/types";
import type { TimeRange } from "@/lib/detective/contracts";
import { RegionSearch } from "@/components/ui/RegionSearch";
import { formatArea } from "@/components/ui/regionUtils";
import { buildRegionHintIndex, regionHints } from "@/lib/detective/regionHints";
import { parseDay, parsePeriod } from "@/lib/detective/periodText";
import { formatRange, isDay, ymIndex } from "@/lib/detective/url";
import { eventDays } from "@/lib/detective/window";
import { COPY } from "./copy/input";
import { useSharedStage } from "@/components/shell/HeroGlobe";
import { Timeline } from "./Timeline";
import { AnalyseButton, NeededMarker, startableCount, VariablePicker, type VariablePickerProps } from "./VariablePicker";

export interface InputPanelProps {
  event: string;
  onEventChange: (text: string) => void;
  onEventCommit: (text: string) => void;
  time: TimeRange | null;
  onTimeChange: (next: TimeRange | ((current: TimeRange | null) => TimeRange)) => void;
  timeSuggestion: TimeRange | null;
  bounds: TimeRange;
  padMonths: number;
  catalog: Catalog | null;
  catalogError: string | null;
  searchable: Region[] | null;
  /** ISO code -> Chinese country name, for basin suggestions from Chinese event text; null while loading or missing */
  countryNames: ReadonlyMap<string, string> | null;
  region: Region | null;
  regionNote: ReactNode;
  onRegion: (r: Region) => void;
  picker: VariablePickerProps;
}

export function InputPanel(p: InputPanelProps) {
  const { setInput, formHidden } = useSharedStage();
  const [highlighted, setHighlighted] = useState({ event: false, where: false, when: false, variables: false });
  const missing = {
    event: !!p.picker.blocked && !p.event.trim(),
    where: !!p.picker.blocked && !p.region,
    when: !!p.picker.blocked && !p.time,
    variables: !!p.picker.blocked && startableCount(p.picker) === 0,
  };
  // A blocked attempt highlights only missing sections, until each one is completed.
  useEffect(() => {
    setHighlighted((previous) => ({
      event: previous.event && missing.event,
      where: previous.where && missing.where,
      when: previous.when && missing.when,
      variables: previous.variables && missing.variables,
    }));
  }, [missing.event, missing.where, missing.when, missing.variables]);
  useEffect(() => {
    setInput({ catalog: p.catalog, region: p.region, onRegion: p.onRegion });
  }, [setInput, p.catalog, p.region, p.onRegion]);
  useEffect(() => () => setInput(null), [setInput]);
  const reveal = `transition-[opacity,transform] duration-300 ${formHidden ? "translate-y-3 opacity-0" : "translate-y-0 opacity-100"}`;
  return (
    <div data-stage-pass className="mx-auto grid max-w-[90rem] items-start gap-x-20 px-5 pt-8 pb-16 sm:px-8 lg:min-h-[calc(100svh-var(--stage-offset,4rem))] lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:grid-rows-[auto_1fr] lg:px-16 lg:pt-14">
      <section className={`pointer-events-auto min-w-0 text-on-stage lg:col-start-2 ${reveal}`} aria-label={COPY.steps.what}>
        <h2 data-needed={missing.event} className="mb-3 flex items-center gap-3 rounded-ctl text-sm font-semibold">{COPY.steps.what}{missing.event && <NeededMarker filled={highlighted.event} />}</h2>
        <EventField event={p.event} onEventChange={p.onEventChange} onEventCommit={p.onEventCommit} />
      </section>
      <div data-stage-pass className={`relative my-8 grid min-w-0 grid-cols-1 grid-rows-[3.5rem_auto] gap-y-4 lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:my-0 ${reveal}`}>
        <div data-stage-pass className="z-10 col-start-1 row-start-1 row-span-2 mx-auto w-full max-w-[35rem] self-start">
          <VariablePicker {...p.picker} needed={missing.variables} neededFilled={highlighted.variables} />
        </div>
        <div data-stage-globe data-stage-pass className="col-start-1 row-start-2 mx-auto aspect-square w-full max-w-[min(100%,calc(100dvh-14rem))] self-start max-lg:max-w-[24rem]" />
      </div>
      <div className={`pointer-events-auto min-w-0 text-on-stage lg:col-start-2 lg:row-start-2 ${reveal}`}>
        <section className="border-t border-stage-line py-8 max-lg:border-t-0 lg:mt-10 lg:py-10" aria-label={COPY.steps.where}>
          <h2 data-needed={missing.where} className="mb-3 flex items-center gap-3 rounded-ctl text-sm font-semibold">{COPY.steps.where}{missing.where && <NeededMarker filled={highlighted.where} />}</h2>
          <RegionField {...p} />
        </section>
        <section className="border-t border-stage-line py-8 lg:py-10" aria-label={COPY.steps.when}>
          <h2 data-needed={missing.when} className="flex items-center gap-3 rounded-ctl text-sm font-semibold">{COPY.steps.when}{missing.when && <NeededMarker filled={highlighted.when} />}</h2>
          <TimeField {...p} />
        </section>
        <div className="border-t border-stage-line pt-8 lg:pt-10">
          <AnalyseButton picker={p.picker} onBlocked={() => setHighlighted(missing)} className="w-full" />
          <Link href="/batch" className="mt-3 flex min-h-11 items-center justify-center rounded-ctl text-sm text-on-stage-2 underline underline-offset-4 hover:text-on-stage focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {COPY.batchLink}
          </Link>
        </div>
      </div>
    </div>
  );
}

function EventField({ event, onEventChange, onEventCommit }: Pick<InputPanelProps, "event" | "onEventChange" | "onEventCommit">) {
  const { skip, entering } = useSharedStage();
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!entering && window.matchMedia("(pointer: fine)").matches) area.current?.focus({ preventScroll: true });
  }, [entering]);
  useEffect(() => {
    const el = area.current;
    if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 80)}px`; }
  }, [event]);
  const commit = () => {
    if (!event.trim()) return;
    onEventCommit(event);
  };
  return (
    <>
      <label htmlFor={`${id}-e`} className="sr-only">{COPY.what.label}</label>
      <textarea
        ref={area}
        id={`${id}-e`}
        rows={1}
        value={event}
        onChange={(e) => { skip(); onEventChange(e.target.value); }}
        onCompositionStart={skip}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); commit(); }
        }}
        maxLength={300}
        autoComplete="off"
        className="block min-h-14 max-h-20 w-full resize-none rounded-ctl border border-stage-line bg-on-stage/5 px-4 py-3 font-display text-[1.3rem] leading-snug text-on-stage placeholder:text-on-stage-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
    </>
  );
}

/* ------------------------------------------------------------------ When */

function TimeField({ time, onTimeChange, timeSuggestion, bounds }: InputPanelProps) {
  const id = useId();
  const [preview, setPreview] = useState<TimeRange | null>(null);
  const shownTime = preview ?? time;
  const days = shownTime ? eventDays(shownTime) : null;
  const changeDay = (edge: "start" | "end", day: string): boolean => {
    let accepted = false;
    // Read the current URL range: successive blurs can precede a router render.
    onTimeChange((current) => {
      const next = { ...(current ? eventDays(current) : { start: day, end: day }), [edge]: day };
      if (current && next.start > next.end) return current;
      accepted = true;
      return next;
    });
    return accepted;
  };
  // offer the text's period only when the chosen one is not already inside it (Jul–Sep 2022 is inside "2022")
  const inside = !!time && !!timeSuggestion && ymIndex(time.start) >= ymIndex(timeSuggestion.start) && ymIndex(time.end) <= ymIndex(timeSuggestion.end);
  const offer = timeSuggestion && !inside ? timeSuggestion : null;

  return (
    <div role="group" aria-labelledby={`${id}-t`}>
      <p id={`${id}-t`} className="sr-only">{COPY.steps.when}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 text-base text-on-stage tnum">
          <DateField label="Start date" value={days?.start ?? ""} onCommit={(day) => changeDay("start", day)} />
          <span className="text-on-stage-2">–</span>
          <DateField label="End date" value={days?.end ?? ""} onCommit={(day) => changeDay("end", day)} />
        </div>
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
      <PeriodText onPeriod={(r) => onTimeChange(r)} />
      <Timeline bounds={bounds} time={time} onChange={onTimeChange} onPreviewChange={setPreview} />
    </div>
  );
}

/** Free text for the period: "5–12 Mar 2021", "last 30 days", "Feb–May 2021", "2021 年 2 月到 5 月" (lib/detective/periodText). */
function PeriodText({ onPeriod }: { onPeriod: (r: TimeRange) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [unknown, setUnknown] = useState(false);
  const parsed = text.trim() ? parsePeriod(text) : null;
  const shown = parsed ? (parsed.start.length === 10 ? formatDayRange(parsed) : formatRange(parsed)) : null;
  const apply = () => {
    if (!text.trim()) return;
    if (!parsed) { setUnknown(true); return; }
    onPeriod(parsed);
    setText("");
    setUnknown(false);
  };
  return (
    <div className="mt-3">
      <label htmlFor={`${id}-p`} className="sr-only">{COPY.when.typeLabel}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`${id}-p`}
          type="text"
          value={text}
          onChange={(e) => { setText(e.target.value); setUnknown(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } else if (e.key === "Escape") setText(""); }}
          placeholder={COPY.when.typePlaceholder}
          aria-describedby={`${id}-h`}
          aria-invalid={unknown}
          autoComplete="off"
          className="min-w-0 flex-1 basis-64 rounded-ctl border border-stage-line bg-on-stage/5 px-2.5 py-2 text-base text-on-stage placeholder:text-on-stage-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        {shown && (
          <button type="button" onClick={apply} className="rounded-full border border-stage-line px-3 py-1 text-sm hover:border-link">
            <span className="text-on-stage-2">{COPY.when.typeApply}</span> <span className="font-semibold text-link tnum">{shown}</span>
          </button>
        )}
      </div>
      <p id={`${id}-h`} role={unknown ? "alert" : undefined} className="mt-1 text-xs text-on-stage-2">{unknown ? COPY.when.typeUnknown : COPY.when.typeHint}</p>
    </div>
  );
}

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "5 – 12 Mar 2021", "28 Feb – 6 Mar 2021", "5 Mar 2021" */
function formatDayRange(r: TimeRange): string {
  const p = (s: string) => ({ y: s.slice(0, 4), m: MON3[Number(s.slice(5, 7)) - 1], d: String(Number(s.slice(8, 10))) });
  const a = p(r.start), b = p(r.end);
  if (r.start === r.end) return `${a.d} ${a.m} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`;
  return `${a.d} – ${b.d} ${b.m} ${b.y}`;
}

function DateField({ label, value, onCommit }: { label: string; value: string; onCommit: (day: string) => boolean }) {
  const formatted = value.replaceAll("-", "/");
  const [text, setText] = useState(formatted);
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(formatted); }, [formatted]);
  const commit = () => {
    editing.current = false;
    // any common way of writing one day: 2021/03/05, 2021-3-5, 5 Mar 2021, 2021年3月5日
    const day = parseDay(text) ?? "";
    if (!isDay(day) || !onCommit(day)) setText(formatted);
    else setText(day.replaceAll("-", "/"));
  };
  return <input
    type="text"
    aria-label={label}
    placeholder="YYYY/MM/DD"
    value={text}
    onChange={(e) => { editing.current = true; setText(e.target.value); }}
    onBlur={commit}
    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
    maxLength={20}
    className="min-w-0 w-[8.25rem] rounded-ctl border border-stage-line bg-on-stage/5 px-2.5 py-2 text-center text-base text-on-stage tnum placeholder:text-on-stage-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
  />;
}

/* ------------------------------------------------------------------ Where */

function RegionField({ event, catalog, catalogError, searchable, countryNames, region, regionNote, onRegion }: InputPanelProps) {
  const id = useId();
  const subCatalog = useMemo<Catalog | null>(
    () => (catalog && searchable ? { ...catalog, regions: searchable } : null),
    [catalog, searchable],
  );
  // basins the event text names: a river ("Indus") or a country in English or Chinese ("Pakistan", "巴基斯坦")
  const hintIndex = useMemo(() => (searchable ? buildRegionHintIndex(searchable) : null), [searchable]);
  const hints = useMemo(
    () => (hintIndex && searchable ? regionHints(event, hintIndex, searchable, countryNames) : []),
    [event, hintIndex, searchable, countryNames],
  ).filter((r) => r.id !== region?.id);
  const [searching, setSearching] = useState(false);
  return (
    <div role="group" aria-labelledby={`${id}-h`}>
      <div className="flex items-baseline justify-between gap-3">
        <p id={`${id}-h`} className="text-base text-on-stage">{region ? <>{region.name}<span className="ml-2 whitespace-nowrap text-sm text-on-stage-2">{formatArea(region.areaKm2)}</span></> : COPY.where.none}</p>
        {region && <button type="button" title="Search basins" aria-label="Search basins" onClick={() => setSearching(!searching)} className="shrink-0 text-on-stage-2 hover:text-on-stage"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg></button>}
      </div>
      {(!region || searching) && <div className="mt-3 [&_input]:mt-0 [&_input]:border-stage-line [&_input]:bg-on-stage/5 [&_input]:text-on-stage [&_input]:placeholder:text-on-stage-2 [&>div>label]:sr-only [&>div>p[id$=-hint]]:sr-only" >
        {subCatalog ? (
          <RegionSearch catalog={subCatalog} onSelect={(r) => { onRegion(r); setSearching(false); }} />
        ) : catalogError ? (
          <p role="alert" className="py-2 text-on-stage-2">{catalogError}</p>
        ) : (
          <p role="status" className="py-2 text-on-stage-2">{COPY.where.loading}</p>
        )}
      </div>}
      {regionNote}
      {hints.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label={COPY.where.placesInText}>
          {hints.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => { onRegion(r); setSearching(false); }}
                className="rounded-full border border-stage-line px-3 py-1 text-left text-sm hover:border-link"
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
