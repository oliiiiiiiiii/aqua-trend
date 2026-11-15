// Rate of change, uncertainty and evidence of ONE fitted trend, exactly as the backend reported it
// (spec §7.2, §7.3; data contract §9.2). Nothing here is computed: missing inference stays missing and is
// worded as "undetermined", never as "not significant".
import { decimalsFor, FAMILY_SCOPE_LABEL, fixed, methodLabel, pct, pText, SIGNIFICANCE } from "@/lib/research/format";
import type { EvidenceFamily, TrendResult } from "@/lib/research/types";
import { Facts, SignificanceBadge, summaryCls } from "./ui";

const SEASONAL: Record<string, string> = {
  fixed_baseline_monthly_anomaly: "monthly anomalies from the fixed reference period (the long-term trend is kept)",
  none_annual: "none (annual values are not de-seasonalised again)",
  none_standardised: "none (the index is already standardised)",
};

export function TrendBlock({ trend, families, compact = false }: { trend: TrendResult; families: EvidenceFamily[]; compact?: boolean }) {
  const d = decimalsFor([trend.slope_per_decade, trend.ci95_per_decade?.lo, trend.ci95_per_decade?.hi]);
  const dy = decimalsFor([trend.slope_per_year]);
  const sig = SIGNIFICANCE[trend.significance_label] ?? SIGNIFICANCE.undetermined;
  const ci = trend.ci95_per_decade;
  const level = Math.round(trend.ci_level * 100);
  const famById = new Map(families.map((f) => [f.family_id, f]));
  const adjusted = Object.entries(trend.p_adjusted ?? {});
  const hasSlope = trend.slope_per_decade != null;

  return (
    <div data-testid="trend" className="space-y-3">
      <div className={compact ? "space-y-1" : "grid gap-x-8 gap-y-3 sm:grid-cols-2"}>
        <div>
          <p className="text-sm text-ink-3">Rate of change in the analysis period</p>
          {hasSlope ? (
            <>
              <p className="font-display text-2xl tnum text-ink" data-testid="slope-decade">
                {fixed(trend.slope_per_decade, d, true)} <span className="text-base font-normal text-ink-2">{trend.unit} per decade</span>
              </p>
              <p className="text-sm text-ink-2 tnum" data-testid="slope-year">
                {fixed(trend.slope_per_year, dy, true)} {trend.unit} per year
              </p>
            </>
          ) : (
            <p className="text-ink-2">No slope could be described for this series.</p>
          )}
        </div>
        <div>
          <p className="text-sm text-ink-3">{level} % confidence interval, pointwise</p>
          {ci ? (
            <p className="tnum text-ink" data-testid="ci">
              {fixed(ci.lo, d, true)} to {fixed(ci.hi, d, true)} <span className="text-ink-2">{trend.unit} per decade</span>
            </p>
          ) : (
            <p className="text-ink-2" data-testid="ci">Not available: no valid inference for this series.</p>
          )}
          <p className="text-[0.8125rem] text-ink-3">
            Pointwise means it belongs to this one slope. It is not widened for the number of comparisons or for how the period was chosen.
          </p>
        </div>
      </div>

      <div>
        <SignificanceBadge label={trend.significance_label} />
        <p className="mt-1.5 max-w-[68ch] text-sm text-ink-2">
          {sig.explain}
          {trend.inference_status !== "ok" && trend.inference_reason ? <> Reason: {trend.inference_reason}</> : null}
        </p>
      </div>

      {trend.relative_change_per_decade_pct != null && (
        <p className="text-sm text-ink-2 tnum" data-testid="relative-change">
          Relative change: <span className="font-semibold text-ink">{fixed(trend.relative_change_per_decade_pct, 1, true)} % per decade</span>
          {trend.relative_change_basis ? <> ({trend.relative_change_basis})</> : null}. The original-unit rate above is the primary result.
        </p>
      )}

      <details>
        <summary className={summaryCls}>Test details</summary>
        <div className="mt-2 space-y-3">
          <Facts
            rows={[
              ["Raw p-value", <span key="p" className="tnum">{trend.p_raw == null ? "Not available (no valid test)" : pText(trend.p_raw)}</span>],
              [
                "Adjusted p-value",
                adjusted.length ? (
                  <ul key="adj" className="space-y-0.5">
                    {adjusted.map(([fid, p]) => {
                      const fam = famById.get(fid);
                      return (
                        <li key={fid} className="tnum">
                          {pText(p)} in the {fam ? (FAMILY_SCOPE_LABEL[fam.scope] ?? fam.scope).toLowerCase() : "family"}{" "}
                          <code className="text-[0.8125rem]">{fid}</code>
                          {fam ? `, ${fam.n_tested} tested of ${fam.n_candidates} candidates, ${methodLabel(fam.method)}` : ""}
                          {fid === trend.primary_family_id ? " (decides the main label)" : ""}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  "Not available"
                ),
              ],
              ["Family that decides the label", trend.primary_family_id ? <code key="f" className="text-[0.8125rem]">{trend.primary_family_id}</code> : "None"],
              [
                "Method",
                <>
                  {trend.method.estimator.toUpperCase()} slope
                  {trend.method.covariance ? `, covariance ${trend.method.covariance.replace(/_/g, " ")}` : ", descriptive only (no covariance estimate)"}
                </>,
              ],
              ["Lag", trend.method.lag != null ? `${trend.method.lag}${trend.method.lag_policy ? ` (${trend.method.lag_policy})` : ""}` : "Not applicable"],
              ["Seasonal handling", SEASONAL[trend.method.seasonal_adjustment] ?? trend.method.seasonal_adjustment.replace(/_/g, " ")],
              ["Valid samples", <span key="n" className="tnum">{trend.n_valid} of {trend.n_expected} expected</span>],
              ["Coverage", <span key="c" className="tnum">{pct(trend.coverage, 1)}</span>],
              ["Method policy", trend.method.policy_version + (trend.method.stats_policy_version ? `, ${trend.method.stats_policy_version}` : "")],
              ["Metric", <code key="m" className="text-[0.8125rem]">{trend.metric_id}</code>],
              ["Hypothesis id", <code key="h" className="text-[0.8125rem] break-all">{trend.hypothesis_id}</code>],
            ]}
          />
          {trend.diagnostics.length > 0 ? (
            <div className="text-sm">
              <p className="font-semibold text-ink-2">Diagnostics</p>
              <ul className="mt-1 space-y-1">
                {trend.diagnostics.map((g, i) => (
                  <li key={`${g.code}-${i}`} className="text-ink-2">
                    <span className="font-semibold text-ink">{g.severity === "blocking" ? "Blocking" : g.severity === "warning" ? "Warning" : "Note"}:</span>{" "}
                    {g.message} <code className="text-[0.8125rem] text-ink-3">{g.code}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-ink-3">No diagnostics were raised.</p>
          )}
        </div>
      </details>
    </div>
  );
}
