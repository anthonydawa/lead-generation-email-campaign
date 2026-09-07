from unittest.mock import MagicMock, patch

from config import Settings
from reply_checker import ReplyChecker


def settings() -> Settings:
    return Settings(
        SUPABASE_URL="https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY="test-key",
        SMTP_HOST="smtp.example.com",
        SMTP_USERNAME="sender@example.com",
        SMTP_PASSWORD="secret",
        SENDER_EMAIL="sender@example.com",
        CHECK_REPLIES_BEFORE_SEND=True,
        IMAP_HOST="imap.example.com",
    )


def test_reply_check_uses_read_only_selection_and_peek_headers() -> None:
    client = MagicMock()
    client.__enter__.return_value = client
    client.select.return_value = ("OK", [b"1"])
    client.uid.side_effect = [
        ("OK", [b"42"]),
        (
            "OK",
            [
                (
                    b"header",
                    b"From: Lead <lead@example.com>\r\n"
                    b"In-Reply-To: <last@example.com>\r\n"
                    b"References: <root@example.com> <last@example.com>\r\n\r\n",
                )
            ],
        ),
    ]

    with patch.object(ReplyChecker, "_client", return_value=client):
        found = ReplyChecker(settings()).has_reply(
            "lead@example.com",
            root_message_id="<root@example.com>",
            last_message_id="<last@example.com>",
        )

    assert found is True
    client.select.assert_called_once_with("INBOX", readonly=True)
    fetch_call = client.uid.call_args_list[1]
    assert fetch_call.args == (
        "fetch",
        b"42",
        "(BODY.PEEK[HEADER.FIELDS (FROM IN-REPLY-TO REFERENCES)])",
    )


def test_hard_bounce_parser_requires_mail_daemon_and_permanent_signal() -> None:
    checker = ReplyChecker(settings())

    assert checker._is_hard_bounce("Address not found: bad@example.com")
    assert checker._email_addresses("bad@example.com.") == {"bad@example.com"}
    assert not checker._is_hard_bounce("Temporary failure; please retry later")
