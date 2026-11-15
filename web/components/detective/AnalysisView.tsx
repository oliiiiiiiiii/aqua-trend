"use client";
// Step 2 + Step 3 of /detective: run the analysis for every chosen category and show the workbench
// (docs/ux-refresh.md): stage header, sticky selection + window toolbar, the variable dropdown (every variable's
// sparkline and numbers for the shared selection), and the chosen variable with the crystal ball, the chart (the
// daily anomaly around the selection in a days or weeks window) and the statistics.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import type { Catalog } from "@/lib/types";
import type { CategoryId, DetectiveQuery, LayerId, MonthlySeries, RegionId, TrendStats } from "@/lib/detective/contracts";
import { DEFAULT_PAD, decodeState, formatRange, windowOf, ymIndex } from "@/lib/detective/url";
import { isDailyWindow, windowLabel, workbenchView, type ViewWindow } from "@/lib/detective/window";
import { categoryAvailability, loadSeries, type VariableCatalog } from "@/lib/detective/series";
import { baselineInfo, intervalDetail, type IntervalDetail } from "@/lib/detective/intervalDetail";
import { anomalyPolarity } from "@/lib/detective/polarity";
import { Segmented } from "@/components/ui/Segmented";
import { StatusCard } from "@/components/ui/StatusCard";
import { downloadText } from "@/components/ui/download";
import { CATEGORIES, analysis, variableMetadata } from "./wiring";
import { NO_LAYERS, msg, presetFor, writeUrl } from "./appShared";
import { COPY } from "./workbench/copy";
import { clampSpan, orderLanes, resizeSpan, selectionLabel, shiftSpan, toRange, toSpan, type Span } from "./workbench/model";
import type { LaneModel, LaneResult } from "./workbench/types";
import { ExpandedLane, type Shared } from "./workbench/Lanes";
import { StageHeader, Toolbar } from "./workbench/Toolbar";
import { selectionCsv } from "./workbench/csv";
import type { FetchMore, LabControl } from "./workbench/lab/TestsPanel";
import { dayNum, dayStr } from "@/lib/detective/fine";
import { DEFAULT_TEST, type TestId } from "./workbench/lab/tests";
import VariableSelect from "./picker/VariableSelect";
import { itemsFromLanes } from "./picker/fromLanes";
import WindowControl from "./window/WindowControl";
import BaselinePadControl from "./window/BaselinePadControl";
import DailyView from "./daily/DailyView";
import { FineStats } from "./daily/FineStats";
import { useFineModel, type BaselineKind } from "./daily/useFineModel";
import { COPY as COPY_DAILY } from "./copy/daily";
import { pointAxis } from "./workbench/lab/step";
import type { LabOverlay } from "./workbench/lab/tests";

const KEY_COMMIT_MS = 450;

export default function AnalysisView({
  query: q, vc, index, catalog,
}: {
  query: DetectiveQuery;
  vc: VariableCatalog | null;
  index: Map<RegionId, ReadonlySet<LayerId>> | null;
  catalog: Catalog | null;
}) {
  const pad = q.padMonths ?? DEFAULT_PAD;
  const catsKey = q.categories.join(",");
  const cats = useMemo(() => catsKey.split(",") as CategoryId[], [catsKey]);
  const active = q.active && cats.includes(q.active) ? q.active : cats[0];
  const regionName = catalog?.byId.get(q.region)?.name ?? q.region;
  const expected = presetFor(q)?.expected ?? {};
  const { start: tStart, end: tEnd } = q.time;
  const evKey = `${tStart}..${tEnd}`;
  const event = useMemo(() => toSpan({ start: tStart, end: tEnd }), [tStart, tEnd]);

  /* ---------------- which layer per lane */
  const layersHere = index ? index.get(q.region) ?? NO_LAYERS : null;
  const layersKey = JSON.stringify(q.layers ?? {});
  const avail = useMemo(
    () => (vc && layersHere ? categoryAvailability(vc, layersHere, JSON.parse(layersKey)) : null),
    [vc, layersHere, layersKey],
  );
  const layerKey = avail ? cats.map((c) => `${c}:${avail.layer[c] ?? "-"}`).join(",") : "";

  /* ---------------- load every lane's series (one file per sub-basin, cached) */
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
    // loadKey covers the region, the layer of every lane and retries
  }, [loadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- run the analysis once per series / event / pad */
  const trends = useMemo(() => {
    const out: Partial<Record<CategoryId, TrendStats>> = {};
    if (series?.key !== loadKey) return out;
    for (const c of cats) { const s = series.byCat[c]; if (s && !(s instanceof Error)) out[c] = analysis.trendStats(s); }
    return out;
  }, [series, loadKey, cats]);

  const results = useMemo(() => {
    const out = {} as Record<CategoryId, LaneResult>;
    const time = { start: tStart, end: tEnd };
    for (const c of cats) {
      if (!vc || !avail || series?.key !== loadKey) { out[c] = { kind: "loading" }; continue; }
      const s = series.byCat[c];
      const layer = avail.layer[c];
      if (!s || !layer) { out[c] = { kind: "nodata", reason: avail.unavailableReason[c] ?? null }; continue; }
      if (s instanceof Error) { out[c] = { kind: "error", message: s.message }; continue; }
      const info = vc.layers[layer];
      const meta = variableMetadata(info, s.unit || info.unit);
      try {
        const d = analysis.decompose(s, time, pad);
        const base = ymIndex(d.months[0]);
        const record = { s: base, e: base + d.months.length - 1 };
        out[c] = {
          kind: "ready", meta, d, base, record,
          baseline: baselineInfo(d),
          trend: trends[c] ?? analysis.trendStats(s),
          outside: ymIndex(tEnd) < record.s || ymIndex(tStart) > record.e,
        };
      } catch (e) {
        out[c] = { kind: "error", message: `${meta.product}: ${msg(e)}` };
      }
    }
    return out;
  }, [cats, vc, avail, series, loadKey, tStart, tEnd, pad, trends]);

  /* ---------------- window (URL `win`; older links set it with `pad`) — what is shown, never the baseline */
  const params = useSearchParams();
  const [win, setWinState] = useState<ViewWindow>(() => windowOf(decodeState(params.toString())));
  const winRef = useRef(win);
  winRef.current = win;
  const recordUnion = useMemo(() => {
    let r: Span | null = null;
    for (const c of cats) { const x = results[c]; if (x.kind === "ready") r = r ? { s: Math.min(r.s, x.record.s), e: Math.max(r.e, x.record.e) } : x.record; }
    return r;
  }, [cats, results]);

  /* ---------------- the shared selection (URL `sel`, else the event) */
  const urlSel = useMemo(() => decodeState(params.toString()).selection ?? null, [params]);
  const [selState, setSelState] = useState<{ key: string; span: Span }>(() => ({ key: evKey, span: urlSel ? toSpan(urlSel) : event }));
  const selRaw = selState.key === evKey ? selState.span : urlSel ? toSpan(urlSel) : event;
  // months and years show the event ± n; days and weeks (the daily chart) also reach around the selection, so it is kept
  const view = useMemo(() => workbenchView(win, event, { s: selRaw.s, e: selRaw.e }, recordUnion), [win, event, selRaw.s, selRaw.e, recordUnion]);
  const sel = clampSpan(selRaw, view, event);
  const [sortSpan, setSortSpan] = useState<Span | null>(null);

  // writes keep the selection unless one is given (`null` removes it) and always carry the current window
  const urlWith = useCallback((fn: (q: Partial<DetectiveQuery>) => Partial<DetectiveQuery>, selection?: Span | null) => {
    writeUrl((s) => ({
      query: fn(s.query), selection: selection === undefined ? s.selection : selection ? toRange(selection) : undefined,
      // a new month selection also resets the daily view's own selection of days
      daySelection: selection === undefined ? s.daySelection : undefined,
      test: s.test, window: winRef.current,
    }));
  }, []);

  /* ---------------- Tests: the picked test is shared by every variable and kept in the URL `test` (picking does not run
     it; the user presses Analyse) */
  const [labTest, setLabTest] = useState<TestId>(() => decodeState(params.toString()).test ?? DEFAULT_TEST);
  const [labWhole, setLabWhole] = useState(false);
  const lab: LabControl = {
    test: labTest, whole: labWhole, onWhole: setLabWhole,
    onTest: (t) => {
      setLabTest(t);
      writeUrl((s) => ({ query: s.query, selection: s.selection, daySelection: s.daySelection, test: t, window: winRef.current }));
    },
  };

  const raf = useRef<number | null>(null);
  const pendingSel = useRef<Span | null>(null);
  const keyTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    if (keyTimer.current != null) window.clearTimeout(keyTimer.current);
  }, []);

  const onSelLive = useCallback((s: Span) => {
    pendingSel.current = s;
    if (raf.current != null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const v = pendingSel.current;
      if (v) setSelState({ key: evKey, span: v });
    });
  }, [evKey]);

  const commitSel = useCallback((s: Span) => {
    if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; }
    if (keyTimer.current != null) { window.clearTimeout(keyTimer.current); keyTimer.current = null; }
    pendingSel.current = null;
    setSelState({ key: evKey, span: s });
    setSortSpan(s);
    urlWith((x) => x, s);
  }, [evKey, urlWith]);

  const onChartKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: Span | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const d = e.key === "ArrowLeft" ? -1 : 1;
      next = e.shiftKey ? resizeSpan(sel, d, view) : shiftSpan(sel, d, view);
    } else if (e.key === "Escape") {
      commitSel(clampSpan(event, view, event));
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    setSelState({ key: evKey, span: next });
    if (keyTimer.current != null) window.clearTimeout(keyTimer.current);
    const n = next;
    keyTimer.current = window.setTimeout(() => commitSel(n), KEY_COMMIT_MS);
  };

  /* ---------------- shared hover (crosshair on every lane, tooltip on the one under the pointer) */
  const [hover, setHover] = useState<{ k: number; c: CategoryId } | null>(null);
  const hoverRaf = useRef<number | null>(null);
  const pendingHover = useRef<{ k: number; c: CategoryId } | null>(null);
  const onHover = useCallback((c: CategoryId, k: number | null) => {
    pendingHover.current = k == null ? null : { k, c };
    if (hoverRaf.current != null) return;
    hoverRaf.current = requestAnimationFrame(() => {
      hoverRaf.current = null;
      const h = pendingHover.current;
      setHover((prev) => (prev?.k === h?.k && prev?.c === h?.c ? prev : h));
    });
  }, []);

  /* ---------------- statistics of the selection, every lane */
  const details = useMemo(() => {
    const out: Partial<Record<CategoryId, IntervalDetail | null>> = {};
    const range = toRange(sel);
    for (const c of cats) {
      const r = results[c];
      if (r.kind !== "ready") { out[c] = null; continue; }
      try { out[c] = intervalDetail(r.d, range, r.baseline); } catch { out[c] = null; }
    }
    return out;
  }, [cats, results, sel.s, sel.e]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- lane order */
  const [order, setOrder] = useState<"picked" | "unusual">("picked");
  const sortKey = sortSpan ? clampSpan(sortSpan, view, event) : sel;
  const ordered = useMemo(() => {
    if (order === "picked") return cats;
    const range = toRange(sortKey);
    return orderLanes(cats, "unusual", (c) => {
      const r = results[c];
      if (r.kind !== "ready") return null;
      try { const z = intervalDetail(r.d, range, r.baseline).meanZ; return z == null ? null : Math.abs(z); } catch { return null; }
    });
  }, [order, cats, results, sortKey.s, sortKey.e]); // eslint-disable-line react-hooks/exhaustive-deps

  const lanes: LaneModel[] = ordered.map((c) => ({
    c,
    name: CATEGORIES[c].name.en,
    res: results[c],
    detail: details[c] ?? null,
    expected: expected[c],
    polarity: anomalyPolarity(c),
    choices: avail?.choices[c] ?? [],
    layer: avail?.layer[c] ?? null,
  }));

  /* ---------------- URL edits */
  const setTab = (c: CategoryId) => urlWith((x) => ({ ...x, active: c }));
  const setLayer = (c: CategoryId, l: LayerId) =>
    urlWith((x) => {
      const layers = { ...(x.layers ?? {}) };
      if (vc?.defaults[c] === l) delete layers[c]; else layers[c] = l;
      return { ...x, layers };
    });
  // the window only changes what is shown; the selection is clamped into the new view as before
  const setWin = (w: ViewWindow) => {
    winRef.current = w;
    setWinState(w);
    const next = clampSpan(selRaw, workbenchView(w, event, selRaw, recordUnion), event);
    setSelState({ key: evKey, span: next });
    urlWith((x) => x, next);
  };
  // the months left out of the baseline (URL `pad`), set in "Baseline and method"
  const setPad = (n: number) => urlWith((x) => ({ ...x, padMonths: n }));
  const onEdit = () => writeUrl((s) => ({ query: { ...s.query, categories: undefined, active: undefined }, draft: s.query.categories ?? [] }), "push");

  const [copied, setCopied] = useState(false);
  const share = () => {
    if (keyTimer.current != null) commitSel(sel);
    void navigator.clipboard?.writeText(window.location.href).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }, () => {});
  };

  const downloadCsv = () => {
    const csv = selectionCsv(
      { event: q.event, period: q.time, region: `${q.region} ${regionName}`, selection: toRange(sel), pad },
      lanes.filter((l) => l.res.kind === "ready").map((l) => {
        const r = l.res as Extract<LaneResult, { kind: "ready" }>;
        return { category: l.c, name: r.meta.name, product: r.meta.product, layer: r.meta.layer, unit: r.meta.unit, expected: l.expected, d: l.detail };
      }),
    );
    downloadText(`detective-${q.region}-${toRange(sel).start}_${toRange(sel).end}.csv`, csv);
  };

  const shared: Shared = { view, event, sel, hover, onSel: onSelLive, onCommit: commitSel, onHover };
  const allNoData = cats.every((c) => results[c].kind === "nodata");
  const relation = selectionLabel(sel, event).relation;
  const lane = lanes.find((l) => l.c === active) ?? lanes[0];
  // a days or weeks window: the daily (or weekly) anomaly around the selection replaces the monthly chart, and the
  // statistics and the Tests area work on its own selection of days (URL dsel)
  const daily = isDailyWindow(win) ? win : null;
  const ready = lane?.res.kind === "ready" ? lane.res : null;
  const selRange = toRange(sel);
  const daySel = useMemo(() => decodeState(params.toString()).daySelection ?? null, [params]);
  const [fineBaseline, setFineBaseline] = useState<{ kind: BaselineKind; years: number }>({ kind: "window", years: 10 });
  const fine = useFineModel({
    region: q.region, layer: ready?.meta.layer ?? "", d: ready?.d ?? null, unit: ready?.meta.unit ?? "",
    monthSel: selRange, reach: daily ?? { unit: "day", n: 1 }, daySel, baseline: fineBaseline, enabled: !!(daily && ready),
  });
  const setDaySel = (r: { start: string; end: string } | null) =>
    writeUrl((s) => ({ query: s.query, selection: s.selection, test: s.test, window: winRef.current, daySelection: r ?? undefined }));
  const fineOn = !!(daily && ready && fine.st.phase !== "unsupported");
  const renderChart = daily && ready
    ? (monthly: React.ReactNode, overlay: LabOverlay | null) => (
      <DailyView
        m={fine} name={ready.meta.name} product={ready.meta.product} event={q.exactTime ?? q.time} polarity={lane.polarity}
        around={COPY_DAILY.around(windowLabel(daily), formatRange(selRange))}
        overlay={overlay} fallback={monthly} onSelect={setDaySel}
        onShift={(months) => {
          // stay inside the monthly record: a day without a normal has no anomaly
          const next = { s: sel.s + months, e: sel.e + months };
          if (!recordUnion || (next.s >= recordUnion.s && next.e <= recordUnion.e)) commitSel(next);
        }}
      />
    )
    : undefined;
  // what an unavailable test lacks: the days around the selection, or a wider selection (its new days load by themselves)
  const fineMore: FetchMore = {
    around: fine.st.aroundMissing > 0 && !fine.st.around
      ? { days: fine.st.aroundMissing, eta: COPY_DAILY.seconds(fine.st.aroundMissing * 60 / 31), run: fine.st.loadAround }
      : null,
    widen: (points) => {
      const per = fine.step === "week" ? 7 : 1;
      const lo = dayNum(fine.span.start), hi = dayNum(fine.span.end);
      let a = dayNum(fine.selDays.start), b = dayNum(fine.selDays.end);
      const want = points * per;
      // grow the end first, then the start, inside the window
      b = Math.min(hi, a + want - 1);
      if (b - a + 1 < want) a = Math.max(lo, b - want + 1);
      setDaySel({ start: dayStr(a), end: dayStr(b) });
    },
  };
  const fineLane = fineOn && ready ? {
    more: fineMore,
    source: fine.lab,
    sel: fine.lab?.sel ?? { s: 0, e: 0 },
    axis: fine.lab?.axis ?? pointAxis(fine.step, fine.series.start, fine.series.end),
    stats: <FineStats m={fine} unit={fine.st.unit ?? ready.meta.unit} polarity={lane.polarity} years={fineBaseline.years} onBaseline={setFineBaseline} />,
  } : null;
  const T = COPY.toolbar;

  return (
    <>
      <StageHeader event={q.event} period={formatRange(q.time)} region={regionName} copied={copied} onEdit={onEdit} onShare={share} />

      {allNoData ? (
        <div className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-8">
          <StatusCard title={COPY.status.allNoData} action={<button type="button" onClick={onEdit} className="rounded-ctl bg-action px-4 py-2 font-semibold text-on-action hover:bg-action-hover">{COPY.status.editVariables}</button>}>
            <p>{COPY.status.allNoDataBody(regionName)}</p>
            {cats.map((c) => avail?.unavailableReason[c] && <p key={c}>{CATEGORIES[c].name.en}: {avail.unavailableReason[c]}</p>)}
          </StatusCard>
        </div>
      ) : (
        <>
          <Toolbar view={view} event={event} sel={sel} onPreset={commitSel} window={<WindowControl value={win} onChange={setWin} />} />
          <div className="mx-auto max-w-[90rem] px-4 pt-5 pb-12 sm:px-6 lg:px-8">
            <div className="mb-5 flex flex-wrap items-center gap-x-8 gap-y-2">
              <VariableSelect
                className="w-full lg:w-[46rem]"
                items={itemsFromLanes(lanes)} value={active} onChange={setTab}
                view={view} event={event} sel={sel}
              />
              <div className="flex items-baseline gap-3">
                <span aria-hidden="true" className="text-sm text-ink-2">{T.order}</span>
                <Segmented legend={T.order} hideLegend tone="paper" look="underline"
                  options={[{ value: "picked", label: T.asPicked }, { value: "unusual", label: T.mostUnusual }]}
                  value={order} onChange={setOrder} />
              </div>
            </div>
            {lane && (
              <ExpandedLane
                key={lane.c}
                lane={lane} shared={shared} vc={vc} catalog={catalog} regionId={q.region} relation={relation}
                onLayer={(l) => setLayer(lane.c, l)} onRetry={() => setAttempt((a) => a + 1)}
                onKeyDown={onChartKey} onCsv={downloadCsv} lab={lab}
                renderChart={renderChart}
                fine={fineLane}
                baselineControl={<BaselinePadControl value={pad} onChange={setPad} />}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}
