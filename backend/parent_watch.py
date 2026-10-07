"""Stop a worker subprocess once the backend that spawned it is gone.

Workers run with ``start_new_session=True`` so the backend can signal each
one's whole process group — which also means killing the backend (Ctrl-C on
the CLI, a uvicorn ``--reload``, a crash) does *not* reach them. Left alone,
an orphaned live worker keeps its ffmpeg bound to the listen port and the
next backend's live job fails with "Address already in use"; an orphaned file
worker keeps burning CPU on a transcript nobody will read.

So each worker polls its parent pid: when it changes, we were reparented and
signal our own process group, exactly as the backend's cancel would have.
"""
from __future__ import annotations

import os
import signal
import threading
import time


def watch_parent(sig: int = signal.SIGTERM, interval: float = 2.0) -> None:
    parent = os.getppid()

    def _loop() -> None:
        while True:
            time.sleep(interval)
            if os.getppid() != parent:
                try:
                    os.killpg(os.getpgrp(), sig)
                except OSError:
                    os._exit(1)
                return

    threading.Thread(target=_loop, name="parent-watch", daemon=True).start()
