"""Fixed-baseline seasonal handling (spec §7.1).

Rule implemented
    a_t = y_t - c_{m(t)}
where ``c`` is the monthly pattern of a REGISTERED, FIXED reference period.
The pattern depends only on the series and the registered reference period,
never on the analysis period, so changing the analysis window changes the fit
and nothing else (acceptance T02).  Subtracting a fixed monthly pattern keeps
the long-term trend in the anomalies; nothing is detrended (T03).

If the reference period is not supported by the data the result says
``insufficient_baseline``; the period is never shrunk or moved (T07).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Union

import numpy as np

from ..timeaxis import index_to_ym, ym_to_index

MonthRef = Union[int, str]


@dataclass(frozen=True)
class Climatology:
    """Monthly pattern of one fixed reference period.

    cycle   12 values (Jan..Dec); NaN for a calendar month below ``min_samples``
    counts  valid samples per calendar month inside the reference period
    ok      True only when every calendar month has at least ``min_samples`` valid values
    """

    cycle: np.ndarray
    counts: np.ndarray
    ok: bool
    reason: Optional[str]
    status: str                       # "ok" | "insufficient_baseline"
    base_start: int                   # month index, as registered
    base_end: int
    min_samples: int
    actual_start: Optional[int]       # first / last valid month inside the reference period
    actual_end: Optional[int]

    @property
    def samples_per_position(self) -> list[int]:
        return [int(c) for c in self.counts]


def _month_index(m: MonthRef) -> int:
    return ym_to_index(m) if isinstance(m, str) else int(m)


def climatology(t, y, base_start: MonthRef, base_end: MonthRef, min_samples: int) -> Climatology:
    """Mean of each calendar month over the fixed reference period [base_start, base_end].

    ``t`` are month indices (``timeaxis.ym_to_index``), ``y`` values with NaN = missing.
    ``base_start`` / ``base_end`` are month indices or "YYYY-MM" (inclusive).
    Months of the reference period that the series does not cover simply count as
    missing: the period itself is never adjusted.
    """
    t = np.asarray(t, dtype=np.int64)
    y = np.asarray(y, dtype=np.float64)
    if t.shape != y.shape or t.ndim != 1:
        raise ValueError("t and y must be 1-D arrays of the same length")
    b0, b1 = _month_index(base_start), _month_index(base_end)
    if b1 < b0:
        raise ValueError("baseline end precedes baseline start")
    if min_samples < 1:
        raise ValueError("min_samples must be at least 1")

    use = (t >= b0) & (t <= b1) & np.isfinite(y)
    months = t[use] % 12
    counts = np.bincount(months, minlength=12).astype(np.int64)
    sums = np.bincount(months, weights=y[use], minlength=12)
    enough = counts >= min_samples
    cycle = np.full(12, np.nan)
    cycle[enough] = sums[enough] / counts[enough]

    ok = bool(enough.all())
    reason = None
    if not ok:
        short = ", ".join(f"{m + 1:02d} (n={int(counts[m])})" for m in np.flatnonzero(~enough))
        reason = (
            f"fixed reference period {index_to_ym(b0)}..{index_to_ym(b1)} has fewer than "
            f"{min_samples} valid values for calendar month(s) {short}; "
            "the reference period is not shortened or moved"
        )
    tv = t[use]
    return Climatology(
        cycle=cycle, counts=counts, ok=ok, reason=reason,
        status="ok" if ok else "insufficient_baseline",
        base_start=b0, base_end=b1, min_samples=int(min_samples),
        actual_start=int(tv.min()) if tv.size else None,
        actual_end=int(tv.max()) if tv.size else None,
    )


def anomalies(t, y, cycle) -> np.ndarray:
    """y - cycle[month(t)].  Missing stays NaN; the long-term trend is kept."""
    t = np.asarray(t, dtype=np.int64)
    y = np.asarray(y, dtype=np.float64)
    cycle = np.asarray(cycle, dtype=np.float64)
    if cycle.shape != (12,):
        raise ValueError("cycle must have 12 values (Jan..Dec)")
    return y - cycle[t % 12]
