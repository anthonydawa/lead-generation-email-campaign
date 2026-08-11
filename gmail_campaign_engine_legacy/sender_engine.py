"""Throttled campaign execution and state management."""

from __future__ import annotations

import logging
import random
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from config import Settings
from db_client import DatabaseClient
from gmail_service import GmailService

LOGGER = logging.getLogger(__name__)
TEMPLATE_TAG = re.compile(r"{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}")


@dataclass
class CampaignRunResult:
    sent: int = 0
    failed: int = 0
    skipped: int = 0
    interrupted: bool = False


def render_template(template: str, lead: Mapping[str, Any]) -> str:
    """Replace known tags with lead values and unknown tags with an empty string."""

    return TEMPLATE_TAG.sub(lambda match: str(lead.get(match.group(1)) or ""), template)


class CampaignEngine:
    def __init__(
        self,
        settings: Settings,
        db: DatabaseClient,
        gmail: GmailService,
    ) -> None:
        self.settings = settings
        self.db = db
        self.gmail = gmail

    def run_campaign(self, campaign_id: str) -> CampaignRunResult:
        campaign = self.db.get_campaign(campaign_id)
        if campaign is None:
            raise ValueError(f"Campaign not found: {campaign_id}")
        if campaign.get("status") not in {"staged", "running"}:
            raise ValueError(
                "Campaign must have status 'staged' or 'running' before it can send"
            )

        result = CampaignRunResult()
        initial_send_at = _parse_datetime(campaign.get("initial_send_at"))
        if initial_send_at and initial_send_at > datetime.now(timezone.utc):
            LOGGER.info(
                "Campaign is scheduled for %s; no initial emails are due yet",
                initial_send_at.isoformat(),
            )
            return result
        remaining_allowance = max(
            0,
            self.settings.daily_send_limit - self.db.get_sent_count_today(),
        )
        if remaining_allowance == 0:
            LOGGER.warning("Daily send limit has already been reached")
            return result

        self.db.update_campaign_status(campaign_id, "running")
        steps = self.db.get_campaign_steps(campaign_id)
        leads = self.db.get_pending_leads_for_campaign(
            campaign_id,
            remaining_allowance,
        )

        try:
            for index, lead in enumerate(leads):
                lead_id = str(lead["id"])
                if (
                    self.db.get_campaign_lead_status(campaign_id, lead_id)
                    != "pending"
                ):
                    result.skipped += 1
                    continue

                subject = render_template(str(campaign["subject_template"]), lead)
                body = render_template(str(campaign["body_template"]), lead)
                try:
                    sent_message = self.gmail.send_email(
                        str(lead["email"]),
                        subject,
                        body,
                    )
                    sent_at = datetime.now(timezone.utc)
                    next_send_at = (
                        self.db.followup_time(sent_at, int(steps[0]["delay_days"]))
                        if steps
                        else None
                    )
                    # Log before changing the lead state. If the second operation
                    # fails, a rerun can be reconciled from the durable Gmail log.
                    self.db.log_email_send(
                        campaign_id,
                        lead_id,
                        sent_message.thread_id,
                        sent_message.message_id,
                        sent_message.rfc_message_id,
                    )
                    self.db.mark_lead_sent(
                        campaign_id,
                        lead_id,
                        sent_at=sent_at,
                        thread_id=sent_message.thread_id,
                        gmail_message_id=sent_message.message_id,
                        rfc_message_id=sent_message.rfc_message_id,
                        next_send_at=next_send_at,
                    )
                    result.sent += 1
                except Exception:
                    result.failed += 1
                    LOGGER.exception("Failed to send to lead %s", lead_id)
                    try:
                        self.db.log_email_failure(campaign_id, lead_id)
                    except Exception:
                        LOGGER.exception("Failed to record send failure for %s", lead_id)

                if index < len(leads) - 1:
                    delay = random.uniform(
                        self.settings.min_delay_seconds,
                        self.settings.max_delay_seconds,
                    )
                    time.sleep(delay)
        except KeyboardInterrupt:
            result.interrupted = True
            self.db.update_campaign_status(campaign_id, "paused")
            return result

        self.db.update_campaign_status(
            campaign_id,
            "running" if self.db.campaign_has_open_work(campaign_id) else "completed",
        )
        return result

    def run_due_followups(
        self,
        campaign_id: str | None = None,
    ) -> CampaignRunResult:
        """Send sequence steps that are due, preserving the original Gmail thread."""

        result = CampaignRunResult()
        remaining_allowance = max(
            0,
            self.settings.daily_send_limit - self.db.get_sent_count_today(),
        )
        if remaining_allowance == 0:
            LOGGER.warning("Daily send limit has already been reached")
            return result

        due = self.db.get_due_followups(remaining_allowance, campaign_id)
        steps_by_campaign: dict[str, list[dict[str, Any]]] = {}
        touched_campaigns: set[str] = set()

        try:
            for index, assignment in enumerate(due):
                current_campaign_id = str(assignment["campaign_id"])
                lead_id = str(assignment["lead_id"])
                touched_campaigns.add(current_campaign_id)

                # Reply polling happens before this loop; this final status read
                # closes the window as much as possible before the Gmail call.
                if (
                    self.db.get_campaign_lead_status(current_campaign_id, lead_id)
                    != "sent"
                ):
                    result.skipped += 1
                    continue

                if current_campaign_id not in steps_by_campaign:
                    steps_by_campaign[current_campaign_id] = (
                        self.db.get_campaign_steps(current_campaign_id)
                    )
                steps = steps_by_campaign[current_campaign_id]
                current_step = int(assignment.get("current_step") or 0)
                next_step = next(
                    (
                        step
                        for step in steps
                        if int(step["step_number"]) > current_step
                    ),
                    None,
                )
                if next_step is None:
                    result.skipped += 1
                    continue

                lead = dict(assignment.get("leads") or {})
                campaign = dict(assignment.get("campaigns") or {})
                thread_id = str(assignment.get("gmail_thread_id") or "")
                parent_rfc_id = str(assignment.get("last_rfc_message_id") or "")
                if not thread_id or not parent_rfc_id:
                    result.failed += 1
                    LOGGER.error(
                        "Cannot thread follow-up for lead %s: missing Gmail headers",
                        lead_id,
                    )
                    continue
                if self.gmail.thread_has_reply(thread_id, str(lead["email"])):
                    self.db.mark_lead_replied_by_email(str(lead["email"]))
                    result.skipped += 1
                    LOGGER.info(
                        "Skipping follow-up for lead %s because the thread has a reply",
                        lead_id,
                    )
                    continue

                step_number = int(next_step["step_number"])
                subject = render_template(
                    str(campaign["subject_template"]),
                    lead,
                )
                body = render_template(str(next_step["body_template"]), lead)
                try:
                    sent_message = self.gmail.send_email(
                        str(lead["email"]),
                        subject,
                        body,
                        thread_id=thread_id,
                        in_reply_to=parent_rfc_id,
                    )
                    following_step = next(
                        (
                            step
                            for step in steps
                            if int(step["step_number"]) > step_number
                        ),
                        None,
                    )
                    first_sent_at = _parse_datetime(assignment.get("first_sent_at"))
                    if first_sent_at is None:
                        raise RuntimeError("Follow-up assignment has no first_sent_at")
                    next_send_at = (
                        self.db.followup_time(
                            first_sent_at,
                            int(following_step["delay_days"]),
                        )
                        if following_step
                        else None
                    )
                    self.db.log_email_send(
                        current_campaign_id,
                        lead_id,
                        sent_message.thread_id,
                        sent_message.message_id,
                        sent_message.rfc_message_id,
                        step_number,
                    )
                    self.db.advance_followup(
                        current_campaign_id,
                        lead_id,
                        step_number=step_number,
                        gmail_message_id=sent_message.message_id,
                        rfc_message_id=sent_message.rfc_message_id,
                        next_send_at=next_send_at,
                    )
                    result.sent += 1
                except Exception:
                    result.failed += 1
                    LOGGER.exception(
                        "Failed follow-up step %s for lead %s",
                        step_number,
                        lead_id,
                    )
                    try:
                        self.db.log_email_failure(
                            current_campaign_id,
                            lead_id,
                            step_number,
                        )
                    except Exception:
                        LOGGER.exception(
                            "Failed to record follow-up failure for %s",
                            lead_id,
                        )

                if index < len(due) - 1:
                    time.sleep(
                        random.uniform(
                            self.settings.min_delay_seconds,
                            self.settings.max_delay_seconds,
                        )
                    )
        except KeyboardInterrupt:
            result.interrupted = True
            return result

        for current_campaign_id in touched_campaigns:
            if not self.db.campaign_has_open_work(current_campaign_id):
                self.db.update_campaign_status(current_campaign_id, "completed")
        return result


def run_campaign(
    campaign_id: str,
    settings: Settings,
    db: DatabaseClient,
    gmail: GmailService,
) -> CampaignRunResult:
    return CampaignEngine(settings, db, gmail).run_campaign(campaign_id)


def run_due_followups(
    settings: Settings,
    db: DatabaseClient,
    gmail: GmailService,
    campaign_id: str | None = None,
) -> CampaignRunResult:
    return CampaignEngine(settings, db, gmail).run_due_followups(campaign_id)


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
