"use client";
import { useState, type Ref, type ReactNode } from "react";
import {
  numberText,
  periodText,
  words,
  type Analysis,
  type Period,
  type Preset,
  type ResearchResult,
  type Source,
  type VariableResult,
} from "@/lib/research";
import { SeriesView } from "./SeriesView";

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div>
      <dt>{name}</dt>
      <dd>{children ?? "Unavailable"}</dd>
    </div>
  );
}
export function RecordDetails({ title, value }: { title: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="research-details" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{title}</summary>
      {open && <pre tabIndex={0}>{JSON.stringify(value, null, 2)}</pre>}
    </details>
  );
}
function Sources({ refs }: { refs?: Source[] }) {
  if (!refs?.length) return null;
  return (
    <ul className="sources">
      {refs.map((r, i) => (
        <li key={r.id ?? i}>
          {r.url && /^https?:\/\//.test(r.url) ? (
            <a href={r.url} target="_blank" rel="noreferrer">
              {r.title || r.id || "Scientific source"}
            </a>
          ) : (
            r.title || r.id || "Scientific reference"
          )}
          {r.statement && <span> · {r.statement}</span>}
        </li>
      ))}
    </ul>
  );
}

function Evidence({ item }: { item: Analysis }) {
  const trend = item.trend;
  const support = item.actual_support;
  const ci = trend?.ci_95;
  const significant = trend?.significant;
  const family = trend?.primary_family_id;
  const pAdjusted = family ? trend?.p_adjusted?.[family] : null;
  const unit = item.unit ?? "";
  return (
    <>
      <dl className="research-facts mt-4">
        <Field name="Change per decade">
          {numberText(trend?.slope_per_decade)} {trend?.slope_per_decade != null && unit}
        </Field>
        <Field name="Adjusted evidence">
          {significant == null ? "Cannot determine" : significant ? "Significant" : "Not significant"}
        </Field>
        <Field name="95% pointwise interval · per year">
          {ci ? `${numberText(ci[0])} to ${numberText(ci[1])} ${unit}` : "Unavailable"}
        </Field>
        <Field name="Sample support">
          {periodText(support)}
          {support?.n_valid != null &&
            ` · ${support.n_valid} valid${support.n_expected != null ? " of " + support.n_expected : ""}`}
        </Field>
      </dl>
      <details className="research-details">
        <summary>Trend test, coverage and diagnostics</summary>
        <dl className="research-facts">
          <Field name="Change per year">
            {numberText(trend?.slope_per_year)} {trend?.slope_per_year != null && unit}
          </Field>
          <Field name="Raw p-value">{numberText(trend?.p_raw)}</Field>
          <Field name="Primary adjusted p-value">{numberText(pAdjusted)}</Field>
          <Field name="Primary comparison family">{family}</Field>
          <Field name="Valid coverage">
            {support?.coverage == null ? "Unavailable" : numberText(support.coverage * 100) + "%"}
          </Field>
          <Field name="Inference method">{trend?.method}</Field>
          <Field name="Calendar lag">{numberText(trend?.lag)}</Field>
          <Field name="Requested analysis window">
            {item.requested_period ? periodText(item.requested_period) : "Preset requested"}
          </Field>
          <Field name="Analysis period">{periodText(item.analysis_period)}</Field>
        </dl>
        {trend?.diagnostics?.length ? <p>{trend.diagnostics.map(words).join(" · ")}</p> : null}
        {trend && <RecordDetails title="Inference policy and diagnostics record" value={trend} />}
        {trend?.p_adjusted && <RecordDetails title="Adjusted values by family" value={trend.p_adjusted} />}
      </details>
    </>
  );
}

function VariableEvidence({
  item,
  result,
  onApply,
}: {
  item: VariableResult;
  result: ResearchResult;
  onApply: (p: Period) => void;
}) {
  const product = item.product;
  const productRefs = (product?.metadata as { scientific_refs?: Source[] } | undefined)?.scientific_refs;
  const selected = result.selection?.variable_set?.find((v) => v.variable_id === item.variable_id);
  const why = item.selection_reason || selected?.reason;
  const refs = selected?.scientific_refs ?? item.scientific_refs;
  return (
    <article className="research-item">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-display text-2xl">{item.label || selected?.label || item.variable_id}</h4>
        <span className="research-status">{words(item.status)}</span>
      </div>
      {why && <p className="mt-2 text-ink-2">{why}</p>}
      {item.reason && item.reason !== why && <p className="research-note">{item.reason}</p>}
      <Sources refs={refs} />
      <Evidence item={item} />
      <dl className="research-facts mt-3">
        <Field name="Selected product">
          {product?.label || product?.selected_product_id || "No eligible product"}
        </Field>
        <Field name="Fixed historical reference">
          {periodText(item.baseline)}
          {item.baseline?.version && " · " + item.baseline.version}
        </Field>
      </dl>
      {product?.fallback && (
        <p className="research-note">
          An approved alternative supplies this series. {product.fallback_reason}
        </p>
      )}
      <SeriesView item={item} onApply={onApply} />
      <details className="research-details">
        <summary>Product decision and reference period</summary>
        {item.baseline?.rule && <p>{item.baseline.rule}</p>}
        <Sources refs={productRefs} />
        <RecordDetails title="Product and coverage record" value={product} />
        {item.baseline && <RecordDetails title="Fixed baseline and sample counts" value={item.baseline} />}
      </details>
    </article>
  );
}

const roles: Record<string, string> = {
  core_indicator: "Core indicators",
  related_condition: "Related environmental conditions",
  response: "Possible responses",
};
export function StudyResults({
  headingRef,
  result,
  onApply,
  onPreset,
  keepRegion,
  keepPeriod,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  result: ResearchResult;
  onApply: (p: Period) => void;
  onPreset: (p: Preset) => void;
  keepRegion: (id: string) => void;
  keepPeriod: (p: Period) => void;
}) {
  const { resolved, selection, identity, comparison } = result;
  const preset = resolved?.preset;
  const request = result.user_constraints;
  const variables = result.variables ?? [];
  const roleOf = (v: VariableResult) =>
    v.role ??
    selection?.variable_set?.find((r) => r.variable_id === v.variable_id)?.role ??
    "selected_variables";
  const groups = Array.from(new Set([...Object.keys(roles), ...variables.map(roleOf)]));
  const root = "/api/research/" + encodeURIComponent(identity.id) + "/export?format=";
  return (
    <section className="study-results research-paper" aria-labelledby="results-heading">
      <div className="research-width">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm font-semibold text-link">{words(identity.status)} study</p>
            <h2 ref={headingRef} id="results-heading" tabIndex={-1} className="mt-1 text-3xl sm:text-4xl">
              {selection?.phenomenon || request?.phenomenon_query || "Study results"}
            </h2>
          </div>
          <div className="flex gap-3">
            <a className="research-button" href={root + "json"} download>
              Export JSON
            </a>
            <a className="research-button" href={root + "csv"} download>
              Export CSV
            </a>
          </div>
        </div>
        <div className="result-section">
          <h3>Study conditions</h3>
          <dl className="research-facts mt-3">
            <Field name="Region">
              {resolved?.region_name || resolved?.region_id || "Unresolved"}
              {resolved?.region_source && <small>{words(resolved.region_source)} selection</small>}
            </Field>
            <Field name="Resolved period">
              {periodText(resolved?.period)}
              {resolved?.period_source && <small>{words(resolved.period_source)} selection</small>}
            </Field>
            <Field name="User-requested period">
              {request?.period ? periodText(request.period) : "Left open"}
            </Field>
            <Field name="Common comparison period">{periodText(comparison?.period)}</Field>
          </dl>
          {comparison?.reason && <p className="research-note">{comparison.reason}</p>}
          {preset && (
            <div className="preset-info">
              <h4 className="font-semibold">{words(preset.source || "automatic")} preset</h4>
              <p>{preset.reason}</p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                <button type="button" onClick={() => onPreset(preset)}>
                  Reopen this preset
                </button>
                {resolved.region_source === "preset" && resolved.region_id && (
                  <button type="button" onClick={() => keepRegion(resolved.region_id!)}>
                    Use this region in my next study
                  </button>
                )}
                {resolved.period_source === "preset" && resolved.period && (
                  <button type="button" onClick={() => keepPeriod(resolved.period!)}>
                    Use this period in my next study
                  </button>
                )}
              </div>
              <RecordDetails title="Preset version and scoring" value={preset} />
            </div>
          )}
          {!!result.summary?.length && (
            <ul className="study-summary">
              {result.summary.map((s, i) => (
                <li key={i}>{s.text}</li>
              ))}
            </ul>
          )}
          {!!result.warnings?.length && (
            <div className="research-note">
              <h4 className="font-semibold">Limitations</h4>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="result-section">
          <h3>Selected variables</h3>
          {!variables.length && (
            <p className="mt-2 text-ink-2">No variable series was available for this study.</p>
          )}
          {groups.map((role) => {
            const items = variables.filter((v) => roleOf(v) === role);
            return items.length ? (
              <section key={role} className="role-section">
                <h3 className="role-label">{roles[role] ?? words(role)}</h3>
                {items.map((item) => (
                  <VariableEvidence key={item.variable_id} item={item} result={result} onApply={onApply} />
                ))}
              </section>
            ) : null;
          })}
        </div>
        <div className="result-section">
          <h3>Event records and derived indicators</h3>
          {!result.indicators?.length && (
            <p className="mt-2 text-ink-2">
              No registered event or indicator result is available for this selection.
            </p>
          )}
          {(result.indicators ?? []).map((indicator, i) => (
            <article key={indicator.indicator_id || i} className="research-item">
              <p className="text-sm font-semibold text-link">{words(indicator.kind)}</p>
              <h4 className="font-display text-xl">
                {indicator.label ||
                  String(indicator.recipe?.label ?? indicator.indicator_id ?? "Phenomenon indicator")}
              </h4>
              <p className="mt-2">
                <strong>{words(indicator.status)}</strong>
                {indicator.reason && " · " + indicator.reason}
              </p>
              {indicator.recipe?.interpretation && (
                <p className="mt-2 text-ink-2">{indicator.recipe.interpretation}</p>
              )}
              {indicator.recipe && (
                <details className="research-details">
                  <summary>Definition, sources and calculation rules</summary>
                  <dl className="definition-list">
                    {indicator.recipe.version && (
                      <Field name="Recipe version">{indicator.recipe.version}</Field>
                    )}
                    {indicator.evidence_source?.inputs &&
                      Object.keys(indicator.evidence_source.inputs).length > 0 && (
                        <Field name="Input products">
                          {Object.values(indicator.evidence_source.inputs).join(", ")}
                        </Field>
                      )}
                    {indicator.evidence_source?.event && (
                      <Field name="Recorded event catalogue">
                        {indicator.evidence_source.event.catalogue_id} ·{" "}
                        {indicator.evidence_source.event.version}
                      </Field>
                    )}
                    {indicator.recipe.calibration_reference && (
                      <Field name="Fixed calibration period">
                        {periodText(indicator.recipe.calibration_reference)}
                      </Field>
                    )}
                    {indicator.recipe.computation && (
                      <Field name="Calculation">{indicator.recipe.computation}</Field>
                    )}
                    {indicator.recipe.event_rule && (
                      <Field name="Event rule">{indicator.recipe.event_rule}</Field>
                    )}
                    {indicator.recipe.aggregation && (
                      <Field name="Aggregation">{indicator.recipe.aggregation}</Field>
                    )}
                  </dl>
                  <Sources refs={indicator.recipe.standard_refs} />
                  <RecordDetails title="Registered recipe record" value={indicator.recipe} />
                </details>
              )}
              {indicator.events && indicator.events.length > 0 && (
                <RecordDetails title="Event records and coverage" value={indicator.events} />
              )}
              {(indicator.metrics ?? []).map((metric) => (
                <div className="border-t border-line py-4" key={metric.metric_id}>
                  <h5 className="font-semibold">{metric.label || metric.metric_id}</h5>
                  {metric.reason && <p>{metric.reason}</p>}
                  <Evidence item={metric} />
                  <SeriesView item={metric} onApply={onApply} />
                </div>
              ))}
              <RecordDetails
                title="Indicator provenance and coverage"
                value={Object.fromEntries(
                  Object.entries(indicator).filter(([k]) => !["metrics", "events", "recipe"].includes(k)),
                )}
              />
            </article>
          ))}
        </div>
        <div className="result-section">
          <h3>Evidence and reproducibility</h3>
          <a className="text-button" href={"/explore?research=" + encodeURIComponent(identity.id)}>
            Permanent study link
          </a>
          <p className="mt-2 text-ink-2">
            Adjusted evidence applies to the comparisons in each listed family. Confidence intervals describe
            individual slopes. Further changes to the analysis period are exploratory.
          </p>
          {(result.evidence_families ?? []).map((f) => (
            <div className="research-item" key={f.family_id}>
              <h4 className="font-semibold">{words(f.scope)} family</h4>
              <p>
                {f.method}
                {f.tested_count != null && ` · ${f.tested_count} tested`}
                {f.candidate_count != null && ` · ${f.candidate_count} candidates`}
              </p>
              <RecordDetails title="Comparison family, hypotheses and exclusions" value={f} />
            </div>
          ))}
          <RecordDetails
            title="Frozen study plan and versions"
            value={{ identity, selection, comparison, baselines: result.baselines }}
          />
        </div>
      </div>
    </section>
  );
}
