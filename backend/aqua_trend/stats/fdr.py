"""Benjamini–Yekutieli false-discovery-rate adjustment (spec §7.3).

Benjamini, Y. & Yekutieli, D. (2001), "The control of the false discovery rate
in multiple testing under dependency", Annals of Statistics 29(4), 1165–1188.
The BY procedure controls the FDR under arbitrary dependence between tests.
"""
from __future__ import annotations

import numpy as np


def by_adjust(p) -> np.ndarray:
    """BY-adjusted p-values, in the input order.

    With m tests, c(m) = sum_{i=1..m} 1/i and p_(1) <= ... <= p_(m):
        p_adj_(i) = min(1, min_{k >= i} p_(k) * m * c(m) / k)
    The result is monotone in p and capped at 1.  The caller removes untested
    hypotheses first: NaN / out-of-range input is an error, not something to skip
    silently (that would shrink the family).
    """
    p = np.asarray(p, dtype=np.float64)
    if p.ndim != 1:
        raise ValueError("p must be one-dimensional")
    m = p.size
    if m == 0:
        return p.copy()
    if not np.all(np.isfinite(p)) or np.any(p < 0) or np.any(p > 1):
        raise ValueError("p-values must be finite and inside [0, 1]")
    order = np.argsort(p, kind="mergesort")
    ranks = np.arange(1, m + 1, dtype=np.float64)
    c_m = np.sum(1.0 / ranks)
    scaled = p[order] * m * c_m / ranks
    adj_sorted = np.minimum(np.minimum.accumulate(scaled[::-1])[::-1], 1.0)
    out = np.empty(m, dtype=np.float64)
    out[order] = adj_sorted
    return out
