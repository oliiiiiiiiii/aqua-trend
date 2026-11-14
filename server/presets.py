"""Versioned candidate registration and descriptive ranking before case selection."""
import json
import math
from pathlib import Path
from .errors import ResearchError
from .store import digest

DEFAULT_POLICY = Path(__file__).with_name("policies") / "presets.json"


class PresetPolicy:
    def __init__(self, path=None):
        self.data = json.loads(Path(path or DEFAULT_POLICY).read_text())
        self.version = self.data["version"] + "-" + digest(self.data)[:16]
        self.weights = self.data["weights"]
        if set(self.weights) != {"relevance", "effect", "quality", "stability"} or any(
            not 0 <= w <= 1 for w in self.weights.values()
        ) or not math.isclose(sum(self.weights.values()), 1.0):
            raise ValueError("Invalid preset score weights")

    def candidates(self, catalogue, plan, region, period):
        regions = [region] if region else self.data["regions"]
        candidates = {}
        for r in regions:
            if r not in catalogue.regions:
                raise ValueError("Unknown registered preset region: " + r)
            windows = [period] if period else list(self.data["windows"])
            if not period:
                domains = []
                for v in plan["variable_set"]:
                    product, _ = catalogue.resolve(r, v["variable_id"], None, plan["indicator_recipe_ids"])
                    if product.get("available_period"):
                        domains.append(product["available_period"])
                if domains:
                    start, end = max(p["start"] for p in domains), min(p["end"] for p in domains)
                    if start <= end:
                        windows.append({"start": start, "end": end})
            for window in windows:
                key = (r, window["start"], window["end"])
                candidates[key] = {"region_id": r, "period": window, "source": "automatic"}
        for override in self.data.get("overrides", []):
            if override.get("phenomenon_id") not in (None, plan["phenomenon_id"]):
                continue
            r, w = override["region_id"], override["period"]
            if r not in catalogue.regions or w["start"] > w["end"]:
                raise ValueError("Invalid manual preset")
            if (region and r != region) or (period and w != period):
                continue
            candidates[r, w["start"], w["end"]] = {**override, "source": "manual"}
        return list(candidates.values())

    def score(self, result):
        variables = result["variables"]
        measures = []
        for v in variables:
            importance = {"core_indicator": 1.0, "related_condition": .75, "response": .5}.get(v["role"], .5)
            measures.append((v, importance))
        for i in result["indicators"]:
            metrics = i.get("metrics") or []
            for m in metrics:
                measures.append((m, 1 / len(metrics)))
        total = sum(w for _, w in measures)
        components = dict.fromkeys(self.weights, 0.0)
        available = 0
        unscaled = 0
        for item, weight in measures:
            t = item.get("trend") or {}
            slope = t.get("slope_per_decade")
            if slope is None:
                continue
            available += 1
            components["relevance"] += weight
            components["quality"] += weight * min(1, max(0, t.get("coverage") or 0))
            scale = t.get("baseline_scale")
            if scale and scale > 0:
                components["effect"] += weight * min(1, abs(slope) / scale)
            else:
                unscaled += 1
            halves = t.get("split_slopes_per_year") or []
            if len(halves) == 2 and all(h is not None and h * slope > 0 for h in halves):
                components["stability"] += weight
        if available == 0:
            return None
        components = {k: round(v/total, 6) for k, v in components.items()}
        score = round(sum(components[k] * self.weights[k] for k in components), 6)
        return {"score": score, "components": components, "unscaled_metrics": unscaled,
                "reason": f"{available} trend estimates supported this case. Its weighted effect, coverage, relevance and stability score is {score:.2f}."}

    def choose(self, candidates):
        eligible = [c for c in candidates if c.get("score") is not None]
        if not eligible:
            raise ResearchError("no_matching_preset", "No registered case supports these selections. Choose a region and period to inspect the available data.", "preset")
        return max(eligible, key=lambda c: (bool(c.get("pinned")), c.get("priority", 0), c["score"]))
