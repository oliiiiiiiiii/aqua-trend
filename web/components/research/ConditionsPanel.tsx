"use client";
// The conditions the analysis actually used (spec §6.2, §8.3, §9 item 2; acceptance P01–P07, S05, D07):
// region and period with their source, the preset that filled a blank and why, the common comparison period,
// the fixed reference periods, who selected the variables, and text that was NOT used as a constraint.
import { LAYER_LABEL } from "@/lib/data";
import { fixed, pct, periodLabel, timeLabel } from "@/lib/research/format";
import type { BaselineInfo, Period, ResearchResult } from "@/lib/research/types";
import { btnQuiet, Card, Facts, ItemStatusPill, Notice, Pill, SourceBadge, summaryCls, tdCls, thCls } from "./ui";

export function designationText(d: BaselineInfo["designation"]): string {
  if (d === "wmo_standard_normal") return "WMO standard normal";
  if (d === "registered_reference_mean") return "registered reference mean, not a full standard normal";
  return "recipe calibration period";
}

const COMPONENT_LABEL: Record<string, string> = {
  relevance: "Relevance to the phenomenon",
  effect: "Size of the change",
  quality: "Data quality",
  stability: "Stability",
};

const COMPARISON_STATUS: Record<string, string> = {
  ok: "Common period available",
  no_common_period: "No common period",
  single_variable: "Only one variable is analysable",
  not_available: "Not available",
};

export function ConditionsPanel({
  result,
  formRegionId,
  formPeriod,
  onKeepRegion,
  onKeepPeriod,
}: {
  result: ResearchResult;
  /** what the form currently holds as the user's own choices */
  formRegionId: string | null;
  formPeriod: Period | null;
  onKeepRegion: (id: string) => void;
  onKeepPeriod: (p: Period) => void;
}) {
  const { resolved, comparison, selection, baselines, user_constraints: user } = result;
  const preset = resolved.preset;
  const region = resolved.region;
  const period = resolved.period;
  const typeLabel = region ? (LAYER_LABEL as Record<string, string>)[region.type] ?? region.type : "";
  const names = new Map<string, string>([
    ...result.variables.map((v) => [v.variable_id, v.label] as [string, string]),
    ...result.indicators.map((i) => [i.indicator_id, i.label] as [string, string]),
  ]);
  const nameOf = (id: string) => names.get(id) ?? id;
  const regionKept = !!region && formRegionId === region.id;
  const periodKept = !!period && formPeriod?.start === period.start && formPeriod?.end === period.end;

  return (
    <Card aria-labelledby="conditions-h" data-testid="conditions">
      <h2 id="conditions-h" className="text-2xl">Conditions used</h2>
      <p className="mt-1 max-w-[72ch] text-sm text-ink-2">
        Place and time come only from the selectors. The text box describes the phenomenon and is never used to set them.
      </p>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div data-testid="resolved-region" data-source={region?.source ?? "none"} data-region={region?.id ?? ""}>
          <h3 className="text-base text-ink-2">Region</h3>
          {region ? (
            <>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold">{region.name}</span>
                <SourceBadge source={region.source} />
              </p>
              <p className="text-sm text-ink-3">{typeLabel} · <code>{region.id}</code>{region.geometry_version ? ` · geometry ${region.geometry_version}` : ""}</p>
              {region.source === "preset" && (
                <button type="button" className={`${btnQuiet} mt-2`} disabled={regionKept} onClick={() => onKeepRegion(region.id)}>
                  {regionKept ? "Kept as your region" : "Keep this region as my choice"}
                </button>
              )}
            </>
          ) : (
            <p className="mt-1 text-ink-2">No region was resolved.{user.region_id ? ` You chose ${user.region_id}; it was not replaced.` : ""}</p>
          )}
        </div>
        <div data-testid="resolved-period" data-source={period?.source ?? "none"} data-start={period?.start ?? ""} data-end={period?.end ?? ""}>
          <h3 className="text-base text-ink-2">Analysis period</h3>
          {period ? (
            <>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold tnum">{periodLabel(period)}</span>
                <SourceBadge source={period.source} />
              </p>
              <p className="text-sm text-ink-3 tnum">{period.start} to {period.end}, both months included</p>
              {period.source === "preset" && (
                <button type="button" className={`${btnQuiet} mt-2`} disabled={periodKept} onClick={() => onKeepPeriod({ start: period.start, end: period.end })}>
                  {periodKept ? "Kept as your period" : "Keep this period as my choice"}
                </button>
              )}
            </>
          ) : (
            <p className="mt-1 text-ink-2">No period was resolved.{user.period ? ` You chose ${periodLabel(user.period)}; it was not changed.` : ""}</p>
          )}
        </div>
      </div>

      {resolved.preset_status === "no_matching_preset" && (
        <Notice tone="warn" role="status" className="mt-4">
          <span className="font-semibold text-ink">No preset matches the conditions you set.</span>{" "}
          {resolved.preset_missing.length > 0 && <>Could not be filled: {resolved.preset_missing.map((m) => m.replace(/_/g, " ")).join(", ")}. </>}
          {resolved.preset_reason ?? ""} Your own choices were kept as they are; nothing was moved to another region or stretched to another period.
        </Notice>
      )}
      {resolved.preset_status === "not_needed" && (
        <p className="mt-4 text-sm text-ink-2">Both conditions are yours, so no preset was used and nothing was replaced.</p>
      )}

      {preset && (resolved.preset_status === "applied" || resolved.preset_status === "opened") && (
        <div className="mt-4 border-t border-line pt-4" data-testid="preset">
          <h3 className="text-base">
            {resolved.preset_status === "opened" ? "Opened preset" : "Why this preset was suggested"}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <Pill>{preset.source === "manual" ? "Manually curated preset" : "Automatically generated preset"}</Pill>
            {preset.pinned && <Pill>Pinned</Pill>}
            {preset.rank != null && <span>Rank {preset.rank} among the candidates that fit your conditions</span>}
            {!preset.search_complete && <Pill tone="warn"><span aria-hidden="true">!</span> Candidate search not complete</Pill>}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            A preset is a suggestion of where and when to look. It is ranked by relevance, size of change, data quality and stability; statistical significance is not required.
          </p>
          {preset.manual_note && <p className="mt-1 text-sm text-ink-2">Curator’s note: {preset.manual_note}</p>}
          {preset.reasons.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2 marker:text-ink-3">
              {preset.reasons.map((r) => <li key={r.text} className="max-w-[80ch]">{r.text}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-2">The preset carries no written reason.</p>
          )}
          {preset.score && (
            <div className="mt-3">
              <table className="w-full max-w-xl border-collapse text-sm">
                <caption className="pb-1 text-left font-semibold text-ink-2">Interest score: <span className="tnum text-ink">{fixed(preset.score.total, 2)}</span> (0 to 1)</caption>
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className={thCls}>Component</th>
                    <th scope="col" className={thCls}>Score (0 to 1)</th>
                    <th scope="col" className={thCls}>Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(COMPONENT_LABEL) as (keyof typeof preset.score.components)[]).map((k) => {
                    const value = preset.score!.components[k];
                    const missing = preset.score!.missing_components.includes(k) || value == null;
                    return (
                      <tr key={k} className="border-b border-line">
                        <th scope="row" className="px-3 py-1.5 text-left font-normal">{COMPONENT_LABEL[k]}</th>
                        <td className={tdCls}>{missing ? <span className="text-ink-3">not available</span> : fixed(value, 2)}</td>
                        <td className={tdCls}>{preset.score!.weights[k] != null ? fixed(preset.score!.weights[k], 2) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 max-w-[80ch] text-[0.8125rem] text-ink-3">
                {preset.score.missing_components.length > 0 && <>Missing components: {preset.score.missing_components.join(", ")}. {preset.score.missing_rule ?? ""} </>}
                Weights are product defaults, not scientific constants (policy {preset.score.policy_version}).
              </p>
            </div>
          )}
          <p className="mt-1 text-[0.8125rem] text-ink-3">
            Preset <code>{preset.preset_id}</code>, version {preset.version}{preset.family_id ? <>, search family <code>{preset.family_id}</code></> : null}
          </p>
        </div>
      )}

      <div className="mt-4 border-t border-line pt-4" data-testid="comparison">
        <h3 className="text-base">Common comparison period</h3>
        {comparison ? (
          <>
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-semibold tnum">{comparison.period ? periodLabel(comparison.period) : "None"}</span>
              <Pill tone={comparison.status === "ok" ? "real" : "warn"}>{COMPARISON_STATUS[comparison.status] ?? comparison.status}</Pill>
            </p>
            <p className="mt-1 max-w-[80ch] text-sm text-ink-2">
              Variables are compared with each other only over this period. Each variable’s full history is shown separately below and is not part of the comparison.
              {comparison.note ? ` ${comparison.note}` : ""}
            </p>
            <Facts
              className="mt-2"
              rows={[
                ["Compared", comparison.eligible_variable_ids.length ? comparison.eligible_variable_ids.map(nameOf).join(", ") : "None"],
                [
                  "Left out",
                  comparison.excluded.length ? (
                    <ul key="x" className="space-y-0.5">
                      {comparison.excluded.map((e, i) => <li key={`${e.variable_id}-${i}`}>{nameOf(e.variable_id ?? "?")}: {e.reason ?? "no reason recorded"}</li>)}
                    </ul>
                  ) : "None",
                ],
              ]}
            />
            {Object.keys(comparison.sample_support).length > 0 && (
              <details className="mt-1">
                <summary className={summaryCls}>Sample support in the common period</summary>
                <ul className="mt-1 space-y-0.5 text-sm text-ink-2 tnum">
                  {Object.entries(comparison.sample_support).map(([id, s]) => (
                    <li key={id}>{nameOf(id)}: {s.n_valid} of {s.n_expected} months ({pct(s.coverage, 1)}){s.start ? `, ${timeLabel(s.start)} to ${timeLabel(s.end)}` : ""}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-2">The result has no comparison block.</p>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-4" data-testid="baselines">
        <h3 className="text-base">Fixed reference periods</h3>
        <p className="mt-1 max-w-[80ch] text-sm text-ink-2">
          “Normal” is defined once, by these registered periods. Changing the analysis period changes what is fitted, never what counts as normal.
        </p>
        {baselines.length === 0 ? (
          <p className="mt-2 text-sm text-ink-2">The result lists no reference period.</p>
        ) : (
          <div role="region" aria-label="Fixed reference periods, scrollable table" tabIndex={0} className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={thCls}>Used for</th>
                  <th scope="col" className={thCls}>Kind</th>
                  <th scope="col" className={thCls}>Period</th>
                  <th scope="col" className={thCls}>Called</th>
                  <th scope="col" className={thCls}>Samples per calendar month</th>
                  <th scope="col" className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {baselines.map((b, bi) => {
                  const lo = b.samples_per_position.length ? Math.min(...b.samples_per_position) : null;
                  const hi = b.samples_per_position.length ? Math.max(...b.samples_per_position) : null;
                  return (
                    <tr key={`${b.baseline_id}-${bi}`} className="border-b border-line align-top" data-designation={b.designation}>
                      <th scope="row" className="px-3 py-1.5 text-left font-normal">
                        {b.applies_to.length ? b.applies_to.map(nameOf).join(", ") : "—"}
                        <span className="block text-[0.8125rem] text-ink-3"><code>{b.baseline_id}</code> v{b.version}</span>
                      </th>
                      <td className="px-3 py-1.5">{b.kind === "seasonal_reference" ? "Seasonal reference" : "Indicator calibration"}</td>
                      <td className={`${tdCls} whitespace-nowrap`}>{periodLabel(b)}</td>
                      <td className="px-3 py-1.5">{designationText(b.designation)}</td>
                      <td className={tdCls}>{lo == null ? "—" : lo === hi ? lo : `${lo} to ${hi}`} (minimum required {b.minimum_samples})</td>
                      <td className="px-3 py-1.5">
                        <ItemStatusPill status={b.status} />
                        {b.status !== "ok" && b.status_reason ? <span className="mt-1 block text-ink-2">{b.status_reason}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selection && (
        <div className="mt-4 border-t border-line pt-4" data-testid="selector-info">
          <h3 className="text-base">How the variables were selected</h3>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2" data-language-model={String(selection.selector.is_language_model)}>
            {selection.selector.is_language_model ? (
              <Pill>Language model{selection.selector.model ? `: ${selection.selector.model}` : ""}</Pill>
            ) : (
              <Pill tone="warn"><span aria-hidden="true">!</span> Catalogue matcher, not a language model</Pill>
            )}
            <span>provider <code>{selection.selector.provider}</code>, prompt {selection.selector.prompt_version}</span>
            {selection.reused && <Pill>Reused saved plan</Pill>}
          </p>
          <p className="mt-1 max-w-[80ch] text-sm text-ink-2">
            {selection.selector.is_language_model
              ? "The model read the offline catalogue and chose from the variables and recipes registered there. It cannot set the region, the period, a product or a significance label."
              : "No language model was used. A deterministic matcher compared your text with the offline catalogue notes. It only recognises phenomena described there."}
            {selection.reused ? ` The saved selection plan for this text was reused${selection.reuse_reason ? ` (${selection.reuse_reason})` : ""}, so the same variables are analysed as before.` : ""}
          </p>
          <Facts
            className="mt-2"
            rows={[
              ["Phenomenon as understood", selection.phenomenon_label],
              ["Your text", `“${selection.phenomenon_query}”`],
              ["Selection plan", <><code key="p">{selection.selection_plan_id}</code> (catalogue {selection.catalogue_version})</>],
            ]}
          />
          {selection.ignored_text_constraints.length > 0 && (
            <Notice tone="info" className="mt-2" role="status">
              <span data-testid="ignored-text">
                <span className="font-semibold text-ink">Words in your text that were not used as conditions:</span>{" "}
                {selection.ignored_text_constraints.map((w) => `“${w}”`).join(", ")}. Use the region and period selectors to set a place or a time.
              </span>
            </Notice>
          )}
          {selection.unanswerable.length > 0 && (
            <div className="mt-2 text-sm">
              <p className="font-semibold text-ink-2">What this catalogue cannot answer about the phenomenon</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2 marker:text-ink-3">
                {selection.unanswerable.map((u) => <li key={u} className="max-w-[80ch]">{u}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
