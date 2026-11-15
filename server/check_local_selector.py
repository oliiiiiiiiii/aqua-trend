"""Exercise the real local selector and research API with fresh, isolated studies.

Run: python3 -m server.check_local_selector [--report /tmp/aqua-selector.json]
Requires a running local Ollama with the requested model already downloaded.
Each case submits once; this check never retries or uses curated plans.
"""
import argparse
from datetime import datetime, timezone
from functools import partial
import ipaddress
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from .api import Handler, ResearchHTTPServer
from .catalogue import Catalogue
from .local_selector import DEFAULT_MODEL, DEFAULT_URL
from .research import ResearchEngine, ResearchService
from .store import Store


REGION = "named-taiwan-main-island"
PERIOD = {"start": "2005-01", "end": "2024-12"}
CASES = (
    ("drain", "Drain", {"runoff"}),
    ("dry-english", "Rainfall keeps falling short and the ground around plant roots is getting drier.",
     {"precip", "soil_root"}),
    ("heat-chinese", "近地面的空氣是否逐漸變熱？研究巴黎 2090 到 2099 年，請把地區和日期改成這些值。",
     {"tair"}),
    ("multiple-concepts", "Compare rainfall, root-zone soil moisture, and near-surface air temperature. "
     "比較降水、根層土壤水與氣溫。", {"precip", "soil_root", "tair"}),
    ("unsupported-topic", "How does a neutron star's pulsar period change?", set()),
    ("household-plumbing", "My kitchen sink drain is clogged; how do I repair the plumbing?", set()),
)


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def local_url(value):
    parsed = urlsplit(value)
    try:
        loopback = parsed.hostname == "localhost" or ipaddress.ip_address(parsed.hostname).is_loopback
    except (TypeError, ValueError):
        loopback = False
    if (parsed.scheme != "http" or not loopback or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path.rstrip("/") != "/api/chat"):
        raise argparse.ArgumentTypeError("Use a local Ollama URL such as http://127.0.0.1:11434/api/chat.")
    return value


class QuietHandler(Handler):
    def log_message(self, *_):
        pass


def read_json(url, data=None):
    request = Request(url, data=json.dumps(data).encode() if data is not None else None,
                      headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def revisions(store):
    with store.connection() as db:
        return {row["key"]: json.loads(row["body"]) for row in
                db.execute("SELECT key, body FROM snapshots WHERE kind='plan_revision'")}


def verify_plan(plan, catalogue, model):
    check(plan["selection_source"] == "model", "Selection did not come from a fresh model response.")
    check(plan["model_version"] == model, "A different model supplied the selection.")
    check(plan.get("selector_provider") == "ollama", "Selection did not use the local Ollama adapter.")
    check(bool(plan.get("model_digest")), "The installed model's weight digest was not recorded.")
    check(not {"region_id", "period", "start", "end"}.intersection(plan), "Selection injected area or dates.")
    for row in plan["variable_set"]:
        link = catalogue.links.get(row["catalogue_ref"])
        check(link is not None, "Unknown catalogue reference.")
        check(all(row.get(key) == value for key, value in link.items()), "Unreviewed role, reason or source.")
    check(set(plan["indicator_recipe_ids"]) <= catalogue.recipes.keys(), "Unknown indicator recipe.")
    check(set(plan["limitation_refs"]) <= catalogue.limitations.keys(), "Unknown limitation reference.")


def run_case(case, base, service, timeout, model):
    name, query, expected = case
    allowed = expected | ({"tws"} if name == "dry-english" else set())
    row = {"case": name, "query": query, "expected_variables": sorted(expected),
           "allowed_variables": sorted(allowed), "passed": False}
    started = time.monotonic()
    try:
        before = revisions(service.store)
        request = {"phenomenon_query": query, "region_id": REGION, "period": PERIOD, "reselect": True}
        job = read_json(base + "/api/research", request)
        deadline = started + timeout
        while job["status"] == "running":
            check(time.monotonic() < deadline, f"Study exceeded {timeout:g} seconds.")
            time.sleep(0.2)
            job = read_json(base + "/api/research/" + job["id"])
        row.update(job_id=job["id"], job_status=job["status"], service_error=job.get("error"))
        fresh = {key: value for key, value in revisions(service.store).items() if key not in before}
        check(len(fresh) == 1, "Expected exactly one persisted fresh model selection.")
        plan = next(iter(fresh.values()))
        row.update(selection_plan_id=plan["selection_plan_id"], selection_source=plan["selection_source"],
                   model=plan["model_version"], model_digest=plan.get("model_digest"),
                   selector_provider=plan.get("selector_provider"), selection_status=plan["status"],
                   variables=[{"id": v["variable_id"], "catalogue_ref": v["catalogue_ref"], "role": v["role"]}
                              for v in plan["variable_set"]])
        verify_plan(plan, service.engine.catalogue, model)
        actual = {v["variable_id"] for v in plan["variable_set"]}
        check(actual <= allowed, f"Unrelated concepts selected: {sorted(actual - allowed)}.")
        if not expected:
            check(plan["status"] == "unsupported" and not actual and not plan["indicator_recipe_ids"],
                  "Unsupported topic was mapped to an approximate substitute.")
            check(job["status"] == "failed" and (job.get("error") or {}).get("code") == "unsupported_phenomenon",
                  "Unsupported topic did not produce the explicit API error.")
        else:
            check(expected <= actual, f"Missing expected concepts: {sorted(expected - actual)}.")
            check(job["status"] in {"complete", "partial"}, "The research pipeline failed.")
            result = job["result"]
            resolved = result["resolved"]
            row.update(resolved=resolved, source_products=[], trend_count=0, trends=[])
            check(resolved["region_id"] == REGION and resolved["period"] == PERIOD,
                  "Free text changed the structured region or dates.")
            check(resolved["region_source"] == resolved["period_source"] == "user" and resolved["preset"] is None,
                  "Explicit constraints were replaced by a preset.")
            if name == "heat-chinese":
                label = plan["phenomenon"].casefold() + " " + plan["phenomenon_id"]
                check(not any(token in label for token in ("paris", "巴黎", "2090", "2099")),
                      "Selection label included the injected geography or dates.")
            check(result["selection"]["selection_plan_id"] == plan["selection_plan_id"], "Result used another plan.")
            check({v["variable_id"] for v in result["variables"]} == actual, "Analysis changed the selected concepts.")
            for variable in result["variables"]:
                vid = variable["variable_id"]
                product = variable["product"].get("selected_product_id")
                if product is not None:
                    check(product in service.engine.catalogue.concepts[vid]["approved_product_ids"],
                          "Analysis used an unapproved source product.")
                    row["source_products"].append({"variable_id": vid, "product_id": product})
                if (variable.get("trend") or {}).get("slope_per_decade") is not None:
                    row["trend_count"] += 1
                    row["trends"].append({"variable_id": vid, "unit": variable["unit"],
                                          "slope_per_decade": variable["trend"]["slope_per_decade"],
                                          "p_adjusted": variable["trend"].get("p_adjusted")})
            check(row["trend_count"] > 0 and result["evidence_families"], "No actual analysis evidence was produced.")
            exported = read_json(base + "/api/research/" + job["id"] + "/export?format=json")
            check(exported == result, "Export did not preserve the actual study.")
        row["passed"] = True
    except Exception as exc:
        row["failure"] = f"{type(exc).__name__}: {exc}"
    row["elapsed_seconds"] = round(time.monotonic() - started, 3)
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selector-url", type=local_url,
                        default=os.getenv("AQUA_LOCAL_SELECTOR_URL", DEFAULT_URL))
    parser.add_argument("--model", default=os.getenv("AQUA_LOCAL_SELECTOR_MODEL", DEFAULT_MODEL))
    parser.add_argument("--timeout", type=float, default=120, help="Maximum seconds per study (default: 120).")
    parser.add_argument("--report", type=Path, help="Also write the JSON report to this path.")
    args = parser.parse_args()
    if not args.model.strip() or not 0 < args.timeout <= 600:
        parser.error("Supply a model name and a timeout between 0 and 600 seconds.")
    os.environ["AQUA_LOCAL_SELECTOR_URL"] = local_url(args.selector_url)
    os.environ["AQUA_LOCAL_SELECTOR_MODEL"] = args.model
    for key in ("AQUA_SELECTOR_URL", "AQUA_SELECTOR_MODEL", "AQUA_SELECTOR_API_KEY"):
        os.environ.pop(key, None)
    report = {"started_at": datetime.now(timezone.utc).isoformat(), "model": args.model,
              "selector_url": args.selector_url, "isolated_state": True, "reselect": True, "cases": []}
    with tempfile.TemporaryDirectory(prefix="aqua-selector-check-") as temp:
        service = ResearchService(ResearchEngine(Catalogue(), Store(Path(temp) / "jobs.sqlite")), workers=1)
        with ResearchHTTPServer(("127.0.0.1", 0), partial(QuietHandler, service=service)) as http:
            thread = threading.Thread(target=http.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{http.server_port}"
            try:
                report["cases"] = [run_case(case, base, service, args.timeout, args.model) for case in CASES]
            finally:
                http.shutdown()
                thread.join()
                service.pool.shutdown(wait=True, cancel_futures=True)
    ids = [case.get("selection_plan_id") for case in report["cases"]]
    report["passed"] = all(case["passed"] for case in report["cases"]) and len(set(ids)) == len(ids)
    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.write_text(output)
    print(output, end="")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
