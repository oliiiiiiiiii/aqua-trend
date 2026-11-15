"""PresetEngine on the labelled TEST release: fill, open, families, manual settings, versions.

Acceptance: P01–P09, T09, T10, T11, T16 and section 7 (manual adjustments, completeness,
reproducibility).  All numbers come from tests/fixtures/presets (TEST data, not science).
"""
from __future__ import annotations

import sys
import threading
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures" / "presets"))

import presets_support as ps  # noqa: E402

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.engine import ResearchEngine  # noqa: E402
from aqua_trend.errors import AquaError  # noqa: E402
from aqua_trend.presets import PresetEngine, preset_id_for  # noqa: E402
from aqua_trend.presets import service as service_module  # noqa: E402
from aqua_trend.stats import by_adjust  # noqa: E402
from aqua_trend.storage import ResearchStorage  # noqa: E402
from aqua_trend.store import PreparedDataStore  # noqa: E402

USER_PERIOD = C.Period(start="1995-03", end="2014-08")


class Rig:
    """One TEST release + storage + selector + bound engines."""

    def __init__(self, root: Path, var: Path, **release):
        self.root, self.var = root, var
        self.dirs = ps.build_preset_release(root, **release) if not (root / "catalogue").exists() else \
            (root / "catalogue", root / "data", root / "cache")
        self.reopen()

    def reopen(self) -> "Rig":
        self.store = PreparedDataStore.open(*self.dirs)
        self.plan, self.plan2 = ps.plans(self.store)
        self.selector = ps.es.FakeSelector(self.plan, self.plan2)
        self.storage = ResearchStorage(self.var)
        self.presets = PresetEngine(self.store, storage=self.storage)
        self.engine = ResearchEngine(self.store, self.selector, preset_engine=self.presets, storage=self.storage)
        self.presets.bind(self.engine)
        return self

    def run(self, **fields) -> C.ResearchResult:
        fields.setdefault("phenomenon_query", ps.QUERY)
        return self.engine.run(C.ResearchRequest(**fields))

    def search(self, plan=None, **fields):
        return self.presets.search(plan or self.plan, C.UserConstraints(phenomenon_query=ps.QUERY, **fields))


@pytest.fixture()
def rig(tmp_path):
    return Rig(tmp_path / "release", tmp_path / "var")


def search_family(result: C.ResearchResult) -> C.EvidenceFamily:
    return next(f for f in result.evidence_families if f.scope == "preset_search")


# --------------------------------------------------------------------------- P01–P05: the four combinations

def test_P01_both_blank_fills_one_region_and_one_period_with_reasons(rig):
    result = rig.run()
    resolved = result.resolved
    assert resolved.preset_status == "applied" and resolved.preset_missing == []
    assert resolved.region.source == "preset" and resolved.period.source == "preset"
    assert resolved.region.id in rig.store.regions()
    assert result.user_constraints.region_id is None and result.user_constraints.period is None
    preset = resolved.preset
    assert (preset.region_id, preset.period.start, preset.period.end) == \
        (resolved.region.id, resolved.period.start, resolved.period.end)
    assert preset.rank == 1 and preset.search_complete and preset.filled_fields == ["region_id", "period"]
    # reasons point to identifiable data facts: every reason names hypothesis ids of the stored family
    family = rig.storage.load_family(preset.family_id)
    known = {h.hypothesis_id for h in family.hypotheses}
    assert preset.reasons and all(r.evidence_ids and set(r.evidence_ids) <= known for r in preset.reasons)
    assert resolved.preset_reason and preset.preset_id in resolved.preset_reason
    assert len(result.variables) == 2 and all(v.analysis_period == C.Period(start=resolved.period.start,
                                                                           end=resolved.period.end)
                                              for v in result.variables)


def test_P02_user_region_is_kept_and_only_a_period_is_recommended(rig):
    result = rig.run(region_id="reg-f")
    assert result.resolved.region.id == "reg-f" and result.resolved.region.source == "user"
    assert result.resolved.period.source == "preset" and result.resolved.preset_status == "applied"
    assert result.resolved.preset.filled_fields == ["period"]
    record = rig.storage.load_document("preset_searches", result.resolved.preset.search_id)
    assert {c["region_id"] for c in record["candidates"]} == {"reg-f"}        # exactly that region id, nothing else
    assert record["regions"]["considered"] == ["reg-f"]


def test_P02_user_region_outside_the_automatic_layers_is_searched_as_selected(rig):
    assert rig.store.region("reg-b")["type"] == "basin4"                       # not a candidate layer of the policy
    assert all(p.region_id != "reg-b" for p in rig.search().presets)           # never recommended automatically
    result = rig.run(region_id="reg-b")
    assert result.resolved.region.id == "reg-b" and result.resolved.preset_status == "applied"
    assert result.resolved.preset.region_id == "reg-b"


def test_P03_user_period_is_kept_and_only_a_region_is_recommended(rig):
    result = rig.run(period=USER_PERIOD)
    period = result.resolved.period
    assert (period.start, period.end, period.source) == (USER_PERIOD.start, USER_PERIOD.end, "user")
    assert result.resolved.region.source == "preset" and result.resolved.preset_status == "applied"
    assert result.resolved.preset.filled_fields == ["region_id"]
    record = rig.storage.load_document("preset_searches", result.resolved.preset.search_id)
    assert {(c["period"]["start"], c["period"]["end"]) for c in record["candidates"]} == \
        {(USER_PERIOD.start, USER_PERIOD.end)}                                 # only that period is tested
    assert record["window_rule"]["user_period_only"] is True
    assert all(c["kind"] == "user_period" for c in record["candidates"])


def test_P04_both_fields_given_never_calls_the_preset_engine(rig, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("the preset engine must not be asked when both fields are filled")
    monkeypatch.setattr(rig.presets, "fill", boom)
    monkeypatch.setattr(rig.presets, "search", boom)
    result = rig.run(region_id="reg-a", period=USER_PERIOD)
    assert result.resolved.preset_status == "not_needed" and result.resolved.preset is None
    assert result.resolved.region.source == "user" and result.resolved.period.source == "user"
    assert all(f.scope == "query" for f in result.evidence_families)


def test_P04_fill_with_nothing_blank_returns_the_user_values(rig):
    fill = rig.presets.fill(rig.plan, C.UserConstraints(phenomenon_query=ps.QUERY, region_id="reg-a",
                                                         period=USER_PERIOD), None)
    assert fill.status == "not_needed" and fill.preset is None
    assert fill.region_id == "reg-a" and fill.period == USER_PERIOD


@pytest.mark.parametrize("region_id", ["reg-n", "hex-t1", "reg-e"])
def test_P05_region_without_usable_series_gets_no_period_and_is_not_replaced(rig, region_id):
    result = rig.run(region_id=region_id)
    resolved = result.resolved
    assert resolved.preset_status == "no_matching_preset" and resolved.preset_missing == ["period"]
    assert resolved.region.id == region_id and resolved.region.source == "user"       # no parent, no neighbour
    assert resolved.period is None and resolved.preset is None
    assert resolved.preset_reason and region_id in resolved.preset_reason
    assert result.user_constraints.region_id == region_id
    assert any(w.code == "no_matching_preset" for w in result.warnings)
    assert all(v.trend is None for v in result.variables)


def test_P05_period_without_data_gets_no_region_and_is_not_stretched(rig):
    period = C.Period(start="1950-01", end="1959-12")
    result = rig.run(period=period)
    resolved = result.resolved
    assert resolved.preset_status == "no_matching_preset" and resolved.preset_missing == ["region_id"]
    assert (resolved.period.start, resolved.period.end, resolved.period.source) == ("1950-01", "1959-12", "user")
    assert resolved.region is None and "1950-01..1959-12" in resolved.preset_reason
    fill = rig.presets.fill(rig.plan, C.UserConstraints(phenomenon_query=ps.QUERY, period=period), None)
    assert fill.status == "no_matching_preset" and fill.missing == ["region_id"] and fill.period == period
    record = rig.storage.load_document("preset_searches", fill.search_id)
    assert record["complete"] and record["presets"] == []
    assert all(c["status"] == "excluded" and c["reason"] for c in record["candidates"])


# --------------------------------------------------------------------------- P06 + section 7: manual settings

def manual_rig(tmp_path, adjustments, name="manual", version="t-manual-2"):
    return Rig(tmp_path / name, tmp_path / f"{name}-var", manual=adjustments, manual_version=version)


def test_P06_pinned_preset_that_conflicts_with_the_user_region_is_not_applied(tmp_path):
    pin = {"adjustment_id": "t-pin-c", "action": "pin", "reason": "TEST pin", "region_id": "reg-c"}
    rig = manual_rig(tmp_path, [pin])
    blank = rig.run()
    assert blank.resolved.region.id == "reg-c" and blank.resolved.preset.pinned         # applies when nothing conflicts
    assert "t-pin-c" in blank.resolved.preset.manual_adjustment_ids
    result = rig.run(region_id="reg-f")
    assert result.resolved.region.id == "reg-f" and result.resolved.region.source == "user"
    assert result.resolved.preset.region_id == "reg-f" and not result.resolved.preset.pinned
    record = rig.storage.load_document("preset_searches", result.resolved.preset.search_id)
    skipped = {a["adjustment_id"]: a["why"] for a in record["manual"]["not_applied"]}
    assert "never overrides" in skipped["t-pin-c"] and record["manual"]["applied"] == []


def test_P06_manual_period_that_conflicts_with_the_user_period_is_not_applied(tmp_path):
    add = {"adjustment_id": "t-add", "action": "add", "reason": "TEST add", "region_id": "reg-a",
           "period": {"start": "1990-06", "end": "2009-05"}}
    rig = manual_rig(tmp_path, [add, {"adjustment_id": "t-pin", "action": "pin", "reason": "TEST pin",
                                      "region_id": "reg-a", "period": {"start": "1990-06", "end": "2009-05"}}])
    result = rig.run(period=USER_PERIOD)
    assert (result.resolved.period.start, result.resolved.period.end) == (USER_PERIOD.start, USER_PERIOD.end)
    record = rig.storage.load_document("preset_searches", result.resolved.preset.search_id)
    assert {a["adjustment_id"] for a in record["manual"]["not_applied"]} == {"t-add", "t-pin"}
    assert all(c["kind"] == "user_period" for c in record["candidates"])


def test_section7_manual_add_pin_priority_disable_change_the_list_not_the_numbers(tmp_path):
    auto = Rig(tmp_path / "auto", tmp_path / "auto-var").search()
    top = auto.presets[0]
    added_period = {"start": "1990-06", "end": "2009-05"}
    adjustments = [
        {"adjustment_id": "t-add", "action": "add", "reason": "TEST add", "region_id": "reg-f", "period": added_period},
        {"adjustment_id": "t-pin", "action": "pin", "reason": "TEST pin", "region_id": "reg-f",
         "period": {"start": "1992-01", "end": "2021-12"}},
        {"adjustment_id": "t-prio", "action": "priority", "reason": "TEST priority", "priority": 1,
         "region_id": "reg-c", "period": {"start": "1988-01", "end": "2021-12"}},
        {"adjustment_id": "t-off", "action": "disable", "reason": "TEST disable", "preset_id": top.preset_id},
        {"adjustment_id": "t-bad", "action": "add", "reason": "TEST invalid candidate", "region_id": "reg-n",
         "period": added_period},
        {"adjustment_id": "t-other", "action": "pin", "reason": "TEST other phenomenon", "region_id": "reg-a",
         "phenomenon_id": "t_phen2"},
    ]
    rig = manual_rig(tmp_path, adjustments)
    out = rig.search()
    by_key = {(p.region_id, p.period.start, p.period.end): p for p in out.presets}
    order = [(p.region_id, p.period.start, p.period.end) for p in out.presets]
    # pin first, then manual priority, then score
    assert order[0] == ("reg-f", "1992-01", "2021-12") and out.presets[0].pinned
    assert order[1] == ("reg-c", "1988-01", "2021-12") and not out.presets[1].pinned
    assert [p.rank for p in out.presets] == list(range(1, len(out.presets) + 1))
    # the added candidate is a preset of source "manual", analysed like any other and part of the family
    added = by_key[("reg-f", "1990-06", "2009-05")]
    assert added.source == "manual" and added.manual_note.startswith("add: TEST add") and added.period_kind == "manual"
    family = rig.storage.load_family(out.family_id)
    ids = {h.hypothesis_id for h in family.hypotheses}
    assert {v["hypothesis_id"] for v in added.variable_facts} <= ids
    # disabled: never recommended, still analysed and still in the family
    assert top.preset_id not in {p.preset_id for p in out.presets}
    assert {v["hypothesis_id"] for v in top.variable_facts} <= ids
    row = next(c for c in out.record["candidates"]
               if (c["region_id"], c["period"]["start"], c["period"]["end"]) ==
               (top.region_id, top.period.start, top.period.end))
    assert row["status"] == "analysed" and row["disabled_by"] == ["t-off"] and row["score"] == top.score.total
    # an invalid manual candidate stays invalid; an entry for another phenomenon does not apply
    skipped = {a["adjustment_id"]: a["why"] for a in out.record["manual"]["not_applied"]}
    assert "cannot make an invalid" in skipped["t-bad"] and "t_phen2" in skipped["t-other"]
    assert ("reg-n", "1990-06", "2009-05") not in by_key
    # numbers, validity and labels of every automatic candidate are untouched by the manual settings
    auto_rows = {(c["region_id"], c["period"]["start"], c["period"]["end"]): c for c in auto.record["candidates"]}
    for c in out.record["candidates"]:
        key = (c["region_id"], c["period"]["start"], c["period"]["end"])
        if key in auto_rows:
            assert (c["status"], c.get("score"), c.get("components")) == \
                (auto_rows[key]["status"], auto_rows[key].get("score"), auto_rows[key].get("components"))
    pinned = out.presets[0]
    same = next(p for p in Rig(tmp_path / "auto", tmp_path / "auto-var2").search().presets
                if (p.region_id, p.period) == (pinned.region_id, pinned.period)) \
        if any((p.region_id, p.period) == (pinned.region_id, pinned.period) for p in auto.presets) else None
    if same is not None:
        assert same.score == pinned.score
    # a manual change is a new preset version (same stable preset id)
    shared = {p.preset_id: p.version for p in auto.presets}
    assert all(shared[p.preset_id] != p.version for p in out.presets if p.preset_id in shared)


def test_section7_manual_settings_cannot_turn_not_significant_into_significant(tmp_path):
    auto = Rig(tmp_path / "auto", tmp_path / "auto-var").search(region_id="reg-f")
    target = next(p for p in auto.presets if p.evidence["label"] == "none_significant")
    pin = {"adjustment_id": "t-pin", "action": "pin", "reason": "TEST pin", "region_id": "reg-f",
           "period": {"start": target.period.start, "end": target.period.end}}
    out = manual_rig(tmp_path, [pin]).search(region_id="reg-f")
    pinned = out.presets[0]
    assert pinned.pinned and pinned.preset_id == target.preset_id
    assert pinned.evidence == target.evidence and pinned.score == target.score
    assert [(v["significance_label"], v["p_raw"], v["p_adjusted"]) for v in pinned.variable_facts] == \
        [(v["significance_label"], v["p_raw"], v["p_adjusted"]) for v in target.variable_facts]


def test_section7_disabling_every_candidate_is_no_matching_preset_with_the_reason(tmp_path):
    rig = manual_rig(tmp_path, [{"adjustment_id": "t-off-f", "action": "disable", "reason": "TEST disable",
                                 "region_id": "reg-f"}])
    fill = rig.presets.fill(rig.plan, C.UserConstraints(phenomenon_query=ps.QUERY, region_id="reg-f"), None)
    assert fill.status == "no_matching_preset" and fill.missing == ["period"] and "t-off-f" in fill.reason
    assert fill.region_id == "reg-f"


# --------------------------------------------------------------------------- P07: field sources

def test_P07_new_phenomenon_keeps_user_fields_and_re_recommends_preset_fields(rig):
    first = rig.run(region_id="reg-f")
    kept = PresetEngine.user_fields(first)
    assert kept == {"region_id": "reg-f", "period": None}                      # the preset period is not a user value
    second = rig.run(phenomenon_query=ps.QUERY_2, region_id=kept["region_id"], period=kept["period"],
                     context=C.RequestContext(parent_research_id=first.identity.research_id))
    assert second.selection.selection_plan_id == rig.plan2.selection_plan_id
    assert second.resolved.region.id == "reg-f" and second.resolved.region.source == "user"
    assert second.resolved.period.source == "preset" and second.resolved.preset_status == "applied"
    assert second.resolved.preset.selection_plan_id == rig.plan2.selection_plan_id
    assert second.resolved.preset.search_id != first.resolved.preset.search_id   # recommended again for the new plan
    both_preset = PresetEngine.user_fields(rig.run())
    assert both_preset == {"region_id": None, "period": None}
    both_user = PresetEngine.user_fields(rig.run(region_id="reg-a", period=USER_PERIOD))
    assert both_user == {"region_id": "reg-a", "period": {"start": USER_PERIOD.start, "end": USER_PERIOD.end}}


# --------------------------------------------------------------------------- P08 + section 7: determinism, cache

def summary(outcome):
    return [(p.preset_id, p.version, p.rank, p.region_id, p.period.start, p.period.end, p.score.total)
            for p in outcome.presets]


def test_P08_same_data_policy_and_plan_give_the_same_presets_order_and_ids(tmp_path):
    one = Rig(tmp_path / "r1", tmp_path / "v1").search()
    two = Rig(tmp_path / "r2", tmp_path / "v2").search()
    assert summary(one) == summary(two) and one.family_id == two.family_id and one.search_id == two.search_id
    assert [p.model_dump(mode="json") for p in one.presets] == [p.model_dump(mode="json") for p in two.presets]
    listing = lambda o: [(c["region_id"], c["period"], c["status"], c.get("score")) for c in o.record["candidates"]]
    assert listing(one) == listing(two)
    # the order follows the registered tie-break: score desc, region_id asc, period.start asc
    keys = [(-p.score.total, p.region_id, p.period.start, p.period.end) for p in one.presets]
    assert keys == sorted(keys)


def test_P08_a_stored_complete_search_is_reused_from_disk_without_recomputation(rig, monkeypatch):
    first = rig.search()
    calls = []
    monkeypatch.setattr(service_module.BatchAnalyser, "analyse",
                        lambda self, *a, **k: calls.append(1) or (_ for _ in ()).throw(AssertionError("recomputed")))
    again = rig.reopen().search()                               # new engine objects, same storage and snapshot
    assert again.from_cache and not calls
    assert summary(again) == summary(first) and again.family_id == first.family_id
    fill = rig.presets.fill(rig.plan, C.UserConstraints(phenomenon_query=ps.QUERY), None)
    assert fill.status == "applied" and fill.family.family_id == first.family_id
    assert len(fill.family.hypotheses) == fill.family.n_candidates              # the FULL family, read back


def test_P08_engine_results_with_presets_are_reproducible(rig):
    a, b = rig.run(), rig.run()
    assert a.selection.selection_plan_id == b.selection.selection_plan_id
    assert a.resolved.preset.model_dump() == b.resolved.preset.model_dump()
    assert [(v.trend.hypothesis_id, v.trend.slope_per_decade, v.trend.p_raw, v.trend.p_adjusted) for v in a.variables] \
        == [(v.trend.hypothesis_id, v.trend.slope_per_decade, v.trend.p_raw, v.trend.p_adjusted) for v in b.variables]


def test_section7_cache_key_separates_plans_and_user_constraints(rig):
    keys = {rig.presets.search_key(rig.plan, None, None), rig.presets.search_key(rig.plan, "reg-a", None),
            rig.presets.search_key(rig.plan, None, USER_PERIOD), rig.presets.search_key(rig.plan2, None, None)}
    assert len(keys) == 4


# --------------------------------------------------------------------------- P09 / T11: opening a preset

def test_P09_T11_opened_preset_restores_sources_plan_and_original_search_family(rig):
    applied = rig.run()
    preset = applied.resolved.preset
    ref = C.PresetRef(id=preset.preset_id, version=preset.version)
    rig.reopen()                                                # a later session: only the stored records
    rig.selector.by_id.clear()                                  # the selector lost the plan: the stored snapshot is used
    opened = rig.run(context=C.RequestContext(preset_ref=ref))
    assert opened.resolved.preset_status == "opened"
    assert opened.resolved.region.source == "preset" and opened.resolved.period.source == "preset"
    assert (opened.resolved.region.id, opened.resolved.period.start, opened.resolved.period.end) == \
        (preset.region_id, preset.period.start, preset.period.end)
    assert opened.resolved.preset.version == preset.version
    assert opened.selection.selection_plan_id == preset.selection_plan_id and opened.selection.reused
    family = search_family(opened)
    assert family.family_id == preset.family_id and family.complete
    query = next(f for f in opened.evidence_families if f.scope == "query")
    for v in opened.variables:
        # T11: the search family stays the primary evidence; the smaller query family does not replace it
        assert v.trend.primary_family_id == preset.family_id
        assert set(v.trend.p_adjusted) == {preset.family_id, query.family_id}
        assert v.trend.p_adjusted[preset.family_id] >= v.trend.p_adjusted[query.family_id]
        stored = next(h for h in rig.storage.load_family(preset.family_id).hypotheses
                      if h.hypothesis_id == v.trend.hypothesis_id)
        assert v.trend.p_adjusted[preset.family_id] == stored.p_adjusted
        assert v.trend.p_raw == pytest.approx(stored.p_raw, rel=1e-9)
        assert v.trend.significant == stored.significant
    assert family.n_candidates > query.n_candidates


def test_P09_conflicting_preset_reference_never_overrides_user_fields(rig):
    preset = rig.run().resolved.preset
    ref = C.PresetRef(id=preset.preset_id, version=preset.version)
    other_region = next(r for r in ("reg-a", "reg-f") if r != preset.region_id)
    with pytest.raises(AquaError) as region_error:
        rig.run(region_id=other_region, context=C.RequestContext(preset_ref=ref))
    assert region_error.value.code == "invalid_context" and "region_id" in region_error.value.fields
    with pytest.raises(AquaError) as period_error:
        rig.run(period=USER_PERIOD, context=C.RequestContext(preset_ref=ref))
    assert period_error.value.code == "invalid_context" and "period" in period_error.value.fields
    with pytest.raises(AquaError) as direct:
        rig.presets.open(ref, C.UserConstraints(phenomenon_query=ps.QUERY, region_id=other_region))
    assert direct.value.code == "invalid_context"
    same = rig.run(region_id=preset.region_id, context=C.RequestContext(preset_ref=ref))   # a matching user field is fine
    assert same.resolved.region.source == "user" and same.resolved.period.source == "preset"
    with pytest.raises(AquaError) as unknown:
        rig.presets.open(C.PresetRef(id="ps-doesnotexist", version="v-1"))
    assert unknown.value.code == "invalid_context"


def test_P09_adjusting_after_opening_keeps_history_and_recommends_only_the_blank(rig):
    applied = rig.run()
    preset = applied.resolved.preset
    opened = rig.run(context=C.RequestContext(preset_ref=C.PresetRef(id=preset.preset_id, version=preset.version)))
    # the user now picks a period on the time series; the region was a preset value and stays blank
    adjusted = rig.run(period=USER_PERIOD, context=C.RequestContext(parent_research_id=opened.identity.research_id))
    assert adjusted.identity.parent_research_id == opened.identity.research_id
    assert adjusted.selection.selection_plan_id == opened.selection.selection_plan_id      # replay of the saved plan
    assert adjusted.resolved.period.source == "user" and adjusted.resolved.region.source == "preset"
    new_family = search_family(adjusted)
    assert new_family.family_id != preset.family_id                           # other hypotheses: other evidence
    for v in adjusted.variables:
        assert preset.family_id not in v.trend.p_adjusted                     # the old correction is not re-used
        assert v.trend.primary_family_id == new_family.family_id


def test_P09_open_is_cheap_and_does_not_read_the_family(rig, monkeypatch):
    preset = rig.run().resolved.preset
    rig.reopen()
    monkeypatch.setattr(rig.storage, "load_family",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("family read at open")))
    got = rig.presets.open(C.PresetRef(id=preset.preset_id, version=preset.version))
    assert got.status == "opened" and got.preset.version == preset.version and not got.stale
    assert got.plan.selection_plan_id == preset.selection_plan_id


# --------------------------------------------------------------------------- T09 / T10: the search family

def test_T09_search_family_holds_every_hypothesis_of_every_analysed_candidate(rig):
    out = rig.search()
    family = rig.storage.load_family(out.family_id)
    analysed = [c for c in out.record["candidates"] if c["status"] == "analysed"]
    assert family.scope == "preset_search" and family.complete and family.method == "benjamini_yekutieli"
    assert family.n_candidates == len(family.hypotheses) == 2 * len(analysed)      # 2 variables per candidate
    covered = {(h.components["region_id"], h.components["analysis_period"]["start"],
                h.components["analysis_period"]["end"]) for h in family.hypotheses}
    assert covered == {(c["region_id"], c["period"]["start"], c["period"]["end"]) for c in analysed}
    tested = [h for h in family.hypotheses if h.tested]
    untested = [h for h in family.hypotheses if not h.tested]
    assert tested and untested and family.n_tested == len(tested) and family.n_untested == len(untested)
    assert all(h.untested_reason and h.p_raw is None and h.p_adjusted is None and h.significant is None
               for h in untested)
    # corrected as ONE family, including everything that is not significant and not selected
    expected = by_adjust(np.array([h.p_raw for h in tested]))
    assert [h.p_adjusted for h in tested] == pytest.approx(list(expected), rel=1e-12)
    assert any(h.significant is False for h in tested) and any(h.significant for h in tested)
    shown = {v["hypothesis_id"] for p in out.presets for v in p.variable_facts}
    assert {h.hypothesis_id for h in family.hypotheses} - shown                  # unselected ones stay in the family


def test_T09_results_carry_family_id_counts_policy_completeness_and_locator(rig):
    result = rig.run()
    family = search_family(result)
    assert family.external_ref == "family:" + family.family_id and family.content_hash
    assert (family.n_candidates, family.n_tested, family.n_untested) == \
        tuple(result.resolved.preset.family_counts[k] for k in ("n_candidates", "n_tested", "n_untested"))
    policy = family.candidate_policy
    assert policy["id"] == "preset_search" and policy["version"] == rig.store.versions["preset_policy_version"]
    assert policy["window_lengths_years"] == [10, 20, 30] and policy["window_step_years"] == 5
    assert policy["candidates_ref"] == "preset_searches/" + result.resolved.preset.search_id
    assert rig.storage.load_family(family.external_ref).content_hash == family.content_hash


def test_T10_candidate_policy_and_the_actual_search_list_are_stored_and_reproducible(rig):
    out = rig.search()
    record = rig.storage.load_document("preset_searches", out.search_id)
    assert record["complete"] is True and record["status"] == "complete"
    assert record["policy"] == rig.store.policy("preset_policy")
    assert record["window_rule"] == {"lengths_years": [10, 20, 30], "step_years": 5,
                                     "alignment": rig.store.policy("preset_policy")["window_alignment"],
                                     "full_common_period": True, "user_period_only": False,
                                     "user_region_only": False}
    excluded = {r["region_id"]: r["reason"] for r in record["regions"]["excluded"]}
    assert set(excluded) == {"reg-n", "reg-e"} and all(excluded.values())      # hex and basin4 are not searched at all
    assert "hex-t1" not in record["regions"]["considered"] and "reg-b" not in record["regions"]["considered"]
    # the list is the declared rule applied to data availability: 10 windows for each 34-year TEST record
    per_region = {}
    for c in record["candidates"]:
        per_region.setdefault(c["region_id"], []).append((c["period"]["start"], c["period"]["end"], c["kind"]))
    expected = [("1988-01", "2021-12", "full_common_period")]
    expected += [(f"{y}-01", f"{y + 9}-12", "window_10y") for y in (2012, 2007, 2002, 1997, 1992)]
    expected += [(f"{y}-01", f"{y + 19}-12", "window_20y") for y in (2002, 1997, 1992)]
    expected += [("1992-01", "2021-12", "window_30y")]
    assert per_region == {r: expected for r in ("reg-a", "reg-c", "reg-f", "reg-g")}
    family = rig.storage.load_family(out.family_id)
    assert family.candidate_policy["n_candidates_declared"] == len(record["candidates"]) == 40
    assert family.candidate_policy["search_id"] == out.search_id


def test_T10_excluded_candidates_stay_in_the_record_with_reasons(rig):
    out = rig.search(period=C.Period(start="1988-01", end="1990-12"))          # 3 TEST years: baseline ok, short window
    rows = {c["region_id"]: c for c in out.record["candidates"]}
    assert rows["reg-e"]["status"] == "excluded" and "support a trend" in rows["reg-e"]["reason"]
    assert out.record["counts"]["candidates_excluded"] >= 1
    assert all("score" not in c for c in out.record["candidates"] if c["status"] == "excluded")


def test_T10_cancelled_search_is_never_complete_and_publishes_nothing(rig):
    seen = []

    def cancel():
        seen.append(1)
        return len(seen) > 10                                    # stop in the middle of the candidate list

    with pytest.raises(AquaError) as error:
        rig.presets.search(rig.plan, C.UserConstraints(phenomenon_query=ps.QUERY), cancel=cancel)
    assert error.value.code == "cancelled"
    key = rig.presets.search_key(rig.plan, None, None)
    record = rig.storage.load_document("preset_searches", key)
    assert record["complete"] is False and record["status"] == "cancelled"
    assert record["presets"] == [] and record["family"] is None
    assert rig.storage.list_presets() == [] and not (rig.var / "families").exists()
    assert rig.presets._cached(key) is None                      # a partial record is never served as a search
    done = rig.search()                                          # the next request computes the whole batch
    assert done.complete and not done.from_cache and done.presets
    assert rig.storage.load_document("preset_searches", key)["complete"] is True
    assert all(p.search_complete for p in done.presets)


def test_T10_cancel_event_before_the_search_starts(rig):
    event = threading.Event()
    event.set()
    with pytest.raises(AquaError) as error:
        rig.presets.fill(rig.plan, C.UserConstraints(phenomenon_query=ps.QUERY), None, cancel=event)
    assert error.value.code == "cancelled"


# --------------------------------------------------------------------------- T16: version changes

def changed_data_rig(rig: Rig, tmp_path) -> Rig:
    """The same TEST release with OTHER TEST numbers in one series (a new dataset version), same storage."""
    override = {"reg-a": {"t_soil": ps.test_series(ps.N_MONTHS, 110.0, -0.02, 5.0, 2.0, 99)}}
    return Rig(tmp_path / "release-v2", rig.var, series_override=override)


def test_T16_new_data_version_builds_new_evidence_and_keeps_the_old_record(rig, tmp_path):
    old_result = rig.run(region_id="reg-a")
    old = old_result.resolved.preset
    old_family = rig.storage.load_family(old.family_id)
    ref = C.PresetRef(id=old.preset_id, version=old.version)

    new = changed_data_rig(rig, tmp_path)
    assert new.store.versions["dataset_version"] != rig.store.versions["dataset_version"]
    cheap = new.presets.open(ref)
    assert cheap.stale and cheap.family is None                 # the old correction is not offered for new numbers
    result = new.run(context=C.RequestContext(preset_ref=ref))
    rebuilt = result.resolved.preset
    assert result.resolved.preset_status == "opened"
    assert (rebuilt.preset_id, rebuilt.region_id, rebuilt.period) == (old.preset_id, old.region_id, old.period)
    assert rebuilt.version != old.version and rebuilt.family_id != old.family_id
    assert rebuilt.dataset_version == new.store.versions["dataset_version"]
    assert rebuilt.supersedes["version"] == old.version and rebuilt.supersedes["family_id"] == old.family_id
    assert result.identity.preset_ref.version == old.version    # the request's reference is kept as history
    new_family = search_family(result)
    assert new_family.family_id == rebuilt.family_id
    old_ids = {h.hypothesis_id for h in old_family.hypotheses}
    for v in result.variables:
        assert v.trend.hypothesis_id not in old_ids             # new data version: a new hypothesis
        assert old.family_id not in v.trend.p_adjusted          # the old correction is not attached
        assert v.trend.primary_family_id == rebuilt.family_id
    assert all(f.family_id != old.family_id for f in result.evidence_families)
    # history: the old preset version and its family are still stored, unchanged
    assert new.storage.load_preset(old.preset_id, old.version).model_dump() == old.model_dump()
    assert new.storage.load_family(old.family_id).content_hash == old_family.content_hash
    assert set(new.storage.preset_versions(old.preset_id)) >= {old.version, rebuilt.version}


def test_T16_policy_change_is_a_new_search_and_a_new_preset_version(rig):
    old = rig.search()
    ps.set_policy(rig.dirs[0], "method_policy", version="method-TEST-2", alpha=0.01)
    rig.reopen()
    new = rig.search()
    assert not new.from_cache and new.search_id != old.search_id and new.family_id != old.family_id
    assert rig.storage.load_family(new.family_id).alpha == 0.01
    shared = {p.preset_id: p.version for p in old.presets}
    assert all(shared[p.preset_id] != p.version for p in new.presets if p.preset_id in shared)
    old_ids = {h.hypothesis_id for h in rig.storage.load_family(old.family_id).hypotheses}
    assert not old_ids & {h.hypothesis_id for h in rig.storage.load_family(new.family_id).hypotheses}


def test_T16_candidate_that_no_longer_qualifies_keeps_only_history(rig, tmp_path):
    old = rig.run(region_id="reg-c").resolved.preset
    ref = C.PresetRef(id=old.preset_id, version=old.version)
    gone = Rig(tmp_path / "release-v3", rig.var,
               series_override={"reg-c": {"t_precip_b": [None] * ps.N_MONTHS}})
    got = gone.presets.open_for_run(ref)
    assert got.stale and got.family is None and got.preset.version == old.version
    assert "no longer qualify" in got.reason and "kept as history" in got.reason
    result = gone.run(context=C.RequestContext(preset_ref=ref))
    assert all(f.scope == "query" for f in result.evidence_families)
    assert all(v.trend is None or old.family_id not in v.trend.p_adjusted for v in result.variables)


def test_unbound_preset_engine_uses_the_same_analysis(tmp_path):
    rig = Rig(tmp_path / "r", tmp_path / "v")
    alone = PresetEngine(rig.store, storage=ResearchStorage(tmp_path / "alone"))
    assert summary(alone.search(rig.plan, C.UserConstraints(phenomenon_query=ps.QUERY))) == summary(rig.search())
    assert preset_id_for(rig.plan, "reg-a", USER_PERIOD) != preset_id_for(rig.plan2, "reg-a", USER_PERIOD)
