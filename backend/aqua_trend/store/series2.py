"""Adapter for prepared monthly series (data contract §5.1, spec §6.2).

Two input shapes are accepted and both end on the same internal form:

* ``series-2``  ``{"start": "YYYY-MM", "values": [...]}``  — value ``i`` belongs to
  the ``i``-th month after ``start`` (web/public/data/README.md);
* explicit      ``{"times": [...], "values": [...], "quality_flags": [...]}`` — the
  contract's general form.

Rules implemented here (acceptance D09)
- the time axis is the contiguous calendar month index ``year * 12 + month - 1``;
  a month that is absent or ``null`` is ``NaN`` *at its own calendar position*;
- zero is a valid number and stays zero; nothing is filled or interpolated;
- values, times and flags must have equal length, times must be strictly
  increasing (duplicates are a data-release defect, not something to resolve here);
- anything that is not a finite number or ``null`` is rejected.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np

from ..timeaxis import index_to_ym, is_ym, ym_to_index

SERIES_FORMAT_VERSION = "series-2"
#: the only time semantics this backend analyses; everything else is an explicit status
SUPPORTED_CADENCES = frozenset({"monthly"})
SUPPORTED_CALENDARS = frozenset({"gregorian"})


class SeriesFormatError(ValueError):
    """A prepared series violates the data contract. ``reason`` is human readable."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True, eq=False)
class PreparedSeries:
    """One region × product monthly series on a contiguous calendar axis.

    Compared by identity (``eq=False``): a field-wise ``==`` over NumPy arrays is
    ambiguous and NaN never equals NaN; compare ``t`` / ``values`` explicitly.

    ``t`` is strictly increasing with step 1 (month index, see ``aqua_trend.timeaxis``);
    ``values`` is float64 with NaN for missing months. The unit and temporal support
    come from the offline product catalogue, never from guesses at read time.
    """

    region_id: str
    variable_id: str
    product_id: str
    dataset_version: str
    cadence: str
    calendar: str
    unit: str
    temporal_support: str
    t: np.ndarray
    values: np.ndarray
    quality_flags: list[str | None] | None = None
    #: provenance of the stored file, e.g. "series/<region>.json#layers.<product>"
    source: str | None = None

    @property
    def start(self) -> str:
        return index_to_ym(int(self.t[0]))

    @property
    def end(self) -> str:
        return index_to_ym(int(self.t[-1]))

    @property
    def n_valid(self) -> int:
        return int(np.isfinite(self.values).sum())

    def times(self) -> list[str]:
        """Explicit ``YYYY-MM`` labels of the axis."""
        return [index_to_ym(int(i)) for i in self.t]

    def to_contract(self) -> dict[str, Any]:
        """JSON-safe PreparedSeries of data contract §5.1 (NaN -> null)."""
        return {
            "region_id": self.region_id,
            "variable_id": self.variable_id,
            "product_id": self.product_id,
            "dataset_version": self.dataset_version,
            "cadence": self.cadence,
            "calendar": self.calendar,
            "unit": self.unit,
            "temporal_support": self.temporal_support,
            "times": self.times(),
            "values": [None if not np.isfinite(v) else float(v) for v in self.values],
            "quality_flags": self.quality_flags,
        }


def _to_float_array(values: Any) -> np.ndarray:
    """``null`` -> NaN, numbers kept exactly; reject everything else."""
    if not isinstance(values, list):
        raise SeriesFormatError("values must be a JSON array")
    n_null = 0
    for v in values:
        if v is None:
            n_null += 1
        elif type(v) not in (int, float):
            raise SeriesFormatError(f"values contains a non-numeric entry of type {type(v).__name__}")
    arr = np.array([np.nan if v is None else v for v in values], dtype=np.float64)
    if int(np.isnan(arr).sum()) != n_null or bool(np.isinf(arr).any()):
        raise SeriesFormatError("values contains NaN/Infinity; missing must be null")
    return arr


def expand_start_values(start: Any, values: Any) -> tuple[np.ndarray, np.ndarray]:
    """Expand a series-2 layer to ``(t, values)`` without changing any value."""
    if not is_ym(start):
        raise SeriesFormatError(f"start is not a YYYY-MM month: {start!r}")
    arr = _to_float_array(values)
    if arr.size == 0:
        raise SeriesFormatError("values is empty")
    t0 = ym_to_index(start)
    return np.arange(t0, t0 + arr.size, dtype=np.int64), arr


def expand_explicit(
    times: Any, values: Any, quality_flags: Sequence[str | None] | None = None
) -> tuple[np.ndarray, np.ndarray, list[str | None] | None]:
    """Put an explicit-times series on the contiguous month axis.

    Months that do not appear between the first and last time become NaN at their
    calendar position (flag ``None``), so calendar distance is never compressed.
    """
    if not isinstance(times, list) or not times:
        raise SeriesFormatError("times must be a non-empty JSON array")
    bad = [x for x in times if not is_ym(x)]
    if bad:
        raise SeriesFormatError(f"times contains a value that is not YYYY-MM: {bad[0]!r}")
    arr = _to_float_array(values)
    if arr.size != len(times):
        raise SeriesFormatError(f"values has {arr.size} entries but times has {len(times)}")
    if quality_flags is not None and len(quality_flags) != len(times):
        raise SeriesFormatError(f"quality_flags has {len(quality_flags)} entries but times has {len(times)}")
    idx = np.array([ym_to_index(x) for x in times], dtype=np.int64)
    step = np.diff(idx)
    if bool((step == 0).any()):
        dup = times[int(np.argmax(step == 0)) + 1]
        raise SeriesFormatError(f"duplicate time {dup}; duplicates must be resolved at data release")
    if bool((step < 0).any()):
        raise SeriesFormatError("times are not in increasing order")
    t = np.arange(idx[0], idx[-1] + 1, dtype=np.int64)
    out = np.full(t.size, np.nan, dtype=np.float64)
    pos = idx - idx[0]
    out[pos] = arr
    flags: list[str | None] | None = None
    if quality_flags is not None:
        flags = [None] * t.size
        for p, f in zip(pos, quality_flags):
            flags[int(p)] = f
    return t, out, flags


def parse_region_file(doc: Any, region_id: str) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Validate one ``series/<region>.json`` document and expand every layer.

    Raises ``SeriesFormatError`` naming the first defect (wrong id, wrong format
    version, malformed layer).
    """
    if not isinstance(doc, dict):
        raise SeriesFormatError("series file is not a JSON object")
    if doc.get("version") != SERIES_FORMAT_VERSION:
        raise SeriesFormatError(f"unsupported series format {doc.get('version')!r}; expected {SERIES_FORMAT_VERSION}")
    if doc.get("id") != region_id:
        raise SeriesFormatError(f"file is for region {doc.get('id')!r}, not {region_id!r}")
    layers = doc.get("layers")
    if not isinstance(layers, dict):
        raise SeriesFormatError("layers must be a JSON object")
    out: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for layer_id, layer in layers.items():
        if not isinstance(layer, dict):
            raise SeriesFormatError(f"layer {layer_id} is not a JSON object")
        try:
            out[layer_id] = expand_start_values(layer.get("start"), layer.get("values"))
        except SeriesFormatError as exc:
            raise SeriesFormatError(f"layer {layer_id}: {exc.reason}") from None
    return out
