"""FastAPI backend: job-based transcription with pause/resume/cancel.

Each upload becomes a Job. Workers run in isolated subprocesses so we can
SIGSTOP/SIGCONT for true immediate pause and SIGTERM for instant cancel.
Multiple subscribers (CLI panels, browser tabs) share the same Job — events
fan out via per-subscriber asyncio queues with full history replay.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator, Optional

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "medium")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE", "int8")

BACKEND_DIR = Path(__file__).resolve().parent
WORKER_PATH = BACKEND_DIR / "worker.py"
LIVE_WORKER_PATH = BACKEND_DIR / "live_worker.py"
PYTHON_BIN = BACKEND_DIR / ".venv" / "bin" / "python"
DEFAULT_LIVE_LISTEN_URL = os.environ.get("MEET_LIVE_LISTEN_URL", "tcp://0.0.0.0:9999?listen=1")

# Outputs dir is dynamic at runtime: env > persisted config > repo default.
# The frontend can change it via /api/outputs-dir; the CLI's --outputs-dir
# pre-seeds it via MEET_OUTPUTS_DIR. Either way the value lives here and is
# persisted to CONFIG_PATH so the next backend (or CLI without flags) reuses it.
CONFIG_DIR = Path(os.environ.get("MEET_CONFIG_DIR", str(Path.home() / ".meet")))
CONFIG_PATH = CONFIG_DIR / "config.json"
DEFAULT_OUTPUTS_DIR = (BACKEND_DIR.parent / "outputs").resolve()


def _load_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_config(cfg: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def _resolve_initial_outputs_dir() -> Path:
    env = os.environ.get("MEET_OUTPUTS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    persisted = _load_config().get("outputs_dir")
    if persisted:
        return Path(persisted).expanduser().resolve()
    return DEFAULT_OUTPUTS_DIR


_OUTPUTS_LOCK = threading.Lock()
_OUTPUTS_DIR = _resolve_initial_outputs_dir()
_OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
# Persist whatever we resolved so the CLI (without --outputs-dir) and the
# frontend (without an explicit override) see the same dir on the next boot.
try:
    _cfg = _load_config()
    if _cfg.get("outputs_dir") != str(_OUTPUTS_DIR):
        _cfg["outputs_dir"] = str(_OUTPUTS_DIR)
        _save_config(_cfg)
except OSError:
    pass
_RESERVED_NAMES: set[str] = set()


def get_outputs_dir() -> Path:
    with _OUTPUTS_LOCK:
        return _OUTPUTS_DIR


def set_outputs_dir(path: Path) -> Path:
    global _OUTPUTS_DIR
    resolved = path.expanduser().resolve()
    resolved.mkdir(parents=True, exist_ok=True)
    with _OUTPUTS_LOCK:
        _OUTPUTS_DIR = resolved
    cfg = _load_config()
    cfg["outputs_dir"] = str(resolved)
    _save_config(cfg)
    return resolved


def reserve_output_path(ext: str) -> Path:
    """Return a fresh `{YYYYMMDDHHmmss}-{idx}.{ext}` path inside the current outputs dir.

    Reservations are tracked in-memory so two jobs created in the same second
    don't collide before either has actually opened its file.
    """
    ext = ext.lstrip(".").lower() or "md"
    while True:
        ts = time.strftime("%Y%m%d%H%M%S")
        outputs = get_outputs_dir()
        with _OUTPUTS_LOCK:
            idx = 1
            while True:
                name = f"{ts}-{idx}.{ext}"
                path = outputs / name
                if name not in _RESERVED_NAMES and not path.exists():
                    _RESERVED_NAMES.add(name)
                    return path
                idx += 1

app = FastAPI(title="Meet Transcribe")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


_RTF_BY_MODEL = {
    "tiny": 0.08, "base": 0.12, "small": 0.25, "medium": 0.6,
    "large-v1": 1.2, "large-v2": 1.3, "large-v3": 1.5,
}


def estimate_eta(duration_sec: float, model: str, device: str, compute: str) -> float:
    rtf = _RTF_BY_MODEL.get(model, 0.6)
    if device == "cuda":
        rtf *= 0.15 if compute in ("float16", "float32") else 0.3
    return duration_sec * rtf


def probe_duration(path: str) -> Optional[float]:
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            stderr=subprocess.DEVNULL, timeout=10,
        )
        return float(out.decode().strip())
    except (subprocess.SubprocessError, ValueError, FileNotFoundError):
        return None


@dataclass
class Job:
    id: str
    filename: str
    file_path: str
    output_path: str
    language: Optional[str]
    vad: bool
    beam_size: int
    status: str = "queued"   # queued | running | paused | done | error | cancelled
    created_at: float = field(default_factory=time.time)
    estimate: Optional[dict] = None
    info: Optional[dict] = None
    segments: list[dict] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)  # full replay log
    subscribers: list[asyncio.Queue] = field(default_factory=list)
    process: Optional[subprocess.Popen] = None
    error: Optional[str] = None
    live: bool = False
    listen_url: Optional[str] = None
    chunk_seconds: float = 6.0
    record_path: Optional[str] = None

    def summary(self) -> dict:
        last_end = self.segments[-1]["end"] if self.segments else 0
        progress = 0.0
        if self.estimate and self.estimate.get("duration_seconds", 0) > 0:
            progress = min(1.0, last_end / self.estimate["duration_seconds"])
        return {
            "id": self.id,
            "filename": self.filename,
            "status": self.status,
            "created_at": self.created_at,
            "language": self.language,
            "duration_seconds": (self.estimate or {}).get("duration_seconds"),
            "segment_count": len(self.segments),
            "progress": progress,
            "error": self.error,
            "live": self.live,
            "listen_url": self.listen_url,
            "record_path": self.record_path,
            "output_path": self.output_path,
        }


JOBS: dict[str, Job] = {}


def _emit(job: Job, event: dict) -> None:
    job.events.append(event)
    t = event.get("type")
    if t == "segment":
        job.segments.append(event)
    elif t == "estimate":
        job.estimate = event
    elif t == "info":
        job.info = event
    for q in list(job.subscribers):
        try:
            q.put_nowait(event)
        except Exception:
            pass


def _emit_state(job: Job) -> None:
    _emit(job, {"type": "state", "status": job.status, "error": job.error})


async def _run_job(job: Job) -> None:
    duration = probe_duration(job.file_path)
    if duration is not None:
        _emit(job, {
            "type": "estimate",
            "duration_seconds": duration,
            "eta_seconds": estimate_eta(duration, MODEL_SIZE, DEVICE, COMPUTE_TYPE),
            "model": MODEL_SIZE, "device": DEVICE, "compute": COMPUTE_TYPE,
        })

    python_bin = str(PYTHON_BIN) if PYTHON_BIN.exists() else sys.executable
    proc = subprocess.Popen(
        [python_bin, str(WORKER_PATH)],
        cwd=str(BACKEND_DIR),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        bufsize=1,
        text=True,
    )
    job.process = proc
    config = {
        "file_path": job.file_path,
        "language": job.language,
        "vad": job.vad,
        "beam_size": job.beam_size,
        "model": MODEL_SIZE, "device": DEVICE, "compute": COMPUTE_TYPE,
    }
    proc.stdin.write(json.dumps(config) + "\n")
    proc.stdin.flush()
    proc.stdin.close()

    job.status = "running"
    _emit_state(job)

    out_fh = open(job.output_path, "w", encoding="utf-8")
    loop = asyncio.get_running_loop()

    try:
        while True:
            line = await loop.run_in_executor(None, proc.stdout.readline)
            if not line:
                break
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "segment":
                out_fh.write(event["text"] + "\n")
                out_fh.flush()
            _emit(job, event)
            if event.get("type") == "error":
                job.error = event.get("message")
            if event.get("type") in ("done", "error"):
                break
    finally:
        out_fh.close()
        rc = proc.wait()
        # Cancellation already set status to "cancelled" — don't overwrite.
        if job.status not in ("cancelled", "error"):
            job.status = "done" if rc == 0 else "error"
            if rc != 0 and not job.error:
                job.error = f"worker exited with code {rc}"
        _emit_state(job)
        try:
            os.unlink(job.file_path)
        except OSError:
            pass


async def _run_live_job(job: Job) -> None:
    python_bin = str(PYTHON_BIN) if PYTHON_BIN.exists() else sys.executable
    proc = subprocess.Popen(
        [python_bin, str(LIVE_WORKER_PATH)],
        cwd=str(BACKEND_DIR),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        bufsize=1,
        text=True,
    )
    job.process = proc
    config = {
        "listen_url": job.listen_url,
        "language": job.language,
        "vad": job.vad,
        "beam_size": job.beam_size,
        "chunk_seconds": job.chunk_seconds,
        "record_path": job.record_path,
        "model": MODEL_SIZE, "device": DEVICE, "compute": COMPUTE_TYPE,
    }
    proc.stdin.write(json.dumps(config) + "\n")
    proc.stdin.flush()
    proc.stdin.close()

    job.status = "running"
    _emit_state(job)

    out_fh = open(job.output_path, "w", encoding="utf-8")
    loop = asyncio.get_running_loop()

    try:
        while True:
            line = await loop.run_in_executor(None, proc.stdout.readline)
            if not line:
                break
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "segment":
                out_fh.write(event["text"] + "\n")
                out_fh.flush()
            _emit(job, event)
            if event.get("type") == "error":
                job.error = event.get("message")
            if event.get("type") in ("done", "error"):
                break
    finally:
        out_fh.close()
        rc = proc.wait()
        if job.status not in ("cancelled", "error"):
            job.status = "done" if rc == 0 else "error"
            if rc != 0 and not job.error:
                job.error = f"worker exited with code {rc}"
        _emit_state(job)


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "model": MODEL_SIZE, "device": DEVICE, "compute": COMPUTE_TYPE,
        "outputs_dir": str(get_outputs_dir()),
        "default_live_listen_url": DEFAULT_LIVE_LISTEN_URL,
    }


@app.get("/api/outputs-dir")
def read_outputs_dir() -> dict:
    return {"outputs_dir": str(get_outputs_dir())}


@app.post("/api/outputs-dir")
def update_outputs_dir(payload: dict = Body(...)) -> dict:
    raw = (payload or {}).get("path")
    if not isinstance(raw, str) or not raw.strip():
        raise HTTPException(400, "path is required")
    try:
        resolved = set_outputs_dir(Path(raw.strip()))
    except OSError as exc:
        raise HTTPException(400, f"cannot use path: {exc}") from exc
    return {"outputs_dir": str(resolved)}


@app.post("/api/jobs")
async def create_job(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    vad: bool = Form(True),
    beam_size: int = Form(5),
) -> dict:
    if not file.filename:
        raise HTTPException(400, "missing filename")

    suffix = Path(file.filename).suffix or ".bin"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        shutil.copyfileobj(file.file, tmp)
        tmp.flush()
        tmp.close()
    finally:
        await file.close()

    job_id = uuid.uuid4().hex[:12]
    job = Job(
        id=job_id,
        filename=file.filename,
        file_path=tmp.name,
        output_path=str(reserve_output_path("md")),
        language=language,
        vad=vad,
        beam_size=beam_size,
    )
    JOBS[job_id] = job
    asyncio.create_task(_run_job(job))
    return {"id": job_id}


def _normalize_listen_url(url: str) -> str:
    """For tcp:// and udp:// inputs, ensure ffmpeg runs in listener mode.

    Without ``?listen=1`` ffmpeg interprets the URL as a *client* and tries
    to connect to it, which immediately fails with rc=195 — a very common
    foot-gun when users copy the OBS-side URL into meet's form.
    """
    lower = url.lower()
    if (lower.startswith("tcp://") or lower.startswith("udp://")) and "listen=" not in lower:
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}listen=1"
    return url


@app.post("/api/live")
async def create_live_job(
    listen_url: str = Form(DEFAULT_LIVE_LISTEN_URL),
    language: Optional[str] = Form(None),
    vad: bool = Form(True),
    beam_size: int = Form(5),
    chunk_seconds: float = Form(6.0),
    label: Optional[str] = Form(None),
    record: bool = Form(False),
    record_format: str = Form("mkv"),
) -> dict:
    listen_url = _normalize_listen_url(listen_url)
    job_id = uuid.uuid4().hex[:12]
    record_path: Optional[str] = None
    if record:
        ext = (record_format or "mkv").lstrip(".").lower()
        if ext not in {"mkv", "mp4", "ts", "flv", "mov"}:
            ext = "mkv"
        record_path = str(reserve_output_path(ext))
    job = Job(
        id=job_id,
        filename=label or f"OBS Live · {listen_url}",
        file_path="",
        output_path=str(reserve_output_path("md")),
        language=language,
        vad=vad,
        beam_size=beam_size,
        live=True,
        listen_url=listen_url,
        chunk_seconds=chunk_seconds,
        record_path=record_path,
    )
    JOBS[job_id] = job
    asyncio.create_task(_run_live_job(job))
    return {
        "id": job_id, "listen_url": listen_url, "chunk_seconds": chunk_seconds,
        "record_path": record_path,
    }


@app.get("/api/jobs")
def list_jobs() -> dict:
    items = [j.summary() for j in sorted(JOBS.values(), key=lambda j: -j.created_at)]
    return {"jobs": items}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return {**job.summary(), "estimate": job.estimate, "info": job.info, "segments": job.segments}


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")

    queue: asyncio.Queue = asyncio.Queue()
    job.subscribers.append(queue)

    async def stream() -> AsyncIterator[bytes]:
        try:
            for event in list(job.events):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8")
            yield f"data: {json.dumps({'type': 'state', 'status': job.status, 'error': job.error})}\n\n".encode("utf-8")
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8")
                if event.get("type") == "state" and event.get("status") in ("done", "error", "cancelled"):
                    break
        finally:
            try:
                job.subscribers.remove(queue)
            except ValueError:
                pass

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _signal_worker(job: Job, sig: int) -> None:
    """Signal the worker process group (covers worker + any ffmpeg child)."""
    if job.process and job.process.poll() is None:
        try:
            os.killpg(os.getpgid(job.process.pid), sig)
        except (ProcessLookupError, PermissionError):
            pass


@app.post("/api/jobs/{job_id}/pause")
def pause_job(job_id: str) -> dict:
    job = JOBS.get(job_id) or _404()
    if job.status == "running":
        _signal_worker(job, signal.SIGSTOP)
        job.status = "paused"
        _emit_state(job)
    return {"ok": True, "status": job.status}


@app.post("/api/jobs/{job_id}/resume")
def resume_job(job_id: str) -> dict:
    job = JOBS.get(job_id) or _404()
    if job.status == "paused":
        _signal_worker(job, signal.SIGCONT)
        job.status = "running"
        _emit_state(job)
    return {"ok": True, "status": job.status}


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    job = JOBS.get(job_id) or _404()
    if job.status in ("running", "paused"):
        if job.status == "paused":
            _signal_worker(job, signal.SIGCONT)
        _signal_worker(job, signal.SIGTERM)
        job.status = "cancelled"
        _emit_state(job)
    return {"ok": True, "status": job.status}


@app.get("/api/jobs/{job_id}/output")
def download_output(job_id: str) -> FileResponse:
    job = JOBS.get(job_id) or _404()
    out = Path(job.output_path)
    if not out.exists():
        raise HTTPException(404, "output not ready")
    return FileResponse(str(out), media_type="text/markdown", filename=out.name)


@app.get("/api/jobs/{job_id}/recording")
def download_recording(job_id: str) -> FileResponse:
    job = JOBS.get(job_id) or _404()
    if not job.record_path or not Path(job.record_path).exists():
        raise HTTPException(404, "recording not available")
    name = Path(job.record_path).name
    return FileResponse(job.record_path, filename=name)


def _404():
    raise HTTPException(404, "job not found")
