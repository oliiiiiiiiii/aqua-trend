"""PresetEngine on the prepared NASA / NOAA series (spec §8, §7.3; acceptance P01–P05, P08, T09, T10, section 7).

Plans are scripted TEST plans over REAL catalogue variables (``is_language_model: false``); the
slow test uses the explicit catalogue matcher.  Assertions are structural (ids, counts, equality
with the engine, registered policy) — never a scientific conclusion about a region.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures" / "presets"))

import compare_support as cs  # noqa: E402
import presets_support as ps  # noqa: E402

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.engine import ResearchEngine  # noqa: E402
from aqua_trend.presets import BatchAnalyser, PresetEngine, PresetPolicy, declare_candidates  # noqa: E402
from aqua_trend.resolve import period_bounds  # noqa: E402
from aqua_trend.selection import CatalogueLexicalProvider, PhenomenonSelector  # noqa: E402
from aqua_trend.stats import by_adjust  # noqa: E402
from aqua_trend.storage import ResearchStorage  # noqa: E402
from aqua_trend.store import PreparedDataStore  # noqa: E402

es = ps.es
pytestmark = pytest.mark.realdata
QUERY, QUERY_SPI = "TEST water plan", "TEST water plan with indices"
VARIABLES = [("precip", "core_indicator"), ("soil_moisture_root", "related_condition"), ("tws_anomaly", "response")]
USER_PERIOD = C.Period(start="2004-03", end="2019-08")


class Real:
    def __init__(self, var: Path):
        self.store = PreparedDataStore.open()
        self.plan = es.make_plan(self.store, QUERY, VARIABLES)
        self.plan_spi = es.make_plan(self.store, QUERY_SPI, VARIABLES, ["spi3", "spi12"])
        self.selector = es.FakeSelector(self.plan, self.plan_spi)
        self.storage = ResearchStorage(var)
        self.presets = PresetEngine(self.store, storage=self.storage)
        self.engine = ResearchEngine(self.store, self.selector, preset_engine=self.presets, storage=self.storage)
        self.presets.bind(self.engine)
        self.policy = PresetPolicy.from_store(self.store)

    def user(self, **fields) -> C.UserConstraints:
        return C.UserConstraints(phenomenon_query=QUERY, **fields)


@pytest.fixture(scope="module")
def real(tmp_path_factory) -> Real:
    if not (es.DATA / "series" / f"{es.TAIWAN}.json").exists():
        pytest.skip("prepared series not present")
    return Real(tmp_path_factory.mktemp("presets-real"))


@pytest.fixture(scope="module")
def blank(real):
    """ONE both-blank search of the 3-variable plan, shared by the tests of this module."""
    return real.presets.search(real.plan, real.user())


def windows_of(candidates) -> set[tuple[int, str]]:
    """(length in months, kind) of declared candidates."""
    return {(period_bounds(C.Period(**c["period"]))[1] - period_bounds(C.Period(**c["period"]))[0] + 1, c["kind"])
            for c in candidates}


# --------------------------------------------------------------------------- P01–P05

def test_P01_both_blank_recommends_one_region_and_one_period_from_the_declared_list(real, blank):
    fill = real.presets.fill(real.plan, real.user(), None)
    assert fill.status == "applied" and fill.preset.rank == 1 and fill.preset.search_complete
    region = real.store.region(fill.region_id)
    assert region["type"] in real.policy.region_layers and region["type"] != "hex"
    declared = {(c["region_id"], c["period"]["start"], c["period"]["end"]): c for c in blank.record["candidates"]}
    row = declared[(fill.region_id, fill.period.start, fill.period.end)]
    assert row["status"] == "analysed" and row["score"] == fill.preset.score.total
    family = fill.family
    ids = {h.hypothesis_id for h in family.hypotheses}
    assert fill.preset.reasons and all(r.evidence_ids for r in fill.preset.reasons)
    assert all(e in ids for r in fill.preset.reasons for e in r.evidence_ids)     # reasons point at data facts
    assert all(0.0 <= value <= 1.0 for value in fill.preset.score.components.model_dump().values()
               if value is not None)


def test_P01_candidate_periods_are_the_registered_windows_only(real, blank):
    kinds = {c["kind"] for c in blank.record["candidates"]}
    allowed = {"full_common_period"} | {f"window_{n}y" for n in real.policy.window_lengths_years}
    assert kinds <= allowed and "full_common_period" in kinds
    for months, kind in windows_of(blank.record["candidates"]):
        if kind.startswith("window_"):
            assert months == 12 * int(kind.removeprefix("window_").removesuffix("y"))
    for c in blank.record["candidates"]:
        if c["kind"].startswith("window_"):
            assert c["period"]["start"].endswith("-01") and c["period"]["end"].endswith("-12")
    types = {real.store.region(c["region_id"])["type"] for c in blank.record["candidates"]}
    assert types <= set(real.policy.region_layers)
    assert blank.record["window_rule"]["lengths_years"] == list(real.policy.window_lengths_years)


def test_P02_user_region_is_the_only_candidate_region(real):
    user = real.user(region_id=es.TAIWAN)
    outcome = real.presets.search(real.plan_spi, user)
    assert {c["region_id"] for c in outcome.record["candidates"]} == {es.TAIWAN}
    fill = real.presets.fill(real.plan_spi, user, None)
    assert fill.status == "applied" and fill.region_id == es.TAIWAN
    assert outcome.record["filled_fields"] == ["period"] and fill.preset.filled_fields == ["period"]
    assert all(p.region_id == es.TAIWAN for p in outcome.presets)
    assert not [d for s in outcome.scored for d in cs.differences(s.result, real.engine, real.plan_spi)]


def test_P03_user_period_is_the_only_candidate_period(real):
    user = real.user(period=USER_PERIOD)
    outcome = real.presets.search(real.plan, user)
    periods = {(c["period"]["start"], c["period"]["end"]) for c in outcome.record["candidates"]}
    assert periods == {(USER_PERIOD.start, USER_PERIOD.end)}
    assert {c["kind"] for c in outcome.record["candidates"]} == {"user_period"}
    fill = real.presets.fill(real.plan, user, None)
    assert fill.status == "applied" and fill.period == USER_PERIOD and fill.preset.filled_fields == ["region_id"]


def test_P04_nothing_blank_runs_no_search(real, monkeypatch):
    monkeypatch.setattr(real.presets, "search", lambda *a, **k: pytest.fail("a search was started"))
    fill = real.presets.fill(real.plan, real.user(region_id=es.TAIWAN, period=USER_PERIOD), None)
    assert (fill.status, fill.region_id, fill.period, fill.preset) == ("not_needed", es.TAIWAN, USER_PERIOD, None)


def test_P05_hex_cell_has_no_series_and_is_not_replaced_by_another_region(real):
    hex_id = next(rid for rid, r in sorted(real.store.regions().items()) if r["type"] == "hex")
    fill = real.presets.fill(real.plan, real.user(region_id=hex_id), None)
    assert fill.status == "no_matching_preset" and fill.missing == ["period"]
    assert fill.region_id == hex_id and fill.period is None and hex_id in fill.reason
    record = real.storage.load_document("preset_searches", fill.search_id)
    assert record["complete"] and record["presets"] == [] and record["family"] is None
    assert [r["region_id"] for r in record["regions"]["excluded"]] == [hex_id]


def test_P05_period_before_the_records_is_not_stretched(real):
    period = C.Period(start="1950-01", end="1959-12")
    fill = real.presets.fill(real.plan, real.user(period=period), None)
    assert fill.status == "no_matching_preset" and fill.missing == ["region_id"]
    assert fill.region_id is None and fill.period == period and "1950-01..1959-12" in fill.reason
    record = real.storage.load_document("preset_searches", fill.search_id)
    assert record["candidates"] and all(c["status"] == "excluded" and c["reason"] for c in record["candidates"])


# --------------------------------------------------------------------------- T09 / T10: family and record

def test_T09_family_is_every_hypothesis_of_the_batch_adjusted_together(real, blank):
    family = real.presets.family(blank.family_id)
    counts = blank.record["counts"]
    per_candidate = len(real.plan.variable_set)
    assert family.scope == "preset_search" and family.complete and not family.hypotheses_truncated
    assert family.n_candidates == len(family.hypotheses) == counts["candidates_analysed"] * per_candidate
    assert family.n_tested + family.n_untested == family.n_candidates
    assert len({h.hypothesis_id for h in family.hypotheses}) == family.n_candidates
    tested = [h for h in family.hypotheses if h.tested]
    assert len(tested) == family.n_tested and all(h.untested_reason for h in family.hypotheses if not h.tested)
    adjusted = by_adjust([h.p_raw for h in tested])
    assert all(cs.same_number(h.p_adjusted, float(q)) for h, q in zip(tested, adjusted))
    assert all(h.p_adjusted is None and h.significant is None for h in family.hypotheses if not h.tested)
    assert all(h.p_adjusted >= h.p_raw for h in tested)
    top = blank.presets[0]
    assert top.family_id == family.family_id and top.family_ref == "family:" + family.family_id
    assert top.family_counts["n_candidates"] == family.n_candidates


def test_T10_the_declared_list_is_stored_and_reproducible_from_availability(real, blank):
    record = real.storage.load_document("preset_searches", blank.search_id)
    assert record["complete"] and record["status"] == "complete" and record["policy"] == real.policy.raw
    again = declare_candidates(real.store, real.engine.resolver, real.plan, real.policy, None, None)
    assert [(c.region_id, c.period.start, c.period.end, c.kind, c.status) for c in again.candidates] == \
        [(c["region_id"], c["period"]["start"], c["period"]["end"], c["kind"], c["status"])
         for c in record["candidates"]]
    assert all(c["reason"] for c in record["candidates"] if c["status"] == "excluded")
    assert all(r["reason"] for r in record["regions"]["excluded"])
    assert record["counts"]["candidates_declared"] == len(record["candidates"])


def test_section7_not_significant_and_undetermined_candidates_rank_and_stay_distinct(real, blank):
    labels = {c["evidence"]["label"] for c in blank.record["candidates"] if c["status"] == "analysed"}
    assert labels <= {"has_significant", "none_significant", "undetermined_only"}
    for preset in blank.presets:
        assert preset.evidence["label"] in labels
        for fact in preset.variable_facts:
            if fact["inference"] == "not_applicable":
                assert fact["significance_label"] == "undetermined" and fact["p_adjusted"] is None
            else:
                assert fact["significance_label"] in ("significant", "not_significant")
    scores = [p.score.total for p in blank.presets if not p.pinned]
    assert scores == sorted(scores, reverse=True)                # significance is not a ranking input


# --------------------------------------------------------------------------- batch == engine, with recipes

def test_section7_batch_equals_engine_across_regions_with_indicator_recipes(real):
    """Several regions per group, so rows other than the self-checked first row are compared."""
    by_type: dict[str, list[str]] = {}
    for rid, region in sorted(real.store.regions().items()):
        if region.get("series_available"):
            by_type.setdefault(region["type"], []).append(rid)
    regions = [ids[i] for ids in by_type.values() for i in (0, len(ids) // 2)][:10] + [es.TAIWAN]
    candidates = []
    for rid in dict.fromkeys(regions):
        candidates += declare_candidates(real.store, real.engine.resolver, real.plan_spi, real.policy, rid,
                                         None).analysed
    analyser = BatchAnalyser(real.engine, real.plan_spi)
    results = analyser.analyse(candidates)
    assert analyser.rows_fitted > analyser.groups_fitted          # real multi-row groups were fitted
    assert any(f.kind == "derived_indicator" and f.inference_ok for r in results for f in r.facts)
    problems = [d for r in results for d in cs.differences(r, real.engine, real.plan_spi)]
    assert not problems, problems[:10]


def test_section7_sampled_candidates_of_the_blank_search_equal_the_engine(real, blank):
    sample = blank.scored[::97]
    assert len(sample) >= 5
    problems = [d for s in sample for d in cs.differences(s.result, real.engine, real.plan)]
    assert not problems, problems[:10]


# --------------------------------------------------------------------------- P08: determinism and cache

def test_P08_a_second_independent_run_gives_the_same_presets_order_and_ids(real, blank, tmp_path):
    other = Real(tmp_path / "var")
    again = other.presets.search(other.plan, other.user())
    assert not again.from_cache and again.search_id == blank.search_id and again.family_id == blank.family_id
    assert [p.model_dump(mode="json") for p in again.presets] == [p.model_dump(mode="json") for p in blank.presets]
    reopened = Real(real.storage.root)
    cached = reopened.presets.search(reopened.plan, reopened.user())
    assert cached.from_cache and [p.preset_id for p in cached.presets] == [p.preset_id for p in blank.presets]


# --------------------------------------------------------------------------- performance budget (slow)

@pytest.mark.slow
def test_section7_both_blank_search_of_a_typical_plan_fits_the_budget(tmp_path):
    """The catalogue matcher's drought plan (9 variables + SPI-3/6/12): a both-blank search."""
    store = PreparedDataStore.open()
    storage = ResearchStorage(tmp_path / "var")
    selector = PhenomenonSelector(store, provider=CatalogueLexicalProvider(store), plan_dir=tmp_path / "plans")
    presets = PresetEngine(store, storage=storage)
    presets.bind(ResearchEngine(store, selector, preset_engine=presets, storage=storage))
    plan = selector.select("drought")
    outcome = presets.search(plan, C.UserConstraints(phenomenon_query="drought"))
    counts, timing = outcome.record["counts"], outcome.record["timing"]
    print(counts, timing)
    assert outcome.complete and outcome.presets and counts["hypotheses"] == counts["hypotheses_tested"] + \
        counts["hypotheses_untested"]
    assert timing["total_s"] < 120.0        # generous CI bound on a shared machine; measured: docs/preset-policy.md
