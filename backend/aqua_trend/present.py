"""ResultPresenter: summary statements and JSON / CSV exports of ONE result snapshot.

Spec §4 (ResultPresenter), §7.2–§7.3 (what a statement may claim), data contract §9.2
(``summary``) and §9.4 (exports).

* ``summary`` builds deterministic template statements from numbers that are already in the
  result; every numeric statement names its ``evidence_ids`` (hypothesis ids).  It reports the
  rate in original units per decade, the pointwise interval and its scope, the adjusted
  significance in words, what could not be answered and which fields came from the user or a
  preset.  It never states a cause: roles are catalogue context, not a finding (S04).
  "Undetermined" is worded as such and is never turned into "not significant".
* ``export_json`` is the full snapshot.  ``export_csv`` is a long table of the same snapshot;
  numbers are written with the same text as in the JSON (no rounding), and a commented header
  block carries the plan, method and version information needed to reproduce the research.
"""
from __future__ import annotations

import csv
import io
import json
from typing import Any, Optional

from . import contracts as C

SUMMARY_VERSION = "summary-template-1.0.0"
CSV_FORMAT_VERSION = "aqua-trend-csv-1"
CSV_COLUMNS = (
    "research_id", "item_kind", "item_id", "metric_id", "product_id", "region_id", "cadence", "time",
    "raw", "seasonal", "anomaly", "fit", "unit", "inside_analysis_period",
)
_ROLE_TEXT = {"core_indicator": "core indicator", "related_condition": "related condition", "response": "response"}


def _num(value: float, signed: bool = False) -> str:
    """Display form of a computed number (3 significant digits); the exact value stays in the result."""
    return f"{value:+.3g}" if signed else f"{value:.3g}"


def _p(value: float) -> str:
    """Relation and value of a p-value for a sentence: ``= 0.0123`` or ``< 0.001``."""
    return "< 0.001" if value < 0.001 else f"= {value:.3g}"


def _cell(value: Any) -> str:
    """CSV text of a JSON value: identical to its JSON text; null is an empty cell."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return json.dumps(value, allow_nan=False)
    return str(value)


class ResultPresenter:
    """Builds the text summary and the exports from one ``ResearchResult`` (no new numbers)."""

    def generator(self) -> dict[str, Any]:
        return {"kind": "template", "version": SUMMARY_VERSION}

    # ------------------------------------------------------------------ summary

    def summary(self, result: C.ResearchResult) -> C.SummaryBlock:
        """Verifiable statements about the result (data contract §9.2 ``summary``)."""
        families = {f.family_id: f for f in result.evidence_families}
        statements: list[C.SummaryStatement] = []
        statements += self._context_statements(result)
        for variable in result.variables:
            statement = self._trend_statement(
                f"{variable.label} ({_ROLE_TEXT.get(variable.role, variable.role)}; product "
                f"{variable.product.selected_product_id}"
                + (", a fallback product" if variable.product.fallback else "") + ")",
                "de-seasonalised series (anomalies from the fixed reference period)",
                variable.trend, variable.analysis_period, families)
            if statement is not None:
                statements.append(statement)
        for indicator in result.indicators:
            kind = ("derived indicator computed from a standard recipe, not an observed event record"
                    if indicator.kind == "derived_indicator" else "recorded events of the cited catalogue")
            for metric in indicator.metrics:
                window = getattr(metric, "fit_window", None)
                period = C.Period(**window) if isinstance(window, dict) else indicator.analysis_period
                statement = self._trend_statement(f"{metric.label} ({kind})", "series", metric.trend, period,
                                                  families)
                if statement is not None:
                    statements.append(statement)
        statements += self._comparison_statements(result)
        statements += self._unanswered_statements(result)
        statements += self._scope_statements(result)
        return C.SummaryBlock(status="ok", statements=statements, generator=self.generator())

    @staticmethod
    def _context_statements(result: C.ResearchResult) -> list[C.SummaryStatement]:
        out: list[C.SummaryStatement] = []
        plan, resolved = result.selection, result.resolved
        source = {"user": "selected by the user", "preset": "filled by a preset"}
        parts: list[str] = []
        if resolved.region is not None:
            parts.append(f"Region: {resolved.region.name} ({resolved.region.id}), {source[resolved.region.source]}.")
        else:
            parts.append("Region: none (not selected and not filled).")
        if resolved.period is not None:
            parts.append(f"Analysis period: {resolved.period.start} to {resolved.period.end}, "
                         f"{source[resolved.period.source]}.")
        else:
            parts.append("Analysis period: none (not selected and not filled).")
        if resolved.preset is not None:
            parts.append(f"Preset {resolved.preset.preset_id} (version {resolved.preset.version}, "
                         f"{resolved.preset.source}) supplied the filled value(s).")
        out.append(C.SummaryStatement(text=" ".join(parts)))
        if resolved.preset is not None:
            for reason in resolved.preset.reasons:
                out.append(C.SummaryStatement(text=f"Why this preset was recommended: {reason.text}",
                                              evidence_ids=list(reason.evidence_ids)))
        if plan is not None:
            selector = plan.selector.provider + ("" if plan.selector.is_language_model
                                                 else " (a deterministic catalogue matcher, not a language model)")
            out.append(C.SummaryStatement(
                text=f"For the phenomenon text \"{plan.phenomenon_query}\" the selector {selector} chose "
                     f"{len(plan.variable_set)} catalogue variable(s) and {len(plan.indicator_recipe_ids)} standard "
                     f"indicator recipe(s) (selection plan {plan.selection_plan_id})."))
            if plan.ignored_text_constraints:
                out.append(C.SummaryStatement(
                    text="Place or date words in the text (" + ", ".join(plan.ignored_text_constraints)
                         + ") did not set the region or the period; only the selectors do."))
        return out

    @staticmethod
    def _trend_statement(subject: str, series_text: str, trend: Optional[C.TrendResult],
                         period: Optional[C.Period], families: dict[str, C.EvidenceFamily],
                         ) -> Optional[C.SummaryStatement]:
        if trend is None or trend.slope_per_decade is None:
            return None
        when = f" over {period.start} to {period.end}" if period is not None else ""
        text = (f"{subject}: the linear trend of the {series_text}{when} is "
                f"{_num(trend.slope_per_decade, signed=True)} {trend.unit} per decade "
                f"({trend.n_valid} of {trend.n_expected} time steps have data).")
        if trend.relative_change_per_decade_pct is not None:
            text += (f" Relative to the fixed-baseline mean this is "
                     f"{_num(trend.relative_change_per_decade_pct, signed=True)}% per decade.")
        if trend.inference_status != "ok" or trend.ci95_per_decade is None or trend.p_raw is None:
            text += (" Its significance is undetermined because inference is not applicable"
                     + (f" ({trend.inference_reason})" if trend.inference_reason else "")
                     + "; this is a descriptive slope and is not a finding of 'not significant'.")
            return C.SummaryStatement(text=text, evidence_ids=[trend.hypothesis_id])
        text += (f" {round(trend.ci_level * 100):d}% {trend.interval_scope} confidence interval: "
                 f"{_num(trend.ci95_per_decade.lo, signed=True)} to {_num(trend.ci95_per_decade.hi, signed=True)} "
                 f"{trend.unit} per decade (not adjusted for multiple comparisons or selection).")
        family = families.get(trend.primary_family_id or "")
        adjusted = trend.p_adjusted.get(trend.primary_family_id or "")
        if family is None or adjusted is None or trend.significance_label in ("undetermined", "provisional"):
            state = "provisional (the correction family is not complete)" \
                if trend.significance_label == "provisional" else "undetermined (no completed correction applies)"
            text += f" Raw p {_p(trend.p_raw)}; the corrected label is {state}."
            return C.SummaryStatement(text=text, evidence_ids=[trend.hypothesis_id])
        scope = "preset-search" if family.scope == "preset_search" else "query"
        verdict = "significant" if trend.significant else "not significant"
        text += (f" After Benjamini–Yekutieli correction over the {family.n_tested} test(s) of the {scope} family "
                 f"{family.family_id} it is {verdict} at {family.alpha:g} (adjusted p {_p(adjusted)}; "
                 f"raw p {_p(trend.p_raw)}).")
        others = [f"{fid}: p {_p(p)}" for fid, p in trend.p_adjusted.items() if fid != trend.primary_family_id]
        if others:
            text += " Adjusted p in the other attached family: " + "; ".join(others) + "."
        return C.SummaryStatement(text=text, evidence_ids=[trend.hypothesis_id])

    @staticmethod
    def _comparison_statements(result: C.ResearchResult) -> list[C.SummaryStatement]:
        comparison = result.comparison
        if comparison is None or comparison.period is None:
            return []
        text = (f"Main comparison period {comparison.period.start} to {comparison.period.end}: "
                f"{len(comparison.eligible_variable_ids)} eligible variable(s)"
                + (f" ({', '.join(comparison.eligible_variable_ids)})" if comparison.eligible_variable_ids else "")
                + f"; {len(comparison.excluded)} excluded"
                + (f" ({', '.join(str(e.get('variable_id')) for e in comparison.excluded)})"
                   if comparison.excluded else "")
                + ". Each variable's full history is returned separately and is not part of this comparison.")
        if comparison.status == "no_common_period":
            text = "There is no common period for a main comparison. " + text
        return [C.SummaryStatement(text=text)]

    @staticmethod
    def _unanswered_statements(result: C.ResearchResult) -> list[C.SummaryStatement]:
        out: list[C.SummaryStatement] = []
        for variable in result.variables:
            if variable.status != "ok" or variable.trend is None:
                reason = variable.status_reason or variable.product.status_reason or "no trend was computed"
                out.append(C.SummaryStatement(
                    text=f"Not answered — {variable.label}: {variable.status}. {reason}",
                    evidence_ids=[variable.trend.hypothesis_id] if variable.trend is not None else []))
        for indicator in result.indicators:
            if indicator.status != "ok":
                out.append(C.SummaryStatement(
                    text=f"Not answered — {indicator.label} ({indicator.kind}): {indicator.status}. "
                         f"{indicator.status_reason or ''}".strip()))
                continue
            for metric in indicator.metrics:
                if metric.status != "ok":
                    out.append(C.SummaryStatement(
                        text=f"Not answered — {metric.label}: {metric.status}. {metric.status_reason or ''}".strip()))
        plan = result.selection
        if plan is not None:
            if plan.status == "unsupported_phenomenon":
                out.append(C.SummaryStatement(
                    text="The catalogue has no variable with a documented relation to this phenomenon; nothing was "
                         "analysed and no unrelated variable was added."))
            for item in plan.unanswerable:
                out.append(C.SummaryStatement(text=f"Outside what the catalogue can answer: {item}"))
        if result.resolved.preset_status == "no_matching_preset":
            out.append(C.SummaryStatement(
                text=f"No preset filled {', '.join(result.resolved.preset_missing) or 'the blank condition(s)'}: "
                     f"{result.resolved.preset_reason}. The selected conditions were kept unchanged."))
        return out

    @staticmethod
    def _scope_statements(result: C.ResearchResult) -> list[C.SummaryStatement]:
        if not result.variables and not result.indicators:
            return []
        out = [C.SummaryStatement(
            text="A linear slope describes the average direction over the analysis period only. The roles of the "
                 "variables (core indicator, related condition, response) are documented context from the "
                 "catalogue; these trends do not show that one variable caused another, or caused the phenomenon.")]
        for family in result.evidence_families:
            out.append(C.SummaryStatement(
                text=f"Correction family {family.family_id} ({family.scope}): {family.n_candidates} candidate(s), "
                     f"{family.n_tested} tested, {family.n_untested} not tested (reasons are listed with the "
                     f"family); method {family.method}, threshold {family.alpha:g}; "
                     + ("complete." if family.complete else "not complete — labels are provisional.")))
        return out

    # ------------------------------------------------------------------ exports

    def export_json(self, result: C.ResearchResult) -> str:
        """The full result snapshot as JSON text (null for missing; never NaN / Infinity)."""
        return json.dumps(C.json_safe(result.model_dump(mode="json")), ensure_ascii=False, allow_nan=False)

    def rows(self, result: C.ResearchResult) -> list[dict[str, Any]]:
        """Long-format rows of every series in the snapshot, values exactly as in the JSON export."""
        doc = C.json_safe(result.model_dump(mode="json"))
        research_id = doc["identity"]["research_id"]
        region_id = (doc["resolved"].get("region") or {}).get("id")
        out: list[dict[str, Any]] = []
        for variable in doc["variables"]:
            series = variable.get("series")
            if not series:
                continue
            period = variable.get("analysis_period")
            cycle = series.get("seasonal_cycle")
            for i, time in enumerate(series["times"]):
                out.append({
                    "research_id": research_id, "item_kind": "variable", "item_id": variable["variable_id"],
                    "metric_id": (variable.get("trend") or {}).get("metric_id"),
                    "product_id": variable["product"].get("selected_product_id"), "region_id": region_id,
                    "cadence": series["cadence"], "time": time, "raw": series["raw"][i],
                    "seasonal": cycle[int(time[5:7]) - 1] if cycle else None,
                    "anomaly": series["anomaly"][i] if series.get("anomaly") else None,
                    "fit": series["fit"][i] if series.get("fit") else None, "unit": variable.get("unit"),
                    "inside_analysis_period": bool(period) and period["start"] <= time <= period["end"]})
        for indicator in doc["indicators"]:
            source = (indicator.get("input_product") or {}).get("selected_product_id") \
                or indicator.get("event_catalogue_id")
            for metric in indicator["metrics"]:
                series = metric.get("series")
                if not series:
                    continue
                inside = metric.get("in_analysis") or []
                for i, time in enumerate(series["times"]):
                    out.append({
                        "research_id": research_id, "item_kind": indicator["kind"],
                        "item_id": indicator["indicator_id"], "metric_id": metric["metric_id"],
                        "product_id": source, "region_id": region_id, "cadence": series["cadence"], "time": time,
                        "raw": series["raw"][i], "seasonal": None, "anomaly": None,
                        "fit": series["fit"][i] if series.get("fit") else None, "unit": metric.get("unit"),
                        "inside_analysis_period": bool(inside[i]) if i < len(inside) else False})
        return out

    def export_csv(self, result: C.ResearchResult) -> str:
        """CSV of the snapshot: ``#`` metadata lines, one header row, then long-format rows.

        Columns: research id, item kind (variable / derived_indicator / recorded_event), item id,
        metric id, product (or event catalogue), region, cadence, time, raw value, fixed seasonal
        value, anomaly, fitted value, unit, inside_analysis_period.  Missing values are empty
        cells; zero is written as zero.
        """
        buffer = io.StringIO()
        for line in self.csv_header(result):
            buffer.write("# " + line + "\n")
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(CSV_COLUMNS)
        for row in self.rows(result):
            writer.writerow([_cell(row[c]) for c in CSV_COLUMNS])
        return buffer.getvalue()

    def csv_header(self, result: C.ResearchResult) -> list[str]:
        """Metadata lines (without the ``# `` prefix): plan, conditions, methods, versions, trends."""
        doc = C.json_safe(result.model_dump(mode="json"))
        identity, resolved = doc["identity"], doc["resolved"]

        def blob(value: Any) -> str:
            return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)

        lines = [
            f"format: {CSV_FORMAT_VERSION}",
            "note: lines starting with '#' are metadata; empty cells are missing values (never zero); numbers "
            "are written exactly as in the JSON export of the same research",
            f"research_id: {identity['research_id']}",
            f"created_at: {identity['created_at']}",
            f"status: {identity['status']}",
            f"request: {blob(doc['user_constraints'])}",
            f"context: {blob({'parent_research_id': identity.get('parent_research_id'), 'preset_ref': identity.get('preset_ref')})}",
            f"resolved_region: {blob(resolved.get('region'))}",
            f"resolved_period: {blob(resolved.get('period'))}",
            f"preset: {blob({'status': resolved.get('preset_status'), 'missing': resolved.get('preset_missing'), 'reason': resolved.get('preset_reason'), 'preset_id': (resolved.get('preset') or {}).get('preset_id'), 'version': (resolved.get('preset') or {}).get('version')})}",
            f"comparison: {blob({k: (doc.get('comparison') or {}).get(k) for k in ('status', 'period', 'eligible_variable_ids', 'excluded')})}",
            f"identity: {blob(identity)}",
            f"selection_plan: {blob(doc.get('selection'))}",
        ]
        for base in doc["baselines"]:
            lines.append("baseline: " + blob({k: base.get(k) for k in (
                "baseline_id", "version", "kind", "designation", "start", "end", "minimum_samples",
                "samples_per_position", "actual_support", "status", "applies_to", "product_id")}))
        for variable in doc["variables"]:
            lines.append("variable: " + blob({
                "variable_id": variable["variable_id"], "role": variable["role"], "status": variable["status"],
                "status_reason": variable.get("status_reason"), "unit": variable.get("unit"),
                "product": {k: variable["product"].get(k) for k in (
                    "selected_product_id", "product_label", "agency", "priority_rank", "fallback",
                    "fallback_reason", "available_period", "coverage", "quality_flags", "status", "caveat")},
                "baseline_id": variable.get("baseline_id"), "requested_period": variable.get("requested_period"),
                "analysis_period": variable.get("analysis_period"), "actual_support": variable.get("actual_support"),
                "full_history": variable.get("full_history"), "in_comparison": variable.get("in_comparison"),
                "trend": variable.get("trend")}))
        for indicator in doc["indicators"]:
            lines.append("indicator: " + blob({
                "indicator_id": indicator["indicator_id"], "version": indicator.get("version"),
                "kind": indicator["kind"], "status": indicator["status"],
                "status_reason": indicator.get("status_reason"),
                "input_product_id": (indicator.get("input_product") or {}).get("selected_product_id"),
                "calibration_baseline_id": indicator.get("calibration_baseline_id"),
                "event_catalogue_id": indicator.get("event_catalogue_id"),
                "event_catalogue_version": indicator.get("event_catalogue_version"),
                "analysis_period": indicator.get("analysis_period"),
                "metrics": [{"metric_id": m["metric_id"], "unit": m.get("unit"), "cadence": m.get("cadence"),
                             "status": m["status"], "status_reason": m.get("status_reason"),
                             "aggregation_rule": m.get("aggregation_rule"), "fit_window": m.get("fit_window"),
                             "trend": m.get("trend")} for m in indicator["metrics"]]}))
        for family in doc["evidence_families"]:
            lines.append("evidence_family: " + blob({k: family.get(k) for k in (
                "family_id", "scope", "candidate_policy", "method", "alpha", "n_candidates", "n_tested",
                "n_untested", "complete", "hypotheses_truncated", "external_ref", "content_hash")}))
        lines.append("interval_scope: confidence intervals are pointwise; adjusted p-values do not adjust them")
        return lines
