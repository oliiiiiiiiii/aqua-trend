"""T14 — calibration of the trend inference on registered SIMULATED scenarios.

The default run only checks the machinery on a tiny grid; the full study is
``pytest -m slow tests/test_stats_calibration.py`` (or
``python -m aqua_trend.stats.calibrate``) and its results are recorded in
docs/method-calibration.md.  The slow study is OPT-IN: without ``-m slow`` (or
``AQUA_RUN_SLOW=1``) it is skipped, so a plain ``pytest`` stays lean.
Everything here is simulated test data.
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))          # backend/ (aqua_trend package)

from aqua_trend.stats import calibrate as C  # noqa: E402
from aqua_trend.stats.policy import DEFAULT_LAG_POLICY_ID, DIAGNOSTIC_DEFAULTS, LAG_POLICIES  # noqa: E402

POLICY = json.loads((Path(__file__).resolve().parents[1] / "catalogue" / "policies" / "method_policy.json").read_text())
ALPHA = POLICY["alpha"]


def test_T14_registered_scenarios_cover_the_required_grid():
    scens = C.scenarios()
    assert {s.phi for s in scens} >= {0.0, 0.3, 0.6, 0.9, 0.98}
    assert {s.n for s in scens} == {120, 240, 320}
    assert {s.missing for s in scens} == {"none", "random10", "block11", "random10+block11"}
    assert {s.seasonal for s in scens} == {False, True}
    assert len(scens) == len({s.key for s in scens})
    assert DEFAULT_LAG_POLICY_ID in LAG_POLICIES and C.SIMPLICITY_ORDER == tuple(LAG_POLICIES)


def test_T14_simulation_building_blocks():
    rng = np.random.default_rng(0)
    x = C.ar1_noise(rng, 400, 320, 0.6)
    r1 = np.mean([np.corrcoef(row[1:], row[:-1])[0, 1] for row in x])
    assert r1 == pytest.approx(0.6, abs=0.03)
    assert x.var() == pytest.approx(1 / (1 - 0.36), rel=0.1)                   # stationary start
    miss = C.missing_mask(rng, 200, 240, "random10+block11")
    assert not miss[:, 0].any() and not miss[:, -1].any()
    longest = max(len(run) for row in miss for run in "".join("x" if m else " " for m in row).split())
    assert longest >= C.BLOCK_MONTHS
    assert miss.mean() == pytest.approx(0.10 + 0.9 * 11 / 240, abs=0.02)
    # the seasonal scenario removes the harmonic with a fixed-baseline climatology and keeps a trend
    sc = C.Scenario(0.0, 240, "none", True)
    t, y = C.simulate(sc, 50, rng, trend_per_decade=5.0)
    slope = np.polyfit(np.arange(240) / 120.0, y.mean(axis=0), 1)[0]
    assert slope == pytest.approx(5.0, abs=0.3)
    assert abs(np.nanmean(y[:, : C.BASELINE_MONTHS])) < 1e-9                   # anomalies are zero-mean in the baseline


def test_T14_quick_smoke_white_noise_is_close_to_nominal():
    """Small, fast grid: the shipped policy on white noise with gaps (loose Monte-Carlo bounds)."""
    reps = 1500
    row = C.evaluate(C.Scenario(0.0, 240, "random10+block11", False), POLICY, reps, seed=1)
    cand = row["candidates"][DEFAULT_LAG_POLICY_ID]
    mc = 3 * math.sqrt(ALPHA * (1 - ALPHA) / reps)
    lo, hi = C.tolerance(ALPHA)
    assert lo - mc <= cand["fpr"] <= hi + mc
    assert cand["coverage"] >= 1 - hi - mc
    assert row["gate_pass_share"] > 0.99


@pytest.fixture
def slow_opt_in(request):
    """Skip unless the run asks for slow tests (``-m slow``) or sets AQUA_RUN_SLOW=1."""
    if "slow" not in (request.config.getoption("markexpr") or "") and not os.environ.get("AQUA_RUN_SLOW"):
        pytest.skip("calibration study (minutes of CPU): run with -m slow or AQUA_RUN_SLOW=1")


@pytest.mark.slow
def test_T14_calibration_study_selects_the_shipped_policy_and_meets_the_tolerance(slow_opt_in):
    """Reduced-replicate rerun of the registered study (full table: docs/method-calibration.md).

    Asserts (a) the pre-declared selection rule still picks the shipped lag policy,
    (b) every design scenario is inside the tolerance band (plus Monte-Carlo error) and
    no stress scenario the production gate accepts is liberal, (c) the bounds stated in
    the document still hold, including the weakness for short persistent annual series.
    """
    reps = 1500
    rows = C.run(POLICY, reps, seed=20261)
    mc = 3 * math.sqrt(ALPHA * (1 - ALPHA) / reps)
    lo, hi = C.tolerance(ALPHA)
    summ = C.summarise(rows, ALPHA)
    best = min(v["design_worst_abs_dev"] for v in summ.values())
    assert summ[DEFAULT_LAG_POLICY_ID]["design_worst_abs_dev"] <= best + 2 * mc   # selection rule, up to MC error
    pid = DEFAULT_LAG_POLICY_ID
    for r in rows:
        c = r["candidates"][pid]
        where = (r["phi"], r["n"], r["missing"], r["seasonal"], c)
        if r["design"]:
            assert lo - mc <= c["fpr"] <= hi + mc, where
            assert c["coverage"] >= 1 - hi - mc, where
        elif r["gate_pass_share"] > 0.5:
            # strongly persistent series the product would infer on: never liberal (conservative is allowed)
            assert c["fpr"] <= hi + mc, where
            assert c["coverage"] >= 1 - hi - mc, where
        # documented bound for everything, including refused 10-year records with gaps at phi = 0.98
        assert c["fpr"] <= C.DOCUMENTED_MAX_FPR + mc, where
    # the persistence warning threshold lies inside the stress-tested range, not beyond it
    stress_r1 = [r["candidates"][pid]["mean_resid_r1"] for r in rows if not r["design"]]
    assert min(stress_r1) < DIAGNOSTIC_DEFAULTS["persistence_warn_r1"] < max(stress_r1)
    # the uncorrected rule-of-thumb HAC is far outside tolerance for persistent series (why it was not chosen)
    assert summ["fixed"]["stress_max_fpr"] > 0.25
    # annual grid: inside the tolerance for independent years (Gaussian and Poisson counts) ...
    annual = C.run_annual(POLICY, reps, seed=20261)
    assert {r["n"] for r in annual} == set(C.ANNUAL_LENGTHS) and {r["noise"] for r in annual} == {"ar1", "poisson"}
    for r in annual:
        c = r["candidates"][pid]
        assert c["n_fits"] > 0.9 * reps
        if r["phi"] == 0.0:
            assert lo - mc <= c["fpr"] <= hi + mc, (r["noise"], r["mean"], r["n"], c)
            assert c["coverage"] >= 1 - hi - mc, (r["noise"], r["mean"], r["n"], c)
        assert c["fpr"] <= C.DOCUMENTED_MAX_ANNUAL_FPR + mc, (r["noise"], r["phi"], r["n"], c)
    # ... and a documented weakness for short, year-to-year persistent series (hence the run-time warning)
    worst = next(r for r in annual if r["noise"] == "ar1" and r["phi"] == 0.6 and r["n"] == 20)
    assert worst["candidates"][pid]["fpr"] > hi
    assert DIAGNOSTIC_DEFAULTS["small_sample_warn_n"] > max(C.ANNUAL_LENGTHS)
