"""Selector against the REAL catalogue (skipped until the store / catalogue is delivered). S01-S03, S05."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))          # backend/ (aqua_trend package)
sys.path.insert(0, str(Path(__file__).parent / "fixtures" / "selection"))
import selection_support  # noqa: E402,F401  (path check only)

from aqua_trend.selection import CatalogueLexicalProvider, CatalogueSnapshot, PhenomenonSelector  # noqa: E402
from aqua_trend.selection.prompt import build_output_schema, build_system_prompt  # noqa: E402
from aqua_trend.selection.validate import validate_selection  # noqa: E402


@pytest.fixture(scope="module")
def real_store():
    try:
        from aqua_trend.store import PreparedDataStore
        store = PreparedDataStore.open()
        CatalogueSnapshot.from_store(store)
    except Exception as exc:  # store or catalogue not delivered yet
        pytest.skip(f"real PreparedDataStore / catalogue not available: {exc!r}")
    return store


def test_real_catalogue_is_internally_consistent_for_selection(real_store):
    snapshot = CatalogueSnapshot.from_store(real_store)
    assert snapshot.concepts and snapshot.catalogue_version and snapshot.indicator_registry_version
    context_ids = snapshot.valid_context_ids()
    for note in snapshot.phenomena:
        for link in note.get("variable_links") or []:
            assert link["variable_id"] in snapshot.concepts, (note["phenomenon_id"], link)
            assert link["role"] in ("core_indicator", "related_condition", "response")
            assert (link.get("statement") or "").strip()
            assert set(link.get("ref_ids") or []) <= context_ids, (note["phenomenon_id"], link)
        assert set(note.get("indicator_ids") or []) <= set(snapshot.recipes), note["phenomenon_id"]
    system = build_system_prompt(snapshot)
    assert all(f'"{v}"' in system for v in snapshot.concepts)
    assert build_output_schema(snapshot)["additionalProperties"] is False


def test_real_catalogue_every_curated_note_yields_a_valid_plan_via_lexical_matcher(real_store, tmp_path):
    snapshot = CatalogueSnapshot.from_store(real_store)
    if not snapshot.phenomena:
        pytest.skip("no curated phenomenon notes delivered")
    selector = PhenomenonSelector(real_store, provider=CatalogueLexicalProvider(real_store), plan_dir=tmp_path)
    for note in snapshot.phenomena:
        for text in filter(None, (note.get("label"), note.get("label_zh"))):
            plan = selector.select(f"{text} 2022")
            assert plan.selector.is_language_model is False
            assert {v.variable_id for v in plan.variable_set} <= set(snapshot.concepts)
            assert set(plan.indicator_recipe_ids) <= set(snapshot.recipes)
            assert "2022" in plan.ignored_text_constraints
            assert selector.load(plan.selection_plan_id).content_hash == plan.content_hash


def test_real_catalogue_unknown_text_is_unsupported(real_store, tmp_path):
    selector = PhenomenonSelector(real_store, provider=CatalogueLexicalProvider(real_store), plan_dir=tmp_path)
    plan = selector.select("zzqx stock market crash")
    assert plan.status == "unsupported_phenomenon" and plan.variable_set == []
    with pytest.raises(Exception):
        validate_selection({"phenomenon_label": "x", "status": "ok", "variable_set": [
            {"variable_id": "not_a_concept", "role": "core_indicator", "reason": "r", "catalogue_refs": []}],
            "indicator_recipe_ids": [], "unanswerable": [], "ignored_text_constraints": []},
            CatalogueSnapshot.from_store(real_store))
