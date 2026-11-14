"""PreparedDataStore — the only reader of prepared data and the offline catalogue.

Spec §4 (module table), §5, §6.1; data contract §2–§6; architecture §4.

What the store guarantees
- it reads only what was prepared upstream (export-2 / series-2 under
  ``web/public/data`` and the JSON catalogue under ``backend/catalogue``); it never
  downloads, regrids, re-aligns, interpolates or fills anything;
- a region is exactly one id of the existing region catalogue; a region without a
  prepared series yields ``None`` (status ``no_series``) and is never replaced by
  its parent basin or a neighbour (acceptance D02);
- a pending asset (event catalogue, indicator registry) is reported as pending
  and does not block reading valid monthly series; a missing event catalogue is
  ``None``, never an empty list that could be read as "zero events";
- every version that can change a number is exposed in ``versions`` and hashed
  into ``snapshot_id()``.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any

import numpy as np

from ..errors import AquaError
from ..timeaxis import index_to_ym, is_ym, ym_to_index
from .catalogue import (
    POLICY_NAMES, REQUIRED_ASSETS, AssetReport, Catalogue, load_catalogue, product_layer_problem, read_json,
    validate_catalogue,
)
from .matrix import Matrix, build_matrices, load_matrix, matrix_path, save_matrix
from .regions import build_regions, file_sha256, load_geometry_layers, series_content_digest
from .series2 import SERIES_FORMAT_VERSION, PreparedSeries, SeriesFormatError, parse_region_file

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent
DEFAULT_CATALOGUE_DIR = BACKEND_DIR / "catalogue"
DEFAULT_DATA_DIR = REPO_DIR / "web" / "public" / "data"
DEFAULT_CACHE_DIR = BACKEND_DIR / "var" / "cache"

#: data assets without which no monthly series can be served
REQUIRED_DATA_ASSETS = ("data.variables", "data.series_index", "data.regions")
_SERIES_FILE_CACHE = 32
#: completeness vocabulary of EventCoverage (data contract §6.2)
COMPLETENESS = ("complete", "partial", "unknown")


def _sha(*parts: bytes) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part)
        digest.update(b"\0")
    return digest.hexdigest()


class PreparedDataStore:
    """Read-only access to regions, prepared series, catalogue, baselines, policies and events."""

    def __init__(self, catalogue_dir: Path, data_dir: Path, cache_dir: Path):
        self.catalogue_dir, self.data_dir, self.cache_dir = Path(catalogue_dir), Path(data_dir), Path(cache_dir)
        self.versions: dict[str, str] = {}
        self.manifest: dict[str, Any] = {}
        self._cat: Catalogue = Catalogue(directory=self.catalogue_dir)
        self._reports: dict[str, AssetReport] = {}
        self._layers: dict[str, dict] = {}
        self._export: dict[str, Any] = {}
        self._series_index: dict[str, list[str]] = {}
        self._regions: dict[str, dict] = {}
        self._products: dict[str, dict] = {}
        self._product_status: dict[str, tuple[str, str | None]] = {}
        self._event_index: dict[str, dict] | None = None
        self._event_files: dict[tuple[str, str], Any] = {}
        self._files: OrderedDict[str, dict[str, tuple[np.ndarray, np.ndarray]] | SeriesFormatError] = OrderedDict()
        self._matrices: dict[str, Matrix] = {}
        self._problems: dict[str, str] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ opening

    @classmethod
    def open(
        cls, catalogue_dir: str | Path | None = None, data_dir: str | Path | None = None,
        cache_dir: str | Path | None = None, *, strict: bool = True,
    ) -> "PreparedDataStore":
        """Load and validate the release.

        ``strict=True`` raises ``AquaError("data_release_invalid")`` naming every
        invalid *required* asset. Pending or invalid optional assets (events,
        indicator registry, manual presets) never raise. ``strict=False`` returns the
        store so that ``manifest["asset_status"]`` can be inspected.
        Directories default to ``backend/catalogue``, ``web/public/data`` and
        ``backend/var/cache`` (env: ``AQUA_CATALOGUE_DIR``, ``AQUA_DATA_DIR``, ``AQUA_CACHE_DIR``).
        """
        store = cls(
            Path(catalogue_dir or os.environ.get("AQUA_CATALOGUE_DIR") or DEFAULT_CATALOGUE_DIR),
            Path(data_dir or os.environ.get("AQUA_DATA_DIR") or DEFAULT_DATA_DIR),
            Path(cache_dir or os.environ.get("AQUA_CACHE_DIR") or DEFAULT_CACHE_DIR),
        )
        store._load()
        if strict:
            store.require_valid()
        return store

    def require_valid(self) -> None:
        """Raise ``data_release_invalid`` when a required asset is invalid (precise per asset)."""
        required = [self._cat.reports[a].asset for a in (*REQUIRED_ASSETS, *POLICY_NAMES, "manifest")]
        required += list(REQUIRED_DATA_ASSETS)
        bad = [(a, self.manifest["asset_status"][a]) for a in required
               if self.manifest["asset_status"].get(a, {}).get("status") != "ready"]
        if bad:
            detail = "; ".join(f"{asset}: {status.get('reason') or status.get('status')}" for asset, status in bad)
            raise AquaError("data_release_invalid", f"data release is not usable — {detail}",
                            fields=[asset for asset, _ in bad])

    def _load(self) -> None:
        self._cat = load_catalogue(self.catalogue_dir)
        self._reports = {r.asset: r for r in self._cat.reports.values()}
        dataset_hash = self._load_data()
        validate_catalogue(self._cat, self._layers if self._report("data.variables").status == "ready" else None)
        region_hash = self._load_regions()
        self._load_events()
        self._build_products()
        self._build_versions(dataset_hash, region_hash)
        for report in self._reports.values():
            report.finish()
        self._build_manifest()

    def _report(self, asset: str, path: str | None = None) -> AssetReport:
        if asset not in self._reports:
            self._reports[asset] = AssetReport(asset=asset, path=path)
        return self._reports[asset]

    def _read_data_json(self, asset: str, rel: str) -> tuple[Any, bytes]:
        report = self._report(asset, rel)
        doc, error, raw = read_json(self.data_dir / rel)
        if error:
            report.status = "invalid"
            report.reason = f"{rel} is missing" if error == "missing" else f"{rel}: {error}"
            return None, raw
        return doc, raw

    def _load_data(self) -> str:
        """Variables, series index and the series directory listing; returns the dataset content hash."""
        variables, raw_v = self._read_data_json("data.variables", "catalog/variables.json")
        report = self._report("data.variables")
        if isinstance(variables, dict):
            layers = variables.get("layers")
            if not isinstance(layers, dict):
                report.missing("layers")
            else:
                self._layers = layers
                for layer_id, layer in layers.items():
                    for key in ("unit", "start", "end"):
                        if not isinstance(layer, dict) or not layer.get(key):
                            report.missing(f"layers.{layer_id}.{key}")
                    if isinstance(layer, dict) and not (is_ym(layer.get("start")) and is_ym(layer.get("end"))):
                        report.fail(f"layers.{layer_id}: start/end must be YYYY-MM")
            for key in ("version", "generated"):
                if not variables.get(key):
                    report.missing(key)
            report.version = f"{variables.get('version')}@{variables.get('generated')}"
        self._export = variables if isinstance(variables, dict) else {}

        index, raw_i = self._read_data_json("data.series_index", "catalog/series_index.json")
        report = self._report("data.series_index")
        if isinstance(index, dict):
            if index.get("version") != SERIES_FORMAT_VERSION:
                report.fail(f"series format {index.get('version')!r} is not supported; expected {SERIES_FORMAT_VERSION}")
            regions = index.get("regions")
            if not isinstance(regions, dict) or not all(isinstance(v, list) for v in regions.values()):
                report.missing("regions")
            else:
                self._series_index = regions
            report.version = str(index.get("version"))

        listing = self._series_listing()
        report = self._report("data.series", "series/")
        absent = sorted(set(self._series_index) - set(listing))
        if absent:
            report.fail(f"{len(absent)} region(s) of the series index have no series file, first: {absent[0]}")
            for rid in absent:
                self._problems[rid] = "the series index lists this region but series/<id>.json was not delivered"
        extra = sorted(set(listing) - set(self._series_index))
        if extra:
            report.notes.append(f"{len(extra)} series file(s) are not in the series index and are ignored")
        digest = series_content_digest(self.data_dir / "series", listing, self.cache_dir)
        report.version = f"series-{digest[:12]}"
        return _sha(raw_v, raw_i, digest.encode())

    def _series_listing(self) -> dict[str, tuple[int, int]]:
        """``region id -> (file size, mtime_ns)`` of every delivered series file."""
        try:
            with os.scandir(self.data_dir / "series") as it:
                return {e.name[:-5]: (e.stat().st_size, e.stat().st_mtime_ns)
                        for e in it if e.name.endswith(".json") and e.is_file()}
        except OSError:
            return {}

    def _load_regions(self) -> str:
        regions_doc, raw_r = self._read_data_json("data.regions", "catalog/regions.json")
        countries_doc, _, _ = read_json(self.data_dir / "catalog" / "countries.json")
        geometry = load_geometry_layers(self.data_dir, self.cache_dir)
        for layer, info in geometry.items():
            report = self._report(f"data.geometry.{layer}", f"geo/{layer}.geojson")
            report.version = info.get("version")
            if info.get("reason"):
                report.fail(info["reason"])
        report = self._report("data.regions")
        if regions_doc is not None:
            self._regions = build_regions(regions_doc, countries_doc, self._series_index, geometry, report)
        return _sha(raw_r, *[str(geometry[k].get("version")).encode() for k in sorted(geometry)])

    def _load_events(self) -> None:
        """``events/index.json`` is defined by the indicator work package; absent = pending."""
        report = self._report("events", "events/index.json")
        doc, error, _ = read_json(self.catalogue_dir / "events" / "index.json")
        if error == "missing":
            report.status = "pending"
            report.reason = "no event catalogue has been delivered; recorded-event results are data_required"
            return
        if error or not isinstance(doc, dict) or not isinstance(doc.get("catalogues"), list):
            report.status, report.reason = "invalid", error or "events/index.json needs a 'catalogues' list"
            return
        report.version = str(doc.get("version")) if doc.get("version") else None
        if not doc.get("version"):
            report.missing("version")
        self._event_index = {}
        for pos, entry in enumerate(doc["catalogues"]):
            if not isinstance(entry, dict) or not entry.get("catalogue_id"):
                report.missing(f"catalogues[{pos}].catalogue_id")
                continue
            self._event_index[str(entry["catalogue_id"])] = entry
            self._check_event_catalogue(entry)
        if not any(e.get("status") == "ready" for e in self._event_index.values()) and report.status == "ready":
            report.status, report.reason = "pending", "the event index lists no ready catalogue"

    def _check_event_catalogue(self, entry: dict) -> None:
        cid = str(entry["catalogue_id"])
        report = self._report(f"events.{cid}", f"events/{self._event_file(entry, 'events')}")
        for key in ("phenomenon_id", "status"):
            if not entry.get(key):
                report.missing(key)
        if entry.get("status") != "ready":
            if report.status == "ready":
                report.status = "pending"
                report.missing_fields = [str(m) for m in entry.get("missing") or []]
                report.reason = entry.get("reason") or f"event catalogue {cid} is registered but not delivered"
            return
        for kind, list_key in (("events", "events"), ("coverage", "coverage")):
            doc = self._event_document(entry, kind)
            if doc is None or not isinstance(doc.get(list_key), list):
                report.fail(f"catalogue {cid} is marked ready but events/{self._event_file(entry, kind)} "
                            f"is missing or has no '{list_key}' list")
        doc = self._event_document(entry, "events")
        unknown: set[str] = set()
        for pos, event in enumerate((doc or {}).get("events") or []):
            for key in ("event_id", "region_ids", "start"):
                if not isinstance(event, dict) or event.get(key) in (None, "", []):
                    report.missing(f"events[{pos}].{key}")
            ids = event.get("region_ids") if isinstance(event, dict) else None
            if ids in (None, "", []):
                continue
            if not isinstance(ids, list) or not all(isinstance(r, str) for r in ids):
                report.fail(f"events[{pos}].region_ids must be a list of region ids")   # a bare string would substring-match
            else:
                unknown |= {r for r in ids if r not in self._regions}
        doc = self._event_document(entry, "coverage")
        for pos, record in enumerate((doc or {}).get("coverage") or []):
            if not isinstance(record, dict):
                report.fail(f"coverage[{pos}] is not a JSON object")
                continue
            for key in ("region_id", "start", "end", "completeness"):
                if record.get(key) in (None, ""):
                    report.missing(f"coverage[{pos}].{key}")
            if record.get("completeness") not in (None, "", *COMPLETENESS):
                report.fail(f"coverage[{pos}].completeness {record.get('completeness')!r} is not one of "
                            f"{', '.join(COMPLETENESS)}; an unknown label must not be read as complete")
            if record.get("region_id") and record["region_id"] not in self._regions:
                unknown.add(str(record["region_id"]))
        if unknown and self._regions:
            # data contract §3/§6.1: the region mapping is delivered, never rebuilt or guessed at query time
            report.fail(f"{len(unknown)} region id(s) of catalogue {cid} are not in the region catalogue, "
                        f"first: {sorted(unknown)[0]}; their events would silently be dropped")

    @staticmethod
    def _event_file(entry: dict, kind: str) -> str:
        return str(entry.get(f"{kind}_file") or f"{entry['catalogue_id']}.{kind}.json")

    def _event_document(self, entry: dict, kind: str) -> dict | None:
        key = (str(entry["catalogue_id"]), kind)
        if key not in self._event_files:
            doc, error, _ = read_json(self.catalogue_dir / "events" / self._event_file(entry, kind))
            self._event_files[key] = doc if not error and isinstance(doc, dict) else None
        return self._event_files[key]

    def _build_products(self) -> None:
        """Merge catalogue products with the prepared layer bounds and decide what can be served."""
        concepts = self._cat.items.get("concepts", {})
        for pid, product in self._cat.items.get("products", {}).items():
            layer = self._layers.get(pid)
            problem = product_layer_problem(product, layer)
            approved = (concepts.get(product.get("variable_id"), {}) or {}).get("approved_product_ids") or []
            merged = dict(product)
            if layer:
                merged["start"], merged["end"] = layer.get("start"), layer.get("end")
            merged["approved"] = pid in approved
            merged["priority_rank"] = approved.index(pid) + 1 if pid in approved else None
            merged["status"], merged["status_reason"] = problem if problem else ("ok", None)
            self._products[pid] = merged
            self._product_status[pid] = (merged["status"], merged["status_reason"])

    def _build_versions(self, dataset_hash: str, region_hash: str) -> None:
        cat, export = self._cat, self._export
        declared = cat.manifest.get("catalogue_version") or "unversioned"
        policies = {name: str(cat.policies.get(name, {}).get("version", "missing")) for name in POLICY_NAMES}
        self.versions = {
            "dataset_version": f"{export.get('version', 'unknown')}.{export.get('generated', 'undated')}.{dataset_hash[:12]}",
            "catalogue_version": f"{declared}+{cat.content_hash[:10]}",
            "region_catalogue_version": f"regions-{region_hash[:12]}",
            "indicator_registry_version": cat.indicators_version or "not_delivered",
            "quality_policy_version": policies["quality_policy"],
            "method_policy_version": policies["method_policy"],
            "preset_policy_version": policies["preset_policy"],
            "manual_presets_version": str(cat.manual_presets.get("version", "not_delivered")),
            "event_catalogue_version": str(self._reports["events"].version or "not_delivered"),
            "catalogue_content_digest": self._aux_digest()[:16],
        }

    def _aux_digest(self) -> str:
        """Content hash of the catalogue files whose version is only *declared*.

        Policies, the indicator registry, manual presets and event files carry a
        ``version`` string that an editor must bump. Hashing their bytes into
        ``versions`` makes ``snapshot_id()`` change even when a number was edited
        without a bump, so a cached result is never reused under changed policy
        (spec §4 "versions", acceptance T16).
        """
        root = self.catalogue_dir
        files = [root / "policies" / f"{name}.json" for name in POLICY_NAMES]
        files += [root / "indicators.json", root / "manual_presets.json"]
        files += sorted((root / "events").rglob("*.json")) if (root / "events").is_dir() else []
        parts: list[bytes] = []
        for path in files:
            parts.append(str(path.relative_to(root)).encode())
            parts.append((file_sha256(path) or "absent").encode())
        return _sha(*parts)

    def _build_manifest(self) -> None:
        declared = self._cat.manifest
        counts: dict[str, int] = {}
        for layers in self._series_index.values():
            for pid in layers:
                counts[pid] = counts.get(pid, 0) + 1
        registered = declared.get("dataset", {}).get("registered_against_dataset_version")
        if registered and registered != self.versions["dataset_version"]:
            self._report("data.series_index").notes.append(
                f"the catalogue was registered against dataset {registered}; the data now is "
                f"{self.versions['dataset_version']} — review baselines and caveats before bumping the manifest")
        self.manifest = {
            "manifest_version": declared.get("manifest_version"),
            **{k: self.versions[k] for k in ("dataset_version", "catalogue_version", "region_catalogue_version",
                                             "indicator_registry_version", "quality_policy_version")},
            "versions": dict(self.versions),
            "dataset": declared.get("dataset", {}),
            "series_index": {
                "path": "catalog/series_index.json", "format": SERIES_FORMAT_VERSION,
                "regions_with_series": len(self._series_index), "regions_total": len(self._regions),
                "series_total": sum(counts.values()), "regions_per_product": dict(sorted(counts.items())),
            },
            "event_catalogues": self.event_catalogues() if self._event_index is not None else [],
            "event_catalogue_status": self._reports["events"].status,
            "baselines": [
                {k: b.get(k) for k in ("baseline_id", "version", "kind", "product_id", "start", "end", "designation",
                                       "rule", "minimum_samples")}
                for b in self._cat.items.get("baselines", {}).values()
            ],
            "product_status": {pid: {"status": s, "reason": r} for pid, (s, r) in self._product_status.items()},
            "asset_status": {asset: report.as_dict() for asset, report in sorted(self._reports.items())},
        }

    # ------------------------------------------------------------------ versions / policy

    def snapshot_id(self) -> str:
        """Stable hash of every version in ``versions`` (spec §10 reproducibility)."""
        payload = json.dumps(self.versions, sort_keys=True, ensure_ascii=False).encode()
        return "snap-" + hashlib.sha256(payload).hexdigest()[:16]

    def policy(self, name: str) -> dict:
        """``method_policy`` | ``preset_policy`` | ``quality_policy`` — the only source of numeric policy."""
        if name not in self._cat.policies:
            raise AquaError("data_release_invalid", f"policy {name!r} is not available in the catalogue", fields=[name])
        return self._cat.policies[name]

    # ------------------------------------------------------------------ catalogue

    def concepts(self) -> dict[str, dict]:
        return self._cat.items.get("concepts", {})

    def concept(self, variable_id: str) -> dict:
        try:
            return self.concepts()[variable_id]
        except KeyError:
            raise AquaError("not_found", f"unknown variable concept {variable_id!r}", fields=["variable_id"]) from None

    def products(self) -> dict[str, dict]:
        """Registered products, each with the prepared ``start``/``end``, ``approved``, ``priority_rank`` and ``status``."""
        return self._products

    def product(self, product_id: str) -> dict:
        try:
            return self._products[product_id]
        except KeyError:
            raise AquaError("not_found", f"unknown product {product_id!r}", fields=["product_id"]) from None

    def refs(self) -> dict[str, dict]:
        return self._cat.items.get("refs", {})

    def phenomena(self) -> list[dict]:
        """Curated context notes for the selector — context, not a whitelist of accepted input."""
        return list(self._cat.items.get("phenomena", {}).values())

    def baseline(self, baseline_id: str) -> dict:
        try:
            return self._cat.items.get("baselines", {})[baseline_id]
        except KeyError:
            raise AquaError("not_found", f"unknown baseline {baseline_id!r}", fields=["baseline_id"]) from None

    def baselines(self) -> dict[str, dict]:
        return self._cat.items.get("baselines", {})

    def baseline_for(self, variable_id: str, product_id: str) -> dict | None:
        """The fixed seasonal reference registered for this concept/product, or ``None``."""
        baseline_id = (self.concept(variable_id).get("baseline_ref") or {}).get(product_id)
        return self.baseline(baseline_id) if baseline_id else None

    def indicator_recipes(self) -> dict[str, dict]:
        """Recipes of ``indicators.json`` by id; empty while the registry is not delivered."""
        return dict(self._cat.indicators or {})

    def manual_presets(self) -> dict:
        """Versioned manual preset adjustments (``{version, adjustments}``); empty skeleton when none."""
        return self._cat.manual_presets or {"version": "not_delivered", "adjustments": []}

    # ------------------------------------------------------------------ regions

    def regions(self) -> dict[str, dict]:
        return self._regions

    def region(self, region_id: str) -> dict:
        try:
            return self._regions[region_id]
        except (KeyError, TypeError):
            raise AquaError("unknown_region", f"region {region_id!r} is not in the region catalogue",
                            fields=["region_id"]) from None

    def available_products(self, region_id: str) -> list[str]:
        """Products with a prepared, servable series for exactly this region (catalogue order)."""
        self.region(region_id)
        listed = set(self._series_index.get(region_id, []))
        return [pid for pid, (status, _) in self._product_status.items() if pid in listed and status == "ok"]

    # ------------------------------------------------------------------ series

    def _region_layers(self, region_id: str) -> dict[str, tuple[np.ndarray, np.ndarray]] | SeriesFormatError:
        with self._lock:
            if region_id in self._files:
                self._files.move_to_end(region_id)
                return self._files[region_id]
        try:
            doc = json.loads((self.data_dir / "series" / f"{region_id}.json").read_text("utf-8"))
            parsed: dict | SeriesFormatError = parse_region_file(doc, region_id)
        except SeriesFormatError as exc:
            parsed = exc
        except (OSError, json.JSONDecodeError) as exc:
            parsed = SeriesFormatError(f"series/{region_id}.json cannot be read: {exc}")
        with self._lock:
            self._files[region_id] = parsed
            while len(self._files) > _SERIES_FILE_CACHE:
                self._files.popitem(last=False)
            if isinstance(parsed, SeriesFormatError):
                self._problems[region_id] = parsed.reason
        return parsed

    def series_status(self, region_id: str, product_id: str) -> tuple[str, str | None]:
        """Why ``series()`` does or does not return data, as an ``ItemStatus`` code and a readable reason.

        ``no_series``: the region has a boundary but nothing was prepared for it (or for
        this product); ``unsupported_resolution``: cadence/calendar/unit cannot be analysed;
        ``data_required``: the release promises the series but the file is absent or malformed.
        """
        region = self.region(region_id)
        status, reason = self._product_status.get(product_id) or (None, None)
        if status is None:
            raise AquaError("not_found", f"unknown product {product_id!r}", fields=["product_id"])
        if status != "ok":
            return status, reason
        if product_id not in self._series_index.get(region_id, []):
            if not region["series_available"]:
                detail = ("hexagon cells carry only precomputed trend layers" if region["type"] == "hex"
                          else "it has a boundary but no prepared series")
                return "no_series", f"no prepared series exists for region {region_id} ({detail}); no other region is substituted"
            return "no_series", f"product {product_id} was not prepared for region {region_id}"
        layers = self._region_layers(region_id)
        if isinstance(layers, SeriesFormatError):
            return "data_required", f"series/{region_id}.json violates the data contract: {layers.reason}"
        if product_id not in layers:
            return "data_required", f"the series index lists {product_id} for {region_id} but the file has no such layer"
        t = layers[product_id][0]
        product = self._products[product_id]
        if int(t[0]) < ym_to_index(product["start"]) or int(t[-1]) > ym_to_index(product["end"]):
            return ("data_required", f"series {product_id} for {region_id} spans {index_to_ym(int(t[0]))}.."
                    f"{index_to_ym(int(t[-1]))}, outside the product record {product['start']}..{product['end']}")
        return "ok", None

    def series(self, region_id: str, product_id: str) -> PreparedSeries | None:
        """The prepared series of exactly this region and product, or ``None``.

        ``None`` means there is nothing that may be analysed (see ``series_status`` for
        the reason). The store never falls back to a parent basin, a neighbouring cell
        or another product.
        """
        status, _ = self.series_status(region_id, product_id)
        if status != "ok":
            return None
        t, values = self._region_layers(region_id)[product_id]  # type: ignore[index]
        product = self._products[product_id]
        return PreparedSeries(
            region_id=region_id, variable_id=product["variable_id"], product_id=product_id,
            dataset_version=self.versions["dataset_version"], cadence=product["cadence"],
            calendar=product["calendar"], unit=product["unit"], temporal_support=product["temporal_support"],
            t=t.copy(), values=values.copy(), quality_flags=None,
            source=f"series/{region_id}.json#layers.{product_id}",
        )

    def baseline_support(self, region_id: str, product_id: str) -> dict | None:
        """Valid samples per calendar month of the registered baseline for one region.

        Data contract §5.2: a baseline publishes its samples per season position and
        its actual data support. Returns ``None`` when there is no series or no baseline.
        """
        product = self.product(product_id)
        base = self.baseline_for(product["variable_id"], product_id) if product["variable_id"] in self.concepts() else None
        series = self.series(region_id, product_id)
        if base is None or series is None:
            return None
        inside = (series.t >= ym_to_index(base["start"])) & (series.t <= ym_to_index(base["end"]))
        valid = inside & np.isfinite(series.values)
        samples = [int((valid & (series.t % 12 == m)).sum()) for m in range(12)]
        when = series.t[valid]
        return {
            "baseline_id": base["baseline_id"], "version": base["version"],
            "samples_per_position": samples, "minimum_samples": base["minimum_samples"],
            "ok": min(samples) >= base["minimum_samples"],
            "actual_support": {"start": index_to_ym(int(when[0])), "end": index_to_ym(int(when[-1]))} if when.size else None,
        }

    def product_matrix(self, product_id: str) -> tuple[list[str], np.ndarray, np.ndarray]:
        """``(region_ids, t, values[R, T])`` for every region that has the product.

        Built once from the series files and cached as a binary file under
        ``<cache_dir>/<dataset_version>/matrix``; later opens read the binary file.
        Arrays are shared: treat them as read-only.
        """
        status, _ = self._product_status.get(product_id) or (None, None)
        if status is None:
            raise AquaError("not_found", f"unknown product {product_id!r}", fields=["product_id"])
        if status != "ok":
            return [], np.zeros(0, dtype=np.int64), np.zeros((0, 0), dtype=np.float64)
        version = self.versions["dataset_version"]
        with self._lock:
            if product_id not in self._matrices:
                cached = load_matrix(matrix_path(self.cache_dir, version, product_id), version)
                if cached is not None:
                    self._matrices[product_id] = cached
                else:
                    self._build_all_matrices(keep=product_id)
            return self._matrices[product_id]

    def _build_all_matrices(self, keep: str) -> None:
        servable = [pid for pid, (status, _) in self._product_status.items() if status == "ok"]
        built = build_matrices(self.data_dir / "series", self._series_index, servable,
                               lambda rid, reason: self._problems.__setitem__(rid, reason))
        version = self.versions["dataset_version"]
        persisted = True
        for pid, matrix in built.items():
            try:
                save_matrix(matrix_path(self.cache_dir, version, pid), version, matrix)
            except OSError:
                persisted = False
        if persisted:
            self._matrices[keep] = built[keep]      # the others are re-read from disk on demand
        else:
            self._matrices.update(built)            # read-only cache dir: keep everything in memory

    def series_problems(self) -> dict[str, str]:
        """Series files found missing or malformed so far, by region id."""
        return dict(self._problems)

    # ------------------------------------------------------------------ events

    def event_catalogues(self) -> list[dict]:
        """Entries of ``events/index.json``; an empty list means nothing is registered (asset status: pending)."""
        return [dict(e) for e in (self._event_index or {}).values()]

    def _ready_event_catalogue(self, catalogue_id: str, region_id: str) -> dict | None:
        self.region(region_id)
        entry = (self._event_index or {}).get(catalogue_id)
        if entry is None or entry.get("status") != "ready":
            return None
        if self._reports.get(f"events.{catalogue_id}", AssetReport("x")).status != "ready":
            return None
        return entry

    def events(self, catalogue_id: str, region_id: str) -> list[dict] | None:
        """Recorded events mapped to this region, or ``None`` when the catalogue is not delivered.

        Data contract §6: ``None`` is "no data" (``data_required``). A list — even an
        empty one — is only returned for a ready catalogue, and an empty list still is
        *not* a zero count unless ``event_coverage`` declares the region/period complete.
        """
        entry = self._ready_event_catalogue(catalogue_id, region_id)
        if entry is None:
            return None
        doc = self._event_document(entry, "events")
        if doc is None:
            return None
        return [e for e in doc["events"]
                if isinstance(e.get("region_ids"), list) and region_id in e["region_ids"]]

    def event_coverage(self, catalogue_id: str, region_id: str) -> dict | None:
        """Coverage / completeness record of this region, or ``None`` (= unknown, never "complete")."""
        entry = self._ready_event_catalogue(catalogue_id, region_id)
        if entry is None:
            return None
        doc = self._event_document(entry, "coverage")
        records = [r for r in (doc or {}).get("coverage") or []
                   if isinstance(r, dict) and r.get("region_id") == region_id]
        if not records:
            return None
        if len(records) == 1:
            return records[0]
        # several records per region are allowed when completeness changes over time
        return {"catalogue_id": catalogue_id, "region_id": region_id, "segments": records}
