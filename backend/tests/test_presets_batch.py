"""The vectorised preset batch gives the research engine's numbers (spec §4, §8.1; acceptance T09, section 7).

Runs on the labelled TEST release of tests/fixtures/presets (TEST data, not science).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures" / "presets"))

import compare_support as cs  # noqa: E402
import presets_support as ps  # noqa: E402

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.engine import ResearchEngine  # noqa: E402
from aqua_trend.presets import BatchAnalyser, PresetEngine, PresetPolicy, declare_candidates, half_slopes_batch  # noqa: E402
from aqua_trend.stats import half_slopes  # noqa: E402
from aqua_trend.storage import ResearchStorage  # noqa: E402
from aqua_trend.store import PreparedDataStore  # noqa: E402


@pytest.fixture()
def parts(tmp_path):
    store = PreparedDataStore.open(*ps.build_preset_release(tmp_path / "release"))
    plan, _ = ps.plans(store)
    storage = ResearchStorage(tmp_path / "var")
    presets = PresetEngine(store, storage=storage)
    engine = ResearchEngine(store, ps.es.FakeSelector(plan), preset_engine=presets, storage=storage)
    presets.bind(engine)
    return store, plan, engine, presets


@pytest.mark.parametrize("constraints", [{}, {"period": C.Period(start="1995-03", end="2014-08")},
                                         {"region_id": "reg-a"}, {"region_id": "reg-b"}])
def test_section7_every_batch_candidate_equals_the_engine_analysis(parts, constraints):
    store, plan, engine, presets = parts
    outcome = presets.search(plan, C.UserConstraints(phenomenon_query=ps.QUERY, **constraints))
    assert outcome.scored and outcome.record["counts"]["batch_rows"] > 0
    problems = [d for s in outcome.scored for d in cs.differences(s.result, engine, plan)]
    assert not problems, problems[:10]


def test_T09_batch_records_are_exactly_the_engine_records_in_engine_order(parts):
    store, plan, engine, _ = parts
    candset = declare_candidates(store, engine.resolver, plan, PresetPolicy.from_store(store), None, None)
    results = BatchAnalyser(engine, plan).analyse(candset.analysed)
    for res in results:
        ref = engine.analyse_candidate(plan, res.candidate.region_id, res.candidate.period, res.candidate.decisions)
        assert [r.hypothesis_id for r in res.records()] == [r.hypothesis_id for r in ref.records()]
        assert [r.tested for r in res.records()] == [r.tested for r in ref.records()]
    ids = [r.hypothesis_id for res in results for r in res.records()]
    assert len(ids) == len(set(ids))                       # one hypothesis per (region, period, metric)


@pytest.mark.parametrize("steps_per_year,cadence", [(12, "monthly"), (1, "annual")])
def test_half_slopes_batch_equals_stats_half_slopes(steps_per_year, cadence):
    """TEST numbers (seeded noise with gaps): row-wise half slopes equal ``stats.half_slopes``."""
    rng = np.random.RandomState(7)
    grid = rng.normal(0.0, 1.0, (9, 61)) + np.linspace(0.0, 2.0, 61)[None, :]
    grid[1, 5:20] = np.nan                                  # a gap inside the first half
    grid[2, :29] = np.nan                                   # first half: fewer than 3 valid values
    grid[3, :] = np.nan                                     # nothing at all
    grid[4, 31:] = 4.0                                      # constant second half: slope exactly 0
    grid[5, 32:] = np.nan
    grid[5, 30] = np.nan                                    # second half: 1 valid value
    t = np.arange(600, 661)
    first, second = half_slopes_batch(grid, steps_per_year)
    for i in range(grid.shape[0]):
        want = half_slopes(t, grid[i], cadence=cadence, period=(600, 660))
        got = tuple(None if not np.isfinite(x) else float(x) for x in (first[i], second[i]))
        assert all(cs.same_number(a, b) for a, b in zip(got, want)), (i, got, want)
