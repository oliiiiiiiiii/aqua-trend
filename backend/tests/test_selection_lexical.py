"""CatalogueLexicalProvider: explicit, deterministic catalogue matcher (S02, S03, S05; TEST catalogue)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))          # backend/ (aqua_trend package)
sys.path.insert(0, str(Path(__file__).parent / "fixtures" / "selection"))
from selection_support import FakeStore  # noqa: E402

from aqua_trend.selection import CatalogueLexicalProvider, PhenomenonSelector  # noqa: E402


@pytest.fixture()
def selector(tmp_path) -> PhenomenonSelector:
    store = FakeStore()
    return PhenomenonSelector(store, provider=CatalogueLexicalProvider(store), plan_dir=tmp_path)


def _ids(plan) -> list[str]:
    return [v.variable_id for v in plan.variable_set]


def test_lexical_plans_are_labelled_as_not_a_language_model(selector):
    plan = selector.select("drought")
    assert plan.selector.provider == "catalogue_lexical"
    assert plan.selector.is_language_model is False and plan.selector.model is None


@pytest.mark.parametrize("query", ["Drought", "乾旱", "Are droughts getting worse?", "旱災趨勢", "a long dry spell"])
def test_S02_drought_in_zh_and_en_copies_the_documented_links(selector, query):
    plan = selector.select(query)
    assert plan.status == "ok"
    assert _ids(plan) == ["precip", "soil_moisture_root", "ndvi"]
    assert [v.role for v in plan.variable_set] == ["core_indicator", "related_condition", "response"]
    assert plan.indicator_recipe_ids == ["spi3"]
    precip = plan.variable_set[0]
    assert "precipitation deficit defines meteorological drought" in precip.reason
    assert "Limits:" in precip.reason                       # documented limits travel with the reason
    assert precip.catalogue_refs == ["test_ref_drought", "test_ref_precip", "drought"]


@pytest.mark.parametrize("query,label", [("heat wave", "Heatwave"), ("熱浪變多了嗎", "熱浪"), ("extreme heat", "Heatwave")])
def test_S02_non_drought_flood_phenomenon_uses_the_same_matcher(selector, query, label):
    plan = selector.select(query)
    assert plan.phenomenon_label == label
    assert _ids(plan) == ["tair", "vpd"]
    assert plan.status == "partial"                         # the note says what cannot be answered
    assert plan.unanswerable == ["TEST: no approved heatwave indicator recipe exists."]


def test_S03_flood_is_partial_and_states_the_missing_event_record(selector):
    plan = selector.select("淹水")
    assert plan.status == "partial" and _ids(plan) == ["precip", "runoff"]
    assert all(v.role == "related_condition" for v in plan.variable_set)   # precipitation is not relabelled
    assert any("event catalogue" in u for u in plan.unanswerable)
    assert plan.variable_set[1].catalogue_refs == ["flood"]


@pytest.mark.parametrize("query", ["stock market crash", "火山爆發", "asdf qwerty", "droughtiness of markets"])
def test_S03_unknown_text_is_unsupported_with_no_variables(selector, query):
    plan = selector.select(query)
    assert plan.status == "unsupported_phenomenon"
    assert plan.variable_set == [] and plan.indicator_recipe_ids == []
    assert plan.unanswerable and "wording" in plan.unanswerable[0]


def test_S03_variable_named_without_a_phenomenon_note_is_partial_and_says_so(selector):
    plan = selector.select("snow water equivalent decline")
    assert plan.status == "partial" and _ids(plan) == ["swe"]
    assert plan.variable_set[0].catalogue_refs == ["concept:swe"]
    assert "TEST: water held in the snowpack." in plan.variable_set[0].reason
    assert "No curated phenomenon note" in plan.unanswerable[0]
    assert plan.indicator_recipe_ids == []


def test_S03_extra_named_variable_is_reported_not_given_an_undocumented_role(selector):
    plan = selector.select("drought and runoff")
    assert "runoff" not in _ids(plan)
    assert plan.status == "partial" and any("runoff" in u for u in plan.unanswerable)


def test_S03_two_phenomena_are_merged_without_duplicates(selector):
    plan = selector.select("drought then flood")
    assert _ids(plan) == ["precip", "soil_moisture_root", "ndvi", "runoff"]
    assert plan.variable_set[0].role == "core_indicator"    # first documented link kept
    assert plan.indicator_recipe_ids == ["spi3", "flood_recorded"]
    assert plan.phenomenon_label == "Drought + Flood"


@pytest.mark.parametrize("query,ignored", [
    ("2022 年歐洲的乾旱", ["2022", "歐洲"]),
    ("Drought in Europe since 2003", ["2003", "Europe"]),
    ("臺灣 1998-2010 淹水", ["1998", "2010", "臺灣"]),
    ("flood in Taiwan 2009-08", ["2009-08", "Taiwan"]),
])
def test_S05_place_names_and_years_are_listed_and_leave_constraints_untouched(selector, query, ignored):
    plan = selector.select(query)
    assert plan.ignored_text_constraints == ignored
    dumped = plan.model_dump(mode="json")
    assert not {"region", "region_id", "period", "start", "end"} & set(dumped)
    assert plan.variable_set                                 # the phenomenon is still recognised


def test_S05_same_phenomenon_with_and_without_place_words_selects_the_same_variables(selector):
    assert _ids(selector.select("乾旱")) == _ids(selector.select("2022 年歐洲的乾旱"))


def test_lexical_matcher_is_deterministic_and_reads_the_current_catalogue(tmp_path):
    store = FakeStore()
    provider = CatalogueLexicalProvider(store)
    a = provider.complete("", "<phenomenon_query>\ndrought\n</phenomenon_query>", {})
    assert a == provider.complete("", "<phenomenon_query>\ndrought\n</phenomenon_query>", {})
    del store._data["concepts"]["ndvi"]                      # catalogue changed: link is reported, not used
    b = provider.complete("", "<phenomenon_query>\ndrought\n</phenomenon_query>", {})
    assert [v["variable_id"] for v in b["variable_set"]] == ["precip", "soil_moisture_root"]
    assert b["status"] == "partial" and "ndvi" in b["unanswerable"][0]
