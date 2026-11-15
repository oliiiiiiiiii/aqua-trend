"""ResultPresenter exports (data contract §9.4): the CSV and the JSON are the same snapshot.

Uses the prepared series (``realdata``) for a full result and the TEST release for edge cases.
"""
from __future__ import annotations

import csv
import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures" / "engine"))

import engine_support as es  # noqa: E402

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.engine import ResearchEngine  # noqa: E402
from aqua_trend.present import CSV_COLUMNS, ResultPresenter  # noqa: E402
from aqua_trend.store import PreparedDataStore  # noqa: E402


def parse_csv(text: str) -> tuple[dict[str, list[str]], list[dict[str, str]]]:
    """(metadata lines grouped by key, data rows) of an export."""
    meta: dict[str, list[str]] = {}
    body = []
    for line in text.splitlines():
        if line.startswith("# "):
            key, _, value = line[2:].partition(": ")
            meta.setdefault(key, []).append(value)
        else:
            body.append(line)
    return meta, list(csv.DictReader(io.StringIO("\n".join(body))))


@pytest.fixture(scope="module")
def real_result():
    if not (es.DATA / "series" / f"{es.TAIWAN}.json").exists():
        pytest.skip("prepared series not present")
    store = PreparedDataStore.open()
    plan = es.make_plan(store, "TEST drought plan",
                        [("precip", "core_indicator"), ("tws_anomaly", "response"), ("tair", "related_condition")],
                        ["spi3"], phenomenon_id="drought")
    engine = ResearchEngine(store, es.FakeSelector(plan))
    return engine.run(C.ResearchRequest(phenomenon_query="TEST drought plan", region_id=es.TAIWAN,
                                        period=C.Period(start="2005-01", end="2024-12")))


@pytest.mark.realdata
def test_json_export_is_the_full_snapshot(real_result):
    presenter = ResultPresenter()
    doc = json.loads(presenter.export_json(real_result))
    assert doc == C.json_safe(real_result.model_dump(mode="json"))
    assert set(doc) >= {"identity", "user_constraints", "selection", "resolved", "comparison", "baselines",
                        "variables", "indicators", "evidence_families", "summary", "warnings"}
    assert C.ResearchResult.model_validate(doc).variables[0].trend == real_result.variables[0].trend


@pytest.mark.realdata
def test_csv_rows_carry_exactly_the_json_numbers(real_result):
    presenter = ResultPresenter()
    doc = json.loads(presenter.export_json(real_result))
    meta, rows = parse_csv(presenter.export_csv(real_result))
    assert tuple(rows[0].keys()) == CSV_COLUMNS
    expected = sum(len(v["series"]["times"]) for v in doc["variables"]) + sum(
        len(m["series"]["times"]) for i in doc["indicators"] for m in i["metrics"] if m.get("series"))
    assert len(rows) == expected

    def cell(value):
        return "" if value is None else json.dumps(value)

    for variable in doc["variables"]:
        mine = [r for r in rows if r["item_kind"] == "variable" and r["item_id"] == variable["variable_id"]]
        series, period = variable["series"], variable["analysis_period"]
        assert [r["time"] for r in mine] == series["times"]
        assert [r["raw"] for r in mine] == [cell(v) for v in series["raw"]]              # same text, no rounding
        assert [r["anomaly"] for r in mine] == [cell(v) for v in series["anomaly"]]
        assert [r["fit"] for r in mine] == [cell(v) for v in series["fit"]]
        assert [r["seasonal"] for r in mine] == [cell(series["seasonal_cycle"][int(t[5:7]) - 1]) for t in series["times"]]
        assert [r["inside_analysis_period"] for r in mine] == [
            "true" if period["start"] <= t <= period["end"] else "false" for t in series["times"]]
        assert {r["product_id"] for r in mine} == {variable["product"]["selected_product_id"]}
        assert {r["unit"] for r in mine} == {variable["unit"]} and {r["region_id"] for r in mine} == {es.TAIWAN}
        assert {r["research_id"] for r in mine} == {doc["identity"]["research_id"]}
        assert sum(r["fit"] != "" for r in mine) == 240
    tws = [r for r in rows if r["item_id"] == "tws_anomaly"]
    assert next(r for r in tws if r["time"] == "2017-09")["raw"] == ""                   # gap: empty, not zero
    spi = next(i for i in doc["indicators"] if i["indicator_id"] == "spi3")
    for metric in spi["metrics"]:
        mine = [r for r in rows if r["metric_id"] == metric["metric_id"]]
        assert [r["raw"] for r in mine] == [cell(v) for v in metric["series"]["raw"]]
        assert [r["fit"] for r in mine] == [cell(v) for v in metric["series"]["fit"]]
        assert {r["item_kind"] for r in mine} == {"derived_indicator"} and {r["product_id"] for r in mine} == {"p_gpcp"}
        assert [r["inside_analysis_period"] == "true" for r in mine] == metric["in_analysis"]
        assert {r["seasonal"] for r in mine} == {""} and {r["anomaly"] for r in mine} == {""}
    annual = [r for r in rows if r["metric_id"] == "spi3.drought_months_per_year"]
    assert {r["cadence"] for r in annual} == {"annual"} and "0.0" in {r["raw"] for r in annual}   # a true zero year
    assert not any(r["item_id"].startswith("recorded.") for r in rows)                   # data_required: no rows


@pytest.mark.realdata
def test_csv_header_carries_what_is_needed_to_reproduce(real_result):
    presenter = ResultPresenter()
    doc = json.loads(presenter.export_json(real_result))
    text = presenter.export_csv(real_result)
    meta, _ = parse_csv(text)
    assert meta["research_id"] == [doc["identity"]["research_id"]] and meta["status"] == [doc["identity"]["status"]]
    assert json.loads(meta["request"][0]) == doc["user_constraints"]
    assert json.loads(meta["selection_plan"][0]) == doc["selection"]
    identity = json.loads(meta["identity"][0])
    assert identity == doc["identity"] and identity["engine_version"] and identity["cache_key"]
    assert json.loads(meta["resolved_period"][0]) == {"start": "2005-01", "end": "2024-12", "source": "user"}
    variables = {v["variable_id"]: v for v in map(json.loads, meta["variable"])}
    for variable in doc["variables"]:
        line = variables[variable["variable_id"]]
        assert line["trend"] == variable["trend"]                                        # same numbers as the JSON
        assert line["product"]["selected_product_id"] == variable["product"]["selected_product_id"]
        assert line["baseline_id"] == variable["baseline_id"]
    assert variables["precip"]["product"]["fallback_reason"]
    indicators = {i["indicator_id"]: i for i in map(json.loads, meta["indicator"])}
    assert indicators["spi3"]["metrics"][0]["trend"] == doc["indicators"][0]["metrics"][0]["trend"]
    assert indicators["recorded.drought"]["status"] == "data_required"
    families = [json.loads(line) for line in meta["evidence_family"]]
    assert [f["family_id"] for f in families] == [f["family_id"] for f in doc["evidence_families"]]
    assert len(meta["baseline"]) == len(doc["baselines"]) and "pointwise" in meta["interval_scope"][0]
    assert "NaN" not in text and "Infinity" not in text
    assert all(line.startswith("# ") for line in text.splitlines()[:len(presenter.csv_header(real_result))])


def test_exports_of_a_result_without_series(tmp_path):
    store = PreparedDataStore.open(*es.build_engine_release(tmp_path / "release"))
    plan = es.make_plan(store, "TEST", [("t_precip", "core_indicator"), ("t_soil", "response")])
    engine = ResearchEngine(store, es.FakeSelector(plan))
    presenter = ResultPresenter()
    empty = engine.run(C.ResearchRequest(phenomenon_query="TEST", region_id="hex-t1",
                                         period=C.Period(start="2001-01", end="2003-12")))
    meta, rows = parse_csv(presenter.export_csv(empty))
    assert rows == [] and len(meta["variable"]) == 2
    assert all(json.loads(v)["status"] == "no_series" for v in meta["variable"])
    partial = engine.run(C.ResearchRequest(phenomenon_query="TEST", region_id="reg-a",
                                           period=C.Period(start="2000-01", end="2003-12")))
    _, rows = parse_csv(presenter.export_csv(partial))
    precip = [r for r in rows if r["item_id"] == "t_precip"]
    assert precip[2]["raw"] == "" and precip[3]["raw"] == "0.0"                          # missing vs zero
    assert json.loads(presenter.export_json(partial))["variables"][0]["series"]["raw"][2:4] == [None, 0.0]


def test_summary_wording_for_undetermined_and_unanswered(tmp_path):
    store = PreparedDataStore.open(*es.build_engine_release(tmp_path / "release"))
    plan = es.make_plan(store, "TEST", [("t_precip", "core_indicator"), ("t_soil", "response")])
    result = ResearchEngine(store, es.FakeSelector(plan)).run(
        C.ResearchRequest(phenomenon_query="TEST", region_id="reg-c", period=C.Period(start="2001-01", end="2003-12")))
    statements = ResultPresenter().summary(result).statements
    numeric = [s for s in statements if "per decade" in s.text]
    assert len(numeric) == 1 and numeric[0].evidence_ids == [result.variables[0].trend.hypothesis_id]
    assert "undetermined" in numeric[0].text and "a fallback product" in numeric[0].text
    assert "not significant at" not in numeric[0].text and "is significant" not in numeric[0].text
    unanswered = [s for s in statements if s.text.startswith("Not answered")]
    assert len(unanswered) == 2 and "no_series" in unanswered[0].text          # t_soil + the undelivered registry
    assert "indicator registry" in unanswered[1].text
    assert not any(word in " ".join(s.text for s in statements).lower()
                   for word in ("because of", "caused by", "leads to", "due to the"))
