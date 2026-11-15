"""Local JSON research API. Run with python3 -m server.api."""
import argparse
import csv
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from socketserver import TCPServer
import io
import json
import os
import re
from urllib.parse import parse_qs, urlsplit
from .catalogue import Catalogue
from .errors import ResearchError
from .presets import PresetPolicy
from .research import ROOT, ResearchEngine, ResearchService
from .store import Store, encode


def csv_snapshot(result):
    stream = io.StringIO(newline="")
    fields = ["study_id", "selection_plan_id", "versions", "region_id", "region_source", "period_source",
              "requested_period", "resolved_period", "comparison_period", "kind", "variable_id", "metric_id",
              "label", "source", "unit", "baseline", "status", "analysis_period", "actual_support", "time",
              "value", "anomaly", "fitted", "slope_per_year", "slope_per_decade", "ci95_per_year",
              "interval_scope", "p_raw", "p_adjusted", "primary_family_id", "significant", "hypothesis_id"]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    resolved = result["resolved"]
    base = {"study_id": result["identity"]["id"], "selection_plan_id": result["selection"]["selection_plan_id"],
            "versions": encode(result["identity"]["versions"]),
            "region_id": resolved["region_id"], "region_source": resolved["region_source"],
            "period_source": resolved["period_source"], "requested_period": encode(result["user_constraints"]["period"]),
            "resolved_period": encode(resolved["period"]), "comparison_period": encode(result["comparison"]["period"])}
    def write(kind, concept, metric, source, item):
        h = item.get("full_history") or {}
        t = item.get("trend") or {}
        common = {**base, "kind": kind, "variable_id": concept, "metric_id": metric, "label": item.get("label"),
                  "source": encode(source), "unit": item.get("unit"), "baseline": encode(item.get("baseline")),
                  "status": item.get("status"), "analysis_period": encode(item.get("analysis_period")),
                  "actual_support": encode(item.get("actual_support")), "ci95_per_year": encode(t.get("ci_95")),
                  "p_adjusted": encode(t.get("p_adjusted")), "hypothesis_id": item.get("hypothesis_id")}
        for key in ("slope_per_year", "slope_per_decade", "interval_scope", "p_raw", "primary_family_id", "significant"):
            common[key] = t.get(key)
        if not h.get("times"):
            writer.writerow(common)
        for index, time in enumerate(h.get("times", [])):
            sample = {dst: h[src][index] if index < len(h.get(src) or []) else None
                      for dst, src in (("value", "values"), ("anomaly", "anomalies"), ("fitted", "fitted"))}
            writer.writerow({**common, "time": time, **sample})
    for v in result["variables"]:
        write("variable", v["variable_id"], "anomaly_trend", v["product"]["selected_product_id"], v)
    for i in result["indicators"]:
        for m in i.get("metrics") or [i]:
            write(i["kind"], i["recipe"]["indicator_id"], m.get("metric_id"), i.get("evidence_source"), m)
    return stream.getvalue().encode()


class ResearchHTTPServer(ThreadingHTTPServer):
    def server_bind(self):
        # Binding a loopback service does not require a reverse DNS lookup.
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, service, **kwargs):
        self.service = service
        super().__init__(*args, **kwargs)

    def send_data(self, status, value, mime="application/json; charset=utf-8", filename=None):
        data = value if isinstance(value, bytes) else encode(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(data)

    def handle_request(self):
        url = urlsplit(self.path)
        route = url.path.rstrip("/")
        service = self.service
        if self.command == "GET" and route == "/api/health":
            return self.send_data(200, {"status": "ready"})
        if self.command == "GET" and route == "/api/catalogue":
            return self.send_data(200, {**service.engine.catalogue.public(service.engine.versions),
                                        "presets": service.store.published()})
        if self.command == "POST" and route == "/api/research":
            length = self.headers.get("Content-Length", "")
            if not length.isdigit() or not 1 <= int(length) <= 16384:
                raise ResearchError("invalid_request", "The request body must be a JSON object under 16 KiB.", status=400)
            try:
                data = json.loads(self.rfile.read(int(length)))
            except (UnicodeError, ValueError, RecursionError) as exc:
                raise ResearchError("invalid_json", "Invalid JSON request.", status=400) from exc
            return self.send_data(202, service.submit(data))
        match = re.fullmatch(r"/api/research/([0-9a-f]{32})(/export)?", route)
        if match:
            job_id, export = match.groups()
            if self.command == "DELETE" and not export:
                service.store.finish(job_id, "cancelled")
            job = service.store.job(job_id)
            if job and self.command in {"GET", "DELETE"} and not export:
                return self.send_data(200, job)
            if job and self.command == "GET" and export:
                if job["result"] is None:
                    raise ResearchError("result_unavailable", "This study has no completed result.", status=409)
                fmt = parse_qs(url.query).get("format", ["json"])[0]
                if fmt == "json":
                    return self.send_data(200, job["result"], filename=f"aqua-trend-{job_id}.json")
                if fmt == "csv":
                    return self.send_data(200, csv_snapshot(job["result"]), "text/csv; charset=utf-8", f"aqua-trend-{job_id}.csv")
                raise ResearchError("invalid_format", "Choose JSON or CSV.", "format")
        raise ResearchError("not_found", "This resource was not found.", status=404)

    def dispatch(self):
        try:
            self.handle_request()
        except ResearchError as exc:
            self.send_data(exc.status, {"error": exc.payload})
        except (BrokenPipeError, ConnectionResetError):
            return

    do_GET = dispatch
    do_POST = dispatch
    do_DELETE = dispatch


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--host", default="127.0.0.1")
    cli.add_argument("--port", default=8765, type=int)
    cli.add_argument("--state", default=os.environ.get("AQUA_STATE_DB", ROOT / ".aqua-trend/jobs.sqlite"))
    cli.add_argument("--data-root", default=os.environ.get("AQUA_DATA_ROOT"))
    cli.add_argument("--preset-policy", default=os.environ.get("AQUA_PRESET_POLICY"))
    args = cli.parse_args()
    engine = ResearchEngine(Catalogue(args.data_root), Store(args.state), PresetPolicy(args.preset_policy))
    service = ResearchService(engine)
    with ResearchHTTPServer((args.host, args.port), partial(Handler, service=service)) as http:
        print(f"Aqua Trend research API listening at http://{args.host}:{http.server_port}", flush=True)
        try:
            http.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            service.pool.shutdown(wait=True, cancel_futures=True)


if __name__ == "__main__":
    main()
