"use client";
// The earlier-years baseline of the daily view: the selection ± a margin in each of N earlier years, fetched one
// ≤ 3-day piece at a time through /api/daily-series (only when the reader asks: it takes minutes), cached for the
// session in ./pieces. Loading continues where it stopped after Stop, Retry or a revisit.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supportsDaily, type DailySeries } from "@/lib/detective/daily";
import { DailyLoadError, requestDailySeries } from "@/lib/detective/daily-client";
import type { DayRange } from "@/lib/detective/fine";
import { daysOf, estimateSeconds, splitRange } from "./plan";
import { pieceKey, pieces, remember } from "./pieces";

export interface PastYear {
  year: number;
  span: DayRange;
  dates: string[];
  values: (number | null)[];
  /** every piece of the year is in */
  complete: boolean;
}

export type YearsPhase = "idle" | "loading" | "stopped" | "error" | "done";

export interface YearsState {
  phase: YearsPhase;
  years: PastYear[];
  doneDays: number;
  totalDays: number;
  etaSeconds: number;
  error: DailyLoadError["code"] | null;
  start: () => void;
  stop: () => void;
}

export function useYearsBaseline({ region, layer, spans, enabled = true }: {
  region: string; layer: string; spans: { year: number; span: DayRange }[]; enabled?: boolean;
}): YearsState {
  const supported = supportsDaily(layer);
  const spansKey = spans.map((s) => `${s.year}:${s.span.start}..${s.span.end}`).join(",");
  const key = `${region}|${layer}|${spansKey}`;
  const parts = useMemo(
    () => spans.flatMap((s) => splitRange(s.span).map((p) => ({ year: s.year, ...p }))),
    [spansKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const has = (p: DayRange) => pieces.has(pieceKey(region, layer, p));
  const [run, setRun] = useState<{ key: string; phase: YearsPhase; error: DailyLoadError["code"] | null; token: number }>({ key: "", phase: "idle", error: null, token: 0 });
  const [, setVersion] = useState(0);
  const timing = useRef<{ key: string; ms: number; n: number }>({ key: "", ms: 0, n: 0 });
  const ctrl = useRef<AbortController | null>(null);

  const all = parts.length > 0 && parts.every(has);
  const cur = run.key === key ? run : { key, phase: all ? ("done" as const) : ("idle" as const), error: null, token: 0 };

  const start = useCallback(() => setRun((r) => ({ key, phase: "loading", error: null, token: (r.key === key ? r.token : 0) + 1 })), [key]);
  const stop = useCallback(() => {
    ctrl.current?.abort();
    setRun((r) => (r.key === key && r.phase === "loading" ? { ...r, phase: "stopped" } : r));
  }, [key]);

  useEffect(() => {
    if (!enabled || !supported || run.key !== key || run.phase !== "loading") return;
    const ac = new AbortController();
    ctrl.current = ac;
    if (timing.current.key !== key) timing.current = { key, ms: 0, n: 0 };
    (async () => {
      for (const p of parts) {
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
      setRun((r) => (r.key === key && r.token === run.token ? { ...r, phase: "done" } : r));
    })().catch((e: unknown) => {
      if (ac.signal.aborted) return;
      setRun((r) => (r.key === key && r.token === run.token ? { ...r, phase: "error", error: e instanceof DailyLoadError ? e.code : "failed" } : r));
    });
    return () => ac.abort();
  }, [enabled, supported, key, run.key, run.phase, run.token, parts, region, layer]);

  // what is in so far, per year
  let done = 0, missing = 0;
  const years: PastYear[] = spans.map(({ year, span }) => {
    const dates = daysOf(span);
    const values: (number | null)[] = new Array(dates.length).fill(null);
    let i0 = 0, complete = true;
    for (const p of splitRange(span)) {
      const n = daysOf(p).length;
      const s = pieces.get(pieceKey(region, layer, p));
      if (s) { for (let j = 0; j < n; j++) values[i0 + j] = s.values[j] ?? null; done += n; } else { complete = false; missing++; }
      i0 += n;
    }
    return { year, span, dates, values, complete };
  });
  const total = years.reduce((n, y) => n + y.dates.length, 0);
  const perPiece = timing.current.key === key && timing.current.n > 0 ? timing.current.ms / timing.current.n / 1000 : null;
  return {
    phase: !supported ? "idle" : cur.phase === "loading" && done === total ? "done" : cur.phase,
    years, doneDays: done, totalDays: total,
    etaSeconds: perPiece != null ? perPiece * missing : estimateSeconds(total - done),
    error: cur.error, start, stop,
  };
}
