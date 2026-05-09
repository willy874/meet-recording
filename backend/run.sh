#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
PORT="${PORT:-7001}"
exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port "$PORT" --reload
