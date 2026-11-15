#!/bin/sh
# Start OneJev1.6-0.8B (GGUF, llama.cpp, CPU) on 127.0.0.1:8811 and the selector service on 127.0.0.1:8770.
# Requires: llama-server on PATH, the venv from README.md, and ONEJEV_GGUF pointing at a local .gguf.
set -eu
cd "$(dirname "$0")"
: "${ONEJEV_GGUF:?set ONEJEV_GGUF to the OneJev1.6-0.8B .gguf file (see README.md)}"
MODEL_PORT="${ONEJEV_PORT:-8811}"
SELECTOR_PORT="${SELECTOR_PORT:-8770}"
HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}" .venv/bin/python -I -m qev.cli serve \
  --gguf "$ONEJEV_GGUF" --tokenizer OmniJev/OneJev1.6-0.8B \
  --max-branch-tokens 2048 --parallel "${ONEJEV_PARALLEL:-4}" \
  --host 127.0.0.1 --port "$MODEL_PORT" &
MODEL_PID=$!
trap 'kill $MODEL_PID 2>/dev/null' EXIT INT TERM
i=0
until curl -sf -m 1 "http://127.0.0.1:$MODEL_PORT/v1/models" >/dev/null; do
  i=$((i + 1)); [ $i -gt 180 ] && { echo "model server did not start" >&2; exit 1; }
  kill -0 $MODEL_PID 2>/dev/null || { echo "model server exited" >&2; exit 1; }
  sleep 1
done
exec_selector() { .venv/bin/python -I serve.py --backend onejev --upstream "http://127.0.0.1:$MODEL_PORT" --port "$SELECTOR_PORT"; }
exec_selector
