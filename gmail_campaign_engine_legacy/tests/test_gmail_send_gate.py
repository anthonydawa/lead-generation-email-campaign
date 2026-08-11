"""Tests for account-wide pacing shared by concurrent campaign workers."""

from __future__ import annotations

import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gmail_send_gate import GmailSendGate


UTC = timezone.utc


def gate(root: Path, daily_limit: int = 100) -> GmailSendGate:
    return GmailSendGate(
        root,
        min_delay_seconds=600,
        max_delay_seconds=600,
        daily_send_limit=daily_limit,
    )


def test_successful_send_blocks_other_workers_until_shared_delay_expires():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        now = datetime(2026, 8, 7, 1, tzinfo=UTC)
        with gate(root).acquire(now) as permit:
            assert permit.allowed
            permit.mark_sent(now)

        with gate(root).acquire(now + timedelta(minutes=5)) as permit:
            assert not permit.allowed
            assert permit.next_allowed_at == now + timedelta(minutes=10)

        with gate(root).acquire(now + timedelta(minutes=10)) as permit:
            assert permit.allowed


def test_failed_send_does_not_consume_spacing_or_quota():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        now = datetime(2026, 8, 7, 1, tzinfo=UTC)
        with gate(root).acquire(now) as permit:
            assert permit.allowed

        with gate(root).acquire(now) as permit:
            assert permit.allowed


def test_daily_limit_is_shared_and_resets_at_utc_midnight():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        now = datetime(2026, 8, 7, 23, 40, tzinfo=UTC)
        with gate(root, daily_limit=1).acquire(now) as permit:
            permit.mark_sent(now)

        with gate(root, daily_limit=1).acquire(now + timedelta(minutes=11)) as permit:
            assert not permit.allowed
            assert permit.next_allowed_at == datetime(2026, 8, 8, tzinfo=UTC)

        with gate(root, daily_limit=1).acquire(datetime(2026, 8, 8, tzinfo=UTC)) as permit:
            assert permit.allowed
