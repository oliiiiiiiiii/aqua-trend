"""Binary cache of product matrices (architecture §4 ``product_matrix``).

A product matrix is ``values[R, T]`` (float64, NaN = missing) for every region
that has the product, on one contiguous month axis spanning the earliest start
and the latest end of that product. It is what the preset search iterates over.

Reading the 1,706 series-2 JSON files takes a few seconds, so all products are
written in one pass to ``<cache_dir>/<dataset_version>/matrix/<product>.npz``.
The directory name carries the dataset version: a data update yields a new
version and therefore a fresh cache; old directories are never read again.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Callable, Mapping

import numpy as np

from .series2 import SeriesFormatError, parse_region_file

Matrix = tuple[list[str], np.ndarray, np.ndarray]
CACHE_FORMAT = 1


def _frozen(region_ids: list[str], t: np.ndarray, values: np.ndarray) -> Matrix:
    """Matrices are shared between callers: make an in-place edit an error instead of silent corruption."""
    t.setflags(write=False)
    values.setflags(write=False)
    return region_ids, t, values


def matrix_path(cache_root: Path, dataset_version: str, product_id: str) -> Path:
    return cache_root / dataset_version / "matrix" / f"{product_id}.npz"


def load_matrix(path: Path, dataset_version: str) -> Matrix | None:
    """Read one cached matrix; ``None`` when absent, unreadable or from another dataset version."""
    try:
        with np.load(path, allow_pickle=False) as z:
            if str(z["dataset_version"]) != dataset_version or int(z["cache_format"]) != CACHE_FORMAT:
                return None
            return _frozen([str(x) for x in z["region_ids"]], z["t"].astype(np.int64), z["values"].astype(np.float64))
    except (OSError, KeyError, ValueError):
        return None


def save_matrix(path: Path, dataset_version: str, matrix: Matrix) -> None:
    """Atomic write (temp file + rename) so a concurrent reader never sees a partial file."""
    region_ids, t, values = matrix
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.stem}.{os.getpid()}.tmp.npz")
    np.savez_compressed(tmp, region_ids=np.array(region_ids, dtype=str), t=t, values=values,
                        dataset_version=np.array(dataset_version), cache_format=np.array(CACHE_FORMAT))
    os.replace(tmp, path)


def build_matrices(
    series_dir: Path, series_index: Mapping[str, list[str]], product_ids: list[str],
    on_problem: Callable[[str, str], None],
) -> dict[str, Matrix]:
    """One pass over the series files -> a matrix per product.

    Rows follow the sorted region ids of the series index. A region whose file is
    missing or malformed is reported through ``on_problem(region_id, reason)`` and
    left out of every matrix — its row is never filled from another region.
    """
    wanted = set(product_ids)
    rows: dict[str, list[tuple[str, np.ndarray, np.ndarray]]] = {p: [] for p in product_ids}
    for region_id in sorted(series_index):
        try:
            doc = json.loads((series_dir / f"{region_id}.json").read_text("utf-8"))
            layers = parse_region_file(doc, region_id)
        except (OSError, json.JSONDecodeError, SeriesFormatError) as exc:
            on_problem(region_id, getattr(exc, "reason", str(exc)))
            continue
        for product_id in series_index[region_id]:
            if product_id not in wanted:
                continue
            if product_id not in layers:
                on_problem(region_id, f"series index lists {product_id} but the file has no such layer")
                continue
            t, values = layers[product_id]
            rows[product_id].append((region_id, t, values))
    return {p: _stack(r) for p, r in rows.items()}


def _stack(rows: list[tuple[str, np.ndarray, np.ndarray]]) -> Matrix:
    """Align rows on the union month axis; months outside a row's own record stay NaN."""
    if not rows:
        return [], np.zeros(0, dtype=np.int64), np.zeros((0, 0), dtype=np.float64)
    t0 = min(int(t[0]) for _, t, _ in rows)
    t1 = max(int(t[-1]) for _, t, _ in rows)
    axis = np.arange(t0, t1 + 1, dtype=np.int64)
    values = np.full((len(rows), axis.size), np.nan, dtype=np.float64)
    for i, (_, t, y) in enumerate(rows):
        values[i, int(t[0]) - t0:int(t[0]) - t0 + y.size] = y
    return _frozen([rid for rid, _, _ in rows], axis, values)
