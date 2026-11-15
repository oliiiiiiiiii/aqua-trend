"""PlanResolver — acceptance D02–D08, D10 (spec §6, data contract §4.2).

Fixture cases use the labelled TEST release of tests/fixtures/engine; ``realdata`` cases read
the prepared series and assert structural facts only (which product, which status).
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures" / "engine"))

import engine_support as es  # noqa: E402
import store_support as fx  # noqa: E402

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.errors import AquaError  # noqa: E402
from aqua_trend.indicators import IndicatorRegistry  # noqa: E402
from aqua_trend.resolve import (  # noqa: E402
    FLAG_DESCRIPTIVE, FLAG_FALLBACK, FLAG_INDICATOR, FLAG_PARTIAL_PERIOD, PlanResolver,
)
from aqua_trend.store import PreparedDataStore  # noqa: E402


@pytest.fixture()
def release(tmp_path):
    return es.build_engine_release(tmp_path)


@pytest.fixture()
def test_store(release):
    return PreparedDataStore.open(*release)


@pytest.fixture(scope="module")
def real():
    if not (es.DATA / "series" / f"{es.TAIWAN}.json").exists():
        pytest.skip("prepared series not present")
    store = PreparedDataStore.open()
    return store, PlanResolver(store, IndicatorRegistry(store))


class RefusingRegistry:
    """TEST registry: one recipe that consumes t_precip and that no product can calibrate."""

    def requirements(self, indicator_id):
        return {"variable_id": "t_precip"}

    def calibration_support(self, indicator_id, series):
        return SimpleNamespace(status="insufficient_baseline", status_reason="TEST: record too short")


# --------------------------------------------------------------------------- fixture release

def test_D03_primary_product_is_used_when_applicable(test_store):
    d = PlanResolver(test_store).resolve_variable("t_precip", "reg-a", C.Period(start="2001-01", end="2003-12"))
    assert (d.selected_product_id, d.priority_rank, d.fallback, d.status) == ("t_precip_a", 1, False, "ok")
    assert d.fallback_reason is None and d.rejected == []
    assert d.available_period.model_dump() == {"start": "2000-01", "end": "2003-12"}
    assert d.coverage == 1.0 and d.source_refs[0].ref_id == "t_ref"


def test_D04_fallback_follows_the_approved_order_and_states_the_reason(test_store):
    d = PlanResolver(test_store).resolve_variable("t_precip", "reg-c", C.Period(start="2001-01", end="2003-12"))
    assert (d.selected_product_id, d.priority_rank, d.fallback, d.status) == ("t_precip_b", 2, True, "ok")
    assert FLAG_FALLBACK in d.quality_flags
    assert "t_precip_a" in d.fallback_reason and "not prepared" in d.fallback_reason
    assert d.rejected == [{"product_id": "t_precip_a", "rank": 1, "status": "no_series",
                           "reason": "product t_precip_a was not prepared for region reg-c"}]


def test_D04_the_decision_does_not_depend_on_the_values(release, tmp_path):
    """Same availability, very different numbers (other slope, other level): the same decision."""
    cat, data, cache = release
    before = PlanResolver(PreparedDataStore.open(cat, data, cache)).resolve_variable(
        "t_precip", "reg-a", C.Period(start="2001-01", end="2003-12"))
    doc = fx.read(data / "series" / "reg-a.json")
    for layer, sign in (("t_precip_a", -50.0), ("t_precip_b", 80.0)):
        values = doc["layers"][layer]["values"]
        doc["layers"][layer]["values"] = [None if v is None else v + sign * i for i, v in enumerate(values)]
    fx.write(data / "series" / "reg-a.json", doc)
    after = PlanResolver(PreparedDataStore.open(cat, data, tmp_path / "cache2")).resolve_variable(
        "t_precip", "reg-a", C.Period(start="2001-01", end="2003-12"))
    for key in ("selected_product_id", "priority_rank", "fallback", "status", "coverage", "quality_flags"):
        assert getattr(after, key) == getattr(before, key)


def test_D05_another_quantity_of_the_same_category_is_never_a_fallback(test_store):
    d = PlanResolver(test_store).resolve_variable("t_soil", "reg-c", None)
    assert d.selected_product_id is None and d.status == "no_series"
    assert [r["product_id"] for r in d.rejected] == ["t_soil"]          # only the concept's own approved products


def test_D06_all_products_unusable_keeps_the_variable_visible_with_reasons(test_store):
    period = C.Period(start="2001-01", end="2003-12")
    plan = es.make_plan(test_store, "TEST", [("t_precip", "core_indicator"), ("t_temp", "related_condition"),
                                             ("t_daily", "response")])
    decisions = PlanResolver(test_store).resolve_products(plan, "reg-a", period)
    assert [d.variable_id for d in decisions] == ["t_precip", "t_temp", "t_daily"]      # nothing dropped
    assert [d.status for d in decisions] == ["ok", "unsupported_resolution", "unsupported_resolution"]
    assert decisions[1].selected_product_id is None and "t_kelvin" in decisions[1].status_reason
    assert "kept as selected" in decisions[1].status_reason


@pytest.mark.parametrize("region_id", ["reg-b", "hex-t1"])
def test_D02_region_with_a_boundary_but_no_series(test_store, region_id):
    d = PlanResolver(test_store).resolve_variable("t_precip", region_id, C.Period(start="2001-01", end="2003-12"))
    assert d.selected_product_id is None and d.status == "no_series"
    assert "no other region" in d.status_reason and len(d.rejected) == 2


def test_unknown_region_is_an_error_not_a_status(test_store):
    with pytest.raises(AquaError) as err:
        PlanResolver(test_store).resolve_variable("t_precip", "reg-zzz", None)
    assert err.value.code == "unknown_region"


def test_T07_unsupported_fixed_baseline_is_reported_not_recomputed(test_store):
    d = PlanResolver(test_store).resolve_variable("t_precip", "reg-d", C.Period(start="2002-03", end="2003-12"))
    assert d.selected_product_id == "t_precip_b" and d.status == "insufficient_baseline"
    assert FLAG_DESCRIPTIVE in d.quality_flags and d.suitability_layer == 5
    assert "not shortened or moved" in d.status_reason


def test_D10_no_product_supports_the_recipe_keeps_the_trend_product(test_store):
    resolver = PlanResolver(test_store, RefusingRegistry())
    d = resolver.resolve_variable("t_precip", "reg-a", C.Period(start="2001-01", end="2003-12"), ["t_recipe"])
    assert (d.selected_product_id, d.status, d.fallback) == ("t_precip_a", "ok", False)
    assert FLAG_INDICATOR in d.quality_flags and d.recipe_problems and d.suitability_layer == 3


def test_D08_user_period_is_kept_and_partial_support_is_listed(test_store):
    resolver = PlanResolver(test_store)
    period = C.Period(start="1999-01", end="2003-12")            # t_soil starts 2000-01: 48 of 60 months = 80 %
    plan = es.make_plan(test_store, "TEST", [("t_soil", "core_indicator"), ("t_precip", "related_condition")])
    decisions = resolver.resolve_products(plan, "reg-a", period)
    soil = decisions[0]
    assert soil.status == "ok" and FLAG_PARTIAL_PERIOD in soil.quality_flags and soil.coverage == pytest.approx(0.8)
    block = resolver.comparison(decisions, "reg-a", period, user_period=True)
    assert block.period.model_dump() == {"start": "1999-01", "end": "2003-12"}       # verbatim, not shortened
    assert "t_soil" in block.partially_supported_variable_ids

    long_period = C.Period(start="1990-01", end="2003-12")       # 48 of 168 months: not supported
    decisions = resolver.resolve_products(plan, "reg-a", long_period)
    assert [d.status for d in decisions] == ["insufficient_data", "insufficient_data"]
    assert decisions[0].selected_product_id == "t_soil"          # kept for description, with the reason
    block = resolver.comparison(decisions, "reg-a", long_period, user_period=True)
    assert block.status == "no_common_period" and block.eligible_variable_ids == []
    entry = block.excluded[0]
    assert entry["requested_period"] == {"start": "1990-01", "end": "2003-12"}
    assert entry["actual_support"] == {"start": "2000-01", "end": "2003-12"} and entry["coverage"] < 0.8


def test_D07_common_period_is_the_intersection_or_none(test_store):
    resolver = PlanResolver(test_store)
    plan = es.make_plan(test_store, "TEST", [("t_soil", "core_indicator"), ("t_precip", "related_condition")])
    decisions = resolver.resolve_products(plan, "reg-a", None)
    assert [d.available_period.start for d in decisions] == ["2000-01", "2000-01"]
    # 4 common years are below quality_policy.comparison.min_common_years (10): no common period
    assert test_store.policy("quality_policy")["comparison"]["min_common_years"] == 10
    assert resolver.common_period(decisions, "reg-a") is None


def test_invalid_period_is_rejected(test_store):
    with pytest.raises(AquaError) as err:
        PlanResolver(test_store).resolve_variable("t_precip", "reg-a", C.Period(start="2003-01", end="2001-12"))
    assert err.value.code == "invalid_period"


# --------------------------------------------------------------------------- prepared NASA / NOAA data

@pytest.mark.realdata
def test_D10_spi_recipes_move_precipitation_to_gpcp_before_any_result(real):
    store, resolver = real
    period = C.Period(start="2005-01", end="2024-12")
    plain = resolver.resolve_variable("precip", es.TAIWAN, period)
    assert (plain.selected_product_id, plain.priority_rank, plain.fallback) == ("p_imerg", 1, False)
    with_spi = resolver.resolve_variable("precip", es.TAIWAN, period, ["spi3", "spi6", "spi12"])
    assert (with_spi.selected_product_id, with_spi.priority_rank, with_spi.fallback) == ("p_gpcp", 2, True)
    assert with_spi.status == "ok" and with_spi.suitability_layer == 1
    assert "p_imerg" in with_spi.fallback_reason and "insufficient_baseline" in with_spi.fallback_reason
    assert with_spi.rejected[0]["product_id"] == "p_imerg"


@pytest.mark.realdata
def test_D05_et_is_one_physical_quantity(real):
    store, resolver = real
    assert store.concept("et")["approved_product_ids"] == ["et_m2"]
    d = resolver.resolve_variable("et", es.TAIWAN, C.Period(start="2005-01", end="2024-12"))
    assert d.selected_product_id == "et_m2" and not d.fallback
    assert {r["product_id"] for r in d.registered_not_approved} == {"et_m2land", "et_gldas"}
    assert store.product("et_m2land")["approved"] is False and store.product("et_gldas")["approved"] is False
    # root-zone and column soil moisture are different concepts with disjoint products
    assert resolver.resolve_variable("soil_moisture_root", es.TAIWAN).selected_product_id == "sm_root"
    assert resolver.resolve_variable("soil_moisture_column", es.TAIWAN).selected_product_id == "sm_total"


@pytest.mark.realdata
def test_D04_period_beyond_the_primary_record_falls_back_by_priority(real):
    _, resolver = real
    d = resolver.resolve_variable("precip", es.TAIWAN, C.Period(start="2005-01", end="2026-06"))
    assert (d.selected_product_id, d.priority_rank) == ("p_gpcp", 2)       # p_imerg ends 2025-09
    assert "do not span the whole period" in d.fallback_reason


@pytest.mark.realdata
def test_D07_D08_real_periods(real):
    store, resolver = real
    plan = es.make_plan(store, "TEST drought", [("precip", "core_indicator"), ("tair", "related_condition"),
                                                ("tws_anomaly", "response")], ["spi3"])
    free = resolver.resolve_products(plan, es.TAIWAN, None)
    common = resolver.common_period(free, es.TAIWAN)
    assert common.start == max(d.available_period.start for d in free)
    assert common.end == min(d.available_period.end for d in free)

    period = C.Period(start="1990-01", end="2024-12")            # before every 2000-era product
    decisions = {d.variable_id: d for d in resolver.resolve_products(plan, es.TAIWAN, period)}
    assert decisions["precip"].status == "ok" and decisions["precip"].selected_product_id == "p_gpcp"
    assert decisions["tair"].status == "insufficient_data" and decisions["tair"].selected_product_id == "tair"
    block = resolver.comparison(list(decisions.values()), es.TAIWAN, period, user_period=True)
    assert block.period.model_dump() == {"start": "1990-01", "end": "2024-12"}
    assert block.eligible_variable_ids == ["precip"] and block.status == "single_variable"
    assert {e["variable_id"] for e in block.excluded} == {"tair", "tws_anomaly"}


@pytest.mark.realdata
def test_D02_real_regions_without_series(real):
    store, resolver = real
    no_series = next(rid for rid, r in store.regions().items() if r["type"] == "basin3" and not r["series_available"])
    hexagon = next(rid for rid, r in store.regions().items() if r["type"] == "hex")
    for rid in (no_series, hexagon):
        d = resolver.resolve_variable("precip", rid, C.Period(start="2005-01", end="2024-12"))
        assert d.selected_product_id is None and d.status == "no_series" and len(d.rejected) == 3


@pytest.mark.realdata
def test_region_records_keep_their_countries(real):
    """Regression for the store fix: countries stay records ({zh, iso, en}), not bare codes."""
    store, _ = real
    assert store.region(es.TAIWAN)["countries"] == [{"zh": store.region(es.TAIWAN)["countries"][0]["zh"],
                                                     "iso": "TWN", "en": "Taiwan"}]
