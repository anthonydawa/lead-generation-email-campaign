"""Verify optional read-only inbox access without changing any messages."""

from config import get_settings
from reply_checker import ReplyChecker


if __name__ == "__main__":
    settings = get_settings()
    if not settings.check_replies_before_send:
        raise SystemExit("Set CHECK_REPLIES_BEFORE_SEND=true before running this test.")
    ReplyChecker(settings).test_connection()
    print("Read-only IMAP inbox access succeeded. No message was changed.")
