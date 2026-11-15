"use client";
// One test's result in the grammar of StatsPanel: verdict line with a drawn mark, 2–4 key numbers,
// an inline figure where a picture says more, then a collapsed "Details" table with the method, and
// the multiple-testing log. No boxes: whitespace, alignment and a hairline or two.
import { Fragment } from "react";
import type { YearMonth } from "@/lib/detective/contracts";
import { formatYm } from "@/lib/detective/url";
import { pValue } from "../../format";
import { COPY } from "../copy";
import { AcfFigure, BootFigure, CusumFigure, MonthlyFigure, NormalFigure, PermFigure, SpectrumFigure } from "./figures";
import { resultView, type Tag } from "./format";
import { slopeScale, type HolmStatus, type TestLog } from "./tests";
import type { LabRun } from "./useLabRun";

type MarkState = "sig" | "not" | "half" | "none";

/** ● significant · ◐ significant before correction only · ○ not · – no p value; neutral ink, meaning in title */
function LabMark({ state, title, size = 13 }: { state: MarkState; title: string; size?: number }) {
  const c = size / 2, r = c - 1;
  return (
    <span title={title} className="inline-flex shrink-0 items-center self-center">
      <svg width={size} height={size} aria-hidden="true">
        {state === "sig" && <circle cx={c} cy={c} r={r} style={{ fill: "var(--ink)" }} />}
        {(state === "not" || state === "half") && <circle cx={c} cy={c} r={r - 0.25} fill="none" strokeWidth={1.5} style={{ stroke: "var(--ink-2)" }} />}
        {state === "half" && <path d={`M${c} ${c - r}A${r} ${r} 0 0 0 ${c} ${c + r}Z`} style={{ fill: "var(--ink-2)" }} />}
        {state === "none" && <line x1={1} x2={size - 1} y1={c} y2={c} strokeWidth={1.5} style={{ stroke: "var(--ink-2)" }} />}
      </svg>
      <span className="sr-only">{title}</span>
    </span>
  );
}

export function TagNote({ tag }: { tag?: Tag }) {
  if (!tag) return null;
  const T = COPY.lab.tag;
  return (
    <span title={tag === "uncorrected" ? T.uncorrectedTitle : T.optimisticTitle} className="ml-1.5 text-[10px] font-semibold tracking-wide text-synthetic">
      {tag === "uncorrected" ? T.uncorrected : T.optimistic}
    </span>
  );
}

const summaryCls = "flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1 text-sm [&::-webkit-details-marker]:hidden";
const chevron = <span aria-hidden="true" className="inline-block w-3 text-ink-3 transition-transform group-open:rotate-90">▸</span>;

export default function ResultCard({ run, unit, months, polarity, onShowAnomaly }: {
  run: LabRun;
  unit: string;
  /** d.months of the lane */
  months: readonly YearMonth[];
  polarity: "cool" | "warm";
  /** set when the test draws on the chart but the chart shows another layer */
  onShowAnomaly?: () => void;
}) {
  const L = COPY.lab;
  const o = run.outcome;
  const n = run.span.e - run.span.s + 1;
  const monthLabel = (i: number) => (months[i] ? formatYm(months[i]) : "—");

  if (o.kind === "insufficient" || !run.avail[run.test].ok) {
    return (
      <div className="mt-3">
        <p aria-live="polite" className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <LabMark state="none" title={COPY.verdict.insufficient} />
          <span className="font-semibold text-ink">{COPY.verdict.insufficient}</span>
          <span className="text-ink-2 tnum">{run.avail[run.test].reason ?? L.needs(run.avail[run.test].need)}</span>
        </p>
        <LogLine log={run.log} pending={run.logPending} />
      </div>
    );
  }

  const v = resultView(o.stats, { unit, months: n, monthLabel });
  const s = o.stats;
  const k = slopeScale(n).k;
  return (
    <div className="mt-3">
      <div aria-live="polite" aria-busy={run.pending} className={`transition-opacity ${run.pending ? "opacity-55" : ""}`}>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <LabMark state={v.significant == null ? "none" : v.significant ? "sig" : "not"} title={v.significant == null ? L.descriptive : v.significant ? L.sig : L.notSig} />
          <span className="text-base font-semibold text-ink">{v.headline}</span>
          {v.significant != null && <span className="text-sm text-ink-2">{L.alpha}</span>}
          {v.note && <span className="text-sm text-ink-2">{v.note}</span>}
          {run.pending && <span className="text-xs text-ink-3">{L.computing}</span>}
        </p>
        {run.baselineWarning && (
          <p role="note" className="mt-1 text-sm text-synthetic"><span aria-hidden="true">⚠ </span>{L.baselineWarn}</p>
        )}

        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-3 tnum md:grid-cols-4">
          {v.cells.map((c) => (
            <div key={c.label} className="min-w-0">
              <dt className="text-xs text-ink-3">{c.label}<TagNote tag={c.tag} /></dt>
              <dd className="text-base leading-tight font-semibold text-ink">{c.value}</dd>
              {c.sub && <dd className="text-xs text-ink-2">{c.sub}</dd>}
            </div>
          ))}
        </dl>

        {s.tool === "acf" && <AcfFigure s={s} />}
        {s.tool === "normality" && <NormalFigure s={s} unit={unit} />}
        {s.tool === "bootstrap" && <BootFigure s={s} k={k} unit={unit} />}
        {s.tool === "permutation" && <PermFigure s={s} k={k} unit={unit} />}
        {s.tool === "cusum" && <CusumFigure s={s} months={months} polarity={polarity} />}
        {s.tool === "monthly" && <MonthlyFigure s={s} polarity={polarity} unit={unit} />}
        {s.tool === "spectrum" && <SpectrumFigure s={s} />}

        {onShowAnomaly && run.overlay && (
          <button type="button" onClick={onShowAnomaly} title={L.onAnomalyTitle}
            className="mt-2 text-sm font-semibold text-link underline decoration-1 underline-offset-2 hover:text-ink">
            {L.onAnomaly}
          </button>
        )}
      </div>

      <details className="group mt-2">
        <summary className={summaryCls}>
          {chevron}
          <span className="font-semibold text-ink-2">{L.details}</span>
        </summary>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pb-2 pl-5 text-sm tnum">
          {v.details.map((r) => (
            <Fragment key={r.label}>
              <dt className="text-ink-2">{r.label}</dt>
              <dd className="text-ink">{r.value}<TagNote tag={r.tag} /></dd>
            </Fragment>
          ))}
          <dd className="col-span-2 text-xs text-ink-3">{v.method}</dd>
        </dl>
      </details>
      <LogLine log={run.log} pending={run.logPending} />
    </div>
  );
}

/* ------------------------------------------------------------------ multiple-testing log */

const STATUS_MARK: Record<HolmStatus, MarkState> = { holds: "sig", "uncorrected-only": "half", "not-significant": "not" };

/** One collapsed line once two or more tests with a p value have run on this range; Holm per test inside. */
function LogLine({ log, pending }: { log: TestLog; pending: boolean }) {
  const G = COPY.lab.log;
  if (pending || log.entries.length < 2) return null;
  const text: Record<HolmStatus, string> = { holds: G.holds, "uncorrected-only": G.uncorrectedOnly, "not-significant": G.notSig };
  return (
    <details className="group">
      <summary className={summaryCls} title={G.title}>
        {chevron}
        <span className="text-ink-2 tnum">{G.summary(log.entries.length, log.significant, (Math.round(log.expected * 100) / 100).toString())}</span>
      </summary>
      <ul className="pb-2 pl-5 text-sm tnum">
        {log.entries.map((e) => (
          <li key={e.test} className="grid grid-cols-[1rem_minmax(7rem,auto)_4.5rem_1fr] items-baseline gap-x-2 py-0.5">
            <LabMark state={STATUS_MARK[e.status]} title={text[e.status]} size={11} />
            <span className="text-ink">{COPY.lab.test[e.test]}</span>
            <span className="text-ink-2">{pValue(e.p)}</span>
            <span className="text-ink-2">{text[e.status]}</span>
          </li>
        ))}
        <li className="pt-1 text-xs text-ink-3">{G.reset}</li>
      </ul>
    </details>
  );
}
