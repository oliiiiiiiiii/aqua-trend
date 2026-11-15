"use client";
// /batch: many questions from one CSV (format: /docs/batch-questions.md, parser: lib/detective/batchCsv.ts).
//
//   1. the file is read in the browser and parsed (no upload);
//   2. every row is completed like a single question: place (lib/detective/batchRun.resolveRegion), period,
//      variables (the row's, else the suggester of the input page);
//   3. three rows at a time are analysed with the same functions as the workbench, for the event period;
//   4. each answer links to the full workbench (the usual /detective URL), and all of them download as one CSV.
//
// The file text and the reader's sub-basin choices live in sessionStorage, finished answers in a module cache, so
// coming Back from a workbench shows the table as it was instead of starting over.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { Region } from "@/lib/types";
import type { CategoryId, LayerId, RegionId, SelectResponse } from "@/lib/detective/contracts";
import { BATCH_MAX_CHARS, BATCH_MAX_ROWS, BATCH_TEMPLATE, batchResultsCsv, parseBatchCsv, type BatchQuestion, type BatchResultRow } from "@/lib/detective/batchCsv";
import {
  answerQuestion, jobKey, makeRegionLookup, resolveRegion, unusualVariables,
  type BatchAnswer, type BatchDeps, type BatchJob, type RegionLookup, type RegionResolution, type VariableAnswer,
} from "@/lib/detective/batchRun";
import { loadCatalog } from "@/lib/data";
import { CATEGORY_ORDER } from "@/lib/detective/categories";
import { anomalyPolarity } from "@/lib/detective/polarity";
import { loadCountryNames, loadSeries, loadSeriesIndex, loadVariableCatalog, type VariableCatalog } from "@/lib/detective/series";
import { encodeQuery, formatRange } from "@/lib/detective/url";
import { RetryButton, StatusCard } from "@/components/ui/StatusCard";
import { downloadText } from "@/components/ui/download";
import { formatArea } from "@/components/ui/regionUtils";
import { COPY } from "../copy/batch";
import { CATEGORIES, requestVotes, variableMetadata } from "../wiring";
import { VerdictMark } from "../workbench/bits";
import { sigmaText, verdictView } from "../workbench/model";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const STORE = "aqua-trend-batch";
const CONCURRENCY = 3;
const NO_LAYERS: ReadonlySet<LayerId> = new Set();

/* ------------------------------------------------------------------ session state */

type Outcome = { ok: true; answer: BatchAnswer } | { ok: false; message: string };
/** finished answers by jobKey: kept for the browser session, so Back from a workbench does not re-run anything */
const outcomes = new Map<string, Outcome>();
/** the suggester's reply per question text (choosing another sub-basin for a row must not ask the model again) */
const suggestions = new Map<string, SelectResponse>();

async function suggestOnce(event: string, signal: AbortSignal): Promise<SelectResponse> {
  const known = suggestions.get(event);
  if (known) return known;
  const res = await requestVotes(event, signal);
  suggestions.set(event, res);
  return res;
}

interface Source { name: string; text: string }
interface Stored extends Source { picks?: Record<string, string> }

function readStore(): Stored | null {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(STORE) ?? "null");
    if (v && typeof v === "object" && typeof (v as Stored).text === "string" && typeof (v as Stored).name === "string") return v as Stored;
  } catch { /* private window, blocked storage, junk */ }
  return null;
}
function writeStore(v: Stored | null) {
  try { if (v) sessionStorage.setItem(STORE, JSON.stringify(v)); else sessionStorage.removeItem(STORE); } catch { /* the page works without it */ }
}

/* ------------------------------------------------------------------ data */

interface Data { vc: VariableCatalog; lookup: RegionLookup; deps: BatchDeps }
type Load = { status: "loading" } | { status: "ready"; data: Data } | { status: "error"; message: string };

function useData(): [Load, () => void] {
  const [state, setState] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([loadVariableCatalog(), loadSeriesIndex(), loadCatalog(), loadCountryNames().catch(() => null)]).then(
      ([vc, index, catalog, countryNames]) => {
        if (!live) return;
        const searchable = catalog.regions.filter((r) => r.type === "basin4" && index.has(r.id));
        setState({
          status: "ready",
          data: {
            vc,
            lookup: makeRegionLookup(catalog.byId, searchable, countryNames),
            deps: { vc, layersOf: (r: RegionId) => index.get(r) ?? NO_LAYERS, loadSeries, suggest: suggestOnce },
          },
        });
      },
      (e: unknown) => live && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => { live = false; };
  }, [attempt]);
  return [state, () => { setState({ status: "loading" }); setAttempt((a) => a + 1); }];
}

/* ------------------------------------------------------------------ rows */

interface Row {
  q: BatchQuestion;
  /** null while the catalogue loads */
  where: RegionResolution | null;
  region: Region | null;
  /** set when the row can be answered */
  job: BatchJob | null;
  key: string | null;
}

function buildRows(questions: BatchQuestion[], lookup: RegionLookup | null, picks: Record<string, string>): Row[] {
  return questions.map((q) => {
    const where = lookup ? resolveRegion(q, lookup) : null;
    const picked = where?.candidates.find((r) => r.id === picks[String(q.line)]);
    const region = picked ?? where?.region ?? null;
    const job = !q.problems.length && q.time && region
      ? { question: q.question, time: q.time, region: region.id, categories: q.categories, padMonths: q.padMonths }
      : null;
    return { q, where, region, job, key: job ? jobKey(job) : null };
  });
}

/** the categories a workbench link opens with: everything the answer could find a series for, most unusual first */
function workbenchHref(job: BatchJob, a: BatchAnswer): string | null {
  const cats = a.variables.filter((v) => v.layer).map((v) => v.category);
  if (!cats.length) return null;
  const top = [...a.variables].filter((v) => v.detail?.meanZ != null).sort((x, y) => Math.abs(y.detail!.meanZ!) - Math.abs(x.detail!.meanZ!))[0];
  return `/detective?${encodeQuery({
    event: job.question, time: job.time, region: job.region, categories: cats, padMonths: job.padMonths, active: top?.category ?? cats[0],
  })}`;
}

/* ================================================================== the page */

export default function BatchApp() {
  const [load, retryData] = useData();
  const data = load.status === "ready" ? load.data : null;

  const [source, setSource] = useState<Source | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [readError, setReadError] = useState<string | null>(null);
  const restored = useRef(false);
  useEffect(() => {
    const s = readStore();
    if (s) { setSource({ name: s.name, text: s.text }); setPicks(s.picks ?? {}); }
    restored.current = true;
  }, []);
  useEffect(() => {
    if (restored.current) writeStore(source ? { ...source, picks } : null);
  }, [source, picks]);

  const take = useCallback((name: string, text: string) => {
    setReadError(null);
    setPicks({});
    setSource({ name, text });
  }, []);
  const readFile = useCallback((file: File | null | undefined) => {
    if (!file) return;
    if (file.size > BATCH_MAX_CHARS * 4) { setReadError(COPY.fileError["too-large"]); return; }
    file.text().then((text) => take(file.name, text), () => setReadError(COPY.upload.readFailed));
  }, [take]);

  const parse = useMemo(() => (source ? parseBatchCsv(source.text) : null), [source]);
  const rows = useMemo(() => buildRows(parse?.questions ?? [], data?.lookup ?? null, picks), [parse, data, picks]);

  /* ---------------- run: three rows at a time; finished answers are never asked again */
  const [, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(new Set<string>());
  const jobsKey = rows.map((r) => r.key ?? "").join("\n");
  useEffect(() => {
    if (!data) return;
    const ctl = new AbortController();
    const seen = new Set<string>();
    const todo = rows.filter((r): r is Row & { job: BatchJob; key: string } => {
      if (!r.job || !r.key || outcomes.has(r.key) || seen.has(r.key)) return false;
      seen.add(r.key);
      return true;
    });
    let next = 0;
    const bump = () => setVersion((v) => v + 1);
    const worker = async () => {
      while (next < todo.length && !ctl.signal.aborted) {
        const { job, key } = todo[next++];
        running.current.add(key);
        bump();
        try {
          const answer = await answerQuestion(job, data.deps, ctl.signal);
          outcomes.set(key, { ok: true, answer });
        } catch (e) {
          if (!ctl.signal.aborted) outcomes.set(key, { ok: false, message: e instanceof Error ? e.message : String(e) });
        } finally {
          running.current.delete(key);
        }
        if (!ctl.signal.aborted) bump();
      }
    };
    for (let i = 0; i < CONCURRENCY; i++) void worker();
    return () => ctl.abort();
    // jobsKey is the identity of the rows that can be answered; `attempt` re-runs failed ones
  }, [data, jobsKey, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = (key: string) => { outcomes.delete(key); setAttempt((a) => a + 1); };

  /* ---------------- counts and the download */
  const answerable = rows.filter((r) => r.key);
  const done = answerable.filter((r) => outcomes.get(r.key!)?.ok).length;
  const failed = answerable.filter((r) => outcomes.get(r.key!)?.ok === false).length;
  const skipped = data ? rows.length - answerable.length : rows.filter((r) => r.q.problems.length).length;
  const finished = !!data && done + failed === answerable.length;

  const download = () => {
    if (!source || !data) return;
    const out: BatchResultRow[] = rows.map((r) => {
      const o = r.key ? outcomes.get(r.key) : undefined;
      const a = o?.ok ? o.answer : null;
      const href = r.job && a ? workbenchHref(r.job, a) : null;
      return {
        line: r.q.line, question: r.q.question, time: r.q.time, regionId: r.region?.id ?? "", regionName: r.region?.name ?? "",
        padMonths: r.q.padMonths, variablesFrom: a?.chosenBy ?? "",
        status: a ? "answered" : o && !o.ok ? COPY.answer.failed(o.message) : problemsOf(r).join(" ") || COPY.answer.queued,
        variables: (a?.variables ?? []).map((v) => {
          const meta = v.layer && data.vc.layers[v.layer] ? variableMetadata(data.vc.layers[v.layer], v.unit ?? undefined) : null;
          return {
            category: v.category, name: meta?.name ?? CATEGORIES[v.category].name.en, product: meta?.product ?? "", layer: v.layer ?? "",
            unit: meta?.unit ?? "", status: v.status === "ok" ? "ok" : [COPY.answer.status[v.status], v.message].filter(Boolean).join(": "), detail: v.detail,
          };
        }),
        link: href ? `${window.location.origin}${BASE}${href.replace("/detective?", "/detective/?")}` : "",
      };
    });
    const csv = batchResultsCsv({ source: source.name, generated: new Date().toISOString(), note: COPY.summary.downloadNote }, out);
    downloadText(`${source.name.replace(/\.[^.]+$/, "") || "questions"}-answers.csv`, csv);
  };

  /* ---------------- drop zone */
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files?.[0]); };
  const secondary = "min-h-10 rounded-ctl border border-line px-4 py-1.5 text-sm font-semibold text-ink hover:border-ink-3";
  const primary = "min-h-10 rounded-ctl bg-action px-4 py-1.5 text-sm font-semibold text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <>
      <div className="on-stage stage-sky">
        <div className="mx-auto max-w-[90rem] px-4 pt-8 pb-10 sm:px-6 lg:px-8 lg:pt-12 lg:pb-12">
          <h1 className="text-[2.5rem] sm:text-5xl">{COPY.title}</h1>
          <p className="mt-4 max-w-[62ch] text-lg text-on-stage-2">{COPY.lede}</p>
        </div>
      </div>

      <div className="mx-auto max-w-[90rem] px-4 py-10 sm:px-6 lg:px-8">
        {load.status === "error" && (
          <StatusCard className="mb-8 max-w-xl" title={COPY.dataError} action={<RetryButton onClick={retryData} />}><p>{load.message}</p></StatusCard>
        )}

        <section aria-labelledby="batch-upload" className="max-w-[60rem]">
          <h2 id="batch-upload" className="text-2xl">{COPY.upload.heading}</h2>
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={`mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border-2 border-dashed px-5 py-5 ${over ? "border-focus bg-well" : "border-line"}`}
          >
            <input
              ref={input} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="sr-only" aria-label={COPY.upload.fileLabel}
              onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ""; }}
            />
            <p className="text-ink-2">{COPY.upload.drop} <span className="text-ink-3">{COPY.upload.or}</span></p>
            <button type="button" onClick={() => input.current?.click()} className={primary}>{source ? COPY.upload.replace : COPY.upload.choose}</button>
            <button type="button" onClick={() => take("example.csv", BATCH_TEMPLATE)} className={secondary}>{COPY.upload.example}</button>
            <button type="button" onClick={() => downloadText("batch-questions.csv", BATCH_TEMPLATE)} className={secondary}>{COPY.upload.template}</button>
            {source && (
              <button type="button" onClick={() => { setSource(null); setPicks({}); setReadError(null); }} className="ml-auto text-sm text-link underline underline-offset-2">
                {COPY.upload.clear}
              </button>
            )}
          </div>
          {readError && <p role="alert" className="mt-2 text-sm text-ink"><Warn />{readError}</p>}
          <p className="mt-2 text-sm text-ink-2">{COPY.upload.stays}</p>
          <FormatHelp open={!source} />
        </section>

        {source && parse && (
          <section aria-labelledby="batch-results" className="mt-10">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 border-b border-line pb-3">
              <h2 id="batch-results" className="min-w-0 text-2xl break-words">{COPY.summary.file(source.name)}</h2>
              {!parse.error && (
                <>
                  <p className="text-sm text-ink-2 tnum" role="status">
                    {COPY.summary.counts(rows.length)}
                    {" · "}<span className="font-semibold text-ink">{COPY.summary.progress(done, answerable.length)}</span>
                    {skipped > 0 && <> · {COPY.summary.skipped(skipped)}</>}
                    {failed > 0 && <> · {COPY.summary.failed(failed)}</>}
                  </p>
                  {!finished && answerable.length > 0 && (
                    <span className="relative block h-[3px] w-32 self-center overflow-hidden rounded-full bg-well" aria-hidden="true">
                      <span className="absolute inset-y-0 left-0 rounded-full bg-focus transition-[width] duration-300" style={{ width: `${(100 * (done + failed)) / answerable.length}%` }} />
                    </span>
                  )}
                  <button type="button" onClick={download} disabled={!data || done === 0} title={COPY.summary.downloadTitle} className={`${primary} ml-auto`}>
                    {COPY.summary.download}
                  </button>
                </>
              )}
            </div>

            {parse.error ? (
              <p role="alert" className="mt-4 max-w-[68ch] text-ink"><Warn />{COPY.fileError[parse.error]}</p>
            ) : (
              <>
                <ul className="mt-3 space-y-1 text-sm text-ink-2">
                  {parse.ignoredColumns.length > 0 && <li>{COPY.notice.ignored(parse.ignoredColumns)}</li>}
                  {parse.dropped > 0 && <li><Warn />{COPY.notice.dropped(parse.dropped, BATCH_MAX_ROWS)}</li>}
                  {parse.unclosedQuoteLine !== null && <li><Warn />{COPY.notice.unclosed(parse.unclosedQuoteLine)}</li>}
                </ul>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[62rem] border-collapse text-left text-[0.9375rem]">
                    <caption className="sr-only">{COPY.table.caption}</caption>
                    <thead>
                      <tr className="border-b border-line text-sm text-ink-2">
                        <th scope="col" title={COPY.table.lineTitle} className="w-12 py-2 pr-3 font-normal">{COPY.table.line}</th>
                        <th scope="col" className="w-[24%] py-2 pr-5 font-normal">{COPY.table.question}</th>
                        <th scope="col" className="w-[11%] py-2 pr-5 font-normal">{COPY.table.when}</th>
                        <th scope="col" className="w-[19%] py-2 pr-5 font-normal">{COPY.table.where}</th>
                        <th scope="col" className="py-2 pr-5 font-normal">{COPY.table.answer}</th>
                        <th scope="col" className="w-20 py-2 font-normal">{COPY.table.open}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <RowView
                          key={r.q.line} row={r} vc={data?.vc ?? null} loading={!data}
                          outcome={r.key ? outcomes.get(r.key) : undefined} working={!!r.key && running.current.has(r.key)}
                          onPick={(id) => setPicks((p) => ({ ...p, [String(r.q.line)]: id }))}
                          onRetry={() => r.key && retry(r.key)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-4 max-w-[80ch] text-sm text-ink-2">{COPY.footnote}</p>
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

const Warn = () => <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 translate-y-[-1px] rounded-full bg-[color:var(--status-warning)]" />;

/** why a row is skipped, in words */
function problemsOf(r: Row): string[] {
  const out: string[] = r.q.problems.map((p) => COPY.problem[p.code](p.detail));
  if (!r.q.problems.length && r.where?.problem) out.push(COPY.region[r.where.problem](r.q.region));
  return out;
}

function RowView({ row, vc, loading, outcome, working, onPick, onRetry }: {
  row: Row; vc: VariableCatalog | null; loading: boolean; outcome: Outcome | undefined; working: boolean;
  onPick: (id: string) => void; onRetry: () => void;
}) {
  const { q, where, region } = row;
  const problems = problemsOf(row);
  const notes = q.notes.map((n) => COPY.note[n.code](n.detail));
  const answer = outcome?.ok ? outcome.answer : null;
  const href = row.job && answer ? workbenchHref(row.job, answer) : null;
  return (
    <tr className="border-b border-line align-top">
      <td className="py-3 pr-3 text-sm text-ink-3 tnum">{q.line}</td>
      <th scope="row" className="py-3 pr-5 font-normal break-words text-ink">{q.question || <span className="text-ink-3">—</span>}</th>
      <td className="py-3 pr-5 tnum">
        {q.time ? formatRange(q.time) : <span className="text-ink-3">—</span>}
        {q.timeSource === "question" && <span className="block text-xs text-ink-2">{COPY.when.fromQuestion}</span>}
      </td>
      <td className="py-3 pr-5">
        {region && where ? (
          <>
            {where.candidates.length > 1 ? (
              <select
                value={region.id} onChange={(e) => onPick(e.target.value)} aria-label={COPY.where.choose(q.line)}
                className="w-full max-w-[17rem] border-b border-line bg-transparent py-0.5 pr-1 text-ink hover:border-ink-3"
              >
                {where.candidates.map((c) => <option key={c.id} value={c.id}>{c.name} · {formatArea(c.areaKm2)}</option>)}
              </select>
            ) : (
              <span className="text-ink">{region.name}</span>
            )}
            <span className="block text-xs text-ink-2 tnum">
              {where.candidates.length > 1 ? "" : `${formatArea(region.areaKm2)} · `}
              {where.via === "id" ? region.id : where.via === "name" ? COPY.where.matched(q.region) : COPY.where.fromQuestion}
              {where.candidates.length > 1 && ` · ${COPY.where.others(where.candidates.length)}`}
            </span>
          </>
        ) : (
          <span className="text-ink-3">{q.region || "—"}</span>
        )}
      </td>
      <td className="py-3 pr-5">
        {problems.length > 0 ? (
          <div>
            <p className="text-sm font-semibold text-ink"><Warn />{COPY.answer.skipped}</p>
            {problems.map((m) => <p key={m} className="text-sm text-ink-2">{m}</p>)}
          </div>
        ) : loading ? (
          <Busy>{COPY.answer.loadingData}</Busy>
        ) : outcome?.ok === false ? (
          <p className="text-sm text-ink">
            <Warn />{COPY.answer.failed(outcome.message)}{" "}
            <button type="button" onClick={onRetry} className="font-semibold text-link underline underline-offset-2">{COPY.answer.retry}</button>
          </p>
        ) : answer ? (
          <AnswerView answer={answer} vc={vc} />
        ) : (
          <Busy quiet={!working}>{working ? COPY.answer.working : COPY.answer.queued}</Busy>
        )}
        {notes.map((m) => <p key={m} className="mt-1 text-xs text-ink-2">{m}</p>)}
      </td>
      <td className="py-3">
        {href && (
          <Link href={href} title={COPY.answer.openTitle} className="font-semibold whitespace-nowrap text-link underline underline-offset-2">
            {COPY.answer.open}<span aria-hidden="true"> →</span>
          </Link>
        )}
      </td>
    </tr>
  );
}

function Busy({ children, quiet = false }: { children: string; quiet?: boolean }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-ink-2">
      <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${quiet ? "bg-line" : "animate-pulse bg-water"}`} />
      {children}
    </p>
  );
}

const order = (c: CategoryId) => CATEGORY_ORDER.indexOf(c);

function AnswerView({ answer, vc }: { answer: BatchAnswer; vc: VariableCatalog | null }) {
  const vars = [...answer.variables].sort((a, b) => order(a.category) - order(b.category));
  const analysed = vars.filter((v) => v.status === "ok").length;
  return (
    <div>
      <p className="font-semibold text-ink">{COPY.answer.unusual(unusualVariables(answer).length, analysed)}</p>
      {vars.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1.5">
          {vars.map((v) => <li key={v.category}><VariableChip v={v} vc={vc} /></li>)}
        </ul>
      ) : (
        <p className="text-sm text-ink-2">{COPY.answer.none}</p>
      )}
      <p className="mt-1.5 text-xs text-ink-2">
        {COPY.answer.chosenBy[answer.chosenBy]}
        {answer.dropped.length > 0 && <> · {COPY.answer.dropped(answer.dropped.map((c) => CATEGORIES[c].name.en))}</>}
      </p>
    </div>
  );
}

function VariableChip({ v, vc }: { v: VariableAnswer; vc: VariableCatalog | null }) {
  const info = v.layer ? vc?.layers[v.layer] : undefined;
  const name = info ? variableMetadata(info, v.unit ?? undefined).name : CATEGORIES[v.category].name.en;
  const frame = "inline-flex items-center gap-1.5 rounded-ctl border px-2.5 py-0.5 text-sm whitespace-nowrap";
  if (v.status !== "ok" || !v.detail) {
    return (
      <span title={v.message ?? undefined} className={`${frame} border-line text-ink-3`}>
        {name}<span className="text-xs">{COPY.answer.status[v.status]}</span>
      </span>
    );
  }
  const view = verdictView(v.detail);
  return (
    <span title={[view.label, view.note, info?.product].filter(Boolean).join(" · ")} className={`${frame} ${view.emphasis ? "border-ink-3 text-ink" : "border-line text-ink-2"}`}>
      <VerdictMark d={v.detail} polarity={anomalyPolarity(v.category)} />
      {name}
      <span className={`tnum ${view.emphasis ? "font-semibold" : ""}`}>{sigmaText(v.detail.meanZ)}</span>
    </span>
  );
}

function FormatHelp({ open }: { open: boolean }) {
  const F = COPY.format;
  return (
    <details open={open} className="mt-4 border-t border-line">
      <summary className="cursor-pointer py-2.5 font-semibold text-link hover:underline">{F.summary}</summary>
      <div className="space-y-3 pb-2 text-[0.9375rem] text-ink-2">
        <p className="max-w-[68ch]">{F.intro}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-sm">{F.head.map((h) => <th key={h} scope="col" className="py-1.5 pr-5 font-normal">{h}</th>)}</tr>
            </thead>
            <tbody>
              {F.rows.map(([col, what, empty]) => (
                <tr key={col} className="border-b border-line/60 align-top">
                  <th scope="row" className="py-1.5 pr-5 font-mono text-[0.875rem] font-normal text-ink">{col}</th>
                  <td className="py-1.5 pr-5">{what}</td>
                  <td className="py-1.5">{empty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="max-w-[80ch]">
          <span className="text-ink">{F.ids}:</span>{" "}
          {CATEGORY_ORDER.map((c, i) => (
            <span key={c}>{i > 0 && ", "}<span className="font-mono text-[0.875rem] text-ink" title={CATEGORIES[c].name.en}>{c}</span></span>
          ))}
        </p>
        <pre className="w-fit max-w-full overflow-x-auto rounded-[10px] bg-well px-3 py-2 font-mono text-[0.8125rem] leading-relaxed text-ink">{BATCH_TEMPLATE.trimEnd()}</pre>
        <p className="max-w-[80ch]">{F.more}</p>
      </div>
    </details>
  );
}
