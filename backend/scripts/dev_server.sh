#!/usr/bin/env bash
# Development server for the Earth System Trend Detective API.
#
#   backend/scripts/dev_server.sh            # needs a configured selector (see backend/README.md)
#   AQUA_SELECTOR=catalogue_lexical backend/scripts/dev_server.sh
#
# AQUA_SELECTOR is passed through unchanged: this script never chooses a selector for you.
# Without one, POST /api/research answers 503 selector_unavailable (nothing is fabricated).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PYTHON="${AQUA_PYTHON:-.venv/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
  echo "No interpreter at $PYTHON — create the venv first (see backend/README.md)." >&2
  exit 2
fi
if [[ -z "${AQUA_SELECTOR:-}" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "note: no selector is configured (AQUA_SELECTOR / ANTHROPIC_API_KEY); research requests will get 503." >&2
fi
exec "$PYTHON" -m aqua_trend "$@"
