"""Small, typed wrapper around the Supabase data API."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client, create_client

from config import Settings


class DatabaseClient:
    """Centralizes all database reads and state transitions."""

    def __init__(self, settings: Settings, client: Client | None = None) -> None:
        self.client = client or create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
        )

    def get_unvalidated_leads(self) -> list[dict[str, Any]]:
        response = (
            self.client.table("leads")
            .select("id,email")
            .eq("validation_status", "unvalidated")
            .execute()
        )
        return list(response.data or [])

    def update_lead_validation(self, lead_id: str, status: str) -> None:
        if status not in {"valid", "invalid", "disposable"}:
            raise ValueError(f"Unsupported validation status: {status}")
        (
            self.client.table("leads")
            .update({"validation_status": status})
            .eq("id", lead_id)
            .execute()
        )

    def get_staged_campaigns(self) -> list[dict[str, Any]]:
        response = (
            self.client.table("campaigns")
            .select("*")
            .eq("status", "staged")
            .execute()
        )
        return list(response.data or [])

    def get_sendable_campaigns(self) -> list[dict[str, Any]]:
        response = (
            self.client.table("campaigns")
            .select("*")
            .in_("status", ["staged", "running"])
            .order("created_at")
            .execute()
        )
        return [dict(row) for row in (response.data or [])]

    def get_campaigns_for_local_sync(self) -> list[dict[str, Any]]:
        """Return campaign states that can affect an existing local queue."""

        response = (
            self.client.table("campaigns")
            .select("*")
            .in_("status", ["staged", "scheduled", "testing", "running", "slowing", "paused", "stopped", "completed", "cancelled"])
            .order("created_at")
            .execute()
        )
        return [dict(row) for row in (response.data or [])]

    def get_campaign(self, campaign_id: str) -> dict[str, Any] | None:
        response = (
            self.client.table("campaigns")
            .select("*")
            .eq("id", campaign_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return dict(rows[0]) if rows else None

    def update_campaign_status(self, campaign_id: str, status: str) -> None:
        if status not in {"draft", "staged", "scheduled", "testing", "running", "slowing", "paused", "stopped", "completed", "cancelled"}:
            raise ValueError(f"Unsupported campaign status: {status}")
        (
            self.client.table("campaigns")
            .update({"status": status})
            .eq("id", campaign_id)
            .execute()
        )

    def get_pending_leads_for_campaign(
        self,
        campaign_id: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        """Return valid pending leads assigned to this campaign."""

        if not campaign_id:
            raise ValueError("campaign_id is required")
        response = (
            self.client.table("campaign_leads")
            .select(
                "lead_id,status,created_at,"
                "leads!inner(id,email,first_name,last_name,company,status,"
                "validation_status)"
            )
            .eq("campaign_id", campaign_id)
            .eq("status", "pending")
            .eq("leads.validation_status", "valid")
            .eq("leads.status", "pending")
            .order("created_at")
            .limit(limit)
            .execute()
        )
        return [
            dict(row["leads"])
            for row in (response.data or [])
            if row.get("leads")
        ]

    def get_campaign_lead_status(
        self,
        campaign_id: str,
        lead_id: str,
    ) -> str | None:
        response = (
            self.client.table("campaign_leads")
            .select("status")
            .eq("campaign_id", campaign_id)
            .eq("lead_id", lead_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return str(rows[0]["status"]) if rows else None

    def get_campaign_steps(self, campaign_id: str) -> list[dict[str, Any]]:
        response = (
            self.client.table("campaign_steps")
            .select("id,campaign_id,step_number,delay_days,body_template")
            .eq("campaign_id", campaign_id)
            .order("step_number")
            .execute()
        )
        return [dict(row) for row in (response.data or [])]

    def get_campaign_assignments(self, campaign_id: str) -> list[dict[str, Any]]:
        """Return the authoritative recipients and their current remote state."""

        response = (
            self.client.table("campaign_leads")
            .select(
                "campaign_id,lead_id,status,first_sent_at,next_send_at,current_step,"
                "gmail_thread_id,last_gmail_message_id,last_rfc_message_id,"
                "leads!inner(id,email,first_name,last_name,company,status,validation_status)"
            )
            .eq("campaign_id", campaign_id)
            .execute()
        )
        return [dict(row) for row in (response.data or [])]

    def get_campaign_delivery_logs(self, campaign_id: str) -> list[dict[str, Any]]:
        """Return successful deliveries used only for the first local CSV import."""

        response = (
            self.client.table("campaign_logs")
            .select(
                "lead_id,step_number,sent_at,gmail_thread_id,gmail_message_id,"
                "rfc_message_id,status"
            )
            .eq("campaign_id", campaign_id)
            .eq("status", "sent")
            .order("sent_at")
            .execute()
        )
        return [dict(row) for row in (response.data or [])]

    def record_local_delivery(
        self,
        campaign_id: str,
        lead_id: str,
        *,
        step_number: int,
        sent_at: datetime,
        thread_id: str,
        rfc_message_id: str,
        provider_message_id: str,
        next_send_at: datetime | None,
    ) -> None:
        """Project locally completed delivery state back to Supabase."""

        values: dict[str, Any] = {
            "status": "sent",
            "current_step": step_number,
            "next_send_at": next_send_at.isoformat() if next_send_at else None,
            "gmail_thread_id": thread_id,
            "last_gmail_message_id": provider_message_id,
            "last_rfc_message_id": rfc_message_id,
        }
        if step_number == 0:
            values["first_sent_at"] = sent_at.isoformat()
        (
            self.client.table("campaign_leads")
            .update(values)
            .eq("campaign_id", campaign_id)
            .eq("lead_id", lead_id)
            .in_("status", ["pending", "sent"])
            .execute()
        )
        if step_number == 0:
            (
                self.client.table("leads")
                .update({"status": "sent"})
                .eq("id", lead_id)
                .neq("status", "replied")
                .execute()
            )
        self.client.table("campaign_logs").insert(
            {
                "campaign_id": campaign_id,
                "lead_id": lead_id,
                "gmail_message_id": provider_message_id,
                "rfc_message_id": rfc_message_id,
                "step_number": step_number,
                "status": "sent",
            }
        ).execute()

    def mark_lead_sent(
        self,
        campaign_id: str,
        lead_id: str,
        *,
        sent_at: datetime,
        thread_id: str,
        gmail_message_id: str,
        rfc_message_id: str,
        next_send_at: datetime | None,
    ) -> None:
        (
            self.client.table("campaign_leads")
            .update(
                {
                    "status": "sent",
                    "first_sent_at": sent_at.isoformat(),
                    "next_send_at": (
                        next_send_at.isoformat() if next_send_at else None
                    ),
                    "current_step": 0,
                    "gmail_thread_id": thread_id,
                    "last_gmail_message_id": gmail_message_id,
                    "last_rfc_message_id": rfc_message_id,
                }
            )
            .eq("campaign_id", campaign_id)
            .eq("lead_id", lead_id)
            .eq("status", "pending")
            .execute()
        )
        (
            self.client.table("leads")
            .update({"status": "sent"})
            .eq("id", lead_id)
            .neq("status", "replied")
            .execute()
        )

    def log_email_send(
        self,
        campaign_id: str,
        lead_id: str,
        thread_id: str,
        gmail_message_id: str,
        rfc_message_id: str,
        step_number: int = 0,
    ) -> None:
        self.client.table("campaign_logs").insert(
            {
                "campaign_id": campaign_id,
                "lead_id": lead_id,
                "gmail_thread_id": thread_id,
                "gmail_message_id": gmail_message_id,
                "rfc_message_id": rfc_message_id,
                "step_number": step_number,
                "status": "sent",
            }
        ).execute()

    def log_email_failure(
        self,
        campaign_id: str,
        lead_id: str,
        step_number: int = 0,
    ) -> None:
        self.client.table("campaign_logs").insert(
            {
                "campaign_id": campaign_id,
                "lead_id": lead_id,
                "step_number": step_number,
                "status": "failed",
            }
        ).execute()

    def get_sent_count_today(self) -> int:
        """Count successful sends since midnight UTC across all campaigns."""

        utc_midnight = datetime.now(timezone.utc).replace(
            hour=0,
            minute=0,
            second=0,
            microsecond=0,
        )
        response = (
            self.client.table("campaign_logs")
            .select("id", count="exact")
            .eq("status", "sent")
            .gte("sent_at", utc_midnight.isoformat())
            .execute()
        )
        return int(response.count or 0)

    def get_due_followups(
        self,
        limit: int,
        campaign_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return recipients whose next sequence step is due now."""

        query = (
            self.client.table("campaign_leads")
            .select(
                "campaign_id,lead_id,status,first_sent_at,next_send_at,"
                "current_step,gmail_thread_id,last_gmail_message_id,"
                "last_rfc_message_id,"
                "campaigns!inner(id,status,subject_template),"
                "leads!inner(id,email,first_name,last_name,company,status,"
                "validation_status)"
            )
            .eq("status", "sent")
            .eq("campaigns.status", "running")
            .eq("leads.status", "sent")
            .not_.is_("next_send_at", "null")
            .lte("next_send_at", datetime.now(timezone.utc).isoformat())
            .order("next_send_at")
            .limit(limit)
        )
        if campaign_id:
            query = query.eq("campaign_id", campaign_id)
        return [dict(row) for row in (query.execute().data or [])]

    def advance_followup(
        self,
        campaign_id: str,
        lead_id: str,
        *,
        step_number: int,
        gmail_message_id: str,
        rfc_message_id: str,
        next_send_at: datetime | None,
    ) -> None:
        (
            self.client.table("campaign_leads")
            .update(
                {
                    "current_step": step_number,
                    "next_send_at": (
                        next_send_at.isoformat() if next_send_at else None
                    ),
                    "last_gmail_message_id": gmail_message_id,
                    "last_rfc_message_id": rfc_message_id,
                }
            )
            .eq("campaign_id", campaign_id)
            .eq("lead_id", lead_id)
            .eq("status", "sent")
            .eq("current_step", step_number - 1)
            .execute()
        )

    def campaign_has_open_work(self, campaign_id: str) -> bool:
        pending = (
            self.client.table("campaign_leads")
            .select("lead_id", count="exact")
            .eq("campaign_id", campaign_id)
            .eq("status", "pending")
            .limit(1)
            .execute()
        )
        if int(pending.count or 0):
            return True
        scheduled = (
            self.client.table("campaign_leads")
            .select("lead_id", count="exact")
            .eq("campaign_id", campaign_id)
            .eq("status", "sent")
            .not_.is_("next_send_at", "null")
            .limit(1)
            .execute()
        )
        return bool(int(scheduled.count or 0))

    @staticmethod
    def followup_time(first_sent_at: datetime, delay_days: int) -> datetime:
        return first_sent_at + timedelta(days=delay_days)

    def mark_lead_replied_by_email(self, email: str) -> bool:
        """Mark a known lead as replied and report whether a row matched."""

        normalized = email.strip().lower()
        lookup = (
            self.client.table("leads")
            .select("id,email")
            .ilike("email", normalized)
            .in_("status", ["pending", "sent"])
            .execute()
        )
        matching_ids = [
            str(row["id"])
            for row in (lookup.data or [])
            if str(row.get("email", "")).strip().lower() == normalized
        ]
        if not matching_ids:
            return False
        (
            self.client.table("leads")
            .update({"status": "replied"})
            .in_("id", matching_ids)
            .execute()
        )
        (
            self.client.table("campaign_leads")
            .update({"status": "replied"})
            .in_("lead_id", matching_ids)
            .in_("status", ["pending", "sent"])
            .execute()
        )
        return True

    def mark_lead_stopped_by_email(self, email: str, status: str) -> bool:
        """Apply a bounce/unsubscribe stop state to matching Supabase rows."""

        if status not in {"bounced", "unsubscribed"}:
            raise ValueError(f"Unsupported lead stop status: {status}")
        normalized = email.strip().lower()
        lookup = self.client.table("leads").select("id,email").ilike("email", normalized).execute()
        ids = [
            str(row["id"])
            for row in (lookup.data or [])
            if str(row.get("email", "")).strip().lower() == normalized
        ]
        if not ids:
            return False
        self.client.table("leads").update({"status": status}).in_("id", ids).execute()
        (
            self.client.table("campaign_leads")
            .update({"status": status, "next_send_at": None})
            .in_("lead_id", ids)
            .in_("status", ["pending", "sent"])
            .execute()
        )
        return True

    def upsert_worker_report(
        self,
        campaign_id: str,
        worker_kind: str,
        report_date: str,
        values: dict[str, Any],
    ) -> None:
        """Publish one rolling daily snapshot for dashboard reporting."""

        payload = {
            "campaign_id": campaign_id,
            "worker_kind": worker_kind,
            "report_date": report_date,
            **values,
        }
        (
            self.client.table("campaign_worker_reports")
            .upsert(
                payload,
                on_conflict="campaign_id,worker_kind,report_date",
            )
            .execute()
        )

    def get_campaign_delivery_counts(
        self,
        campaign_id: str,
        day_started_at: datetime,
    ) -> tuple[int, int]:
        """Return all-time and current-day accepted-delivery counts."""

        base = (
            self.client.table("campaign_logs")
            .select("id", count="exact")
            .eq("campaign_id", campaign_id)
            .eq("status", "sent")
        )
        total = base.limit(1).execute()
        today = (
            self.client.table("campaign_logs")
            .select("id", count="exact")
            .eq("campaign_id", campaign_id)
            .eq("status", "sent")
            .gte("sent_at", day_started_at.isoformat())
            .limit(1)
            .execute()
        )
        return int(total.count or 0), int(today.count or 0)

    def get_status_counts(self) -> dict[str, int]:
        """Return the operational counts used by the CLI status command."""

        queries: Mapping[str, tuple[str, str]] = {
            "pending": ("status", "pending"),
            "valid": ("validation_status", "valid"),
            "sent": ("status", "sent"),
            "replied": ("status", "replied"),
        }
        counts: dict[str, int] = {}
        for label, (column, value) in queries.items():
            response = (
                self.client.table("leads")
                .select("id", count="exact")
                .eq(column, value)
                .execute()
            )
            counts[label] = int(response.count or 0)
        return counts
