"""Privacy-preserving polling of unread Gmail replies."""

from __future__ import annotations

from email.utils import parseaddr
from typing import Any

from db_client import DatabaseClient
from gmail_service import GmailService


def _sender_from_headers(headers: list[dict[str, str]]) -> str | None:
    for header in headers:
        if header.get("name", "").lower() == "from":
            address = parseaddr(header.get("value", ""))[1].strip().lower()
            return address or None
    return None


def poll_replies(
    db: DatabaseClient,
    gmail: GmailService,
    max_results: int = 100,
) -> dict[str, int]:
    """Match unread inbox senders without fetching message bodies or subjects."""

    response: dict[str, Any] = (
        gmail.service.users()
        .messages()
        .list(userId="me", q="is:unread label:INBOX", maxResults=max_results)
        .execute()
    )
    messages = response.get("messages", [])
    matched = 0
    inspected = 0

    for item in messages:
        metadata: dict[str, Any] = (
            gmail.service.users()
            .messages()
            .get(
                userId="me",
                id=item["id"],
                format="metadata",
                metadataHeaders=["From"],
            )
            .execute()
        )
        inspected += 1
        headers = metadata.get("payload", {}).get("headers", [])
        sender = _sender_from_headers(headers)
        if sender and db.mark_lead_replied_by_email(sender):
            matched += 1

    return {"inspected": inspected, "matched": matched}
