"""TEST helpers for the engine / resolver / presenter tests. Nothing here is a scientific result."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Optional

BACKEND = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "tests" / "fixtures" / "store"))

import store_support as fx  # noqa: E402

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.errors import AquaError  # noqa: E402

DATA = BACKEND.parent / "web" / "public" / "data"
TAIWAN = "named-taiwan-main-island"


def make_plan(store: Any, query: str, variables: list[tuple[str, str]], recipes: list[str] | None = None, *,
              phenomenon_id: Optional[str] = None, status: str = "ok", unanswerable: list[str] | None = None,
              ignored: list[str] | None = None) -> C.SelectionPlan:
    """A scripted TEST plan: explicit (variable_id, role) pairs and recipe ids."""
    fields: dict[str, Any] = {
        "phenomenon_query": query, "normalized_query": " ".join(query.split()).casefold(),
        "phenomenon_label": query, "status": status,
        "variable_set": [{"variable_id": v, "role": r, "reason": f"TEST reason for {v}",
                          "catalogue_refs": [phenomenon_id] if phenomenon_id else []} for v, r in variables],
        "indicator_recipe_ids": list(recipes or []), "unanswerable": list(unanswerable or []),
        "ignored_text_constraints": list(ignored or []),
        "catalogue_version": store.versions["catalogue_version"],
        "indicator_registry_version": store.versions["indicator_registry_version"],
        "selector": {"provider": "test_scripted", "model": None, "prompt_version": "test", "is_language_model": False},
    }
    digest = hashlib.sha256(json.dumps(fields, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return C.SelectionPlan(selection_plan_id="sp_" + digest[:32], content_hash=digest,
                           created_at="2000-01-01T00:00:00+00:00", **fields)


class FakeSelector:
    """Scripted selector: returns the plan registered for a query and counts model 'calls'."""

    def __init__(self, *plans: C.SelectionPlan) -> None:
        self.by_query = {p.normalized_query: p for p in plans}
        self.by_id = {p.selection_plan_id: p for p in plans}
        self.select_calls = 0
        self.load_calls = 0

    def add(self, plan: C.SelectionPlan) -> C.SelectionPlan:
        self.by_query[plan.normalized_query] = plan
        self.by_id[plan.selection_plan_id] = plan
        return plan

    def select(self, query: str, *, reselect: bool = False) -> C.SelectionPlan:
        if not isinstance(query, str) or not query.strip():
            raise AquaError("empty_query", "Describe a phenomenon to analyse.", fields=["phenomenon_query"])
        self.select_calls += 1
        key = " ".join(query.split()).casefold()
        if key not in self.by_query:
            raise AquaError("selector_unavailable", "TEST selector has no scripted plan for this text.", retryable=True)
        return self.by_query[key]

    def load(self, selection_plan_id: str) -> C.SelectionPlan:
        self.load_calls += 1
        if selection_plan_id not in self.by_id:
            raise AquaError("not_found", "Unknown selection plan id.", fields=["selection_plan_id"])
        return self.by_id[selection_plan_id]


class FakePresetEngine:
    """Scripted preset engine: returns the queued fill object and records what it was asked."""

    def __init__(self, fill: Any) -> None:
        self._fill = fill
        self.calls: list[tuple[Any, Any, Any]] = []

    def fill(self, plan: Any, user_constraints: Any, context: Any) -> Any:
        self.calls.append((plan, user_constraints, context))
        return self._fill(plan, user_constraints, context) if callable(self._fill) else self._fill


def _wave(n: int, base: float, step: float, season: float) -> list[float]:
    """TEST numbers: a line plus a fixed 12-month pattern (deterministic, arbitrary)."""
    pattern = [0.0, 0.4, 0.9, 1.0, 0.7, 0.2, -0.3, -0.8, -1.0, -0.7, -0.4, -0.1]
    wiggle = [0.13, -0.07, 0.02, -0.11, 0.09, -0.04, 0.06]
    return [round(base + step * i + season * pattern[i % 12] + wiggle[i % 7], 6) for i in range(n)]


def build_engine_release(root: Path) -> tuple[Path, Path, Path]:
    """The TEST release of tests/fixtures/store with series long enough for baselines and fits.

    reg-a: t_precip_a 2000-01..2003-12 (2000-03 missing, 2000-04 an exact zero), t_precip_b, t_soil
    reg-c: t_precip_b only, complete 2001-01..2003-12 (so the primary t_precip_a is "not prepared")
    reg-d: t_precip_b starting 2002-03 only (the fixed baseline 2001-2003 is not supported)
    reg-b / hex-t1: a boundary but no series
    """
    cat, data, cache = fx.build_release(root)
    a = _wave(48, 3.0, 0.02, 1.0)
    a[2], a[3] = None, 0.0
    index = fx.read(data / "catalog" / "series_index.json")
    index["regions"]["reg-d"] = ["t_precip_b"]
    fx.write(data / "catalog" / "series_index.json", index)
    regions = fx.read(data / "catalog" / "regions.json")
    regions["regions"].append({"id": "reg-d", "type": "named", "name": "Test region D", "surface": "land",
                               "area_km2": 4, "centroid": [7.0, 8.0]})
    fx.write(data / "catalog" / "regions.json", regions)
    geo = fx.read(data / "geo" / "named.geojson")
    geo["features"].append({"type": "Feature", "properties": {"id": "reg-d", "name": "reg-d"},
                            "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]]}})
    fx.write(data / "geo" / "named.geojson", geo)
    fx.write(data / "series" / "reg-a.json", {"id": "reg-a", "version": "series-2", "layers": {
        "t_precip_a": {"start": "2000-01", "values": a},
        "t_precip_b": {"start": "2001-01", "values": _wave(36, 2.0, -0.01, 0.5)},
        "t_soil": {"start": "2000-01", "values": _wave(48, 110.0, 0.3, 5.0)},
        "t_daily": {"start": "2000-01", "values": [1.0] * 48},
        "t_kelvin": {"start": "2000-01", "values": _wave(48, 280.0, 0.01, 3.0)}}})
    fx.write(data / "series" / "reg-c.json", {"id": "reg-c", "version": "series-2", "layers": {
        "t_precip_b": {"start": "2001-01", "values": _wave(36, 0.5, 0.01, 0.2)}}})
    fx.write(data / "series" / "reg-d.json", {"id": "reg-d", "version": "series-2", "layers": {
        "t_precip_b": {"start": "2002-03", "values": _wave(22, 0.5, 0.01, 0.2)}}})
    return cat, data, cache


def walk_numbers(node: Any, path: str = "$"):
    """Yield (path, value) for every float in a JSON-like document."""
    if isinstance(node, float):
        yield path, node
    elif isinstance(node, dict):
        for key, value in node.items():
            yield from walk_numbers(value, f"{path}.{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            yield from walk_numbers(value, f"{path}[{i}]")
