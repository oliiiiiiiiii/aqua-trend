"use client";
import { useEffect, useId, useMemo, useState } from "react";
import type { LeadsPanelProps } from "@/lib/contracts";
import type { VarId } from "@/lib/types";
import { VARIABLES } from "@/lib/variables";
import { Provenance } from "@/components/ui/Provenance";
import {
  LEAD_ROUTE_LABEL, SCENARIOS, SCENARIO_LABEL, SYNTHETIC_NOTICE, buildSyntheticRun, fmtR, lagPhrase,
  type LeadDetail, type Scenario, type SyntheticRun,
} from "@/lib/synthetic";
import LeadDetailView, { leadStatusLine } from "./LeadDetailView";
import RunProgress, { runDuration, useRunClock } from "./RunProgress";
import RunRecord from "./RunRecord";
import { SyntheticMark } from "./charts";

export interface LeadsPanelExtraProps {
  className?: string;
  /** start with a given preview state instead of the region's default (demo control) */
  initialScenario?: Scenario;
  /** skip the simulated run animation (used by harnesses and screenshots) */
  skipRun?: boolean;
  /** open the run-record disclosure initially */
  initialRecordOpen?: boolean;
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
    <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function lagChip(l: LeadDetail): string | null {
  if (!l.lag || l.route !== "lag") return null;
  const m = l.lag.months;
  return `${m > 0 ? "candidate first" : "target first"}, ${lagPhrase(m)}${l.lag.ambiguous ? ", two peaks" : ""}`;
}

function LeadRow({ lead, open, onToggle, detailId, children }: { lead: LeadDetail; open: boolean; onToggle: () => void; detailId: string; children?: React.ReactNode }) {
  const chip = lagChip(lead);
  const other = leadStatusLine(lead);
  const e = lead.effect;
  return (
    <li className="py-1.5">
      <button
        type="button" aria-expanded={open} aria-controls={detailId} onClick={onToggle}
        className={`flex w-full min-w-0 items-start gap-3 rounded-card border px-3 py-3 text-left transition-colors ${open ? "border-link bg-well" : "border-transparent hover:bg-well"}`}
      >
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[0.9375rem] font-semibold text-ink">{LEAD_ROUTE_LABEL[lead.route]}</span>
            {chip && <span className="rounded-ctl bg-well px-2 py-0 text-[0.8125rem] text-ink-2 ring-1 ring-line">{chip}</span>}
            {lead.provisional && <span className="rounded-ctl bg-well px-2 py-0 text-[0.8125rem] font-semibold text-ink ring-1 ring-line">Provisional</span>}
            <SyntheticMark>Synthetic example</SyntheticMark>
          </span>
          <span className="font-display text-[1.0625rem] leading-snug text-ink">{lead.title}</span>
          <span className="text-[0.875rem] text-ink-2">
            {lead.candidate.name} · {lead.candidate.product} · {lead.candidate.agency}
          </span>
          <span className="tnum flex flex-wrap gap-x-4 gap-y-0.5 text-[0.875rem] text-ink">
            <span>{e.kind === "eta" ? "eta" : "r"} {fmtR(e.value)} <span className="text-ink-2">({fmtR(e.lo)} to {fmtR(e.hi)})</span></span>
            <span>q {lead.stats.qText}{lead.stats.qProvisional ? " (provisional)" : ""}</span>
            <span>{lead.stability.recommended ? "Stable in both checks" : "Stability not confirmed"}</span>
          </span>
          {lead.dependencies.filter((d) => d.code !== "different-definition" || lead.dependencies.length === 1).length > 0 && (
            <span className="flex flex-wrap gap-1.5">
              {lead.dependencies.map((d) => (
                <span key={d.label} className="rounded-ctl bg-well px-2 py-0 text-[0.8125rem] font-semibold text-ink ring-1 ring-line">{d.label}</span>
              ))}
            </span>
          )}
          {other && <span className="text-[0.8125rem] text-ink-2">{other}</span>}
        </span>
        <span className="mt-1 flex shrink-0 items-center gap-1 text-[0.8125rem] font-semibold text-link">
          <span className="hidden @md:inline">{open ? "Close" : "Details"}</span>
          <Chevron open={open} />
        </span>
      </button>
      {children}
    </li>
  );
}

function StatusHeading({ run }: { run: SyntheticRun }) {
  const tone = run.scenario === "partial" ? "border-synthetic" : "border-line";
  return (
    <div className={`rounded-card border ${tone} bg-paper p-4`}>
      <h3 className="m-0 font-display text-xl text-ink">{run.status.headline}</h3>
      <p className="m-0 mt-2 text-[0.9375rem] text-ink">{run.status.message}</p>
      <p className="m-0 mt-2 text-[0.8125rem] text-ink-2">{run.status.searched}</p>
    </div>
  );
}

export default function LeadsPanel({
  region, series, targets, selectedLeadId, onSelectLead, className = "", initialScenario, skipRun, initialRecordOpen,
}: LeadsPanelProps & LeadsPanelExtraProps) {
  const [preview, setPreview] = useState<Scenario | "default">(initialScenario ?? "default");
  const [replay, setReplay] = useState(0);
  const uid = useId();
  const targetsKey = [...targets].sort().join(",");

  const run = useMemo(
    () => buildSyntheticRun(region, series, targets, preview === "default" ? undefined : preview),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [region, series, targetsKey, preview],
  );
  const runKey = `${run.regionId}|${targetsKey}|${run.scenario}|${replay}`;
  const clock = useRunClock(runKey, runDuration(run), !!skipRun);
  const noData = !series || !region.cells || region.cells < 2;

  // a selection that does not exist in the current run (region or targets changed) is cleared
  useEffect(() => {
    if (selectedLeadId && clock.done && !run.leads.some((l) => l.id === selectedLeadId)) onSelectLead(null);
  }, [selectedLeadId, clock.done, run, onSelectLead]);

  const grouped = useMemo(() => {
    const m = new Map<VarId, LeadDetail[]>();
    for (const t of targets) m.set(t, []);
    for (const l of run.leads) m.get(l.target)?.push(l);
    return [...m.entries()];
  }, [run, targets]);

  const showLeads = clock.done && run.leads.length > 0 && run.scenario !== "insufficient";

  return (
    <section aria-labelledby={`${uid}-h`} className={`@container grid gap-4 text-ink ${className}`}>
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id={`${uid}-h`} className="m-0 font-display text-2xl text-ink">Leads worth a closer look</h2>
          <Provenance kind="synthetic" />
        </div>
        <p className="m-0 border-l-4 border-synthetic pl-3 text-[0.9375rem] text-ink">{SYNTHETIC_NOTICE}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-ctl bg-well px-3 py-2">
          <label htmlFor={`${uid}-scn`} className="text-[0.875rem] font-semibold text-ink">Preview a different run state</label>
          <select
            id={`${uid}-scn`} value={noData ? "insufficient" : preview} disabled={noData}
            onChange={(e) => { setPreview(e.target.value as Scenario | "default"); onSelectLead(null); }}
            className="min-w-0 max-w-full rounded-ctl border border-line bg-paper px-3 py-1 text-[0.875rem] text-ink disabled:opacity-60"
          >
            <option value="default">Region default: {SCENARIO_LABEL[run.defaultScenario]}</option>
            {SCENARIOS.map((s) => <option key={s} value={s}>{SCENARIO_LABEL[s]}</option>)}
          </select>
          <span className="text-[0.8125rem] text-ink-2">
            {noData ? "This region has no land-model data, so only the insufficient-data state can occur." : "Demo control: every state a real run can end in."}
          </span>
        </div>
      </header>

      {!clock.done ? (
        <RunProgress run={run} t={clock.t} onSkip={clock.skip} />
      ) : (
        <>
          <p className="sr-only" role="status">Search finished: {run.status.headline}</p>
          {run.scenarioForced && (
            <p className="m-0 text-[0.8125rem] text-ink-2">
              <strong className="font-semibold text-ink">Preview state.</strong> This is not the default result for this region.
            </p>
          )}
          <StatusHeading run={run} />

          {run.scenario === "partial" && run.status.missing.length > 0 && (
            <div className="rounded-card border border-line bg-paper p-4">
              <h3 className="m-0 font-display text-lg text-ink">What is missing</h3>
              <ul className="m-0 mt-2 grid list-none gap-2 p-0 text-[0.9375rem]">
                {run.status.missing.map((m) => (
                  <li key={`${m.product}|${m.candidate}`}>
                    <strong className="font-semibold">{m.candidate}</strong> ({m.product}): {m.reason}
                    <span className="block text-[0.875rem] text-ink-2">{m.retry} {m.affects}.</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {run.scenario === "complete-none" && (
            <div className="rounded-card border border-line bg-paper p-4 text-[0.9375rem]">
              <h3 className="m-0 font-display text-lg text-ink">What this means, and what to do next</h3>
              <ul className="m-0 mt-2 grid list-disc gap-1.5 pl-5">
                <li>Nothing here is padded with weak results: no ranking of near misses is shown.</li>
                <li>Not finding a reliable association is not proof that none exists. The record may be too short, or the link too weak, or not linear and monthly.</li>
                <li>Everything in the search stays in the run record below, including the tests that were not significant.</li>
                <li>The water trends in the evidence panel above are separate, real results and still apply. Changing the targets starts a new family and a new correction.</li>
              </ul>
            </div>
          )}

          {run.scenario === "insufficient" && (
            <div className="rounded-card border border-line bg-paper p-4 text-[0.9375rem]">
              <h3 className="m-0 font-display text-lg text-ink">Questions that cannot be tested here</h3>
              <ul className="m-0 mt-2 grid list-none gap-2 p-0">
                {run.status.untestable.map((u) => (
                  <li key={u.question}>
                    <strong className="font-semibold">{u.question}</strong>
                    <span className="block text-[0.875rem] text-ink-2">{u.reason}</span>
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-3 text-[0.875rem] text-ink-2">
                This is different from &ldquo;tested and not significant&rdquo;. To test these questions, pick a region that has land-model cells.
              </p>
            </div>
          )}

          {showLeads && (
            <div>
              <h3 className="m-0 font-display text-lg text-ink">
                {run.scenario === "partial" ? "Provisional leads, not final" : `${run.leads.length} lead${run.leads.length === 1 ? "" : "s"}, grouped by target`}
              </h3>
              <p className="m-0 mt-1 text-[0.8125rem] text-ink-2">
                Ranked by effect size, stability and data quality, never by the smallest p. Each relationship type is shown on its own scale and is not merged into one score.
              </p>
              <div className="mt-2 grid gap-4">
                {grouped.map(([t, list]) => (
                  <div key={t}>
                    <h4 className="m-0 flex items-center gap-2 border-b border-line pb-1 font-display text-base text-ink">
                      <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${VARIABLES[t].color})` }} />
                      {VARIABLES[t].label}
                      <span className="text-[0.8125rem] font-normal text-ink-2">{list.length ? `${list.length} lead${list.length === 1 ? "" : "s"}` : "no lead"}</span>
                    </h4>
                    {list.length === 0 ? (
                      <p className="m-0 py-2 text-[0.875rem] text-ink-2">No candidate passed for this target. The tests are in the run record.</p>
                    ) : (
                      <ul className="m-0 list-none divide-y divide-line p-0">
                        {list.map((l) => {
                          const open = selectedLeadId === l.id;
                          const did = `${uid}-d-${l.id}`;
                          return (
                            <LeadRow key={l.id} lead={l} open={open} detailId={did} onToggle={() => onSelectLead(open ? null : l)}>
                              {open && <LeadDetailView lead={l} id={did} onClose={() => onSelectLead(null)} />}
                            </LeadRow>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => { setReplay((n) => n + 1); onSelectLead(null); }}
              className="rounded-ctl border border-line bg-paper px-4 py-1.5 text-sm font-semibold text-ink hover:bg-well">
              Replay the simulated run
            </button>
          </div>
          <RunRecord run={run} defaultOpen={initialRecordOpen} />
        </>
      )}
    </section>
  );
}
