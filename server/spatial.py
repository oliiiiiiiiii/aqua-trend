"""Descriptive peer-region trends for the exact release, product and window of a saved study."""
from functools import lru_cache
from threading import Lock

from .catalogue import AssetError
from .errors import ResearchError
from .evidence import METHOD_VERSION
from .science import METHOD_POLICY, analyze_series, month_number


def _fitted_window(period):
    if isinstance(period, dict):
        try:
            if month_number(period.get("start")) <= month_number(period.get("end")):
                return {"start": period["start"], "end": period["end"]}
        except ValueError:
            pass
    return None


class SpatialTrends:
    def __init__(self, catalogue):
        self.catalogue = catalogue
        # Each catalogue instance owns one immutable release; cache only completed layer fits.
        self._cached_layer = lru_cache(maxsize=32)(self._fit_layer)
        self._lock = Lock()

    def _fit_layer(self, layer, variable_id, product_id, baseline_id, start, end):
        cat = self.catalogue
        period = {"start": start, "end": end}
        regions = []
        total = 0
        for rid, region in cat.regions.items():
            if region["type"] != layer:
                continue
            total += 1
            if product_id not in region["product_ids"] or region.get("centroid") is None:
                continue
            try:
                series = cat.product_series(rid, product_id, variable_id)
            except AssetError:
                continue
            if series["baseline_ref"] != baseline_id or series["times"][0] > start or series["times"][-1] < end:
                continue
            analysis = analyze_series(series, cat.baselines[baseline_id], period)
            trend = analysis["trend"]
            if trend["slope_per_decade"] is not None and trend["coverage"] >= METHOD_POLICY["min_coverage"]:
                regions.append({"region_id": rid, "name": region["name"], "centroid": region["centroid"],
                                "slope_per_decade": trend["slope_per_decade"]})
        return total, regions

    def for_study(self, study, variable_id):
        variable = next((v for v in study.get("variables") or [] if v.get("variable_id") == variable_id), None)
        if variable is None:
            raise ResearchError("unknown_study_variable", "Choose a variable included in this study.", "variable")
        cat = self.catalogue
        versions = study["identity"].get("versions") or {}
        resolved = study["resolved"]
        region = cat.regions.get(resolved["region_id"])
        if versions.get("region_catalogue_version") != cat.versions["region_catalogue_version"]:
            region = None
        selected = {"region_id": resolved["region_id"], "name": resolved.get("region_name") or resolved["region_id"],
                    "layer": region["type"] if region else None, "centroid": region.get("centroid") if region else None,
                    "slope_per_decade": (variable.get("trend") or {}).get("slope_per_decade")}
        product_id = (variable.get("product") or {}).get("selected_product_id")
        period = _fitted_window(variable.get("analysis_period"))
        unit = variable.get("unit") or (variable.get("trend") or {}).get("unit") or ""
        response = {"study_id": study["identity"]["id"], "variable_id": variable_id, "product_id": product_id,
                    "period": period, "unit": unit, "selected": selected, "layer": None,
                    "regions": [], "total_regions": 0, "reason": None}
        if not product_id or not period:
            return {**response, "reason": "The study has no fitted window or selected product for this variable."}
        release_keys = ("dataset_version", "baseline_version", "quality_policy_version", "catalogue_version")
        compatible_release = all(versions.get(k) == cat.versions[k] for k in release_keys)
        if not region or not compatible_release or versions.get("method_policy_version") != METHOD_VERSION:
            return {**response, "reason": "The data, boundaries or analysis method for this saved study differ from the installed release."}
        concept = cat.concepts.get(variable_id, {})
        if product_id not in concept.get("approved_product_ids", ()) or unit != concept.get("unit"):
            return {**response, "reason": "The saved product or measurement unit is unavailable for regional comparison."}
        baseline_id = (variable.get("baseline") or {}).get("baseline_id")
        if baseline_id not in cat.baselines:
            return {**response, "reason": "The saved seasonal reference is unavailable for regional comparison."}
        layer = "basin3"
        if variable_id == "sst" or region.get("surface") == "ocean":
            layer = "lme"
        elif region["type"] == "ice":
            layer = "ice"
        with self._lock:
            total, peers = self._cached_layer(layer, variable_id, product_id, baseline_id, period["start"], period["end"])
        return {**response, "layer": layer, "total_regions": total, "regions": peers,
                "reason": None if peers else "No peer region has sufficient coverage for this product and fitted window."}
