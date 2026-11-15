"use client";
// Progressive daily loading for any span (the library client caps one query at a calendar month): the range is
// clipped to finished UTC days, split into ≤ 3-day pieces and fetched one piece at a time through the existing
// /api/daily-series route (requestDailySeries validates each piece). Pieces are cached per session, so Retry and
// Resume continue where loading stopped and a revisit is instant.
//
// After 400 ms the automatic part loads by itself (plan.autoRange): the whole span up to 62 days, else the focus days
// (the selection's own days) when they are ≤ 31; the rest waits for start() ("Load N more days").
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supportsDaily, type DailySeries } from "@/lib/detective/daily";
import { DailyLoadError, completedDailyRange, requestDailySeries } from "@/lib/detective/daily-client";
import { AUTO_DELAY_MS, autoRange, daysOf, estimateSeconds, needsConfirm, planPieces, type DayRange } from "./plan";
import { pieceKey, pieces, remember } from "./pieces";

export type DailyPhase =
  | "unsupported" // the layer has no daily product
  | "empty"       // no finished UTC day in the range
  | "idle"        // waiting for start() (long span, nothing loads by itself)
  | "waiting"     // debounce running before the automatic part loads
  | "partial"     // the automatic part (the selection's days) is loaded; the rest waits for start()
  | "loading"
  | "stopped"     // stop() during loading; start() resumes
  | "error"       // a piece failed; retry() resumes
  | "done";

export interface DailyState {
  phase: DailyPhase;
  /** finished-day range actually requested (clipped to yesterday UTC), null when nothing to load */
  range: DayRange | null;
  /** the requested end before clipping (to say "daily data ends …") */
  requestedEnd: string;
  dates: string[];
  values: (number | null)[];
  /** loaded[i] = day i has been fetched (its value may still be null = missing) */
  loaded: boolean[];
  doneDays: number;
  totalDays: number;
  /** seconds, refined from the pieces fetched so far */
  etaSeconds: number;
  /** days not loaded yet */
  remainingDays: number;
  needsConfirm: boolean;
  unit: string | null;
  source: DailySeries["source"] | null;
  error: DailyLoadError["code"] | null;
  start: () => void;
  stop: () => void;
  retry: () => void;
}

export function useDailyRange({ region, layer, start, end, focus = null, enabled = true }: {
  region: string; layer: string; start: string; end: string;
  /** the selection's own days; for long spans only these load without a click */
  focus?: DayRange | null;
  enabled?: boolean;
}): DailyState {
  const supported = supportsDaily(layer);
  const range = useMemo(() => (supported ? completedDailyRange({ start, end }) : null), [supported, start, end]);
  const evStart = focus?.start ?? "", evEnd = focus?.end ?? "";
  const auto = useMemo(() => (range ? autoRange(range, evStart ? { start: evStart, end: evEnd } : null) : null), [range, evStart, evEnd]);
  const parts = useMemo(() => (range ? planPieces(range, auto) : []), [range, auto]);
  const dates = useMemo(() => (range ? daysOf(range) : []), [range]);
  const key = `${region}|${layer}|${range?.start ?? ""}|${range?.end ?? ""}|${auto?.start ?? ""}`;
  const confirm = needsConfirm(dates.length);
  const has = (p: DayRange) => pieces.has(pieceKey(region, layer, p));

  type Phase = "idle" | "waiting" | "loading" | "stopped" | "error" | "done" | "partial";
  // scope "auto" loads the automatic pieces only, "all" every piece; version bumps re-render after each piece
  const [run, setRun] = useState<{ key: string; phase: Phase; scope: "auto" | "all"; error: DailyLoadError["code"] | null; token: number }>(
    { key: "", phase: "idle", scope: "auto", error: null, token: 0 },
  );
  const [, setVersion] = useState(0);
  const timing = useRef<{ key: string; ms: number; n: number }>({ key: "", ms: 0, n: 0 });
  const ctrl = useRef<AbortController | null>(null);

  const cachedAll = parts.length > 0 && parts.every(has);
  const autoParts = parts.filter((p) => p.auto);
  const cachedAuto = autoParts.length > 0 && autoParts.every(has);
  const initial: Phase = cachedAll ? "done" : cachedAuto ? "partial" : autoParts.length ? "waiting" : "idle";
  const cur = run.key === key ? run : { key, phase: initial, scope: "auto" as const, error: null, token: 0 };

  const begin = useCallback((scope: "auto" | "all") =>
    setRun((r) => ({ key, phase: "loading", scope, error: null, token: (r.key === key ? r.token : 0) + 1 })), [key]);
  const startAll = useCallback(() => begin("all"), [begin]);
  const retry = useCallback(() => begin(run.key === key ? run.scope : "auto"), [begin, run.key, run.scope, key]);

  // the automatic part: start after the debounce
  useEffect(() => {
    if (!enabled || !supported || !range || cachedAll || cachedAuto || !autoParts.length || run.key === key) return;
    const t = window.setTimeout(() => begin("auto"), AUTO_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [enabled, supported, range, cachedAll, cachedAuto, autoParts.length, run.key, key, begin]);

  // the loading loop: one piece at a time, skipping cached pieces
  useEffect(() => {
    if (!enabled || run.key !== key || run.phase !== "loading") return;
    const ac = new AbortController();
    ctrl.current = ac;
    if (timing.current.key !== key) timing.current = { key, ms: 0, n: 0 };
    const todo = run.scope === "auto" ? parts.filter((p) => p.auto) : parts;
    (async () => {
      for (const p of todo) {
        const k = pieceKey(region, layer, p);
        if (pieces.has(k)) continue;
        const t0 = performance.now();
        const s = await requestDailySeries({ region, layer: layer as DailySeries["layer"], start: p.start, end: p.end }, ac.signal);
        if (ac.signal.aborted) return;
        remember(k, s);
        timing.current.ms += performance.now() - t0;
        timing.current.n += 1;
        setVersion((v) => v + 1);
      }
      const all = parts.every((p) => pieces.has(pieceKey(region, layer, p)));
      setRun((r) => (r.key === key && r.token === run.token ? { ...r, phase: all ? "done" : "partial" } : r));
    })().catch((e: unknown) => {
      if (ac.signal.aborted) return;
      const code = e instanceof DailyLoadError ? e.code : "failed";
      setRun((r) => (r.key === key && r.token === run.token ? { ...r, phase: "error", error: code } : r));
    });
    return () => ac.abort();
  }, [enabled, key, run.key, run.phase, run.scope, run.token, parts, region, layer]);

  const stop = useCallback(() => {
    ctrl.current?.abort();
    setRun((r) => (r.key === key && r.phase === "loading" ? { ...r, phase: "stopped" } : r));
  }, [key]);

  // assemble what we have (pieces are in date order)
  const values: (number | null)[] = new Array(dates.length).fill(null);
  const loaded: boolean[] = new Array(dates.length).fill(false);
  let unit: string | null = null, source: DailySeries["source"] | null = null, done = 0, missingPieces = 0, i0 = 0;
  for (const p of parts) {
    const s = pieces.get(pieceKey(region, layer, p));
    const n = daysOf(p).length;
    if (s) {
      for (let j = 0; j < n; j++) { values[i0 + j] = s.values[j] ?? null; loaded[i0 + j] = true; }
      unit ??= s.unit; source ??= s.source; done += n;
    } else if (cur.phase !== "loading" || cur.scope === "all" || p.auto) missingPieces += 1;
    i0 += n;
  }
  const perPiece = timing.current.key === key && timing.current.n > 0 ? timing.current.ms / timing.current.n / 1000 : null;
  const left = dates.length - done;
  const eta = perPiece != null ? perPiece * missingPieces : estimateSeconds(cur.phase === "loading" && cur.scope === "auto"
    ? autoParts.filter((p) => !has(p)).reduce((n, p) => n + daysOf(p).length, 0) : left);

  const phase: DailyPhase = !supported ? "unsupported" : !range ? "empty" : cur.phase === "loading" && done === dates.length ? "done" : cur.phase;
  return {
    phase, range, requestedEnd: end, dates, values, loaded, doneDays: done, totalDays: dates.length,
    etaSeconds: eta, remainingDays: left, needsConfirm: confirm, unit, source, error: cur.error,
    start: startAll, stop, retry,
  };
}
