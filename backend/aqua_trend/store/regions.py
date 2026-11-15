"""Region catalogue adapter (data contract §3; acceptance D01, D02).

Regions are exactly the ids of the existing front-end catalogue
(``web/public/data/catalog/regions.json``); nothing is added, merged or renamed.
``series_available`` comes from the series index of the prepared data, never from
the fact that a region has a boundary or can be clicked. Hexagon cells have a
boundary and precomputed trend layers but no prepared series.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Mapping

from .catalogue import AssetReport, read_json
from .region_names import ISO_EN, english_name, zh_place_names

#: region ``type`` in the catalogue -> GeoJSON layer file stem under ``geo/``
TYPE_TO_LAYER: dict[str, str] = {
    "basin3": "basin3", "basin4": "basin4", "named": "named", "hex": "hex", "lme": "lme", "sea": "sea", "ice": "ice",
}
REGION_FIELDS = ("id", "type", "name")


def file_sha256(path: Path) -> str | None:
    """Content hash of a file, ``None`` when it does not exist."""
    try:
        digest = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def series_content_digest(series_dir: Path, listing: Mapping[str, tuple[int, int]], cache_dir: Path | None) -> str:
    """SHA-256 over the *content* of every series file (name-sorted), i.e. the identity of the delivered values.

    Data contract §1: a data update is a new version. File names and sizes are not
    enough — a re-export that changes digits but not lengths keeps every size — so the
    bytes are hashed. Reading ~80 MB on every open is avoided by remembering the digest
    under the (name, size, mtime) fingerprint of the directory in
    ``<cache_dir>/series-digest.json``; any touched file invalidates the memo.
    """
    fingerprint = hashlib.sha256(json.dumps(sorted(listing.items())).encode()).hexdigest()
    memo = cache_dir / "series-digest.json" if cache_dir else None
    if memo is not None:
        try:
            saved = json.loads(memo.read_text("utf-8"))
            if saved.get("fingerprint") == fingerprint and isinstance(saved.get("digest"), str):
                return saved["digest"]
        except (OSError, ValueError, AttributeError):
            pass
    digest = hashlib.sha256()
    for name in sorted(listing):
        digest.update(name.encode() + b"\0")
        digest.update((file_sha256(series_dir / f"{name}.json") or "unreadable").encode() + b"\0")
    out = digest.hexdigest()
    if memo is not None:
        try:
            memo.parent.mkdir(parents=True, exist_ok=True)
            tmp = memo.with_name(f"{memo.name}.{os.getpid()}.tmp")
            tmp.write_text(json.dumps({"fingerprint": fingerprint, "digest": out}), "utf-8")
            tmp.replace(memo)
        except OSError:
            pass
    return out


def _geometry_ids(path: Path, sha: str, cache_dir: Path | None) -> set[str] | None:
    """Feature ids of one GeoJSON layer, cached by content hash (parsing 20 MB once is enough)."""
    cache = cache_dir / "geometry" / f"{path.stem}-{sha[:16]}.ids.json" if cache_dir else None
    if cache is not None and cache.exists():
        try:
            return set(json.loads(cache.read_text("utf-8")))
        except (OSError, json.JSONDecodeError):
            pass
    doc, error, _ = read_json(path)
    if error or not isinstance(doc, dict) or not isinstance(doc.get("features"), list):
        return None
    ids = {str(f.get("properties", {}).get("id")) for f in doc["features"] if isinstance(f, dict)}
    if cache is not None:
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            tmp = cache.with_suffix(f".{id(ids)}.tmp")
            tmp.write_text(json.dumps(sorted(ids)), "utf-8")
            tmp.replace(cache)
        except OSError:
            pass
    return ids


def load_geometry_layers(data_dir: Path, cache_dir: Path | None) -> dict[str, dict[str, Any]]:
    """``layer -> {version, ids}`` for every GeoJSON layer that a region type points to."""
    out: dict[str, dict[str, Any]] = {}
    for layer in sorted(set(TYPE_TO_LAYER.values())):
        path = data_dir / "geo" / f"{layer}.geojson"
        sha = file_sha256(path)
        if sha is None:
            out[layer] = {"version": None, "ids": None, "reason": f"geo/{layer}.geojson is missing"}
            continue
        ids = _geometry_ids(path, sha, cache_dir)
        out[layer] = {"version": f"geo-{layer}-{sha[:12]}", "ids": ids,
                      "reason": None if ids is not None else f"geo/{layer}.geojson is not a GeoJSON FeatureCollection"}
    return out


def _countries(entries: Any) -> list[dict[str, Any]]:
    """Member countries as delivered (``zh``, ``iso``) plus the English short name when the ISO code is known.

    The list is kept as records, not reduced to codes: the selector needs the zh and English
    names to recognise place words that must be ignored (acceptance S05).
    """
    out: list[dict[str, Any]] = []
    for c in entries or []:
        if not isinstance(c, dict):
            continue
        record = {"zh": c.get("zh"), "iso": c.get("iso")}
        if c.get("iso") in ISO_EN:
            record["en"] = ISO_EN[c["iso"]]
        out.append(record)
    return out


def build_regions(
    regions_doc: Any, countries_doc: Any, series_index: Mapping[str, list[str]],
    geometry: Mapping[str, Mapping[str, Any]], report: AssetReport,
) -> dict[str, dict[str, Any]]:
    """Normalise the catalogue entries. Problems go to ``report``; bad entries are skipped, not guessed.

    A region whose geometry feature is missing keeps its id with ``geometry_ref = None``.
    """
    entries = regions_doc.get("regions") if isinstance(regions_doc, dict) else None
    if not isinstance(entries, list):
        report.missing("regions")
        return {}
    zh_to_en = zh_place_names([r for r in entries if isinstance(r, dict)],
                              countries_doc if isinstance(countries_doc, dict) else {})
    out: dict[str, dict[str, Any]] = {}
    without_geometry = 0
    for pos, src in enumerate(entries):
        if not isinstance(src, dict) or any(not src.get(k) for k in REGION_FIELDS):
            report.missing(f"regions[{pos}].{'|'.join(REGION_FIELDS)}")
            continue
        rid = str(src["id"])
        if rid in out:
            report.fail(f"duplicate region id {rid!r}")
            continue
        layer = TYPE_TO_LAYER.get(src["type"])
        geo = geometry.get(layer or "", {})
        has_geometry = bool(geo.get("ids") is not None and rid in geo["ids"])
        without_geometry += 0 if has_geometry else 1
        products = list(series_index.get(rid, []))
        out[rid] = {
            "id": rid,
            "name": english_name(src, zh_to_en),
            "name_zh": src["name"],
            "type": src["type"],
            "layer": layer,
            "surface": src.get("surface"),
            "surface_frac": src.get("surface_frac"),
            "centroid": src.get("centroid"),
            "bbox": src.get("bbox"),
            "area_km2": src.get("area_km2"),
            "countries": _countries(src.get("countries")),
            "parent": src.get("parent"),
            "source_warnings_zh": src.get("warnings") or {},
            "geometry_ref": f"geo/{layer}.geojson#{rid}" if has_geometry else None,
            "geometry_version": geo.get("version") if has_geometry else None,
            "series_available": bool(products),
            "n_products": len(products),
        }
    if not out:
        report.fail("the region catalogue has no usable region")
    if without_geometry:
        report.notes.append(f"{without_geometry} region(s) have no feature in their geo layer (geometry_ref is null)")
    orphans = [rid for rid in series_index if rid not in out]
    if orphans:
        report.notes.append(f"{len(orphans)} series index entr(ies) are not in the region catalogue and cannot be "
                            f"selected, first: {orphans[0]}")
    return out
