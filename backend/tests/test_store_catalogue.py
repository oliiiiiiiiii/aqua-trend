"""Integrity of the shipped offline catalogue (backend/catalogue) and of its validation rules.

Acceptance: contract & policy layer, D03 (primary product), D05 (same category is not the
same quantity), T07 catalogue part (a short reference is never called a standard normal),
T13 catalogue part (no percentage for °C / anomalies), E10 catalogue part (flood has no
derived recipe). Negative cases mutate the TEST release of tests/fixtures/store.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).parent / "fixtures" / "store"))
import store_support as fx  # noqa: E402

from aqua_trend.store import PreparedDataStore, load_catalogue, validate_catalogue  # noqa: E402
from aqua_trend.store.catalogue import is_standard_normal_period  # noqa: E402
from aqua_trend.timeaxis import ym_to_index  # noqa: E402

CATALOGUE = fx.BACKEND / "catalogue"
DATA = fx.BACKEND.parent / "web" / "public" / "data"

#: docs/implementation-architecture.md §3 — fixed concept ids and approved product order
ARCHITECTURE_TABLE = {
    "precip": ["p_imerg", "p_gpcp", "p_m2"], "et": ["et_m2", "et_m2land", "et_gldas"], "pet": ["pet_gldas"],
    "soil_moisture_root": ["sm_root"], "soil_moisture_column": ["sm_total"], "soil_moisture_top": ["g1_soil_top"],
    "soil_wetness_root": ["sm_m2"], "tws_anomaly": ["tws"], "runoff": ["runoff", "ro_m2"], "swe": ["swe"],
    "tair": ["tair"], "tsurf": ["tsurf_m2"], "lst_day": ["lst_day"], "vpd": ["vpd"],
    "net_radiation": ["rn", "rn_m2"], "sw_down": ["swdown"], "wind": ["wind"], "ndvi": ["ndvi"], "sst": ["sst"],
}


@pytest.fixture(scope="module")
def cat():
    layers = json.loads((DATA / "catalog" / "variables.json").read_text("utf-8"))["layers"]
    catalogue = load_catalogue(CATALOGUE)
    validate_catalogue(catalogue, layers)
    return catalogue, layers


def test_every_catalogue_asset_is_valid(cat):
    catalogue, _ = cat
    for name in ("concepts", "products", "refs", "baselines", "phenomena", "manifest", "manual_presets",
                 "method_policy", "preset_policy", "quality_policy"):
        report = catalogue.reports[name]
        assert report.status == "ready", (name, report.missing_fields, report.problems)
        assert report.notes == [], (name, report.notes)
        assert report.version


def test_concepts_match_the_fixed_table(cat):
    concepts = cat[0].items["concepts"]
    assert {vid: c["approved_product_ids"] for vid, c in concepts.items()} == ARCHITECTURE_TABLE
    for vid, concept in concepts.items():
        assert concept["label"].isascii() or "–" in concept["label"], vid
        assert concept["label_zh"] and len(concept["description"]) > 60
        assert concept["data_kind"] == "continuous"


def test_one_product_per_prepared_layer(cat):
    catalogue, layers = cat
    products = catalogue.items["products"]
    assert set(products) == set(layers) and len(products) == 26
    for pid, product in products.items():
        layer = layers[pid]
        assert (product["unit"], product["start"], product["end"]) == (layer["unit"], layer["start"], layer["end"])
        assert (product["nasa"], product["family"]) == (layer["nasa"], layer["family"])
        assert (product["cadence"], product["calendar"]) == ("monthly", "gregorian")
        assert product["quality_limits"] and product["source_refs"]
        assert product["variable_id"] in catalogue.items["concepts"]
        assert (product["caveat"] is None) == (layer["caveat"] is None), pid     # existing caveats are kept
        assert product["caveat_zh"] == layer["caveat"]


def test_existing_caveats_are_preserved(cat):
    products = cat[0].items["products"]
    assert "drift" in products["et_gldas"]["caveat"] and "drift" in products["pet_gldas"]["caveat"]
    assert "orbit drift after 2020" in products["lst_day"]["caveat"]
    assert "300 km" in products["tws"]["caveat"]
    for pid in ("p_gpcp", "sst"):
        assert products[pid]["nasa"] is False and "NOAA" in products[pid]["caveat"] and "NOAA" in products[pid]["agency"]


def test_fallbacks_share_one_physical_definition(cat):
    """Spec §6.1 / D05: unit, temporal support and definition class are identical within a concept."""
    catalogue, _ = cat
    products = catalogue.items["products"]
    classes: dict[str, str] = {}
    for vid, concept in catalogue.items["concepts"].items():
        definition_class = concept["quantity_definition"]["definition_class"]
        assert definition_class not in classes, f"{vid} and {classes.get(definition_class)} share a definition class"
        classes[definition_class] = vid
        for pid in concept["approved_product_ids"]:
            p = products[pid]
            assert p["variable_id"] == vid
            assert (p["unit"], p["temporal_support"], p["definition_class"]) == (
                concept["unit"], concept["temporal_support"], definition_class)


@pytest.mark.parametrize("group", [
    ("tair", "tsurf", "lst_day"),                                             # air vs skin temperature
    ("soil_moisture_root", "soil_moisture_column", "soil_moisture_top", "soil_wetness_root"),   # depths / quantities
    ("vpd", "pet"), ("net_radiation", "sw_down"),
])
def test_same_category_quantities_are_not_fallbacks(cat, group):
    """D05: the spec's own examples stay separate concepts with disjoint products."""
    concepts = cat[0].items["concepts"]
    seen: set[str] = set()
    for vid in group:
        approved = set(concepts[vid]["approved_product_ids"])
        assert not approved & seen
        seen |= approved
    assert len({concepts[v]["quantity_definition"]["definition_class"] for v in group}) == len(group)


def test_land_only_precipitation_is_registered_but_not_approved(cat):
    catalogue, _ = cat
    assert catalogue.items["products"]["p_m2land"]["variable_id"] == "precip"
    assert "p_m2land" not in catalogue.items["concepts"]["precip"]["approved_product_ids"]
    assert catalogue.items["products"]["p_m2land"]["definition_class"] != \
        catalogue.items["concepts"]["precip"]["quantity_definition"]["definition_class"]


def test_every_approved_product_has_a_fixed_baseline_inside_its_record(cat):
    catalogue, _ = cat
    products, baselines = catalogue.items["products"], catalogue.items["baselines"]
    fraction = catalogue.policies["quality_policy"]["baseline"]["min_samples_per_calendar_month_fraction"]
    used = set()
    for vid, concept in catalogue.items["concepts"].items():
        assert set(concept["baseline_ref"]) == set(concept["approved_product_ids"])
        for pid, bid in concept["baseline_ref"].items():
            base = baselines[bid]
            used.add(bid)
            assert base["product_id"] == pid and base["kind"] == "seasonal_reference" and vid in base["applies_to"]
            assert products[pid]["start"] <= base["start"] and base["end"] <= products[pid]["end"]
            years = (ym_to_index(base["end"]) - ym_to_index(base["start"]) + 1) / 12
            assert years == int(years) and base["start"].endswith("-01") and base["end"].endswith("-12")
            assert base["minimum_samples"] == math.ceil(fraction * years - 1e-9)
            assert len(base["rule"]) > 80
    assert used == set(baselines)                                             # no orphan baseline


def test_standard_normal_label_is_reserved_for_1991_2020(cat):
    """Spec §7.1 / T07: shorter fixed periods are 'registered_reference_mean'."""
    baselines = cat[0].items["baselines"]
    normal = {b["product_id"] for b in baselines.values() if b["designation"] == "wmo_standard_normal"}
    assert normal == {"p_gpcp", "p_m2", "et_m2", "sst"}
    for base in baselines.values():
        is_normal = (base["start"], base["end"]) == ("1991-01", "2020-12")
        assert (base["designation"] == "wmo_standard_normal") == is_normal
        if not is_normal:
            assert base["designation"] == "registered_reference_mean" and "NOT a climatological standard normal" in base["rule"]
    tws = baselines["clim.tws.2003-2022"]
    assert (tws["start"], tws["end"], tws["minimum_samples"]) == ("2003-01", "2022-12", 16)
    assert is_standard_normal_period("1991-01", "2020-12") and is_standard_normal_period("1981-01", "2010-12")
    assert not is_standard_normal_period("2001-01", "2020-12") and not is_standard_normal_period("1990-01", "2019-12")


def test_every_reference_resolves_and_was_verified(cat):
    catalogue, _ = cat
    refs = catalogue.items["refs"]
    cited: set[str] = set()
    for concept in catalogue.items["concepts"].values():
        cited |= set(concept["scientific_refs"])
    for product in catalogue.items["products"].values():
        cited |= set(product["source_refs"])
    for base in catalogue.items["baselines"].values():
        cited |= set(base["refs"])
    for phen in catalogue.items["phenomena"].values():
        for link in phen["variable_links"]:
            cited |= set(link["ref_ids"])
    assert cited <= set(refs)
    # the only entry not cited by a concept/product/baseline/phenomenon documents the region boundaries
    assert set(refs) - cited == {"hydrobasins_lehner2013"}, "unused reference entries"
    for ref_id, ref in refs.items():
        assert ref["verified"] is True and ref["verified_on"] and ref["verification"], ref_id
        assert ref.get("doi") or ref["url"].startswith("https://"), ref_id
        assert ref["title"] and ref["applies_to"]
    for needed in ("imerg_v07_monthly", "gpcp_v23_adler2018", "merra2_gelaro2017", "gldas_noah025_m_21",
                   "grace_mascon_watkins2015", "modis_mod13c2", "modis_mod11c3", "oisst_huang2021", "wmo_normals",
                   "wmo_1090_spi", "mckee1993"):
        assert needed in refs


def test_relative_change_only_for_registered_denominators(cat):
    """Spec §7.2 / T13: never for °C or anomalies; only strictly positive stocks/fluxes."""
    concepts = cat[0].items["concepts"]
    for vid, concept in concepts.items():
        relative = concept["relative_change"]
        if concept["unit"] == "°C" or "anomaly" in vid or concept["quantity_definition"]["nature"] == "index":
            assert relative is None, vid
        if relative is None:
            assert concept["relative_change_note"], vid
        else:
            assert relative["denominator"] and relative["condition"] == "denominator_strictly_positive"
    assert {v for v, c in concepts.items() if c["relative_change"]} == {
        "precip", "soil_moisture_root", "soil_moisture_column", "soil_moisture_top", "sw_down", "wind"}


def test_display_semantics_are_complete(cat):
    for vid, concept in cat[0].items["concepts"].items():
        display = concept["display_semantics"]
        assert display["color"].startswith("#") and len(display["color"]) == 7
        assert isinstance(display["decimals"], int) and display["increase_reads"]
        assert "orb_channel" in display


def test_phenomena_notes_are_grounded_and_honest(cat):
    catalogue, _ = cat
    phenomena, concepts = catalogue.items["phenomena"], catalogue.items["concepts"]
    assert len(phenomena) >= 15
    linked: set[str] = set()
    for pid, phen in phenomena.items():
        assert phen["aliases"]["zh"] and phen["aliases"]["en"] and phen["unanswerable_notes"]
        for link in phen["variable_links"]:
            assert link["variable_id"] in concepts and link["ref_ids"] and link["statement"] and link["limits"]
            assert link["role"] in ("core_indicator", "related_condition", "response")
            linked.add(link["variable_id"])
    assert linked == set(concepts)                                            # every concept is reachable from a note
    assert phenomena["drought"]["indicator_ids"] == ["spi3", "spi6", "spi12"]
    assert [l["role"] for l in phenomena["drought"]["variable_links"] if l["variable_id"] == "precip"] == ["core_indicator"]
    # flood: no derived recipe, monthly precipitation is context only (spec §7.4, E10)
    flood = phenomena["flood"]
    assert flood["indicator_ids"] == [] and any("event catalogue" in n for n in flood["unanswerable_notes"])
    assert all(l["role"] == "related_condition" for l in flood["variable_links"])
    # phenomena without any prepared variable are recorded as unanswerable, not padded with unrelated variables
    for pid in ("air_quality_dust", "sea_level_rise", "sea_ice_decline"):
        assert phenomena[pid]["variable_links"] == [] and phenomena[pid]["indicator_ids"] == []
    only_spi = {i for p in phenomena.values() for i in p["indicator_ids"]}
    assert only_spi == {"spi3", "spi6", "spi12"}
    if catalogue.indicators is not None:
        assert only_spi <= set(catalogue.indicators)


def test_manual_presets_skeleton(cat):
    doc = cat[0].manual_presets
    assert doc["version"] and doc["adjustments"] == []


def test_manifest_declares_pending_events(cat):
    manifest = cat[0].manifest
    assert manifest["asset_status"]["events"]["status"] == "pending"
    assert manifest["dataset"]["series_format"] == "series-2" and manifest["dataset"]["calendar"] == "gregorian"


# --------------------------------------------------------------------------- validation rules (TEST release)

def _problems(tmp_path, asset, mutate):
    cat_dir, data_dir, cache = fx.build_release(tmp_path)
    file_name = f"{asset}.json"
    doc = fx.read(cat_dir / file_name)
    mutate(doc)
    fx.write(cat_dir / file_name, doc)
    store = PreparedDataStore.open(cat_dir, data_dir, cache, strict=False)
    return store.manifest["asset_status"]


def test_rule_fallback_with_other_definition_is_rejected(tmp_path):
    """D05 at the catalogue gate: same unit, other physical definition -> not an approved fallback."""
    def mutate(doc):
        doc["products"][1]["definition_class"] = "t_precip_land_only"
    status = _problems(tmp_path, "products", mutate)["catalogue.concepts"]
    assert status["status"] == "invalid" and "it cannot be a fallback" in status["problems"][0]
    assert "t_precip_b" in status["problems"][0]


def test_rule_fallback_from_another_concept_or_unit_is_rejected(tmp_path):
    def mutate(doc):
        doc["concepts"][0]["approved_product_ids"].append("t_soil")
        doc["concepts"][0]["baseline_ref"]["t_soil"] = "clim.t_soil"
    status = _problems(tmp_path, "concepts", mutate)["catalogue.concepts"]
    joined = " | ".join(status["problems"])
    assert "has variable_id 't_soil'" in joined and "has unit 'mm'" in joined


def test_rule_unknown_ids_are_located(tmp_path):
    def mutate(doc):
        doc["concepts"][0]["approved_product_ids"] = ["t_precip_a", "t_missing"]
        doc["concepts"][0]["scientific_refs"] = ["no_such_ref"]
        doc["concepts"][1]["baseline_ref"] = {"t_soil": "clim.none"}
        del doc["concepts"][1]["label_zh"]
    status = _problems(tmp_path, "concepts", mutate)["catalogue.concepts"]
    joined = " | ".join(status["problems"])
    assert "approved product 't_missing' is not registered" in joined
    assert "unknown ref id 'no_such_ref'" in joined and "baseline 'clim.none'" in joined
    assert "concepts[t_soil].label_zh" in status["missing_fields"]


def test_rule_short_period_cannot_be_called_standard_normal(tmp_path):
    def mutate(doc):
        doc["baselines"][0]["designation"] = "wmo_standard_normal"
    status = _problems(tmp_path, "baselines", mutate)["catalogue.baselines"]
    assert status["status"] == "invalid" and "wmo_standard_normal" in status["problems"][0]


def test_rule_baseline_cannot_weaken_the_quality_policy_or_leave_the_record(tmp_path):
    def mutate(doc):
        doc["baselines"][0]["minimum_samples"] = 1          # policy: 80% of 3 years -> 3
        doc["baselines"][1]["start"] = "2000-01"            # t_precip_b starts 2001-01
        doc["baselines"][2]["end"] = "2003-06"              # not complete calendar years
    status = _problems(tmp_path, "baselines", mutate)["catalogue.baselines"]
    joined = " | ".join(status["problems"])
    assert "below the quality policy" in joined and "outside the product record" in joined
    assert "complete calendar years" in joined


def test_rule_no_relative_change_for_celsius(tmp_path):
    def mutate(doc):
        doc["concepts"][3]["relative_change"] = {"denominator": "fixed_baseline_mean", "condition": "x"}
        doc["concepts"][0]["relative_change"] = {"denominator": "fixed_baseline_mean"}
    status = _problems(tmp_path, "concepts", mutate)["catalogue.concepts"]
    joined = " | ".join(status["problems"])
    assert "not allowed for °C" in joined and "must be null or carry denominator and condition" in joined


def test_rule_phenomenon_links_must_resolve(tmp_path):
    def mutate(doc):
        doc["phenomena"][0]["variable_links"][0]["variable_id"] = "t_unknown"
        doc["phenomena"][0]["variable_links"].append(
            {"variable_id": "t_soil", "role": "cause", "statement": "TEST", "limits": "TEST", "ref_ids": ["t_ref"]})
    status = _problems(tmp_path, "phenomena", mutate)["catalogue.phenomena"]
    joined = " | ".join(status["problems"])
    assert "'t_unknown' is not a registered concept" in joined and "role must be one of" in joined


def test_rule_manual_preset_adjustments_need_action_and_reason(tmp_path):
    def mutate(doc):
        doc["adjustments"] = [{"adjustment_id": "a1", "action": "pin", "reason": "TEST"},
                              {"adjustment_id": "a2", "action": "make_significant"},
                              {"adjustment_id": "a1", "action": "disable", "reason": "TEST"}]
    status = _problems(tmp_path, "manual_presets", mutate)["catalogue.manual_presets"]
    joined = " | ".join(status["problems"])
    assert "adjustments[1].reason" in status["missing_fields"]
    assert "'make_significant' is not one of add, pin, priority, disable" in joined and "duplicate adjustment_id" in joined
