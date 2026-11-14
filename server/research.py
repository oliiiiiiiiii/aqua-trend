"""Shared study pipeline used for a manual query, every search candidate and replay."""
import logging
from pathlib import Path
import re
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from .catalogue import Catalogue, SelectorError
from .errors import ResearchError
from .evidence import METHOD_VERSION, attach, family, ledger
from .indicators import analyze_indicator
from .presets import PresetPolicy
from .science import analyze_series
from .store import Store, digest

MONTH = re.compile(r"(?!0000)[0-9]{4}-(0[1-9]|1[0-2])\Z")
ROOT = Path(__file__).resolve().parents[1]


def validate_request(data, regions):
    if not isinstance(data, dict) or set(data) - {"phenomenon_query", "region_id", "period", "context", "reselect"}:
        raise ResearchError("invalid_request", "Supply a phenomenon, one optional region and an optional month range.")
    q = data.get("phenomenon_query")
    if not isinstance(q, str) or not q.strip() or len(q) > 1000:
        raise ResearchError("invalid_phenomenon", "Enter a phenomenon in 1–1,000 characters.", "phenomenon_query")
    region, period = data.get("region_id"), data.get("period")
    if region is not None and (not isinstance(region, str) or region not in regions):
        raise ResearchError("invalid_region", "Choose a single region from the region catalogue.", "region_id")
    if period is not None and (not isinstance(period, dict) or set(period) != {"start", "end"}
                               or not all(isinstance(m, str) and MONTH.fullmatch(m) for m in period.values())
                               or period["start"] > period["end"]):
        raise ResearchError("invalid_period", "Choose both months with the end on or after the start.", "period")
    ctx = data.get("context") if "context" in data else {}
    if not isinstance(ctx, dict) or set(ctx) - {"parent_research_id", "preset_ref"}:
        raise ResearchError("invalid_context", "Invalid study reference.", "context")
    ref, parent = ctx.get("preset_ref"), ctx.get("parent_research_id")
    if ref is not None and (not isinstance(ref, dict) or set(ref) != {"id", "version"} or not all(
            isinstance(s, str) and 0 < len(s) <= 150 for s in ref.values())):
        raise ResearchError("invalid_context", "Invalid preset reference.", "context")
    if parent is not None and (not isinstance(parent, str) or not re.fullmatch(r"[0-9a-f]{32}", parent)):
        raise ResearchError("invalid_context", "Invalid parent study.", "context")
    reselect = data.get("reselect", False)
    if not isinstance(reselect, bool) or (reselect and ref):
        raise ResearchError("invalid_context", "A fresh selection cannot replay a frozen preset.", "reselect")
    return {"phenomenon_query": q.strip(), "region_id": region, "period": period, "reselect": reselect,
            "context": {"preset_ref": ref, "parent_research_id": parent}}


def normalized(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def common_period(regions, period):
    if not regions:
        return None
    start = max([period["start"]] + [p["start"] for p in regions])
    end = min([period["end"]] + [p["end"] for p in regions])
    return {"start": start, "end": end} if start <= end else None


class ResearchEngine:
    def __init__(self, catalogue=None, store=None, policy=None):
        self.catalogue = catalogue or Catalogue()
        self.store = store or Store(ROOT / ".aqua-trend/jobs.sqlite")
        self.policy = policy or PresetPolicy()
        self.versions = {**self.catalogue.versions, "method_policy_version": METHOD_VERSION,
                         "preset_policy_version": self.policy.version}
        self.selection_lock = threading.Lock()

    def validate(self, data):
        req = validate_request(data, self.catalogue.regions)
        ctx = req["context"]
        if ctx["parent_research_id"] and not self.store.job(ctx["parent_research_id"]):
            raise ResearchError("invalid_context", "The parent study was not found.", "context")
        if ctx["preset_ref"]:
            self.bound_preset(req)
        return req

    def bound_preset(self, req):
        ref = req["context"]["preset_ref"]
        snapshot = self.store.get("preset", ref["id"] + ":" + ref["version"])
        if snapshot:
            p = snapshot["public"]
            if (normalized(req["phenomenon_query"]) == normalized(p["phenomenon_query"]) and
                req["region_id"] in (None, p["region_id"]) and req["period"] in (None, p["period"])):
                return snapshot
        raise ResearchError("invalid_context", "That preset does not match the selected phenomenon, region or period.", "context")

    def select(self, query, fresh=False):
        key = digest([normalized(query), self.catalogue.versions])
        # Concurrent identical queries reuse the persisted plan even for stochastic selectors.
        with self.selection_lock:
            saved = self.store.get("plan", key)
            if fresh:
                plan = self.catalogue.select(query, reselect=True)
                return self.store.remember("plan_revision", plan["selection_plan_id"], plan)
            if saved is not None:
                return saved
            return self.store.remember("plan", key, self.catalogue.select(query))

    def study(self, plan, region, period, requested_period):
        cat = self.catalogue
        products, series = {}, {}
        for v in plan["variable_set"]:
            vid = v["variable_id"]
            products[vid], s = cat.resolve(region, vid, period, plan["indicator_recipe_ids"])
            if s is not None:
                series[vid] = s
        domains = {vid: products[vid]["available_period"] for vid in series if products[vid].get("available_period")}
        complete = [vid for vid, d in domains.items() if d["start"] <= period["start"] and d["end"] >= period["end"]]
        # Fully supporting products take priority. Partial histories do not shorten their comparison.
        qualified = complete or [vid for vid, d in domains.items() if common_period([d], period)]
        fit = common_period([domains[v] for v in qualified], period)
        variables = []
        for v in plan["variable_set"]:
            vid = v["variable_id"]
            product = products[vid]
            c = cat.concepts[vid]
            s = series.get(vid)
            if s is not None:
                base = cat.baselines[s["baseline_ref"]]
                details = analyze_series(s, base, fit if vid in qualified else None, requested_period=requested_period)
                if vid not in qualified and fit and product.get("reason"):
                    details["reason"] = product["reason"]
            else:
                details = {"status": product["status"], "reason": product.get("reason"),
                           "full_history": {"times": [], "values": [], "anomalies": [], "fitted": []},
                           "requested_period": requested_period, "analysis_period": None, "actual_support": None,
                           "seasonal_pattern": [], "baseline": None, "trend": None}
            product = dict(product)
            pid = product.get("selected_product_id")
            if pid:
                meta = cat.products[pid]
                product.setdefault("label", meta.get("label") or meta.get("name") or pid)
                product.setdefault("source", meta.get("scientific_refs", []))
            variables.append({**v, "label": c["label"], "unit": c["unit"], "product": product,
                              "selection_reason": v["reason"], "scientific_refs": c.get("scientific_refs", []), **details})
        indicators = []
        for rid in plan["indicator_recipe_ids"]:
            recipe = cat.recipes[rid]
            event = cat.event_catalogue(plan["phenomenon_id"], region, period) if rid.startswith("recorded") else None
            out = analyze_indicator(recipe, series, event, region, period, requested_period=requested_period)
            out["recipe"] = dict(recipe)
            out["indicator_id"] = rid
            out["label"] = recipe["label"]
            out["evidence_source"] = {"inputs": {v: s["product_id"] for v, s in series.items()
                                                   if v in recipe.get("required_variables", [])},
                                      "event": {k: event.get(k) for k in ("catalogue_id","version","coverage_version")}
                                      if event else None, "recipe_version": recipe.get("version")}
            indicators.append(out)
        if not indicators:
            indicators.append({"kind": "derived_indicator", "status": "definition_required",
                               "reason": "No registered indicator definition applies to this phenomenon.",
                               "recipe": {"indicator_id": "unregistered", "label": "Phenomenon indicator"},
                               "metrics": [], "events": []})
        return {"variables": variables, "indicators": indicators,
                "comparison": {"period": fit, "variable_ids": qualified if fit else [],
                               "reason": (None if fit == period else "The available records support a shorter shared interval."
                                          if fit else "No shared period is available."),
                               "requested_period": requested_period, "resolved_period": period}}

    def search(self, req, plan, progress):
        candidates = self.policy.candidates(self.catalogue, plan, req["region_id"], req["period"])
        log, rows = [], []
        for index, candidate in enumerate(candidates):
            progress("resolving_defaults", index, len(candidates))
            case = dict(candidate)
            if case.get("disabled"):
                case["excluded_reason"] = "Disabled by the registered preset policy."
            else:
                result = self.study(plan, case["region_id"], case["period"], req["period"])
                rows.extend(ledger(result, self.versions, case["region_id"], case["period"]))
                score = self.policy.score(result)
                if score and (req["period"] is not None or result["comparison"]["period"] == case["period"] or
                              (not result["comparison"]["period"] and any(i.get("status") == "ok" for i in result["indicators"]))):
                    case.update(score)
                else:
                    case["excluded_reason"] = "Insufficient support for this candidate window."
            log.append(case)
        f = family("preset_search", rows, log, self.policy.version)
        try:
            chosen = self.policy.choose(log)
        except ResearchError as error:
            error.payload["evidence_family"] = f
            raise
        public = {**chosen, "id": "case-" + digest([plan["selection_plan_id"], chosen["region_id"], chosen["period"]])[:20],
                  "version": digest([f["family_id"], self.versions, plan["content_hash"], normalized(req["phenomenon_query"])])[:24],
                  "region_name": self.catalogue.regions[chosen["region_id"]]["name"],
                  "phenomenon_query": req["phenomenon_query"], "family_id": f["family_id"]}
        if chosen.get("source") == "manual" and chosen.get("manual_reason"):
            public["reason"] = chosen["manual_reason"] + " " + public["reason"]
        return {"public": public, "family": f, "versions": self.versions, "selection": plan}

    def run(self, job, progress):
        req = job["request"]
        progress("selecting_variables")
        bound = self.bound_preset(req) if req["context"]["preset_ref"] else None
        exact = bool(bound and bound["versions"] == self.versions)
        plan = bound["selection"] if exact else None
        parent = req["context"]["parent_research_id"]
        if parent and not plan and not req.get("reselect"):
            previous = self.store.job(parent)["result"]
            if (previous and previous["identity"]["versions"] == self.versions and
                normalized(previous["user_constraints"]["phenomenon_query"]) == normalized(req["phenomenon_query"])):
                plan = previous["selection"]
        if plan is None:
            plan = self.select(req["phenomenon_query"], req.get("reselect", False))
        if not plan["variable_set"] and not plan["indicator_recipe_ids"]:
            raise ResearchError("unsupported_phenomenon", "The prepared catalogue has no supported measurements or indicators for this phenomenon.", "phenomenon_query")
        progress("resolving_defaults")
        snapshot = bound
        if not bound and (req["region_id"] is None or req["period"] is None):
            search_key = digest([self.versions, normalized(req["phenomenon_query"]), plan["selection_plan_id"],
                                 req["region_id"], req["period"]])
            ref = self.store.get("completed_search", search_key)
            if ref:
                snapshot = self.store.get("preset", ref)
            if not snapshot:
                snapshot = self.search(req, plan, progress)
                snapshot["search_key"] = search_key
        preset = snapshot["public"] if snapshot else None
        region = req["region_id"] or preset["region_id"]
        period = req["period"] or preset["period"]
        progress("resolving_products")
        progress("analyzing")
        result = self.study(plan, region, period, req["period"])
        progress("correcting")
        rows = ledger(result, self.versions, region, period)
        families = [family("query", rows, [{"region_id": region, "period": period}], METHOD_VERSION)]
        if snapshot and snapshot["versions"] == self.versions:
            families.append(snapshot["family"])
        warnings = list(plan.get("limitations") or [])
        if bound and not exact:
            warnings.append("The referenced search used an earlier version. Its evidence is available in the original study.")
        if result["comparison"]["reason"]:
            warnings.append(result["comparison"]["reason"])
        attach(result, families)
        progress("explaining")
        summary = []
        for v in result["variables"]:
            t = v.get("trend") or {}
            if t.get("slope_per_decade") is not None:
                slope = t["slope_per_decade"]
                message = ("Adjusted evidence supports this trend." if t.get("significant") is True else
                           "The adjusted result is not statistically significant." if t.get("significant") is False else
                           "Statistical inference is unavailable.")
                summary.append({"text": f"{v['label']}: {slope:+.3g} {v['unit']} per decade. {message}",
                                "evidence_ids": [v["hypothesis_id"]]})
        for indicator in result["indicators"]:
            if indicator["status"] != "ok":
                warnings.append(indicator.get("reason") or indicator["status"])
            for metric in indicator.get("metrics", []):
                t = metric.get("trend") or {}
                if t.get("slope_per_decade") is not None:
                    summary.append({"text": f"{indicator['label']} · {metric['label']}: {t['slope_per_decade']:+.3g} {metric['unit']} per decade.",
                                    "evidence_ids": [metric["hypothesis_id"]]})
        partial = any(x["status"] != "ok" for x in result["variables"] + result["indicators"])
        status = "partial" if partial or plan["status"] == "partial" or result["comparison"]["reason"] else "complete"
        study = {**result, "identity": {"id": job["id"], "created_at": job["created"], "status": status,
                                        "versions": self.versions},
                 "user_constraints": req, "selection": plan, "resolved": {"region_id": region,
                    "region_name": self.catalogue.regions[region]["name"], "period": period,
                    "region_source": "user" if req["region_id"] else "preset",
                    "period_source": "user" if req["period"] else "preset", "preset": preset},
                 "baselines": [v["baseline"] for v in result["variables"] if v.get("baseline")],
                 "evidence_families": families, "summary": summary, "warnings": warnings}
        return study, snapshot if snapshot and not bound else None


class Cancelled(Exception):
    pass


class ResearchService:
    def __init__(self, engine, workers=2):
        self.engine = engine
        self.store = engine.store
        self.store.resume_after_restart()
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="research")

    def submit(self, data):
        req = self.engine.validate(data)
        job = self.store.add_job(req)
        self.pool.submit(self.execute, job)
        return job

    def execute(self, job):
        def progress(stage, completed=0, total=1):
            if not self.store.advance(job["id"], stage, completed, total):
                raise Cancelled()
        try:
            result, preset = self.engine.run(job, progress)
            self.store.finish(job["id"], result["identity"]["status"], result=result, preset=preset)
        except Cancelled:
            pass
        except ResearchError as exc:
            self.store.finish(job["id"], "failed", error=exc.payload)
        except SelectorError as exc:
            self.store.finish(job["id"], "failed", error={"code": exc.code, "message": str(exc),
                              "retryable": exc.retryable, "field": "phenomenon_query"})
        except Exception:
            logging.exception("Study %s failed", job["id"])
            self.store.finish(job["id"], "failed", error={"code": "analysis_failed", "message":
                              "Analysis could not finish. Retry this study.", "retryable": True})
