"""Live streaming Whisper worker subprocess.

Reads a single JSON config line from stdin, spawns ffmpeg to receive an
audio/video stream from the configured listen URL (e.g. OBS streaming to
``tcp://0.0.0.0:9999?listen=1``), then runs faster-whisper on fixed-size
PCM chunks and emits NDJSON events on stdout.

Event schema is identical to ``worker.py`` plus live-only events:
``listening`` (model loaded, ffmpeg spawned), ``receiving`` (first PCM
bytes arrived), ``backlog`` (transcription is falling behind / caught up
again), ``disconnected`` (the sender went away, waiting for it to come
back), ``reconnected`` (a new sender connected) and ``warning`` (one chunk
failed to transcribe; the session carries on).

Two things this worker must never do, both learned the hard way:

1. **Never stop reading ffmpeg's PCM pipe.** Transcription is far slower
   than the ~2 s of audio a 64 KB pipe holds, so a read loop that calls
   whisper inline leaves ffmpeg blocked in ``write(pipe:1)``. ffmpeg's
   transcode loop is single-threaded, so a blocked output also stops it
   from draining the TCP socket — the backpressure travels all the way to
   OBS, which cannot slow down a live capture and drops the connection.
   Measured: the sender gets throttled to ~0.8x realtime. Hence the
   dedicated reader thread below; when whisper falls behind, audio piles
   up in *our* memory instead of in the kernel's socket buffers.
2. **Never treat EOF as the end of the session.** ``?listen=1`` accepts a
   single connection, so an OBS restart or a momentary blip would end the
   job and stop listening, leaving OBS's auto-reconnect with nothing to
   connect to. Instead we respawn ffmpeg and wait out a grace period.

Lifecycle is controlled by the parent via signals: SIGINT (or SIGTERM)
stops the session. There is no pause — SIGSTOP would freeze ffmpeg too,
which is exactly the backpressure note 1 warns about, so the backend
refuses to pause live jobs. Started with ``start_new_session=True`` by the parent so
``killpg`` reaches both this script and its ffmpeg child.
"""
from __future__ import annotations

import collections
import json
import os
import signal
import subprocess
import sys
import threading
import time
from typing import Optional

import numpy as np
from faster_whisper import WhisperModel

from parent_watch import watch_parent


_LANG_PROMPTS = {
    "zh-TW": ("zh", "以下是繁體中文的句子。"),
    "zh-CN": ("zh", "以下是简体中文的句子。"),
}

SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2  # s16le mono
BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE

# How long to keep the port open after the sender disconnects before giving
# up on the session. OBS' auto-reconnect retries every few seconds, so a
# minute covers "I stopped streaming to fix a scene and started again".
RECONNECT_GRACE_SECONDS = float(os.environ.get("MEET_LIVE_RECONNECT_GRACE", "60"))

# Hard cap on un-transcribed audio held in memory when whisper can't keep
# up. 600 s of 16k mono s16le is ~19 MB; past that the transcript is so far
# behind that keeping the audio helps nobody, so we drop the oldest.
MAX_BACKLOG_SECONDS = float(os.environ.get("MEET_LIVE_MAX_BACKLOG", "600"))

READ_SIZE = 65536

# --- Audio level monitoring ---------------------------------------------
# Measured on the same PCM whisper consumes, so "silent" here means the
# transcript *will* be empty. The case this exists for: an OBS audio source
# that quietly stops delivering samples (macOS ScreenCaptureKit does this
# when the default output device changes mid-stream, e.g. headphones connect)
# while video keeps flowing — the stream looks perfectly healthy otherwise.
LEVEL_WINDOW_SECONDS = 0.1
LEVEL_EMIT_INTERVAL = 0.25
# Never ship more than this many windows in one event; a long transcribe
# blocks the drain loop and would otherwise release a huge backlog at once.
LEVEL_MAX_WINDOWS = 100
# ~-50 dBFS. Room tone sits well above this; a dead capture is exactly 0.
SILENCE_PEAK = float(os.environ.get("MEET_LIVE_SILENCE_PEAK", "0.003"))
SILENCE_ALERT_SECONDS = float(os.environ.get("MEET_LIVE_SILENCE_ALERT", "5"))
# Counted in whole windows: accumulating 0.1 in a float drifts, and the
# threshold would land a window or more late.
SILENCE_ALERT_WINDOWS = max(1, round(SILENCE_ALERT_SECONDS / LEVEL_WINDOW_SECONDS))


def resolve_language(lang):
    if lang == "auto":
        return None, None
    if not lang:
        return _LANG_PROMPTS["zh-TW"]
    if lang in _LANG_PROMPTS:
        return _LANG_PROMPTS[lang]
    return lang, None


def emit(event):
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


_FFMPEG: Optional[subprocess.Popen] = None

# Set by the signal handler so the reconnect loop never respawns ffmpeg while
# we are on our way out (cancel sends SIGINT to the whole process group, so
# ffmpeg EOFs at the same moment the handler fires).
_STOPPING = False


def _terminate_ffmpeg() -> None:
    """Wait for ffmpeg to finish, draining its stdout so it can flush output.

    When main.py cancels a live job it does `killpg(SIGINT)` on the worker's
    process group — that hits ffmpeg directly with one SIGINT, which is the
    polite "Ctrl-C once" signal. We must NOT send a second SIGINT here:
    ffmpeg interprets two SIGINTs as "force quit now" and skips writing the
    trailer (moov atom for m4a/mp4), leaving a 28-byte unplayable file.
    """
    global _FFMPEG
    if _FFMPEG and _FFMPEG.poll() is None:
        try:
            # Drain stdout in a background thread so ffmpeg's PCM pipe doesn't
            # back up while it's finalizing the recording output. Otherwise
            # ffmpeg blocks on write() to a full pipe and never writes the
            # trailer before our wait() times out.
            if _FFMPEG.stdout is not None:
                def _drain():
                    try:
                        while _FFMPEG and _FFMPEG.stdout and _FFMPEG.stdout.read(8192):
                            pass
                    except Exception:
                        pass
                threading.Thread(target=_drain, daemon=True).start()
            try:
                _FFMPEG.wait(5)
            except subprocess.TimeoutExpired:
                # Last resort: ffmpeg didn't finalize in time, kill it. The
                # recording will be truncated but that's better than hanging.
                _FFMPEG.terminate()
                try:
                    _FFMPEG.wait(2)
                except subprocess.TimeoutExpired:
                    _FFMPEG.kill()
        except ProcessLookupError:
            pass


def _on_term(signum, frame):
    global _STOPPING
    _STOPPING = True
    _terminate_ffmpeg()
    sys.exit(0)


class PcmReader:
    """Drains ffmpeg's PCM stdout into memory on a dedicated thread.

    The whole point is that ``os.read`` keeps running while the main thread
    is inside ``model.transcribe`` — see note 1 in the module docstring.
    """

    def __init__(self, proc: subprocess.Popen) -> None:
        self._proc = proc
        self._chunks: "collections.deque[bytes]" = collections.deque()
        self._cv = threading.Condition()
        self._eof = False
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        fd = self._proc.stdout.fileno()
        while True:
            try:
                data = os.read(fd, READ_SIZE)
            except OSError:
                data = b""
            with self._cv:
                if not data:
                    self._eof = True
                    self._cv.notify_all()
                    return
                self._chunks.append(data)
                self._cv.notify_all()

    def drain(self, timeout: float) -> tuple[bytes, bool]:
        """Return (bytes read so far, eof). Waits up to `timeout` for data."""
        with self._cv:
            if not self._chunks and not self._eof:
                self._cv.wait(timeout)
            data = b"".join(self._chunks)
            self._chunks.clear()
            return data, (self._eof and not data)


class LevelMeter:
    """Turns the PCM stream into a waveform feed plus a silence watchdog.

    Windows are counted in *audio* time, not wall time, so a stalled stream
    can never be mistaken for silence — that case is already reported as
    ``disconnected``. Silence here means the stricter, more confusing thing:
    bytes keep arriving and every one of them is zero.
    """

    def __init__(self) -> None:
        self._win_bytes = int(SAMPLE_RATE * BYTES_PER_SAMPLE * LEVEL_WINDOW_SECONDS)
        self._residue = bytearray()
        self._peaks: list[float] = []
        self._rms: list[float] = []
        self._last_emit = 0.0
        self._silent_windows = 0
        self.alerting = False

    @property
    def silent_seconds(self) -> float:
        return round(self._silent_windows * LEVEL_WINDOW_SECONDS, 1)

    def reset(self) -> None:
        self._residue.clear()
        self._peaks.clear()
        self._rms.clear()
        self._silent_windows = 0
        self.alerting = False

    def feed(self, data: bytes) -> None:
        self._residue.extend(data)
        windows = len(self._residue) // self._win_bytes
        if not windows:
            return
        take = windows * self._win_bytes
        block = np.frombuffer(bytes(self._residue[:take]), dtype=np.int16)
        del self._residue[:take]
        frames = block.reshape(windows, -1).astype(np.float32) / 32768.0
        peaks = np.abs(frames).max(axis=1)
        rms = np.sqrt((frames ** 2).mean(axis=1))
        self._peaks.extend(round(float(p), 4) for p in peaks)
        self._rms.extend(round(float(r), 4) for r in rms)
        del self._peaks[:-LEVEL_MAX_WINDOWS]
        del self._rms[:-LEVEL_MAX_WINDOWS]
        # Only the run *ending* at the newest window matters, so find the last
        # audible window in this block and count what follows it.
        audible = np.nonzero(peaks >= SILENCE_PEAK)[0]
        if audible.size:
            self._silent_windows = int(windows - 1 - audible[-1])
        else:
            self._silent_windows += windows

    def due(self, now: float) -> bool:
        return bool(self._peaks) and now - self._last_emit >= LEVEL_EMIT_INTERVAL

    def take(self, now: float) -> dict:
        """The waveform event. Transient — the parent must not log it."""
        event = {
            "type": "level",
            "window_seconds": LEVEL_WINDOW_SECONDS,
            "peaks": list(self._peaks),
            "rms": list(self._rms),
            "silent_seconds": self.silent_seconds,
        }
        self._peaks.clear()
        self._rms.clear()
        self._last_emit = now
        return event

    def silence_event(self) -> Optional[dict]:
        """Durable event, emitted only when the silent/audible state flips."""
        if not self.alerting and self._silent_windows >= SILENCE_ALERT_WINDOWS:
            self.alerting = True
            return {"type": "audio_silent", "silent": True,
                    "seconds": self.silent_seconds}
        if self.alerting and self._silent_windows == 0:
            self.alerting = False
            return {"type": "audio_silent", "silent": False, "seconds": 0.0}
        return None


def build_ffmpeg_args(listen_url: str, record_path: Optional[str], record_kind: str) -> list[str]:
    args = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-i", listen_url,
    ]
    if record_path:
        # Output 1: persist a local copy of the stream. For "video" kind we
        # stream-copy everything (video+audio) — no re-encode. For "audio" kind
        # we keep just the audio track; OBS' mpegts pipeline produces AAC, so
        # m4a/aac stream-copies cleanly; mp3/wav must re-encode.
        if record_kind == "audio":
            ext = os.path.splitext(record_path)[1].lower().lstrip(".")
            if ext == "mp3":
                args += ["-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "192k", record_path]
            elif ext == "wav":
                args += ["-map", "0:a:0", "-c:a", "pcm_s16le", record_path]
            else:  # m4a / aac / mp4 audio-only
                # m4a (ipod muxer) only accepts AAC/ALAC. OBS' "Custom FFmpeg
                # Output" defaults to MP2 in many mpegts presets, which fails
                # stream-copy into m4a with rc=234 / EINVAL. Always transcode
                # to AAC so the recording works regardless of OBS settings.
                # Fragmented MP4 so the file stays playable if ffmpeg is
                # killed mid-stream (otherwise the moov atom never lands).
                args += [
                    "-map", "0:a:0", "-c:a", "aac", "-b:a", "192k",
                    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
                    record_path,
                ]
        else:
            # mp4/m4v/mov containers don't accept arbitrary audio codecs (e.g.
            # OBS' default MP2 in mpegts) → stream-copy fails with rc=234.
            # Transcode audio to AAC for these, keep video as stream-copy.
            # mkv/ts/mpegts accept anything → safe to copy everything.
            vext = os.path.splitext(record_path)[1].lower().lstrip(".")
            if vext in ("mp4", "m4v", "mov"):
                # Fragmented MP4 — playable even if ffmpeg is killed before
                # writing the trailing moov atom.
                args += [
                    "-map", "0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
                    record_path,
                ]
            else:
                args += ["-map", "0", "-c", "copy", record_path]
    # Output 2: 16k mono PCM on stdout for whisper.
    args += [
        "-map", "0:a:0",
        "-ac", "1", "-ar", str(SAMPLE_RATE),
        "-f", "s16le", "pipe:1",
    ]
    return args


def record_path_for(base: Optional[str], attempt: int) -> Optional[str]:
    """Recording path for the n-th connection.

    A reconnect means a fresh ffmpeg, and no container can be reopened and
    appended to, so each reconnect writes its own numbered file next to the
    first one: ``recording.mkv``, ``recording.2.mkv``, …
    """
    if not base or attempt == 0:
        return base
    root, ext = os.path.splitext(base)
    return f"{root}.{attempt + 1}{ext}"


def spawn_ffmpeg(args: list[str]) -> tuple[subprocess.Popen, "collections.deque[str]", dict]:
    global _FFMPEG
    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
    )
    _FFMPEG = proc

    # Drain ffmpeg's stderr in a background thread so we can surface the
    # last few lines if it exits non-zero (e.g. rc=234 / EINVAL).
    stderr_tail: "collections.deque[str]" = collections.deque(maxlen=20)
    # When *we* tear down an idle listener, ffmpeg complains ("Error opening
    # input file ...") — that's our doing, not a stream problem, so the
    # caller flips `quiet` first to keep it out of the job's event log.
    flags = {"quiet": False}

    def _pump_stderr() -> None:
        assert proc.stderr
        for raw in proc.stderr:
            try:
                line = raw.decode("utf-8", errors="replace").rstrip()
            except Exception:
                continue
            if line:
                stderr_tail.append(line)
                if not flags["quiet"]:
                    emit({"type": "ffmpeg_log", "line": line})

    threading.Thread(target=_pump_stderr, daemon=True).start()
    return proc, stderr_tail, flags


def main():
    config = json.loads(sys.stdin.readline())
    listen_url = config["listen_url"]
    language = config.get("language")
    vad = config.get("vad", True)
    beam_size = config.get("beam_size", 5)
    model_size = config.get("model", "medium")
    device = config.get("device", "cpu")
    compute = config.get("compute", "int8")
    chunk_seconds = float(config.get("chunk_seconds", 15.0))
    record_path = config.get("record_path")  # optional path to mux a copy of the stream
    record_kind = config.get("record_kind", "video")  # "video" (stream-copy all) | "audio" (audio only)
    grace = float(config.get("reconnect_grace_seconds", RECONNECT_GRACE_SECONDS))
    # Whole samples only: an odd byte count would split an int16 in two.
    chunk_bytes = max(BYTES_PER_SAMPLE, int(BYTES_PER_SECOND * chunk_seconds) // BYTES_PER_SAMPLE * BYTES_PER_SAMPLE)
    max_backlog_bytes = int(BYTES_PER_SECOND * MAX_BACKLOG_SECONDS)

    signal.signal(signal.SIGTERM, _on_term)
    # main.py cancels live jobs by sending SIGINT to the worker group so
    # ffmpeg receives it directly and writes a clean trailer (moov atom for
    # MP4/m4a). Handle it here as well so the worker shuts down promptly.
    signal.signal(signal.SIGINT, _on_term)
    watch_parent(signal.SIGINT)

    try:
        model = WhisperModel(model_size, device=device, compute_type=compute)
    except Exception as exc:
        emit({"type": "error", "message": f"model load failed: {exc}"})
        sys.exit(1)

    whisper_lang, initial_prompt = resolve_language(language)
    info_emitted = False
    # Stream time (seconds) of the first byte in `buf`. Advanced by exactly
    # the audio each chunk covers — and by any audio dropped from the
    # backlog — so segment timestamps stay on the stream's own clock.
    timeline = 0.0
    buf = bytearray()
    lagging = False
    meter = LevelMeter()

    def transcribe_chunk(pcm: bytes, t0: float) -> None:
        nonlocal info_emitted
        pcm = pcm[: len(pcm) - len(pcm) % BYTES_PER_SAMPLE]
        if not pcm:
            return
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        if audio.size == 0:
            return
        try:
            segments, info = model.transcribe(
                audio,
                language=whisper_lang,
                beam_size=beam_size,
                vad_filter=vad,
                initial_prompt=initial_prompt,
            )
            if not info_emitted:
                emit({
                    "type": "info",
                    "language": info.language,
                    "language_probability": info.language_probability,
                    "duration": info.duration,
                })
                info_emitted = True
            for seg in segments:
                text = (seg.text or "").strip()
                if not text:
                    continue
                emit({
                    "type": "segment",
                    "start": float(seg.start) + t0,
                    "end": float(seg.end) + t0,
                    "text": text,
                })
        except Exception as exc:
            # One bad chunk shouldn't end the session: it's a warning, not an
            # `error` (which the backend treats as the job failing).
            emit({"type": "warning", "message": f"transcribe error: {exc}"})

    def report_backlog() -> None:
        """Tell the parent how far behind whisper is, on change."""
        nonlocal lagging
        seconds = len(buf) / BYTES_PER_SECOND
        if seconds >= chunk_seconds:
            lagging = True
            emit({"type": "backlog", "seconds": round(seconds, 1), "lagging": True})
        elif lagging and seconds < chunk_seconds / 2:
            lagging = False
            emit({"type": "backlog", "seconds": round(seconds, 1), "lagging": False})

    attempt = 0
    received_ever = False
    exit_code = 0

    try:
        while True:
            rec_path = record_path_for(record_path, attempt)
            proc, stderr_tail, ff_flags = spawn_ffmpeg(
                build_ffmpeg_args(listen_url, rec_path, record_kind)
            )
            if attempt == 0:
                emit({
                    "type": "listening",
                    "url": listen_url,
                    "chunk_seconds": chunk_seconds,
                    "sample_rate": SAMPLE_RATE,
                    "record_path": rec_path,
                })
            reader = PcmReader(proc)
            # A fresh connection starts audible until proven otherwise; clear
            # a standing alert so the UI doesn't inherit the last attempt's.
            if meter.alerting:
                emit({"type": "audio_silent", "silent": False, "seconds": 0.0})
            meter.reset()

            # The first connection may take as long as it takes (the user
            # starts the job, then opens OBS). A *re*connect only gets the
            # grace window before we call the session over.
            deadline = None if attempt == 0 else time.monotonic() + grace
            received = False

            while True:
                # Poll in short slices so signal handlers (pause/cancel) run
                # promptly even while nothing is arriving.
                data, eof = reader.drain(1.0)
                if data:
                    if not received:
                        received = True
                        received_ever = True
                        if attempt == 0:
                            emit({"type": "receiving"})
                        else:
                            emit({
                                "type": "reconnected",
                                "attempt": attempt,
                                "record_path": rec_path,
                            })
                    buf.extend(data)
                    # Before the transcribe loop below, which can block for
                    # many seconds — the meter must stay live while it does.
                    meter.feed(data)
                    now = time.monotonic()
                    if meter.due(now):
                        emit(meter.take(now))
                    silence = meter.silence_event()
                    if silence:
                        emit(silence)
                    if len(buf) > max_backlog_bytes:
                        dropped = len(buf) - max_backlog_bytes
                        # Drop whole samples, or every later chunk would be
                        # decoded off by one byte — pure noise.
                        dropped += dropped % BYTES_PER_SAMPLE
                        del buf[:dropped]
                        timeline += dropped / BYTES_PER_SECOND
                        emit({
                            "type": "backlog",
                            "seconds": round(len(buf) / BYTES_PER_SECOND, 1),
                            "lagging": True,
                            "dropped_seconds": round(dropped / BYTES_PER_SECOND, 1),
                        })
                    while len(buf) >= chunk_bytes:
                        pcm = bytes(buf[:chunk_bytes])
                        del buf[:chunk_bytes]
                        transcribe_chunk(pcm, timeline)
                        timeline += chunk_bytes / BYTES_PER_SECOND
                        report_backlog()
                    continue
                if eof:
                    break
                if not received and deadline is not None and time.monotonic() > deadline:
                    break  # grace expired, nobody came back

            # Audio is not continuous across a reconnect, so flush whatever
            # is left (if it's worth transcribing) and start the next
            # connection with an empty buffer.
            if len(buf) >= BYTES_PER_SECOND:
                transcribe_chunk(bytes(buf), timeline)
            timeline += len(buf) / BYTES_PER_SECOND
            buf.clear()
            lagging = False

            if not received and proc.poll() is None:
                # Nobody ever connected on this attempt, so there is no
                # recording to finalize — don't sit through the polite wait.
                ff_flags["quiet"] = True
                proc.terminate()
            _terminate_ffmpeg()
            rc = proc.wait()

            if not received:
                # Never got a single byte on this attempt: either ffmpeg
                # failed outright (bad URL, port in use → rc=195/234) or the
                # grace window expired with no reconnect.
                if rc not in (0, None) and not received_ever:
                    tail = "\n".join(stderr_tail)
                    emit({
                        "type": "error",
                        "message": f"ffmpeg exited rc={rc}" + (f"\n{tail}" if tail else ""),
                        "ffmpeg_stderr": tail,
                        "rc": rc,
                    })
                    exit_code = 1
                break

            if grace <= 0 or _STOPPING:
                break

            emit({
                "type": "disconnected",
                "attempt": attempt,
                "grace_seconds": grace,
                "rc": rc,
            })
            attempt += 1
            # Give the OS a moment to release the listen socket before the
            # next ffmpeg tries to bind it.
            time.sleep(0.3)

        if exit_code == 0:
            emit({"type": "done"})
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        exit_code = 1
    finally:
        _terminate_ffmpeg()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
