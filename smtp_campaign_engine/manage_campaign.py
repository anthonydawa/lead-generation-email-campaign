"""Safe campaign management commands for a running worker."""

from __future__ import annotations

import argparse
import csv
from collections import Counter
from pathlib import Path
from uuid import UUID

from csv_campaign_worker import CsvCampaignStore


STATE_FOLDER = Path(__file__).with_name("campaign_state")


def campaign_id(value: str) -> str:
    try:
        return str(UUID(value))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("campaign ID must be a UUID") from exc


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage a direct-mail campaign worker")
    subparsers = parser.add_subparsers(dest="command", required=True)

    remove = subparsers.add_parser("remove-recipient")
    remove.add_argument("--campaign-id", required=True, type=campaign_id)
    remove.add_argument("--email", required=True)
    remove.add_argument("--reason", default="Removed manually")

    status = subparsers.add_parser("status")
    status.add_argument("--campaign-id", required=True, type=campaign_id)

    args = parser.parse_args()
    store = CsvCampaignStore(STATE_FOLDER, args.campaign_id)
    if args.command == "remove-recipient":
        path = store.queue_skip(args.email, args.reason)
        print(f"Removal queued for {args.email.strip().lower()}.")
        print(f"The worker will apply it before its next send cycle: {path}")
        return

    if not store.recipients_path.exists():
        raise SystemExit("Campaign state does not exist yet. Start the worker first.")
    with store.recipients_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    counts = Counter(row.get("status") or "unknown" for row in rows)
    print(f"Campaign: {args.campaign_id}")
    print(f"Recipients: {len(rows)}")
    for name in sorted(counts):
        print(f"  {name}: {counts[name]}")


if __name__ == "__main__":
    main()
