"""Cross-process pipeline mutex backed by a lock file on the data volume.

A simple in-process flag does not survive Render restarts and does not
coordinate across multiple instances sharing the same `/data` volume.
This module provides a file-locked alternative using ``fcntl`` on
POSIX (Render / Docker / Linux) and a best-effort filesystem-only
fallback on Windows for local dev.

The lock writes the holder's PID and a monotonic timestamp into the
lock file so a stale lock from a crashed process can be reclaimed
after ``stale_after`` seconds.
"""
from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

try:
    import fcntl  # type: ignore[import-not-found]

    _HAS_FCNTL = True
except ImportError:  # pragma: no cover - Windows fallback
    _HAS_FCNTL = False


@dataclass(frozen=True)
class LockState:
    held: bool
    pid: int | None
    started_at: float | None


class PipelineLock:
    """File-based mutex with stale-lock recovery.

    Use ``acquire`` / ``release`` directly or the ``hold()`` context
    manager. ``is_held()`` is non-blocking and returns the most recent
    state without taking the lock.
    """

    def __init__(self, lock_path: Path, stale_after: float = 12 * 60) -> None:
        self._lock_path = lock_path
        self._stale_after = stale_after
        self._fd: int | None = None

    def _read_state(self) -> LockState:
        try:
            with open(self._lock_path, "r") as fh:
                payload = json.load(fh)
            pid = int(payload.get("pid")) if payload.get("pid") is not None else None
            started_at = float(payload.get("started_at")) if payload.get("started_at") is not None else None
            return LockState(held=True, pid=pid, started_at=started_at)
        except (FileNotFoundError, json.JSONDecodeError, ValueError, OSError):
            return LockState(held=False, pid=None, started_at=None)

    def is_held(self) -> bool:
        """Return True if a non-stale lock currently exists."""
        if not self._lock_path.exists():
            return False
        state = self._read_state()
        if not state.held:
            return False
        if state.started_at is None:
            return True
        if (time.time() - state.started_at) > self._stale_after:
            return False
        return True

    def _write_payload(self) -> None:
        payload = {"pid": os.getpid(), "started_at": time.time()}
        tmp_path = self._lock_path.with_suffix(self._lock_path.suffix + ".tmp")
        tmp_path.parent.mkdir(parents=True, exist_ok=True)
        with open(tmp_path, "w") as fh:
            json.dump(payload, fh)
        os.replace(tmp_path, self._lock_path)

    def acquire(self) -> bool:
        """Try to acquire the lock. Return True on success, False if already held."""
        self._lock_path.parent.mkdir(parents=True, exist_ok=True)

        if _HAS_FCNTL:
            fd = os.open(str(self._lock_path), os.O_RDWR | os.O_CREAT, 0o644)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except (BlockingIOError, OSError):
                state = self._read_state()
                if state.started_at is not None and (time.time() - state.started_at) > self._stale_after:
                    try:
                        os.unlink(self._lock_path)
                    except OSError:
                        pass
                os.close(fd)
                return False
            self._fd = fd
            os.ftruncate(fd, 0)
            payload = json.dumps({"pid": os.getpid(), "started_at": time.time()})
            os.write(fd, payload.encode("utf-8"))
            os.fsync(fd)
            return True

        if self.is_held():
            return False
        try:
            self._write_payload()
            return True
        except OSError:
            return False

    def release(self) -> None:
        if _HAS_FCNTL and self._fd is not None:
            try:
                fcntl.flock(self._fd, fcntl.LOCK_UN)
            except OSError:
                pass
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None
        try:
            if self._lock_path.exists():
                os.unlink(self._lock_path)
        except OSError:
            pass

    @contextmanager
    def hold(self) -> Iterator[None]:
        if not self.acquire():
            raise RuntimeError("Pipeline lock is already held")
        try:
            yield
        finally:
            self.release()
