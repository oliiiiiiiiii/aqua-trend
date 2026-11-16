"""Helpers shared by the share_*.py scripts (point/cell sums per region; no area weighting)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from regions import Regions


def cell_index(lat, lon):
    """flat index (row-major 360x720, lat ascending from -90, lon from -180) of 0.5 deg cells"""
    iy = np.clip(np.floor((np.asarray(lat, np.float64) + 90) / 0.5).astype(np.int64), 0, 359)
    ix = np.floor((np.asarray(lon, np.float64) + 180) / 0.5).astype(np.int64) % 720
    return iy * 720 + ix


def region_sum(regions, x):
    """x: (259200, K) values per cell (per column). Returns (R, K) plain sums over each region's cells
    (no cos-lat weight; NaN treated as 0)."""
    x = np.nan_to_num(np.asarray(x, np.float64))
    if x.ndim == 1:
        x = x[:, None]
    out = np.zeros((len(regions.ids), x.shape[1]))
    for kind, off, a, n in regions._parts:
        if kind == "flat":
            ok = a >= 0
            for k in range(x.shape[1]):
                out[off:off + n, k] = np.bincount(a[ok], weights=x[ok, k], minlength=n)
        else:
            out[off:off + n] = a @ x
    out[regions.total_w <= 0] = np.nan   # region has no 0.5 deg cell: unknown, not zero
    return out
