"""Cross-process Gmail pacing and daily quota coordination."""

from __future__ import annotations

import json
import os
import random
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator


UTC = timezone.utc


def _as_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


@dataclass
class SendPermit:
    allowed: bool
    next_allowed_at: datetime | None = None
    _sent_at: datetime | None = None

    def mark_sent(self, sent_at: datetime) -> None:
        self._sent_at = sent_at.astimezone(UTC)


class GmailSendGate:
    """Serialize sends across campaign workers using a shared Windows lock."""

    def __init__(
        self,
        state_root: Path,
        *,
        min_delay_seconds: float,
        max_delay_seconds: float,
        daily_send_limit: int,
    ) -> None:
        self.directory = state_root / "_gmail_account"
        self.lock_path = self.directory / "send.lock"
        self.state_path = self.directory / "send_state.json"
        self.min_delay_seconds = min_delay_seconds
        self.max_delay_seconds = max_delay_seconds
        self.daily_send_limit = daily_send_limit

    @contextmanager
    def acquire(self, now: datetime) -> Iterator[SendPermit]:
        """Yield a permit while holding the account-wide send lock."""
        import msvcrt

        self.directory.mkdir(parents=True, exist_ok=True)
        with self.lock_path.open("a+b") as handle:
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                current = now.astimezone(UTC)
                state = self._read_state()
                day = current.date().isoformat()
                if state.get("day") != day:
                    state = {"day": day, "sent_count": 0, "next_allowed_at": ""}

                next_allowed_at = _as_utc(str(state.get("next_allowed_at") or ""))
                sent_count = int(state.get("sent_count") or 0)
                if sent_count >= self.daily_send_limit:
                    tomorrow = (current + timedelta(days=1)).replace(
                        hour=0, minute=0, second=0, microsecond=0
                    )
                    yield SendPermit(False, tomorrow)
                    return
                if next_allowed_at and next_allowed_at > current:
                    yield SendPermit(False, next_allowed_at)
                    return

                permit = SendPermit(True)
                yield permit
                if permit._sent_at is not None:
                    delay = random.uniform(
                        self.min_delay_seconds, self.max_delay_seconds
                    )
                    state.update(
                        {
                            "day": permit._sent_at.date().isoformat(),
                            "sent_count": sent_count + 1,
                            "last_sent_at": permit._sent_at.isoformat(),
                            "next_allowed_at": (
                                permit._sent_at + timedelta(seconds=delay)
                            ).isoformat(),
                        }
                    )
                    self._write_state(state)
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)

    def _read_state(self) -> dict[str, object]:
        if not self.state_path.exists():
            return {}
        try:
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return {}

    def _write_state(self, state: dict[str, object]) -> None:
        temporary = self.state_path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(state, indent=2, sort_keys=True), encoding="utf-8"
        )
        os.replace(temporary, self.state_path)
