"""Run the restart-safe local CSV Gmail campaign worker."""

from __future__ import annotations

import argparse
import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path
from uuid import UUID

from config import get_settings
from csv_campaign_worker import CsvCampaignStore, CsvCampaignWorker
from db_client import DatabaseClient
from gmail_service import GmailService
from gmail_send_gate import GmailSendGate


# Backward-compatible default for direct foreground runs. The management
# scripts pass --campaign-id, so this file no longer needs editing per campaign.
DEFAULT_CAMPAIGN_ID = "fd580573-e03c-4ed2-9d0e-55185ebcafd0"

# The worker stays active between scheduled emails and checks replies regularly.
STATE_FOLDER = Path(__file__).with_name("campaign_state")
WORKER_POLL_SECONDS = 300
REPLY_POLL_SECONDS = 900
FAILED_SEND_RETRY_SECONDS = 300


def selected_campaign_id(value: str | None = None) -> str:
    campaign_id = (value or os.getenv("CAMPAIGN_ID") or DEFAULT_CAMPAIGN_ID).strip()
    if not campaign_id:
        raise SystemExit(
            "Campaign ID is required. Pass --campaign-id or set CAMPAIGN_ID."
        )

    try:
        UUID(campaign_id)
    except ValueError as exc:
        raise SystemExit(
            "CAMPAIGN_ID does not contain a valid campaign UUID."
        ) from exc

    return campaign_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one saved Gmail campaign.")
    parser.add_argument("--campaign-id", help="Relay campaign UUID")
    arguments = parser.parse_args()
    campaign_id = selected_campaign_id(arguments.campaign_id)
    settings = get_settings()
    database = DatabaseClient(settings)
    store = CsvCampaignStore(STATE_FOLDER, campaign_id)
    worker = CsvCampaignWorker(
        settings,
        database,
        GmailService(settings),
        store,
        poll_seconds=WORKER_POLL_SECONDS,
        reply_poll_seconds=REPLY_POLL_SECONDS,
        retry_seconds=FAILED_SEND_RETRY_SECONDS,
        send_gate=GmailSendGate(
            STATE_FOLDER,
            min_delay_seconds=settings.min_delay_seconds,
            max_delay_seconds=settings.max_delay_seconds,
            daily_send_limit=settings.daily_send_limit,
        ),
    )

    store.directory.mkdir(parents=True, exist_ok=True)
    log_format = logging.Formatter("%(asctime)s %(levelname)s: %(message)s")
    file_handler = RotatingFileHandler(
        store.directory / "worker.log",
        maxBytes=1_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(log_format)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(log_format)
    logging.basicConfig(level=logging.INFO, handlers=[file_handler, console_handler])
    print(f"Campaign ID: {campaign_id}")
    print(f"CSV state folder: {store.directory}")
    print("The worker will remain active until the campaign is complete.")
    print("Press Ctrl+C to stop safely; run this file again to resume.")
    pid_path = store.directory / "worker.pid"
    try:
        with single_instance_lock(store.directory / "worker.lock"):
            pid_path.write_text(str(os.getpid()), encoding="ascii")
            try:
                worker.run_forever(campaign_id)
            finally:
                pid_path.unlink(missing_ok=True)
    except KeyboardInterrupt:
        store.event("worker_stopped", details="Stopped by user")
        print("\nWorker stopped. CSV state was preserved for the next run.")


class single_instance_lock:
    """Hold an operating-system file lock for one campaign worker."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+b")
        self.handle.seek(0)
        if self.handle.tell() == 0:
            self.handle.write(b"0")
            self.handle.flush()
        self.handle.seek(0)
        try:
            import msvcrt

            msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as exc:
            self.handle.close()
            raise SystemExit("This campaign worker is already running.") from exc
        return self

    def __exit__(self, exc_type, exc, traceback):
        if self.handle is not None:
            self.handle.seek(0)
            import msvcrt

            msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            self.handle.close()


if __name__ == "__main__":
    main()
