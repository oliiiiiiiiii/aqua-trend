"use client";
// The /detective input, laid out like a product configurator: the planet stays on the left and mirrors the answers
// (the camera moves only when a sub-basin is chosen); the questions stack on the right, each its own section, and
// each section appears once the one before it is answered. Nothing runs until Submit.
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CategoryId, CategoryVote, LayerId, PresetEvent, SelectResponse, TimeRange } from "@/lib/detective/contracts";
import type { Region } from "@/lib/types";
import { CATEGORIES } from "@/lib/detective/categories";
import { CATEGORY_IDS, formatRange, ymIndex } from "@/lib/detective/url";
import { formatArea } from "@/components/ui/regionUtils";
import { RegionSearchBox, useBasinPick, useRegionHints, type InputPanelProps } from "./InputPanel";
import { TimePicker } from "./TimePicker";
import { GLOBE_VAR, anomalyVar, meanZ, useIntervalAnomaly } from "./useIntervalAnomaly";

const GlobeCanvas = dynamic(() => import("@/components/globe/GlobeCanvas"), { ssr: false });

export interface QuestionnaireProps extends InputPanelProps {
  committedEvent: string;
  onEventDone: () => void;
  finding: boolean;
  regionReady: boolean;
  /** ticked categories that have data here */
  picks: readonly CategoryId[];
  /** ticked categories (draft) */
  checked: readonly CategoryId[];
  onPicks: (c: CategoryId[]) => void;
  response: SelectResponse | null;
  available: Readonly<Record<CategoryId, boolean>> | null;
  blocked: string | null;
  onSubmit: () => void;
  template: PresetEvent | null;
  layers?: Partial<Record<CategoryId, LayerId>>;
  layersHere: ReadonlySet<LayerId> | null;
}

const shortName = (r: Region) => r.name.replace(/\s*\(.*\)$/, "");

export function Questionnaire(p: QuestionnaireProps) {
  const answered = [p.regionReady, !!p.time, p.picks.length > 0 && !p.finding];
  const reach = answered[0] ? (answered[1] ? 3 : 2) : 1;
  const allDone = answered.every(Boolean);
  const [submitting, setSubmitting] = useState(false);
  // arriving from the landing page's hand-off, the planet is already in place: no zoom-in
  const [fromLanding] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return sessionStorage.getItem("aq-from-landing") === "1"; } catch { return false; }
  });
  useEffect(() => { try { sessionStorage.removeItem("aq-from-landing"); } catch {} }, []);

  const pick = useBasinPick(p.catalog, p.onRegion);
  const bars = useIntervalAnomaly(p.region?.id ?? null, p.picks, p.time, p.padMonths, p.layers, p.layersHere);
  const z = bars && p.time ? meanZ(bars, ymIndex(p.time.start), ymIndex(p.time.end) + 1) : null;
  const overlay = answered[2] && bars ? GLOBE_VAR[bars.category] ?? null : null;

  // bring a newly revealed section into view
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const lastReach = useRef(reach);
  const lastDone = useRef(allDone);
  useEffect(() => {
    const target = reach > lastReach.current ? reach - 1 : allDone && !lastDone.current ? 3 : -1;
    lastReach.current = reach;
    lastDone.current = allDone;
    if (target >= 0) window.setTimeout(() => sectionRefs.current[target]?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  }, [reach, allDone]);

  return (
    <div className="grid min-h-[calc(100dvh-4rem)] bg-paper text-ink lg:grid-cols-[minmax(0,1.15fr)_minmax(28rem,1fr)]">
      {/* ------------------------------------------------ the planet, mirroring the answers */}
      <div className="relative min-h-[60vh] bg-space lg:sticky lg:top-0 lg:h-[100dvh]">
        <div className={`${fromLanding ? "q-from-landing" : "globe-arrive"} absolute inset-0`}>
          <div className="h-full w-full">
            <GlobeCanvas
              className="h-full w-full"
              interactive
              showControls={false}
              boundaryLayer="basin4"
              selected={p.region}
              followSelected={false}
              view={p.region ? { lon: p.region.centroid[0], lat: p.region.centroid[1], zoom: 1.35 } : undefined}
              overlay={overlay}
              showLegend={false}
              selectVar={bars && p.time ? anomalyVar(bars, z) : undefined}
              initialView={p.region ? { lon: p.region.centroid[0], lat: p.region.centroid[1], zoom: 1.35 } : { lon: 60, lat: 15, zoom: 1 }}
              onPick={pick.onPick}
              onHover={pick.onHover}
              ariaLabel="Globe sub-basin picker"
            />
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
          <p className="rounded-full bg-black/45 px-4 py-1.5 text-sm text-on-space backdrop-blur" aria-live="polite">
            {pick.status || (pick.hover ? <><b>{shortName(pick.hover)}</b> · click to choose</>
              : p.region ? <>
                  <b>{shortName(p.region)}</b>
                  {p.time && <> · {formatRange(p.time)}</>}
                  {bars && z != null && p.time && <> · {bars.label} <b>{z < 0 ? "−" : "+"}{Math.abs(z).toFixed(1)}σ</b></>}
                  {overlay && <span className="text-on-space-2" title="Globe colours: the long-term trend of this variable, 1° cells, 2000–2025 (real NASA data). Blue = getting wetter, red = getting drier."> · trend map</span>}
                </>
              : "Click a basin, or search on the right")}
          </p>
        </div>
      </div>

      {/* ------------------------------------------------ the questions */}
      <div className="px-6 pt-10 pb-24 sm:px-10 lg:px-14">
        <div className="max-w-xl">
          {p.template && <p className="text-sm font-semibold text-[var(--viz-orange)]">Solved case</p>}
          <EventTitle value={p.event} onChange={p.onEventChange} onDone={p.onEventDone} />

          <Section n={0} refs={sectionRefs} title="Place." ask="Where did it happen?">
            <PlaceOptions {...p} />
          </Section>

          {reach >= 2 && (
            <Section n={1} refs={sectionRefs} title="Time." ask="When did it happen?">
              <TimeOptions {...p} bars={bars} />
            </Section>
          )}

          {reach >= 3 && (
            <Section n={2} refs={sectionRefs} title="Variables." ask="What should we check?">
              <VariableOptions {...p} />
            </Section>
          )}

          {allDone && (
            <section ref={(el) => { sectionRefs.current[3] = el; }} className="q-open mt-14 scroll-mt-6 rounded-[1.25rem] bg-well p-6">
              <h2 className="text-2xl">Your investigation</h2>
              <dl className="mt-4 divide-y divide-line text-[0.9375rem]">
                <Row k="Event" v={p.committedEvent || p.event} />
                <Row k="Place" v={p.region ? `${p.region.name} · ${formatArea(p.region.areaKm2)}` : "—"} />
                <Row k="Time" v={p.time ? formatRange(p.time) : "—"} />
                <Row k="Variables" v={p.picks.map((c) => CATEGORIES[c].name.en).join(", ")} />
              </dl>
              <button
                type="button"
                disabled={!!p.blocked || submitting}
                onClick={() => setSubmitting(true)}
                title={p.blocked ?? undefined}
                className="mt-6 w-full rounded-full bg-[var(--link)] py-3.5 text-lg font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                Submit
              </button>
            </section>
          )}
        </div>
      </div>

      {submitting && (
        <SubmitOverlay
          lines={[
            `Loading monthly records for ${p.region?.name ?? "the sub-basin"}`,
            "Removing the seasonal cycle",
            "Removing the long-term trend",
            `Testing ${p.time ? formatRange(p.time) : "the event"} against the baseline`,
            `Ranking ${p.picks.length} variable${p.picks.length === 1 ? "" : "s"}`,
          ]}
          onDone={p.onSubmit}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ layout pieces */

function Section({ n, refs, title, ask, children }: { n: number; refs: React.MutableRefObject<(HTMLElement | null)[]>; title: string; ask: string; children: ReactNode }) {
  return (
    <section ref={(el) => { refs.current[n] = el; }} className="q-open mt-14 scroll-mt-6 border-t border-line pt-10 first-of-type:mt-10">
      <h2 className="text-[1.75rem] leading-tight">
        {title} <span className="text-ink-3">{ask}</span>
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-4 py-2.5">
      <dt className="w-24 shrink-0 text-ink-3">{k}</dt>
      <dd className="min-w-0 font-semibold">{v}</dd>
    </div>
  );
}

/** An Apple-style option tile: rounded, hairline border, a thick blue border when chosen. */
function Tile({ on, disabled, onClick, children, title }: { on: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={on}
      className={`w-full rounded-[0.9rem] border px-4 py-3.5 text-left transition ${
        on ? "border-[var(--link)] shadow-[0_0_0_1px_var(--link)]" : "border-line hover:border-ink-3"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function EventTitle({ value, onChange, onDone }: { value: string; onChange: (s: string) => void; onDone: () => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      maxLength={300}
      autoComplete="off"
      aria-label="What do you want to study?"
      title="Click to edit"
      placeholder="What do you want to study?"
      className="mt-1 w-full bg-transparent font-display text-[2.5rem] leading-tight text-ink outline-none placeholder:text-ink-3 focus:underline focus:decoration-line focus:decoration-2 focus:underline-offset-8"
    />
  );
}

/* ------------------------------------------------------------------ Place */

function PlaceOptions(p: QuestionnaireProps) {
  const hints = useRegionHints(p.event, p.searchable, p.countryNames).slice(0, 4);
  const options = p.region && !hints.some((r) => r.id === p.region!.id) ? [p.region, ...hints.slice(0, 3)] : hints;
  return (
    <>
      <div className="space-y-2.5">
        {options.map((r) => (
          <Tile key={r.id} on={p.region?.id === r.id} onClick={() => p.onRegion(r)}>
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{shortName(r)}</span>
              <span className="text-sm text-ink-3 tnum">{formatArea(r.areaKm2)}</span>
            </span>
            {/\(.*\)$/.test(r.name) && <span className="block text-sm text-ink-3">{/\((.*)\)$/.exec(r.name)?.[1]}</span>}
          </Tile>
        ))}
      </div>
      <div className={`${options.length ? "mt-4" : ""} [&_input]:!rounded-[0.9rem] [&_input]:!border [&_input]:!border-line [&_input]:!bg-paper [&_input]:!shadow-none`}>
        <RegionSearchBox {...p} />
      </div>
      <div className="mt-2 text-sm">{p.regionNote}</div>
    </>
  );
}

/* ------------------------------------------------------------------ Time */

/** "20220701" → its month; null when not a real date */
function parseDay(s: string): { ym: string; d: number } | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(y, mo, 0).getDate()) return null;
  return { ym: `${m[1]}-${m[2]}`, d: y * 10000 + mo * 100 + d };
}
const firstDay = (ym: string) => `${ym.slice(0, 4)}${ym.slice(5, 7)}01`;
const lastDay = (ym: string) => `${ym.slice(0, 4)}${ym.slice(5, 7)}${String(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()).padStart(2, "0")}`;

function TimeOptions(p: QuestionnaireProps & { bars: ReturnType<typeof useIntervalAnomaly> }) {
  const [a, setA] = useState(p.time ? firstDay(p.time.start) : "");
  const [b, setB] = useState(p.time ? lastDay(p.time.end) : "");
  const [open, setOpen] = useState(false);
  // follow changes made with the timeline or the suggestion
  const key = p.time ? `${p.time.start}..${p.time.end}` : "";
  useEffect(() => {
    if (!p.time) return;
    if (parseDay(a)?.ym !== p.time.start) setA(firstDay(p.time.start));
    if (parseDay(b)?.ym !== p.time.end) setB(lastDay(p.time.end));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const commit = (sa: string, sb: string) => {
    const x = parseDay(sa), y = parseDay(sb);
    if (x && y && x.d <= y.d) p.onTimeChange({ start: x.ym, end: y.ym } as TimeRange);
  };
  const bad = (s: string) => s.length >= 8 && !parseDay(s);
  const order = !!(parseDay(a) && parseDay(b) && parseDay(a)!.d > parseDay(b)!.d);
  const offer = p.timeSuggestion && !(p.time && p.time.start === p.timeSuggestion.start && p.time.end === p.timeSuggestion.end) ? p.timeSuggestion : null;

  const field = (v: string, set: (s: string) => void, label: string, other: string, first: boolean) => (
    <label className={`flex-1 rounded-[0.9rem] border px-4 py-2.5 focus-within:border-[var(--link)] focus-within:shadow-[0_0_0_1px_var(--link)] ${bad(v) || order ? "border-[var(--status-critical)]" : "border-line"}`}>
      <span className="block text-xs text-ink-3">{label}</span>
      <input
        value={v}
        inputMode="numeric"
        placeholder="YYYYMMDD"
        maxLength={10}
        onChange={(e) => { const s = e.target.value.replace(/[^\d-]/g, ""); set(s); commit(first ? s : other, first ? other : s); }}
        className="w-full bg-transparent text-xl font-semibold tracking-wide text-ink outline-none tnum placeholder:font-normal placeholder:text-ink-3"
      />
    </label>
  );

  return (
    <>
      <div className="flex items-stretch gap-2">
        {field(a, setA, "From", b, true)}
        <span className="self-center text-ink-3" aria-hidden="true">–</span>
        {field(b, setB, "To", a, false)}
      </div>
      {offer && (
        <button type="button" onClick={() => p.onTimeChange(offer)} className="mt-3 text-sm font-semibold text-link hover:underline">
          Use {formatRange(offer)} from your description
        </button>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Monthly data: the analysis uses the whole months these days fall in."
        className="mt-4 flex w-full items-center justify-between rounded-[0.9rem] border border-line px-4 py-3 text-left hover:border-ink-3"
      >
        <span className="font-semibold">Pick on the timeline</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-500 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          {open && (
            <div className="pt-3 [--q-accent:var(--link)]">
              <TimePicker time={p.time} onChange={p.onTimeChange} bounds={p.bounds} padMonths={p.padMonths} suggestion={null} bars={p.bars} place={p.region?.name} compact />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Variables */

function VariableOptions(p: QuestionnaireProps) {
  const [all, setAll] = useState(false);
  const votes = new Map<CategoryId, CategoryVote>((p.response?.votes ?? []).map((v) => [v.category, v]));
  const on = new Set(p.checked);
  const ok = (c: CategoryId) => !p.available || p.available[c];
  const toggle = (c: CategoryId) => {
    const next = new Set(on);
    if (next.has(c)) next.delete(c); else next.add(c);
    p.onPicks(CATEGORY_IDS.filter((x) => next.has(x)));
  };
  // the suggested set is frozen once shown, so unticking a tile does not make it jump to the hidden list
  const [shownFirst, setShownFirst] = useState<CategoryId[] | null>(null);
  const live = CATEGORY_IDS.filter((c) => votes.get(c)?.selected || on.has(c));
  useEffect(() => { if (!shownFirst && live.length && !p.finding) setShownFirst(live); }, [live.length, p.finding, shownFirst]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggested = shownFirst ?? live;
  const rest = CATEGORY_IDS.filter((c) => !suggested.includes(c));

  if (p.finding && !suggested.length) {
    return <p className="flex items-center gap-3 text-ink-3"><span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-[var(--link)]" aria-hidden="true" /> Choosing variables for this event…</p>;
  }

  const tile = (c: CategoryId) => {
    const info = CATEGORIES[c];
    const v = votes.get(c);
    const pct = v && p.response?.source !== "keyword-fallback" ? Math.round(v.p * 100) : null;
    const chosen = ok(c) && on.has(c);
    return (
      <Tile key={c} on={chosen} disabled={!ok(c)} onClick={() => toggle(c)} title={ok(c) ? info.definition.en : "No data for this sub-basin"}>
        <span className="flex items-center gap-3">
          <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-ink-2">
            <path d={info.icon} />
          </svg>
          <span className="min-w-0 flex-1 font-semibold">{info.name.en}</span>
          {pct !== null && <span className="text-sm text-ink-3 tnum" title="Model's estimate that this variable is related">{pct}%</span>}
          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${chosen ? "border-[var(--link)] bg-[var(--link)]" : "border-line"}`} aria-hidden="true">
            {chosen && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
          </span>
        </span>
      </Tile>
    );
  };

  return (
    <>
      <div className="space-y-2.5">{suggested.map(tile)}</div>
      <button type="button" onClick={() => setAll((x) => !x)} aria-expanded={all} className="mt-4 text-sm font-semibold text-link hover:underline">
        {all ? "Show fewer" : `Show all ${CATEGORY_IDS.length} variables`}
      </button>
      <div className={`grid transition-[grid-template-rows] duration-500 ease-out ${all ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="grid gap-2.5 pt-3 sm:grid-cols-2">{rest.map(tile)}</div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ submit */

function SubmitOverlay({ lines, onDone }: { lines: string[]; onDone: () => void }) {
  const [k, setK] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = reduced ? 150 : 520;
    const timers = lines.map((_, i) => window.setTimeout(() => setK(i + 1), step * (i + 1)));
    timers.push(window.setTimeout(() => doneRef.current(), step * (lines.length + 1)));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [lines.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = Math.round((k / lines.length) * 100);
  return (
    <div role="status" aria-live="polite" className="fade-in fixed inset-0 z-50 grid place-items-center px-4 backdrop-blur-md" style={{ background: "color-mix(in srgb, var(--space) 94%, transparent)" }}>
      <div className="w-full max-w-md text-on-space">
        <div className="mx-auto mb-8 h-16 w-16 animate-spin rounded-full border-4 border-space-line border-t-[var(--action)]" aria-hidden="true" />
        <p className="text-center font-display text-3xl">Submitting your investigation</p>
        <ul className="mt-6 space-y-2">
          {lines.map((l, i) => (
            <li key={l} className={`flex items-center gap-3 transition-opacity duration-300 ${i <= k ? "opacity-100" : "opacity-30"}`}>
              <span className="grid h-5 w-5 place-items-center" aria-hidden="true">
                {i < k ? "✓" : i === k ? <span className="h-2 w-2 animate-pulse rounded-full bg-action" /> : <span className="h-1.5 w-1.5 rounded-full bg-white/40" />}
              </span>
              <span className="text-on-space-2">{l}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-action transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
