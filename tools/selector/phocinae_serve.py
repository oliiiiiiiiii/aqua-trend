"""Serve Phocinae-Largha-150M-v1 with question `instructions` intact.

The published `phocinae-server` 0.1.8 HTTP schema (`phocinae/server.py`, class Question) has no
`instructions` field, so pydantic drops it and every noul question is answered with the generic
default wording: all 12 categories came back with the same probability (see eval.md). The in-process
`phocinae.engine.Engine` documented in the phocinae-server README does read `instructions`, so this
wraps it in the same `/v1/systemone` shape, returning `answers` and `option_scores`.

    PHOC_MODEL_DIR=models/largha .venv/bin/python -I phocinae_serve.py --port 8813
"""
from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from phocinae.engine import Engine


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8813)
    ap.add_argument("--threads", type=int, default=6)
    args = ap.parse_args()
    engine = Engine(os.environ["PHOC_MODEL_DIR"], device="cpu", warm=False, threads=args.threads)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def _send(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self._send(200, {"ok": True, "model": engine.model_name}) if self.path == "/health" else self._send(404, {})

        def do_POST(self):
            if self.path != "/v1/systemone":
                return self._send(404, {})
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                qs = [{"id": q["id"], "type": q["type"], "instructions": q.get("instructions"),
                       "options": q.get("options"), "criteria": q.get("criteria"),
                       "threshold": q.get("threshold")} for q in req["questions"]]
                answers, confs, _, usage, scores = engine.run(str(req["state"]), qs, with_scores=True)
            except Exception as exc:  # report, never crash the server
                return self._send(400, {"error": f"{type(exc).__name__}: {exc}"})
            self._send(200, {"model": engine.model_name, "answers": answers, "answer_confidence": confs,
                             "option_scores": scores, "usage": usage})

    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
