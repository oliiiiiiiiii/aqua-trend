"""Local selector service called by web/app/api/select-variables/route.ts.

    POST /select  {"event": "..."}  ->  {"votes": [{"category", "p"}], "threshold", "model", "backend", "seconds"}
    GET  /health                    ->  {"ok": true, "backend", "model"}

It forwards one System One request (12 noul questions, see selector.py) to a model server that is
already running (start.sh starts both). Binds to 127.0.0.1 only. Standard library only.

    .venv/bin/python -I serve.py --backend onejev --upstream http://127.0.0.1:8811
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir; add it back explicitly
from selector import BACKENDS, DEFAULT_PROMPT, PROMPTS, ask  # noqa: E402

# Pre-select threshold per backend, used by the route only when the keyword table finds nothing (eval.md).
THRESHOLDS = {"onejev": 0.5, "jev-style": 0.3, "phocinae": 0.5}
MAX_EVENT_CHARS = 500


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backend", choices=BACKENDS, default="onejev")
    ap.add_argument("--upstream", default="http://127.0.0.1:8811", help="model server base URL")
    ap.add_argument("--prompt", choices=tuple(PROMPTS), default=DEFAULT_PROMPT)
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--threshold", type=float, help="override the backend's pre-select threshold")
    ap.add_argument("--timeout", type=float, default=20, help="seconds to wait for the model server")
    args = ap.parse_args()
    threshold = args.threshold if args.threshold is not None else THRESHOLDS[args.backend]
    cache: OrderedDict[str, dict] = OrderedDict()
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *a):
            sys.stderr.write("selector: " + fmt % a + "\n")

        def _send(self, code: int, body: dict) -> None:
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, {"ok": True, "backend": args.backend, "upstream": args.upstream})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/select":
                return self._send(404, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length", 0))
                event = json.loads(self.rfile.read(min(length, 64 * 1024)))["event"]
                if not isinstance(event, str) or not event.strip() or len(event) > MAX_EVENT_CHARS:
                    raise ValueError
            except (ValueError, KeyError, TypeError):
                return self._send(400, {"error": "body must be {\"event\": non-empty string <= 500 chars}"})
            key = event.strip()
            with lock:
                hit = cache.get(key)
            if hit is None:
                try:
                    probs, secs = ask(args.backend, args.upstream, key, args.prompt, timeout=args.timeout)
                except Exception as exc:
                    return self._send(503, {"error": f"model unavailable: {type(exc).__name__}: {exc}"})
                hit = {"votes": [{"category": c, "p": round(p, 4)} for c, p in probs.items()],
                       "threshold": threshold, "backend": args.backend, "prompt": args.prompt,
                       "seconds": round(secs, 3)}
                with lock:
                    cache[key] = hit
                    while len(cache) > 256:
                        cache.popitem(last=False)
            self._send(200, hit)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"selector: {args.backend} via {args.upstream} on http://127.0.0.1:{args.port}", file=sys.stderr)
    server.serve_forever()


if __name__ == "__main__":
    main()
