"use client";
// /detective: the whole Trend Detective flow (workstream C).
//   Step 0  InputPanel     What, When, Where (1-3) (or a preset, which skips straight to the tabs)
//   Step 1  VariablePicker (4) AI / keyword vote per category -> checkboxes
//   Step 2  "Start"        analysis in the browser (A) for every ticked category
//   Step 3  analysis       AnalysisView: stacked lanes, one expanded (workbench/*)
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
import { RetryButton, StatusCard } from "@/components/ui/StatusCard";
import { InputPanel } from "./InputPanel";
import { VariablePicker } from "./VariablePicker";
import { CATEGORIES, PRESETS, requestVotes } from "./wiring";
import AnalysisView from "./AnalysisView";
import { COPY } from "./copy/input";
import { NO_LAYERS, msg, writeUrl } from "./appShared";

/* ------------------------------------------------------------------ small async helper */

type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

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
        <Note>{COPY.where.rejected(url.rejectedRegion)}</Note>
      )}
      {q.region && catalog && !regionOk && <Note>{COPY.where.notInCatalog(q.region)}</Note>}
      {noData && <Note>{COPY.where.noData}</Note>}
      {catalogError && (
        <p className="mt-1 text-sm text-ink-2">
          {COPY.where.catalogFailed} <button type="button" onClick={onRetryCatalog} className="font-semibold text-link underline">{COPY.where.retry}</button>
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
    ? COPY.blocked.finding
    : !vc || !index
      ? COPY.blocked.loading
      : !q.time
        ? COPY.blocked.time
        : !q.region
          ? COPY.blocked.region
          : noData
            ? COPY.blocked.noData
            : !startable.length
              ? COPY.blocked.none
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
    <div data-stage-area data-stage-through data-stage-pass className="on-stage stage-sky">
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
        hasPicker={showPicker}
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
