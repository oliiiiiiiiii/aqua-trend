"""Reviewer tests for the selector: catalogue shapes, traceability (S04), ignored words (S05).

Uses the TEST catalogue fixture, plus the delivered ``catalogue/indicators.json`` for one
shape check (no numbers are read from it).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).parent / "fixtures" / "selection"))
from selection_support import FakeStore, ScriptedProvider, drought_answer  # noqa: E402

from aqua_trend.errors import AquaError  # noqa: E402
from aqua_trend.selection import (  # noqa: E402
    AnthropicProvider, CatalogueLexicalProvider, CatalogueSnapshot, PhenomenonSelector, ProviderUnavailable,
    validate_selection,
)
from aqua_trend.selection.prompt import build_output_schema, build_system_prompt  # noqa: E402


class StoreShapedStore(FakeStore):
    """TEST store with the shapes the delivered catalogue uses: per-language aliases, recipe list."""

    def phenomena(self):
        notes = super().phenomena()
        for note in notes:
            flat = note["aliases"]
            note["aliases"] = {"zh": [a for a in flat if not a.isascii()], "en": [a for a in flat if a.isascii()]}
        return {n["phenomenon_id"]: n for n in notes}      # id-keyed, as loaded by store/catalogue.py

    def indicator_recipes(self):
        return list(super().indicator_recipes().values())

    def regions(self):
        regions = super().regions()
        regions["b3-test"] = {"id": "b3-test", "name": "TEST basin 111",
                              "countries": [{"zh": "埃及", "iso": "EGY"}, {"zh": "蘇丹", "iso": "SDN"}]}
        return regions


def _plans(tmp_path: Path) -> list[Path]:
    return sorted((tmp_path / "plans").glob("*.json")) if (tmp_path / "plans").exists() else []


# ---------------------------------------------------------------- catalogue shapes

@pytest.mark.parametrize("query,expected", [
    ("a long dry spell", ["precip", "soil_moisture_root", "ndvi"]),
    ("旱災趨勢", ["precip", "soil_moisture_root", "ndvi"]),
])
def test_per_language_aliases_are_matched(tmp_path, query, expected):
    store = StoreShapedStore()
    selector = PhenomenonSelector(store, provider=CatalogueLexicalProvider(store), plan_dir=tmp_path)
    plan = selector.select(query)
    assert [v.variable_id for v in plan.variable_set] == expected
    assert plan.indicator_recipe_ids == ["spi3"]


def test_alias_language_keys_are_not_aliases(tmp_path):
    """'en' / 'zh' are dictionary keys of the alias table, never words that select a phenomenon."""
    store = StoreShapedStore()
    selector = PhenomenonSelector(store, provider=CatalogueLexicalProvider(store), plan_dir=tmp_path)
    plan = selector.select("en route to zh")
    assert plan.status == "unsupported_phenomenon" and plan.variable_set == []
    context = json.loads(build_system_prompt(CatalogueSnapshot.from_store(store)).split("OFFLINE CATALOGUE (JSON)\n")[1])
    drought = next(n for n in context["phenomenon_notes"] if n["phenomenon_id"] == "drought")
    assert set(drought["aliases"]) == {"dry spell", "旱災", "乾旱"}


def test_delivered_indicator_registry_shape_is_read():
    """The delivered recipes are a list with ``required_variables`` objects; ids reach the schema (S01)."""
    path = BACKEND / "catalogue" / "indicators.json"
    if not path.is_file():
        pytest.skip("catalogue/indicators.json not delivered")
    recipes = json.loads(path.read_text(encoding="utf-8"))["recipes"]
    store = FakeStore()
    store.indicator_recipes = lambda: recipes            # type: ignore[method-assign]
    snapshot = CatalogueSnapshot.from_store(store)
    ids = {r["indicator_id"] for r in recipes}
    assert set(snapshot.recipes) == ids
    assert set(build_output_schema(snapshot)["properties"]["indicator_recipe_ids"]["items"]["enum"]) == ids
    for recipe in recipes:
        for needed in recipe["required_variables"]:
            ref = "recipe:" + recipe["indicator_id"]
            assert ref in snapshot.traceable_refs(needed["variable_id"])
            assert ref not in snapshot.traceable_refs("tair")


def test_member_country_names_are_recognised_as_ignored_place_words(tmp_path):
    store = StoreShapedStore()
    selector = PhenomenonSelector(store, provider=CatalogueLexicalProvider(store), plan_dir=tmp_path)
    plan = selector.select("埃及乾旱 2019")
    assert plan.ignored_text_constraints == ["2019", "埃及"]
    assert not hasattr(plan, "region") and not hasattr(plan, "period")


# ---------------------------------------------------------------- S04 traceability

def _select(tmp_path, answer, query="Drought"):
    selector = PhenomenonSelector(FakeStore(), provider=ScriptedProvider(answer), plan_dir=tmp_path)
    return selector.select(query)


@pytest.mark.parametrize("refs", [
    ["test_ref_tair"],          # a real reference, but for air temperature
    ["heatwave"],               # a real note, which does not link precipitation
    ["concept:tair"],           # another concept's description
    ["recipe:flood_recorded"],  # a recipe that does not need precipitation in the TEST catalogue
])
def test_S04_reference_that_documents_something_else_is_not_a_trace(tmp_path, refs):
    answer = drought_answer()
    answer["variable_set"][0]["catalogue_refs"] = refs
    with pytest.raises(AquaError) as excinfo:
        _select(tmp_path, answer)
    assert excinfo.value.code == "selector_invalid_output"
    assert _plans(tmp_path) == []


def test_S04_unrelated_reference_is_removed_and_recorded_when_a_real_trace_remains(tmp_path):
    answer = drought_answer()
    answer["variable_set"][0]["catalogue_refs"] = ["test_ref_heat", "drought"]
    plan = _select(tmp_path, answer)
    assert plan.variable_set[0].catalogue_refs == ["drought"]
    assert any("test_ref_heat" in n for n in plan.validation_notes)


def test_S04_role_must_be_the_one_the_cited_note_documents(tmp_path):
    answer = drought_answer()
    answer["variable_set"] = [{"variable_id": "ndvi", "role": "core_indicator",   # note 'drought' says response
                               "reason": "Vegetation greenness.", "catalogue_refs": ["drought"]}]
    with pytest.raises(AquaError) as excinfo:
        _select(tmp_path, answer)
    assert excinfo.value.code == "selector_invalid_output" and "response" in excinfo.value.message
    assert _plans(tmp_path) == []


def test_S04_role_from_either_cited_note_is_accepted(tmp_path):
    answer = drought_answer()   # precip: core_indicator in 'drought', related_condition in 'flood'
    answer["variable_set"][0].update(role="related_condition", catalogue_refs=["drought", "flood"])
    assert _select(tmp_path, answer).variable_set[0].role == "related_condition"


def test_S04_traceable_refs_are_exactly_the_documented_ones():
    snapshot = CatalogueSnapshot.from_store(FakeStore())
    assert snapshot.traceable_refs("precip") == {
        "concept:precip", "test_ref_precip", "drought", "test_ref_drought", "flood"}
    assert snapshot.traceable_refs("swe") == {"concept:swe"}


# ---------------------------------------------------------------- S05 ignored words

def test_S05_ignored_constraints_not_present_in_the_text_are_removed(tmp_path):
    answer = drought_answer()
    answer["ignored_text_constraints"] = ["europe", "2022", "Sahel", "1998-2010"]
    plan = _select(tmp_path, answer, query="Drought in Europe since ２０２２")
    assert plan.ignored_text_constraints == ["europe", "2022"]
    assert any("Sahel" in n for n in plan.validation_notes)


def test_validate_without_query_keeps_the_list():
    answer = drought_answer()
    answer["ignored_text_constraints"] = ["Sahel"]
    snapshot = CatalogueSnapshot.from_store(FakeStore())
    assert validate_selection(answer, snapshot).ignored_text_constraints == ("Sahel",)


# ---------------------------------------------------------------- S07 provider

def test_S07_any_other_sdk_error_is_unavailable_not_a_crash():
    anthropic = pytest.importorskip("anthropic")
    import httpx

    class _Messages:
        def create(self, **_):
            raise anthropic.APIError("boom", httpx.Request("POST", "https://api.anthropic.com/v1/messages"), body=None)

    class _Client:
        messages = _Messages()

        class beta:
            messages = _Messages()

    provider = AnthropicProvider(api_key="test-key", client=_Client())
    with pytest.raises(ProviderUnavailable):
        provider.complete("system", "user", {"type": "object"})
