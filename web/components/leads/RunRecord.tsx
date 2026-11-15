"use client";
import type { ReactNode } from "react";
import type { CandidateRecord, SyntheticRun } from "@/lib/synthetic";
import { exportRunRecord } from "@/lib/synthetic";
import { Provenance } from "@/components/ui/Provenance";

const OUTCOME_LABEL: Record<CandidateRecord["outcome"]["status"], string> = {
  analysed: "Analysed",
  "quality-only": "Used for quality only",
  duplicate: "Duplicate",
  "not-applicable": "Not applicable",
  failed: "Failed, retry pending",
  "not-run": "Not analysed",
};

function outcomeText(c: CandidateRecord, all: CandidateRecord[]): ReactNode {
  const o = c.outcome;
  if (o.status === "analysed") {
    const bits = [`${o.tests} test${o.tests === 1 ? "" : "s"}`];
    if (o.passedCorrection) bits.push(`${o.passedCorrection} passed correction`);
    if (o.leads) bits.push(`${o.leads} lead${o.leads === 1 ? "" : "s"}`);
    return <>{bits.join(", ")}{o.routesNotTested.length > 0 && <span className="block text-ink-2">Not tested: {o.routesNotTested.map((r) => r.reason).join(" ")}</span>}</>;
  }
  if (o.status === "duplicate") return <>Duplicate of {all.find((x) => x.id === o.duplicateOf)?.name ?? o.duplicateOf}. <span className="text-ink-2">{o.reason}</span></>;
  return o.reason ?? "";
}

const Cell = ({ k, v, note }: { k: string; v: ReactNode; note: string }) => (
  <tr>
    <th scope="row" className="border-t border-line px-2 py-1.5 text-left align-top font-semibold text-ink">{k}</th>
    <td className="tnum border-t border-line px-2 py-1.5 align-top text-ink">{v}</td>
    <td className="border-t border-line px-2 py-1.5 align-top text-ink-2">{note}</td>
  </tr>
);

export default function RunRecord({ run, defaultOpen }: { run: SyntheticRun; defaultOpen?: boolean }) {
  const L = run.ledger;
  const download = () => {
    const blob = new Blob([JSON.stringify(exportRunRecord(run), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aqua-trend-SYNTHETIC-run-record-${run.regionId}-${run.scenario}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const empty = L.familySize === 0;
  return (
    <details open={defaultOpen} className="group rounded-card border border-line bg-paper">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 font-semibold text-ink">
        How this run was searched
        <Provenance kind="synthetic" className="!px-2 !py-0 !text-xs">Synthetic record</Provenance>
      </summary>
      <div className="@container grid gap-6 border-t border-line p-4 text-[0.9375rem]">
        <p className="m-0 text-ink-2">
          Read-only. This record is generated with the synthetic examples above: the candidate list is a demo catalogue ({run.snapshot}), not a search of the whole NASA archive, and nothing here claims a full catalogue search was done.
        </p>

        <section>
          <h5 className="m-0 mb-2 font-display text-base text-ink">Coverage ledger</h5>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[20rem] border-collapse text-left text-[0.875rem]">
              <caption className="sr-only">Coverage ledger of the synthetic run</caption>
              <thead><tr><th className="px-2 py-1 text-ink-2">Step</th><th className="px-2 py-1 text-ink-2">Count</th><th className="px-2 py-1 text-ink-2">What it means</th></tr></thead>
              <tbody>
                <Cell k="Discovered" v={L.discovered} note={`Entries in the ${run.snapshot}.`} />
                <Cell k="Identified and de-duplicated" v={`${L.identified} (${L.duplicatesMerged} merged)`} note="Same product reached twice or a superseded version, merged and not counted as extra evidence." />
                <Cell k="Fetched" v={empty && L.fetched === 0 ? "0" : `${L.fetched} of ${L.identified}`} note={L.failed ? `${L.failed} failed and is pending.` : empty ? "Nothing was fetched: there is no target series to align them with." : "All retrieved."} />
                <Cell k="Eligible pairs" v={L.eligiblePairs} note={`${L.targets} target${L.targets === 1 ? "" : "s"} × ${L.eligibleCandidates} candidates with at least one applicable route. ${L.qualityOnly} quality-only entr${L.qualityOnly === 1 ? "y is" : "ies are"} not candidates.`} />
                <Cell k="Analysed" v={`${L.analysedPairs} pairs, ${L.testsAnalysed} tests`} note={`Tests are per route. ${L.routesNotTestable} route${L.routesNotTestable === 1 ? "" : "s"} could not be tested in this region (fewer than 8 land-model cells for spatial routes).`} />
                <Cell k="Corrected" v={L.familyFinal ? `${L.corrected} of ${L.familySize}` : `not final (${L.testsPending} pending)`} note={`Family size ${L.familySize} = targets × eligible candidates × applicable routes. Benjamini–Yekutieli FDR at 0.05.${L.familyFinal ? "" : " Pending tests count as p = 1 for now."}`} />
                <Cell k="Passed correction" v={L.passedCorrection} note={`${L.leadsRecommended} lead${L.leadsRecommended === 1 ? "" : "s"} after merging routes and the stability checks${L.leadsUnstable ? `; ${L.leadsUnstable} passed correction but failed stability and is not listed as a lead` : ""}.`} />
                <Cell k="Not significant" v={L.notSignificant} note="Kept in the record. Tested and not reliable." />
                <Cell k="Not applicable" v={L.notApplicable} note="With a data or method reason, listed below." />
                <Cell k="Failed or pending" v={L.failed} note={L.failed ? "Engineering gap, not a scientific exclusion. The run stays partial." : "None."} />
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h5 className="m-0 mb-2 font-display text-base text-ink">Search policy, frozen before the run</h5>
          <dl className="m-0 divide-y divide-line">
            {run.policy.map((p) => (
              <div key={p.label} className="grid gap-x-4 py-1.5 @md:grid-cols-[13rem_1fr]">
                <dt className="text-[0.8125rem] font-semibold text-ink-2">{p.label}</dt>
                <dd className="m-0 text-ink">{p.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h5 className="m-0 mb-2 font-display text-base text-ink">Candidates and what became of each</h5>
          <ul className="m-0 grid list-none gap-0 p-0">
            {run.candidates.map((c) => (
              <li key={c.id} className="grid gap-x-4 gap-y-0.5 border-t border-line py-2 @md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                <div className="min-w-0">
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="block text-[0.8125rem] text-ink-2">{c.product} {c.version} · {c.agency} · {c.kind}</span>
                </div>
                <div className="min-w-0">
                  <span className="font-semibold text-ink">{OUTCOME_LABEL[c.outcome.status]}</span>
                  <span className="block text-[0.875rem] text-ink-2">{outcomeText(c, run.candidates)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={download} className="rounded-ctl bg-action px-4 py-2 text-sm font-semibold text-on-action hover:bg-action-hover">
            Download run record (JSON)
          </button>
          <span className="text-[0.8125rem] text-ink-2">The file, its name and its contents state that it is synthetic demo data.</span>
        </div>
      </div>
    </details>
  );
}
