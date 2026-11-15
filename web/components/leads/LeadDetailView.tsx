"use client";
import type { ReactNode } from "react";
import type { LeadDetail } from "@/lib/synthetic";
import { LEAD_ROUTE_LABEL, fmtR } from "@/lib/synthetic";
import { VARIABLES } from "@/lib/variables";
import { Provenance } from "@/components/ui/Provenance";
import { LagChart, ScatterChart, SeasonChart, SeriesChart, SyntheticMark } from "./charts";

const H = ({ children }: { children: ReactNode }) => (
  <h5 className="m-0 mb-2 font-display text-base text-ink">{children}</h5>
);
const Sec = ({ children }: { children: ReactNode }) => (
  <section className="border-t border-line pt-4 first:border-t-0 first:pt-0">{children}</section>
);
const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="grid gap-x-4 gap-y-0.5 py-1.5 @md:grid-cols-[11rem_1fr]">
    <dt className="text-[0.8125rem] font-semibold text-ink-2">{k}</dt>
    <dd className="m-0 min-w-0 text-[0.9375rem] text-ink">{children}</dd>
  </div>
);

const OWN_ROUTE: Record<LeadDetail["route"], string> = { temporal: "temporal", lag: "lag", "spatial-static": "spatial", "spatial-trend": "spatial", grouped: "grouped" };
/** one-line summary of the pair's other analysis routes, e.g. "Spatial trend: insufficient evidence" */
export function leadStatusLine(l: LeadDetail): string {
  return l.routeStatuses
    .filter((r) => r.route !== OWN_ROUTE[l.route])
    .map((r) => `${r.label}: ${r.status === "passed" ? "also supported" : r.status === "insufficient" ? "insufficient evidence" : "not tested"}`)
    .join("; ");
}

export default function LeadDetailView({ lead, id, onClose }: { lead: LeadDetail; id: string; onClose: () => void }) {
  const vm = VARIABLES[lead.target];
  const sp = lead.route.startsWith("spatial") || lead.route === "grouped";
  const e = lead.effect;
  return (
    <div id={id} role="region" aria-label={`Detail: ${lead.title} (synthetic example)`} className="@container mt-3 grid gap-5 rounded-card border border-line bg-paper p-4 @md:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Provenance kind="synthetic">Synthetic example</Provenance>
            {lead.provisional && <span className="rounded-ctl bg-well px-2.5 py-0.5 text-[0.8125rem] font-semibold text-ink">Provisional, not final</span>}
            <span className="rounded-ctl bg-well px-2.5 py-0.5 text-[0.8125rem] font-semibold text-ink-2">{LEAD_ROUTE_LABEL[lead.route]}</span>
          </div>
          <h4 className="m-0 font-display text-xl text-ink">{lead.title}</h4>
          <p className="m-0 mt-1 text-[0.9375rem] text-ink-2">
            {vm.label} with {lead.candidate.name.toLowerCase()} ({lead.candidate.product}, {lead.candidate.agency}).
          </p>
        </div>
        <button type="button" onClick={onClose}
          className="rounded-ctl border border-line bg-paper px-4 py-1.5 text-sm font-semibold text-ink hover:bg-well">
          Close
        </button>
      </header>

      <Sec>
        <H>Evidence in one place</H>
        <dl className="m-0 divide-y divide-line">
          <Row k="Effect">
            <span className="tnum font-semibold">{e.label}: {fmtR(e.value)}</span>{" "}
            <span className="tnum text-ink-2">(interval {fmtR(e.lo)} to {fmtR(e.hi)})</span>
            <span className="mt-0.5 block text-[0.8125rem] text-ink-2">{e.intervalNote}</span>
          </Row>
          <Row k="Significance">
            <span className="tnum">Uncorrected p {lead.stats.pText}; adjusted q {lead.stats.qText}{lead.stats.qProvisional ? " (provisional)" : ""}</span>
            <span className="mt-0.5 block text-[0.8125rem] text-ink-2">
              q is Benjamini–Yekutieli across a family of {lead.stats.familySize} tests. A q of 0.05 or lower means the test passed; it is not the chance that this lead is right. {lead.stats.method}
            </span>
          </Row>
          <Row k="Stability">
            <span>{lead.stability.recommended ? "Both checks pass." : "Checks not passed."}</span>
            <span className="mt-0.5 block text-[0.8125rem] text-ink-2">{lead.stability.text}</span>
          </Row>
          <Row k="Other analyses">
            <ul className="m-0 list-none p-0">
              {lead.routeStatuses.map((r) => (
                <li key={r.route} className="text-[0.9375rem]">
                  <span className="font-semibold">{r.label}:</span>{" "}
                  <span className={r.status === "passed" ? "text-ink" : "text-ink-2"}>{r.status === "passed" ? "supported" : r.status === "insufficient" ? "insufficient evidence" : "not tested"}</span>
                  <span className="text-ink-2"> ({r.note})</span>
                </li>
              ))}
            </ul>
            <span className="mt-0.5 block text-[0.8125rem] text-ink-2">A relationship that is not supported is not hidden. This card does not imply the others hold.</span>
          </Row>
        </dl>
      </Sec>

      {lead.lag && (
        <Sec>
          <H>Who changes first</H>
          <p className="m-0 mb-3 text-[0.9375rem] text-ink">{lead.lag.text}</p>
          <LagChart lead={lead} />
        </Sec>
      )}

      {lead.seasonal && (
        <Sec>
          <H>Seasonality</H>
          <p className="m-0 mb-3 text-[0.9375rem] text-ink">{lead.seasonal.note}</p>
          <SeasonChart lead={lead} />
        </Sec>
      )}

      {lead.series && (
        <Sec>
          <H>The two series</H>
          <SeriesChart lead={lead} />
        </Sec>
      )}

      {sp && lead.scatter && (
        <Sec>
          <H>Where the trend is faster</H>
          <p className="m-0 mb-3 text-[0.9375rem] text-ink-2">
            Compares how fast the target is changing in each cell with {lead.scatter.kind === "category" ? "the land-cover class" : lead.route === "spatial-static" ? "the candidate value" : "how fast the candidate is changing"} in the same cell.
          </p>
          <ScatterChart lead={lead} />
        </Sec>
      )}

      <Sec>
        <H>Data scope</H>
        <dl className="m-0 divide-y divide-line">
          <Row k="Common period">
            {lead.scope.commonPeriod ? `${lead.scope.commonPeriod.start} to ${lead.scope.commonPeriod.end} (${lead.scope.commonPeriod.months} months)` : "Not applicable"}
            <span className="mt-0.5 block text-[0.8125rem] text-ink-2">Set for this pair from coverage and quality, before looking at the result. Other leads can have a different period.</span>
          </Row>
          <Row k="Candidate data end">{lead.scope.dataEnd}</Row>
          <Row k="Sample size">
            <span className="tnum">{lead.scope.rawN} {lead.scope.unitOfSample} raw, about {Math.round(lead.scope.effN)} effective</span>
            <span className="mt-0.5 block text-[0.8125rem] text-ink-2">Effective sample: {lead.scope.effNMethod}.</span>
          </Row>
          <Row k="Resolution">{lead.scope.resolution}</Row>
          <Row k="Area">{lead.scope.area}</Row>
        </dl>
      </Sec>

      <Sec>
        <H>What was compared</H>
        <dl className="m-0 divide-y divide-line">
          <Row k="Target">
            {vm.label}, {vm.unit}. {lead.targetInfo.definition}
            <span className="mt-0.5 block text-[0.8125rem] text-ink-2">{lead.targetInfo.caveat}</span>
          </Row>
          <Row k="Candidate">
            {lead.candidate.name}, {lead.candidateInfo.unit}. {lead.candidateInfo.definition}
            <span className="mt-0.5 block text-[0.8125rem] text-ink-2">
              {lead.candidate.product} · {lead.candidate.agency} · {lead.candidate.kind === "static" ? "static" : `${lead.candidate.kind} · ${lead.candidateInfo.coverage}`}. {lead.candidateInfo.note ?? ""}
            </span>
          </Row>
          <Row k="Trends">
            <span className="text-[0.9375rem]">The target&apos;s own trend (real GLDAS data, preliminary) is in the trend evidence panel and is tested separately from this association. {sp ? "For this lead the per-cell trends are the inputs, shown above." : "The candidate's own trend is not reported for this synthetic lead."}</span>
          </Row>
        </dl>
      </Sec>

      {lead.dependencies.length > 0 && (
        <Sec>
          <H>Source dependency</H>
          <ul className="m-0 grid list-none gap-2 p-0">
            {lead.dependencies.map((d) => (
              <li key={d.code + d.label} className="rounded-ctl bg-well px-3 py-2 text-[0.9375rem] text-ink">
                <strong className="font-semibold">{d.label}.</strong> {d.text}
              </li>
            ))}
          </ul>
        </Sec>
      )}

      <Sec>
        <H>What this does not show</H>
        <p className="m-0 flex flex-wrap items-start gap-2 text-[0.9375rem] text-ink-2">
          <SyntheticMark>Synthetic</SyntheticMark>
          <span className="min-w-0 flex-1">{lead.notShown} {lead.lag ? "Lead and lag order is a statistical clue about timing. " : ""}{lead.orbColorBy ? "This lead colours the vapour in the crystal ball by air temperature; that is a display choice, not a claim about the vapour." : ""}</span>
        </p>
      </Sec>
    </div>
  );
}
