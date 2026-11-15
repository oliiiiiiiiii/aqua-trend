"""TEST helper — compares the vectorised preset batch with ``ResearchEngine.analyse_candidate``.

No data in this file; it only states which fields of a hypothesis must be the engine's.
"""
from __future__ import annotations

import math
from typing import Any, Optional

from aqua_trend.presets import CandidateResult, MetricFacts

EXACT = ("kind", "item_id", "metric_id", "unit", "cadence", "product_id", "status", "hypothesis_id",
         "inference_ok", "n_valid", "n_expected")
NUMBERS = ("slope_per_decade", "p_raw", "coverage", "scale_sd")
REL_TOL = 1e-9


def same_number(a: Optional[float], b: Optional[float]) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(a, b, rel_tol=REL_TOL, abs_tol=1e-12)


def differences(result: CandidateResult, engine: Any, plan: Any) -> list[str]:
    """Every field in which a batch candidate differs from the engine's own analysis of it."""
    cand = result.candidate
    analysis = engine.analyse_candidate(plan, cand.region_id, cand.period, cand.decisions)
    expected = [MetricFacts.from_outcome(m) for m in analysis.metrics()]
    where = cand.label()
    if len(expected) != len(result.facts):
        return [f"{where}: {len(result.facts)} hypotheses, engine has {len(expected)}"]
    out: list[str] = []
    for got, want in zip(result.facts, expected):
        tag = f"{where} {want.item_id}/{want.metric_id}"
        for name in EXACT:
            if getattr(got, name) != getattr(want, name):
                out.append(f"{tag}: {name} {getattr(got, name)!r} != {getattr(want, name)!r}")
        for name in NUMBERS:
            if not same_number(getattr(got, name), getattr(want, name)):
                out.append(f"{tag}: {name} {getattr(got, name)!r} != {getattr(want, name)!r}")
        if got.kind == "variable":                       # the stability component reads variables only
            for a, b in zip(got.half_slopes, want.half_slopes):
                if not same_number(a, b):
                    out.append(f"{tag}: half slope {a!r} != {b!r}")
        if got.status != "ok" and got.status_reason != want.status_reason:
            out.append(f"{tag}: status_reason {got.status_reason!r} != {want.status_reason!r}")
        record, ref = got.record, want.record
        if (record.hypothesis_id, record.tested, record.components) != (ref.hypothesis_id, ref.tested, ref.components):
            out.append(f"{tag}: hypothesis record differs")
        if not same_number(record.p_raw, ref.p_raw):
            out.append(f"{tag}: record p_raw {record.p_raw!r} != {ref.p_raw!r}")
        if not record.tested and record.untested_reason != ref.untested_reason:
            out.append(f"{tag}: untested_reason {record.untested_reason!r} != {ref.untested_reason!r}")
    return out
