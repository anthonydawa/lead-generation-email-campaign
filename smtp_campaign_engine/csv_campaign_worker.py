"""Restart-safe direct-mail campaign worker with local CSV state."""

from __future__ import annotations

import csv
import json
import logging
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import make_msgid
from pathlib import Path
from typing import Any
from uuid import uuid4

from config import Settings
from db_client import DatabaseClient
from mail_service import MailService, PermanentRecipientError, SentMessage
from reply_checker import ReplyChecker
from send_gate import SendGate
from templating import render_template


LOGGER = logging.getLogger(__name__)
UTC = timezone.utc
TERMINAL_STATUSES = {
    "completed", "replied", "bounced", "unsubscribed", "skipped", "uncertain"
}
ACTIVE_STATUSES = {"pending", "scheduled", "sending"}

CAMPAIGN_FIELDS = [
    "campaign_id",
    "title",
    "subject_template",
    "body_template",
    "initial_send_at",
    "timezone",
    "sender_email",
    "created_at",
]
STEP_FIELDS = ["step_number", "delay_days", "body_template"]
RECIPIENT_FIELDS = [
    "campaign_id",
    "lead_id",
    "email",
    "first_name",
    "last_name",
    "company",
    "status",
    "current_step",
    "next_send_at",
    "last_sent_at",
    "gmail_thread_id",
    "last_gmail_message_id",
    "last_rfc_message_id",
    "attempt_step",
    "attempt_rfc_message_id",
    "retry_at",
    "last_error",
    "updated_at",
]
EVENT_FIELDS = ["timestamp", "event", "lead_id", "email", "step", "details"]


def utc_now() -> datetime:
    return datetime.now(UTC)


def as_utc(value: Any) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def iso(value: datetime | None) -> str:
    return value.astimezone(UTC).isoformat() if value else ""


def _clean_row(row: dict[str, Any], fields: list[str]) -> dict[str, str]:
    return {field: str(row.get(field) or "") for field in fields}


def _atomic_write(path: Path, fields: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(_clean_row(row, fields) for row in rows)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def _read_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [dict(row) for row in csv.DictReader(handle)]


@dataclass(frozen=True)
class CycleResult:
    sent: int = 0
    completed: bool = False
    next_due_at: datetime | None = None


class CsvCampaignStore:
    """CSV files that are authoritative for one campaign after bootstrap."""

    def __init__(self, root: Path, campaign_id: str) -> None:
        self.directory = root / campaign_id
        self.campaign_path = self.directory / "campaign.csv"
        self.steps_path = self.directory / "steps.csv"
        self.recipients_path = self.directory / "recipients.csv"
        self.events_path = self.directory / "events.csv"
        self.commands_path = self.directory / "commands"
        self.processed_commands_path = self.directory / "processed_commands"

    @property
    def exists(self) -> bool:
        return all(
            path.exists()
            for path in (self.campaign_path, self.steps_path, self.recipients_path)
        )

    def bootstrap(self, remote: DatabaseClient, campaign_id: str) -> None:
        if self.exists:
            return

        campaign = remote.get_campaign(campaign_id)
        if campaign is None:
            raise ValueError(f"Campaign not found: {campaign_id}")
        steps = remote.get_campaign_steps(campaign_id)
        assignments = remote.get_campaign_assignments(campaign_id)
        latest_logs = {
            (str(row.get("lead_id")), int(row.get("step_number") or 0)): row
            for row in remote.get_campaign_delivery_logs(campaign_id)
        }
        if not assignments:
            raise ValueError("The selected campaign has no assigned recipients")

        now = utc_now()
        recipient_rows: list[dict[str, Any]] = []
        for assignment in assignments:
            lead = dict(assignment.get("leads") or {})
            remote_status = str(assignment.get("status") or "pending")
            current_step = int(assignment.get("current_step") or 0)
            last_log = latest_logs.get((str(assignment.get("lead_id")), current_step), {})
            last_sent_at = (
                last_log.get("sent_at")
                or assignment.get("first_sent_at")
                or ""
            )
            has_next_step = any(
                int(step.get("step_number") or 0) > current_step for step in steps
            )
            if remote_status in {"replied", "bounced", "unsubscribed", "skipped"}:
                local_status = remote_status
            elif remote_status == "sent":
                local_status = "scheduled" if has_next_step else "completed"
            else:
                local_status = "pending"

            next_send_at = assignment.get("next_send_at") or ""
            if local_status == "pending":
                next_send_at = campaign.get("initial_send_at") or iso(now)
            elif local_status in TERMINAL_STATUSES:
                next_send_at = ""

            recipient_rows.append(
                {
                    "campaign_id": campaign_id,
                    "lead_id": assignment.get("lead_id") or lead.get("id"),
                    "email": lead.get("email"),
                    "first_name": lead.get("first_name"),
                    "last_name": lead.get("last_name"),
                    "company": lead.get("company"),
                    "status": local_status,
                    "current_step": current_step,
                    "next_send_at": next_send_at,
                    "last_sent_at": last_sent_at,
                    "gmail_thread_id": assignment.get("gmail_thread_id"),
                    "last_gmail_message_id": assignment.get("last_gmail_message_id"),
                    "last_rfc_message_id": assignment.get("last_rfc_message_id"),
                    "updated_at": iso(now),
                }
            )

        _atomic_write(self.campaign_path, CAMPAIGN_FIELDS, [campaign])
        _atomic_write(self.steps_path, STEP_FIELDS, steps)
        _atomic_write(self.recipients_path, RECIPIENT_FIELDS, recipient_rows)
        self.event("state_created", details=f"Imported {len(recipient_rows)} recipients")

    def campaign(self) -> dict[str, str]:
        rows = _read_rows(self.campaign_path)
        if len(rows) != 1:
            raise ValueError("campaign.csv must contain exactly one campaign row")
        return rows[0]

    def steps(self) -> list[dict[str, str]]:
        return sorted(
            _read_rows(self.steps_path), key=lambda row: int(row["step_number"])
        )

    def recipients(self) -> list[dict[str, str]]:
        rows = _read_rows(self.recipients_path)
        for row in rows:
            status = row.get("status", "").strip().lower()
            if status not in ACTIVE_STATUSES | TERMINAL_STATUSES:
                raise ValueError(
                    f"Unsupported CSV status {status!r} for {row.get('email')}"
                )
            row["status"] = status
        return rows

    def save_recipients(self, rows: list[dict[str, Any]]) -> None:
        _atomic_write(self.recipients_path, RECIPIENT_FIELDS, rows)

    def event(
        self,
        event: str,
        *,
        recipient: dict[str, Any] | None = None,
        step: int | str = "",
        details: str = "",
        at: datetime | None = None,
    ) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        needs_header = not self.events_path.exists() or self.events_path.stat().st_size == 0
        with self.events_path.open("a", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=EVENT_FIELDS)
            if needs_header:
                writer.writeheader()
            writer.writerow(
                {
                    "timestamp": iso(at or utc_now()),
                    "event": event,
                    "lead_id": (recipient or {}).get("lead_id", ""),
                    "email": (recipient or {}).get("email", ""),
                    "step": step,
                    "details": details,
                }
            )
            handle.flush()
            os.fsync(handle.fileno())

    def sent_today(self, now: datetime) -> int:
        if not self.events_path.exists():
            return 0
        today = now.astimezone(UTC).date()
        return sum(
            1
            for row in _read_rows(self.events_path)
            if row.get("event") in {"sent", "recovered_sent"}
            and as_utc(row.get("timestamp"))
            and as_utc(row.get("timestamp")).date() == today  # type: ignore[union-attr]
        )

    def queue_skip(self, email: str, reason: str) -> Path:
        """Queue a recipient removal without racing a running CSV worker."""

        self.commands_path.mkdir(parents=True, exist_ok=True)
        command_id = str(uuid4())
        destination = self.commands_path / f"{command_id}.json"
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(
                {
                    "id": command_id,
                    "command": "skip_recipient",
                    "email": email.strip().lower(),
                    "reason": reason.strip() or "Removed manually",
                    "created_at": iso(utc_now()),
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        os.replace(temporary, destination)
        return destination

    def apply_commands(self, remote: DatabaseClient, now: datetime) -> int:
        if not self.commands_path.exists():
            return 0
        rows = self.recipients()
        changed = 0
        self.processed_commands_path.mkdir(parents=True, exist_ok=True)
        for path in sorted(self.commands_path.glob("*.json")):
            try:
                command = json.loads(path.read_text(encoding="utf-8"))
                if command.get("command") != "skip_recipient":
                    raise ValueError("Unsupported command")
                email = str(command.get("email") or "").strip().lower()
                matches = [row for row in rows if row["email"].strip().lower() == email]
                for recipient in matches:
                    if recipient["status"] in TERMINAL_STATUSES - {"uncertain"}:
                        continue
                    recipient.update(
                        status="skipped", next_send_at="", retry_at="",
                        attempt_step="", attempt_rfc_message_id="",
                        last_error=str(command.get("reason") or "Removed manually")[:500],
                        updated_at=iso(now),
                    )
                    self.event(
                        "recipient_skipped", recipient=recipient,
                        details=recipient["last_error"], at=now,
                    )
                    try:
                        remote.mark_campaign_recipient_skipped(
                            recipient["campaign_id"], recipient["lead_id"]
                        )
                    except Exception as exc:
                        self.event(
                            "remote_sync_failed", recipient=recipient,
                            details=f"Skipped status: {exc}", at=now,
                        )
                    changed += 1
                if not matches:
                    self.event(
                        "recipient_skip_not_found", details=f"No recipient matched {email}", at=now
                    )
            except Exception as exc:
                self.event("command_failed", details=f"{path.name}: {exc}", at=now)
            finally:
                os.replace(path, self.processed_commands_path / path.name)
        if changed:
            self.save_recipients(rows)
        return changed


class CsvCampaignWorker:
    def __init__(
        self,
        settings: Settings,
        remote: DatabaseClient,
        mail: MailService,
        store: CsvCampaignStore,
        *,
        poll_seconds: int = 30,
        retry_seconds: int = 300,
        send_gate: SendGate | None = None,
        reply_checker: ReplyChecker | None = None,
    ) -> None:
        self.settings = settings
        self.remote = remote
        self.mail = mail
        self.store = store
        self.poll_seconds = poll_seconds
        self.retry_seconds = retry_seconds
        self.send_gate = send_gate
        self.reply_checker = reply_checker
        self._campaign: dict[str, str] | None = None
        self._steps: list[dict[str, str]] | None = None
        self._sent_count_date = None
        self._sent_count = 0

    def start(self, campaign_id: str) -> None:
        self.store.bootstrap(self.remote, campaign_id)
        self._campaign = self.store.campaign()
        campaign_sender = str(self._campaign.get("sender_email") or "").strip().lower()
        if campaign_sender and campaign_sender != self.settings.sender_email.strip().lower():
            raise ValueError(
                f"Campaign sender {campaign_sender} does not match configured "
                f"SENDER_EMAIL {self.settings.sender_email}."
            )
        self.remote.update_campaign_status(campaign_id, "running")
        self._steps = self.store.steps()
        self.store.event("worker_started", details="Campaign marked running in Supabase")

    def run_forever(self, campaign_id: str) -> None:
        self.start(campaign_id)
        campaign = self.store.campaign()
        LOGGER.info("CSV campaign worker active: %s", campaign.get("title") or campaign_id)
        LOGGER.info("Local state: %s", self.store.directory)

        while True:
            now = utc_now()
            result = self.run_once(now)
            if result.completed:
                has_uncertain = any(
                    row["status"] == "uncertain" for row in self.store.recipients()
                )
                remote_status = "paused" if has_uncertain else "completed"
                self.remote.update_campaign_status(campaign_id, remote_status)
                event = "campaign_needs_review" if has_uncertain else "campaign_completed"
                self.store.event(event)
                LOGGER.info("Campaign ended with status %s", remote_status)
                return

            if result.sent:
                delay = random.uniform(
                    self.settings.min_delay_seconds,
                    self.settings.max_delay_seconds,
                )
                LOGGER.info("Waiting %.0f seconds before another delivery", delay)
                time.sleep(delay)
            else:
                sleep_for = self._sleep_seconds(result.next_due_at, now)
                LOGGER.debug("Idle for %.0f seconds", sleep_for)
                time.sleep(sleep_for)

    def run_once(self, now: datetime | None = None) -> CycleResult:
        now = now or utc_now()
        self.store.apply_commands(self.remote, now)
        campaign = self._campaign or self.store.campaign()
        steps = self._steps or self.store.steps()
        self._campaign = campaign
        self._steps = steps
        rows = self.store.recipients()

        if self._mark_interrupted_attempts(rows, now):
            self.store.save_recipients(rows)

        if all(row["status"] in TERMINAL_STATUSES for row in rows):
            return CycleResult(completed=True)

        if self._sent_today(now) >= self.settings.daily_send_limit:
            tomorrow = (now + timedelta(days=1)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            return CycleResult(next_due_at=tomorrow)

        due = [row for row in rows if self._is_due(row, now)]
        if not due:
            return CycleResult(next_due_at=self._next_due(rows))

        recipient = min(due, key=lambda row: as_utc(row["next_send_at"]) or now)
        step_number = 0 if recipient["status"] == "pending" else self._next_step(
            int(recipient["current_step"] or 0), steps
        )
        if step_number is None:
            recipient.update(status="completed", next_send_at="", updated_at=iso(now))
            self.store.save_recipients(rows)
            return CycleResult(next_due_at=self._next_due(rows))

        if self.send_gate is None:
            return self._send_recipient(
                rows, recipient, campaign, steps, step_number, now, None
            )

        with self.send_gate.acquire(now) as permit:
            if not permit.allowed:
                return CycleResult(next_due_at=permit.next_allowed_at)
            return self._send_recipient(
                rows, recipient, campaign, steps, step_number, now, permit
            )

    def _send_recipient(
        self,
        rows: list[dict[str, str]],
        recipient: dict[str, str],
        campaign: dict[str, str],
        steps: list[dict[str, str]],
        step_number: int,
        now: datetime,
        permit: Any,
    ) -> CycleResult:
        online_stop = self._check_online_assignment(
            rows, recipient, step_number, now
        )
        if online_stop is not None:
            return online_stop

        if step_number > 0 and self.reply_checker is not None:
            try:
                has_reply = self.reply_checker.has_reply(
                    recipient["email"],
                    root_message_id=recipient["gmail_thread_id"],
                    last_message_id=recipient["last_rfc_message_id"],
                )
            except Exception as exc:
                self._record_retry(
                    rows, recipient, now, f"Read-only reply check failed: {exc}"
                )
                return CycleResult(next_due_at=as_utc(recipient["retry_at"]))
            if has_reply:
                recipient.update(
                    status="replied", next_send_at="", retry_at="",
                    last_error="", updated_at=iso(now),
                )
                self.store.save_recipients(rows)
                self.store.event("reply_detected", recipient=recipient, at=now)
                try:
                    self.remote.mark_campaign_recipient_replied(
                        recipient["campaign_id"], recipient["lead_id"]
                    )
                except Exception as exc:
                    self.store.event(
                        "remote_sync_failed", recipient=recipient,
                        details=f"Campaign reply status: {exc}", at=now,
                    )
                return CycleResult(next_due_at=self._next_due(rows))

        attempt_rfc_id = make_msgid()
        recipient.update(
            status="sending",
            attempt_step=str(step_number),
            attempt_rfc_message_id=attempt_rfc_id,
            last_error="",
            updated_at=iso(now),
        )
        self.store.save_recipients(rows)
        self.store.event("send_started", recipient=recipient, step=step_number, at=now)

        try:
            subject = render_template(campaign["subject_template"], recipient)
            if step_number > 0 and not subject.lower().startswith("re:"):
                subject = f"Re: {subject}"
            body = render_template(
                campaign["body_template"]
                if step_number == 0
                else self._step(steps, step_number)["body_template"],
                recipient,
            )
            sent = self.mail.send_email(
                recipient["email"],
                subject,
                body,
                thread_id=recipient["gmail_thread_id"] or None,
                in_reply_to=recipient["last_rfc_message_id"] or None,
                rfc_message_id=attempt_rfc_id,
            )
        except PermanentRecipientError as exc:
            recipient.update(
                status="bounced", next_send_at="", retry_at="",
                attempt_step="", attempt_rfc_message_id="",
                last_error=str(exc)[:500], updated_at=iso(now),
            )
            self.store.save_recipients(rows)
            self.store.event(
                "recipient_rejected", recipient=recipient, step=step_number,
                details=str(exc), at=now,
            )
            try:
                self.remote.mark_lead_stopped_by_email(recipient["email"], "bounced")
            except Exception as sync_exc:
                self.store.event(
                    "remote_sync_failed", recipient=recipient,
                    details=f"Bounce status: {sync_exc}", at=now,
                )
            return CycleResult(next_due_at=self._next_due(rows))
        except Exception as exc:
            original_status = "pending" if step_number == 0 else "scheduled"
            recipient.update(status=original_status)
            self._record_retry(rows, recipient, now, str(exc), clear_attempt=True)
            return CycleResult(next_due_at=as_utc(recipient["retry_at"]))

        if permit is not None:
            permit.mark_sent(now)
        self._finish_send(rows, recipient, steps, step_number, sent, now, "sent")
        return CycleResult(sent=1, next_due_at=self._next_due(rows))

    def _check_online_assignment(
        self,
        rows: list[dict[str, str]],
        recipient: dict[str, str],
        step_number: int,
        now: datetime,
    ) -> CycleResult | None:
        """Fail closed unless Supabase still authorizes this exact send."""

        try:
            remote_status = self.remote.get_campaign_lead_status(
                recipient["campaign_id"], recipient["lead_id"]
            )
        except Exception as exc:
            self._record_retry(
                rows,
                recipient,
                now,
                f"Online cancellation check failed: {exc}",
            )
            return CycleResult(next_due_at=as_utc(recipient["retry_at"]))

        expected_status = "pending" if step_number == 0 else "sent"
        if remote_status == expected_status:
            return None

        remote_terminal = {"skipped", "replied", "bounced", "unsubscribed"}
        if remote_status in remote_terminal or remote_status is None:
            local_status = remote_status if remote_status in remote_terminal else "skipped"
            recipient.update(
                status=local_status,
                next_send_at="",
                retry_at="",
                attempt_step="",
                attempt_rfc_message_id="",
                last_error="Stopped by the online Relay campaign assignment",
                updated_at=iso(now),
            )
            self.store.save_recipients(rows)
            self.store.event(
                "remote_stop_detected",
                recipient=recipient,
                step=step_number,
                details=f"Online assignment status: {remote_status or 'removed'}",
                at=now,
            )
            return CycleResult(next_due_at=self._next_due(rows))

        self._record_retry(
            rows,
            recipient,
            now,
            f"Online assignment status {remote_status!r} does not authorize this send",
        )
        return CycleResult(next_due_at=as_utc(recipient["retry_at"]))

    def _finish_send(
        self,
        rows: list[dict[str, str]],
        recipient: dict[str, str],
        steps: list[dict[str, str]],
        step_number: int,
        sent: SentMessage,
        sent_at: datetime,
        event: str,
    ) -> None:
        next_step_number = self._next_step(step_number, steps)
        if next_step_number is None:
            status = "completed"
            next_send_at = None
        else:
            status = "scheduled"
            current_delay = 0 if step_number == 0 else int(
                self._step(steps, step_number)["delay_days"]
            )
            next_delay = int(self._step(steps, next_step_number)["delay_days"])
            next_send_at = sent_at + timedelta(days=max(0, next_delay - current_delay))

        recipient.update(
            status=status,
            current_step=str(step_number),
            next_send_at=iso(next_send_at),
            last_sent_at=iso(sent_at),
            gmail_thread_id=sent.thread_id,
            last_gmail_message_id=sent.message_id,
            last_rfc_message_id=sent.rfc_message_id,
            attempt_step="",
            attempt_rfc_message_id="",
            retry_at="",
            last_error="",
            updated_at=iso(sent_at),
        )
        self.store.save_recipients(rows)
        self.store.event(event, recipient=recipient, step=step_number, at=sent_at)
        self._record_sent(sent_at)
        try:
            self.remote.record_local_delivery(
                recipient["campaign_id"],
                recipient["lead_id"],
                step_number=step_number,
                sent_at=sent_at,
                thread_id=sent.thread_id,
                rfc_message_id=sent.rfc_message_id,
                provider_message_id=sent.message_id,
                next_send_at=next_send_at,
            )
        except Exception as exc:
            # SMTP acceptance cannot be rolled back. Preserve the local truth and
            # surface the projection error without ever resending the message.
            self.store.event(
                "remote_sync_failed", recipient=recipient, step=step_number,
                details=f"Delivery status: {exc}", at=sent_at,
            )
            LOGGER.exception("Supabase delivery projection failed for %s", recipient["email"])

    def _mark_interrupted_attempts(
        self,
        rows: list[dict[str, str]],
        now: datetime,
    ) -> bool:
        changed = False
        for recipient in rows:
            if recipient["status"] != "sending":
                continue
            attempt_at = as_utc(recipient["updated_at"]) or now
            if now - attempt_at < timedelta(minutes=10):
                continue
            recipient.update(
                status="uncertain", next_send_at="", retry_at="",
                last_error=(
                    "Worker stopped during SMTP submission; acceptance is unknown. "
                    "Not retried automatically to prevent a duplicate."
                ),
                updated_at=iso(now),
            )
            self.store.event(
                "send_outcome_uncertain", recipient=recipient,
                step=recipient["attempt_step"], details=recipient["last_error"], at=now,
            )
            changed = True
        return changed

    def _record_retry(
        self,
        rows: list[dict[str, str]],
        recipient: dict[str, str],
        now: datetime,
        error: str,
        *,
        clear_attempt: bool = False,
    ) -> None:
        recipient.update(
            retry_at=iso(now + timedelta(seconds=self.retry_seconds)),
            last_error=error[:500],
            updated_at=iso(now),
        )
        if clear_attempt:
            recipient.update(attempt_step="", attempt_rfc_message_id="")
        self.store.save_recipients(rows)
        self.store.event("retry_scheduled", recipient=recipient, details=error, at=now)
        LOGGER.warning("Retry scheduled for %s: %s", recipient["email"], error)

    @staticmethod
    def _step(steps: list[dict[str, str]], step_number: int) -> dict[str, str]:
        return next(step for step in steps if int(step["step_number"]) == step_number)

    @staticmethod
    def _next_step(current_step: int, steps: list[dict[str, str]]) -> int | None:
        return next(
            (
                int(step["step_number"])
                for step in steps
                if int(step["step_number"]) > current_step
            ),
            None,
        )

    @staticmethod
    def _is_due(recipient: dict[str, str], now: datetime) -> bool:
        if recipient["status"] not in {"pending", "scheduled"}:
            return False
        due_at = as_utc(recipient["next_send_at"]) or now
        retry_at = as_utc(recipient["retry_at"])
        return due_at <= now and (retry_at is None or retry_at <= now)

    @staticmethod
    def _next_due(rows: list[dict[str, str]]) -> datetime | None:
        candidates: list[datetime] = []
        for row in rows:
            if row["status"] == "sending":
                updated = as_utc(row["updated_at"])
                if updated:
                    candidates.append(updated + timedelta(minutes=10))
            elif row["status"] in {"pending", "scheduled"}:
                due = as_utc(row["next_send_at"])
                retry = as_utc(row["retry_at"])
                if due:
                    candidates.append(max(due, retry) if retry else due)
        return min(candidates) if candidates else None

    def _sleep_seconds(self, next_due_at: datetime | None, now: datetime) -> float:
        wake_times = [now + timedelta(seconds=self.poll_seconds)]
        if next_due_at is not None:
            wake_times.append(next_due_at)
        return max(1.0, (min(wake_times) - now).total_seconds())

    def _sent_today(self, now: datetime) -> int:
        today = now.astimezone(UTC).date()
        if self._sent_count_date != today:
            self._sent_count_date = today
            self._sent_count = self.store.sent_today(now)
        return self._sent_count

    def _record_sent(self, sent_at: datetime) -> None:
        today = sent_at.astimezone(UTC).date()
        if self._sent_count_date == today:
            self._sent_count += 1
