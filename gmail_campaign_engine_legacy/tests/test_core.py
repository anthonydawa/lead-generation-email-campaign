"""Unit tests for logic that does not require live Gmail or Supabase access."""

from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import ANY, Mock, patch

from config import Settings
from gmail_service import GmailService, SentMessage
from reply_poller import _sender_from_headers, poll_replies
from sender_engine import CampaignEngine, render_template
from validator import is_disposable_domain, is_valid_syntax, validate_email


def make_settings() -> Settings:
    return Settings(
        SUPABASE_URL="https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY="test-key",
        GMAIL_CREDENTIALS_FILE=Path("credentials.json"),
        GMAIL_TOKEN_FILE=Path("token.json"),
        MIN_DELAY_SECONDS=0,
        MAX_DELAY_SECONDS=0,
        DAILY_SEND_LIMIT=10,
    )


class ValidatorTests(unittest.TestCase):
    def test_syntax(self) -> None:
        self.assertTrue(is_valid_syntax("person+tag@example.com"))
        self.assertFalse(is_valid_syntax("not-an-email"))
        self.assertFalse(is_valid_syntax("person@localhost"))
        self.assertFalse(is_valid_syntax("two..dots@example.com"))

    def test_disposable_domain(self) -> None:
        self.assertTrue(is_disposable_domain("MAILINATOR.COM"))
        self.assertTrue(is_disposable_domain("inbox.tempmail.example"))
        self.assertFalse(is_disposable_domain("example.com"))

    @patch("validator.has_mx_records", return_value=True)
    def test_valid_email(self, _: Mock) -> None:
        result = validate_email("Person@Example.com")
        self.assertEqual(result.status, "valid")

    def test_disposable_email_is_distinct(self) -> None:
        result = validate_email("person@mailinator.com")
        self.assertEqual(result.status, "disposable")


class ReplyPollerTests(unittest.TestCase):
    def test_sender_header_parser(self) -> None:
        sender = _sender_from_headers(
            [{"name": "From", "value": "Lead Name <Lead@Example.com>"}]
        )
        self.assertEqual(sender, "lead@example.com")

    def test_poll_requests_metadata_only(self) -> None:
        messages_api = Mock()
        messages_api.list.return_value.execute.return_value = {
            "messages": [{"id": "message-1"}]
        }
        messages_api.get.return_value.execute.return_value = {
            "payload": {
                "headers": [
                    {"name": "From", "value": "Known Lead <lead@example.com>"}
                ]
            }
        }
        gmail = Mock()
        gmail.service.users.return_value.messages.return_value = messages_api
        db = Mock()
        db.mark_lead_replied_by_email.return_value = True

        result = poll_replies(db, gmail)

        self.assertEqual(result, {"inspected": 1, "matched": 1})
        messages_api.get.assert_called_once_with(
            userId="me",
            id="message-1",
            format="metadata",
            metadataHeaders=["From"],
        )
        db.mark_lead_replied_by_email.assert_called_once_with("lead@example.com")


class SenderTests(unittest.TestCase):
    def test_template_rendering(self) -> None:
        rendered = render_template(
            "Hello {{ first_name }} at {{company}} / {{unknown}}",
            {"first_name": "Ada", "company": None},
        )
        self.assertEqual(rendered, "Hello Ada at  / ")

    @patch("sender_engine.time.sleep")
    def test_successful_campaign(self, sleep: Mock) -> None:
        db = Mock()
        db.get_campaign.return_value = {
            "id": "campaign-1",
            "status": "staged",
            "subject_template": "Hello {{first_name}}",
            "body_template": "<p>{{company}}</p>",
        }
        db.get_pending_leads_for_campaign.side_effect = [
            [
                {
                    "id": "lead-1",
                    "email": "lead@example.com",
                    "first_name": "Ada",
                    "company": "Analytical Engines",
                }
            ],
            [],
        ]
        db.get_sent_count_today.return_value = 0
        db.get_campaign_lead_status.return_value = "pending"
        db.get_campaign_steps.return_value = []
        db.campaign_has_open_work.return_value = False
        gmail = Mock()
        gmail.send_email.return_value = SentMessage(
            "message-1",
            "thread-1",
            "<rfc-message-1@example.com>",
        )

        result = CampaignEngine(make_settings(), db, gmail).run_campaign("campaign-1")

        self.assertEqual(result.sent, 1)
        gmail.send_email.assert_called_once_with(
            "lead@example.com",
            "Hello Ada",
            "<p>Analytical Engines</p>",
        )
        db.log_email_send.assert_called_once_with(
            "campaign-1",
            "lead-1",
            "thread-1",
            "message-1",
            "<rfc-message-1@example.com>",
        )
        db.mark_lead_sent.assert_called_once_with(
            "campaign-1",
            "lead-1",
            sent_at=ANY,
            thread_id="thread-1",
            gmail_message_id="message-1",
            rfc_message_id="<rfc-message-1@example.com>",
            next_send_at=None,
        )
        db.update_campaign_status.assert_any_call("campaign-1", "completed")
        sleep.assert_not_called()

    def test_due_followup_stops_when_thread_has_reply(self) -> None:
        db = Mock()
        db.get_sent_count_today.return_value = 0
        db.get_due_followups.return_value = [
            {
                "campaign_id": "campaign-1",
                "lead_id": "lead-1",
                "current_step": 0,
                "first_sent_at": "2026-07-01T00:00:00+00:00",
                "gmail_thread_id": "thread-1",
                "last_rfc_message_id": "<original@example.com>",
                "campaigns": {"subject_template": "Hello"},
                "leads": {"email": "lead@example.com"},
            }
        ]
        db.get_campaign_lead_status.return_value = "sent"
        db.get_campaign_steps.return_value = [
            {"step_number": 1, "delay_days": 3, "body_template": "Follow-up"}
        ]
        db.campaign_has_open_work.return_value = False
        gmail = Mock()
        gmail.thread_has_reply.return_value = True

        result = CampaignEngine(make_settings(), db, gmail).run_due_followups()

        self.assertEqual(result.skipped, 1)
        gmail.send_email.assert_not_called()
        db.mark_lead_replied_by_email.assert_called_once_with("lead@example.com")

    def test_rejects_draft_campaign(self) -> None:
        db = Mock()
        db.get_campaign.return_value = {"status": "draft"}
        with self.assertRaisesRegex(ValueError, "staged"):
            CampaignEngine(make_settings(), db, Mock()).run_campaign("campaign-1")

    def test_daily_limit_survives_restarts(self) -> None:
        db = Mock()
        db.get_campaign.return_value = {
            "status": "staged",
            "subject_template": "Subject",
            "body_template": "Body",
        }
        db.get_sent_count_today.return_value = 10
        gmail = Mock()

        result = CampaignEngine(make_settings(), db, gmail).run_campaign("campaign-1")

        self.assertEqual(result.sent, 0)
        db.get_pending_leads_for_campaign.assert_not_called()
        gmail.send_email.assert_not_called()

    @patch("sender_engine.time.sleep")
    def test_due_followup_uses_original_thread(self, sleep: Mock) -> None:
        db = Mock()
        db.get_sent_count_today.return_value = 0
        db.get_due_followups.return_value = [
            {
                "campaign_id": "campaign-1",
                "lead_id": "lead-1",
                "current_step": 0,
                "first_sent_at": "2026-07-01T00:00:00+00:00",
                "gmail_thread_id": "thread-1",
                "last_rfc_message_id": "<original@example.com>",
                "campaigns": {"subject_template": "Hello {{first_name}}"},
                "leads": {
                    "email": "lead@example.com",
                    "first_name": "Ada",
                    "company": "Analytical Engines",
                },
            }
        ]
        db.get_campaign_lead_status.return_value = "sent"
        db.get_campaign_steps.return_value = [
            {
                "step_number": 1,
                "delay_days": 3,
                "body_template": "<p>Following up, {{first_name}}</p>",
            }
        ]
        db.campaign_has_open_work.return_value = False
        gmail = Mock()
        gmail.thread_has_reply.return_value = False
        gmail.send_email.return_value = SentMessage(
            "message-2",
            "thread-1",
            "<followup@example.com>",
        )

        result = CampaignEngine(make_settings(), db, gmail).run_due_followups()

        self.assertEqual(result.sent, 1)
        gmail.send_email.assert_called_once_with(
            "lead@example.com",
            "Hello Ada",
            "<p>Following up, Ada</p>",
            thread_id="thread-1",
            in_reply_to="<original@example.com>",
        )
        db.advance_followup.assert_called_once_with(
            "campaign-1",
            "lead-1",
            step_number=1,
            gmail_message_id="message-2",
            rfc_message_id="<followup@example.com>",
            next_send_at=None,
        )
        db.update_campaign_status.assert_called_once_with(
            "campaign-1",
            "completed",
        )
        sleep.assert_not_called()


class GmailServiceTests(unittest.TestCase):
    def test_followup_supplies_thread_and_reply_headers(self) -> None:
        messages_api = Mock()
        messages_api.send.return_value.execute.return_value = {
            "id": "message-2",
            "threadId": "thread-1",
        }
        messages_api.get.return_value.execute.return_value = {
            "payload": {
                "headers": [
                    {"name": "Message-ID", "value": "<stored@example.com>"}
                ]
            }
        }
        service = Mock()
        service.users.return_value.messages.return_value = messages_api
        gmail = GmailService(make_settings(), service=service)

        sent = gmail.send_email(
            "lead@example.com",
            "Original subject",
            "<p>Follow-up</p>",
            thread_id="thread-1",
            in_reply_to="<original@example.com>",
        )

        self.assertEqual(sent.rfc_message_id, "<stored@example.com>")
        body = messages_api.send.call_args.kwargs["body"]
        self.assertEqual(body["threadId"], "thread-1")
        import base64
        from email import message_from_bytes

        decoded = message_from_bytes(base64.urlsafe_b64decode(body["raw"]))
        self.assertEqual(decoded["Subject"], "Original subject")
        self.assertEqual(decoded["In-Reply-To"], "<original@example.com>")
        self.assertEqual(decoded["References"], "<original@example.com>")

    def test_thread_reply_check_reads_headers_only(self) -> None:
        threads_api = Mock()
        threads_api.get.return_value.execute.return_value = {
            "messages": [
                {
                    "payload": {
                        "headers": [
                            {
                                "name": "From",
                                "value": "Lead <lead@example.com>",
                            }
                        ]
                    }
                }
            ]
        }
        service = Mock()
        service.users.return_value.threads.return_value = threads_api
        gmail = GmailService(make_settings(), service=service)

        self.assertTrue(gmail.thread_has_reply("thread-1", "lead@example.com"))
        threads_api.get.assert_called_once_with(
            userId="me",
            id="thread-1",
            format="metadata",
            metadataHeaders=["From"],
        )


class SettingsTests(unittest.TestCase):
    def test_invalid_delay_range(self) -> None:
        with self.assertRaisesRegex(ValueError, "MIN_DELAY_SECONDS"):
            Settings(
                SUPABASE_URL="https://example.supabase.co",
                SUPABASE_SERVICE_ROLE_KEY="test-key",
                MIN_DELAY_SECONDS=2,
                MAX_DELAY_SECONDS=1,
            )


if __name__ == "__main__":
    unittest.main()
