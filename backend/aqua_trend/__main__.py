"""``python -m aqua_trend`` — serve the HTTP API on ``AQUA_HOST`` / ``AQUA_PORT`` (default 127.0.0.1:8000)."""
from __future__ import annotations

import os
import sys

ENV_HOST = "AQUA_HOST"
ENV_PORT = "AQUA_PORT"
ENV_LOG_LEVEL = "AQUA_LOG_LEVEL"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


def _port() -> int:
    raw = os.environ.get(ENV_PORT)
    if not raw:
        return DEFAULT_PORT
    try:
        port = int(raw)
    except ValueError:
        raise SystemExit(f"{ENV_PORT}={raw!r} is not a port number") from None
    if not 0 < port < 65536:
        raise SystemExit(f"{ENV_PORT}={raw!r} is not a port number")
    return port


def main() -> int:
    """Open the release, build the app and run uvicorn; a broken release stops with a clear message."""
    import uvicorn

    from .api import create_app
    from .errors import AquaError

    host, port = os.environ.get(ENV_HOST) or DEFAULT_HOST, _port()
    try:
        app = create_app()
    except AquaError as exc:
        print(f"aqua_trend cannot start [{exc.code}]: {exc.message}", file=sys.stderr)
        return 2
    except ValueError as exc:                                       # bad AQUA_* configuration value
        print(f"aqua_trend cannot start: {exc}", file=sys.stderr)
        return 2
    uvicorn.run(app, host=host, port=port, log_level=(os.environ.get(ENV_LOG_LEVEL) or "info").lower())
    return 0


if __name__ == "__main__":
    sys.exit(main())
