from email import message_from_bytes
from unittest.mock import MagicMock, patch

from config import Settings
from mail_service import MailService


def settings() -> Settings:
    return Settings(
        SUPABASE_URL="https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY="test-key",
        SMTP_HOST="smtp.example.com",
        SMTP_USERNAME="sender@example.com",
        SMTP_PASSWORD="secret",
        SENDER_EMAIL="sender@example.com",
        SENDER_NAME="Campaign Team",
    )


def test_followup_uses_rfc_thread_headers() -> None:
    smtp = MagicMock()
    smtp.__enter__.return_value = smtp
    smtp.send_message.return_value = {}
    with patch.object(MailService, "_smtp", return_value=smtp):
        result = MailService(settings()).send_email(
            "lead@example.com",
            "Hello",
            "<p>Following up</p>",
            thread_id="<initial@example.com>",
            in_reply_to="<initial@example.com>",
            rfc_message_id="<followup@example.com>",
        )

    message = smtp.send_message.call_args.args[0]
    assert message["Message-ID"] == "<followup@example.com>"
    assert message["In-Reply-To"] == "<initial@example.com>"
    assert message["References"] == "<initial@example.com>"
    assert result.thread_id == "<initial@example.com>"


def test_email_has_plain_and_html_alternatives() -> None:
    smtp = MagicMock()
    smtp.__enter__.return_value = smtp
    smtp.send_message.return_value = {}
    with patch.object(MailService, "_smtp", return_value=smtp):
        MailService(settings()).send_email(
            "lead@example.com", "Hello", "<p>Hello <strong>Ada</strong></p>"
        )
    message = smtp.send_message.call_args.args[0]
    assert message.is_multipart()
    assert "Hello Ada" in message.get_body(preferencelist=("plain",)).get_content()
