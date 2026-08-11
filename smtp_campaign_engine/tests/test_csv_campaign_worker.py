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
from mail_service import PermanentRecipientError, SentMessage


UTC = timezone.utc


def settings() -> Settings:
    return Settings(
        SUPABASE_URL="https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY="test-key",
        MIN_DELAY_SECONDS=0,
        MAX_DELAY_SECONDS=0,
        DAILY_SEND_LIMIT=10,
        SMTP_HOST="smtp.example.com",
        SMTP_USERNAME="sender@example.com",
        SMTP_PASSWORD="secret",
        SENDER_EMAIL="sender@example.com",
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
        mail = Mock()
        remote = Mock()
        remote.get_campaign_lead_status.return_value = "skipped"

        result = CsvCampaignWorker(settings(), remote, mail, self.store).run_once(
            datetime(2026, 8, 5, 12, tzinfo=UTC)
        )

        self.assertEqual(result.sent, 0)
        self.assertEqual(self.store.recipients()[0]["status"], "skipped")
        mail.send_email.assert_not_called()

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
        gmail.send_email.return_value = SentMessage(
            "message-2", "thread-1", "<followup@example.com>"
        )

        self.worker(gmail).run_once(now)

        recipient = self.store.recipients()[0]
        self.assertEqual(recipient["current_step"], "1")
        self.assertEqual(as_utc(recipient["next_send_at"]), now + timedelta(days=2))

    def test_reply_stops_only_the_current_campaign_assignment(self) -> None:
        self.write_recipient(
            status="scheduled",
            current_step="0",
            gmail_thread_id="<root@example.com>",
            last_rfc_message_id="<initial@example.com>",
        )
        mail = Mock()
        remote = Mock()
        remote.get_campaign_lead_status.return_value = "sent"
        checker = Mock()
        checker.has_reply.return_value = True

        result = CsvCampaignWorker(
            settings(), remote, mail, self.store, reply_checker=checker
        ).run_once(datetime(2026, 8, 20, 9, tzinfo=UTC))

        self.assertEqual(result.sent, 0)
        self.assertEqual(self.store.recipients()[0]["status"], "replied")
        remote.mark_campaign_recipient_replied.assert_called_once_with(
            "campaign-1", "lead-1"
        )
        remote.mark_lead_replied_by_email.assert_not_called()
        remote.mark_lead_stopped_by_email.assert_not_called()
        mail.send_email.assert_not_called()

    def test_failed_reply_check_blocks_the_followup(self) -> None:
        self.write_recipient(
            status="scheduled",
            current_step="0",
            gmail_thread_id="<root@example.com>",
            last_rfc_message_id="<initial@example.com>",
        )
        mail = Mock()
        checker = Mock()
        checker.has_reply.side_effect = RuntimeError("mailbox unavailable")

        remote = Mock()
        remote.get_campaign_lead_status.return_value = "sent"
        result = CsvCampaignWorker(
            settings(), remote, mail, self.store, reply_checker=checker
        ).run_once(datetime(2026, 8, 20, 9, tzinfo=UTC))

        self.assertEqual(result.sent, 0)
        self.assertEqual(self.store.recipients()[0]["status"], "scheduled")
        self.assertIn("reply check failed", self.store.recipients()[0]["last_error"])
        mail.send_email.assert_not_called()

    def test_saved_state_is_loaded_after_worker_recreation(self) -> None:
        self.write_recipient(status="completed", next_send_at="")

        replacement = CsvCampaignStore(Path(self.temporary.name), "campaign-1")

        self.assertEqual(replacement.recipients()[0]["status"], "completed")
        self.assertTrue(
            CsvCampaignWorker(settings(), Mock(), Mock(), replacement)
            .run_once(datetime(2026, 8, 5, tzinfo=UTC))
            .completed
        )

    def test_interrupted_send_is_not_retried_without_inbox_access(self) -> None:
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
        result = self.worker(gmail).run_once(attempted_at + timedelta(minutes=11))

        self.assertEqual(result.sent, 0)
        self.assertTrue(result.completed)
        recipient = self.store.recipients()[0]
        self.assertEqual(recipient["status"], "uncertain")
        gmail.send_email.assert_not_called()
        self.assertFalse(hasattr(gmail, "find_sent_message") and gmail.find_sent_message.called)

    def test_queued_manual_removal_prevents_delivery(self) -> None:
        self.write_recipient()
        mail = Mock()
        remote = Mock()
        self.store.queue_skip("lead@example.com", "Requested by campaign owner")

        result = CsvCampaignWorker(settings(), remote, mail, self.store).run_once(
            datetime(2026, 8, 5, 12, tzinfo=UTC)
        )

        self.assertEqual(result.sent, 0)
        self.assertTrue(result.completed)
        self.assertEqual(self.store.recipients()[0]["status"], "skipped")
        remote.mark_campaign_recipient_skipped.assert_called_once()
        mail.send_email.assert_not_called()

    def test_permanent_recipient_rejection_becomes_terminal_bounce(self) -> None:
        self.write_recipient()
        mail = Mock()
        mail.send_email.side_effect = PermanentRecipientError("SMTP 550: no such user")
        remote = Mock()
        remote.get_campaign_lead_status.return_value = "pending"

        result = CsvCampaignWorker(settings(), remote, mail, self.store).run_once(
            datetime(2026, 8, 5, 12, tzinfo=UTC)
        )

        self.assertEqual(result.sent, 0)
        self.assertEqual(self.store.recipients()[0]["status"], "bounced")
        remote.mark_lead_stopped_by_email.assert_called_once_with(
            "lead@example.com", "bounced"
        )


if __name__ == "__main__":
    unittest.main()
