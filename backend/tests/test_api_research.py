"""HTTP API on the prepared NASA / NOAA series (spec §10; data contract §9; acceptance section 8, S07, P08, P09).

The selector is injected explicitly: ``CatalogueLexicalProvider`` (the deterministic catalogue
matcher, labelled ``is_language_model: false``) or a scripted TEST provider.  No model is
called.  Assertions are structural (ids, statuses, equality of payloads) — never a scientific
conclusion.
"""
from __future__ import annotations

import csv
import io
import json
import sys
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures" / "engine"))

import engine_support as es  # noqa: E402

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.api import DEFAULT_CORS_ORIGINS, create_app  # noqa: E402
from aqua_trend.errors import AquaError  # noqa: E402
from aqua_trend.present import CSV_COLUMNS, ResultPresenter  # noqa: E402
from aqua_trend.selection import (  # noqa: E402
    CatalogueLexicalProvider, PhenomenonSelector, ProviderUnavailable,
)
from aqua_trend.storage import ResearchStorage  # noqa: E402
from aqua_trend.store import PreparedDataStore  # noqa: E402

pytestmark = pytest.mark.realdata
TAIWAN = es.TAIWAN
PERIOD = {"start": "2001-01", "end": "2020-12"}
DROUGHT = {"phenomenon_query": "drought", "region_id": TAIWAN, "period": PERIOD}
ERROR_KEYS = {"code", "message", "retryable", "fields"}
FINAL = ("complete", "partial", "failed", "cancelled")


# --------------------------------------------------------------------------- helpers

def strict_json(text: str):
    """Parse JSON and fail on NaN / Infinity tokens (they are not JSON)."""
    def refuse(token):
        raise AssertionError(f"non-finite token {token} in a response")
    return json.loads(text, parse_constant=refuse)


def poll(client: TestClient, research_id: str, timeout: float = 60.0) -> dict:
    deadline = time.monotonic() + timeout
    while True:
        response = client.get(f"/api/research/{research_id}")
        assert response.status_code == 200
        job = strict_json(response.text)
        if job["status"] in FINAL:
            return job
        assert time.monotonic() < deadline, f"job did not finish: {job['status']} / {job['stage']}"
        time.sleep(0.02)


def run(client: TestClient, body: dict) -> dict:
    response = client.post("/api/research", json=body)
    assert response.status_code == 202, response.text
    return poll(client, response.json()["research_id"])


def assert_error(response, status: int, code: str) -> dict:
    assert response.status_code == status, response.text
    body = strict_json(response.text)
    assert set(body) == ERROR_KEYS and body["code"] == code
    assert isinstance(body["message"], str) and body["message"]
    assert "Traceback" not in response.text
    return body


class CountingProvider:
    """TEST wrapper that counts how often the selector really asks its provider."""

    def __init__(self, inner):
        self._inner, self.calls = inner, 0
        self.name, self.model, self.is_language_model = inner.name, inner.model, inner.is_language_model

    def complete(self, system, user, schema):
        self.calls += 1
        return self._inner.complete(system, user, schema)


class ScriptedModel:
    """TEST stand-in for a language model: fixed answer, or 'unreachable'."""

    name, model, is_language_model = "test_scripted_model", "test-model-1", True

    def __init__(self, answer=None):
        self.answer = answer

    def complete(self, system, user, schema):
        if self.answer is None:
            raise ProviderUnavailable("TEST: the model cannot be reached.")
        return json.loads(json.dumps(self.answer))


def make_app(store, var_dir: Path, provider="lexical", **kw):
    """App on a temporary var directory; ``provider=None`` leaves the selector to the environment."""
    if provider == "lexical":
        provider = CatalogueLexicalProvider(store)
    selector = PhenomenonSelector(store, provider=provider, plan_dir=var_dir / "plans")
    return create_app(store=store, selector=selector, storage=ResearchStorage(var_dir), **kw)


# --------------------------------------------------------------------------- fixtures

@pytest.fixture(scope="module")
def store():
    if not (es.DATA / "series" / f"{TAIWAN}.json").exists():
        pytest.skip("prepared series not present")
    return PreparedDataStore.open()


@pytest.fixture(scope="module")
def var_dir(tmp_path_factory) -> Path:
    return tmp_path_factory.mktemp("var")


@pytest.fixture(scope="module")
def provider(store):
    return CountingProvider(CatalogueLexicalProvider(store))


@pytest.fixture(scope="module")
def app(store, var_dir, provider):
    return make_app(store, var_dir, provider)


@pytest.fixture(scope="module")
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def drought(client):
    """The happy path: created (202 body), then polled to completion."""
    response = client.post("/api/research", json=DROUGHT)
    assert response.status_code == 202, response.text
    created = strict_json(response.text)
    return created, response.headers, poll(client, created["research_id"])


# --------------------------------------------------------------------------- happy path

def test_create_returns_202_with_job_id_status_stage_and_progress(drought):
    created, headers, _ = drought
    assert created["research_id"].startswith("rs_")
    assert created["status"] in ("queued", "running", "complete", "partial")
    assert created["stage"] in C.STAGES
    assert set(created["progress"]) == {"completed", "total"}
    assert created["request"]["phenomenon_query"] == "drought" and created["request"]["region_id"] == TAIWAN
    assert headers["location"] == f"/api/research/{created['research_id']}"


def test_job_finishes_with_stages_in_order_and_a_real_result(drought):
    created, _, job = drought
    assert job["status"] in ("complete", "partial") and job["stage"] == "complete" and job["error"] is None
    assert job["stage_history"] == list(C.STAGES)                  # every stage, in the contract order
    assert job["progress"] == {"completed": 1, "total": 1}
    result = job["result"]
    assert result["identity"]["research_id"] == created["research_id"]
    assert result["identity"]["status"] == job["status"]
    assert result["identity"]["snapshot_id"] == job["snapshot_id"]  # the job pinned its snapshot
    assert result["user_constraints"] == {"phenomenon_query": "drought", "region_id": TAIWAN, "period": PERIOD}
    assert result["resolved"]["region"]["source"] == "user" and result["resolved"]["period"]["source"] == "user"
    assert result["provisional"] is False
    assert result["selection"]["selector"] == {**result["selection"]["selector"], "provider": "catalogue_lexical",
                                               "is_language_model": False}
    assert any(w["code"] == "selector_not_language_model" for w in result["warnings"])
    assert result["variables"] and all(v["product"] for v in result["variables"])
    assert any(v["trend"] is not None for v in result["variables"])
    assert job["request"] == {"phenomenon_query": "drought", "region_id": TAIWAN, "period": PERIOD,
                              "context": {"parent_research_id": None, "preset_ref": None},
                              "options": {"reselect": False}}


def test_inference_not_applicable_is_never_reported_as_not_significant(drought):
    """Contract §9.2: CI, p and ``significant`` are null together; never a stand-in 'not significant'."""
    trends = [v["trend"] for v in drought[2]["result"]["variables"] if v["trend"]]
    trends += [m["trend"] for i in drought[2]["result"]["indicators"] for m in i["metrics"] if m["trend"]]
    assert trends
    for trend in trends:
        if trend["inference_status"] != "ok":
            assert trend["p_raw"] is None and trend["significant"] is None and trend["ci95_per_decade"] is None
            assert trend.get("significance_label") in (None, "undetermined")


def test_poll_without_result_is_light(client, drought):
    job = client.get(f"/api/research/{drought[0]['research_id']}", params={"include_result": "false"}).json()
    assert job["result"] is None and job["result_available"] is True and job["status"] == drought[2]["status"]


def test_export_json_is_the_result_snapshot(client, drought):
    research_id = drought[0]["research_id"]
    response = client.get(f"/api/research/{research_id}/export", params={"format": "json"})
    assert response.status_code == 200 and response.headers["content-type"].startswith("application/json")
    assert response.headers["content-disposition"] == f'attachment; filename="aqua-trend-{research_id}.json"'
    assert strict_json(response.text) == drought[2]["result"]
    assert strict_json(client.get(f"/api/research/{research_id}/export").text) == drought[2]["result"]  # default


def test_export_csv_carries_exactly_the_result_numbers(client, drought):
    research_id, result = drought[0]["research_id"], drought[2]["result"]
    response = client.get(f"/api/research/{research_id}/export", params={"format": "csv"})
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == f'attachment; filename="aqua-trend-{research_id}.csv"'
    assert response.text == ResultPresenter().export_csv(C.ResearchResult.model_validate(result))
    lines = response.text.splitlines()
    assert any(research_id in line for line in lines if line.startswith("# "))
    rows = list(csv.DictReader(io.StringIO("\n".join(line for line in lines if not line.startswith("# ")))))
    assert tuple(rows[0]) == CSV_COLUMNS
    variable = next(v for v in result["variables"] if v["series"])
    mine = [r for r in rows if r["item_kind"] == "variable" and r["item_id"] == variable["variable_id"]]
    assert [r["time"] for r in mine] == variable["series"]["times"]
    for row, raw in zip(mine, variable["series"]["raw"]):
        assert (row["raw"] == "") == (raw is None)                 # a gap stays a gap; never zero
        if raw is not None:
            assert float(row["raw"]) == raw
    assert {r["product_id"] for r in mine} == {variable["product"]["selected_product_id"]}


def test_family_endpoint_serves_the_full_stored_family_in_pages(client, drought):
    research_id, result = drought[0]["research_id"], drought[2]["result"]
    family = next(f for f in result["evidence_families"] if f["scope"] == "query")
    url = f"/api/research/{research_id}/families/{family['family_id']}"
    full = strict_json(client.get(url).text)
    assert full["family_id"] == family["family_id"] and full["content_hash"] == family["content_hash"]
    assert full["page"]["total"] == family["n_candidates"] == len(full["hypotheses"])
    assert full["page"]["next_offset"] is None and full["hypotheses_truncated"] is False
    first = strict_json(client.get(url, params={"limit": 2}).text)
    assert first["page"] == {"offset": 0, "limit": 2, "returned": 2, "total": family["n_candidates"],
                             "next_offset": 2}
    second = strict_json(client.get(url, params={"limit": 2, "offset": 2}).text)
    assert [h["hypothesis_id"] for h in first["hypotheses"] + second["hypotheses"]] == \
        [h["hypothesis_id"] for h in full["hypotheses"][:4]]
    used = {v["trend"]["hypothesis_id"] for v in result["variables"] if v["trend"]}
    assert used <= {h["hypothesis_id"] for h in full["hypotheses"]}   # every label can be verified
    assert_error(client.get(f"/api/research/{research_id}/families/fam_does_not_exist"), 404, "not_found")
    assert_error(client.get(url, params={"limit": 0}), 422, "invalid_request")


def test_region_without_data_is_a_result_state_not_an_http_error(client, store):
    region_id = next(rid for rid, r in store.regions().items() if not r["series_available"])
    job = run(client, {"phenomenon_query": "drought", "region_id": region_id, "period": PERIOD})
    assert job["status"] == "partial" and job["error"] is None
    result = job["result"]
    assert result["resolved"]["region"]["id"] == region_id          # never swapped for a parent / neighbour
    assert result["variables"] and {v["status"] for v in result["variables"]} == {"no_series"}
    assert all(v["trend"] is None and v["series"] is None for v in result["variables"])


def test_client_supplied_numbers_and_sources_are_not_part_of_the_request(client):
    body = {**DROUGHT, "period": {"start": "2003-01", "end": "2018-12"}, "p_adjusted": 0.001,
            "resolved": {"region": {"source": "preset"}}, "evidence_families": [{"family_id": "fam_fake"}]}
    job = run(client, body)
    assert set(job["request"]) == {"phenomenon_query", "region_id", "period", "context", "options"}
    assert job["result"]["resolved"]["region"]["source"] == "user"
    assert all(f["family_id"] != "fam_fake" for f in job["result"]["evidence_families"])


# --------------------------------------------------------------------------- validation errors

@pytest.mark.parametrize("period, fields", [
    ({"start": "2005-01"}, ["period.end"]),
    ({"start": "2005-01", "end": None}, ["period.end"]),
    ({"start": "", "end": "2024-12"}, ["period.start"]),
    ({"start": "2024-12", "end": "2005-01"}, ["period.start", "period.end"]),
    ({"start": "2005-13", "end": "2024-12"}, ["period.start"]),
    ({"start": 2005, "end": "2024-12"}, ["period.start"]),
    ("2005-01/2024-12", ["period"]),
])
def test_invalid_period(client, period, fields):
    body = assert_error(client.post("/api/research", json={**DROUGHT, "period": period}), 422, "invalid_period")
    assert body["fields"] == fields and body["retryable"] is False


def test_cleared_period_is_not_an_error(client):
    """Both ends empty = the selection was cleared; without a preset engine that is ``no_matching_preset``."""
    job = run(client, {**DROUGHT, "period": {"start": None, "end": None}})
    assert job["request"]["period"] is None and job["status"] in ("complete", "partial")
    resolved = job["result"]["resolved"]
    if resolved["period"] is None:
        assert resolved["preset_status"] == "no_matching_preset" and resolved["preset_missing"] == ["period"]
        assert resolved["region"]["id"] == TAIWAN                   # the user's field is kept
    else:
        assert resolved["period"]["source"] == "preset"


@pytest.mark.parametrize("region_id", ["named-atlantis", "", "   ", 42, "taiwan"])
def test_unknown_region(client, region_id):
    body = assert_error(client.post("/api/research", json={**DROUGHT, "region_id": region_id}), 422, "unknown_region")
    assert body["fields"] == ["region_id"]


@pytest.mark.parametrize("query", ["", "   ", None])
def test_empty_query(client, query):
    body = assert_error(client.post("/api/research", json={**DROUGHT, "phenomenon_query": query}), 422, "empty_query")
    assert body["fields"] == ["phenomenon_query"]
    assert_error(client.post("/api/research", json={"region_id": TAIWAN}), 422, "empty_query")


def test_malformed_requests(client):
    assert_error(client.post("/api/research", json=[1, 2]), 422, "invalid_request")
    assert_error(client.post("/api/research", content=b"{not json", headers={"content-type": "application/json"}),
                 422, "invalid_request")
    assert_error(client.post("/api/research", json={**DROUGHT, "phenomenon_query": 7}), 422, "invalid_request")
    assert_error(client.post("/api/research", json={**DROUGHT, "options": {"reselect": "yes"}}), 422, "invalid_request")
    assert_error(client.post("/api/research", json={**DROUGHT, "context": "x"}), 422, "invalid_context")
    assert_error(client.post("/api/research", json={**DROUGHT, "context": {"preset_ref": {"id": "p"}}}),
                 422, "invalid_context")


def test_unknown_ids_are_not_found(client):
    for method, url in [("get", "/api/research/rs_missing"), ("delete", "/api/research/rs_missing"),
                        ("get", "/api/research/rs_missing/export"), ("get", "/api/research/rs_missing/families/f"),
                        ("get", "/api/research/..%2Fsecret"), ("get", "/api/catalogue/regions/named-atlantis"),
                        ("get", "/api/nothing-here")]:
        assert_error(getattr(client, method)(url), 404, "not_found")


def test_export_format_must_be_json_or_csv(client, drought):
    body = assert_error(client.get(f"/api/research/{drought[0]['research_id']}/export", params={"format": "xlsx"}),
                        422, "invalid_request")
    assert body["fields"] == ["format"]


def test_unknown_context_references_are_invalid_context(client):
    body = assert_error(client.post("/api/research", json={**DROUGHT, "context": {"parent_research_id": "rs_nope"}}),
                        422, "invalid_context")
    assert body["fields"] == ["context.parent_research_id"]
    body = assert_error(client.post("/api/research", json={
        **DROUGHT, "context": {"preset_ref": {"id": "preset_nope", "version": "1"}}}), 422, "invalid_context")
    assert body["fields"] == ["context.preset_ref"]


# --------------------------------------------------------------------------- presets and parents (P08, P09)

@pytest.fixture(scope="module")
def stored_preset(app, drought, store) -> C.Preset:
    """A TEST preset record (hand-written, no score) that points at the saved drought plan."""
    plan = drought[2]["result"]["selection"]
    preset = C.Preset(
        preset_id="test_preset_taiwan", version="1", source="manual",
        selection_plan_id=plan["selection_plan_id"],
        variable_ids=[v["variable_id"] for v in plan["variable_set"]], indicator_ids=plan["indicator_recipe_ids"],
        region_id=TAIWAN, period=C.Period(start="2003-01", end="2022-12"),
        reasons=[C.PresetReason(text="TEST preset stored by the API test.")], manual_note="TEST",
        dataset_version=store.versions["dataset_version"],
        method_policy_version=store.versions["method_policy_version"],
        preset_policy_version=store.versions["preset_policy_version"])
    app.state.ctx.storage.save_preset(preset)
    return preset


def test_preset_ref_conflicting_with_a_user_field_is_invalid_context(client, store, stored_preset):
    ref = {"preset_ref": {"id": stored_preset.preset_id, "version": stored_preset.version}}
    other = next(rid for rid, r in store.regions().items() if r["series_available"] and rid != TAIWAN)
    body = assert_error(client.post("/api/research", json={
        "phenomenon_query": "drought", "region_id": other, "context": ref}), 422, "invalid_context")
    assert body["fields"] == ["context.preset_ref", "region_id"] and other in body["message"]
    body = assert_error(client.post("/api/research", json={
        "phenomenon_query": "drought", "period": PERIOD, "context": ref}), 422, "invalid_context")
    assert body["fields"] == ["context.preset_ref", "period"]


def test_P09_opening_a_preset_fills_blanks_and_keeps_sources(client, stored_preset, provider):
    calls = provider.calls
    job = run(client, {"phenomenon_query": "drought", "region_id": TAIWAN,
                       "context": {"preset_ref": {"id": stored_preset.preset_id, "version": "1"}}})
    assert job["error"] is None and job["status"] in ("complete", "partial")
    resolved = job["result"]["resolved"]
    assert resolved["preset_status"] == "opened" and resolved["preset"]["preset_id"] == stored_preset.preset_id
    assert resolved["region"]["id"] == TAIWAN and resolved["region"]["source"] == "user"
    assert (resolved["period"]["start"], resolved["period"]["end"], resolved["period"]["source"]) == \
        ("2003-01", "2022-12", "preset")
    assert job["result"]["user_constraints"]["period"] is None      # a preset value never becomes a user value
    assert job["result"]["identity"]["preset_ref"] == {"id": stored_preset.preset_id, "version": "1"}
    assert job["result"]["identity"]["selection_plan_id"] == stored_preset.selection_plan_id
    assert provider.calls == calls                                  # replay of the saved plan: no new selection


def test_P09_a_preset_opened_for_another_phenomenon_fails_as_a_job_resource(client, stored_preset):
    """Known only inside the job: GET still returns the job, with the error code and the request."""
    job = run(client, {"phenomenon_query": "warming",
                       "context": {"preset_ref": {"id": stored_preset.preset_id, "version": "1"}}})
    assert job["status"] == "failed" and job["result"] is None
    assert job["error"]["code"] == "invalid_context" and set(job["error"]) == ERROR_KEYS
    assert job["request"]["phenomenon_query"] == "warming"
    body = assert_error(client.get(f"/api/research/{job['research_id']}/export"), 409, "result_not_ready")
    assert body["retryable"] is False


def test_P08_parent_research_replays_the_saved_plan_for_a_new_period(client, drought, provider):
    parent_id, parent = drought[0]["research_id"], drought[2]["result"]
    calls = provider.calls
    job = run(client, {"phenomenon_query": "drought", "region_id": TAIWAN,
                       "period": {"start": "2005-01", "end": "2024-12"},
                       "context": {"parent_research_id": parent_id}})
    result = job["result"]
    assert provider.calls == calls                                  # the model / matcher was not asked again
    assert result["identity"]["parent_research_id"] == parent_id
    assert result["identity"]["selection_plan_id"] == parent["identity"]["selection_plan_id"]
    assert result["selection"]["content_hash"] == parent["selection"]["content_hash"]
    assert result["selection"]["reused"] is True
    assert result["resolved"]["period"] == {"start": "2005-01", "end": "2024-12", "source": "user"}
    old = {v["variable_id"]: v["trend"]["hypothesis_id"] for v in parent["variables"] if v["trend"]}
    new = {v["variable_id"]: v["trend"]["hypothesis_id"] for v in result["variables"] if v["trend"]}
    shared = set(old) & set(new)
    assert shared and all(old[k] != new[k] for k in shared)         # a new period is a new hypothesis
    assert {f["family_id"] for f in result["evidence_families"]}.isdisjoint(
        {f["family_id"] for f in parent["evidence_families"]})    # old corrections are not carried over


# --------------------------------------------------------------------------- cache

def test_identical_request_is_served_from_the_cache_as_a_new_job_that_says_so(client, drought, provider):
    first_id, first = drought[0]["research_id"], drought[2]
    assert first["cache_hit"] is False and first["cached_from"] is None
    job = run(client, DROUGHT)
    assert job["research_id"] != first_id and job["status"] == first["status"]
    assert job["cache_hit"] is True and job["cached_from"] == first_id
    assert first_id in job["stage_detail"] and "cache" in job["stage_detail"]
    result = job["result"]
    assert result["identity"]["research_id"] == job["research_id"]
    assert result["identity"]["cached_from"] == first_id
    assert result["identity"]["cache_key"] == first["result"]["identity"]["cache_key"]
    for block in ("variables", "indicators", "evidence_families", "comparison", "baselines", "selection"):
        assert result[block] == first["result"][block]
    # the copy is exportable and stored under its own id
    exported = strict_json(client.get(f"/api/research/{job['research_id']}/export").text)
    assert exported["identity"]["research_id"] == job["research_id"]


def test_reselect_bypasses_the_cache_and_plan_reuse(client, drought, provider):
    calls = provider.calls
    job = run(client, {**DROUGHT, "options": {"reselect": True}})
    assert job["cache_hit"] is False and provider.calls == calls + 1
    assert job["result"]["selection"]["reused"] is False
    assert job["result"]["selection"]["selection_plan_id"] != drought[2]["result"]["selection"]["selection_plan_id"]


def test_a_changed_condition_is_not_a_cache_hit(client):
    job = run(client, {**DROUGHT, "period": {"start": "2002-01", "end": "2020-12"}})
    assert job["cache_hit"] is False


def test_cache_can_be_switched_off(store, tmp_path):
    with TestClient(make_app(store, tmp_path, use_cache=False)) as c:
        first, second = run(c, DROUGHT), run(c, DROUGHT)
    assert second["cache_hit"] is False and second["research_id"] != first["research_id"]
    assert second["result"]["variables"] == first["result"]["variables"]   # still reproducible


# --------------------------------------------------------------------------- restart

def test_finished_and_failed_research_survive_a_restart(store, var_dir, client, drought, stored_preset):
    failed = run(client, {"phenomenon_query": "warming",
                          "context": {"preset_ref": {"id": stored_preset.preset_id, "version": "1"}}})
    with TestClient(make_app(store, var_dir)) as restarted:        # a new process on the same var directory
        job = strict_json(restarted.get(f"/api/research/{drought[0]['research_id']}").text)
        assert job["status"] == drought[2]["status"] and job["result"] == drought[2]["result"]
        assert job["request"] == drought[2]["request"] and job["stage_history"] == list(C.STAGES)
        again = strict_json(restarted.get(f"/api/research/{failed['research_id']}").text)
        assert again["status"] == "failed" and again["error"] == failed["error"] and again["result"] is None
        assert again["request"] == failed["request"]
        exported = restarted.get(f"/api/research/{drought[0]['research_id']}/export", params={"format": "csv"})
        assert exported.status_code == 200


# --------------------------------------------------------------------------- cancellation

class GatedProvider:
    """TEST provider that blocks inside the selection stage until released."""

    name, model, is_language_model = "catalogue_lexical", None, False

    def __init__(self, inner):
        self._inner, self.entered, self.release = inner, threading.Event(), threading.Event()

    def complete(self, system, user, schema):
        self.entered.set()
        assert self.release.wait(30), "TEST gate was never released"
        return self._inner.complete(system, user, schema)


def test_cancel_running_and_queued_jobs_publishes_no_result(store, tmp_path):
    gate = GatedProvider(CatalogueLexicalProvider(store))
    app = make_app(store, tmp_path, gate, max_workers=1)
    with TestClient(app) as c:
        running = c.post("/api/research", json=DROUGHT).json()
        assert gate.entered.wait(30)
        queued = c.post("/api/research", json={**DROUGHT, "phenomenon_query": "flood"}).json()
        assert c.get(f"/api/research/{running['research_id']}").json()["stage"] == "selecting_variables"
        assert c.get(f"/api/research/{queued['research_id']}").json()["status"] == "queued"
        assert_error(c.get(f"/api/research/{running['research_id']}/export"), 409, "result_not_ready")

        for job in (queued, running):
            cancelled = c.delete(f"/api/research/{job['research_id']}")
            assert cancelled.status_code == 200
            body = cancelled.json()
            assert body["status"] == "cancelled" and body["result"] is None and body["cancel_requested"] is True
            assert body["error"]["code"] == "cancelled" and body["request"] == job["request"]
        gate.release.set()
        app.state.ctx.jobs.wait(running["research_id"], timeout=30)
        for job in (queued, running):
            after = c.get(f"/api/research/{job['research_id']}").json()
            assert after["status"] == "cancelled" and after["result"] is None
            assert "complete" not in after["stage_history"] and "correcting" not in after["stage_history"]
            assert not app.state.ctx.storage.has_result(job["research_id"])   # no corrected label was published
            assert_error(c.get(f"/api/research/{job['research_id']}/export"), 409, "result_not_ready")
        again = c.delete(f"/api/research/{running['research_id']}").json()    # idempotent
        assert again["status"] == "cancelled"


def test_cancelling_a_finished_job_changes_nothing(client, drought):
    response = client.delete(f"/api/research/{drought[0]['research_id']}")
    assert response.status_code == 200
    body = strict_json(response.text)
    assert body["status"] == drought[2]["status"] and body["result"] == drought[2]["result"]
    assert body["cancel_requested"] is False


# --------------------------------------------------------------------------- selector unavailable (S07)

@pytest.fixture()
def no_selector_env(monkeypatch):
    monkeypatch.delenv("AQUA_SELECTOR", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


def test_S07_no_selector_configured_is_503_and_nothing_is_fabricated(store, tmp_path, no_selector_env):
    with TestClient(make_app(store, tmp_path, provider=None)) as c:
        body = assert_error(c.post("/api/research", json=DROUGHT), 503, "selector_unavailable")
        assert body["retryable"] is True and "kept" in body["message"]
        status = c.get("/api/catalogue").json()["selector"]
        assert status["available"] is False and status["provider"] is None and status["mode"] == "auto"
        assert c.get("/api/health").json()["selector"]["available"] is False
    assert not list(tmp_path.rglob("*.json"))                      # no job, no plan, no result, no stand-in


def test_S07_lexical_matcher_is_used_only_when_asked_for_explicitly(store, tmp_path, monkeypatch, no_selector_env):
    monkeypatch.setenv("AQUA_SELECTOR", "catalogue_lexical")
    with TestClient(make_app(store, tmp_path, provider=None)) as c:
        status = c.get("/api/catalogue").json()["selector"]
        assert status == {**status, "provider": "catalogue_lexical", "is_language_model": False, "available": True,
                          "mode": "catalogue_lexical"}
        job = run(c, DROUGHT)
        assert job["result"]["selection"]["selector"]["is_language_model"] is False
    monkeypatch.setenv("AQUA_SELECTOR", "keyword_demo")
    with TestClient(make_app(store, tmp_path / "other", provider=None)) as c:
        body = assert_error(c.post("/api/research", json=DROUGHT), 503, "selector_unavailable")
        assert body["retryable"] is False                           # a configuration mistake, not an outage


def test_S07_model_failure_inside_the_job_keeps_the_job_resource(store, tmp_path):
    with TestClient(make_app(store, tmp_path, ScriptedModel(None))) as c:
        job = run(c, DROUGHT)
        assert job["status"] == "failed" and job["result"] is None
        assert job["error"]["code"] == "selector_unavailable" and job["error"]["retryable"] is True
        assert job["request"]["region_id"] == TAIWAN and job["request"]["period"] == PERIOD
        assert job["stage"] == "selecting_variables"
    assert not (tmp_path / "results").exists()


def test_S07_saved_model_plan_of_the_same_versions_is_reused_when_no_model_is_configured(
        store, tmp_path, no_selector_env):
    lexical = CatalogueLexicalProvider(store).complete("", "<phenomenon_query>drought</phenomenon_query>", {})
    with TestClient(make_app(store, tmp_path, ScriptedModel(lexical))) as c:   # TEST model answers once
        first = run(c, DROUGHT)
    plan = first["result"]["selection"]
    assert plan["selector"]["is_language_model"] is True and plan["reused"] is False
    with TestClient(make_app(store, tmp_path, provider=None)) as c:            # later: nothing configured
        job = run(c, {**DROUGHT, "period": {"start": "2004-01", "end": "2020-12"}})
        assert job["status"] in ("complete", "partial")
        selection = job["result"]["selection"]
        assert selection["selection_plan_id"] == plan["selection_plan_id"] and selection["reused"] is True
        assert selection["selector"]["provider"] == "test_scripted_model"       # says who really made it
        assert_error(c.post("/api/research", json={**DROUGHT, "phenomenon_query": "warming"}),
                     503, "selector_unavailable")                              # no saved plan for this text
        assert_error(c.post("/api/research", json={**DROUGHT, "options": {"reselect": True}}),
                     503, "selector_unavailable")                              # an explicit re-selection needs the model


# --------------------------------------------------------------------------- unexpected errors

def test_unexpected_error_in_a_job_is_internal_error_without_a_stack_trace(store, tmp_path, monkeypatch):
    app = make_app(store, tmp_path)

    def boom(*args, **kwargs):
        raise RuntimeError("TEST secret detail /etc/passwd")

    monkeypatch.setattr(app.state.ctx.engine, "run", boom)
    with TestClient(app) as c:
        response = c.post("/api/research", json=DROUGHT)
        assert response.status_code == 202
        job_response = c.get(f"/api/research/{response.json()['research_id']}")
        deadline = time.monotonic() + 30
        while job_response.json()["status"] not in FINAL and time.monotonic() < deadline:
            time.sleep(0.02)
            job_response = c.get(f"/api/research/{response.json()['research_id']}")
        job = job_response.json()
        assert job["status"] == "failed" and job["error"]["code"] == "internal_error"
        assert job["error"]["retryable"] is True and job["request"]["region_id"] == TAIWAN
        assert "secret" not in job_response.text and "RuntimeError" not in job_response.text


def test_unexpected_error_in_a_route_is_a_500_internal_error_body(store, tmp_path, monkeypatch):
    app = make_app(store, tmp_path)

    def boom(*args, **kwargs):
        raise RuntimeError("TEST secret detail")

    monkeypatch.setattr(app.state.ctx.jobs, "get", boom)
    with TestClient(app, raise_server_exceptions=False) as c:
        response = c.get("/api/research/rs_anything", headers={"origin": "http://localhost:3000"})
        body = assert_error(response, 500, "internal_error")
        assert body["retryable"] is True and "secret" not in response.text
        assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_invalid_release_error_keeps_its_stable_code(store, tmp_path, monkeypatch):
    app = make_app(store, tmp_path)

    def stale(*args, **kwargs):
        raise AquaError("data_release_invalid", "TEST: the job was created for another data snapshot.")

    monkeypatch.setattr(app.state.ctx.engine, "run", stale)
    with TestClient(app) as c:
        job = run(c, DROUGHT)
    assert job["status"] == "failed" and job["error"]["code"] == "data_release_invalid"


# --------------------------------------------------------------------------- no NaN anywhere

def test_no_payload_contains_nan_or_infinity(client, drought, store):
    research_id = drought[0]["research_id"]
    family_id = drought[2]["result"]["evidence_families"][0]["family_id"]
    urls = ["/api/health", "/api/catalogue", "/api/catalogue/regions", f"/api/catalogue/regions/{TAIWAN}",
            f"/api/research/{research_id}", f"/api/research/{research_id}/export?format=json",
            f"/api/research/{research_id}/families/{family_id}"]
    for url in urls:
        response = client.get(url)
        assert response.status_code == 200, url
        document = strict_json(response.text)                       # raises on NaN / Infinity tokens
        assert not [path for path, value in es.walk_numbers(document) if value != value or abs(value) == float("inf")]
    text = client.get(f"/api/research/{research_id}/export?format=csv").text
    data_lines = [line for line in text.splitlines() if not line.startswith("# ")]
    assert not any(cell.lower() in ("nan", "inf", "-inf", "infinity") for line in data_lines for cell in line.split(","))
    series = drought[2]["result"]["variables"][0]["series"]
    assert len(series["raw"]) == len(series["times"])               # gaps stay at their calendar position


# --------------------------------------------------------------------------- CORS

def test_cors_allows_the_front_end_origins_only(client, store, tmp_path):
    assert "http://localhost:3000" in DEFAULT_CORS_ORIGINS and "http://127.0.0.1:5000" in DEFAULT_CORS_ORIGINS
    ok = client.options("/api/research", headers={"origin": "http://localhost:3001",
                                                  "access-control-request-method": "POST",
                                                  "access-control-request-headers": "content-type"})
    assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == "http://localhost:3001"
    assert "DELETE" in ok.headers["access-control-allow-methods"]
    plain = client.get("/api/health", headers={"origin": "http://127.0.0.1:3000"})
    assert plain.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
    assert "access-control-allow-origin" not in client.get("/api/health", headers={"origin": "http://evil.test"}).headers
    with TestClient(make_app(store, tmp_path, cors_origins=["https://detective.example"])) as c:
        got = c.get("/api/health", headers={"origin": "https://detective.example"})
        assert got.headers["access-control-allow-origin"] == "https://detective.example"
