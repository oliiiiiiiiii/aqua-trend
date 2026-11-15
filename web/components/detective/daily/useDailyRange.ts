"use client";
// Daily values over a span [start, end] (the chart's axis), fetching only the `fetch` days: the reader's selection.
// Those days are clipped to finished UTC days, the ones not yet held (pieces.days, shared with the earlier-years
// baseline) are grouped into ≤ 3-day pieces (plan.missingPieces) and fetched one piece at a time through
// /api/daily-series (requestDailySeries validates each piece). Days of the span outside the selection show only if
// they were fetched before.
//
// Every change of the selection (or the variable) aborts the run in flight and starts again AUTO_DELAY_MS after the
// last change, so dragging fires no requests and the newest selection always wins. Stop / Retry resume where loading
// stopped; nothing waits for a click.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supportsDaily, type DailySeries } from "@/lib/detective/daily";
import { DailyLoadError, completedDailyRange, requestDailySeries } from "@/lib/detective/daily-client";
import { AUTO_DELAY_MS, daysOf, estimateSeconds, missingPieces, type DayRange } from "./plan";
import { dayKey, days, pieceKey, remember } from "./pieces";

export type DailyPhase =
  | "unsupported" // the layer has no daily product
  | "empty"       // no finished UTC day in the selection
  | "idle"        // (no longer produced: the selection always loads by itself)
  | "waiting"     // debounce running before the selection loads
  | "partial"     // (no longer produced)
  | "loading"
  | "stopped"     // stop() during loading; retry() resumes
  | "error"       // a piece failed; retry() resumes
  | "done";       // every selected day is held

export interface DailyState {
  phase: DailyPhase;
  /** the selection clipped to finished UTC days (what is fetched), null when nothing to load */
  range: DayRange | null;
  /** the selection's end before clipping (to say "daily data ends …") */
  requestedEnd: string;
  /** every day of the span (clipped to finished days) */
  dates: string[];
  values: (number | null)[];
  /** loaded[i] = day i has been fetched (its value may still be null = missing) */
  loaded: boolean[];
  /** selected days held / selected days */
  doneDays: number;
  totalDays: number;
  /** seconds, refined from the pieces fetched so far */
  etaSeconds: number;
  /** selected days not loaded yet */
  remainingDays: number;
  /** always false: the selection loads without a click */
  needsConfirm: boolean;
  unit: string | null;
  source: DailySeries["source"] | null;
  error: DailyLoadError["code"] | null;
  start: () => void;
  stop: () => void;
  retry: () => void;
}

export function useDailyRange({ region, layer, start, end, fetch, enabled = true }: {
  region: string; layer: string;
  /** the span drawn */
  start: string; end: string;
  /** the selected days: the only ones fetched */
  fetch: DayRange | null;
  enabled?: boolean;
}): DailyState {
  const supported = supportsDaily(layer);
  const span = useMemo(() => (supported ? completedDailyRange({ start, end }) : null), [supported, start, end]);
  const fs = fetch?.start ?? "", fe = fetch?.end ?? "";
  const range = useMemo(() => (supported && fs ? completedDailyRange({ start: fs, end: fe }) : null), [supported, fs, fe]);
  const dates = useMemo(() => (span ? daysOf(span) : []), [span]);
  const selDates = useMemo(() => (range ? daysOf(range) : []), [range]);
  const key = `${region}|${layer}|${range?.start ?? ""}|${range?.end ?? ""}`;
  const [, setVersion] = useState(0);
  const held = (d: string) => days.has(dayKey(region, layer, d));
  const missing = selDates.filter((d) => !held(d)).length;

  type Phase = "waiting" | "loading" | "stopped" | "error" | "done";
  const [run, setRun] = useState<{ key: string; phase: Phase; error: DailyLoadError["code"] | null; token: number }>(
    { key: "", phase: "waiting", error: null, token: 0 },
  );
  const timing = useRef<{ ms: number; n: number }>({ ms: 0, n: 0 });
  const ctrl = useRef<AbortController | null>(null);
  const cur = run.key === key ? run : { key, phase: (missing ? "waiting" : "done") as Phase, error: null, token: 0 };

  const begin = useCallback(() =>
    setRun((r) => ({ key, phase: "loading", error: null, token: (r.key === key ? r.token : 0) + 1 })), [key]);

  // a new selection: (re)start after the debounce; every change clears the pending timer
  useEffect(() => {
    if (!enabled || !supported || !range || !missing || run.key === key) return;
    const t = window.setTimeout(begin, AUTO_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [enabled, supported, range, missing, run.key, key, begin]);

  // the loading loop: the selection's missing days, one piece at a time; aborted when the selection changes
  useEffect(() => {
    if (!enabled || !range || run.key !== key || run.phase !== "loading") return;
    const ac = new AbortController();
    ctrl.current = ac;
    const token = run.token;
    (async () => {
      for (const p of missingPieces(daysOf(range), (d) => days.has(dayKey(region, layer, d)))) {
        if (daysOf(p).every((d) => days.has(dayKey(region, layer, d)))) continue;
        const t0 = performance.now();
        const s = await requestDailySeries({ region, layer: layer as DailySeries["layer"], start: p.start, end: p.end }, ac.signal);
        if (ac.signal.aborted) return;
        remember(pieceKey(region, layer, p), s);
        timing.current.ms += performance.now() - t0;
        timing.current.n += 1;
        setVersion((v) => v + 1);
      }
      setRun((r) => (r.key === key && r.token === token ? { ...r, phase: "done" } : r));
    })().catch((e: unknown) => {
      if (ac.signal.aborted) return;
      const code = e instanceof DailyLoadError ? e.code : "failed";
      setRun((r) => (r.key === key && r.token === token ? { ...r, phase: "error", error: code } : r));
    });
    return () => ac.abort();
  }, [enabled, key, run.key, run.phase, run.token, range, region, layer]);

  const stop = useCallback(() => {
    ctrl.current?.abort();
    setRun((r) => (r.key === key && r.phase === "loading" ? { ...r, phase: "stopped" } : r));
  }, [key]);

  let unit: string | null = null, source: DailySeries["source"] | null = null;
  const values: (number | null)[] = [], loaded: boolean[] = [];
  for (const d of dates) {
    const h = days.get(dayKey(region, layer, d));
    values.push(h ? h.value : null);
    loaded.push(!!h);
    if (h) { unit ??= h.unit; source ??= h.source; }
  }
  const perPiece = timing.current.n > 0 ? timing.current.ms / timing.current.n / 1000 : null;
  const eta = perPiece != null ? perPiece * Math.ceil(missing / 3) : estimateSeconds(missing);

  const phase: DailyPhase = !supported ? "unsupported" : !range ? "empty" : !missing ? "done" : cur.phase === "done" ? "stopped" : cur.phase;
  return {
    phase, range, requestedEnd: fe || end, dates, values, loaded,
    doneDays: selDates.length - missing, totalDays: selDates.length,
    etaSeconds: eta, remainingDays: missing, needsConfirm: false, unit, source, error: cur.error,
    start: begin, stop, retry: begin,
  };
}
