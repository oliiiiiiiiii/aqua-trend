"""Index-based event rule: run detection, censoring and annual aggregation.

Spec §7.4, data contract §7 (``event_rule`` / ``aggregation``), acceptance E06 / E07.

Rule (McKee et al. 1993, as summarised in WMO-No. 1090, 2012): "A drought event occurs any
time the SPI is continuously negative and reaches an intensity of -1.0 or less. The event ends
when the SPI becomes positive."  Implemented as: an event is a maximal run of consecutive
calendar months whose index is below ``run_below`` and whose minimum is at or below
``qualify_at_or_below``; its first month is the first month of the run, its last month is the
last month before the index is no longer below ``run_below``.

Events are identified on the FULL history first.  The analysis period is applied afterwards
and only adds censoring flags — a query window can therefore never split one event in two.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class IndexEvent:
    """One event on the full history (month indices are inclusive)."""

    start: int
    end: int
    duration_months: int
    severity: float                 # sum of |index| over the event months ("magnitude")
    peak: float                     # most negative index value
    #: why the true beginning is unknown: None | "history_start" | "gap"
    start_censor: str | None = None
    #: why the true end is unknown: None | "history_end" (still running) | "gap"
    end_censor: str | None = None


@dataclass(frozen=True)
class PeriodEvent:
    """An event related to an analysis period (the event itself is never clipped)."""

    event: IndexEvent
    #: contract vocabulary: "left", "right", "gap", "ongoing"
    censoring: tuple[str, ...]
    months_in_period: int


@dataclass
class AnnualMetrics:
    """Annual aggregation of the events; NaN = year not usable (never zero)."""

    years: np.ndarray               # int calendar years
    complete: np.ndarray            # bool: every month of the year has a valid index
    event_starts: np.ndarray        # events whose first month falls in the year
    event_months: np.ndarray        # months of the year that lie inside an event
    severity: np.ndarray            # sum of |index| over those months
    notes: list[str] = field(default_factory=list)


def _edge_reason(valid: np.ndarray, pos: int, step: int) -> str:
    """Classify a run edge that touches a missing month or the end of the array."""
    if step > 0:
        return "gap" if valid[pos:].any() else "history_end"
    return "gap" if (pos >= 0 and valid[:pos + 1].any()) else "history_start"


def detect_events(
    t: np.ndarray,
    index: np.ndarray,
    *,
    run_below: float,
    qualify_at_or_below: float,
) -> list[IndexEvent]:
    """Find all events on a contiguous monthly axis.

    A missing month ends a run with censoring ``gap`` (or ``history_start`` / ``history_end``
    when no valid month lies beyond it): the index during the gap is unknown, so the run is
    neither continued through the gap nor closed as if the index had turned positive.  A run
    qualifies on its observed months only.
    """
    t = np.asarray(t, dtype=np.int64)
    x = np.asarray(index, dtype=np.float64)
    if t.size and np.any(np.diff(t) != 1):
        raise ValueError("detect_events needs a contiguous monthly axis")
    valid = np.isfinite(x)
    in_run = valid & (x < run_below)
    events: list[IndexEvent] = []
    n = x.size
    i = 0
    while i < n:
        if not in_run[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and in_run[j + 1]:
            j += 1
        seg = x[i:j + 1]
        if seg.min() <= qualify_at_or_below:
            start_censor = None if (i > 0 and valid[i - 1]) else _edge_reason(valid, i - 1, -1)
            end_censor = None if (j + 1 < n and valid[j + 1]) else _edge_reason(valid, j + 1, 1)
            events.append(IndexEvent(
                start=int(t[i]), end=int(t[j]), duration_months=j - i + 1,
                severity=float(-seg.sum()), peak=float(seg.min()),
                start_censor=start_censor, end_censor=end_censor,
            ))
        i = j + 1
    return events


def relate_to_period(events: list[IndexEvent], start: int | None, end: int | None) -> list[PeriodEvent]:
    """Attach censoring flags relative to the analysis period [start, end] (inclusive).

    Flags: ``left`` — the event began before the period (or before the record);
    ``right`` — it continues after the period; ``gap`` — it is bounded by missing data;
    ``ongoing`` — it is still running at the last valid month of the record.
    Events that do not intersect the period are not returned; each intersecting event is
    returned once, with its full extent.
    """
    out: list[PeriodEvent] = []
    for ev in events:
        if start is not None and ev.end < start:
            continue
        if end is not None and ev.start > end:
            continue
        flags: list[str] = []
        if (start is not None and ev.start < start) or ev.start_censor == "history_start":
            flags.append("left")
        if end is not None and ev.end > end:
            flags.append("right")
        if "gap" in (ev.start_censor, ev.end_censor):
            flags.append("gap")
        if ev.end_censor == "history_end":
            flags.append("ongoing")
        lo = ev.start if start is None else max(ev.start, start)
        hi = ev.end if end is None else min(ev.end, end)
        out.append(PeriodEvent(ev, tuple(flags), hi - lo + 1))
    return out


def annual_metrics(
    t: np.ndarray,
    index: np.ndarray,
    events: list[IndexEvent],
    *,
    min_valid_months_per_year: int,
) -> AnnualMetrics:
    """Aggregate events to calendar years (acceptance E07).

    - ``event_starts``: an event is counted once, in the calendar year of its first month —
      also when it continues into later years.  An event whose true beginning is unknown
      (``start_censor``) cannot be attributed: the year of its first observed month is missing.
    - ``event_months`` / ``severity``: each event month is attributed to the calendar year it
      falls in, so an event crossing New Year contributes to both years without being counted
      twice as an event.
    - A year with fewer than ``min_valid_months_per_year`` valid index months is missing for
      every metric (NaN, not zero).  A usable year without any event is a true zero.
    The annual values are not de-seasonalised: the index is already standardised per calendar
    month and the metrics are annual.
    """
    t = np.asarray(t, dtype=np.int64)
    x = np.asarray(index, dtype=np.float64)
    if t.size == 0:
        e = np.array([], dtype=np.float64)
        return AnnualMetrics(np.array([], dtype=np.int64), np.array([], dtype=bool), e, e.copy(), e.copy())
    years = np.arange(t[0] // 12, t[-1] // 12 + 1, dtype=np.int64)
    year_of = t // 12 - years[0]
    valid = np.isfinite(x)
    n_valid = np.bincount(year_of, weights=valid.astype(float), minlength=years.size)
    complete = n_valid >= min_valid_months_per_year

    in_event = np.zeros(x.size, dtype=bool)
    starts = np.zeros(years.size)
    unattributable = np.zeros(years.size, dtype=bool)
    for ev in events:
        in_event[ev.start - t[0]: ev.end - t[0] + 1] = True
        y = ev.start // 12 - years[0]
        if ev.start_censor is None:
            starts[y] += 1
        else:
            unattributable[y] = True
    months = np.bincount(year_of, weights=in_event.astype(float), minlength=years.size)
    sev = np.bincount(year_of, weights=np.where(in_event, -x, 0.0), minlength=years.size)

    nan = np.nan
    notes: list[str] = []
    affected = [int(y) for y in years[unattributable & complete]]
    if affected:
        notes.append(
            f"event start count is missing in {affected}: an event there begins at a data gap "
            "or at the start of the record, so its true start year is unknown"
        )
    return AnnualMetrics(
        years=years,
        complete=complete,
        event_starts=np.where(complete & ~unattributable, starts, nan),
        event_months=np.where(complete, months, nan),
        severity=np.where(complete, sev, nan),
        notes=notes,
    )


def years_inside(years: np.ndarray, start: int | None, end: int | None) -> np.ndarray:
    """Calendar years lying completely inside the analysis period [start, end] (month indices).

    Only whole calendar years enter an annual trend: a year cut by the period boundary would be
    an incomplete aggregate.
    """
    years = np.asarray(years, dtype=np.int64)
    ok = np.ones(years.shape, dtype=bool)
    if start is not None:
        ok &= years * 12 >= start
    if end is not None:
        ok &= years * 12 + 11 <= end
    return ok
