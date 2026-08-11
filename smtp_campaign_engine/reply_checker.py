"""Read-only IMAP reply checks for scheduled campaign follow-ups."""

from __future__ import annotations

import imaplib
import re
import ssl
import time
from email import message_from_bytes
from email.policy import default
from email.utils import parseaddr

from config import Settings


class ReplyChecker:
    """Read message headers without changing flags or mailbox contents."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._last_uid = 0
        self._last_refresh = 0.0
        self._replies_by_parent: dict[str, set[str]] = {}

    def test_connection(self) -> None:
        with self._client() as client:
            status, _ = client.select(self.settings.imap_inbox_folder, readonly=True)
            if status != "OK":
                raise RuntimeError("IMAP could not open the configured inbox read-only")

    def has_reply(
        self,
        recipient_email: str,
        *,
        root_message_id: str,
        last_message_id: str,
    ) -> bool:
        expected = recipient_email.strip().lower()
        message_ids = list(
            dict.fromkeys(
                value.strip()
                for value in (root_message_id, last_message_id)
                if value and value.strip()
            )
        )
        if not message_ids:
            return False

        self._refresh_reply_index()
        return any(
            expected in self._replies_by_parent.get(self._normalize_id(message_id), set())
            for message_id in message_ids
        )

    def _refresh_reply_index(self) -> None:
        # Reuse one inbox scan for recipients checked close together. Lark's
        # server does not reliably implement HEADER/FROM searches, so headers
        # are fetched with BODY.PEEK and matched locally without changing flags.
        now = time.monotonic()
        if now - self._last_refresh < 15:
            return
        with self._client() as client:
            status, _ = client.select(self.settings.imap_inbox_folder, readonly=True)
            if status != "OK":
                raise RuntimeError("IMAP could not open the configured inbox read-only")
            uids = self._search(client, "ALL")
            new_uids = [uid for uid in uids if int(uid) > self._last_uid]
            for offset in range(0, len(new_uids), 200):
                batch = new_uids[offset : offset + 200]
                status, data = client.uid(
                    "fetch",
                    b",".join(batch),
                    "(BODY.PEEK[HEADER.FIELDS (FROM IN-REPLY-TO REFERENCES)])",
                )
                if status != "OK":
                    raise RuntimeError("IMAP could not fetch reply headers")
                for item in data or []:
                    if not isinstance(item, tuple) or not item[1]:
                        continue
                    message = message_from_bytes(item[1], policy=default)
                    sender = parseaddr(str(message.get("From", "")))[1].lower()
                    if not sender:
                        continue
                    parent_ids = self._message_ids(str(message.get("In-Reply-To", "")))
                    parent_ids.update(
                        self._message_ids(str(message.get("References", "")))
                    )
                    for parent_id in parent_ids:
                        self._replies_by_parent.setdefault(parent_id, set()).add(sender)
            if uids:
                self._last_uid = max(int(uid) for uid in uids)
        self._last_refresh = now

    def _client(self) -> imaplib.IMAP4_SSL:
        client = imaplib.IMAP4_SSL(
            self.settings.imap_host,
            self.settings.imap_port,
            ssl_context=ssl.create_default_context(),
            timeout=30,
        )
        client.login(
            self.settings.effective_imap_username,
            self.settings.effective_imap_password,
        )
        return client

    @staticmethod
    def _search(client: imaplib.IMAP4_SSL, *criteria: str) -> list[bytes]:
        status, data = client.uid("search", None, *criteria)
        if status != "OK" or not data:
            return []
        return [uid for uid in data[0].split() if uid]

    @staticmethod
    def _normalize_id(value: str) -> str:
        return value.strip().lower()

    @classmethod
    def _message_ids(cls, value: str) -> set[str]:
        return {cls._normalize_id(match) for match in re.findall(r"<[^>]+>", value)}
