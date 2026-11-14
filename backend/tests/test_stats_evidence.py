"""BY-FDR and EvidenceController acceptance tests (T08, T09, T12, T15, T16).

The p-values and ids in this file are TEST DATA written for the tests.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from scipy import stats as sps

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))          # backend/ (aqua_trend package)

from aqua_trend.contracts import HypothesisRecord, Period, TrendMethod, TrendResult  # noqa: E402
from aqua_trend.stats import (  # noqa: E402
    EvidenceController, attach_families, by_adjust, hypothesis_components, hypothesis_id, significance,
)
from aqua_trend.stats.evidence import record_for  # noqa: E402
from aqua_trend.stats.policy import STATS_POLICY_VERSION  # noqa: E402

POLICY = json.loads((Path(__file__).resolve().parents[1] / "catalogue" / "policies" / "method_policy.json").read_text())
CANDIDATE_POLICY = {"id": "query_family", "version": "test-1", "description": "every trend tested in one research"}

BASE = dict(
    region_id="basin3:amazon", geometry_version="geom-1", analysis_period={"start": "2005-01", "end": "2024-12"},
    metric_id="anomaly_linear_trend", variable_id="precip", product_id="p_imerg", dataset_version="data-1",
    baseline_id="bl_p_imerg", baseline_version="bl-1", recipe_version=None, method_policy_version="method-1.0.0",
)


def _rec(i, p, **kw):
    comp = hypothesis_components(**{**BASE, "region_id": f"r{i}"})
    return HypothesisRecord(hypothesis_id=hypothesis_id(comp), components=comp, p_raw=p, **kw)


def _trend(hid, p_raw, status="ok"):
    return TrendResult(
        hypothesis_id=hid, metric_id="anomaly_linear_trend", unit="mm/day", slope_per_year=0.1, slope_per_decade=1.0,
        p_raw=p_raw, inference_status=status, inference_reason=None if status == "ok" else "span too short",
        method=TrendMethod(estimator="ols", covariance=None, seasonal_adjustment="fixed_baseline_monthly_anomaly",
                           policy_version="method-1.0.0"),
        n_valid=240, n_expected=240, coverage=1.0)


# ----------------------------------------------------------------------------- T08

@pytest.mark.parametrize("p", [
    [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216, 0.222, 0.251, 0.269, 0.275, 0.34,
     0.341, 0.384, 0.569, 0.594, 0.696, 0.762, 0.94, 0.942, 0.975, 0.986],
    [0.5], [0.0, 1.0], [0.04, 0.04, 0.04], [1e-12, 0.9, 1e-12, 0.3],
])
def test_T08_by_matches_scipy_reference(p):
    p = np.array(p)
    adj = by_adjust(p)
    np.testing.assert_allclose(adj, sps.false_discovery_control(p, method="by"), rtol=1e-12, atol=0)
    assert np.all(adj >= p) and np.all(adj <= 1.0)
    order = np.argsort(p, kind="stable")
    assert np.all(np.diff(adj[order]) >= 0)                                    # monotone in p


def test_T08_by_random_sets_and_input_validation():
    rng = np.random.default_rng(0)
    for m in (2, 17, 400):
        p = rng.random(m) ** 3
        np.testing.assert_allclose(by_adjust(p), sps.false_discovery_control(p, method="by"), rtol=1e-12)
    assert by_adjust(np.array([])).size == 0
    for bad in ([0.1, np.nan], [0.1, 1.2], [-0.1]):
        with pytest.raises(ValueError):
            by_adjust(np.array(bad))


def test_T08_raw_p_is_never_overwritten():
    ps = [0.001, 0.02, 0.03, 0.5, 0.9]
    records = [_rec(i, p) for i, p in enumerate(ps)]
    fam = EvidenceController(POLICY).build_family("query", CANDIDATE_POLICY, records, complete=True)
    assert [r.p_raw for r in fam.hypotheses] == ps
    np.testing.assert_allclose([r.p_adjusted for r in fam.hypotheses],
                               sps.false_discovery_control(np.array(ps), method="by"))
    assert all(r.p_adjusted is None and r.significant is None for r in records)   # inputs untouched
    assert fam.method == "benjamini_yekutieli" and fam.alpha == POLICY["alpha"]
    assert [r.significant for r in fam.hypotheses] == [True, False, False, False, False]


# ----------------------------------------------------------------------------- T09

def test_T09_non_significant_and_untested_candidates_stay_in_the_family():
    records = [
        _rec(0, 0.004), _rec(1, 0.6), _rec(2, 0.97),                           # tested; two clearly not significant
        _rec(3, None, tested=False, untested_reason="coverage 40 % of the analysis period"),
        _rec(4, float("nan")),                                                 # claims tested but has no valid p
        _rec(5, None),
    ]
    ctrl = EvidenceController(POLICY)
    fam = ctrl.build_family("preset_search", CANDIDATE_POLICY, records, complete=True)
    assert (fam.n_candidates, fam.n_tested, fam.n_untested) == (6, 3, 3)
    assert len(fam.hypotheses) == 6 and not fam.hypotheses_truncated
    by_id = {r.hypothesis_id: r for r in fam.hypotheses}
    # correction uses all three tested hypotheses, not only the "winner"
    assert by_id[records[0].hypothesis_id].p_adjusted == pytest.approx(by_adjust(np.array([0.004, 0.6, 0.97]))[0])
    alone = ctrl.build_family("preset_search", CANDIDATE_POLICY, records[:1], complete=True)
    assert alone.hypotheses[0].p_adjusted < by_id[records[0].hypothesis_id].p_adjusted
    assert alone.family_id != fam.family_id
    # untested ones keep a reason and get no adjusted p / no significance
    r3, r4, r5 = (by_id[records[i].hypothesis_id] for i in (3, 4, 5))
    assert r3.untested_reason == "coverage 40 % of the analysis period"
    for r in (r3, r4, r5):
        assert not r.tested and r.untested_reason and r.p_adjusted is None and r.significant is None and r.p_raw is None
    json.dumps(fam.model_dump(), allow_nan=False)


def test_family_id_is_a_content_hash():
    ctrl = EvidenceController(POLICY)
    recs = [_rec(i, p) for i, p in enumerate([0.01, 0.2, 0.7])]
    a = ctrl.build_family("query", CANDIDATE_POLICY, recs, complete=True, created_at="2026-01-01T00:00:00Z")
    b = ctrl.build_family("query", CANDIDATE_POLICY, list(reversed(recs)), complete=True)
    assert a.family_id == b.family_id and a.content_hash == b.content_hash    # order / timestamp independent
    assert a.family_id.startswith("fam-q-") and a.created_at == "2026-01-01T00:00:00Z"
    changed_p = ctrl.build_family("query", CANDIDATE_POLICY, [_rec(0, 0.011)] + recs[1:], complete=True)
    other_scope = ctrl.build_family("preset_search", CANDIDATE_POLICY, recs, complete=True)
    other_policy = ctrl.build_family("query", {**CANDIDATE_POLICY, "version": "test-2"}, recs, complete=True)
    incomplete = ctrl.build_family("query", CANDIDATE_POLICY, recs, complete=False)
    assert len({a.family_id, changed_p.family_id, other_scope.family_id, other_policy.family_id,
                incomplete.family_id}) == 5
    assert other_scope.family_id.startswith("fam-ps-")
    # the same hypothesis twice is one test; two different p for it is an error
    assert ctrl.build_family("query", CANDIDATE_POLICY, recs + recs[:1], complete=True).n_candidates == 3
    with pytest.raises(ValueError):
        ctrl.build_family("query", CANDIDATE_POLICY, recs + [_rec(0, 0.5)], complete=True)
    with pytest.raises(ValueError):
        ctrl.build_family("everything", CANDIDATE_POLICY, recs, complete=True)


def test_incomplete_family_is_provisional():
    ctrl = EvidenceController(POLICY)
    recs = [_rec(i, p) for i, p in enumerate([1e-6, 0.2])]
    fam = ctrl.build_family("preset_search", CANDIDATE_POLICY, recs, complete=False)
    assert not fam.complete
    assert all(r.p_adjusted is None and r.significant is None for r in fam.hypotheses)   # no final correction
    assert [r.p_raw for r in fam.hypotheses] == [1e-6, 0.2]
    out = attach_families(_trend(recs[0].hypothesis_id, 1e-6), [fam])
    assert out.significance_label == "provisional" and out.significant is None and out.p_adjusted == {}
    assert out.primary_family_id == fam.family_id


def test_significance_helper_never_calls_undetermined_not_significant():
    assert significance(0.01, 0.05, "ok", True) == ("significant", True)
    assert significance(0.05, 0.05, "ok", True) == ("not_significant", False)   # strict "<" (method policy)
    assert significance(0.2, 0.05, "ok", True) == ("not_significant", False)
    assert significance(0.01, 0.05, "ok", False) == ("provisional", None)
    assert significance(None, 0.05, "not_applicable", True) == ("undetermined", None)
    assert significance(None, 0.05, "not_applicable", False) == ("undetermined", None)
    assert significance(0.9, 0.05, "not_applicable", True) == ("undetermined", None)
    assert significance(None, 0.05, "ok", True) == ("undetermined", None)


# ----------------------------------------------------------------------------- attach / T11-style primary family, T12

def test_attach_families_keeps_both_scopes_and_prefers_the_matching_search_family():
    ctrl = EvidenceController(POLICY)
    target = _rec(0, 0.004)
    query = ctrl.build_family("query", CANDIDATE_POLICY, [target, _rec(1, 0.3)], complete=True)
    search = ctrl.build_family("preset_search", {"id": "preset_search", "version": "preset-1.0.0"},
                               [target] + [_rec(i, 0.2 + 0.01 * i) for i in range(2, 40)], complete=True)
    trend = _trend(target.hypothesis_id, 0.004)
    out = attach_families(trend, [query, search])
    assert set(out.p_adjusted) == {query.family_id, search.family_id}
    assert out.primary_family_id == search.family_id
    assert out.p_adjusted[search.family_id] > out.p_adjusted[query.family_id]
    assert out.p_adjusted[query.family_id] < 0.05 <= out.p_adjusted[search.family_id]
    assert out.significance_label == "not_significant" and out.significant is False   # the search context rules
    assert out.p_raw == 0.004 and trend.p_adjusted == {}                       # raw p kept; input not mutated
    assert out.interval_scope == "pointwise"                                   # T12: correction does not touch the CI
    only_query = attach_families(trend, [query])
    assert only_query.primary_family_id == query.family_id and only_query.significant is True


def test_attach_families_untested_hypothesis_is_undetermined():
    ctrl = EvidenceController(POLICY)
    trend = _trend("hyp-x", None, status="not_applicable")
    rec = record_for(trend, hypothesis_components(**BASE))
    assert not rec.tested and rec.untested_reason == "span too short"
    fam = ctrl.build_family("query", CANDIDATE_POLICY, [rec, _rec(1, 0.01)], complete=True)
    out = attach_families(trend, [fam])
    assert out.significance_label == "undetermined" and out.significant is None and out.p_adjusted == {}
    assert out.primary_family_id == fam.family_id
    nowhere = attach_families(_trend("hyp-unknown", 0.01), [fam])
    assert nowhere.primary_family_id is None and nowhere.significance_label == "undetermined"


# ----------------------------------------------------------------------------- T15

def test_T15_frequency_and_duration_are_distinct_hypotheses():
    common = {**BASE, "variable_id": None, "indicator_id": "spi3", "recipe_version": "spi-1.0.0",
              "baseline_id": "cal_spi3", "aggregation_version": "annual-1"}
    freq = hypothesis_id({**common, "metric_id": "spi3.drought_events_per_year"})
    dur = hypothesis_id({**common, "metric_id": "spi3.drought_months_per_year"})
    sev = hypothesis_id({**common, "metric_id": "spi3.severity_per_year"})
    assert len({freq, dur, sev}) == 3
    ctrl = EvidenceController(POLICY)
    recs = [HypothesisRecord(hypothesis_id=h, components={**common, "metric_id": m}, p_raw=p)
            for h, m, p in ((freq, "spi3.drought_events_per_year", 0.01), (dur, "spi3.drought_months_per_year", 0.01),
                            (sev, "spi3.severity_per_year", 0.4))]
    fam = ctrl.build_family("query", CANDIDATE_POLICY, recs, complete=True)
    assert fam.n_tested == 3                                                   # the family does not under-count
    assert fam.hypotheses[0].p_adjusted == pytest.approx(by_adjust(np.array([0.01, 0.01, 0.4]))[0])


def test_hypothesis_id_is_stable_and_canonical():
    a = hypothesis_id(BASE)
    assert a == hypothesis_id(dict(reversed(list(BASE.items()))))              # key order
    assert a == hypothesis_id({**BASE, "analysis_period": Period(start="2005-01", end="2024-12")})
    assert a == hypothesis_id(hypothesis_components(**BASE))
    assert a == hypothesis_id({**BASE, "coverage_version": None})              # explicit null == absent optional
    assert a.startswith("hyp-basin3_amazon-anomaly_linear_trend-") and len(a.rsplit("-", 1)[1]) == 16
    # pinned value: the id must not drift between releases (it keys stored evidence)
    assert a == "hyp-basin3_amazon-anomaly_linear_trend-eb555af3cf868e20"
    # the statistics policy version (lag rule, prewhitening, reference distribution) is part of the identity
    assert hypothesis_components(**BASE)["stats_policy_version"] == STATS_POLICY_VERSION == "stats-1.1.0"
    assert a == hypothesis_id({**BASE, "stats_policy_version": STATS_POLICY_VERSION})
    assert a != hypothesis_id({**BASE, "stats_policy_version": "stats-1.0.0"})
    for missing in ("region_id", "geometry_version", "analysis_period", "metric_id", "dataset_version",
                    "method_policy_version"):
        with pytest.raises(ValueError):
            hypothesis_id({k: v for k, v in BASE.items() if k != missing})
    with pytest.raises(ValueError):
        hypothesis_id({**BASE, "variable_id": None})                           # neither variable nor indicator
    with pytest.raises(ValueError):
        hypothesis_id({**BASE, "product_id": None})                            # neither product nor event catalogue
    with pytest.raises(ValueError):
        hypothesis_id({**BASE, "extra": float("nan")})


# ----------------------------------------------------------------------------- T16

@pytest.mark.parametrize("change", [
    {"dataset_version": "data-2"}, {"geometry_version": "geom-2"}, {"recipe_version": "recipe-2"},
    {"baseline_version": "bl-2"}, {"baseline_id": "bl_other"}, {"method_policy_version": "method-1.1.0"},
    {"product_id": "p_gpcp"}, {"analysis_period": {"start": "2005-01", "end": "2023-12"}},
    {"region_id": "basin3:congo"}, {"coverage_version": "cov-2"}, {"aggregation_version": "agg-2"},
    {"metric_id": "other_metric"}, {"stats_policy_version": "stats-0.9.0"},
])
def test_T16_any_version_change_gives_a_new_hypothesis(change):
    old_id, new_id = hypothesis_id(BASE), hypothesis_id({**BASE, **change})
    assert old_id != new_id
    # an old preset-search correction cannot be attached to the new numbers
    ctrl = EvidenceController(POLICY)
    old_family = ctrl.build_family(
        "preset_search", CANDIDATE_POLICY,
        [HypothesisRecord(hypothesis_id=old_id, components=BASE, p_raw=0.001)], complete=True)
    replay = attach_families(_trend(new_id, 0.001), [old_family])
    assert replay.p_adjusted == {} and replay.primary_family_id is None
    assert replay.significance_label == "undetermined" and replay.significant is None
    # the old evidence itself stays intact and addressable
    assert old_family.hypotheses[0].hypothesis_id == old_id and old_family.hypotheses[0].p_adjusted == 0.001
    same = attach_families(_trend(old_id, 0.001), [old_family])
    assert same.primary_family_id == old_family.family_id and same.significant is True
