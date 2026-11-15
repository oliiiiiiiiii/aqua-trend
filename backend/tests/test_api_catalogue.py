"""Catalogue, region and health endpoints on the prepared release (spec §10; data contract §9 ``GET /api/catalogue``).

Uses the real catalogue and prepared series; the selector is the explicitly injected
catalogue matcher.  Assertions are structural.
"""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures" / "engine"))

import engine_support as es  # noqa: E402

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.api import API_VERSION, REGION_LIST_FIELDS, cors_origins_from_env, create_app  # noqa: E402
from aqua_trend.engine import ENGINE_VERSION  # noqa: E402
from aqua_trend.selection import CatalogueLexicalProvider, PhenomenonSelector  # noqa: E402
from aqua_trend.storage import ResearchStorage  # noqa: E402
from aqua_trend.store import PreparedDataStore  # noqa: E402

pytestmark = pytest.mark.realdata
TAIWAN = es.TAIWAN


@pytest.fixture(scope="module")
def store():
    if not (es.DATA / "series" / f"{TAIWAN}.json").exists():
        pytest.skip("prepared series not present")
    return PreparedDataStore.open()


@pytest.fixture(scope="module")
def client(store, tmp_path_factory):
    var = tmp_path_factory.mktemp("var")
    selector = PhenomenonSelector(store, provider=CatalogueLexicalProvider(store), plan_dir=var / "plans")
    with TestClient(create_app(store=store, selector=selector, storage=ResearchStorage(var))) as c:
        yield c


@pytest.fixture(scope="module")
def catalogue(client):
    response = client.get("/api/catalogue")
    assert response.status_code == 200
    return response.json()


def test_health(client, store):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["api_version"] == API_VERSION and body["engine_version"] == ENGINE_VERSION
    assert body["snapshot_id"] == store.snapshot_id() and body["versions"] == store.versions
    assert body["jobs"]["workers"] >= 1 and body["jobs"]["active"] == 0
    assert body["selector"]["provider"] == "catalogue_lexical" and body["selector"]["is_language_model"] is False


def test_catalogue_versions_and_snapshot(catalogue, store):
    assert catalogue["versions"] == {**store.versions, "engine_version": ENGINE_VERSION,
                                     "prompt_version": catalogue["versions"]["prompt_version"]}
    assert catalogue["snapshot_id"] == store.snapshot_id() and catalogue["policy_snapshot_id"].startswith("pol-")
    assert catalogue["job_stages"] == list(C.STAGES)


def test_catalogue_concepts_carry_definition_products_baseline_and_refs(catalogue, store):
    concepts = {c["variable_id"]: c for c in catalogue["concepts"]}
    assert set(concepts) == set(store.concepts())
    for variable_id, concept in concepts.items():
        source = store.concept(variable_id)
        for key in ("label", "label_zh", "description", "unit", "data_kind"):
            assert concept[key] == source[key] and concept[key]
        assert concept["quantity_definition"] == source["quantity_definition"]
        approved = [p["product_id"] for p in concept["products"] if p["approved"]]
        assert approved == source["approved_product_ids"]           # approved priority order, primary first
        assert [p["is_primary"] for p in concept["products"] if p["approved"]] == [True] + [False] * (len(approved) - 1)
        for product in concept["products"]:
            assert product["agency"] and product["start"] and product["end"]
            assert product["baseline_id"] == (source.get("baseline_ref") or {}).get(product["product_id"])
            if not product["approved"]:
                assert product["baseline_id"] is None               # registered, not a fallback
        assert concept["refs"] and all(r["title"] for r in concept["refs"])
    precip = concepts["precip"]
    assert [p["product_id"] for p in precip["products"]][:3] == ["p_imerg", "p_gpcp", "p_m2"]
    assert any(not p["approved"] and p["product_id"] == "p_m2land" for p in precip["products"])
    assert any(p["caveat"] for p in precip["products"])
    assert [p["product_id"] for p in concepts["et"]["products"] if p["approved"]] == ["et_m2"]


def test_phenomena_are_hints_not_a_whitelist(catalogue, store):
    phenomena = catalogue["phenomena"]
    assert "not a whitelist" in catalogue["phenomena_note"]
    assert [p["phenomenon_id"] for p in phenomena] == [p["phenomenon_id"] for p in store.phenomena()]
    drought = next(p for p in phenomena if p["phenomenon_id"] == "drought")
    assert drought["label_zh"] == "乾旱" and "drought" in drought["aliases"]["en"]
    assert all(link["variable_id"] in store.concepts() for link in drought["variable_links"])


def test_indicator_recipes_baselines_events_and_asset_status(catalogue, store):
    recipes = {r["indicator_id"]: r for r in catalogue["indicators"]}
    assert set(recipes) == set(store.indicator_recipes())
    for recipe in recipes.values():
        assert recipe["kind"] == "derived_indicator" and recipe["version"] and recipe["standard_refs"]
        assert recipe["requirements"] is not None
    assert {b["baseline_id"] for b in catalogue["baselines"]} == set(store.baselines())
    assert all(b["start"] and b["end"] and b["rule"] for b in catalogue["baselines"])
    assert catalogue["event_catalogues"] == json.loads(json.dumps(store.event_catalogues()))
    flood = next(e for e in catalogue["event_catalogues"] if e["phenomenon_id"] == "flood")
    assert flood["status"] == store.event_catalogues()[0]["status"]  # pending stays visible as pending
    assert catalogue["asset_status"] == json.loads(json.dumps(store.manifest["asset_status"]))
    assert all(a["status"] in ("ready", "pending", "invalid") for a in catalogue["asset_status"].values())


def test_policies_are_published_read_only(catalogue, store):
    assert set(catalogue["policies"]) == {"method_policy", "preset_policy", "quality_policy"}
    for name, policy in catalogue["policies"].items():
        assert policy == json.loads(json.dumps(store.policy(name)))
    assert catalogue["policies"]["method_policy"]["multiple_comparison"] == "benjamini_yekutieli"


def test_selector_status_is_explicit(catalogue):
    selector = catalogue["selector"]
    assert selector["provider"] == "catalogue_lexical" and selector["is_language_model"] is False
    assert selector["available"] is True and selector["prompt_version"]


def test_region_list_is_complete_compact_and_gzipped(client, store, catalogue):
    response = client.get("/api/catalogue/regions")
    assert response.status_code == 200 and response.headers["content-encoding"] == "gzip"
    body = response.json()
    assert body["count"] == len(store.regions()) == len(body["regions"]) == catalogue["regions"]["total"]
    assert body["region_catalogue_version"] == store.versions["region_catalogue_version"]
    assert body["dataset_version"] == store.versions["dataset_version"]
    assert all(tuple(r) == REGION_LIST_FIELDS for r in body["regions"])
    assert sum(1 for r in body["regions"] if r["series_available"]) == catalogue["regions"]["with_series"]
    taiwan = next(r for r in body["regions"] if r["id"] == TAIWAN)
    source = store.region(TAIWAN)
    assert taiwan == {k: source[k] for k in REGION_LIST_FIELDS}
    hexagon = next(r for r in body["regions"] if r["type"] == "hex")
    assert hexagon["series_available"] is False and hexagon["n_products"] == 0
    raw = client.get("/api/catalogue/regions", headers={"accept-encoding": "identity"})
    assert "content-encoding" not in raw.headers and raw.json() == body
    assert len(gzip.compress(raw.content)) < len(raw.content) / 3


def test_region_list_etag_is_keyed_on_the_versions(client, store, tmp_path):
    first = client.get("/api/catalogue/regions")
    etag = first.headers["etag"]
    assert etag.startswith('"regions-') and "no-cache" in first.headers["cache-control"]
    assert client.get("/api/catalogue/regions").headers["etag"] == etag
    for header in (etag, f"W/{etag}", f'"other", {etag}', "*"):
        cached = client.get("/api/catalogue/regions", headers={"if-none-match": header})
        assert cached.status_code == 304 and cached.content == b"" and cached.headers["etag"] == etag
    assert client.get("/api/catalogue/regions", headers={"if-none-match": '"regions-stale"'}).status_code == 200

    class OtherRelease:
        """TEST proxy: the same store reporting another dataset version."""

        def __init__(self, inner):
            self._inner = inner
            self.versions = {**inner.versions, "dataset_version": "TEST-other-dataset"}

        def __getattr__(self, name):
            return getattr(self._inner, name)

    other = OtherRelease(store)
    selector = PhenomenonSelector(other, provider=CatalogueLexicalProvider(other), plan_dir=tmp_path / "plans")
    with TestClient(create_app(store=other, selector=selector, storage=ResearchStorage(tmp_path))) as c:
        assert c.get("/api/catalogue/regions").headers["etag"] != etag
        assert c.get("/api/catalogue/regions", headers={"if-none-match": etag}).status_code == 200


def test_region_detail_lists_per_product_availability_and_period(client, store):
    body = client.get(f"/api/catalogue/regions/{TAIWAN}").json()
    assert body["id"] == TAIWAN and body["name_zh"] == "台灣本島" and body["series_available"] is True
    assert body["countries"] == store.region(TAIWAN)["countries"]
    products = {p["product_id"]: p for p in body["products"]}
    assert set(products) >= set(store.available_products(TAIWAN))
    for product_id in store.available_products(TAIWAN):
        entry, series = products[product_id], store.series(TAIWAN, product_id)
        assert entry["status"] == "ok" and entry["n_expected"] == series.t.size
        assert entry["record_period"]["start"] <= entry["valid_period"]["start"]
        assert entry["valid_period"]["end"] <= entry["record_period"]["end"]
        assert 0 < entry["n_valid"] <= entry["n_expected"]
    assert products["p_imerg"]["baseline"]["baseline_id"] == "clim.p_imerg.2001-2020"
    assert products["p_m2land"]["approved"] is False and products["p_m2land"]["baseline"] is None
    assert "precip" in body["analysable_variable_ids"] and body["note"] is None


def test_region_without_series_is_described_not_substituted(client, store):
    region_id = next(rid for rid, r in store.regions().items() if not r["series_available"])
    body = client.get(f"/api/catalogue/regions/{region_id}").json()
    assert body["id"] == region_id and body["series_available"] is False
    assert all(p["status"] != "ok" for p in body["products"]) and body["analysable_variable_ids"] == []
    assert "no prepared series" in body["note"] and "substituted" in body["note"]


def test_unknown_region_detail_is_404(client):
    response = client.get("/api/catalogue/regions/named-atlantis")
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    assert response.json()["fields"] == ["region_id"]


def test_cors_origins_from_env():
    assert cors_origins_from_env({}) == [f"http://{h}:{p}" for h in ("localhost", "127.0.0.1") for p in (3000, 3001, 5000)]
    assert cors_origins_from_env({"AQUA_CORS_ORIGINS": " https://a.example/ , http://b.example:8080 ,"}) == \
        ["https://a.example", "http://b.example:8080"]
    assert cors_origins_from_env({"AQUA_CORS_ORIGINS": "*"}) == ["*"]


def test_build_engine_wires_a_preset_engine_in_one_place(store, tmp_path, monkeypatch):
    import types

    from aqua_trend import api

    storage = ResearchStorage(tmp_path)
    selector = PhenomenonSelector(store, provider=CatalogueLexicalProvider(store), plan_dir=tmp_path / "plans")

    class Bound:
        """TEST preset engine handed in explicitly."""

        def bind(self, engine):
            self.engine = engine

    given = Bound()
    engine = api.build_engine(store, selector, storage, given)
    assert engine.preset_engine is given and given.engine is engine and engine.storage is storage

    class FakePresetEngine:
        """TEST stand-in for aqua_trend.presets.PresetEngine: declares only what it needs."""

        def __init__(self, store, engine):
            self.store, self.engine = store, engine

    monkeypatch.setitem(sys.modules, "aqua_trend.presets", types.SimpleNamespace(PresetEngine=FakePresetEngine))
    engine = api.build_engine(store, selector, storage)
    assert isinstance(engine.preset_engine, FakePresetEngine)
    assert engine.preset_engine.engine is engine and engine.preset_engine.store is store
