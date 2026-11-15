"""Manual preset adjustments from ``catalogue/manual_presets.json`` (spec §8.3; acceptance P06, section 7).

Actions: ``add`` a candidate, ``pin`` it to the top, give it a ``priority`` (smaller = earlier),
``disable`` it — each with a reason.  What an adjustment can NOT do:

* change a number, a validity status or a significance label — an added candidate is analysed
  by the same code and enters the same search family, a disabled candidate stays in the family;
* make an invalid candidate valid — an added / pinned candidate must pass the same validity
  rule as an automatic one, otherwise it is listed as not applied;
* override a field the user filled — an adjustment that names another region or period than
  the user's is not applied to that request (P06).

The store validates ``version``, unique ``adjustment_id``, ``action`` and ``reason``; the rest
is validated here.  A malformed entry is reported and skipped, it never stops a search.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Sequence

from .. import contracts as C
from ..errors import AquaError
from ..resolve import period_bounds

ACTIONS = ("add", "pin", "priority", "disable")


@dataclass(frozen=True)
class Adjustment:
    adjustment_id: str
    action: str
    reason: str
    phenomenon_id: Optional[str] = None
    region_id: Optional[str] = None
    period: Optional[tuple[int, int]] = None
    preset_id: Optional[str] = None
    priority: Optional[float] = None
    author: Optional[str] = None

    def matches(self, region_id: str, start: int, end: int, preset_id: str) -> bool:
        """Every filter the adjustment states must match the candidate."""
        if self.region_id is not None and self.region_id != region_id:
            return False
        if self.period is not None and self.period != (start, end):
            return False
        if self.preset_id is not None and self.preset_id != preset_id:
            return False
        return True

    def describe(self) -> dict[str, Any]:
        return {"adjustment_id": self.adjustment_id, "action": self.action, "reason": self.reason,
                "author": self.author}


@dataclass
class ManualSettings:
    """Adjustments that apply to one request, and the ones that do not (with the reason)."""

    version: str
    applicable: list[Adjustment]
    not_applied: list[dict[str, Any]]

    def of(self, action: str) -> list[Adjustment]:
        return [a for a in self.applicable if a.action == action]

    def adds(self) -> list[tuple[str, C.Period, str]]:
        from ..timeaxis import index_to_ym
        return [(a.region_id, C.Period(start=index_to_ym(a.period[0]), end=index_to_ym(a.period[1])),
                 a.adjustment_id) for a in self.of("add")]


def _parse(entry: Any, regions: Any) -> Adjustment:
    """One registry entry -> ``Adjustment``; raises ``ValueError`` with the problem."""
    if not isinstance(entry, dict):
        raise ValueError("the entry is not a JSON object")
    action, reason = entry.get("action"), entry.get("reason")
    if action not in ACTIONS:
        raise ValueError(f"unknown action {action!r}")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("a reason is required")
    region_id = entry.get("region_id")
    if region_id is not None and region_id not in regions:
        raise ValueError(f"region {region_id!r} is not in the region catalogue")
    period = None
    if entry.get("period") is not None:
        try:
            period = period_bounds(entry["period"])
        except AquaError as exc:
            raise ValueError(f"invalid period: {exc.message}") from exc
    priority = entry.get("priority")
    if action == "add" and (region_id is None or period is None):
        raise ValueError("'add' needs a region_id and a period")
    if action == "priority" and (isinstance(priority, bool) or not isinstance(priority, (int, float))):
        raise ValueError("'priority' needs a numeric priority")
    if action != "add" and region_id is None and period is None and not entry.get("preset_id"):
        raise ValueError(f"'{action}' needs a region_id, a period or a preset_id to address a candidate")
    return Adjustment(
        adjustment_id=str(entry.get("adjustment_id")), action=action, reason=reason.strip(),
        phenomenon_id=entry.get("phenomenon_id"), region_id=region_id, period=period,
        preset_id=entry.get("preset_id"), priority=float(priority) if action == "priority" else None,
        author=entry.get("author"))


def load_settings(store: Any, plan_phenomena: Sequence[str], user_region_id: Optional[str],
                  user_period: Optional[C.Period]) -> ManualSettings:
    """Adjustments of the registry that may apply to this plan and these user constraints (P06)."""
    doc = store.manual_presets() or {}
    user_bounds = period_bounds(user_period)
    applicable: list[Adjustment] = []
    skipped: list[dict[str, Any]] = []
    regions = store.regions()
    for entry in doc.get("adjustments") or []:
        ident = entry.get("adjustment_id") if isinstance(entry, dict) else None
        try:
            adj = _parse(entry, regions)
        except ValueError as exc:
            skipped.append({"adjustment_id": ident, "why": f"invalid entry: {exc}"})
            continue
        if adj.phenomenon_id is not None and adj.phenomenon_id not in plan_phenomena:
            skipped.append({**adj.describe(), "why": f"registered for phenomenon {adj.phenomenon_id!r}, which this "
                                                     "selection plan does not refer to"})
            continue
        if user_region_id is not None and adj.region_id is not None and adj.region_id != user_region_id:
            skipped.append({**adj.describe(), "why": f"names region {adj.region_id}, but the user selected "
                                                     f"{user_region_id}; a manual setting never overrides a "
                                                     "condition the user filled in"})
            continue
        if user_bounds is not None and adj.period is not None and adj.period != user_bounds:
            skipped.append({**adj.describe(), "why": "names another period than the one the user selected; a "
                                                     "manual setting never overrides a condition the user filled in"})
            continue
        applicable.append(adj)
    return ManualSettings(version=str(doc.get("version", "not_delivered")), applicable=applicable,
                          not_applied=skipped)
