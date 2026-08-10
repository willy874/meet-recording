"""Model download subprocess.

Reads a single JSON config line from stdin (`{"model": "medium"}`), emits
NDJSON progress on stdout, exits non-zero on failure. Same shape as worker.py /
live_worker.py — and for the same reason: huggingface_hub's fetch is one long
blocking call, so running it here lets the parent cancel it with a signal.

faster-whisper's own `download_model()` hard-wires `tqdm_class=disabled_tqdm`,
which is why this calls `snapshot_download` directly: the tqdm hook is the only
place real byte progress is available. `allow_patterns` mirrors faster-whisper's
so the resulting cache entry is byte-for-byte what it would have fetched itself.
"""
from __future__ import annotations

import json
import os
import sys
import time

from huggingface_hub import snapshot_download
from tqdm import tqdm

ALLOW_PATTERNS = [
    "config.json",
    "preprocessor_config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.*",
]

_BARS: dict[int, tqdm] = {}
_last_emit = 0.0
_devnull = open(os.devnull, "w")


def emit(event: dict) -> None:
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _counts_as_download(bar: tqdm) -> bool:
    """Whether this bar measures bytes coming off the network.

    The hub emits several bar flavours and summing them all double-counts:
      - "Fetching N files"    — unit "it", not bytes
      - "Downloading bytes"   — what we want (one per file on plain HTTP)
      - "Reconstructing …"    — the Xet backend reassembling chunks locally,
                                covering the *same* payload a second time
    """
    if getattr(bar, "unit", None) != "B" or not bar.total:
        return False
    return "reconstruct" not in (bar.desc or "").lower()


def _report(force: bool = False) -> None:
    """Emit the summed byte progress of every download bar."""
    global _last_emit
    now = time.monotonic()
    if not force and now - _last_emit < 0.25:
        return
    _last_emit = now
    downloaded = total = 0
    for bar in list(_BARS.values()):
        if not _counts_as_download(bar):
            continue
        downloaded += bar.n
        total += bar.total
    if total:
        emit({"type": "progress", "downloaded": downloaded, "total": total})


class ReportingTqdm(tqdm):
    """tqdm that reports to the parent instead of drawing to a terminal."""

    def __init__(self, *args, **kwargs):
        kwargs["file"] = _devnull  # keep the ASCII bar out of our NDJSON stream
        super().__init__(*args, **kwargs)
        _BARS[id(self)] = self

    def update(self, n=1):
        result = super().update(n)
        _report()
        return result

    def close(self):
        super().close()
        # Deliberately kept in the registry: a closed bar holds the final
        # byte count, and dropping it would make progress jump backwards.
        _report(force=True)


def main() -> None:
    config = json.loads(sys.stdin.readline())
    model = config["model"]
    # Mirrors main.py's model_is_cached(), which looks for exactly this repo.
    repo_id = f"Systran/faster-whisper-{model}"
    try:
        path = snapshot_download(
            repo_id,
            allow_patterns=ALLOW_PATTERNS,
            tqdm_class=ReportingTqdm,
        )
    except Exception as exc:  # network, auth, unknown repo, disk full…
        emit({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
        sys.exit(1)
    emit({"type": "done", "path": path})


if __name__ == "__main__":
    main()
