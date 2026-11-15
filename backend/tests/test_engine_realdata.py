"""ResearchEngine on the prepared NASA / NOAA series (acceptance P04, D01–D10, T02, T09, T12, T13, E03, E04, E10).

Plans come from a scripted TEST selector (no model). Assertions are structural — which
product, which status, which period, which ids — never a scientific conclusion.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures" / "engine"))

import engine_support as es  # noqa: E402

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.engine import ENGINE_VERSION, VARIABLE_METRIC_ID, ResearchEngine  # noqa: E402
from aqua_trend.errors import AquaError  # noqa: E402
from aqua_trend.selection import CatalogueLexicalProvider, PhenomenonSelector  # noqa: E402
from aqua_trend.store import PreparedDataStore  # noqa: E402
from aqua_trend.timeaxis import month_range  # noqa: E402

pytestmark = pytest.mark.realdata
PERIOD = C.Period(start="2005-01", end="2024-12")
DROUGHT = "TEST drought plan"
FLOOD = "TEST flood plan"


@pytest.fixture(scope="module")
def store():
    if not (es.DATA / "series" / f"{es.TAIWAN}.json").exists():
        pytest.skip("prepared series not present")
    return PreparedDataStore.open()


@pytest.fixture(scope="module")
def selector(store):
    return es.FakeSelector(
        es.make_plan(store, DROUGHT, [("precip", "core_indicator"), ("soil_moisture_root", "core_indicator"),
                                      ("tws_anomaly", "response"), ("et", "response")],
                     ["spi3", "spi6", "spi12"], phenomenon_id="drought"),
        es.make_plan(store, FLOOD, [("precip", "related_condition"), ("runoff", "related_condition")],
                     phenomenon_id="flood", status="partial",
                     unanswerable=["Flood frequency needs a recorded flood event catalogue."]),
        es.make_plan(store, "TEST temperature plan", [("tair", "core_indicator"), ("precip", "related_condition")]),
        es.make_plan(store, "TEST unsupported", [], status="unsupported_phenomenon",
                     unanswerable=["No catalogue variable is documented for this text."]),
    )


@pytest.fixture(scope="module")
def engine(store, selector):
    return ResearchEngine(store, selector)


@pytest.fixture(scope="module")
def drought(engine):
    stages: list[tuple] = []
    request = C.ResearchRequest(phenomenon_query=DROUGHT, region_id=es.TAIWAN, period=PERIOD)
    result = engine.run(request, engine.catalogue_snapshot(), engine.policy_snapshot(),
                        on_stage=lambda *a: stages.append(a))
    return result, stages


def by_id(result, variable_id):
    return next(v for v in result.variables if v.variable_id == variable_id)


# --------------------------------------------------------------------------- P04 / D01 / stages

def test_P04_both_fields_given_are_analysed_directly(drought, selector):
    result, stages = drought
    assert result.user_constraints.region_id == es.TAIWAN
    assert result.user_constraints.period.model_dump() == {"start": "2005-01", "end": "2024-12"}
    resolved = result.resolved
    assert (resolved.region.id, resolved.region.source) == (es.TAIWAN, "user")            # D01: one region
    assert (resolved.period.start, resolved.period.end, resolved.period.source) == ("2005-01", "2024-12", "user")
    assert resolved.preset is None and resolved.preset_status == "not_needed" and resolved.preset_missing == []
    assert resolved.region.geometry_ref == f"geo/named.geojson#{es.TAIWAN}"
    assert [v.variable_id for v in result.variables] == ["precip", "soil_moisture_root", "tws_anomaly", "et"]
    assert all(v.analysis_period.model_dump() == PERIOD.model_dump() for v in result.variables)
    assert all(v.requested_period.model_dump() == PERIOD.model_dump() for v in result.variables)


def test_stages_are_reported_in_order(drought):
    _, stages = drought
    order = [s[0] for s in stages]
    assert [s for i, s in enumerate(order) if i == 0 or order[i - 1] != s] == list(C.STAGES)
    analysing = [s for s in stages if s[0] == "analyzing"]
    assert analysing[-1][1] == analysing[-1][2] == 4 + 3 + 1          # variables + recipes + recorded drought


def test_identity_carries_every_version(drought, engine, store, selector):
    result, _ = drought
    ident = result.identity
    for key in ("dataset_version", "catalogue_version", "region_catalogue_version", "indicator_registry_version",
                "method_policy_version", "preset_policy_version", "quality_policy_version"):
        assert getattr(ident, key) == store.versions[key]
    assert ident.engine_version == ENGINE_VERSION and ident.stats_policy_version.startswith("stats-")
    assert ident.selection_plan_id == selector.by_query[DROUGHT.casefold()].selection_plan_id
    assert ident.cache_key.startswith("rk-") and ident.snapshot_id == store.snapshot_id()
    assert ident.status == "partial"                                  # recorded drought events are data_required


# --------------------------------------------------------------------------- products (D03, D04, D10, E03)

def test_D10_precipitation_resolves_to_gpcp_because_of_the_spi_recipes(drought):
    result, _ = drought
    precip = by_id(result, "precip")
    assert precip.product.selected_product_id == "p_gpcp" and precip.product.fallback
    assert precip.product.priority_rank == 2 and "p_imerg" in precip.product.fallback_reason
    assert precip.status == "ok" and precip.trend is not None
    assert precip.baseline_id == "clim.p_gpcp.1991-2020"
    assert any(w.code == "fallback_product" and w.subject == "precip" for w in result.warnings)
    for other in ("soil_moisture_root", "tws_anomaly", "et"):
        v = by_id(result, other)
        assert v.product.priority_rank == 1 and not v.product.fallback          # D03


def test_E03_derived_indicators_trace_to_product_and_recipe(drought):
    result, _ = drought
    spi = [i for i in result.indicators if i.kind == "derived_indicator"]
    assert [i.indicator_id for i in spi] == ["spi3", "spi6", "spi12"]
    for ind in spi:
        assert ind.status == "ok" and ind.input_product.selected_product_id == "p_gpcp"
        assert ind.calibration_baseline_id == "spi_calibration_1991_2020" and ind.standard_refs and ind.definition
        assert [m.metric_id.split(".")[1] for m in ind.metrics] == [
            "index", "drought_event_starts_per_year", "drought_months_per_year", "drought_severity_per_year"]
        index = ind.metrics[0]
        assert index.trend.method.seasonal_adjustment == "none_standardised"
        scale = int(ind.indicator_id[3:])
        if index.trend.inference_status == "ok":                      # method_policy.monthly_index_metric
            assert index.trend.method.lag >= scale - 1
        for annual in ind.metrics[1:]:
            assert annual.cadence == "annual" and annual.trend.method.seasonal_adjustment == "none_annual"
            assert annual.fit_window == {"start": "2005", "end": "2024"}
    calibrations = [b for b in result.baselines if b.kind == "calibration_reference"]
    assert [b.applies_to for b in calibrations] == [["spi3"], ["spi6"], ["spi12"]]
    assert all(b.start == "1991-01" and b.end == "2020-12" and b.status == "ok" for b in calibrations)


def test_D10_indicator_insufficient_but_variable_trend_kept(engine, store, selector):
    """Without a product that can calibrate the SPI the recipe is insufficient and the variable stays."""
    plan = selector.by_query[DROUGHT.casefold()]
    decisions = engine.resolver.resolve_products(plan, es.TAIWAN, PERIOD)
    forced = [engine.resolver.resolve_variable("precip", es.TAIWAN, PERIOD) if d.variable_id == "precip" else d
              for d in decisions]                                      # p_imerg, as if no recipe had been selected
    analysis = engine.analyse_candidate(plan, es.TAIWAN, PERIOD, forced)
    precip = next(v for v in analysis.variables if v.variable_id == "precip")
    assert precip.decision.selected_product_id == "p_imerg" and precip.status == "ok" and precip.metric.trend
    spi3 = next(i for i in analysis.indicators if i.indicator_id == "spi3")
    assert spi3.status == "insufficient_baseline" and all(m.trend is None for m in spi3.metrics)
    assert all(not m.record.tested and m.record.untested_reason for m in spi3.metrics)


# --------------------------------------------------------------------------- baseline / seasonal (T02, T13)

def test_T02_changing_the_analysis_period_changes_only_the_fit(engine, drought):
    first, _ = drought
    second = engine.run(C.ResearchRequest(phenomenon_query=DROUGHT, region_id=es.TAIWAN,
                                          period=C.Period(start="2010-01", end="2022-12")))
    for variable_id in ("precip", "soil_moisture_root", "tws_anomaly", "et"):
        a, b = by_id(first, variable_id), by_id(second, variable_id)
        assert a.baseline_id == b.baseline_id
        assert a.series.seasonal_cycle == b.series.seasonal_cycle and len(a.series.seasonal_cycle) == 12
        assert a.series.anomaly == b.series.anomaly and a.series.raw == b.series.raw
        assert a.trend.slope_per_decade != b.trend.slope_per_decade
        assert a.trend.hypothesis_id != b.trend.hypothesis_id
    key = lambda r: [(b.baseline_id, b.version, b.start, b.end, b.samples_per_position) for b in r.baselines]  # noqa: E731
    assert key(first) == key(second)
    spi_a = next(i for i in first.indicators if i.indicator_id == "spi6").metrics[0].series.raw
    spi_b = next(i for i in second.indicators if i.indicator_id == "spi6").metrics[0].series.raw
    assert spi_a == spi_b                                              # E09: not re-fitted on the query window


def test_series_block_relations(drought):
    result, _ = drought
    v = by_id(result, "soil_moisture_root")
    s = v.series
    assert s.times == month_range(v.full_history.start, v.full_history.end)
    assert len(s.raw) == len(s.anomaly) == len(s.fit) == len(s.times)
    for i, time in enumerate(s.times):                                 # T03: raw = anomaly + fixed monthly pattern
        if s.raw[i] is not None:
            assert s.anomaly[i] == pytest.approx(s.raw[i] - s.seasonal_cycle[int(time[5:7]) - 1], abs=1e-9)
        inside = PERIOD.start <= time <= PERIOD.end
        assert (s.fit[i] is not None) == inside                        # fitted line only inside the analysis period
    start = s.times.index(PERIOD.start)
    assert s.fit[start] == pytest.approx(v.trend.intercept)
    assert s.fit[start + 120] - s.fit[start] == pytest.approx(v.trend.slope_per_decade)
    assert v.trend.slope_per_decade == pytest.approx(10 * v.trend.slope_per_year)


def test_T13_relative_change_only_with_an_approved_denominator(engine, drought):
    result, _ = drought
    precip = by_id(result, "precip")
    assert precip.trend.relative_change_per_decade_pct is not None and "clim.p_gpcp.1991-2020" in \
        precip.trend.relative_change_basis
    cycle_mean = sum(precip.series.seasonal_cycle) / 12
    assert precip.trend.relative_change_per_decade_pct == pytest.approx(
        100 * precip.trend.slope_per_decade / cycle_mean)
    for variable_id in ("tws_anomaly", "et"):                          # anomaly / possibly-negative flux
        assert by_id(result, variable_id).trend.relative_change_per_decade_pct is None
    temperature = engine.run(C.ResearchRequest(phenomenon_query="TEST temperature plan", region_id=es.TAIWAN,
                                               period=PERIOD))
    tair = by_id(temperature, "tair")
    assert tair.unit == "°C" and tair.trend.slope_per_decade is not None
    assert tair.trend.relative_change_per_decade_pct is None and tair.trend.relative_change_basis is None
    for ind in result.indicators:
        assert all(m.trend is None or m.trend.relative_change_per_decade_pct is None for m in ind.metrics)


# --------------------------------------------------------------------------- gaps (D09)

def test_D09_grace_gap_stays_missing_at_its_calendar_position(drought, store):
    result, _ = drought
    tws = by_id(result, "tws_anomaly")
    s = tws.series
    assert s.times == month_range(s.times[0], s.times[-1])             # contiguous calendar axis
    gap = month_range("2017-07", "2018-05")                            # GRACE -> GRACE-FO
    for month in gap:
        i = s.times.index(month)
        assert s.raw[i] is None and s.anomaly[i] is None
        assert s.fit[i] is not None                                    # the line is drawn, no value is invented
    raw = store.series(es.TAIWAN, "tws")
    inside = (raw.t >= 2005 * 12) & (raw.t <= 2024 * 12 + 11)
    n_valid = int(np.isfinite(raw.values[inside]).sum())
    assert tws.trend.n_valid == n_valid < tws.trend.n_expected == 240
    assert tws.actual_support.n_valid == n_valid and tws.actual_support.longest_gap >= len(gap)
    assert tws.actual_support.coverage == pytest.approx(n_valid / 240)
    assert result.comparison.sample_support["tws_anomaly"].n_valid == n_valid
    assert any("of 240 months have data" in text for text in tws.limitations)
    assert tws.product.caveat in tws.limitations and tws.region_warning_zh


# --------------------------------------------------------------------------- evidence (T09, T12)

def test_T09_query_family_holds_every_hypothesis(drought, store):
    result, _ = drought
    family = next(f for f in result.evidence_families if f.scope == "query")
    trends = [v.trend for v in result.variables] + [m.trend for i in result.indicators for m in i.metrics if m.trend]
    n_metrics = sum(len(i.metrics) for i in result.indicators)
    assert family.n_candidates == len(result.variables) + n_metrics == 4 + 12 + 3
    assert family.complete and family.method == "benjamini_yekutieli"
    assert family.alpha == store.policy("method_policy")["alpha"]
    ids = {h.hypothesis_id for h in family.hypotheses}
    assert {t.hypothesis_id for t in trends} <= ids and len(ids) == family.n_candidates
    tested = [h for h in family.hypotheses if h.tested]
    assert family.n_tested == len(tested) == sum(1 for t in trends if t.inference_status == "ok")
    for h in family.hypotheses:
        if not h.tested:
            assert h.untested_reason and h.p_raw is None and h.p_adjusted is None and h.significant is None
    recorded = [h for h in family.hypotheses if h.components["indicator_id"] == "recorded.drought"]
    assert len(recorded) == 3 and all(not h.tested for h in recorded)
    for t in trends:
        record = next(h for h in family.hypotheses if h.hypothesis_id == t.hypothesis_id)
        assert record.p_raw == t.p_raw                                 # raw p is never overwritten
        if t.inference_status == "ok":
            assert t.primary_family_id == family.family_id
            assert t.p_adjusted[family.family_id] == record.p_adjusted >= t.p_raw
            assert t.significant == (t.p_adjusted[family.family_id] < family.alpha)
            assert t.significance_label == ("significant" if t.significant else "not_significant")
    # T15: frequency, duration and severity of one recipe are different hypotheses
    spi3 = next(i for i in result.indicators if i.indicator_id == "spi3")
    assert len({m.trend.hypothesis_id for m in spi3.metrics}) == 4


def test_T12_undetermined_is_never_not_significant_and_ci_is_pointwise(drought):
    result, _ = drought
    trends = [v.trend for v in result.variables] + [m.trend for i in result.indicators for m in i.metrics if m.trend]
    annual = [m.trend for i in result.indicators if i.kind == "derived_indicator" for m in i.metrics[1:]]
    assert annual and all(t.inference_status == "not_applicable" for t in annual)       # 20 years < policy minimum
    for t in trends:
        assert t.interval_scope == "pointwise" and t.ci_level == 0.95
        if t.inference_status != "ok":
            assert t.ci95_per_decade is None and t.p_raw is None and t.p_adjusted == {}
            assert t.significant is None and t.significance_label == "undetermined" and t.inference_reason
            assert t.slope_per_decade is not None                      # the descriptive slope is kept
    text = " ".join(s.text for s in result.summary.statements)
    assert "pointwise confidence interval" in text and "not adjusted for multiple comparisons" in text
    assert "is not a finding of 'not significant'" in text
    assert not result.provisional


def test_summary_statements_cite_evidence_and_claim_no_cause(drought):
    result, _ = drought
    summary = result.summary
    assert summary.status == "ok" and summary.generator["kind"] == "template"
    known = {h.hypothesis_id for f in result.evidence_families for h in f.hypotheses}
    cited = [e for s in summary.statements for e in s.evidence_ids]
    assert cited and set(cited) <= known
    numeric = [s for s in summary.statements if "per decade" in s.text]
    assert len(numeric) == 4 + 12 and all(s.evidence_ids for s in numeric)
    text = " ".join(s.text for s in summary.statements)
    assert "selected by the user" in text and "do not show that one variable caused another" in text
    precip = by_id(result, "precip")
    assert f"{precip.trend.slope_per_decade:+.3g} mm/day per decade" in text


# --------------------------------------------------------------------------- flood (E04, E10)

def test_E04_E10_flood_plan(engine):
    result = engine.run(C.ResearchRequest(phenomenon_query=FLOOD, region_id=es.TAIWAN, period=PERIOD))
    assert [(v.variable_id, v.status) for v in result.variables] == [("precip", "ok"), ("runoff", "ok")]
    assert all(v.trend is not None and v.series is not None for v in result.variables)
    assert by_id(result, "precip").product.selected_product_id == "p_imerg"            # no recipe needs GPCP here
    kinds = {i.indicator_id: i for i in result.indicators}
    assert set(kinds) == {"recorded.flood", "derived.flood"}
    recorded = kinds["recorded.flood"]
    assert recorded.kind == "recorded_event" and recorded.status == "data_required" and recorded.events == []
    for metric in recorded.metrics:                                    # no zero counts, no time axis
        assert metric.status == "data_required" and metric.series is None and metric.trend is None
    derived = kinds["derived.flood"]
    assert derived.kind == "derived_indicator" and derived.status == "definition_required"
    assert derived.metrics == [] and "flood frequency" in derived.status_reason
    assert result.identity.status == "partial"
    family = result.evidence_families[0]
    assert family.n_tested == 2 and family.n_untested == 3
    numeric = [s for s in result.summary.statements if "per decade" in s.text]
    assert len(numeric) == 2 and not any("flood" in s.text.lower() for s in numeric)
    assert any(w.code == "data_required" and w.subject == "recorded.flood" for w in result.warnings)


# --------------------------------------------------------------------------- selection states (S03, S05)

def test_S03_unsupported_phenomenon_adds_no_variables(engine):
    result = engine.run(C.ResearchRequest(phenomenon_query="TEST unsupported", region_id=es.TAIWAN, period=PERIOD))
    assert result.selection.status == "unsupported_phenomenon"
    assert result.variables == [] and result.indicators == [] and result.evidence_families == []
    assert any(w.code == "unsupported_phenomenon" for w in result.warnings)
    assert result.identity.status == "partial" and result.summary.status == "ok"
    assert result.resolved.region.id == es.TAIWAN and result.resolved.region.source == "user"


def test_S05_text_never_sets_region_or_period(store, tmp_path):
    """Explicit catalogue matcher (labelled is_language_model=false) — place and date words are ignored."""
    selector = PhenomenonSelector(store, CatalogueLexicalProvider(store), plan_dir=tmp_path / "plans")
    engine = ResearchEngine(store, selector)
    blank = engine.run(C.ResearchRequest(phenomenon_query="flood in Taiwan 2022"))
    assert blank.user_constraints.region_id is None and blank.user_constraints.period is None
    assert blank.resolved.region is None and blank.resolved.period is None
    assert blank.resolved.preset_status == "no_matching_preset"
    assert blank.resolved.preset_missing == ["region_id", "period"]
    assert blank.resolved.preset_reason == "preset engine not configured"
    assert all(v.trend is None and v.series is None for v in blank.variables) and blank.variables
    assert blank.selection.selector.is_language_model is False
    assert any(w.code == "selector_not_language_model" for w in blank.warnings)

    chosen = engine.run(C.ResearchRequest(phenomenon_query="flood in Taiwan 2022", region_id=es.TAIWAN,
                                          period=PERIOD))
    assert chosen.resolved.region.id == chosen.user_constraints.region_id
    assert (chosen.resolved.period.start, chosen.resolved.period.end) == ("2005-01", "2024-12")
    assert chosen.selection.selection_plan_id == blank.selection.selection_plan_id and chosen.selection.reused


def test_region_only_keeps_the_region_and_shows_full_history(engine):
    result = engine.run(C.ResearchRequest(phenomenon_query=FLOOD, region_id=es.TAIWAN))
    assert result.resolved.region.source == "user" and result.resolved.period is None
    assert result.resolved.preset_missing == ["period"]
    for v in result.variables:
        assert v.trend is None and v.analysis_period is None and v.series.fit is None
        assert v.series.raw and v.full_history is not None
    assert result.evidence_families == [] and result.comparison.status == "not_available"


# --------------------------------------------------------------------------- regions (D02) and periods (D08)

def test_D02_region_without_series_is_a_result_not_an_error(engine, store):
    region_id = next(rid for rid, r in store.regions().items() if r["type"] == "basin3" and not r["series_available"])
    result = engine.run(C.ResearchRequest(phenomenon_query=DROUGHT, region_id=region_id, period=PERIOD))
    assert result.resolved.region.id == region_id and result.resolved.region.source == "user"
    assert [v.status for v in result.variables] == ["no_series"] * 4
    assert all(v.series is None and v.trend is None and v.product.selected_product_id is None
               for v in result.variables)
    assert all("no other region" in v.status_reason for v in result.variables)
    spi = [i for i in result.indicators if i.kind == "derived_indicator"]
    assert [i.status for i in spi] == ["no_series"] * 3
    family = result.evidence_families[0]
    assert family.n_tested == 0 and family.n_untested == family.n_candidates == 19
    assert result.comparison.status == "not_available" and result.identity.status == "partial"


def test_D02_hexagon_region(engine, store):
    region_id = next(rid for rid, r in store.regions().items() if r["type"] == "hex")
    result = engine.run(C.ResearchRequest(phenomenon_query=FLOOD, region_id=region_id, period=PERIOD))
    assert result.resolved.region.type == "hex" and result.resolved.region.id == region_id
    assert [v.status for v in result.variables] == ["no_series", "no_series"]
    assert all("hexagon cells carry only precomputed trend layers" in v.status_reason for v in result.variables)


def test_D08_user_period_that_a_product_cannot_support(engine):
    period = C.Period(start="1990-01", end="2024-12")
    result = engine.run(C.ResearchRequest(phenomenon_query=DROUGHT, region_id=es.TAIWAN, period=period))
    assert (result.resolved.period.start, result.resolved.period.end) == ("1990-01", "2024-12")
    soil = by_id(result, "soil_moisture_root")                         # GLDAS record starts 2000-01
    assert soil.status == "insufficient_data" and not soil.in_comparison and soil.comparison_exclusion_reason
    assert soil.requested_period.model_dump() == period.model_dump()
    assert soil.analysis_period.model_dump() == period.model_dump()    # not shortened
    assert (soil.actual_support.start, soil.actual_support.n_expected) == ("2000-01", 420)
    assert soil.actual_support.n_valid == 300 and soil.actual_support.coverage < 0.8
    assert soil.trend.slope_per_decade is not None and soil.trend.inference_status == "not_applicable"
    assert soil.trend.significance_label == "undetermined" and soil.trend.p_raw is None
    precip = by_id(result, "precip")
    assert precip.status == "ok" and precip.in_comparison and precip.actual_support.n_valid == 420
    assert result.comparison.period.model_dump() == period.model_dump()
    excluded = {e["variable_id"]: e for e in result.comparison.excluded}
    assert set(excluded) == {"soil_moisture_root", "tws_anomaly"}
    assert excluded["soil_moisture_root"]["actual_support"]["start"] == "2000-01"
    assert set(result.comparison.eligible_variable_ids) == {"precip", "et"}             # D07
    assert by_id(result, "soil_moisture_root").full_history.start == "2000-01"


# --------------------------------------------------------------------------- reproducibility / errors

def test_same_request_gives_identical_numbers_and_hypothesis_ids(engine, drought):
    first, _ = drought
    again = engine.run(C.ResearchRequest(phenomenon_query=DROUGHT, region_id=es.TAIWAN, period=PERIOD))
    assert again.identity.research_id != first.identity.research_id
    assert again.identity.cache_key == first.identity.cache_key

    def numbers(result):
        doc = result.model_dump(mode="json")
        for key in ("research_id", "created_at"):
            doc["identity"].pop(key)
        for family in doc["evidence_families"]:
            family.pop("created_at")
        return doc

    assert numbers(again) == numbers(first)
    assert [f.family_id for f in again.evidence_families] == [f.family_id for f in first.evidence_families]


def test_analyse_candidate_is_the_same_code_path_as_run(engine, drought, selector):
    result, _ = drought
    analysis = engine.analyse_candidate(selector.by_query[DROUGHT.casefold()], es.TAIWAN, PERIOD)
    trends = {t.hypothesis_id: t for t in
              [v.trend for v in result.variables] + [m.trend for i in result.indicators for m in i.metrics if m.trend]}
    light = {m.hypothesis_id: m for m in analysis.metrics()}
    assert len(light) == 19 and set(trends) <= set(light)
    for hid, trend in trends.items():
        m = light[hid]
        assert m.trend.slope_per_decade == trend.slope_per_decade and m.trend.p_raw == trend.p_raw
        assert m.trend.ci95_per_decade == trend.ci95_per_decade and m.trend.method.lag == trend.method.lag
        assert m.trend.inference_status == trend.inference_status
    assert {r.hypothesis_id for r in analysis.records()} == \
        {h.hypothesis_id for h in result.evidence_families[0].hypotheses}
    precip = next(v for v in analysis.variables if v.variable_id == "precip")
    assert precip.metric.metric_id == VARIABLE_METRIC_ID and precip.metric.scale_sd > 0
    assert all(h is not None for h in precip.metric.half_slopes)


def test_validation_errors(engine):
    cases = [
        (dict(region_id="not-a-region", period=PERIOD), "unknown_region"),
        (dict(region_id=es.TAIWAN, period=C.Period(start="2024-01", end="2005-12")), "invalid_period"),
        (dict(region_id=es.TAIWAN, period=C.Period(start="2005-13", end="2024-12")), "invalid_period"),
        (dict(region_id=es.TAIWAN, period=C.Period(start="2005-01", end="")), "invalid_period"),
    ]
    for fields, code in cases:
        with pytest.raises(AquaError) as err:
            engine.run(C.ResearchRequest(phenomenon_query=DROUGHT, **fields))
        assert err.value.code == code
    with pytest.raises(AquaError) as err:
        engine.run(C.ResearchRequest(phenomenon_query="  ", region_id=es.TAIWAN, period=PERIOD))
    assert err.value.code == "empty_query"
    with pytest.raises(AquaError) as err:
        engine.run(C.ResearchRequest(phenomenon_query=DROUGHT, region_id=es.TAIWAN, period=PERIOD), "snap-other")
    assert err.value.code == "data_release_invalid"


def test_no_nan_or_infinity_anywhere_in_the_serialised_result(engine, drought, store):
    region_id = next(rid for rid, r in store.regions().items() if r["type"] == "hex")
    results = [drought[0],
               engine.run(C.ResearchRequest(phenomenon_query=DROUGHT, region_id=es.TAIWAN,
                                            period=C.Period(start="1990-01", end="2024-12"))),
               engine.run(C.ResearchRequest(phenomenon_query=DROUGHT, region_id=es.TAIWAN,
                                            period=C.Period(start="2023-01", end="2023-06"))),     # T06: far too short
               engine.run(C.ResearchRequest(phenomenon_query=FLOOD, region_id=region_id, period=PERIOD))]
    for result in results:
        text = engine.presenter.export_json(result)
        assert "NaN" not in text and "Infinity" not in text
        doc = json.loads(text, parse_constant=lambda name: pytest.fail(f"non-finite constant {name}"))
        count = 0
        for path, value in es.walk_numbers(doc):
            assert math.isfinite(value), path
            count += 1
        assert count > 0
    short = results[2]
    for v in short.variables:                                          # 6 months: nothing to describe, no fake label
        assert v.trend is None or (v.trend.p_raw is None and v.trend.significant is None)
        assert v.status == "insufficient_data" or v.trend.significance_label == "undetermined"
