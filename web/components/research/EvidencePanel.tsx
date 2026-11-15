"use client";
// Evidence and record (spec §7.3, §10; data contract §9.3, §9.4; acceptance T09–T12): the comparison families
// the corrected labels belong to, the versions that make the result reproducible, and JSON / CSV exports of the
// same backend snapshot the page shows.
import { useState } from "react";
import { downloadText } from "@/components/evidence/csv";
import { exportUrl, fetchExport, getFamily, isAbort, ResearchApiError } from "@/lib/research/api";
import { FAMILY_SCOPE_LABEL, methodLabel, pText, short } from "@/lib/research/format";
import type { EvidenceFamily, HypothesisRecord, ResearchResult } from "@/lib/research/types";
import { btnQuiet, Card, Facts, Notice, Pill, summaryCls, tdCls, thCls } from "./ui";

const SCOPE_HELP: Record<string, string> = {
  query: "Every variable and indicator metric tested in this one research. Corrected labels of a plain query come from here.",
  preset_search: "Every region, period, variable and metric the preset search tested, including the ones that were not chosen. A preset keeps this larger family; a smaller query family does not replace it.",
};

function componentText(h: HypothesisRecord): string {
  const c = h.components ?? {};
  const pick = (k: string) => (c[k] == null ? null : String(c[k]));
  const subject = pick("indicator_id") ?? pick("variable_id") ?? "?";
  const parts = [pick("metric_id") ?? subject, pick("region_id"), pick("product_id") ?? pick("event_catalogue_id")];
  const period = (c.analysis_period ?? c.period) as { start?: string; end?: string } | string | undefined;
  if (period && typeof period === "object" && period.start) parts.push(`${period.start}..${period.end}`);
  else if (typeof period === "string") parts.push(period);
  else if (pick("period_start")) parts.push(`${pick("period_start")}..${pick("period_end")}`);
  return parts.filter(Boolean).join(" · ");
}

function HypothesisTable({ rows }: { rows: HypothesisRecord[] }) {
  return (
    <div role="region" aria-label="Hypotheses of this family, scrollable table" tabIndex={0} className="mt-2 max-h-96 overflow-auto border border-line" style={{ borderRadius: "min(var(--r-ctl), 8px)" }}>
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <thead className="sticky top-0 bg-paper">
          <tr className="border-b border-line">
            <th scope="col" className={thCls}>Hypothesis</th>
            <th scope="col" className={thCls}>Tested</th>
            <th scope="col" className={thCls}>Raw p</th>
            <th scope="col" className={thCls}>Adjusted p</th>
            <th scope="col" className={thCls}>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.hypothesis_id} className="border-b border-line align-top">
              <th scope="row" className="px-3 py-1.5 text-left font-normal">
                {componentText(h)}
                <span className="block text-[0.8125rem] text-ink-3" title={h.hypothesis_id}><code>{short(h.hypothesis_id, 16)}</code></span>
              </th>
              <td className="px-3 py-1.5">{h.tested ? "yes" : "no"}</td>
              <td className={tdCls}>{h.tested ? pText(h.p_raw) : "—"}</td>
              <td className={tdCls}>{h.tested ? pText(h.p_adjusted) : "—"}</td>
              <td className="px-3 py-1.5">
                {h.tested
                  ? h.significant == null ? "undetermined" : h.significant ? "significant after correction" : "not significant after correction"
                  : `not tested: ${h.untested_reason ?? "no reason recorded"}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FamilyBlock({ family, researchId }: { family: EvidenceFamily; researchId: string }) {
  /** rows fetched from the stored family, replacing the embedded sample once the first page arrives */
  const [stored, setStored] = useState<{ rows: HypothesisRecord[]; next: number | null; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const policy = family.candidate_policy ?? {};
  const rows = stored?.rows ?? family.hypotheses;
  const more = stored ? stored.next != null : family.hypotheses_truncated;
  const loadMore = async () => {
    setLoading(true); setErr(null);
    try {
      const page = await getFamily(researchId, family.family_id, stored?.next ?? 0);
      const got = page.hypotheses ?? [];
      setStored((prev) => ({
        rows: prev ? [...prev.rows, ...got] : got,
        next: page.page?.next_offset ?? null,
        total: page.page?.total ?? (prev ? prev.rows.length : 0) + got.length,
      }));
    } catch (e) {
      if (!isAbort(e)) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div data-testid="family" data-scope={family.scope} className="border-t border-line pt-4">
      <h3 className="flex flex-wrap items-center gap-2 text-lg">
        {FAMILY_SCOPE_LABEL[family.scope] ?? family.scope}
        {family.complete ? (
          <Pill tone="real"><span aria-hidden="true">✓</span> Complete</Pill>
        ) : (
          <Pill tone="warn"><span aria-hidden="true">!</span> Not complete: labels are provisional</Pill>
        )}
      </h3>
      <p className="mt-1 max-w-[80ch] text-sm text-ink-2">{SCOPE_HELP[family.scope] ?? ""}</p>
      <Facts
        className="mt-2"
        rows={[
          ["Correction method", `${methodLabel(family.method)}, level ${family.alpha}`],
          ["Size", <span key="s" className="tnum">{family.n_candidates} candidates: {family.n_tested} tested, {family.n_untested} not tested</span>],
          [
            "Candidate policy (declared before testing)",
            <>
              {String(policy.description ?? policy.id ?? "not described")}
              {policy.id || policy.version ? <span className="text-ink-3"> ({[policy.id, policy.version].filter(Boolean).map(String).join(", ")})</span> : null}
            </>,
          ],
          ["Family id", <code key="f" className="text-[0.8125rem] break-all">{family.family_id}</code>],
          ...(family.content_hash ? [["Content hash", <code key="h" className="text-[0.8125rem] break-all">{family.content_hash}</code>] as [string, React.ReactNode]] : []),
        ]}
      />
      <details className="mt-1">
        <summary className={summaryCls}>
          Hypotheses ({rows.length}{more ? ` shown of ${stored?.total ?? family.n_candidates}` : ""})
        </summary>
        {more && (
          <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-2">
            {stored ? "More hypotheses are stored." : <>The result embeds only part of this family{family.external_ref ? <> (full record: <code className="text-[0.8125rem]">{family.external_ref}</code>)</> : null}.</>}
            <button type="button" className={btnQuiet} onClick={loadMore} disabled={loading}>
              {loading ? "Loading…" : stored ? "Load more" : "Load the stored family"}
            </button>
          </p>
        )}
        {err && <Notice tone="error" role="alert" className="mt-2">The full family could not be loaded: {err}</Notice>}
        {rows.length > 0 ? <HypothesisTable rows={rows} /> : <p className="mt-2 text-sm text-ink-2">No hypothesis is listed.</p>}
      </details>
    </div>
  );
}

export function EvidencePanel({ result }: { result: ResearchResult }) {
  const id = result.identity.research_id;
  const idn = result.identity;
  const [busy, setBusy] = useState<"json" | "csv" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const download = async (format: "json" | "csv") => {
    setBusy(format); setErr(null);
    try {
      const text = await fetchExport(id, format);
      downloadText(`aqua-trend-research-${id}.${format}`, text, format === "json" ? "application/json" : "text/csv;charset=utf-8");
    } catch (e) {
      if (isAbort(e)) return;
      setErr(e instanceof ResearchApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card aria-labelledby="evidence-h" data-testid="evidence">
      <h2 id="evidence-h" className="text-2xl">Evidence and record</h2>
      <p className="mt-1 max-w-[80ch] text-sm text-ink-2">
        A corrected label only means something inside its comparison family. The correction controls false discoveries among the listed tests; it does not repair an invalid test, it does not widen the pointwise confidence intervals, and it does not cover periods tried by hand across several runs.
      </p>

      <div className="mt-4 space-y-4">
        {result.evidence_families.length === 0 ? (
          <p className="text-ink-2">This result carries no comparison family, so no corrected label was published.</p>
        ) : (
          result.evidence_families.map((f) => <FamilyBlock key={f.family_id} family={f} researchId={id} />)
        )}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="text-lg">Export this result</h3>
        <p className="mt-1 max-w-[80ch] text-sm text-ink-2">
          Both files are written by the analysis service from the same snapshot as this page: JSON is the complete result, CSV lists the series with their product, time, raw and anomaly values and the plan and method information.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={btnQuiet} onClick={() => download("json")} disabled={busy != null} data-testid="export-json">
            {busy === "json" ? "Preparing JSON…" : "Download JSON"}
          </button>
          <button type="button" className={btnQuiet} onClick={() => download("csv")} disabled={busy != null} data-testid="export-csv">
            {busy === "csv" ? "Preparing CSV…" : "Download CSV"}
          </button>
          <span className="text-[0.8125rem] text-ink-3">
            Direct links: <a className="text-link underline underline-offset-2" href={exportUrl(id, "json")}>JSON</a>,{" "}
            <a className="text-link underline underline-offset-2" href={exportUrl(id, "csv")}>CSV</a>
          </span>
        </div>
        {err && <Notice tone="error" role="alert" className="mt-2">The export failed: {err} The result on this page is unchanged.</Notice>}
      </div>

      <div className="mt-5 border-t border-line pt-4" data-testid="versions">
        <h3 className="text-lg">Versions</h3>
        <Facts
          className="mt-2"
          rows={[
            ["Research id", <code key="r" className="text-[0.8125rem] break-all">{idn.research_id}</code>],
            ["Created", idn.created_at],
            ["Dataset", idn.dataset_version],
            ["Catalogue", idn.catalogue_version],
            ["Region catalogue", idn.region_catalogue_version],
            ["Indicator registry", idn.indicator_registry_version],
            ["Method policy", idn.method_policy_version],
            ["Preset policy", idn.preset_policy_version],
            ["Quality policy", idn.quality_policy_version],
            ["Engine", idn.engine_version],
            ["Selection plan", idn.selection_plan_id ? <code key="p" className="text-[0.8125rem] break-all">{idn.selection_plan_id}</code> : "—"],
            ["Parent research", idn.parent_research_id ? <code key="pa" className="text-[0.8125rem] break-all">{idn.parent_research_id}</code> : "None"],
            ["Opened preset", idn.preset_ref ? `${idn.preset_ref.id}, version ${idn.preset_ref.version}` : "None"],
            ...(idn.cache_key ? [["Cache key", <code key="c" className="text-[0.8125rem] break-all">{idn.cache_key}</code>] as [string, React.ReactNode]] : []),
          ]}
        />
      </div>
    </Card>
  );
}
