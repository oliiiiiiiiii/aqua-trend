"""Loading and integrity checks for the offline catalogue (spec §5, §6.1; data contract §2, §4, §5.2).

The catalogue is a set of versioned JSON files under ``backend/catalogue``. This
module only reads and checks them; it never repairs, defaults or infers
scientific content. Every problem is reported against the asset it belongs to so
that one broken or pending asset does not hide the others.

Checks that encode a scientific rule
- a fallback product must be registered for the *same* concept, with the same
  unit, temporal support and ``definition_class`` (same category is not enough —
  spec §6.1, acceptance D05);
- every approved product has one fixed seasonal baseline that lies inside the
  product record (spec §7.1);
- ``wmo_standard_normal`` may only label a 30-year period starting in a year
  ending in 1 (e.g. 1991-01..2020-12); shorter fixed periods must be called
  ``registered_reference_mean`` (spec §7.1, acceptance T07);
- a relative change needs a registered denominator and is never offered for
  °C or anomaly quantities (spec §7.2, acceptance T13).
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping

from ..timeaxis import is_ym, ym_to_index

ROLES = ("core_indicator", "related_condition", "response")
DATA_KINDS = ("continuous", "count", "index", "categorical", "static")
NATURES = ("stock", "flux", "state", "index")
DESIGNATIONS = ("wmo_standard_normal", "registered_reference_mean")
ADJUSTMENT_ACTIONS = ("add", "pin", "priority", "disable")

#: asset name -> (file name, list key, id key)
LIST_ASSETS: dict[str, tuple[str, str, str]] = {
    "concepts": ("concepts.json", "concepts", "variable_id"),
    "products": ("products.json", "products", "product_id"),
    "refs": ("refs.json", "refs", "ref_id"),
    "baselines": ("baselines.json", "baselines", "baseline_id"),
    "phenomena": ("phenomena.json", "phenomena", "phenomenon_id"),
}
#: assets that must be valid before any research can run
REQUIRED_ASSETS = ("concepts", "products", "refs", "baselines", "phenomena")
POLICY_NAMES = ("method_policy", "preset_policy", "quality_policy")

CONCEPT_FIELDS = (
    "variable_id", "label", "label_zh", "description", "quantity_definition", "unit", "temporal_support",
    "data_kind", "scientific_refs", "approved_product_ids", "baseline_ref", "relative_change", "display_semantics",
)
PRODUCT_FIELDS = (
    "product_id", "variable_id", "agency", "product_name", "version", "source_refs", "unit",
    "physical_definition", "definition_class", "native_resolution", "prepared_resolution", "temporal_support",
    "cadence", "calendar", "quality_limits", "caveat", "nasa", "family", "start", "end",
)
BASELINE_FIELDS = (
    "baseline_id", "version", "kind", "product_id", "start", "end", "rule", "designation", "minimum_samples",
    "refs", "applies_to",
)
REF_FIELDS = ("ref_id", "title", "verified")
PHENOMENON_FIELDS = (
    "phenomenon_id", "label", "label_zh", "aliases", "description", "variable_links", "indicator_ids",
    "unanswerable_notes",
)
LINK_FIELDS = ("variable_id", "role", "statement", "limits", "ref_ids")
DISPLAY_FIELDS = ("color", "increase_reads", "decimals", "orb_channel")
#: fields that must be present but may legitimately be null
NULLABLE = frozenset({"relative_change", "caveat", "orb_channel"})


@dataclass
class AssetReport:
    """Validation outcome of one asset (data contract §2 ``asset_status``)."""

    asset: str
    status: str = "ready"                      # ready | pending | invalid
    missing_fields: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    #: observations that do not invalidate the asset (e.g. one product that cannot be served)
    notes: list[str] = field(default_factory=list)
    reason: str | None = None
    version: str | None = None
    path: str | None = None

    def fail(self, problem: str) -> None:
        self.problems.append(problem)
        self.status = "invalid"

    def missing(self, where: str) -> None:
        self.missing_fields.append(where)
        self.status = "invalid"

    def finish(self) -> "AssetReport":
        if self.status == "invalid" and self.reason is None:
            parts = []
            if self.missing_fields:
                parts.append(f"{len(self.missing_fields)} missing field(s), first: {self.missing_fields[0]}")
            if self.problems:
                parts.append(f"{len(self.problems)} problem(s), first: {self.problems[0]}")
            self.reason = "; ".join(parts) or "invalid"
        return self

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "status": self.status, "missing_fields": list(self.missing_fields),
            "problems": list(self.problems), "notes": list(self.notes), "reason": self.reason,
        }
        if self.version is not None:
            out["version"] = self.version
        if self.path is not None:
            out["path"] = self.path
        return out


@dataclass
class Catalogue:
    """Parsed catalogue files. Lists that failed to load are empty and their report is ``invalid``."""

    directory: Path
    documents: dict[str, Any] = field(default_factory=dict)       # raw documents by asset name
    items: dict[str, dict[str, dict]] = field(default_factory=dict)  # asset -> id -> entry
    policies: dict[str, dict] = field(default_factory=dict)
    manifest: dict[str, Any] = field(default_factory=dict)
    manual_presets: dict[str, Any] = field(default_factory=dict)
    indicators: dict[str, dict] | None = None                     # None = registry not delivered
    indicators_version: str | None = None
    reports: dict[str, AssetReport] = field(default_factory=dict)
    content_hash: str = ""

    def version_of(self, asset: str) -> str | None:
        doc = self.documents.get(asset)
        return str(doc["version"]) if isinstance(doc, dict) and doc.get("version") else None


# --------------------------------------------------------------------------- loading

def read_json(path: Path) -> tuple[Any, str | None, bytes]:
    """Return ``(document, error, raw_bytes)``; a missing file is ``error='missing'``."""
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return None, "missing", b""
    except OSError as exc:
        return None, f"cannot read: {exc}", b""
    try:
        return json.loads(raw.decode("utf-8")), None, raw
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return None, f"not valid JSON: {exc}", raw


def _load_list_asset(cat: Catalogue, asset: str, digest: "hashlib._Hash") -> None:
    file_name, list_key, id_key = LIST_ASSETS[asset]
    path = cat.directory / file_name
    report = AssetReport(asset=f"catalogue.{asset}", path=file_name)
    cat.reports[asset] = report
    cat.items[asset] = {}
    doc, error, raw = read_json(path)
    digest.update(file_name.encode() + b"\0" + raw)
    if error:
        report.status = "invalid"
        report.reason = f"{file_name} is missing" if error == "missing" else f"{file_name}: {error}"
        return
    if not isinstance(doc, dict):
        report.fail("top level is not a JSON object")
        return
    cat.documents[asset] = doc
    if not doc.get("version"):
        report.missing("version")
    report.version = cat.version_of(asset)
    entries = doc.get(list_key)
    if not isinstance(entries, list):
        report.missing(list_key)
        return
    for pos, entry in enumerate(entries):
        if not isinstance(entry, dict) or not entry.get(id_key):
            report.missing(f"{list_key}[{pos}].{id_key}")
            continue
        key = str(entry[id_key])
        if key in cat.items[asset]:
            report.fail(f"duplicate {id_key} {key!r}")
            continue
        cat.items[asset][key] = entry


def _load_policies(cat: Catalogue) -> None:
    for name in POLICY_NAMES:
        report = AssetReport(asset=f"policies.{name}", path=f"policies/{name}.json")
        cat.reports[name] = report
        doc, error, _ = read_json(cat.directory / "policies" / f"{name}.json")
        if error:
            report.status, report.reason = "invalid", f"policies/{name}.json: {error}"
            continue
        if not isinstance(doc, dict) or not doc.get("version"):
            report.missing("version")
            continue
        cat.policies[name] = doc
        report.version = str(doc["version"])


def _load_optional(cat: Catalogue) -> None:
    """Manifest, manual presets and the indicator registry (owned by other work packages)."""
    report = AssetReport(asset="catalogue.manifest", path="manifest.json")
    cat.reports["manifest"] = report
    doc, error, _ = read_json(cat.directory / "manifest.json")
    if error:
        report.status, report.reason = "invalid", f"manifest.json: {error}"
    elif not isinstance(doc, dict):
        report.fail("top level is not a JSON object")
    else:
        cat.manifest = doc
        for key in ("manifest_version", "catalogue_version", "dataset", "asset_status"):
            if key not in doc:
                report.missing(key)
        report.version = str(doc.get("manifest_version")) if doc.get("manifest_version") else None

    report = AssetReport(asset="catalogue.manual_presets", path="manual_presets.json")
    cat.reports["manual_presets"] = report
    doc, error, _ = read_json(cat.directory / "manual_presets.json")
    if error == "missing":
        report.status, report.reason = "pending", "manual_presets.json not delivered; no manual adjustments apply"
    elif error:
        report.status, report.reason = "invalid", f"manual_presets.json: {error}"
    else:
        cat.manual_presets = doc if isinstance(doc, dict) else {}
        _check_manual_presets(doc, report)

    report = AssetReport(asset="catalogue.indicators", path="indicators.json")
    cat.reports["indicators"] = report
    doc, error, _ = read_json(cat.directory / "indicators.json")
    if error == "missing":
        report.status, report.reason = "pending", "indicators.json not delivered; no standard indicator recipe is available"
    elif error:
        report.status, report.reason = "invalid", f"indicators.json: {error}"
    elif not isinstance(doc, dict) or not isinstance(doc.get("recipes"), list):
        report.missing("recipes")
    else:
        if not doc.get("version"):
            report.missing("version")
        cat.indicators, cat.indicators_version = {}, str(doc.get("version")) if doc.get("version") else None
        report.version = cat.indicators_version
        for pos, recipe in enumerate(doc["recipes"]):
            if not isinstance(recipe, dict) or not recipe.get("indicator_id"):
                report.missing(f"recipes[{pos}].indicator_id")
                continue
            cat.indicators[str(recipe["indicator_id"])] = recipe


def _check_manual_presets(doc: Any, report: AssetReport) -> None:
    """Manual adjustments: add / pin / priority / disable, each with a reason (spec §8.3)."""
    if not isinstance(doc, dict):
        report.fail("top level is not a JSON object")
        return
    if not doc.get("version"):
        report.missing("version")
    report.version = str(doc.get("version")) if doc.get("version") else None
    adjustments = doc.get("adjustments")
    if not isinstance(adjustments, list):
        report.missing("adjustments")
        return
    seen: set[str] = set()
    for pos, adj in enumerate(adjustments):
        where = f"adjustments[{pos}]"
        if not isinstance(adj, dict):
            report.fail(f"{where} is not a JSON object")
            continue
        for key in ("adjustment_id", "action", "reason"):
            if not adj.get(key):
                report.missing(f"{where}.{key}")
        if adj.get("action") and adj["action"] not in ADJUSTMENT_ACTIONS:
            report.fail(f"{where}.action {adj['action']!r} is not one of {', '.join(ADJUSTMENT_ACTIONS)}")
        if adj.get("adjustment_id") in seen:
            report.fail(f"duplicate adjustment_id {adj.get('adjustment_id')!r}")
        seen.add(str(adj.get("adjustment_id")))


def load_catalogue(directory: Path) -> Catalogue:
    """Read every catalogue file. Never raises for bad content; see ``Catalogue.reports``."""
    cat = Catalogue(directory=Path(directory))
    digest = hashlib.sha256()
    for asset in LIST_ASSETS:
        _load_list_asset(cat, asset, digest)
    cat.content_hash = digest.hexdigest()
    _load_policies(cat)
    _load_optional(cat)
    return cat


# --------------------------------------------------------------------------- validation helpers

def _require(entry: Mapping[str, Any], fields: Iterable[str], where: str, report: AssetReport) -> None:
    for name in fields:
        if name not in entry:
            report.missing(f"{where}.{name}")
        elif entry[name] in (None, "") and name not in NULLABLE:
            report.missing(f"{where}.{name}")


def _period_ok(entry: Mapping[str, Any], where: str, report: AssetReport) -> bool:
    start, end = entry.get("start"), entry.get("end")
    if not (is_ym(start) and is_ym(end)):
        report.fail(f"{where}: start/end must be YYYY-MM")
        return False
    if ym_to_index(start) > ym_to_index(end):
        report.fail(f"{where}: start {start} is after end {end}")
        return False
    return True


def _check_refs(ref_ids: Any, refs: Mapping[str, dict], where: str, report: AssetReport) -> None:
    if not isinstance(ref_ids, list):
        report.fail(f"{where} must be a list of ref ids")
        return
    for ref_id in ref_ids:
        if ref_id not in refs:
            report.fail(f"{where}: unknown ref id {ref_id!r}")


def is_standard_normal_period(start: str, end: str) -> bool:
    """WMO climatological standard normal: 30 consecutive years, 1 Jan of a year ending in 1 to 31 Dec of a year ending in 0."""
    a, b = ym_to_index(start), ym_to_index(end)
    return a % 12 == 0 and b % 12 == 11 and (a // 12) % 10 == 1 and b - a + 1 == 360


def product_layer_problem(product: Mapping[str, Any], layer: Mapping[str, Any] | None) -> tuple[str, str] | None:
    """Why a registered product cannot be served from the prepared data, as ``(item status, reason)``.

    Data contract §1: an unsupported calendar, unit or cadence is an explicit status;
    it is never read as an ordinary Gregorian monthly series.
    """
    from .series2 import SUPPORTED_CADENCES, SUPPORTED_CALENDARS

    pid = product.get("product_id")
    if layer is None:
        return "data_required", f"product {pid} has no prepared layer in catalog/variables.json"
    if product.get("cadence") not in SUPPORTED_CADENCES:
        return "unsupported_resolution", f"product {pid} has cadence {product.get('cadence')!r}; only monthly series are analysed"
    if product.get("calendar") not in SUPPORTED_CALENDARS:
        return "unsupported_resolution", f"product {pid} uses calendar {product.get('calendar')!r}; only the Gregorian calendar is supported"
    if layer.get("unit") != product.get("unit"):
        return ("unsupported_resolution",
                f"product {pid} is registered in {product.get('unit')!r} but the prepared layer is in "
                f"{layer.get('unit')!r}; no unit conversion is approved")
    return None


# --------------------------------------------------------------------------- per-asset validation

def _validate_refs(cat: Catalogue) -> None:
    report = cat.reports["refs"]
    for ref_id, ref in cat.items["refs"].items():
        where = f"refs[{ref_id}]"
        _require(ref, REF_FIELDS, where, report)
        if not (ref.get("url") or ref.get("doi")):
            report.missing(f"{where}.url|doi")
        if "verified" in ref and not isinstance(ref["verified"], bool):
            report.fail(f"{where}.verified must be true or false")


def _validate_products(cat: Catalogue, layers: Mapping[str, Mapping[str, Any]] | None) -> None:
    report = cat.reports["products"]
    refs, concepts = cat.items["refs"], cat.items["concepts"]
    for pid, product in cat.items["products"].items():
        where = f"products[{pid}]"
        _require(product, PRODUCT_FIELDS, where, report)
        _check_refs(product.get("source_refs", []), refs, f"{where}.source_refs", report)
        if concepts and product.get("variable_id") not in concepts:
            report.fail(f"{where}: variable_id {product.get('variable_id')!r} is not a registered concept")
        if "start" in product and "end" in product:
            _period_ok(product, where, report)
        if layers is None:
            continue
        layer = layers.get(pid)
        problem = product_layer_problem(product, layer)
        if problem:
            report.notes.append(f"{where}: {problem[1]}")
        elif (product.get("start"), product.get("end")) != (layer.get("start"), layer.get("end")):
            report.notes.append(f"{where}: registered record {product.get('start')}..{product.get('end')} differs from "
                                f"the delivered {layer.get('start')}..{layer.get('end')}; the delivered bounds are served")
    if layers is not None:
        for layer_id in layers:
            if layer_id not in cat.items["products"]:
                report.notes.append(f"prepared layer {layer_id!r} has no registered product; it is not served")


def _record_bounds(product: Mapping[str, Any], layer: Mapping[str, Any] | None) -> tuple[Any, Any]:
    """The record a product really has: the delivered layer bounds when the data is at hand."""
    source = layer if layer and is_ym(layer.get("start")) and is_ym(layer.get("end")) else product
    return source.get("start"), source.get("end")


def _validate_baselines(cat: Catalogue, layers: Mapping[str, Mapping[str, Any]] | None = None) -> None:
    report = cat.reports["baselines"]
    products, refs = cat.items["products"], cat.items["refs"]
    fraction = (cat.policies.get("quality_policy", {}).get("baseline", {}) or {}).get(
        "min_samples_per_calendar_month_fraction")
    for bid, base in cat.items["baselines"].items():
        where = f"baselines[{bid}]"
        _require(base, BASELINE_FIELDS, where, report)
        _check_refs(base.get("refs", []), refs, f"{where}.refs", report)
        if base.get("kind") != "seasonal_reference":
            report.fail(f"{where}: kind must be 'seasonal_reference' (recipe calibration baselines live in indicators.json)")
        if base.get("designation") not in DESIGNATIONS:
            report.fail(f"{where}: designation must be one of {', '.join(DESIGNATIONS)}")
        if not _period_ok(base, where, report):
            continue
        a, b = ym_to_index(base["start"]), ym_to_index(base["end"])
        if a % 12 != 0 or b % 12 != 11:
            report.fail(f"{where}: a seasonal reference must cover complete calendar years (Jan..Dec)")
        years = (b - a + 1) // 12
        standard = is_standard_normal_period(base["start"], base["end"])
        if base.get("designation") == "wmo_standard_normal" and not standard:
            report.fail(f"{where}: only a 30-year period such as 1991-01..2020-12 may be called wmo_standard_normal")
        minimum = base.get("minimum_samples")
        if not isinstance(minimum, int) or isinstance(minimum, bool) or minimum < 1 or minimum > years:
            report.fail(f"{where}: minimum_samples must be an integer between 1 and the {years} years of the period")
        elif isinstance(fraction, (int, float)) and minimum < math.ceil(fraction * years - 1e-9):
            report.fail(f"{where}: minimum_samples {minimum} is below the quality policy "
                        f"({fraction} of {years} years); a weaker requirement cannot be registered silently")
        product = products.get(base.get("product_id"))
        if product is None:
            report.fail(f"{where}: product_id {base.get('product_id')!r} is not a registered product")
        else:
            start, end = _record_bounds(product, (layers or {}).get(base.get("product_id")))
            if is_ym(start) and is_ym(end) and (a < ym_to_index(start) or b > ym_to_index(end)):
                report.fail(f"{where}: period {base['start']}..{base['end']} is outside the product record "
                            f"{start}..{end}")


def _validate_concepts(cat: Catalogue) -> None:
    report = cat.reports["concepts"]
    products, baselines, refs = cat.items["products"], cat.items["baselines"], cat.items["refs"]
    for vid, concept in cat.items["concepts"].items():
        where = f"concepts[{vid}]"
        _require(concept, CONCEPT_FIELDS, where, report)
        _check_refs(concept.get("scientific_refs", []), refs, f"{where}.scientific_refs", report)
        definition = concept.get("quantity_definition") or {}
        for key in ("quantity", "nature", "depth_or_height", "observed_or_modelled", "definition_class"):
            if not definition.get(key):
                report.missing(f"{where}.quantity_definition.{key}")
        if definition.get("nature") and definition["nature"] not in NATURES:
            report.fail(f"{where}.quantity_definition.nature must be one of {', '.join(NATURES)}")
        if concept.get("data_kind") not in DATA_KINDS:
            report.fail(f"{where}.data_kind must be one of {', '.join(DATA_KINDS)}")
        display = concept.get("display_semantics") or {}
        for key in DISPLAY_FIELDS:
            if key not in display:
                report.missing(f"{where}.display_semantics.{key}")
        _validate_relative_change(concept, where, report)
        _validate_approved_products(concept, where, products, baselines, report)


def _validate_relative_change(concept: Mapping[str, Any], where: str, report: AssetReport) -> None:
    """Spec §7.2: no slope/mean percentage unless the concept registers a sensible denominator."""
    relative = concept.get("relative_change")
    if relative is None:
        return
    if not isinstance(relative, dict) or not relative.get("denominator") or not relative.get("condition"):
        report.fail(f"{where}.relative_change must be null or carry denominator and condition")
        return
    nature = (concept.get("quantity_definition") or {}).get("nature")
    unit = str(concept.get("unit", ""))
    if unit == "°C" or "anomaly" in str(concept.get("variable_id", "")) or nature == "index":
        report.fail(f"{where}.relative_change is not allowed for °C, anomaly or index quantities")


def _validate_approved_products(
    concept: Mapping[str, Any], where: str, products: Mapping[str, dict], baselines: Mapping[str, dict],
    report: AssetReport,
) -> None:
    """Spec §6.1: approved fallbacks share concept, unit, temporal support and definition class."""
    approved = concept.get("approved_product_ids")
    if not isinstance(approved, list) or not approved:
        report.fail(f"{where}: approved_product_ids must list at least one product (first = primary)")
        return
    if len(set(approved)) != len(approved):
        report.fail(f"{where}: approved_product_ids contains duplicates")
    baseline_ref = concept.get("baseline_ref") if isinstance(concept.get("baseline_ref"), dict) else {}
    definition_class = (concept.get("quantity_definition") or {}).get("definition_class")
    for pid in approved:
        product = products.get(pid)
        if product is None:
            report.fail(f"{where}: approved product {pid!r} is not registered")
            continue
        for key, expected in (("variable_id", concept.get("variable_id")), ("unit", concept.get("unit")),
                              ("temporal_support", concept.get("temporal_support")),
                              ("definition_class", definition_class)):
            if product.get(key) != expected:
                report.fail(f"{where}: approved product {pid!r} has {key} {product.get(key)!r}, "
                            f"the concept requires {expected!r}; it cannot be a fallback")
        bid = baseline_ref.get(pid)
        if bid is None:
            report.missing(f"{where}.baseline_ref.{pid}")
        elif bid not in baselines:
            report.fail(f"{where}: baseline {bid!r} for product {pid!r} is not registered")
        elif baselines[bid].get("product_id") != pid:
            report.fail(f"{where}: baseline {bid!r} is registered for product "
                        f"{baselines[bid].get('product_id')!r}, not {pid!r}")
    for pid in baseline_ref:
        if pid not in approved:
            report.fail(f"{where}.baseline_ref names {pid!r}, which is not an approved product")


def _validate_phenomena(cat: Catalogue) -> None:
    report = cat.reports["phenomena"]
    concepts, refs = cat.items["concepts"], cat.items["refs"]
    for pid, phen in cat.items["phenomena"].items():
        where = f"phenomena[{pid}]"
        _require(phen, PHENOMENON_FIELDS, where, report)
        aliases = phen.get("aliases")
        if not isinstance(aliases, dict) or not aliases.get("zh") or not aliases.get("en"):
            report.missing(f"{where}.aliases.zh|en")
        links = phen.get("variable_links")
        if not isinstance(links, list):
            report.fail(f"{where}.variable_links must be a list")
            links = []
        seen: set[str] = set()
        for pos, link in enumerate(links):
            lw = f"{where}.variable_links[{pos}]"
            if not isinstance(link, dict):
                report.fail(f"{lw} is not a JSON object")
                continue
            _require(link, LINK_FIELDS, lw, report)
            if link.get("variable_id") not in concepts:
                report.fail(f"{lw}: variable_id {link.get('variable_id')!r} is not a registered concept")
            if link.get("role") not in ROLES:
                report.fail(f"{lw}: role must be one of {', '.join(ROLES)}")
            if link.get("variable_id") in seen:
                report.fail(f"{lw}: variable {link.get('variable_id')!r} is linked twice")
            seen.add(str(link.get("variable_id")))
            _check_refs(link.get("ref_ids", []), refs, f"{lw}.ref_ids", report)
        _check_refs(phen.get("ref_ids", []), refs, f"{where}.ref_ids", report)
        if not links and not phen.get("indicator_ids") and not phen.get("unanswerable_notes"):
            report.fail(f"{where}: a phenomenon without variables or recipes must say why in unanswerable_notes")
        if cat.indicators is not None:
            for indicator_id in phen.get("indicator_ids") or []:
                if indicator_id not in cat.indicators:
                    report.fail(f"{where}: indicator {indicator_id!r} is not in the delivered indicator registry")


def validate_catalogue(cat: Catalogue, layers: Mapping[str, Mapping[str, Any]] | None = None) -> dict[str, AssetReport]:
    """Run every integrity check; ``layers`` is ``catalog/variables.json['layers']`` when the data is at hand."""
    _validate_refs(cat)
    _validate_products(cat, layers)
    _validate_baselines(cat, layers)
    _validate_concepts(cat)
    _validate_phenomena(cat)
    for report in cat.reports.values():
        report.finish()
    return cat.reports
