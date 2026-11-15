"use client";
// The research page (spec §9): inputs and globe on the sky stage, results on paper cards.
// DOM order is inputs -> progress and results -> globe, so on a phone the conditions and results come before
// the globe; on wide screens the grid places the globe beside the inputs.
//
// The crystal ball is deliberately absent: its channels are water-cycle imagery, and an arbitrary phenomenon
// must not be mapped onto it by default (spec §9, last paragraph).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlobePane } from "@/components/explore/GlobePane";
import { useReducedMotion } from "@/components/explore/hooks";
import { ROLE_LABEL, ROLE_ORDER } from "@/lib/research/format";
import type { Period, ResearchResult } from "@/lib/research/types";
import { ConditionsPanel } from "./ConditionsPanel";
import { EvidencePanel } from "./EvidencePanel";
import { IndicatorPanel } from "./IndicatorPanel";
import { InputPanel } from "./InputPanel";
import { ProgressPanel } from "./ProgressPanel";
import { SummaryPanel, VariableSetPanel, WarningsPanel } from "./ResultPanels";
import { TimeControls, type ViewMode } from "./TimeControls";
import { readPeriod, useResearch } from "./useResearch";
import { VariableCard, type TimeView } from "./VariableCard";

/** Lists the contract always sends; guarded so a sparse failed result still renders. */
function withDefaults(r: ResearchResult): ResearchResult {
  return {
    ...r,
    resolved: r.resolved ?? { preset_status: "not_needed", preset_missing: [] },
    baselines: r.baselines ?? [],
    variables: r.variables ?? [],
    indicators: r.indicators ?? [],
    evidence_families: r.evidence_families ?? [],
    warnings: r.warnings ?? [],
  };
}

export default function ResearchApp() {
  const state = useResearch();
  const { job, phase, form, catalog } = state;
  const reducedMotion = useReducedMotion();
  const result = useMemo(() => (job?.result && job.result.identity ? withDefaults(job.result) : null), [job?.result]);
  const researchId = job?.research_id ?? null;

  /* ------------------------------------------------------------ time view (display only) */
  const [mode, setMode] = useState<ViewMode>("full");
  const [cursor, setCursor] = useState<string | null>(null);
  const [brush, setBrushState] = useState<Period | null>(null);
  const [keepRegion, setKeepRegion] = useState(true);
  // a new research starts with a clean view: an old selection never carries over onto new numbers
  useEffect(() => { setMode("full"); setCursor(null); setBrushState(null); setKeepRegion(true); }, [researchId]);
  const setBrush = useCallback((p: Period | null) => {
    setBrushState(p);
    if (!p) setMode((m) => (m === "selection" ? "full" : m));
  }, []);
  const analysis: Period | null = result?.resolved.period ? { start: result.resolved.period.start, end: result.resolved.period.end } : null;
  const view = mode === "analysis" ? analysis : mode === "selection" ? brush : null;
  const time = useMemo<TimeView>(() => ({ view, cursor, setCursor, brush, setBrush }), [view, cursor, brush, setBrush]);

  const applyBrush = useCallback(() => {
    if (!brush || !result) return;
    const userRegion = result.user_constraints.region_id ?? null;
    const presetRegion = result.resolved.region?.source === "preset" ? result.resolved.region.id : null;
    state.start({
      // the brushed range becomes the user's period; a region the user keeps becomes the user's region
      period: brush,
      regionId: userRegion ?? (keepRegion ? presetRegion : null),
      query: result.user_constraints.phenomenon_query,
      parentResearchId: result.identity.research_id,
    });
  }, [brush, result, keepRegion, state]);

  /* ------------------------------------------------------------ scroll to the progress card when a run starts */
  const progressRef = useRef<HTMLDivElement>(null);
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (phase === "submitting" && lastPhase.current !== "submitting") {
      progressRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
    }
    lastPhase.current = phase;
  }, [phase, reducedMotion]);

  /* ------------------------------------------------------------ globe */
  const resolvedRegion = result?.resolved.region ?? null;
  const globeRegion = state.region ?? (resolvedRegion && catalog ? catalog.byId.get(resolvedRegion.id) ?? null : null);
  const globeCaption = state.region
    ? `Highlighted: ${state.region.name}, the region you chose.`
    : globeRegion && resolvedRegion
      ? `Highlighted: ${globeRegion.name}, suggested by a preset for the shown result. Click any region to choose your own.`
      : "No region is chosen. Click one to choose it, or leave it open and a preset will suggest one.";

  const formPeriod = readPeriod(form.from, form.to).period;
  const byRole = useMemo(() => {
    if (!result) return [];
    return ROLE_ORDER.map((role) => ({ role, items: result.variables.filter((v) => v.role === role) })).filter((g) => g.items.length > 0);
  }, [result]);

  return (
    <div className="stage-sky">
      <div className="mx-auto grid max-w-[90rem] gap-6 px-4 pt-6 pb-12 sm:px-6 lg:grid-cols-[minmax(22rem,30rem)_minmax(0,1fr)] lg:gap-x-10 lg:px-8 lg:pt-8">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <InputPanel state={state} />
        </div>

        <div className="min-w-0 space-y-5 lg:col-span-2 lg:row-start-2" aria-live="off">
          <div ref={progressRef} className="scroll-mt-4">
            <ProgressPanel
              phase={phase}
              job={job}
              error={state.error}
              cancelling={state.cancelling}
              onCancel={state.cancel}
              onRetry={state.retry}
              onRetryWithoutContext={state.retryWithoutContext}
            />
          </div>

          {result && (
            <div className="space-y-5" data-testid="result" data-research-id={result.identity.research_id} data-provisional={String(result.provisional)}>
              {result.provisional && (
                <div className="rounded-card bg-paper p-4 text-ink shadow-card" role="status">
                  <span className="font-semibold">Provisional result.</span> The comparison family is not complete, so the significance labels below are not final.
                </div>
              )}
              <ConditionsPanel
                result={result}
                formRegionId={form.regionId}
                formPeriod={formPeriod}
                onKeepRegion={state.keepRegion}
                onKeepPeriod={state.keepPeriod}
              />
              <SummaryPanel result={result} />
              <VariableSetPanel result={result} />

              {result.variables.length > 0 && (
                <>
                  <TimeControls
                    time={time}
                    mode={mode}
                    onMode={setMode}
                    resolved={result.resolved}
                    userRegionId={result.user_constraints.region_id ?? null}
                    keepRegion={keepRegion}
                    onKeepRegion={setKeepRegion}
                    onApply={applyBrush}
                    busy={state.busy}
                  />
                  {byRole.map((g) => (
                    <section key={g.role} aria-labelledby={`role-${g.role}`} className="space-y-4">
                      <h2 id={`role-${g.role}`} className="on-stage text-2xl text-on-stage">{ROLE_LABEL[g.role]}: variable trends</h2>
                      {g.items.map((v) => (
                        <VariableCard key={v.variable_id} v={v} families={result.evidence_families} time={time} onApplyBrush={applyBrush} busy={state.busy} />
                      ))}
                    </section>
                  ))}
                </>
              )}

              <IndicatorPanel indicators={result.indicators} baselines={result.baselines} families={result.evidence_families} time={time} />
              <WarningsPanel result={result} />
              <EvidencePanel result={result} />
            </div>
          )}

          {phase === "idle" && !result && (
            <p className="on-stage max-w-[60ch] text-on-stage-2">
              Results appear here: the conditions that were used and who set them, the selected variables by role, each variable’s full history, seasonal pattern and trend, standard indicators, and the evidence record.
            </p>
          )}
        </div>

        <section id="research-globe" aria-label="Globe region selector" className="min-w-0 scroll-mt-4 lg:col-start-2 lg:row-start-1">
          <GlobePane
            layer={state.layer}
            onLayerChange={state.setLayer}
            selected={globeRegion}
            overlay={null}
            onOverlayChange={() => { /* no trend-map overlay on this page */ }}
            overlayChoices={[]}
            onPick={state.onPick}
            onZoomChange={state.onZoomChange}
            pickStatus={state.pickStatus}
            canvasClassName="mx-auto aspect-square w-full min-w-0 max-w-[min(100%,calc(100dvh-16rem))] min-h-[16rem]"
          />
          <p className="on-stage mt-2 text-center text-sm text-on-stage-2" data-testid="globe-caption">{globeCaption}</p>
          <p className="on-stage mt-1 text-center text-[0.8125rem] text-on-stage-2">
            The landscape on the planet is illustrative scenery. It does not show data.
          </p>
        </section>
      </div>
    </div>
  );
}
