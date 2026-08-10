"""Live streaming Whisper worker subprocess.

Reads a single JSON config line from stdin, spawns ffmpeg to receive an
audio/video stream from the configured listen URL (e.g. OBS streaming to
``tcp://0.0.0.0:9999?listen=1``), then runs faster-whisper on fixed-size
PCM chunks and emits NDJSON events on stdout.

Event schema is identical to ``worker.py`` plus a one-shot ``listening``
event emitted after the model is loaded and ffmpeg has been spawned.

Lifecycle is controlled by the parent via signals: SIGSTOP/SIGCONT pause
and resume the entire process group (including ffmpeg) and SIGTERM
terminates it. Started with ``start_new_session=True`` by the parent so
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
from typing import Optional

import numpy as np
from faster_whisper import WhisperModel


_LANG_PROMPTS = {
    "zh-TW": ("zh", "以下是繁體中文的句子。"),
    "zh-CN": ("zh", "以下是简体中文的句子。"),
}

SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2  # s16le mono


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
    _terminate_ffmpeg()
    sys.exit(0)


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
    chunk_bytes = int(SAMPLE_RATE * BYTES_PER_SAMPLE * chunk_seconds)

    signal.signal(signal.SIGTERM, _on_term)
    # main.py cancels live jobs by sending SIGINT to the worker group so
    # ffmpeg receives it directly and writes a clean trailer (moov atom for
    # MP4/m4a). Handle it here as well so the worker shuts down promptly.
    signal.signal(signal.SIGINT, _on_term)

    try:
        model = WhisperModel(model_size, device=device, compute_type=compute)
    except Exception as exc:
        emit({"type": "error", "message": f"model load failed: {exc}"})
        sys.exit(1)

    ffmpeg_args = [
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
                ffmpeg_args += ["-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "192k", record_path]
            elif ext == "wav":
                ffmpeg_args += ["-map", "0:a:0", "-c:a", "pcm_s16le", record_path]
            else:  # m4a / aac / mp4 audio-only
                # m4a (ipod muxer) only accepts AAC/ALAC. OBS' "Custom FFmpeg
                # Output" defaults to MP2 in many mpegts presets, which fails
                # stream-copy into m4a with rc=234 / EINVAL. Always transcode
                # to AAC so the recording works regardless of OBS settings.
                # Fragmented MP4 so the file stays playable if ffmpeg is
                # killed mid-stream (otherwise the moov atom never lands).
                ffmpeg_args += [
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
                ffmpeg_args += [
                    "-map", "0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
                    record_path,
                ]
            else:
                ffmpeg_args += ["-map", "0", "-c", "copy", record_path]
    # Output 2: 16k mono PCM on stdout for whisper.
    ffmpeg_args += [
        "-map", "0:a:0",
        "-ac", "1", "-ar", str(SAMPLE_RATE),
        "-f", "s16le", "pipe:1",
    ]

    global _FFMPEG
    _FFMPEG = subprocess.Popen(
        ffmpeg_args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
    )

    # Drain ffmpeg's stderr in a background thread so we can surface the
    # last few lines if it exits non-zero (e.g. rc=234 / EINVAL).
    stderr_tail: "collections.deque[str]" = collections.deque(maxlen=20)

    def _pump_stderr() -> None:
        assert _FFMPEG and _FFMPEG.stderr
        for raw in _FFMPEG.stderr:
            try:
                line = raw.decode("utf-8", errors="replace").rstrip()
            except Exception:
                continue
            if line:
                stderr_tail.append(line)
                emit({"type": "ffmpeg_log", "line": line})

    threading.Thread(target=_pump_stderr, daemon=True).start()

    emit({
        "type": "listening",
        "url": listen_url,
        "chunk_seconds": chunk_seconds,
        "sample_rate": SAMPLE_RATE,
        "record_path": record_path,
    })

    whisper_lang, initial_prompt = resolve_language(language)
    info_emitted = False
    chunk_index = 0
    buf = bytearray()

    def transcribe_chunk(pcm: bytes, t0: float) -> None:
        nonlocal info_emitted
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
            emit({"type": "error", "message": f"transcribe error: {exc}"})

    try:
        fd = _FFMPEG.stdout.fileno()
        receiving_emitted = False
        while True:
            try:
                data = os.read(fd, 8192)
            except OSError:
                break
            if not data:
                break
            if not receiving_emitted:
                emit({"type": "receiving"})
                receiving_emitted = True
            buf.extend(data)
            while len(buf) >= chunk_bytes:
                t0 = chunk_index * chunk_seconds
                pcm = bytes(buf[:chunk_bytes])
                del buf[:chunk_bytes]
                chunk_index += 1
                transcribe_chunk(pcm, t0)
        # flush trailing buffer if it's at least 1 second long
        if len(buf) >= SAMPLE_RATE * BYTES_PER_SAMPLE:
            transcribe_chunk(bytes(buf), chunk_index * chunk_seconds)

        rc = _FFMPEG.wait()
        if rc not in (0, None):
            tail = "\n".join(stderr_tail)
            emit({
                "type": "error",
                "message": f"ffmpeg exited rc={rc}" + (f"\n{tail}" if tail else ""),
                "ffmpeg_stderr": tail,
                "rc": rc,
            })
            sys.exit(1)
        emit({"type": "done"})
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        sys.exit(1)
    finally:
        _terminate_ffmpeg()


if __name__ == "__main__":
    main()
