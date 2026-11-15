"use client";
// /detective: the whole Trend Detective flow (workstream C).
//   Step 0  InputPanel     event E, period T, sub-basin L (or a preset, which skips straight to the tabs)
//   Step 1  VariablePicker AI / keyword vote per category -> checkboxes
//   Step 2  "Start"        analysis in the browser (A) for every ticked category
//   Step 3  tabs           one VariableTab (B) per category
// All state lives in the URL (lib/detective/url.ts): a link with r + t + v opens the tabs directly, a reload keeps
// everything, Back returns from the tabs to the inputs. Other workstreams are reached only through ./wiring.ts.
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Catalog, Region } from "@/lib/types";
import type {
  CategoryId, Decomposition, DetectiveQuery, IntervalStats, LayerId, MonthlySeries, PresetEvent,
  RegionId, SelectResponse, TimeRange, TrendStats,
} from "@/lib/detective/contracts";
import { loadCatalog } from "@/lib/data";
import {
  CATEGORY_IDS, DEFAULT_PAD, PAD_MAX, PAD_MIN, decodeState, encodeState, formatRange,
  sameRange, suggestTime, ymIndex, type DetectiveUrlState,
} from "@/lib/detective/url";
import {
  categoryAvailability, loadCountryNames, loadSeries, loadSeriesIndex, loadVariableCatalog, type VariableCatalog,
} from "@/lib/detective/series";
import { RetryButton, StatusCard } from "@/components/explore/StatusCard";
import { InputPanel } from "./InputPanel";
import { VariablePicker } from "./VariablePicker";
import { CATEGORIES, PRESETS, VariableTab, analysis, requestVotes, variableMetadata, type VariableMeta } from "./wiring";

/* ------------------------------------------------------------------ small async helper */

type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** run `make` once (and again on retry); the loaders cache, so several components may share one */
function useLoad<T>(make: () => Promise<T>): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const makeRef = useRef(make);
  useEffect(() => {
    let live = true;
    makeRef.current().then(
      (data) => live && setState({ status: "ready", data }),
      (e: unknown) => live && setState({ status: "error", message: msg(e) }),
    );
    return () => { live = false; };
  }, [attempt]);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((a) => a + 1); }, []);
  return [state, retry];
}
const ready = <T,>(l: Load<T>): T | null => (l.status === "ready" ? l.data : null);


/* ------------------------------------------------------------------ URL writes */

type UrlPatch = (s: DetectiveUrlState) => { query: Partial<DetectiveQuery>; draft?: CategoryId[] | null };

/** Apply a patch to the URL as it is now. "push" for steps (so Back works), "replace" for edits within a step. */
function writeUrl(patch: UrlPatch, how: "push" | "replace" = "replace") {
  const cur = decodeState(window.location.search);
  const qs = encodeState(patch(cur));
  const href = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  if (href === `${window.location.pathname}${window.location.search}`) return;
  if (how === "push") window.history.pushState(null, "", href);
  else window.history.replaceState(null, "", href);
}

const FALLBACK_BOUNDS: TimeRange = { start: "2000-01", end: "2026-12" };

/** the months the time picker offers: the span of the default layers (sea surface temperature aside) */
function timeBounds(vc: VariableCatalog | null): TimeRange {
  if (!vc) return FALLBACK_BOUNDS;
  const ls = CATEGORY_IDS.filter((c) => c !== "sst").map((c) => vc.defaults[c]).filter((l): l is LayerId => !!l).map((l) => vc.layers[l]).filter((l) => l.temporalResolution === "monthly");
  if (!ls.length) return FALLBACK_BOUNDS;
  const start = ls.reduce((m, l) => (ymIndex(l.start) < ymIndex(m) ? l.start : m), ls[0].start);
  const end = ls.reduce((m, l) => (ymIndex(l.end) > ymIndex(m) ? l.end : m), ls[0].end);
  return { start: `${start.slice(0, 4)}-01`, end: `${end.slice(0, 4)}-12` };
}

const presetFor = (q: Partial<DetectiveQuery>): PresetEvent | undefined =>
  PRESETS.find((p) => p.event === q.event && p.region === q.region && sameRange(p.time, q.time));

/** one shared empty set, so memos keyed on "layers of this region" stay stable for regions without a series */
const NO_LAYERS: ReadonlySet<LayerId> = new Set();

/* ================================================================== the app */

export default function DetectiveApp() {
  const sp = useSearchParams();
  const search = sp.toString();
  const url = useMemo(() => decodeState(search), [search]);
  const q = url.query;

  const [vcLoad, retryVc] = useLoad(loadVariableCatalog);
  const [indexLoad, retryIndex] = useLoad(loadSeriesIndex);
  const [catalogLoad, retryCatalog] = useLoad(loadCatalog);
  const vc = ready(vcLoad);
  const index = ready(indexLoad);
  const catalog = ready(catalogLoad);

  const dataError = [vcLoad, indexLoad].find((l): l is { status: "error"; message: string } => l.status === "error");
  if (dataError) {
    return (
      <Stage>
        <StatusCard className="mx-auto max-w-xl" title="The Trend Detective data did not load" action={<RetryButton onClick={() => { retryVc(); retryIndex(); }} />}>
          <p>{dataError.message}</p>
        </StatusCard>
      </Stage>
    );
  }

  const analysing = !!(q.region && q.time && q.categories?.length);
  return (
    <>
      {analysing ? (
        <AnalysisView query={q as DetectiveQuery} vc={vc} index={index} catalog={catalog} />
      ) : (
        <InputStage url={url} vc={vc} index={index} catalog={catalog} catalogError={catalogLoad.status === "error" ? catalogLoad.message : null} onRetryCatalog={retryCatalog} />
      )}
    </>
  );
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="on-stage stage-sky min-h-[60dvh]">
      <div className="mx-auto max-w-[90rem] px-4 pt-6 pb-12 sm:px-6 lg:px-8">{children}</div>
    </div>
  );
}

/* ================================================================== Step 0 + Step 1 */

function InputStage({
  url, vc, index, catalog, catalogError, onRetryCatalog,
}: {
  url: DetectiveUrlState;
  vc: VariableCatalog | null;
  index: Map<RegionId, ReadonlySet<LayerId>> | null;
  catalog: Catalog | null;
  catalogError: string | null;
  onRetryCatalog: () => void;
}) {
  const q = url.query;
  const [countryLoad] = useLoad(loadCountryNames);

  /* ---------------- E: typed locally, written to the URL after a pause */
  const urlEvent = q.event ?? "";
  const [eventText, setEventText] = useState(urlEvent);
  const synced = useRef(urlEvent);
  const currentEvent = useRef(urlEvent);
  const [vote, setVote] = useState<{ event: string; response: SelectResponse } | null>(null);
  const [finding, setFinding] = useState(false);
  const findCtl = useRef<AbortController | null>(null);
  const picksTouched = useRef(false);
  const reasked = useRef<string | null>(null);
  const timeTouched = useRef(!!q.time);
  const pending = useRef<number | null>(null);

  const cancelRequest = useCallback(() => {
    findCtl.current?.abort();
    findCtl.current = null;
    setFinding(false);
  }, []);
  useEffect(() => () => {
    findCtl.current?.abort();
    reasked.current = null;
  }, []);
  useEffect(() => {
    const onBack = () => {
      cancelRequest();
      if (pending.current != null) { window.clearTimeout(pending.current); pending.current = null; }
      const next = decodeState(window.location.search).query;
      currentEvent.current = next.event ?? "";
      synced.current = currentEvent.current;
      reasked.current = null;
      timeTouched.current = !!next.time;
      setEventText(currentEvent.current);
      setVote(null);
    };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, [cancelRequest]);

  useEffect(() => {
    // follow the URL when it changes from outside (a preset, Back, an edited link)
    if (urlEvent !== synced.current) {
      synced.current = urlEvent;
      currentEvent.current = urlEvent;
      timeTouched.current = !!q.time;
      reasked.current = null;
      if (pending.current != null) { window.clearTimeout(pending.current); pending.current = null; }
      cancelRequest();
      setVote(null);
      setEventText(urlEvent);
    }
  }, [urlEvent, q.time, cancelRequest]);

  const onEventChange = (text: string) => {
    currentEvent.current = text.trim();
    reasked.current = text.trim();
    cancelRequest();
    setVote(null);
    setEventText(text);
  };

  /** the period picker wins over the text: once the user (or a link) set T, typing no longer changes it */
  const commitEvent = useCallback((text: string) => {
    if (pending.current != null) { window.clearTimeout(pending.current); pending.current = null; }
    const e = text.trim();
    synced.current = e;
    const auto = timeTouched.current ? null : suggestTime(e);
    writeUrl((s) => ({ query: { ...s.query, event: e || undefined, time: auto ?? s.query.time }, draft: s.draft }));
  }, []);
  useEffect(() => {
    if (eventText.trim() === (decodeState(window.location.search).query.event ?? "")) return;
    pending.current = window.setTimeout(() => commitEvent(eventText), 350);
    return () => { if (pending.current != null) window.clearTimeout(pending.current); };
  }, [eventText, commitEvent]);

  /* ---------------- T */
  const bounds = useMemo(() => {
    const b = timeBounds(vc);
    const t = q.time;
    if (!t) return b;
    return {
      start: ymIndex(t.start) < ymIndex(b.start) ? `${t.start.slice(0, 4)}-01` : b.start,
      end: ymIndex(t.end) > ymIndex(b.end) ? `${t.end.slice(0, 4)}-12` : b.end,
    };
  }, [vc, q.time]);
  const onTimeChange = useCallback((next: TimeRange | ((current: TimeRange | null) => TimeRange)) => {
    timeTouched.current = true;
    writeUrl((s) => ({ query: { ...s.query, time: typeof next === "function" ? next(s.query.time ?? null) : next }, draft: s.draft }));
  }, []);

  /* ---------------- L */
  const region = q.region && catalog ? catalog.byId.get(q.region) ?? null : null;
  const regionOk = region?.type === "basin4" ? region : null;
  const layersHere = q.region && index ? index.get(q.region) ?? NO_LAYERS : null;
  const avail = useMemo(() => (vc && layersHere ? categoryAvailability(vc, layersHere, q.layers) : null), [vc, layersHere, q.layers]);
  const available = useMemo(
    () => (avail ? Object.fromEntries(CATEGORY_IDS.map((c) => [c, avail.layer[c] !== null])) as Record<CategoryId, boolean> : null),
    [avail],
  );
  const searchable = useMemo(
    () => (catalog && index ? catalog.regions.filter((r) => r.type === "basin4" && index.has(r.id)) : null),
    [catalog, index],
  );
  const onRegion = useCallback((r: Region) => {
    writeUrl((s) => ({ query: { ...s.query, region: r.id }, draft: s.draft }));
  }, []);
  const noData = !!(q.region && layersHere && layersHere.size === 0);
  const regionNote = (
    <>
      {url.rejectedRegion && (
        <Note>The link asked for “{url.rejectedRegion}”, which is not a sub-basin id (b4-…). Choose a sub-basin.</Note>
      )}
      {q.region && catalog && !regionOk && <Note>Sub-basin {q.region} is not in the region catalogue. Choose another one.</Note>}
      {noData && <Note>This sub-basin has no monthly series. Choose a neighbouring one.</Note>}
      {catalogError && (
        <p className="mt-1 text-sm text-ink-2">
          The globe catalogue did not load. <button type="button" onClick={onRetryCatalog} className="font-semibold text-link underline">Try again</button>
        </p>
      )}
    </>
  );

  /* ---------------- Step 1 */
  const draft = url.draft ?? (q.categories?.length ? q.categories : null);

  const ask = useCallback(async (e: string, applyPicks: boolean) => {
    findCtl.current?.abort();
    const ctl = new AbortController();
    findCtl.current = ctl;
    picksTouched.current = false;
    setFinding(true);
    try {
      const response = await requestVotes(e, ctl.signal);
      if (ctl.signal.aborted || currentEvent.current !== e || decodeState(window.location.search).query.event !== e) return;
      setVote({ event: e, response });
      if (applyPicks && !picksTouched.current) {
        const picks = response.votes.filter((v) => v.selected).map((v) => v.category);
        const auto = !timeTouched.current && response.suggestedTime ? response.suggestedTime : null;
        writeUrl((s) => ({ query: { ...s.query, event: e, time: auto ?? s.query.time }, draft: picks }));
      }
    } catch {
      // aborted by a newer request or by leaving the page
    } finally {
      if (findCtl.current === ctl) { setFinding(false); findCtl.current = null; }
    }
  }, []);

  const onFind = () => {
    const e = eventText.trim();
    if (!e) return;
    commitEvent(e);
    void ask(e, true);
  };

  // a reload (or Back) in Step 1 keeps the user's ticks from the URL; ask again only to show the probabilities
  useEffect(() => {
    if (reasked.current === urlEvent || vote || finding || draft === null || !urlEvent || currentEvent.current !== urlEvent) return;
    reasked.current = urlEvent;
    void ask(urlEvent, false);
  }, [vote, finding, draft, urlEvent, ask]);

  const onPicks = (c: CategoryId[]) => {
    picksTouched.current = true;
    writeUrl((s) => ({ query: s.query, draft: c }));
  };

  const startable = (draft ?? []).filter((c) => !available || available[c]);
  const blocked = finding
    ? "Waiting for the variable suggestions."
    : !vc || !index
      ? "Loading available variables."
      : !q.time
        ? "Choose when it happened."
        : !q.region
          ? "Choose a sub-basin."
          : noData
            ? "This sub-basin has no data."
            : !startable.length
              ? "Tick at least one variable."
              : null;
  const onStart = () => {
    if (blocked) return;
    if (eventText.trim() !== urlEvent) commitEvent(eventText);
    writeUrl((s) => ({ query: { ...s.query, categories: startable, active: startable[0] }, draft: null }), "push");
    window.scrollTo({ top: 0 });
  };

  const onPreset = (p: PresetEvent) => {
    cancelRequest();
    timeTouched.current = true;
    if (pending.current != null) { window.clearTimeout(pending.current); pending.current = null; }
    writeUrl(() => ({
      query: {
        event: p.event, time: p.time, region: p.region, categories: p.categories, layers: p.layers,
        padMonths: p.padMonths, active: p.active ?? p.categories[0],
      },
      draft: null,
    }), "push");
    window.scrollTo({ top: 0 });
  };

  const showPicker = draft !== null || finding || !!vote;
  return (
    <div className="on-stage stage-sky">
      <InputPanel
        event={eventText}
        onEventChange={onEventChange}
        presets={PRESETS}
        onPreset={onPreset}
        time={q.time ?? null}
        onTimeChange={onTimeChange}
        timeSuggestion={suggestTime(eventText)}
        bounds={bounds}
        padMonths={q.padMonths ?? DEFAULT_PAD}
        catalog={catalog}
        catalogError={catalogError}
        searchable={searchable}
        countryNames={ready(countryLoad)}
        region={regionOk}
        regionNote={regionNote}
        onRegion={onRegion}
        onFind={onFind}
        finding={finding}
      >
        {showPicker && (
          <VariablePicker
            categories={CATEGORIES}
            response={vote?.event === eventText.trim() ? vote.response : null}
            loading={finding}
            checked={draft ?? []}
            onChange={onPicks}
            available={available}
            unavailableReason={avail?.unavailableReason}
            onStart={onStart}
            blocked={blocked}
          />
        )}
      </InputPanel>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="mt-1.5 border-l-4 border-[color:var(--status-warning)] bg-paper py-1 pr-2 pl-3 text-sm text-ink-2">
      {children}
    </p>
  );
}

/* ================================================================== Step 2 + Step 3 */

type TabResult =
  | { kind: "loading" }
  | { kind: "nodata" }
  | { kind: "error"; message: string }
  | { kind: "ready"; meta: VariableMeta; decomposition: Decomposition; eventStats: IntervalStats; trend: TrendStats; outside: boolean };

const PAD_CHOICES = [3, 6, 12, 24, 36, 60];

function AnalysisView({
  query: q, vc, index, catalog,
}: {
  query: DetectiveQuery;
  vc: VariableCatalog | null;
  index: Map<RegionId, ReadonlySet<LayerId>> | null;
  catalog: Catalog | null;
}) {
  const pad = q.padMonths ?? DEFAULT_PAD;
  const cats = q.categories;
  const active = q.active && cats.includes(q.active) ? q.active : cats[0];
  const regionName = catalog?.byId.get(q.region)?.name ?? q.region;
  const expected = presetFor(q)?.expected ?? {};

  /* ---------------- which layer per tab */
  const layersHere = index ? index.get(q.region) ?? NO_LAYERS : null;
  const avail = useMemo(() => (vc && layersHere ? categoryAvailability(vc, layersHere, q.layers) : null), [vc, layersHere, q.layers]);
  const layerKey = avail ? cats.map((c) => `${c}:${avail.layer[c] ?? "-"}`).join(",") : "";

  /* ---------------- load every tab's series (one file per sub-basin, cached) */
  const [series, setSeries] = useState<{ key: string; byCat: Partial<Record<CategoryId, MonthlySeries | Error | null>> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadKey = `${q.region}|${layerKey}|${attempt}`;
  useEffect(() => {
    if (!avail) return;
    let live = true;
    Promise.all(
      cats.map(async (c) => {
        const layer = avail.layer[c];
        if (!layer) return [c, null] as const;
        try { return [c, await loadSeries(q.region, layer)] as const; } catch (e) { return [c, e instanceof Error ? e : new Error(msg(e))] as const; }
      }),
    ).then((rows) => { if (live) setSeries({ key: loadKey, byCat: Object.fromEntries(rows) }); });
    return () => { live = false; };
    // loadKey covers the region, the layer of every tab and retries
  }, [loadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- run A on each */
  const trends = useMemo(() => {
    const out: Partial<Record<CategoryId, TrendStats>> = {};
    if (series?.key !== loadKey) return out;
    for (const c of cats) { const s = series.byCat[c]; if (s && !(s instanceof Error)) out[c] = analysis.trendStats(s); }
    return out;
  }, [series, loadKey, cats]);

  const results = useMemo(() => {
    const out = {} as Record<CategoryId, TabResult>;
    for (const c of cats) {
      if (!vc || !avail || series?.key !== loadKey) { out[c] = { kind: "loading" }; continue; }
      const s = series.byCat[c];
      const layer = avail.layer[c];
      if (!s || !layer) { out[c] = { kind: "nodata" }; continue; }
      if (s instanceof Error) { out[c] = { kind: "error", message: s.message }; continue; }
      const info = vc.layers[layer];
      const meta = variableMetadata(info, s.unit || info.unit);
      try {
        const decomposition = analysis.decompose(s, q.time, pad);
        const eventStats = analysis.intervalStats(decomposition, q.time);
        const first = ymIndex(s.start), last = first + s.values.length - 1;
        const outside = ymIndex(q.time.end) < first || ymIndex(q.time.start) > last;
        out[c] = { kind: "ready", meta, decomposition, eventStats, trend: trends[c] ?? analysis.trendStats(s), outside };
      } catch (e) {
        out[c] = { kind: "error", message: `${meta.product}: ${msg(e)}` };
      }
    }
    return out;
  }, [cats, vc, avail, series, loadKey, q.time, pad, trends]);

  /* ---------------- URL edits */
  const setTab = (c: CategoryId) => writeUrl((s) => ({ query: { ...s.query, active: c } }));
  const setLayer = (c: CategoryId, l: LayerId) =>
    writeUrl((s) => {
      const layers = { ...(s.query.layers ?? {}) };
      if (vc?.defaults[c] === l) delete layers[c]; else layers[c] = l;
      return { query: { ...s.query, layers } };
    });
  const setPad = (n: number) => writeUrl((s) => ({ query: { ...s.query, padMonths: n } }));
  const onEdit = () => writeUrl((s) => ({ query: { ...s.query, categories: undefined, active: undefined }, draft: s.query.categories ?? [] }), "push");

  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }, () => {});
  };

  const tabRefs = useRef<Partial<Record<CategoryId, HTMLButtonElement | null>>>({});
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = cats.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(cats[to]);
    tabRefs.current[cats[to]]?.focus();
  };

  const r = results[active];
  const choices = avail?.choices[active] ?? [];
  const allNoData = cats.every((c) => results[c].kind === "nodata");
  const padOptions = PAD_CHOICES.includes(pad) ? PAD_CHOICES : [...PAD_CHOICES, pad].sort((a, b) => a - b);

  return (
    <>
      <div className="on-stage stage-sky">
        <div className="mx-auto max-w-[90rem] px-4 pt-4 pb-6 sm:px-6 lg:px-8 lg:pt-6">
          <button type="button" onClick={onEdit} className="rounded-ctl text-sm text-on-stage-2 underline underline-offset-2 hover:text-on-stage hover:no-underline">
            ← Edit event, period, place or variables
          </button>
          <h1 className="mt-2 text-[1.75rem] leading-tight break-words sm:text-[2.25rem]">{q.event || "Untitled event"}</h1>
          <p className="mt-1 text-on-stage-2">
            <span className="font-semibold text-on-stage">{formatRange(q.time)}</span> · {regionName}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-on-stage-2">
              Show
              <select
                value={pad}
                onChange={(e) => setPad(Number(e.target.value))}
                className="rounded-ctl border border-stage-line bg-stage px-2.5 py-1 text-on-stage"
              >
                {padOptions.filter((n) => n >= PAD_MIN && n <= PAD_MAX).map((n) => <option key={n} value={n}>± {n} months</option>)}
              </select>
              around the event
            </label>
            <button type="button" onClick={copy} className="rounded-ctl border border-stage-line px-3 py-1 font-semibold hover:bg-stage-line">
              {copied ? "Link copied" : "Copy link"}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-8">
        {allNoData ? (
          <StatusCard title="No monthly data for these variables" action={<button type="button" onClick={onEdit} className="rounded-ctl bg-action px-4 py-2 font-semibold text-on-action hover:bg-action-hover">Edit variables or sub-basin</button>}>
            <p>{regionName} has no monthly series eligible for analysis among the chosen variables.</p>
            {cats.map((c) => avail?.unavailableReason[c] && <p key={c}>{CATEGORIES[c].name.en}: {avail.unavailableReason[c]}</p>)}
          </StatusCard>
        ) : (
          <>
            <div role="tablist" aria-label="Variables" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
              {cats.map((c, i) => {
                const res = results[c];
                const z = res.kind === "ready" ? res.eventStats.meanZ : null;
                const on = c === active;
                return (
                  <button
                    key={c}
                    ref={(el) => { tabRefs.current[c] = el; }}
                    type="button"
                    role="tab"
                    id={`tab-${c}`}
                    aria-selected={on}
                    aria-controls={`panel-${c}`}
                    tabIndex={on ? 0 : -1}
                    onClick={() => setTab(c)}
                    onKeyDown={(e) => onTabKey(e, i)}
                    className={`-mb-px shrink-0 rounded-t-card border-b-3 px-4 py-2 text-left whitespace-nowrap ${on ? "border-link font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
                  >
                    {CATEGORIES[c].name.en}
                    {z != null && <span className="ml-2 text-xs text-ink-3 tnum">z {z >= 0 ? "+" : "−"}{Math.abs(z).toFixed(1)}</span>}
                    {res.kind === "nodata" && <span className="ml-2 text-xs text-ink-3">no monthly data</span>}
                  </button>
                );
              })}
            </div>

            <section role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="pt-5" tabIndex={0}>
              {choices.length > 1 && vc && (
                <label className="mb-4 flex flex-wrap items-center gap-2 text-sm text-ink-2">
                  Data product
                  <select
                    value={avail?.layer[active] ?? ""}
                    onChange={(e) => setLayer(active, e.target.value)}
                    className="max-w-full rounded-ctl border border-line bg-paper px-3 py-1.5 text-ink"
                  >
                    {choices.map((l) => (
                      <option key={l} value={l}>
                        {vc.layers[l].product}{l === vc.defaults[active] ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {r.kind === "loading" && <StatusCard busy title={`Loading ${CATEGORIES[active].name.en.toLowerCase()}…`} />}
              {r.kind === "nodata" && (
                <StatusCard title={`No ${CATEGORIES[active].name.en.toLowerCase()} series here`}>
                  <p>{avail?.unavailableReason[active] ?? `${regionName} has no ${CATEGORIES[active].name.en.toLowerCase()} data in the bundle. Missing data is not zero.`}</p>
                </StatusCard>
              )}
              {r.kind === "error" && (
                <StatusCard title="This variable could not be analysed" action={<RetryButton onClick={() => setAttempt((a) => a + 1)} />}>
                  <p>{r.message}</p>
                  <p>Usually there is not enough data outside the event to fit the seasonal cycle and trend. Try another data product or a shorter window.</p>
                </StatusCard>
              )}
              {r.kind === "ready" && (
                <>
                  {r.outside && (
                    <p role="status" className="mb-4 border-l-4 border-[color:var(--status-warning)] bg-well py-1.5 pr-2 pl-3 text-sm text-ink-2">
                      {r.meta.product} covers {r.decomposition.months[0]} to {r.decomposition.months[r.decomposition.months.length - 1]}, so it has no data for {formatRange(q.time)}.
                      {choices.length > 1 ? " Try another data product." : ""}
                    </p>
                  )}
                  <VariableTab
                    key={`${q.region}:${q.event}:${q.time.start}:${q.time.end}:${pad}:${active}:${r.meta.layer}`}
                    meta={r.meta}
                    d={r.decomposition}
                    event={q.time}
                    padMonths={pad}
                    trend={r.trend}
                    intervalStats={analysis.intervalStats}
                    expected={expected[active]}
                  />
                </>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
