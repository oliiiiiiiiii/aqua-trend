"""Interest score and user-visible reasons of a preset candidate (spec §8.2; acceptance section 7).

The score ranks candidates for exploration.  It is NOT evidence:

* statistical significance is not an input — a candidate whose trends are not significant, or
  whose inference is not applicable ("undetermined"), gets a valid score and can rank;
* every component is a fixed number in [0, 1] defined by ``preset_policy``; a component that
  cannot be computed is MISSING: it scores 0, it is listed, and weights are not renormalised;
* components are means / shares over the selected variables, so selecting more variables does
  not raise the score by count;
* the effect is dimensionless: |slope per decade| divided by the standard deviation of the
  fixed-baseline anomalies in the reference period, squashed with x / (1 + x).  A variable
  without a positive baseline sd has no effect value — nothing is divided by zero.

Reasons are assembled from computed numbers and hypothesis ids only; no free text is generated.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Sequence

from .. import contracts as C
from .batch import CandidateResult, MetricFacts
from .policy import COMPONENTS, PresetPolicy

LABEL_HAS_SIGNIFICANT = "has_significant"
LABEL_NONE_SIGNIFICANT = "none_significant"
LABEL_UNDETERMINED_ONLY = "undetermined_only"

EVIDENCE_LABEL_TEXT = {
    LABEL_HAS_SIGNIFICANT: "at least one trend is significant after correction over the whole preset search",
    LABEL_NONE_SIGNIFICANT: "trends were tested and none is significant after correction over the whole preset "
                            "search",
    LABEL_UNDETERMINED_ONLY: "undetermined: no trend of this candidate supports inference (descriptive slopes "
                             "only); this is not the same as 'not significant'",
}


@dataclass
class ScoredCandidate:
    """Score of one analysed candidate with the per-variable numbers it was computed from."""

    result: CandidateResult
    score: C.PresetScore
    variable_facts: list[dict[str, Any]] = field(default_factory=list)

    @property
    def total(self) -> float:
        return self.score.total


def analysable(fact: MetricFacts) -> bool:
    """A variable enters the score when its product supports the trend and a slope can be described."""
    return fact.status == "ok" and fact.slope_per_decade is not None


def standardized_effect(fact: MetricFacts) -> Optional[float]:
    """|slope per decade| in units of the fixed-baseline anomaly sd; ``None`` without a positive sd."""
    sd = fact.scale_sd
    if fact.slope_per_decade is None or sd is None or not math.isfinite(sd) or sd <= 0.0:
        return None
    return abs(fact.slope_per_decade) / sd


def _sign(x: float) -> int:
    return (x > 0) - (x < 0)


def score_candidate(plan: C.SelectionPlan, result: CandidateResult, policy: PresetPolicy) -> ScoredCandidate:
    """The four registered components and their fixed weighted mean (spec §8.2)."""
    roles = {v.variable_id: v.role for v in plan.variable_set}
    decisions = {d.variable_id: d for d in result.candidate.decisions}
    weight = lambda f: policy.role_weights.get(roles.get(f.item_id, ""), 0.0)   # noqa: E731
    variables = result.variables
    usable = [f for f in variables if analysable(f)]
    facts: list[dict[str, Any]] = []

    total_role = sum(weight(f) for f in variables)
    relevance = sum(weight(f) for f in usable) / total_role if total_role > 0 else None

    effect_num = effect_den = 0.0
    quality_values: list[float] = []
    stable = judged = 0
    for f in variables:
        decision = decisions.get(f.item_id)
        fallback = bool(decision and decision.fallback)
        caveat = bool(decision and decision.caveat)
        x = standardized_effect(f) if analysable(f) else None
        entry: dict[str, Any] = {
            "variable_id": f.item_id, "role": roles.get(f.item_id), "product_id": f.product_id,
            "hypothesis_id": f.hypothesis_id, "status": f.status, "analysable": analysable(f),
            "slope_per_decade": f.slope_per_decade, "unit": f.unit, "baseline_anomaly_sd": f.scale_sd,
            "standardized_effect_per_decade": x, "effect_score": x / (1.0 + x) if x is not None else None,
            "coverage": f.coverage, "n_valid": f.n_valid, "n_expected": f.n_expected,
            "inference": "ok" if f.inference_ok else "not_applicable", "inference_reason": f.inference_reason,
            "p_raw": f.p_raw, "half_slopes_per_year": list(f.half_slopes),
            "fallback_product": fallback, "product_caveat": caveat, "stable": None,
        }
        if analysable(f):
            if x is not None and weight(f) > 0:
                effect_num += weight(f) * x / (1.0 + x)
                effect_den += weight(f)
            q = (f.coverage or 0.0) * (1.0 if f.inference_ok else policy.descriptive_only_factor)
            if fallback or caveat:
                q -= policy.fallback_or_caveat_penalty
            quality_values.append(min(max(q, 0.0), 1.0))
            first, second = f.half_slopes
            full = _sign(f.slope_per_decade)
            if first is not None and second is not None and full != 0:
                judged += 1
                entry["stable"] = _sign(first) == full and _sign(second) == full
                stable += int(entry["stable"])
        facts.append(entry)

    components = {
        "relevance": relevance,
        "effect": effect_num / effect_den if effect_den > 0 else None,
        "quality": sum(quality_values) / len(quality_values) if quality_values else None,
        "stability": stable / judged if judged else None,
    }
    missing = [name for name in COMPONENTS if components[name] is None]
    total = sum(policy.weights[name] * (components[name] or 0.0) for name in COMPONENTS)
    score = C.PresetScore(total=total, components=C.ScoreComponents(**components), weights=dict(policy.weights),
                          missing_components=missing, missing_rule=policy.missing_rule,
                          policy_version=policy.version)
    return ScoredCandidate(result=result, score=score, variable_facts=facts)


# --------------------------------------------------------------------------- evidence labels and reasons

def evidence_summary(result: CandidateResult, family_records: Mapping[str, C.HypothesisRecord],
                     complete: bool) -> dict[str, Any]:
    """Counts of the candidate's hypotheses by their label in the preset-search family (spec §8.2).

    ``undetermined`` (no valid inference) is kept apart from ``not_significant`` (tested, not
    significant).  While the family is incomplete nothing is final: tested hypotheses count as
    ``provisional``.
    """
    counts = {"significant": 0, "not_significant": 0, "undetermined": 0, "provisional": 0}
    for fact in result.facts:
        counts[hypothesis_label(family_records.get(fact.hypothesis_id), complete)] += 1
    if not complete:
        label = "provisional"
    elif counts["significant"]:
        label = LABEL_HAS_SIGNIFICANT
    elif counts["not_significant"]:
        label = LABEL_NONE_SIGNIFICANT
    else:
        label = LABEL_UNDETERMINED_ONLY
    return {"label": label, "label_text": EVIDENCE_LABEL_TEXT.get(label, "provisional: the search is not complete"),
            "n_hypotheses": len(result.facts), **counts}


def hypothesis_label(record: Optional[C.HypothesisRecord], complete: bool) -> str:
    if record is None or not record.tested:
        return "undetermined"
    if not complete or record.significant is None:
        return "provisional"
    return "significant" if record.significant else "not_significant"


def _num(x: Optional[float], digits: int = 3) -> str:
    return "n/a" if x is None else f"{x:.{digits}g}"


def build_reasons(scored: ScoredCandidate, family: C.EvidenceFamily,
                  family_records: Mapping[str, C.HypothesisRecord], labels: Mapping[str, str],
                  period_kind_text: str, top_n: int = 3) -> list[C.PresetReason]:
    """Reasons that point to computed numbers and hypothesis ids (spec §8.2 "須有可指認的資料依據")."""
    score, result = scored.score, scored.result
    comp = score.components.model_dump()
    variable_ids = [v["hypothesis_id"] for v in scored.variable_facts]
    terms = " + ".join(f"{score.weights[c]:.2f} × {c} {_num(comp[c])}" for c in COMPONENTS)
    text = f"Interest score {score.total:.3f} = {terms} (policy {score.policy_version})."
    if score.missing_components:
        text += f" Missing component(s) scored 0, never full marks: {', '.join(score.missing_components)}."
    text += " Statistical significance is not part of the score."
    reasons = [C.PresetReason(text=text, evidence_ids=variable_ids)]

    summary = evidence_summary(result, family_records, family.complete)
    reasons.append(C.PresetReason(
        text=(f"Evidence: {summary['label_text']}. Of this candidate's {summary['n_hypotheses']} hypotheses, "
              f"{summary['significant']} significant, {summary['not_significant']} not significant, "
              f"{summary['undetermined']} undetermined, after Benjamini–Yekutieli correction over the "
              f"{family.n_tested} tested hypotheses of preset-search family {family.family_id} "
              f"({family.n_candidates} compared, {family.n_untested} without a valid test)."),
        evidence_ids=[f.hypothesis_id for f in result.facts]))

    usable = [v for v in scored.variable_facts if v["analysable"]]
    reasons.append(C.PresetReason(
        text=(f"{len(usable)} of {len(scored.variable_facts)} selected variable(s) are analysable for this region "
              f"and period ({period_kind_text})."),
        evidence_ids=[v["hypothesis_id"] for v in usable]))

    ranked = sorted((v for v in usable if v["standardized_effect_per_decade"] is not None),
                    key=lambda v: (-v["standardized_effect_per_decade"], v["variable_id"]))
    for v in ranked[:top_n]:
        record = family_records.get(v["hypothesis_id"])
        label = hypothesis_label(record, family.complete)
        text = (f"{labels.get(v['variable_id'], v['variable_id'])} ({v['product_id']}): "
                f"{v['slope_per_decade']:+.3g} {v['unit']} per decade = "
                f"{v['standardized_effect_per_decade']:.2f} baseline standard deviation(s) per decade; "
                f"coverage {v['coverage']:.0%}; ")
        if label == "undetermined":
            text += ("descriptive slope only — undetermined, inference not applicable"
                     + (f": {v['inference_reason']}" if v["inference_reason"] else ""))
        elif label == "provisional":
            text += f"raw p = {_num(v['p_raw'])}; provisional (the search family is not complete)"
        else:
            text += (f"raw p = {_num(v['p_raw'])}, adjusted p = {_num(record.p_adjusted)} over the preset search — "
                     + ("significant" if label == "significant" else "not significant"))
        reasons.append(C.PresetReason(text=text + ".", evidence_ids=[v["hypothesis_id"]]))
    return reasons


def rank_key(scored: ScoredCandidate, pinned: bool, priority: Optional[float]) -> tuple:
    """Stable order of ``preset_policy.tie_break``: pinned, manual priority, score, region id, period."""
    cand = scored.result.candidate
    return (0 if pinned else 1, priority if priority is not None else math.inf, -scored.total,
            cand.region_id, cand.start, cand.end)


def cap_list(ordered: Sequence[tuple[ScoredCandidate, bool]], policy: PresetPolicy,
             region_is_recommended: bool) -> list[ScoredCandidate]:
    """Apply ``max_presets_returned`` / ``max_presets_per_region`` to the automatic entries.

    ``ordered`` holds (candidate, manual) pairs in rank order; manually added, pinned or
    prioritised entries are always kept.  Nothing is removed from the search family.
    """
    kept: list[ScoredCandidate] = []
    automatic = 0
    per_region: dict[str, int] = {}
    for scored, manual in ordered:
        region = scored.result.candidate.region_id
        if not manual:
            if automatic >= policy.max_presets_returned:
                continue
            if region_is_recommended and per_region.get(region, 0) >= policy.max_presets_per_region:
                continue
            automatic += 1
            per_region[region] = per_region.get(region, 0) + 1
        kept.append(scored)
    return kept
