"""ResearchEngine flows on the labelled TEST release: storage, replay, presets, cancellation, statuses.

Acceptance: P02, P04–P06, P08 (replay), P09, D02, D06, D09, T07, T11, S03, and contract §9.4
(summary failure keeps the numbers).  All numbers come from tests/fixtures/engine (TEST data).
"""
from __future__ import annotations

import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures" / "engine"))

import engine_support as es  # noqa: E402

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.engine import PresetFill, ResearchEngine  # noqa: E402
from aqua_trend.errors import AquaError  # noqa: E402
from aqua_trend.stats import EvidenceController  # noqa: E402
from aqua_trend.storage import EMBED_HYPOTHESES_MAX, ResearchStorage  # noqa: E402
from aqua_trend.store import PreparedDataStore  # noqa: E402

PERIOD = C.Period(start="2001-01", end="2003-12")
QUERY = "TEST phenomenon"


@pytest.fixture()
def store(tmp_path):
    return PreparedDataStore.open(*es.build_engine_release(tmp_path / "release"))


@pytest.fixture()
def plan(store):
    return es.make_plan(store, QUERY, [("t_precip", "core_indicator"), ("t_soil", "related_condition")],
                        phenomenon_id="t_phen")


@pytest.fixture()
def selector(plan):
    return es.FakeSelector(plan)


@pytest.fixture()
def storage(tmp_path):
    return ResearchStorage(tmp_path / "var")


@pytest.fixture()
def engine(store, selector, storage):
    return ResearchEngine(store, selector, storage=storage)


def request(**fields) -> C.ResearchRequest:
    fields.setdefault("phenomenon_query", QUERY)
    return C.ResearchRequest(**fields)


def var(result, variable_id):
    return next(v for v in result.variables if v.variable_id == variable_id)


# --------------------------------------------------------------------------- data statuses

def test_D09_missing_and_zero_keep_their_calendar_position(engine):
    result = engine.run(request(region_id="reg-a", period=C.Period(start="2000-01", end="2003-12")))
    precip = var(result, "t_precip")
    assert precip.product.selected_product_id == "t_precip_a" and precip.status == "ok"
    s = precip.series
    assert s.times[:5] == ["2000-01", "2000-02", "2000-03", "2000-04", "2000-05"]
    assert s.raw[2] is None and s.anomaly[2] is None                   # missing month stays null
    assert s.raw[3] == 0.0 and s.anomaly[3] is not None                # zero is a value
    assert precip.trend.n_valid == 47 and precip.trend.n_expected == 48
    assert precip.actual_support.longest_gap == 1
    assert precip.trend.inference_status == "not_applicable"           # 4 TEST years: descriptive only
    assert precip.trend.significance_label == "undetermined" and precip.trend.significant is None
    assert result.identity.status == "partial"


def test_D04_D06_fallback_and_unusable_variable_stay_visible(engine):
    result = engine.run(request(region_id="reg-c", period=PERIOD))
    precip, soil = var(result, "t_precip"), var(result, "t_soil")
    assert precip.product.selected_product_id == "t_precip_b" and precip.product.fallback
    assert precip.trend is not None and precip.series is not None
    assert soil.status == "no_series" and soil.trend is None and soil.series is None
    assert soil.product.selected_product_id is None and "t_soil" in soil.status_reason
    assert result.resolved.region.id == "reg-c" and result.resolved.period.source == "user"
    family = result.evidence_families[0]
    assert family.n_candidates == 2 and family.n_untested == 2         # both listed; neither is a valid test
    assert {h.components["variable_id"] for h in family.hypotheses} == {"t_precip", "t_soil"}
    assert any(w.code == "no_series" and w.subject == "t_soil" for w in result.warnings)


def test_T07_unsupported_baseline_is_not_recomputed_on_the_query_window(engine):
    result = engine.run(request(region_id="reg-d", period=C.Period(start="2002-03", end="2003-12")))
    precip = var(result, "t_precip")
    assert precip.status == "insufficient_baseline" and precip.trend is None
    assert "not shortened or moved" in precip.status_reason
    s = precip.series
    assert s.anomaly is None and s.fit is None and any(v is not None for v in s.raw)
    assert any(c is None for c in s.seasonal_cycle)                    # months below the minimum have no normal
    base = next(b for b in result.baselines if b.applies_to == ["t_precip"])
    assert base.status == "insufficient_baseline" and (base.start, base.end) == ("2001-01", "2003-12")
    assert base.designation == "registered_reference_mean" and min(base.samples_per_position) < base.minimum_samples
    record = result.evidence_families[0].hypotheses[0]
    assert not record.tested and "reference period" in record.untested_reason


@pytest.mark.parametrize("region_id", ["reg-b", "hex-t1"])
def test_D02_region_without_series(engine, region_id):
    result = engine.run(request(region_id=region_id, period=PERIOD))
    assert result.resolved.region.id == region_id
    assert [v.status for v in result.variables] == ["no_series", "no_series"]
    assert all(v.series is None for v in result.variables) and result.identity.status == "partial"


def test_recorded_events_delivered_do_not_depend_on_monthly_series(tmp_path, plan):
    """E02 wiring: a ready TEST catalogue is aggregated by the registry and fitted by the same engine."""
    cat, data, cache = es.build_engine_release(tmp_path / "release_with_events")
    es.fx.deliver_events(cat)
    index = es.fx.read(cat / "events" / "index.json")
    real_index = es.fx.read(es.BACKEND / "catalogue" / "events" / "index.json")
    index["aggregation_rule"], index["metrics"] = real_index["aggregation_rule"], real_index["metrics"]
    es.fx.write(cat / "events" / "index.json", index)
    store = PreparedDataStore.open(cat, data, cache)
    engine = ResearchEngine(store, es.FakeSelector(plan))
    whole = C.Period(start="2000-01", end="2003-12")

    # the TEST records of the store fixture carry no time precision: the registry refuses them, and
    # that refusal stays inside the indicator — the variables are analysed as usual
    refused = engine.run(request(region_id="reg-a", period=whole))
    broken = next(i for i in refused.indicators if i.kind == "recorded_event")
    assert broken.status == "data_required" and "time_precision" in broken.status_reason and broken.metrics == []
    assert [v.status for v in refused.variables] == ["ok", "ok"] and all(v.trend for v in refused.variables)

    events = es.fx.read(cat / "events" / "t_events" / "events.json")
    events["events"] = [
        {"event_id": "t-e1", "phenomenon_id": "t_phen", "region_ids": ["reg-a"], "start": "2001-05-03",
         "end": "2001-06-10", "time_precision": {"start": "day", "end": "day"}},
        {"event_id": "t-e2", "phenomenon_id": "t_phen", "region_ids": ["reg-a", "reg-c"], "start": "2002-02-01",
         "end": "2002-02-04", "time_precision": {"start": "day", "end": "day"}}]
    es.fx.write(cat / "events" / "t_events" / "events.json", events)
    store = PreparedDataStore.open(cat, data, tmp_path / "cache_events")
    engine = ResearchEngine(store, es.FakeSelector(plan))
    result = engine.run(request(region_id="reg-a", period=whole))
    recorded = next(i for i in result.indicators if i.kind == "recorded_event")
    assert recorded.indicator_id == "recorded.t_phen" and recorded.event_catalogue_id == "t_events"
    starts = recorded.metrics[0]
    assert starts.metric_id == "recorded.t_phen.event_starts_per_year" and starts.series.cadence == "annual"
    assert starts.series.times == ["2000", "2001", "2002", "2003"] and starts.series.raw == [0.0, 1.0, 1.0, 0.0]
    assert starts.trend is not None and starts.trend.inference_status == "not_applicable"   # 4 years
    assert starts.trend.method.seasonal_adjustment == "none_annual"
    ids = [h.components.get("event_catalogue_id") for h in result.evidence_families[0].hypotheses]
    assert ids.count("t_events") == len(recorded.metrics)


# --------------------------------------------------------------------------- storage / replay (P08, P09)

def test_result_is_stored_and_cache_indexed(engine, storage):
    result = engine.run(request(region_id="reg-a", period=PERIOD))
    loaded = storage.load_result(result.identity.research_id)
    assert loaded.model_dump(mode="json") == result.model_dump(mode="json")
    assert storage.cache_get(result.identity.cache_key) == result.identity.research_id
    family = result.evidence_families[0]
    assert family.external_ref == f"family:{family.family_id}" and not family.hypotheses_truncated
    assert storage.load_family(family.external_ref).content_hash == family.content_hash
    cached = engine.run(request(region_id="reg-a", period=PERIOD), use_cache=True, research_id="rs_second")
    assert cached.identity.research_id == "rs_second" and cached.identity.cached_from == result.identity.research_id
    assert cached.variables[0].trend == result.variables[0].trend


def test_P08_parent_replay_uses_the_saved_plan_without_asking_the_selector(engine, selector, plan):
    first = engine.run(request(region_id="reg-a", period=PERIOD))
    calls = selector.select_calls
    child = engine.run(request(region_id="reg-a", period=C.Period(start="2000-06", end="2003-12"),
                               context=C.RequestContext(parent_research_id=first.identity.research_id)))
    assert selector.select_calls == calls                              # numeric replay: no new model call
    assert child.selection.selection_plan_id == plan.selection_plan_id and child.selection.reused
    assert child.identity.parent_research_id == first.identity.research_id
    assert child.resolved.period.source == "user" and child.identity.cache_key != first.identity.cache_key
    selector.add(es.make_plan(engine.store, "another TEST text", [("t_soil", "core_indicator")]))
    other = engine.run(request(phenomenon_query="another TEST text", region_id="reg-a", period=PERIOD,
                               context=C.RequestContext(parent_research_id=first.identity.research_id)))
    assert selector.select_calls == calls + 1                          # changed phenomenon -> a new selection
    assert [v.variable_id for v in other.variables] == ["t_soil"]
    with pytest.raises(AquaError) as err:
        engine.run(request(region_id="reg-a", period=PERIOD,
                           context=C.RequestContext(parent_research_id="rs_missing")))
    assert err.value.code == "invalid_context"


# --------------------------------------------------------------------------- presets (P02, P05, P06, T11)

def test_P05_blank_field_without_a_preset_engine_keeps_the_user_values(engine):
    result = engine.run(request(region_id="reg-a"))
    resolved = result.resolved
    assert (resolved.region.id, resolved.region.source) == ("reg-a", "user") and resolved.period is None
    assert resolved.preset_status == "no_matching_preset" and resolved.preset_missing == ["period"]
    assert resolved.preset_reason == "preset engine not configured"
    assert any(w.code == "no_matching_preset" for w in result.warnings)


def test_P05_preset_engine_reports_no_match(store, selector):
    fake = es.FakePresetEngine(PresetFill(status="no_matching_preset", missing=["region_id"],
                                          reason="TEST: no region has data for this period"))
    result = ResearchEngine(store, selector, preset_engine=fake).run(request(period=PERIOD))
    assert fake.calls[0][1].period.model_dump() == PERIOD.model_dump() and fake.calls[0][1].region_id is None
    assert result.resolved.region is None and result.resolved.period.source == "user"
    assert (result.resolved.period.start, result.resolved.period.end) == ("2001-01", "2003-12")
    assert result.resolved.preset_missing == ["region_id"] and "TEST: no region" in result.resolved.preset_reason
    assert all(v.trend is None for v in result.variables) and len(result.variables) == 2


def _search_fill(engine: ResearchEngine, plan: C.SelectionPlan, storage: ResearchStorage, *, region: str = "reg-a",
                 windows=(("2000-01", "2003-12"), ("2001-01", "2003-12"), ("2000-01", "2002-12"))) -> PresetFill:
    """TEST preset search: analyse three windows with the shared core and correct them as ONE family."""
    records = []
    for start, end in windows:
        records += engine.analyse_candidate(plan, region, C.Period(start=start, end=end)).records()
    family = EvidenceController(engine.method_policy).build_family(
        "preset_search", {"id": "test_windows", "version": "t", "description": "TEST candidate windows"},
        records, complete=True)
    storage.save_family(family)
    preset = C.Preset(
        preset_id="pre_test", version="1", source="automatic", selection_plan_id=plan.selection_plan_id,
        variable_ids=[v.variable_id for v in plan.variable_set], region_id=region,
        period=C.Period(start=windows[1][0], end=windows[1][1]),
        reasons=[C.PresetReason(text="TEST reason", evidence_ids=[records[0].hypothesis_id])],
        family_id=family.family_id, search_complete=True, dataset_version=engine.store.versions["dataset_version"],
        method_policy_version=engine.store.versions["method_policy_version"],
        preset_policy_version=engine.store.versions["preset_policy_version"])
    storage.save_preset(preset)
    return PresetFill(region_id=region, period=preset.period, preset=preset, family=family, status="applied",
                      reason="TEST reason")


def test_P02_T11_preset_fills_only_the_period_and_keeps_its_search_family(store, selector, plan, storage):
    engine = ResearchEngine(store, selector, storage=storage)
    fill = _search_fill(engine, plan, storage)
    engine.preset_engine = es.FakePresetEngine(fill)
    result = engine.run(request(region_id="reg-a"))
    resolved = result.resolved
    assert (resolved.region.id, resolved.region.source) == ("reg-a", "user")           # P02: region untouched
    assert (resolved.period.start, resolved.period.end, resolved.period.source) == ("2001-01", "2003-12", "preset")
    assert resolved.preset_status == "applied" and resolved.preset.preset_id == "pre_test"
    assert result.user_constraints.period is None                                      # a preset value is not a user value
    assert all(v.requested_period is None and v.analysis_period.start == "2001-01" for v in result.variables)
    scopes = {f.scope: f for f in result.evidence_families}
    assert set(scopes) == {"query", "preset_search"}
    assert scopes["preset_search"].family_id == fill.family.family_id
    assert scopes["preset_search"].n_candidates == 6 > scopes["query"].n_candidates == 2
    mine = {h.hypothesis_id for h in scopes["query"].hypotheses}
    assert mine <= {h.hypothesis_id for h in scopes["preset_search"].hypotheses}
    assert any("filled by a preset" in s.text for s in result.summary.statements)


def test_T11_search_family_is_primary_when_inference_applies(tmp_path):
    """Real series are needed for valid tests; the family logic is the same code as above."""
    if not (es.DATA / "series" / f"{es.TAIWAN}.json").exists():
        pytest.skip("prepared series not present")
    store = PreparedDataStore.open()
    plan = es.make_plan(store, QUERY, [("tair", "core_indicator"), ("vpd", "related_condition")])
    storage = ResearchStorage(tmp_path / "var")
    engine = ResearchEngine(store, es.FakeSelector(plan), storage=storage)
    fill = _search_fill(engine, plan, storage, region=es.TAIWAN,
                        windows=(("2001-01", "2020-12"), ("2005-01", "2024-12"), ("2003-01", "2022-12")))
    engine.preset_engine = es.FakePresetEngine(fill)
    result = engine.run(request(region_id=es.TAIWAN))
    search = next(f for f in result.evidence_families if f.scope == "preset_search")
    query = next(f for f in result.evidence_families if f.scope == "query")
    assert search.n_tested == 6 and query.n_tested == 2
    for v in result.variables:
        t = v.trend
        assert t.primary_family_id == search.family_id                 # not replaced by the smaller query family
        assert set(t.p_adjusted) == {search.family_id, query.family_id}
        assert t.p_adjusted[search.family_id] >= t.p_adjusted[query.family_id] >= t.p_raw
        assert t.significant == (t.p_adjusted[search.family_id] < search.alpha)
    assert any("preset-search family" in s.text for s in result.summary.statements)

    # P09: opening the stored preset restores sources and search evidence from the backend's records
    engine.preset_engine = None
    ref = C.RequestContext(preset_ref=C.PresetRef(id="pre_test", version="1"))
    opened = engine.run(request(context=ref))
    assert opened.resolved.preset_status == "opened"
    assert (opened.resolved.region.source, opened.resolved.period.source) == ("preset", "preset")
    assert opened.variables[0].trend.primary_family_id == search.family_id
    assert opened.variables[0].trend.model_dump() == result.variables[0].trend.model_dump()
    with pytest.raises(AquaError) as err:                              # conflicting user field is never overwritten
        engine.run(request(context=ref, period=C.Period(start="2010-01", end="2020-12")))
    assert err.value.code == "invalid_context" and "period" in err.value.fields

    # adjusting the period on the opened result: the search family no longer matches the new hypotheses
    adjusted = engine.run(request(region_id=es.TAIWAN, period=C.Period(start="2008-01", end="2023-12"),
                                  context=C.RequestContext(parent_research_id=opened.identity.research_id)))
    assert [f.scope for f in adjusted.evidence_families] == ["query"]
    assert adjusted.variables[0].trend.primary_family_id == adjusted.evidence_families[0].family_id
    assert (adjusted.resolved.region.source, adjusted.resolved.period.source) == ("user", "user")


def test_P06_a_preset_engine_cannot_override_a_user_field(store, selector):
    bad = PresetFill(region_id="reg-c", period=PERIOD, status="applied", reason="TEST override")
    engine = ResearchEngine(store, selector, preset_engine=es.FakePresetEngine(bad))
    with pytest.raises(AquaError) as err:
        engine.run(request(region_id="reg-a"))
    assert err.value.code == "internal_error" and "region the user selected" in err.value.message


def test_large_search_family_is_embedded_truncated_with_a_locator(engine, plan, storage):
    analysis = engine.analyse_candidate(plan, "reg-a", PERIOD)
    extra = [r.model_copy(update={"hypothesis_id": f"{r.hypothesis_id}-{i}"})
             for i in range(EMBED_HYPOTHESES_MAX) for r in analysis.records()[:1]]
    family = EvidenceController(engine.method_policy).build_family(
        "preset_search", {"id": "test_many", "version": "t"}, analysis.records() + extra, complete=True)
    keep = {r.hypothesis_id for r in analysis.records()}
    embedded = storage.embed_family(family, keep)
    assert embedded.hypotheses_truncated and embedded.external_ref == f"family:{family.family_id}"
    assert len(embedded.hypotheses) == EMBED_HYPOTHESES_MAX and embedded.n_candidates == len(family.hypotheses)
    assert keep <= {h.hypothesis_id for h in embedded.hypotheses}
    assert len(storage.load_family(embedded.external_ref).hypotheses) == family.n_candidates
    with pytest.raises(AquaError):
        storage.save_family(embedded)                                  # a sample is never stored as the record
    with pytest.raises(AquaError):
        storage.load_result("../../etc/passwd")


# --------------------------------------------------------------------------- cancellation / failures

def test_cancel_stops_before_any_corrected_label_is_published(engine, storage):
    seen: list[str] = []
    flag = threading.Event()

    def on_stage(stage, completed, total, detail):
        seen.append(stage)
        if stage == "analyzing" and completed == 1:
            flag.set()

    with pytest.raises(AquaError) as err:
        engine.run(request(region_id="reg-a", period=PERIOD), on_stage=on_stage, cancel=flag, research_id="rs_cancel")
    assert err.value.code == "cancelled"
    assert "correcting" not in seen and "complete" not in seen
    assert not storage.has_result("rs_cancel")
    failed = engine.failed_result(request(region_id="reg-a", period=PERIOD), err.value, "rs_cancel")
    assert failed.identity.status == "cancelled" and failed.evidence_families == [] and failed.variables == []
    assert failed.user_constraints.region_id == "reg-a"                # the input is kept


def test_summary_failure_keeps_the_numeric_results(engine, monkeypatch):
    def broken(result):
        raise RuntimeError("TEST failure in the text template")

    monkeypatch.setattr(engine.presenter, "summary", broken)
    result = engine.run(request(region_id="reg-a", period=PERIOD))
    assert result.summary.status == "unavailable" and "TEST failure" in result.summary.unavailable_reason
    assert result.summary.statements == []
    assert all(v.trend is not None and v.series is not None for v in result.variables)
    assert result.evidence_families and result.evidence_families[0].complete


def test_S03_partial_plan_lists_what_cannot_be_answered(store, storage):
    plan = es.make_plan(store, QUERY, [("t_precip", "related_condition")], status="partial",
                        unanswerable=["TEST: event counts need an event catalogue."],
                        ignored=["Europe", "2022"])
    result = ResearchEngine(store, es.FakeSelector(plan), storage=storage).run(request(region_id="reg-a", period=PERIOD))
    assert [v.variable_id for v in result.variables] == ["t_precip"] and result.variables[0].trend is not None
    codes = {w.code for w in result.warnings}
    assert {"partial_selection", "text_constraints_ignored", "selector_not_language_model"} <= codes
    text = " ".join(s.text for s in result.summary.statements)
    assert "TEST: event counts need an event catalogue." in text and "Europe, 2022" in text
    assert result.identity.status == "partial"
    derived = [i for i in result.indicators if i.kind == "derived_indicator"]
    assert derived and derived[0].status == "data_required" and derived[0].metrics == []   # registry not delivered
