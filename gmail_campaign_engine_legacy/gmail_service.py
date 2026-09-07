"""Gmail OAuth authentication and message delivery."""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass
from email.mime.text import MIMEText
from email.utils import make_msgid, parseaddr
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import Resource, build
from googleapiclient.errors import HttpError

from config import Settings

GMAIL_SCOPES = (
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
)


@dataclass(frozen=True)
class SentMessage:
    message_id: str
    thread_id: str
    rfc_message_id: str


class GmailService:
    def __init__(
        self,
        settings: Settings,
        service: Resource | None = None,
    ) -> None:
        self.settings = settings
        self._service = service

    @property
    def service(self) -> Resource:
        if self._service is None:
            self._service = build(
                "gmail",
                "v1",
                credentials=self._authenticate(),
                cache_discovery=False,
            )
        return self._service

    def _authenticate(self) -> Credentials:
        token_path = self.settings.gmail_token_file
        credentials: Credentials | None = None

        if token_path.exists():
            credentials = Credentials.from_authorized_user_file(
                str(token_path),
                list(GMAIL_SCOPES),
            )

        if credentials and credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
        elif not credentials or not credentials.valid:
            credentials_file = self.settings.gmail_credentials_file
            if not credentials_file.exists():
                raise FileNotFoundError(
                    f"Gmail credentials file not found: {credentials_file}"
                )
            flow = InstalledAppFlow.from_client_secrets_file(
                str(credentials_file),
                list(GMAIL_SCOPES),
            )
            credentials = flow.run_local_server(port=0)

        self._save_token(token_path, credentials)
        return credentials

    @staticmethod
    def _save_token(path: Path, credentials: Credentials) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(credentials.to_json(), encoding="utf-8")

    def authenticate(self) -> Path:
        """Complete OAuth without reading messages or sending email."""

        _ = self.service
        return self.settings.gmail_token_file

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
        message = MIMEText(body_html, "html", "utf-8")
        message["To"] = to_email
        message["Subject"] = subject
        generated_message_id = rfc_message_id or make_msgid()
        message["Message-ID"] = generated_message_id
        if in_reply_to:
            message["In-Reply-To"] = in_reply_to
            message["References"] = in_reply_to
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
        request_body: dict[str, str] = {"raw": raw}
        if thread_id:
            if not in_reply_to:
                raise ValueError("in_reply_to is required when thread_id is supplied")
            request_body["threadId"] = thread_id

        try:
            response: dict[str, Any] = (
                self.service.users()
                .messages()
                .send(userId="me", body=request_body)
                .execute()
            )
        except HttpError as exc:
            raise RuntimeError(f"Gmail send failed for {to_email}: {exc}") from exc

        message_id = response.get("id")
        thread_id = response.get("threadId")
        if not message_id or not thread_id:
            raise RuntimeError("Gmail returned an incomplete send response")
        rfc_message_id = self._get_rfc_message_id(str(message_id))
        return SentMessage(
            str(message_id),
            str(thread_id),
            rfc_message_id or generated_message_id,
        )

    def find_sent_message(self, rfc_message_id: str) -> SentMessage | None:
        """Recover a send interrupted after Gmail accepted a known Message-ID."""

        normalized = rfc_message_id.strip().strip("<>")
        response: dict[str, Any] = (
            self.service.users()
            .messages()
            .list(
                userId="me",
                q=f"in:sent rfc822msgid:{normalized}",
                maxResults=1,
            )
            .execute()
        )
        matches = response.get("messages", [])
        if not matches:
            return None
        gmail_message_id = str(matches[0]["id"])
        metadata: dict[str, Any] = (
            self.service.users()
            .messages()
            .get(
                userId="me",
                id=gmail_message_id,
                format="metadata",
                metadataHeaders=["Message-ID"],
            )
            .execute()
        )
        thread_id = str(metadata.get("threadId") or matches[0].get("threadId") or "")
        if not thread_id:
            return None
        stored_rfc_id = rfc_message_id
        for header in metadata.get("payload", {}).get("headers", []):
            if header.get("name", "").lower() == "message-id":
                stored_rfc_id = str(header.get("value") or rfc_message_id)
                break
        return SentMessage(gmail_message_id, thread_id, stored_rfc_id)

    def find_reply_senders_since(self, since: Any, max_results: int = 500) -> set[str]:
        """Return inbox sender addresses since a UTC time using metadata only."""

        query = f"in:inbox after:{int(since.timestamp())}"
        response: dict[str, Any] = (
            self.service.users()
            .messages()
            .list(userId="me", q=query, maxResults=max_results)
            .execute()
        )
        senders: set[str] = set()
        for item in response.get("messages", []):
            metadata: dict[str, Any] = (
                self.service.users()
                .messages()
                .get(
                    userId="me",
                    id=item["id"],
                    format="metadata",
                    metadataHeaders=["From"],
                )
                .execute()
            )
            for header in metadata.get("payload", {}).get("headers", []):
                if header.get("name", "").lower() == "from":
                    address = parseaddr(str(header.get("value", "")))[1].lower()
                    if address:
                        senders.add(address)
                    break
        return senders

    def find_hard_bounce_recipients_since(
        self, since: Any, max_results: int = 500
    ) -> set[str]:
        """Return addresses from Gmail delivery failures that state a permanent error.

        A delivery notification is not enough on its own: the notice must include a
        failed address and language such as "address not found" or an SMTP 5xx code.
        This prevents a temporary deferral from being treated as a hard bounce.
        """

        query = (
            f"in:inbox after:{int(since.timestamp())} "
            "from:(mailer-daemon@googlemail.com OR mailer-daemon@gmail.com)"
        )
        response: dict[str, Any] = (
            self.service.users()
            .messages()
            .list(userId="me", q=query, maxResults=max_results)
            .execute()
        )
        recipients: set[str] = set()
        for item in response.get("messages", []):
            message: dict[str, Any] = (
                self.service.users()
                .messages()
                .get(userId="me", id=item["id"], format="full")
                .execute()
            )
            payload = message.get("payload", {})
            headers = payload.get("headers", [])
            subject = " ".join(
                str(header.get("value") or "")
                for header in headers
                if header.get("name", "").lower() == "subject"
            )
            failed_headers = " ".join(
                str(header.get("value") or "")
                for header in headers
                if header.get("name", "").lower() == "x-failed-recipients"
            )
            text = "\n".join(
                [subject, failed_headers, *self._payload_text(payload)]
            )
            if not self._is_hard_bounce(text):
                continue
            recipients.update(self._email_addresses(failed_headers or text))
        return recipients

    @staticmethod
    def _payload_text(payload: dict[str, Any]) -> list[str]:
        texts: list[str] = []
        body = payload.get("body") or {}
        data = body.get("data")
        if data:
            try:
                padded = str(data) + "=" * (-len(str(data)) % 4)
                texts.append(base64.urlsafe_b64decode(padded).decode("utf-8", "replace"))
            except (ValueError, UnicodeDecodeError):
                pass
        for part in payload.get("parts") or []:
            texts.extend(GmailService._payload_text(part))
        return texts

    @staticmethod
    def _is_hard_bounce(text: str) -> bool:
        normalized = text.lower()
        return bool(
            re.search(r"\b5[0-9][0-9]\b", normalized)
            or any(
                phrase in normalized
                for phrase in (
                    "address not found",
                    "email account that you tried to reach does not exist",
                    "user unknown",
                    "no such user",
                    "recipient address rejected",
                )
            )
        )

    @staticmethod
    def _email_addresses(value: str) -> set[str]:
        return {
            address.lower()
            for address in re.findall(
                r"(?<![\w.+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
                value,
                flags=re.IGNORECASE,
            )
        }

    def _get_rfc_message_id(self, gmail_message_id: str) -> str | None:
        """Read only the Message-ID header Gmail stored for a sent message."""

        try:
            metadata: dict[str, Any] = (
                self.service.users()
                .messages()
                .get(
                    userId="me",
                    id=gmail_message_id,
                    format="metadata",
                    metadataHeaders=["Message-ID"],
                )
                .execute()
            )
        except HttpError:
            return None
        for header in metadata.get("payload", {}).get("headers", []):
            if header.get("name", "").lower() == "message-id":
                value = str(header.get("value", "")).strip()
                return value or None
        return None

    def thread_has_reply(self, thread_id: str, lead_email: str) -> bool:
        """Check From headers in one thread without retrieving message bodies."""

        try:
            thread: dict[str, Any] = (
                self.service.users()
                .threads()
                .get(
                    userId="me",
                    id=thread_id,
                    format="metadata",
                    metadataHeaders=["From"],
                )
                .execute()
            )
        except HttpError as exc:
            raise RuntimeError(
                f"Gmail thread check failed for {thread_id}: {exc}"
            ) from exc

        expected = lead_email.strip().lower()
        for item in thread.get("messages", []):
            for header in item.get("payload", {}).get("headers", []):
                if header.get("name", "").lower() != "from":
                    continue
                sender = parseaddr(str(header.get("value", "")))[1].lower()
                if sender == expected:
                    return True
        return False
