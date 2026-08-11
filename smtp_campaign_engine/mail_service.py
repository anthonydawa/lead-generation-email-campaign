"""Direct authenticated SMTP delivery with no inbox access."""

from __future__ import annotations

import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from email.headerregistry import Address
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from html import unescape
from re import sub

from config import Settings


class PermanentRecipientError(RuntimeError):
    """The SMTP server permanently rejected the recipient address."""


@dataclass(frozen=True)
class SentMessage:
    message_id: str
    thread_id: str
    rfc_message_id: str


class MailService:
    """Submit messages over SMTP; never connect to an inbox or Sent folder."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def test_connection(self) -> None:
        """Authenticate to SMTP without sending a message."""

        with self._smtp():
            pass

    def send_email(
        self,
        to_email: str,
        subject: str,
        body_html: str,
        *,
        thread_id: str | None = None,
        in_reply_to: str | None = None,
        rfc_message_id: str | None = None,
    ) -> SentMessage:
        message_id = rfc_message_id or make_msgid()
        root_thread_id = thread_id or message_id
        message = EmailMessage()
        message["From"] = Address(
            display_name=self.settings.sender_name,
            addr_spec=self.settings.sender_email,
        )
        message["To"] = to_email
        message["Subject"] = subject
        message["Date"] = format_datetime(datetime.now(timezone.utc))
        message["Message-ID"] = message_id
        if in_reply_to:
            message["In-Reply-To"] = in_reply_to
            references = list(dict.fromkeys([root_thread_id, in_reply_to]))
            message["References"] = " ".join(references)
        message.set_content(_html_to_text(body_html))
        message.add_alternative(body_html, subtype="html")

        try:
            with self._smtp() as client:
                refused = client.send_message(
                    message,
                    from_addr=self.settings.sender_email,
                    to_addrs=[to_email],
                )
        except smtplib.SMTPRecipientsRefused as exc:
            code, response = exc.recipients.get(to_email, (0, b"Recipient refused"))
            self._raise_recipient_error(code, response)
        if refused:
            code, response = refused.get(to_email, next(iter(refused.values())))
            self._raise_recipient_error(code, response)

        # SMTP acceptance is the only delivery claim made by this worker.
        return SentMessage(message_id, root_thread_id, message_id)

    def _smtp(self):
        context = ssl.create_default_context()
        if self.settings.smtp_security == "ssl":
            client = smtplib.SMTP_SSL(
                self.settings.smtp_host,
                self.settings.smtp_port,
                timeout=30,
                context=context,
            )
        else:
            client = smtplib.SMTP(
                self.settings.smtp_host, self.settings.smtp_port, timeout=30
            )
            client.ehlo()
            client.starttls(context=context)
            client.ehlo()
        client.login(self.settings.smtp_username, self.settings.smtp_password)
        return client

    @staticmethod
    def _raise_recipient_error(code: int, response: bytes | str) -> None:
        detail = (
            response.decode(errors="replace")
            if isinstance(response, bytes)
            else str(response)
        )
        if 500 <= int(code) < 600:
            raise PermanentRecipientError(f"SMTP {code}: {detail}")
        raise RuntimeError(f"Temporary SMTP recipient failure {code}: {detail}")


def _html_to_text(value: str) -> str:
    text = sub(r"(?i)<br\s*/?>", "\n", value)
    text = sub(r"(?i)</p\s*>", "\n\n", text)
    return unescape(sub(r"<[^>]+>", "", text)).strip()
