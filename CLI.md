# meet-cli — Manual for AI Agents

A command-line interface for the Meet transcription backend (FastAPI + faster-whisper).
This document is the canonical machine-readable reference. If you are an AI agent
integrating with `meet-cli`, read this file first.

## Purpose

Transcribe a local audio or video file and stream segments back as they are produced.
The tool can:

- Auto-start the backend if it is not running, and shut it down on exit.
- Render a human-friendly status panel (default), or emit line-delimited JSON events
  intended for scripts and agents (`--json`).
- Provide an up-front ETA derived from the audio duration and the model's typical
  real-time factor (RTF), refined as segments arrive.

## Invocation

```
meet-cli <file> [options]
```

The wrapper script lives at `backend/meet-cli` (with a convenience symlink at the repo root, so `./meet-cli` works from anywhere in the project) and calls the project's virtualenv
Python at `backend/.venv/bin/python`. You may also invoke `python cli.py` directly
inside the venv.

### Required argument

| Argument | Description                                       |
|----------|---------------------------------------------------|
| `file`   | Path to a local audio/video file readable by ffmpeg. Optional when `--live` is set. |

### Options

| Flag                   | Default     | Description                                                  |
|------------------------|-------------|--------------------------------------------------------------|
| `-l, --language CODE`  | `zh-TW`     | Language code. Accepts `zh-TW`, `zh-CN`, `zh`, `en`, `ja`, `ko`, …, or `auto` for auto-detect. `zh-TW`/`zh-CN` map to Whisper `zh` plus a Traditional/Simplified `initial_prompt` that biases the output script. |
| `--no-vad`             | off         | Disable Whisper VAD silence filtering.                       |
| `--beam-size N`        | `5`         | Beam search width.                                           |
| `-o, --output PATH`    | none        | Write final concatenated transcript to a UTF-8 text file.    |
| `--host HOST`          | `127.0.0.1` | Backend host. Overrides env `MEET_HOST`.                     |
| `--port PORT`          | `7001`      | Backend port. Overrides env `MEET_PORT`.                     |
| `--no-autostart`       | off         | Do not spawn the backend if it is unreachable; fail instead. |
| `--json`               | off         | Emit line-delimited JSON events on stdout (no TUI).          |
| `--live`               | off         | Live mode: backend acts as an ffmpeg listener and transcribes a stream (e.g. OBS) in real time. The `file` argument is ignored. |
| `--listen-url URL`     | `tcp://0.0.0.0:9999?listen=1` | Live mode: ffmpeg input URL. Supports any URL ffmpeg accepts as a listener (TCP/UDP MPEG-TS, SRT, …). Override via `MEET_LIVE_LISTEN_URL`. |
| `--chunk-seconds N`    | `6`         | Live mode: rolling PCM chunk size fed to Whisper. Smaller = lower latency, more boundary errors. |
| `--label TEXT`         | none        | Live mode: display label for the job in the frontend.        |
| `--serve`              | off         | Servers-only mode: start backend (and frontend) and let the web UI drive everything. No `file`, `--live`, or upload from CLI; the CLI just keeps the servers alive until Ctrl-C. |
| `--outputs-dir DIR`    | `<repo>/outputs` | Directory the backend writes transcript outputs into. Sets `MEET_OUTPUTS_DIR` for the spawned backend. Only takes effect when this CLI starts the backend itself (not when attaching to a pre-running one). |
| `--open`               | off         | Open the web UI in the default browser once it's ready. Implies `--web`. |

### Environment variables

| Variable        | Effect                                              |
|-----------------|-----------------------------------------------------|
| `MEET_HOST`     | Default backend host (overridden by `--host`).      |
| `MEET_PORT`     | Default backend port (overridden by `--port`).      |
| `MEET_OUTPUTS_DIR` | Backend transcript output directory (overridden by `--outputs-dir`). |
| `MEET_LIVE_LISTEN_URL` | Default `--listen-url` for live mode.        |
| `WHISPER_MODEL` | Read by the backend on startup (`tiny`…`large-v3`). |
| `WHISPER_DEVICE`| `cpu` or `cuda`.                                    |
| `WHISPER_COMPUTE`| e.g. `int8`, `float16`.                            |

## Behavior

1. **Health probe** — `GET http://{host}:{port}/api/health`. If healthy, skip step 2.
2. **Auto-start (if needed and not `--no-autostart`)** — spawn `backend/run.sh` with
   `PORT={port}` in env, poll `/api/health` every 0.5s for up to 60s.
3. **Upload** — `POST /api/transcribe` as `multipart/form-data` with the file and form
   fields (`language`, `vad`, `beam_size`).
4. **Stream** — read `text/event-stream`, parse each `data:` line as JSON, dispatch
   to the renderer.
5. **Cleanup** — on normal exit, `SIGINT`, or `SIGTERM`, terminate any backend that
   `meet-cli` itself started. A pre-existing backend is left untouched.

The CLI does **not** keep a backend alive across invocations.

## Event schema

Identical to the HTTP SSE schema. Five event types:

```jsonc
// Sent once, before the model runs, only if ffprobe could read the file.
{ "type": "estimate",
  "duration_seconds": 754.3,
  "eta_seconds": 452.6,
  "model": "medium", "device": "cpu", "compute": "int8" }

// Sent once, after the model has analyzed the audio header.
{ "type": "info",
  "language": "zh",
  "language_probability": 0.99,
  "duration": 754.3 }

// Sent repeatedly, one per non-empty segment.
{ "type": "segment", "start": 0.0, "end": 3.2, "text": "…" }

// Terminal events — exactly one will be sent.
{ "type": "done" }
{ "type": "error", "message": "…" }
```

In `--live` mode there is no `estimate` event (no fixed duration). Instead a
one-shot `listening` event is emitted once the model is loaded and ffmpeg has
started listening:

```jsonc
{ "type": "listening", "url": "tcp://0.0.0.0:9999?listen=1",
  "chunk_seconds": 6.0, "sample_rate": 16000 }
```

Live segments use a wall-clock-relative timestamp counted from the start of
the listener (i.e. `start`/`end` are seconds since `listening`).

ETA is `duration_seconds × RTF`, where RTF is a per-model heuristic
(tiny≈0.08, base≈0.12, small≈0.25, medium≈0.6, large-v3≈1.5 on CPU+int8;
roughly 0.15× of that on CUDA+float16). Expect ±50% error on cold runs.

A more accurate live estimate is `eta_seconds × (1 - last_segment.end / duration_seconds)`.

## Output modes

### Default (TUI)

A live `rich` panel with: file metadata, model info, language, segment count,
progress bar, ETA, and the last 12 transcript lines. Intended for humans.

### `--json`

Each parsed SSE event is written to stdout as one JSON object per line, in the
order received, then the process exits. `stderr` carries diagnostic logs (e.g.
"backend ready"). This is the recommended mode for AI agents and scripts.

Example (agent integration):

```
meet-cli ./meeting.m4a --json --language zh -o transcript.txt
```

Consume stdout line-by-line; treat any `{"type":"error", …}` as fatal.

## Exit codes

| Code | Meaning                                                          |
|------|------------------------------------------------------------------|
| `0`  | Stream completed with `{"type":"done"}` and no errors.           |
| `1`  | Backend reported `{"type":"error", …}` or HTTP/transport failed. |
| `2`  | Pre-flight failure: file missing, backend unreachable + autostart disabled, or backend autostart failed. |
| `130`| Interrupted by `SIGINT`/`SIGTERM`.                               |

## Examples

```bash
# Default: Traditional Chinese (zh-TW), TUI panel.
meet-cli ./meeting.mp3

# Save final transcript to a text file.
meet-cli ./meeting.mp3 -o meeting.txt

# Force Simplified Chinese.
meet-cli ./meeting.mp3 -l zh-CN

# Servers-only: start backend + frontend and let the browser drive jobs.
# Frontend opens at http://localhost:7002 by default.
meet-cli --serve --outputs-dir ./outputs
meet-cli --serve --outputs-dir ~/Desktop/transcripts --web-port 5173 --json

# Open the browser automatically once everything is up.
meet-cli --serve --outputs-dir ./outputs --open

# Auto-detect language.
meet-cli ./meeting.mp3 -l auto

# Agent-friendly streaming JSON.
meet-cli ./meeting.mp3 --json

# Talk to an already-running backend on a different host; never auto-start.
meet-cli ./meeting.mp3 --host 10.0.0.5 --port 7001 --no-autostart --json
```

## Notes for agents

- The `estimate` event is best-effort. If `ffprobe` is missing or the file is
  unreadable, the backend skips it and proceeds straight to `info`.
- Segments stream in chronological order and never overlap. `end` is monotonically
  non-decreasing. Compute progress as `last_segment.end / info.duration`.
- The CLI is line-oriented in `--json` mode and safe to pipe (`| jq`, `| tee`).
- Do not call `meet-cli` repeatedly in a tight loop hoping to "warm" the model;
  the backend keeps the model in memory only while it is running, and `meet-cli`
  shuts down the backend it started. To keep a warm model, run `backend/run.sh`
  yourself and pass `--no-autostart` to the CLI.
