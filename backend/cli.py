"""Meet CLI — transcribe audio/video via the Meet backend with a live status panel.

Designed for both humans (rich TUI panel with pause/cancel keys) and AI agents
(--json line-delimited output). The CLI talks to the job-based backend so jobs
created here are visible & controllable from the frontend, and vice versa.
"""
from __future__ import annotations

import argparse
import json
import os
import select
import shutil
import signal
import subprocess
import sys
import termios
import threading
import time
import tty
import webbrowser
from contextlib import suppress
from pathlib import Path
from typing import Iterator, Optional

import socket
import tempfile

import httpx
from rich.console import Console, Group
from rich.live import Live
from rich.panel import Panel
from rich.progress import BarColumn, Progress, TextColumn, TimeElapsedColumn
from rich.table import Table
from rich.text import Text

DEFAULT_HOST = os.environ.get("MEET_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("MEET_PORT", "7001"))
HEALTH_TIMEOUT = 60
BACKEND_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"
DEFAULT_WEB_PORT = int(os.environ.get("MEET_WEB_PORT", "7002"))


def base_url(host: str, port: int) -> str:
    return f"http://{host}:{port}"


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def find_free_port(preferred: Optional[int] = None, *, max_step: int = 200) -> int:
    """Pick an open TCP port.

    Strategy: start at `preferred` and increment by 1 until a free port is found
    (up to `max_step` attempts). If everything in that window is taken — or no
    preferred port was given — fall back to an OS-assigned ephemeral port.
    """
    if preferred is not None:
        for offset in range(max_step):
            candidate = preferred + offset
            if candidate > 65535:
                break
            if _port_free(candidate):
                return candidate
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def health_ok(host: str, port: int) -> bool:
    try:
        r = httpx.get(f"{base_url(host, port)}/api/health", timeout=1.5)
        return r.status_code == 200 and r.json().get("ok") is True
    except (httpx.HTTPError, ValueError):
        return False


def fetch_outputs_dir(host: str, port: int) -> Optional[str]:
    try:
        r = httpx.get(f"{base_url(host, port)}/api/health", timeout=1.5)
        if r.status_code == 200:
            return r.json().get("outputs_dir")
    except (httpx.HTTPError, ValueError):
        pass
    return None


def kill_group(p: Optional[subprocess.Popen], timeout: float = 5) -> None:
    if not p or p.poll() is not None:
        return
    with suppress(ProcessLookupError, PermissionError):
        os.killpg(os.getpgid(p.pid), signal.SIGTERM)
    try:
        p.wait(timeout)
    except subprocess.TimeoutExpired:
        with suppress(ProcessLookupError, PermissionError):
            os.killpg(os.getpgid(p.pid), signal.SIGKILL)
        with suppress(subprocess.TimeoutExpired):
            p.wait(2)


def spawn_backend(
    port: int,
    console: Console,
    outputs_dir: Optional[Path] = None,
    extra_env: Optional[dict] = None,
) -> Optional[subprocess.Popen]:
    run_sh = BACKEND_DIR / "run.sh"
    if not run_sh.exists():
        console.print(f"[red]run.sh not found at {run_sh}[/red]")
        return None
    env = os.environ.copy()
    env["PORT"] = str(port)
    if outputs_dir is not None:
        env["MEET_OUTPUTS_DIR"] = str(outputs_dir)
    if extra_env:
        env.update({k: str(v) for k, v in extra_env.items()})
    console.print(f"[dim]starting backend on :{port} …[/dim]")
    if outputs_dir is not None:
        console.print(f"[dim]outputs dir: {outputs_dir}[/dim]")
    if extra_env and "MEET_CONFIG_DIR" in extra_env:
        console.print(f"[dim]isolated config dir: {extra_env['MEET_CONFIG_DIR']}[/dim]")
    return subprocess.Popen(
        ["bash", str(run_sh)], cwd=str(BACKEND_DIR), env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def wait_backend_ready(proc: subprocess.Popen, host: str, port: int, console: Console) -> bool:
    deadline = time.time() + HEALTH_TIMEOUT
    while time.time() < deadline:
        if proc.poll() is not None:
            console.print("[red]backend exited before becoming healthy[/red]")
            return False
        if health_ok(host, port):
            console.print("[green]backend ready[/green]")
            return True
        time.sleep(0.5)
    console.print("[red]backend health check timed out[/red]")
    return False


def web_ok(port: int) -> bool:
    # Vite binds to "localhost" (often IPv6) by default — try both 127.0.0.1 and localhost.
    for host in ("127.0.0.1", "localhost"):
        try:
            r = httpx.get(f"http://{host}:{port}/", timeout=1.0)
            if r.status_code < 500:
                return True
        except httpx.HTTPError:
            continue
    return False


def spawn_frontend(port: int, console: Console) -> Optional[subprocess.Popen]:
    if not FRONTEND_DIR.exists():
        console.print(f"[yellow]frontend dir not found: {FRONTEND_DIR}[/yellow]")
        return None
    if web_ok(port):
        console.print(f"[green]frontend already running →[/green] http://localhost:{port}")
        return None
    env = os.environ.copy()
    env["PORT"] = str(port)
    console.print(f"[dim]starting frontend on :{port} …[/dim]")
    vite_bin = FRONTEND_DIR / "node_modules" / ".bin" / "vite"
    cmd = [str(vite_bin), "--port", str(port)] if vite_bin.exists() else ["npm", "run", "dev", "--", "--port", str(port)]
    return subprocess.Popen(
        cmd, cwd=str(FRONTEND_DIR), env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def wait_frontend_ready(proc: subprocess.Popen, port: int, console: Console, timeout: float = 60) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            console.print("[red]frontend exited before becoming ready[/red]")
            return
        if web_ok(port):
            console.print(f"[green]frontend ready →[/green] http://localhost:{port}")
            return
        time.sleep(0.5)
    console.print("[yellow]frontend did not become ready within 60s (still starting?)[/yellow]")


# ---------------------------------------------------------------------------
# Job API client
# ---------------------------------------------------------------------------


def create_job(host: str, port: int, file_path: Path, language: Optional[str], vad: bool, beam_size: int) -> str:
    url = f"{base_url(host, port)}/api/jobs"
    with file_path.open("rb") as fh:
        files = {"file": (file_path.name, fh, "application/octet-stream")}
        data: dict[str, str] = {"vad": "true" if vad else "false", "beam_size": str(beam_size)}
        if language:
            data["language"] = language
        r = httpx.post(url, files=files, data=data, timeout=120)
        r.raise_for_status()
        return r.json()["id"]


def create_live_job(host: str, port: int, listen_url: str, language: Optional[str], vad: bool,
                    beam_size: int, chunk_seconds: float, label: Optional[str]) -> dict:
    url = f"{base_url(host, port)}/api/live"
    data: dict[str, str] = {
        "listen_url": listen_url,
        "vad": "true" if vad else "false",
        "beam_size": str(beam_size),
        "chunk_seconds": str(chunk_seconds),
    }
    if language:
        data["language"] = language
    if label:
        data["label"] = label
    r = httpx.post(url, data=data, timeout=30)
    r.raise_for_status()
    return r.json()


def stream_job_events(host: str, port: int, job_id: str) -> Iterator[dict]:
    url = f"{base_url(host, port)}/api/jobs/{job_id}/events"
    with httpx.stream("GET", url, timeout=None) as resp:
        resp.raise_for_status()
        buf = ""
        for chunk in resp.iter_text():
            buf += chunk
            while "\n\n" in buf:
                block, buf = buf.split("\n\n", 1)
                for line in block.splitlines():
                    if line.startswith("data: "):
                        with suppress(json.JSONDecodeError):
                            yield json.loads(line[6:])


def post_job_action(host: str, port: int, job_id: str, action: str) -> None:
    with suppress(httpx.HTTPError):
        httpx.post(f"{base_url(host, port)}/api/jobs/{job_id}/{action}", timeout=5)


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def fmt_duration(s: float) -> str:
    if s < 60:
        return f"{s:.0f}s"
    m, sec = divmod(int(s), 60)
    if m < 60:
        return f"{m}m {sec}s"
    h, m = divmod(m, 60)
    return f"{h}h {m}m"


def fmt_ts(s: float) -> str:
    m, sec = divmod(s, 60)
    return f"{int(m):02d}:{sec:04.1f}"


# ---------------------------------------------------------------------------
# Raw-key listener (TUI)
# ---------------------------------------------------------------------------


class KeyListener:
    """Reads single keys from stdin in cbreak mode without blocking the main loop."""

    def __init__(self):
        self.fd = None
        self.old = None
        self.queue: list[str] = []
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if not sys.stdin.isatty():
            return
        self.fd = sys.stdin.fileno()
        self.old = termios.tcgetattr(self.fd)
        tty.setcbreak(self.fd)
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop.is_set():
            r, _, _ = select.select([sys.stdin], [], [], 0.1)
            if r:
                ch = sys.stdin.read(1)
                if ch:
                    self.queue.append(ch)

    def pop(self) -> Optional[str]:
        return self.queue.pop(0) if self.queue else None

    def stop(self) -> None:
        self._stop.set()
        if self.fd is not None and self.old is not None:
            with suppress(termios.error):
                termios.tcsetattr(self.fd, termios.TCSADRAIN, self.old)


# ---------------------------------------------------------------------------
# Run modes
# ---------------------------------------------------------------------------


def _open_browser(url: str, console: Console) -> None:
    try:
        ok = webbrowser.open_new_tab(url)
        if ok:
            console.print(f"[dim]opened browser → {url}[/dim]")
        else:
            console.print(f"[yellow]could not open browser; visit {url} manually[/yellow]")
    except Exception as exc:  # webbrowser failures are environment-specific
        console.print(f"[yellow]browser open failed ({exc}); visit {url} manually[/yellow]")


def _print_url_banner(console: Console, *, backend: str, web: Optional[str], outputs_dir: Optional[Path], extra_lines: Optional[list[str]] = None) -> None:
    """Print a prominent banner with clickable URLs (OSC-8 via rich)."""
    body = Table.grid(padding=(0, 2))
    body.add_column(style="bold cyan", justify="right")
    body.add_column()
    if web:
        body.add_row("Web UI", f"[bold link={web}]{web}[/]")
    body.add_row("Backend", f"[link={backend}]{backend}[/]")
    if outputs_dir is not None:
        body.add_row("Outputs", str(outputs_dir))
    for line in extra_lines or []:
        body.add_row("", line)
    console.print(Panel(body, title="Meet · ready", border_style="cyan"))


def _ensure_servers(args, host: str, port: int, console: Console, children: list[subprocess.Popen]) -> Optional[int]:
    """Start backend (and optionally frontend). Returns exit-code on failure or None on success."""
    outputs_dir = getattr(args, "outputs_dir", None)
    extra_env = getattr(args, "_extra_backend_env", None)
    if not health_ok(host, port):
        if args.no_autostart:
            console.print(f"[red]backend not reachable at {base_url(host, port)} (--no-autostart set)[/red]")
            return 2
        proc = spawn_backend(port, console, outputs_dir=outputs_dir, extra_env=extra_env)
        if proc is None:
            return 2
        children.append(proc)
        if not wait_backend_ready(proc, host, port, console):
            return 2
    elif outputs_dir is not None:
        console.print(f"[yellow]backend already running on :{port} — --outputs-dir is ignored[/yellow]")
    if args.web:
        web_proc = spawn_frontend(args.web_port, console)
        if web_proc is not None:
            children.append(web_proc)
            wait_frontend_ready(web_proc, args.web_port, console)
    return None


def run_serve(args, host: str, port: int) -> int:
    """Servers-only mode: start backend (and frontend) and idle until Ctrl-C.

    Designed for the "let the web UI drive everything" workflow. The CLI just
    pins the outputs directory and keeps the servers alive; jobs (file uploads
    and OBS live streams) are created from the browser.
    """
    console = Console()
    children: list[subprocess.Popen] = []

    def cleanup_servers():
        for p in reversed(children):
            kill_group(p)

    def signal_handler(*_):
        cleanup_servers()
        sys.exit(130)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    rc = _ensure_servers(args, host, port, console, children)
    if rc is not None:
        cleanup_servers()
        return rc

    web_url = f"http://localhost:{args.web_port}" if args.web else None
    effective_outputs = args.outputs_dir or (Path(p) if (p := fetch_outputs_dir(host, port)) else None)
    if args.json:
        print(json.dumps({
            "type": "ready",
            "backend": base_url(host, port),
            "outputs_dir": str(effective_outputs) if effective_outputs else None,
            "web": web_url,
        }), flush=True)
    else:
        _print_url_banner(
            console,
            backend=base_url(host, port),
            web=web_url,
            outputs_dir=effective_outputs,
            extra_lines=["serve mode — Ctrl-C to stop"],
        )

    if args.open and web_url:
        _open_browser(web_url, console)

    if args.json:
        # JSON mode: emit periodic snapshots so scripts can follow batch progress.
        try:
            last_signature: Optional[str] = None
            while True:
                jobs = _fetch_jobs(host, port)
                if jobs is not None:
                    sig = json.dumps(
                        [(j.get("id"), j.get("status"), round(j.get("progress") or 0, 3),
                          j.get("segment_count")) for j in jobs],
                        sort_keys=True,
                    )
                    if sig != last_signature:
                        print(json.dumps({"type": "snapshot", "jobs": jobs}), flush=True)
                        last_signature = sig
                for p in list(children):
                    if p.poll() is not None:
                        print(json.dumps({"type": "exit", "rc": p.returncode}), flush=True)
                        cleanup_servers()
                        return 1
                time.sleep(1.5)
        except KeyboardInterrupt:
            pass
        finally:
            cleanup_servers()
        return 0

    # Human mode: render a live batch dashboard so the operator can see all jobs
    # the browser (or other CLIs in --share mode) are creating in real time.
    try:
        with Live(
            _render_serve_dashboard([], backend=base_url(host, port), web=web_url,
                                    outputs_dir=effective_outputs, error=None),
            console=console,
            refresh_per_second=4,
            screen=False,
        ) as live:
            while True:
                jobs = _fetch_jobs(host, port)
                fetch_error = None if jobs is not None else "backend unreachable"
                live.update(_render_serve_dashboard(
                    jobs or [],
                    backend=base_url(host, port),
                    web=web_url,
                    outputs_dir=effective_outputs,
                    error=fetch_error,
                ))
                for p in list(children):
                    if p.poll() is not None:
                        live.stop()
                        console.print(f"[red]child process exited (rc={p.returncode}); shutting down[/red]")
                        cleanup_servers()
                        return 1
                time.sleep(1.0)
    except KeyboardInterrupt:
        pass
    finally:
        cleanup_servers()
    return 0


def _fetch_jobs(host: str, port: int) -> Optional[list[dict]]:
    try:
        r = httpx.get(f"{base_url(host, port)}/api/jobs", timeout=2.0)
        if r.status_code == 200:
            return r.json().get("jobs") or []
    except (httpx.HTTPError, ValueError):
        return None
    return None


def _format_age(created_at: float) -> str:
    delta = max(0.0, time.time() - created_at)
    if delta < 60:
        return f"{int(delta)}s"
    if delta < 3600:
        return f"{int(delta // 60)}m{int(delta % 60):02d}s"
    return f"{int(delta // 3600)}h{int((delta % 3600) // 60):02d}m"


_STATUS_STYLE = {
    "queued": "yellow",
    "running": "cyan",
    "paused": "magenta",
    "done": "green",
    "error": "red",
    "cancelled": "dim",
}


def _render_serve_dashboard(
    jobs: list[dict], *, backend: str, web: Optional[str],
    outputs_dir: Optional[Path], error: Optional[str],
) -> Group:
    header = Table.grid(padding=(0, 2))
    header.add_column(style="bold cyan", justify="right")
    header.add_column()
    if web:
        header.add_row("Web UI", f"[bold link={web}]{web}[/]")
    header.add_row("Backend", f"[link={backend}]{backend}[/]")
    if outputs_dir is not None:
        header.add_row("Outputs", str(outputs_dir))

    counts: dict[str, int] = {}
    for j in jobs:
        counts[j.get("status", "?")] = counts.get(j.get("status", "?"), 0) + 1
    summary_parts = [f"total {len(jobs)}"]
    for st in ("running", "queued", "paused", "done", "error", "cancelled"):
        if counts.get(st):
            summary_parts.append(f"[{_STATUS_STYLE.get(st, 'white')}]{st} {counts[st]}[/]")
    header.add_row("Jobs", " · ".join(summary_parts))

    table = Table(expand=True, show_lines=False, padding=(0, 1))
    table.add_column("#", justify="right", width=3, style="dim")
    table.add_column("File", overflow="fold")
    table.add_column("Mode", width=4, justify="center")
    table.add_column("Status", width=10)
    table.add_column("Progress", width=22)
    table.add_column("Seg", justify="right", width=5)
    table.add_column("Age", justify="right", width=7, style="dim")

    if not jobs:
        body: Group | Table = Table.grid()
        body.add_row(Text("尚無任務 — 從瀏覽器上傳檔案或開始 OBS 直播，這裡會同步顯示。", style="dim"))
    else:
        # Backend returns newest first; reverse so #1 is the oldest in the list
        # which reads better when you batch-upload N files in order.
        ordered = list(reversed(jobs))
        for idx, j in enumerate(ordered, start=1):
            status = j.get("status", "?")
            style = _STATUS_STYLE.get(status, "white")
            progress = j.get("progress") or 0
            bar_width = 14
            filled = int(round(progress * bar_width))
            bar = "█" * filled + "░" * (bar_width - filled)
            progress_cell = f"[{style}]{bar}[/] {progress * 100:5.1f}%"
            mode = "🔴" if j.get("live") else "📄"
            fname = j.get("filename") or j.get("id", "")[:8]
            if j.get("error"):
                fname = f"{fname}  [red]{j['error']}[/]"
            table.add_row(
                str(idx),
                fname,
                mode,
                f"[{style}]{status}[/]",
                progress_cell,
                str(j.get("segment_count", 0)),
                _format_age(j.get("created_at") or time.time()),
            )
        body = table

    pieces: list = [
        Panel(header, title="Meet · serve", border_style="cyan"),
        body,
    ]
    if error:
        pieces.append(Text(f"⚠ {error}", style="yellow"))
    pieces.append(Text("Ctrl-C to stop · refresh ~1s", style="dim"))
    return Group(*pieces)


def run_human(args, host: str, port: int) -> int:
    console = Console()
    children: list[subprocess.Popen] = []
    keys = KeyListener()
    state = {"job_id": None, "status": "starting"}

    def cleanup_servers():
        for p in reversed(children):
            kill_group(p)

    def signal_handler(*_):
        # Ctrl-C: cancel the job (if any) so frontend sees it cancelled, then exit.
        if state.get("job_id"):
            post_job_action(host, port, state["job_id"], "cancel")
        keys.stop()
        cleanup_servers()
        sys.exit(130)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    rc = _ensure_servers(args, host, port, console, children)
    if rc is not None:
        return rc

    if args.web:
        web_url = f"http://localhost:{args.web_port}"
        _print_url_banner(
            console,
            backend=base_url(host, port),
            web=web_url,
            outputs_dir=getattr(args, "outputs_dir", None),
        )
        if args.open:
            _open_browser(web_url, console)

    if args.live:
        try:
            resp = create_live_job(
                host, port, args.listen_url,
                None if args.language == "auto" else args.language,
                not args.no_vad, args.beam_size, args.chunk_seconds, args.label,
            )
            job_id = resp["id"]
        except httpx.HTTPError as e:
            console.print(f"[red]failed to create live job: {e}[/red]")
            cleanup_servers()
            return 1
        file_path = Path(f"<live:{args.listen_url}>")
        console.print(f"[cyan]live job:[/cyan] {job_id} · listening on {args.listen_url}")
    else:
        file_path = Path(args.file).resolve()
        if not file_path.exists():
            console.print(f"[red]file not found: {file_path}[/red]")
            cleanup_servers()
            return 2

        try:
            job_id = create_job(host, port, file_path, None if args.language == "auto" else args.language, not args.no_vad, args.beam_size)
        except httpx.HTTPError as e:
            console.print(f"[red]failed to create job: {e}[/red]")
            cleanup_servers()
            return 1
        console.print(f"[cyan]job:[/cyan] {job_id}")
    state["job_id"] = job_id

    estimate: Optional[dict] = None
    info: Optional[dict] = None
    segments: list[dict] = []

    progress = Progress(
        TextColumn("[cyan]progress"), BarColumn(), TextColumn("{task.percentage:>3.0f}%"),
        TextColumn("·"), TimeElapsedColumn(), TextColumn("· ETA {task.fields[eta]}"),
    )
    task_id = progress.add_task("transcribe", total=100, eta="—")

    def render() -> Group:
        head = Table.grid(padding=(0, 1))
        head.add_column(style="bold"); head.add_column()
        head.add_row("Job", job_id)
        head.add_row("File", str(file_path))
        if estimate:
            head.add_row("Audio", f"{fmt_duration(estimate['duration_seconds'])} · est ~{fmt_duration(estimate['eta_seconds'])}")
            head.add_row("Model", f"{estimate['model']} · {estimate['device']} · {estimate['compute']}")
        if info:
            head.add_row("Language", f"{info['language']} ({info['language_probability'] * 100:.0f}%)")
        head.add_row("Segments", str(len(segments)))
        head.add_row("Status", state["status"])

        body = Text()
        for seg in segments[-12:]:
            body.append(f"[{fmt_ts(seg['start'])}] ", style="dim")
            body.append(seg["text"] + "\n")
        if not segments:
            body.append("waiting for segments…\n", style="dim")

        hint = Text("\n[p] pause/resume   [c] cancel   [q] quit (cancels job)", style="dim")
        title = f"Meet · {state['status']}"
        return Group(
            Panel(head, title=title, border_style="cyan"),
            progress,
            Panel(body, title="transcript (last 12)", border_style="green"),
            hint,
        )

    keys.start()
    exit_code = 0
    out_fh = open(args.output, "w", encoding="utf-8") if args.output else None
    quit_requested = False
    try:
        with Live(render(), console=console, refresh_per_second=8) as live:
            for event in stream_job_events(host, port, job_id):
                t = event.get("type")
                if t == "estimate":
                    estimate = event
                    progress.update(task_id, eta=fmt_duration(event["eta_seconds"]))
                elif t == "info":
                    info = event
                elif t == "segment":
                    segments.append(event)
                    if out_fh:
                        out_fh.write(event["text"] + "\n"); out_fh.flush()
                    if estimate and estimate["duration_seconds"] > 0:
                        pct = min(100, event["end"] / estimate["duration_seconds"] * 100)
                        remaining = max(0, estimate["eta_seconds"] * (1 - pct / 100))
                        progress.update(task_id, completed=pct, eta=fmt_duration(remaining))
                elif t == "state":
                    state["status"] = event.get("status", state["status"])
                    if event.get("status") == "done":
                        progress.update(task_id, completed=100, eta="0s")
                    if event.get("status") in ("done", "error", "cancelled"):
                        if event.get("status") == "error":
                            exit_code = 1
                        live.update(render())
                        break
                elif t == "error":
                    state["status"] = "error"
                    exit_code = 1

                # Drain key presses
                while True:
                    ch = keys.pop()
                    if ch is None:
                        break
                    if ch == "p":
                        action = "resume" if state["status"] == "paused" else "pause"
                        post_job_action(host, port, job_id, action)
                    elif ch == "c":
                        post_job_action(host, port, job_id, "cancel")
                    elif ch == "q":
                        quit_requested = True
                        post_job_action(host, port, job_id, "cancel")

                live.update(render())
                if quit_requested:
                    break
    except httpx.HTTPError as e:
        console.print(f"[red]http error: {e}[/red]")
        exit_code = 1
    finally:
        keys.stop()
        if out_fh:
            out_fh.close()

    # Mirror backend's authoritative output file to user's -o (if provided and not already streamed)
    if args.output and not state.get("status") == "cancelled":
        try:
            j = httpx.get(f"{base_url(host, port)}/api/jobs/{job_id}", timeout=5).json()
            backend_out = Path(j.get("output_path") or "")
        except (httpx.HTTPError, ValueError):
            backend_out = Path("")
        if backend_out.exists() and not Path(args.output).exists():
            shutil.copy(backend_out, args.output)

    if args.output:
        console.print(f"[dim]transcript → {args.output}[/dim]")

    cleanup_servers()
    return exit_code


def run_json(args, host: str, port: int) -> int:
    """Line-delimited JSON output for AI/script consumption (no TUI controls)."""
    console = Console(stderr=True)
    children: list[subprocess.Popen] = []
    state = {"job_id": None}

    def signal_handler(*_):
        if state.get("job_id"):
            post_job_action(host, port, state["job_id"], "cancel")
        for p in reversed(children):
            kill_group(p)
        sys.exit(130)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    rc = _ensure_servers(args, host, port, console, children)
    if rc is not None:
        if rc == 2:
            print(json.dumps({"type": "error", "message": "backend autostart failed"}))
        return rc
    if args.web:
        web_url = f"http://localhost:{args.web_port}"
        print(json.dumps({"type": "web", "url": web_url}), flush=True)
        if args.open:
            _open_browser(web_url, console)

    if args.live:
        try:
            resp = create_live_job(
                host, port, args.listen_url,
                None if args.language == "auto" else args.language,
                not args.no_vad, args.beam_size, args.chunk_seconds, args.label,
            )
            job_id = resp["id"]
        except httpx.HTTPError as e:
            print(json.dumps({"type": "error", "message": str(e)}))
            for p in reversed(children):
                kill_group(p)
            return 1
        state["job_id"] = job_id
        print(json.dumps({"type": "job", "id": job_id, "live": True, "listen_url": args.listen_url}), flush=True)
    else:
        file_path = Path(args.file).resolve()
        if not file_path.exists():
            print(json.dumps({"type": "error", "message": f"file not found: {file_path}"}))
            for p in reversed(children):
                kill_group(p)
            return 2

        try:
            job_id = create_job(host, port, file_path, None if args.language == "auto" else args.language, not args.no_vad, args.beam_size)
        except httpx.HTTPError as e:
            print(json.dumps({"type": "error", "message": str(e)}))
            for p in reversed(children):
                kill_group(p)
            return 1
        state["job_id"] = job_id
        print(json.dumps({"type": "job", "id": job_id}), flush=True)

    exit_code = 0
    out_fh = open(args.output, "w", encoding="utf-8") if args.output else None
    try:
        for event in stream_job_events(host, port, job_id):
            print(json.dumps(event, ensure_ascii=False), flush=True)
            if event.get("type") == "segment" and out_fh:
                out_fh.write(event["text"] + "\n"); out_fh.flush()
            elif event.get("type") == "error":
                exit_code = 1
            elif event.get("type") == "state" and event.get("status") in ("done", "error", "cancelled"):
                if event.get("status") == "error":
                    exit_code = 1
                break
    except httpx.HTTPError as e:
        print(json.dumps({"type": "error", "message": str(e)}))
        exit_code = 1
    finally:
        if out_fh:
            out_fh.close()
        for p in reversed(children):
            kill_group(p)

    return exit_code


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="meet-cli",
        description="Transcribe audio/video via the Meet backend (FastAPI + faster-whisper).",
    )
    p.add_argument("file", nargs="?", help="Path to audio/video file (omit when using --live)")
    p.add_argument("--live", action="store_true",
                   help="Live mode: receive an OBS/ffmpeg stream and transcribe in real time")
    p.add_argument("--listen-url", default=os.environ.get("MEET_LIVE_LISTEN_URL", "tcp://0.0.0.0:9999?listen=1"),
                   help="Live mode listen URL passed to ffmpeg (default tcp://0.0.0.0:9999?listen=1)")
    p.add_argument("--chunk-seconds", type=float, default=6.0,
                   help="Live mode rolling chunk size in seconds (default 6)")
    p.add_argument("--label", default=None, help="Live mode display label for the job")
    p.add_argument("-l", "--language", default="zh-TW",
                   help="Language code (default: zh-TW). Accepts: zh-TW, zh-CN, zh, en, ja, ko, … or 'auto'.")
    p.add_argument("--no-vad", action="store_true", help="Disable VAD silence filtering")
    p.add_argument("--beam-size", type=int, default=5, help="Beam search size (default 5)")
    p.add_argument("-o", "--output", default=None, help="Write final transcript to this file (text)")
    p.add_argument("--host", default=DEFAULT_HOST, help=f"Backend host (default {DEFAULT_HOST})")
    p.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Backend port (default {DEFAULT_PORT})")
    p.add_argument("--no-autostart", action="store_true", help="Do not auto-start backend if unreachable")
    p.add_argument("--json", action="store_true", help="Emit line-delimited JSON events (for scripting/AI)")
    p.add_argument("--web", action="store_true", help="Also start the frontend dev server and print its URL")
    p.add_argument("--web-port", type=int, default=DEFAULT_WEB_PORT, help=f"Frontend port (default {DEFAULT_WEB_PORT})")
    p.add_argument("--open", action="store_true",
                   help="Open the web UI in the default browser once it's ready (implies --web).")
    p.add_argument("--serve", action="store_true",
                   help="Servers-only mode: start backend (and frontend) and let the web UI drive everything. "
                        "No `file` argument needed; combine with --outputs-dir to pin where transcripts go.")
    p.add_argument("-S", "--share", action="store_true",
                   help="Share state with an already-running Meet backend on --port instead of "
                        "starting a new isolated instance. Without this flag (the default), each "
                        "CLI invocation auto-increments to the next free port and uses a per-session "
                        "config dir, so multiple CLIs never collide.")
    # Back-compat: --isolated used to be the opt-in name; it's now the default,
    # so accept the flag silently and ignore it.
    p.add_argument("-I", "--isolated", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--outputs-dir", type=Path, default=None,
                   help="Directory where the backend writes transcript outputs (sets MEET_OUTPUTS_DIR). "
                        "Only takes effect when this CLI starts the backend itself.")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.outputs_dir is not None:
        args.outputs_dir = args.outputs_dir.expanduser().resolve()
        args.outputs_dir.mkdir(parents=True, exist_ok=True)
    if args.open:
        args.web = True
    # Default = isolated: every CLI invocation gets its own backend on a free
    # port (auto-incremented from --port) plus a private MEET_CONFIG_DIR so
    # JOBS, outputs_dir, and config.json never leak between sibling CLIs.
    # Opt out with --share to attach to an existing backend on --port instead.
    if not args.share:
        chosen_port = find_free_port(args.port)
        if chosen_port != args.port:
            print(
                f"[isolated] backend port {args.port} taken — using next free port {chosen_port}",
                file=sys.stderr,
            )
        args.port = chosen_port
        if args.web:
            chosen_web = find_free_port(args.web_port)
            if chosen_web != args.web_port:
                print(
                    f"[isolated] frontend port {args.web_port} taken — using next free port {chosen_web}",
                    file=sys.stderr,
                )
            args.web_port = chosen_web
        session_cfg = Path(tempfile.mkdtemp(prefix="meet-cli-"))
        args._extra_backend_env = {"MEET_CONFIG_DIR": str(session_cfg)}
        # We just picked a free port — there is by definition no backend there
        # yet, so attaching is impossible; force autostart.
        args.no_autostart = False
    if args.serve:
        # Default to also bringing up the web UI in serve mode — that's the whole point.
        args.web = True
        return run_serve(args, args.host, args.port)
    if not args.live and not args.file:
        print("error: file argument is required (or pass --live, or --serve)", file=sys.stderr)
        return 2
    if args.json:
        return run_json(args, args.host, args.port)
    return run_human(args, args.host, args.port)


if __name__ == "__main__":
    sys.exit(main())
