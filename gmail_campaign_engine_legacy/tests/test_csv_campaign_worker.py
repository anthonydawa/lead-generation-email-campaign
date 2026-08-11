"""Tests for the restart-safe CSV campaign worker."""

from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock

from config import Settings
from csv_campaign_worker import (
    CAMPAIGN_FIELDS,
    RECIPIENT_FIELDS,
    STEP_FIELDS,
    CsvCampaignStore,
    CsvCampaignWorker,
    _atomic_write,
    as_utc,
)
from gmail_service import SentMessage


UTC = timezone.utc


def settings() -> Settings:
    return Settings(
        SUPABASE_URL="https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY="test-key",
        MIN_DELAY_SECONDS=0,
        MAX_DELAY_SECONDS=0,
        DAILY_SEND_LIMIT=10,
    )


class CsvWorkerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.store = CsvCampaignStore(Path(self.temporary.name), "campaign-1")
        _atomic_write(
            self.store.campaign_path,
            CAMPAIGN_FIELDS,
            [
                {
                    "campaign_id": "campaign-1",
                    "title": "Test",
                    "subject_template": "Hello {{first_name}}",
                    "body_template": "Initial {{company}}",
                }
            ],
        )
        _atomic_write(
            self.store.steps_path,
            STEP_FIELDS,
            [
                {"step_number": 1, "delay_days": 5, "body_template": "First"},
                {"step_number": 2, "delay_days": 7, "body_template": "Second"},
            ],
        )

    def write_recipient(self, **overrides: str) -> None:
        row = {
            "campaign_id": "campaign-1",
            "lead_id": "lead-1",
            "email": "lead@example.com",
            "first_name": "Ada",
            "company": "Analytical Engines",
            "status": "pending",
            "current_step": "0",
            "next_send_at": "2026-08-01T00:00:00+00:00",
            "updated_at": "2026-08-01T00:00:00+00:00",
        }
        row.update(overrides)
        _atomic_write(self.store.recipients_path, RECIPIENT_FIELDS, [row])

    def worker(self, gmail: Mock) -> CsvCampaignWorker:
        remote = Mock()
        local_status = self.store.recipients()[0]["status"]
        remote.get_campaign_lead_status.return_value = (
            "sent" if local_status == "scheduled" else "pending"
        )
        return CsvCampaignWorker(settings(), remote, gmail, self.store)

    def test_online_skip_stops_active_worker_before_send(self) -> None:
        self.write_recipient()
        gmail = Mock()
        remote = Mock()
        remote.get_campaign_lead_status.return_value = "skipped"

        result = CsvCampaignWorker(settings(), remote, gmail, self.store).run_once(
            datetime(2026, 8, 5, 12, tzinfo=UTC)
        )

        self.assertEqual(result.sent, 0)
        self.assertEqual(self.store.recipients()[0]["status"], "skipped")
        gmail.send_email.assert_not_called()

    def test_overdue_initial_send_uses_actual_send_for_next_date(self) -> None:
        self.write_recipient()
        now = datetime(2026, 8, 5, 12, tzinfo=UTC)
        gmail = Mock()
        gmail.send_email.return_value = SentMessage(
            "message-1", "thread-1", "<initial@example.com>"
        )

        result = self.worker(gmail).run_once(now)

        self.assertEqual(result.sent, 1)
        recipient = self.store.recipients()[0]
        self.assertEqual(recipient["status"], "scheduled")
        self.assertEqual(as_utc(recipient["next_send_at"]), now + timedelta(days=5))
        self.assertEqual(recipient["current_step"], "0")

    def test_late_followup_preserves_gap_not_original_fixed_date(self) -> None:
        self.write_recipient(
            status="scheduled",
            current_step="0",
            gmail_thread_id="thread-1",
            last_rfc_message_id="<initial@example.com>",
        )
        now = datetime(2026, 8, 20, 9, tzinfo=UTC)
        gmail = Mock()
        gmail.thread_has_reply.return_value = False
        gmail.send_email.return_value = SentMessage(
            "message-2", "thread-1", "<followup@example.com>"
        )

        self.worker(gmail).run_once(now)

        recipient = self.store.recipients()[0]
        self.assertEqual(recipient["current_step"], "1")
        self.assertEqual(as_utc(recipient["next_send_at"]), now + timedelta(days=2))

    def test_reply_stops_followups_locally(self) -> None:
        self.write_recipient(
            status="scheduled",
            gmail_thread_id="thread-1",
            last_rfc_message_id="<initial@example.com>",
        )
        gmail = Mock()
        gmail.thread_has_reply.return_value = True

        result = self.worker(gmail).run_once(
            datetime(2026, 8, 5, 12, tzinfo=UTC)
        )

        self.assertEqual(result.replied, 1)
        self.assertEqual(self.store.recipients()[0]["status"], "replied")
        gmail.send_email.assert_not_called()

    def test_incremental_inbox_scan_marks_matching_sender(self) -> None:
        self.write_recipient(
            status="scheduled",
            last_sent_at="2026-08-05T10:00:00+00:00",
            next_send_at="2026-08-10T10:00:00+00:00",
            gmail_thread_id="thread-1",
        )
        gmail = Mock()
        gmail.find_reply_senders_since.return_value = {"lead@example.com"}
        now = datetime(2026, 8, 5, 12, tzinfo=UTC)

        matched = self.worker(gmail).poll_replies(now)

        self.assertEqual(matched, 1)
        self.assertEqual(self.store.recipients()[0]["status"], "replied")
        self.assertEqual(self.store.last_reply_scan_at(), now)
        gmail.thread_has_reply.assert_not_called()

    def test_saved_state_is_loaded_after_worker_recreation(self) -> None:
        self.write_recipient(status="completed", next_send_at="")

        replacement = CsvCampaignStore(Path(self.temporary.name), "campaign-1")

        self.assertEqual(replacement.recipients()[0]["status"], "completed")
        self.assertTrue(
            CsvCampaignWorker(settings(), Mock(), Mock(), replacement)
            .run_once(datetime(2026, 8, 5, tzinfo=UTC))
            .completed
        )

    def test_interrupted_accepted_send_is_recovered_without_resending(self) -> None:
        attempted_at = datetime(2026, 8, 5, 12, tzinfo=UTC)
        self.write_recipient(
            status="sending",
            current_step="0",
            attempt_step="1",
            attempt_rfc_message_id="<attempt@example.com>",
            gmail_thread_id="thread-1",
            last_rfc_message_id="<initial@example.com>",
            updated_at=attempted_at.isoformat(),
        )
        gmail = Mock()
        gmail.find_sent_message.return_value = SentMessage(
            "message-2", "thread-1", "<attempt@example.com>"
        )

        result = self.worker(gmail).run_once(attempted_at + timedelta(minutes=1))

        self.assertEqual(result.sent, 1)
        recipient = self.store.recipients()[0]
        self.assertEqual(recipient["current_step"], "1")
        self.assertEqual(
            as_utc(recipient["next_send_at"]), attempted_at + timedelta(days=2)
        )
        gmail.send_email.assert_not_called()


if __name__ == "__main__":
    unittest.main()
