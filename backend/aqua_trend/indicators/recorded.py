"""Recorded-event aggregation (kind ``recorded_event``).

Spec §7.4, data contract §6 (RecordedEvent / EventCoverage), acceptance E02, E05, E06, E07,
E11, E12.  File formats: backend/catalogue/events/README.md.

Rules implemented (all registered in backend/catalogue/events/index.json ``aggregation_rule``)
- One approved catalogue per phenomenon / region / analysis.  Records of several catalogues
  are never concatenated.  ``canonical_event_id`` de-duplication is used only when the
  catalogue declares that the integration was prepared upstream.
- An event counts once for a region, in the calendar year of its start.
- Source time precision is kept.  A year- or month-precision record is an interval, never a
  made-up day: durations of coarse records are reported as bounds and are missing in sums.
- "No event" is zero only in years the coverage record declares ``complete``; partial or
  unknown coverage, known gaps and years cut by the coverage boundary are missing.
"""
from __future__ import annotations

import calendar
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import numpy as np

from ..errors import AquaError

PRECISIONS = ("year", "month", "day", "time")
_FORMATS = {
    "year": re.compile(r"^\d{4}$"),
    "month": re.compile(r"^\d{4}-(0[1-9]|1[0-2])$"),
    "day": re.compile(r"^\d{4}-\d{2}-\d{2}$"),
}


def _invalid(message: str) -> AquaError:
    return AquaError("data_release_invalid", f"event catalogue record invalid: {message}")


@dataclass(frozen=True)
class TimePoint:
    """An event end point at the precision the source recorded it.

    ``text`` is the verbatim source value.  ``earliest`` / ``latest`` are the inclusive
    calendar-day bounds implied by the precision (or given by the record's ``time_bounds``);
    they are bounds of an uncertainty interval, not an invented date.
    """

    text: str
    precision: str
    earliest: date
    latest: date

    @property
    def exact_day(self) -> bool:
        return self.earliest == self.latest


def parse_time(text: str, precision: str, bounds: dict[str, str] | None = None) -> TimePoint:
    """Parse a source time string without adding precision it does not have (E11)."""
    if precision not in PRECISIONS:
        raise _invalid(f"unknown time precision {precision!r}")
    if not isinstance(text, str):
        raise _invalid(f"time value {text!r} is not a string")
    try:
        if precision == "time":
            stamp = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if stamp.tzinfo is None:
                raise ValueError("exact times need a time zone")
            lo = hi = stamp.date()
        else:
            if not _FORMATS[precision].match(text):
                raise ValueError(f"does not have {precision} precision")
            parts = [int(p) for p in text.split("-")]
            if precision == "year":
                lo, hi = date(parts[0], 1, 1), date(parts[0], 12, 31)
            elif precision == "month":
                lo = date(parts[0], parts[1], 1)
                hi = date(parts[0], parts[1], calendar.monthrange(parts[0], parts[1])[1])
            else:
                lo = hi = date(*parts)
        if bounds:
            b_lo, b_hi = date.fromisoformat(bounds["earliest"]), date.fromisoformat(bounds["latest"])
            if b_lo > b_hi:
                raise ValueError("time_bounds earliest is after latest")
            lo, hi = b_lo, b_hi
    except (ValueError, KeyError, TypeError) as exc:
        raise _invalid(f"time {text!r} ({precision}): {exc}") from exc
    return TimePoint(text, precision, lo, hi)


def duration_days(start: TimePoint, end: TimePoint | None) -> tuple[int | None, tuple[int, int] | None]:
    """Duration in inclusive calendar days: (exact, (min, max)).

    Exact only when both ends are known to the day.  Coarser records get bounds from their
    uncertainty intervals and no exact value.  An event without an end has neither.
    """
    if end is None:
        return None, None
    lo = max(1, (end.earliest - start.latest).days + 1)
    hi = (end.latest - start.earliest).days + 1
    if hi < 1:
        raise _invalid(f"event ends ({end.text}) before it starts ({start.text})")
    if start.exact_day and end.exact_day:
        return hi, (hi, hi)
    return None, (lo, hi)


@dataclass(frozen=True)
class NormalisedEvent:
    key: str                         # de-duplication key
    record: dict[str, Any]
    start: TimePoint
    end: TimePoint | None
    start_year: int | None           # None when the start bounds span more than one year
    duration_days: int | None
    duration_bounds: tuple[int, int] | None


@dataclass
class RecordedAggregation:
    years: np.ndarray                         # int calendar years
    usable: np.ndarray                        # bool: completeness declared for the whole year
    event_starts: np.ndarray                  # NaN where not usable / not attributable
    event_days: np.ndarray                    # NaN additionally where a duration is not exact
    severity: np.ndarray | None               # None when the catalogue registers no severity metric
    events: list[dict[str, Any]]              # events related to the analysis period
    n_events_region: int
    n_duplicates_removed: int
    coverage_summary: dict[str, Any] | None
    notes: list[str] = field(default_factory=list)


def normalise_events(
    records: list[dict[str, Any]], *, region_id: str, phenomenon_id: str, canonical_ids: bool,
) -> tuple[list[NormalisedEvent], int]:
    """Filter to the region and phenomenon and de-duplicate (E12).

    Key: ``canonical_event_id`` when the catalogue is an upstream-prepared integration,
    otherwise the catalogue's own ``event_id``.  A repeated key is the same event and counts
    once.  Returns (events, number of duplicates removed).
    """
    seen: dict[str, NormalisedEvent] = {}
    duplicates = 0
    for rec in records:
        if rec.get("phenomenon_id") != phenomenon_id or region_id not in (rec.get("region_ids") or []):
            continue
        key_field = "canonical_event_id" if canonical_ids else "event_id"
        key = rec.get(key_field)
        if not key:
            raise _invalid(f"record without {key_field}")
        if key in seen:
            duplicates += 1
            continue
        precision = rec.get("time_precision") or {}
        bounds = rec.get("time_bounds") or {}
        if "start" not in rec or "start" not in precision:
            raise _invalid(f"event {key}: start and time_precision.start are required")
        start = parse_time(rec["start"], precision["start"], bounds.get("start"))
        end = None
        if rec.get("end") is not None:
            if "end" not in precision:
                raise _invalid(f"event {key}: time_precision.end is required when end is given")
            end = parse_time(rec["end"], precision["end"], bounds.get("end"))
        exact, dur_bounds = duration_days(start, end)
        year = start.earliest.year if start.earliest.year == start.latest.year else None
        seen[key] = NormalisedEvent(str(key), rec, start, end, year, exact, dur_bounds)
    return list(seen.values()), duplicates


def _coverage_segments(coverage: Any, region_id: str, phenomenon_id: str) -> list[dict[str, Any]]:
    """Coverage records that apply to this region and phenomenon (dict, list or {segments})."""
    if coverage is None:
        return []
    items = coverage if isinstance(coverage, list) else coverage.get("segments") or [coverage]
    out = []
    for seg in items:
        if seg.get("region_id", region_id) != region_id or seg.get("phenomenon_id", phenomenon_id) != phenomenon_id:
            continue
        out.append(seg)
    return out


def _bound(text: str, last: bool) -> date:
    """First / last calendar day covered by a YYYY, YYYY-MM or YYYY-MM-DD coverage boundary."""
    for precision in ("day", "month", "year"):
        if _FORMATS[precision].match(str(text)):
            point = parse_time(str(text), precision)
            return point.latest if last else point.earliest
    raise _invalid(f"coverage boundary {text!r}")


def usable_years(segments: list[dict[str, Any]]) -> tuple[np.ndarray, np.ndarray]:
    """Calendar years and whether an empty year may be read as zero events (E05).

    A year is usable only when it lies wholly inside one segment whose completeness is
    ``complete`` and no ``known_gaps`` entry touches it.
    """
    spans = [(_bound(s["start"], False), _bound(s["end"], True), s) for s in segments
             if s.get("start") and s.get("end")]
    if not spans:
        return np.array([], dtype=np.int64), np.array([], dtype=bool)
    years = np.arange(min(a.year for a, _, _ in spans), max(b.year for _, b, _ in spans) + 1, dtype=np.int64)
    usable = np.zeros(years.size, dtype=bool)
    for i, year in enumerate(years):
        first, last = date(int(year), 1, 1), date(int(year), 12, 31)
        for a, b, seg in spans:
            if seg.get("completeness") != "complete" or a > first or b < last:
                continue
            gaps = seg.get("known_gaps") or []
            if any(_bound(g["start"], False) <= last and _bound(g["end"], True) >= first for g in gaps):
                continue
            usable[i] = True
    return years, usable


def _period_dates(start: int | None, end: int | None) -> tuple[date | None, date | None]:
    first = None if start is None else date(start // 12, start % 12 + 1, 1)
    last = None if end is None else date(end // 12, end % 12 + 1, calendar.monthrange(end // 12, end % 12 + 1)[1])
    return first, last


def _event_view(ev: NormalisedEvent, first: date | None, last: date | None) -> dict[str, Any] | None:
    """Contract-shaped event related to the analysis period, or None when outside it."""
    if last is not None and ev.start.earliest > last:
        return None
    if first is not None and ev.end is not None and ev.end.latest < first:
        return None
    rec = ev.record
    flags = list(rec.get("censoring") or [])
    if first is not None and ev.start.latest < first and "left" not in flags:
        flags.append("left")
    if ev.end is None and "ongoing" not in flags:
        flags.append("ongoing")
    if last is not None and (ev.end is None or ev.end.earliest > last) and "right" not in flags:
        flags.append("right")
    return {
        "event_id": ev.key,
        "start": ev.start.text,                       # verbatim source precision
        "end": None if ev.end is None else ev.end.text,
        "time_precision": {"start": ev.start.precision, "end": None if ev.end is None else ev.end.precision},
        "duration_months": None,
        "duration_days": ev.duration_days,
        "duration_days_bounds": None if ev.duration_bounds is None else list(ev.duration_bounds),
        "severity": None,
        "peak": None,
        "metrics": rec.get("metrics") or {},
        "censoring": flags,
        "definition_ref": rec.get("definition_ref"),
        "source_ref": rec.get("source_ref"),
        "source_version": rec.get("source_version"),
        "quality_flags": list(rec.get("quality_flags") or []),
        "source_event_id": rec.get("event_id"),
    }


def aggregate_recorded(
    records: list[dict[str, Any]],
    coverage: Any,
    *,
    region_id: str,
    phenomenon_id: str,
    analysis_start: int | None,
    analysis_end: int | None,
    canonical_ids: bool,
    severity_metric: dict[str, Any] | None,
) -> RecordedAggregation:
    """Annual frequency / duration / severity of recorded events for one region.

    Attribution: an event belongs to the calendar year of its start, once, however long it
    lasts and whatever the analysis period is (no double counting across boundaries).  If the
    start is only known to an interval spanning several years, those years are missing.
    Duration and severity of a year are sums over the events starting in it and are missing
    when any of those events lacks an exact duration / the registered severity metric.
    """
    events, duplicates = normalise_events(records, region_id=region_id, phenomenon_id=phenomenon_id,
                                          canonical_ids=canonical_ids)
    segments = _coverage_segments(coverage, region_id, phenomenon_id)
    years, usable = usable_years(segments)
    notes: list[str] = []
    if duplicates:
        notes.append(f"{duplicates} repeated record(s) of an already listed event were not counted again")
    if not segments:
        notes.append("no coverage record for this region: years without events are unknown, not zero")
    elif not usable.any():
        notes.append("coverage is not declared complete for any whole calendar year: "
                     "years without events are unknown, not zero")

    n = years.size
    counts, days = np.zeros(n), np.zeros(n)
    sev = np.zeros(n) if severity_metric else None
    ambiguous, days_unknown, sev_unknown = (np.zeros(n, dtype=bool) for _ in range(3))
    index = {int(y): i for i, y in enumerate(years)}
    name = (severity_metric or {}).get("name")
    for ev in events:
        if ev.start_year is None:
            for y in range(ev.start.earliest.year, ev.start.latest.year + 1):
                if y in index:
                    ambiguous[index[y]] = True
            continue
        i = index.get(ev.start_year)
        if i is None:
            continue
        counts[i] += 1
        if ev.duration_days is None:
            days_unknown[i] = True
        else:
            days[i] += ev.duration_days
        if sev is not None:
            value = ((ev.record.get("metrics") or {}).get(name) or {}).get("value")
            if value is None:
                sev_unknown[i] = True
            else:
                sev[i] += float(value)
    outside = [ev.key for ev in events if ev.start_year is not None and ev.start_year not in index]
    uncounted = [ev.key for ev in events if ev.start_year in index and not usable[index[ev.start_year]]]
    if outside:
        notes.append(f"{len(outside)} listed event(s) start outside the years of the coverage record and are "
                     "not part of any annual value")
    if uncounted and usable.any():
        notes.append(f"{len(uncounted)} listed event(s) start in a year without declared complete coverage; "
                     "that year is missing, not counted")
    if ambiguous.any():
        notes.append(f"start year not determined by the source precision for events in "
                     f"{[int(y) for y in years[ambiguous]]}: those years are missing")
    if (days_unknown & usable).any():
        notes.append("duration sum is missing in years with an event whose duration is only known as bounds "
                     "(coarse time precision) or that has not ended")

    ok = usable & ~ambiguous
    first, last = _period_dates(analysis_start, analysis_end)
    views = [v for v in (_event_view(ev, first, last) for ev in events) if v is not None]
    summary = None
    if segments:
        kinds = sorted({str(s.get("completeness", "unknown")) for s in segments})
        summary = {
            "completeness": kinds[0] if len(kinds) == 1 else "partial",
            "start": min(str(s["start"]) for s in segments if s.get("start")) if any(s.get("start") for s in segments) else None,
            "end": max(str(s["end"]) for s in segments if s.get("end")) if any(s.get("end") for s in segments) else None,
            "known_gaps": [g for s in segments for g in (s.get("known_gaps") or [])],
            "policy_version": segments[0].get("policy_version"),
            "coverage_version": segments[0].get("coverage_version"),
            "segments": segments,
        }
    return RecordedAggregation(
        years=years, usable=usable,
        event_starts=np.where(ok, counts, np.nan),
        event_days=np.where(ok & ~days_unknown, days, np.nan),
        severity=None if sev is None else np.where(ok & ~sev_unknown, sev, np.nan),
        events=views, n_events_region=len(events), n_duplicates_removed=duplicates,
        coverage_summary=summary, notes=notes,
    )
