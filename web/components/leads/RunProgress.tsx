"use client";
import { useCallback, useEffect, useState } from "react";
import type { SyntheticRun } from "@/lib/synthetic";
import { Provenance } from "@/components/ui/Provenance";

/** Stage boundaries of the simulated run, in ms. Insufficient runs stop after the inventory. */
export const STAGES = { inventory: 1100, fetch: 2200, analyse: 3900, correct: 5000 } as const;
export const STOP_EARLY = 1900;

export function runDuration(run: SyntheticRun): number {
  return run.scenario === "insufficient" ? STOP_EARLY : STAGES.correct;
}

/** Simulated clock for one run. Resets when `runKey` changes; instant when motion is reduced or `instant` is set. */
export function useRunClock(runKey: string, total: number, instant: boolean) {
  const [state, setState] = useState<{ key: string; t: number }>({ key: runKey, t: 0 });
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (instant || reduce) { setState({ key: runKey, t: total }); return; }
    const start = performance.now();
    setState({ key: runKey, t: 0 });
    const id = window.setInterval(() => {
      const t = Math.min(total, performance.now() - start);
      setState({ key: runKey, t });
      if (t >= total) window.clearInterval(id);
    }, 80);
    return () => window.clearInterval(id);
  }, [runKey, total, instant]);
  const t = state.key === runKey ? state.t : 0;
  const skip = useCallback(() => setState({ key: runKey, t: total }), [runKey, total]);
  return { t, done: t >= total, skip };
}

const frac = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));

type StageId = "inventory" | "fetch" | "analyse" | "correct";
const STAGE_LABEL: Record<StageId, string> = {
  inventory: "Inventory",
  fetch: "Fetching data",
  analyse: "Analysing pairs",
  correct: "Correction and stability checks",
};

export default function RunProgress({ run, t, onSkip }: { run: SyntheticRun; t: number; onSkip: () => void }) {
  const L = run.ledger;
  const stopEarly = run.scenario === "insufficient";
  const stage: StageId = t < STAGES.inventory ? "inventory" : stopEarly ? "inventory" : t < STAGES.fetch ? "fetch" : t < STAGES.analyse ? "analyse" : "correct";
  const order: StageId[] = stopEarly ? ["inventory"] : ["inventory", "fetch", "analyse", "correct"];
  const stageDone = (s: StageId) => (stopEarly ? t >= STOP_EARLY - 100 : order.indexOf(s) < order.indexOf(stage));

  const inv = frac(t, 0, STAGES.inventory);
  const found = Math.round(L.discovered * Math.min(1, inv * 1.4));
  const merged = inv > 0.75;
  const fetchF = frac(t, STAGES.inventory, STAGES.fetch);
  const fetchTarget = L.identified - L.failed;
  const fetched = Math.round(fetchTarget * fetchF);
  const anaF = frac(t, STAGES.fetch, STAGES.analyse);
  const analysed = Math.round(L.analysedPairs * anaF);
  const showProv = anaF > 0.35 && run.provisional.length > 0;

  let detail: string;
  if (stopEarly) {
    detail = t < STAGES.inventory
      ? `${found} entries found in the synthetic candidate list.`
      : "Stopped after the inventory: there is no target series to compare candidates with.";
  } else if (stage === "inventory") {
    detail = `${found} entries found${merged ? `, ${L.identified} after merging ${L.duplicatesMerged} duplicates` : ""}.`;
  } else if (stage === "fetch") {
    detail = `Fetched ${fetched} of ${L.identified} entries${L.failed && fetchF > 0.8 ? `. ${L.failed} failed after retries and is pending.` : "."}`;
  } else if (stage === "analyse") {
    detail = `Analysed ${analysed} of ${L.eligiblePairs} eligible pairs${L.pendingPairs ? ` (${L.pendingPairs} waiting on the failed source)` : ""}. Results so far are provisional.`;
  } else {
    detail = `${L.testsAnalysed} tests finished${L.testsPending ? `, ${L.testsPending} still missing` : ""}. Waiting for the family-wide correction (${L.familySize} tests) and the stability checks. There are no final recommendations yet.`;
  }
  const bar = stage === "fetch" ? fetchF : stage === "analyse" ? anaF : null;

  return (
    <div className="rounded-card border border-line bg-paper p-4" aria-busy="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="m-0 font-display text-lg text-ink">Searching for leads in {run.regionName}</h3>
        <button type="button" onClick={onSkip} className="rounded-ctl border border-line bg-paper px-4 py-1.5 text-sm font-semibold text-ink hover:bg-well">
          Skip to result
        </button>
      </div>
      <p className="m-0 mt-1 text-[0.875rem] text-ink-2">Simulated run with synthetic counts. Counts come from this run&apos;s ledger.</p>
      <ol className="m-0 mt-3 grid list-none gap-1 p-0">
        {order.map((s, i) => {
          const done = stageDone(s), cur = s === stage && !done;
          return (
            <li key={s} className={`flex items-baseline gap-3 text-[0.9375rem] ${cur ? "font-semibold text-ink" : done ? "text-ink-2" : "text-ink-3"}`}>
              <span className="tnum w-5 shrink-0 text-right">{i + 1}</span>
              <span className="min-w-0 flex-1">{STAGE_LABEL[s]}</span>
              <span className="text-[0.8125rem] font-normal text-ink-3">{done ? "done" : cur ? "in progress" : "waiting"}</span>
            </li>
          );
        })}
      </ol>
      <p className="tnum m-0 mt-3 text-[0.9375rem] text-ink" role="status" aria-live="polite">{detail}</p>
      {bar !== null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-ctl bg-well" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bar * 100)} aria-label={STAGE_LABEL[stage]}>
          <div className="h-full bg-link" style={{ width: `${bar * 100}%` }} />
        </div>
      )}
      {showProv && !stopEarly && (
        <div className="mt-3 rounded-ctl bg-well p-3">
          <p className="m-0 flex flex-wrap items-center gap-2 text-[0.875rem] font-semibold text-ink">
            Provisional signals so far <Provenance kind="synthetic" className="!px-2 !py-0 !text-xs">Synthetic</Provenance>
          </p>
          <ul className="m-0 mt-1 list-none p-0 text-[0.875rem] text-ink-2">
            {run.provisional.map((p) => (
              <li key={p.id} className="flex flex-wrap gap-x-2"><span>{p.text}:</span><span className="tnum">{p.pText}, provisional</span></li>
            ))}
          </ul>
          <p className="m-0 mt-1 text-[0.8125rem] text-ink-2">Uncorrected, before the family-wide correction. They can disappear. They are not recommendations.</p>
        </div>
      )}
    </div>
  );
}
