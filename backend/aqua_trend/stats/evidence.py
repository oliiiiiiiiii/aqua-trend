"""EvidenceController: hypothesis identity and correction families (spec §7.3, data contract §9.3).

Rules implemented
* One hypothesis = one (region + geometry version, analysis period, metric,
  variable / indicator, product or event catalogue, dataset / coverage version,
  baseline, recipe / aggregation version, method policy version, statistics
  policy version).  Frequency,
  duration and severity of one recipe are different ``metric_id`` values and
  therefore different hypotheses (T15).  Any version change gives a new id, so
  an old correction can never be attached to new numbers (T16).
* A family holds EVERY candidate that was actually compared: tested hypotheses
  (finite raw p) are BY-adjusted together, untested ones stay listed with a
  reason (T09).  ``p_raw`` is never overwritten (T08).
* Final labels exist only for a complete family; an incomplete family yields
  "provisional" and no adjusted p-values.
* Inference that is not applicable is "undetermined", never "not_significant".
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Optional, Sequence

import numpy as np

from ..contracts import EvidenceFamily, HypothesisRecord, TrendResult
from .fdr import by_adjust
from .policy import STATS_POLICY_VERSION

BY_METHOD = "benjamini_yekutieli"

#: components every hypothesis must state
_REQUIRED = ("region_id", "geometry_version", "analysis_period", "metric_id",
             "dataset_version", "method_policy_version")
#: at least one key of each group must be non-null
_ONE_OF = (("variable_id", "indicator_id"), ("product_id", "event_catalogue_id"))
#: components that may legitimately be absent (stored as null so the id stays explicit)
_OPTIONAL = ("variable_id", "indicator_id", "product_id", "event_catalogue_id", "coverage_version",
             "baseline_id", "baseline_version", "recipe_version", "aggregation_version")

_SCOPE_PREFIX = {"query": "fam-q", "preset_search": "fam-ps"}


# --------------------------------------------------------------------------- canonical form

def _plain(value: Any) -> Any:
    """Reduce a component to canonical JSON-compatible data (no floats that are NaN/Inf)."""
    if hasattr(value, "model_dump"):
        value = value.model_dump()
    if isinstance(value, Mapping):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("hypothesis components must not contain NaN or Infinity")
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"unsupported hypothesis component type: {type(value).__name__}")


def _canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def _sha(obj: Any) -> str:
    return hashlib.sha256(_canonical_json(obj).encode("ascii")).hexdigest()


def _slug(text: Any) -> str:
    return re.sub(r"[^A-Za-z0-9_.]+", "_", str(text)).strip("_") or "x"


def canonical_components(components: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and normalise the components of one hypothesis (data contract §9.3).

    Required keys must be present and non-null; the optional keys default to null;
    ``stats_policy_version`` defaults to the running ``STATS_POLICY_VERSION``;
    ``analysis_period`` is reduced to ``{"start", "end"}``.  Extra keys are kept and
    take part in the id (more context can only separate hypotheses, never merge them).
    """
    c = _plain(dict(components))
    missing = [k for k in _REQUIRED if c.get(k) in (None, "")]
    for group in _ONE_OF:
        if all(c.get(k) in (None, "") for k in group):
            missing.append(" | ".join(group))
    if missing:
        raise ValueError(f"hypothesis components missing: {', '.join(missing)}")
    period = c["analysis_period"]
    if not isinstance(period, Mapping) or not period.get("start") or not period.get("end"):
        raise ValueError("analysis_period must be {start, end}")
    c["analysis_period"] = {"start": str(period["start"]), "end": str(period["end"])}
    for k in _OPTIONAL:
        c.setdefault(k, None)
    # The lag rule, prewhitening and reference distribution live in aqua_trend.stats, not in the
    # method policy file: a change there changes p-values under an unchanged method policy
    # version, so the statistics version is part of every hypothesis identity (T16).
    if c.get("stats_policy_version") in (None, ""):
        c["stats_policy_version"] = STATS_POLICY_VERSION
    return c


def hypothesis_components(*, region_id: str, geometry_version: str, analysis_period: Any, metric_id: str,
                          dataset_version: str, method_policy_version: str,
                          variable_id: Optional[str] = None, indicator_id: Optional[str] = None,
                          product_id: Optional[str] = None, event_catalogue_id: Optional[str] = None,
                          coverage_version: Optional[str] = None,
                          baseline_id: Optional[str] = None, baseline_version: Optional[str] = None,
                          recipe_version: Optional[str] = None, aggregation_version: Optional[str] = None,
                          **extra: Any) -> dict[str, Any]:
    """Keyword builder for the components dict, so every caller states the same fields."""
    return canonical_components(dict(
        region_id=region_id, geometry_version=geometry_version, analysis_period=analysis_period,
        metric_id=metric_id, dataset_version=dataset_version, method_policy_version=method_policy_version,
        variable_id=variable_id, indicator_id=indicator_id, product_id=product_id,
        event_catalogue_id=event_catalogue_id, coverage_version=coverage_version,
        baseline_id=baseline_id, baseline_version=baseline_version,
        recipe_version=recipe_version, aggregation_version=aggregation_version, **extra))


def hypothesis_id(components: Mapping[str, Any]) -> str:
    """Stable id: ``hyp-<region>-<metric>-<16 hex of sha256(canonical JSON)>``.

    The readable prefix is for people; identity is the hash of ALL canonical components.
    """
    c = canonical_components(components)
    return f"hyp-{_slug(c['region_id'])}-{_slug(c['metric_id'])}-{_sha(c)[:16]}"


# --------------------------------------------------------------------------- labels

def significance(p_adjusted: Optional[float], alpha: float, inference_status: str,
                 family_complete: bool) -> tuple[str, Optional[bool]]:
    """(significance_label, significant) of one hypothesis inside one family.

    * inference not applicable            -> ("undetermined", None)  — never "not_significant"
    * family not complete                 -> ("provisional", None)   — no final label yet
    * complete, but no adjusted p         -> ("undetermined", None)
    * complete, p_adjusted <  alpha       -> ("significant", True)
    * complete, p_adjusted >= alpha       -> ("not_significant", False)
    """
    if inference_status != "ok":
        return "undetermined", None
    if not family_complete:
        return "provisional", None
    if p_adjusted is None or not math.isfinite(p_adjusted):
        return "undetermined", None
    return ("significant", True) if p_adjusted < alpha else ("not_significant", False)


def _finite_p(p: Any) -> bool:
    return isinstance(p, (int, float, np.floating)) and not isinstance(p, bool) \
        and math.isfinite(float(p)) and 0.0 <= float(p) <= 1.0


# --------------------------------------------------------------------------- controller

class EvidenceController:
    """Builds ``EvidenceFamily`` records with one fixed method and threshold (method policy)."""

    def __init__(self, policy: Mapping[str, Any]):
        method = policy.get("multiple_comparison", BY_METHOD)
        if method != BY_METHOD:
            raise ValueError(f"unsupported multiple-comparison method {method!r}")
        self.method = method
        self.alpha = float(policy["alpha"])
        self.policy_version = str(policy.get("version", ""))

    def build_family(self, scope: str, candidate_policy: Mapping[str, Any],
                     records: Sequence[HypothesisRecord], *, complete: bool,
                     created_at: Optional[str] = None) -> EvidenceFamily:
        """One correction family over every candidate in ``records``.

        scope             "query" | "preset_search"
        candidate_policy  the pre-declared candidate policy (id, version, description)
        records           ALL candidates that were compared, including non-significant,
                          unselected and untested ones.  The input records are not modified.
        complete          False while the declared family is still being evaluated: no
                          adjusted p-values and no final labels are produced.
        """
        if scope not in _SCOPE_PREFIX:
            raise ValueError(f"unknown family scope {scope!r}")
        merged = self._merge(records)
        tested_idx = [i for i, r in enumerate(merged) if r.tested]
        if complete and tested_idx:
            adjusted = by_adjust(np.array([merged[i].p_raw for i in tested_idx], dtype=np.float64))
            for i, p_adj in zip(tested_idx, adjusted):
                merged[i].p_adjusted = float(p_adj)
                merged[i].significant = bool(p_adj < self.alpha)

        cand = _plain(dict(candidate_policy))
        content = {
            "scope": scope, "candidate_policy": cand, "method": self.method, "alpha": self.alpha,
            "complete": bool(complete),
            "hypotheses": sorted(
                ([r.hypothesis_id, r.p_raw, r.tested, r.untested_reason] for r in merged), key=lambda x: x[0]),
        }
        digest = _sha(content)
        return EvidenceFamily(
            family_id=f"{_SCOPE_PREFIX[scope]}-{digest[:16]}",
            scope=scope, candidate_policy=cand, method=self.method, alpha=self.alpha,
            n_candidates=len(merged), n_tested=len(tested_idx), n_untested=len(merged) - len(tested_idx),
            complete=bool(complete), hypotheses=merged, hypotheses_truncated=False,
            content_hash=digest,
            created_at=created_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )

    @staticmethod
    def _merge(records: Iterable[HypothesisRecord]) -> list[HypothesisRecord]:
        """Copy the records, classify tested / untested, and reject conflicting duplicates.

        The same hypothesis listed twice with the same raw p is ONE test; listed with
        different p it is a caller error (two different numbers for one hypothesis).
        """
        out: dict[str, HypothesisRecord] = {}
        for rec in records:
            tested = bool(rec.tested) and _finite_p(rec.p_raw)
            reason = None if tested else (rec.untested_reason or (
                "no valid p-value" if rec.tested else "not tested"))
            new = rec.model_copy(deep=True, update={
                "p_raw": float(rec.p_raw) if _finite_p(rec.p_raw) else None,
                "p_adjusted": None, "significant": None, "tested": tested, "untested_reason": reason})
            old = out.get(new.hypothesis_id)
            if old is not None:
                if (old.p_raw, old.tested) != (new.p_raw, new.tested):
                    raise ValueError(f"hypothesis {new.hypothesis_id} appears twice with different results")
                continue
            out[new.hypothesis_id] = new
        return list(out.values())


def record_for(trend: TrendResult, components: Mapping[str, Any]) -> HypothesisRecord:
    """HypothesisRecord of one trend: tested iff inference applied and a raw p exists."""
    tested = trend.inference_status == "ok" and _finite_p(trend.p_raw)
    return HypothesisRecord(
        hypothesis_id=trend.hypothesis_id, components=canonical_components(components),
        p_raw=trend.p_raw if tested else None, tested=tested,
        untested_reason=None if tested else (trend.inference_reason or "inference not applicable"))


def attach_families(trend: TrendResult, families: Sequence[EvidenceFamily]) -> TrendResult:
    """Copy of ``trend`` with the evidence of every family that contains exactly this hypothesis.

    * ``p_adjusted[family_id]`` is filled from each complete family that tested the
      hypothesis; ``p_raw`` is untouched.
    * The primary family is a preset-search family that contains this exact
      ``hypothesis_id`` when there is one (the search context must not be replaced by
      the smaller query family, spec §7.3), otherwise the query family that contains it.
      A family whose ids do not match — other data, geometry, recipe, baseline or
      method version — is ignored, so an old correction is never attached to new numbers.
    * Families must be passed with their full hypothesis list (not a truncated sample).
    """
    p_adjusted: dict[str, float] = {}
    matches: list[tuple[EvidenceFamily, HypothesisRecord]] = []
    for fam in families:
        rec = next((r for r in fam.hypotheses if r.hypothesis_id == trend.hypothesis_id), None)
        if rec is None:
            continue
        matches.append((fam, rec))
        if fam.complete and rec.tested and rec.p_adjusted is not None:
            p_adjusted[fam.family_id] = float(rec.p_adjusted)
    primary = next((m for m in matches if m[0].scope == "preset_search"), None) \
        or next((m for m in matches if m[0].scope == "query"), None)
    if primary is None:
        label, flag, primary_id = "undetermined", None, None
    else:
        fam, rec = primary
        status = trend.inference_status if rec.tested else "not_applicable"
        label, flag = significance(rec.p_adjusted, fam.alpha, status, fam.complete)
        primary_id = fam.family_id
    return trend.model_copy(update={
        "p_adjusted": p_adjusted, "primary_family_id": primary_id,
        "significant": flag, "significance_label": label})
