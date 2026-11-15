"use client";
// Step 2 + Step 3 of /detective: run the analysis for every chosen category and show the workbench
// (docs/ux-refresh.md): stage header, sticky selection toolbar, stacked lanes sharing one time axis and
// one selection, one expanded lane with the crystal ball, the large chart and the statistics.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import type { Catalog } from "@/lib/types";
import type { CategoryId, DetectiveQuery, LayerId, MonthlySeries, RegionId, TrendStats } from "@/lib/detective/contracts";
import { DEFAULT_PAD, PAD_MAX, PAD_MIN, decodeState, formatRange, ymIndex } from "@/lib/detective/url";
import { categoryAvailability, loadSeries, type VariableCatalog } from "@/lib/detective/series";
import { baselineInfo, intervalDetail, type IntervalDetail } from "@/lib/detective/intervalDetail";
import { anomalyPolarity } from "@/lib/detective/polarity";
import { useElementHeight } from "@/components/charts/useElementWidth";
import { StatusCard } from "@/components/ui/StatusCard";
import { downloadText } from "@/components/ui/download";
import { CATEGORIES, analysis, variableMetadata } from "./wiring";
import { NO_LAYERS, msg, presetFor, writeUrl } from "./appShared";
import { COPY } from "./workbench/copy";
import { clampSpan, orderLanes, resizeSpan, selectionLabel, shiftSpan, toRange, toSpan, type Span } from "./workbench/model";
import type { LaneModel, LaneResult } from "./workbench/types";
import { AxisRow, CollapsedLane, ExpandedLane, LANE_VARS, type Shared } from "./workbench/Lanes";
import { StageHeader, Toolbar } from "./workbench/Toolbar";
import { selectionCsv } from "./workbench/csv";
import type { LabControl } from "./workbench/lab/TestsPanel";
import { DEFAULT_TEST, type TestId } from "./workbench/lab/tests";

const PAD_CHOICES = [6, 12, 24];
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

  /* ---------------- window */
  const [showAll, setShowAll] = useState(false);
  const padView = useMemo(() => ({ s: event.s - pad, e: event.e + pad }), [event, pad]);
  const view = useMemo(() => {
    if (!showAll) return padView;
    let s = padView.s, e = padView.e;
    for (const c of cats) { const r = results[c]; if (r.kind === "ready") { s = Math.min(s, r.record.s); e = Math.max(e, r.record.e); } }
    return { s, e };
  }, [showAll, padView, cats, results]);

  /* ---------------- the shared selection (URL `sel`, else the event) */
  const params = useSearchParams();
  const urlSel = useMemo(() => decodeState(params.toString()).selection ?? null, [params]);
  const [selState, setSelState] = useState<{ key: string; span: Span }>(() => ({ key: evKey, span: urlSel ? toSpan(urlSel) : event }));
  const selRaw = selState.key === evKey ? selState.span : urlSel ? toSpan(urlSel) : event;
  const sel = clampSpan(selRaw, view, event);
  const [sortSpan, setSortSpan] = useState<Span | null>(null);

  // writes keep the selection unless one is given; `null` removes it
  const urlWith = useCallback((fn: (q: Partial<DetectiveQuery>) => Partial<DetectiveQuery>, selection?: Span | null) => {
    writeUrl((s) => {
      const out = { query: fn(s.query), selection: selection === undefined ? s.selection : selection ? toRange(selection) : undefined, test: s.test };
      return out;
    });
  }, []);

  /* ---------------- Tests (lab): the open test is shared by every lane and kept in the URL `test` */
  const [labTest, setLabTest] = useState<TestId | null>(() => decodeState(params.toString()).test ?? null);
  const [lastTest, setLastTest] = useState<TestId>(labTest ?? DEFAULT_TEST);
  const [labWhole, setLabWhole] = useState(false);
  const onLabTest = useCallback((t: TestId | null) => {
    setLabTest(t);
    if (t) setLastTest(t);
    writeUrl((s) => ({ query: s.query, selection: s.selection, test: t }));
  }, []);
  const lab: LabControl = { test: labTest, whole: labWhole, onOpen: () => onLabTest(lastTest), onTest: onLabTest, onWhole: setLabWhole };

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
  const scrollTo = useRef<CategoryId | null>(null);
  const setTab = (c: CategoryId) => { scrollTo.current = c; urlWith((x) => ({ ...x, active: c })); };
  // after the user expands a lane, bring it under the sticky bars so its chart and verdict are on screen
  useEffect(() => {
    if (scrollTo.current !== active) return;
    scrollTo.current = null;
    const el = document.getElementById(`lanebox-${active}`);
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const phone = window.matchMedia("(max-width: 767px)").matches;
    if (!phone && top > 0 && top < window.innerHeight * 0.5) return;
    el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [active]);
  const setLayer = (c: CategoryId, l: LayerId) =>
    urlWith((x) => {
      const layers = { ...(x.layers ?? {}) };
      if (vc?.defaults[c] === l) delete layers[c]; else layers[c] = l;
      return { ...x, layers };
    });
  const setWindow = (v: "all" | number) => {
    if (v === "all") { setShowAll(true); return; }
    setShowAll(false);
    const next = clampSpan(selRaw, { s: event.s - v, e: event.e + v }, event);
    setSelState({ key: evKey, span: next });
    urlWith((x) => ({ ...x, padMonths: v }), next);
  };
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

  const [toolbarRef, toolbarH] = useElementHeight<HTMLDivElement>();
  const shared: Shared = { view, event, sel, hover, onSel: onSelLive, onCommit: commitSel, onHover };
  const allNoData = cats.every((c) => results[c].kind === "nodata");
  const padChoices = (PAD_CHOICES.includes(pad) ? PAD_CHOICES : [...PAD_CHOICES, pad].sort((a, b) => a - b)).filter((n) => n >= PAD_MIN && n <= PAD_MAX);
  const relation = selectionLabel(sel, event).relation;

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
          <Toolbar
            rootRef={toolbarRef}
            view={view} event={event} sel={sel} pad={pad} padChoices={padChoices} showAll={showAll} order={order}
            onPreset={commitSel} onWindow={setWindow} onOrder={setOrder}
          />
          <div className={`mx-auto max-w-[90rem] px-2 pt-3 pb-10 sm:px-4 lg:px-6 ${LANE_VARS}`} style={{ "--toolbar-h": `${toolbarH}px` } as React.CSSProperties}>
            <AxisRow view={view} event={event} />
            <ul aria-label={COPY.lanes.label}>
              {lanes.map((lane) => lane.c === active ? (
                <ExpandedLane
                  key={lane.c}
                  lane={lane} shared={shared} vc={vc} catalog={catalog} regionId={q.region} relation={relation}
                  onLayer={(l) => setLayer(lane.c, l)} onRetry={() => setAttempt((a) => a + 1)}
                  onKeyDown={onChartKey} onCsv={downloadCsv} lab={lab}
                />
              ) : (
                <CollapsedLane key={lane.c} lane={lane} shared={shared} onExpand={() => setTab(lane.c)} onRetry={() => setAttempt((a) => a + 1)} />
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
