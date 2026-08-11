"""Verify outbound SMTP credentials without sending an email."""

from config import get_settings
from mail_service import MailService


if __name__ == "__main__":
    MailService(get_settings()).test_connection()
    print("SMTP authentication succeeded. No email was sent.")
