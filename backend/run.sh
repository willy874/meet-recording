#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
PORT="${PORT:-7001}"
# Loopback by default: the API can open folders and create directories on
# this machine and has no auth. OBS reaches the separate ffmpeg listen port,
# not this one. Set HOST=0.0.0.0 to expose it deliberately.
HOST="${HOST:-127.0.0.1}"
exec .venv/bin/uvicorn main:app --host "$HOST" --port "$PORT" --reload
