# Standalone Legacy Gmail Campaign Worker

This folder preserves the Gmail/Google Workspace campaign workflow as the
legacy alternative to `smtp_campaign_engine`.

The legacy worker sends through the Gmail API, checks Gmail for replies, stores
restart-safe campaign execution state in CSV files, and projects campaign-level
status to Supabase. It does not use SES, S3, SQS, or the newer SQLite safety
ledger.

## First-time setup

```powershell
cd "C:\Users\antho\Documents\Lead Generation & Email Campaign\gmail_campaign_engine_legacy"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Fill in the Supabase values in `.env`. Add the local `credentials.json` and
`token.json` files, or point `GMAIL_CREDENTIALS_FILE` and `GMAIL_TOKEN_FILE` at
their existing absolute paths. These credential files are excluded from Git.

Start one campaign in the foreground by passing its Relay campaign UUID:

```powershell
.\.venv\Scripts\python.exe run_saved_campaign.py --campaign-id <campaign-uuid>
```

Or start a dedicated hidden Windows worker. Repeat this command with a
different campaign ID to run another campaign concurrently. Every campaign gets
its own process, PID, log, and CSV state folder:

```powershell
.\start_campaign_worker.ps1 -CampaignId <campaign-uuid>
```

List all campaign workers:

```powershell
.\list_campaign_workers.ps1
```

Stop one campaign while preserving its restart-safe state:

```powershell
.\stop_campaign_worker.ps1 -CampaignId <campaign-uuid>
```

All workers share one Gmail send gate. This keeps the configured delay and
daily limit account-wide even while multiple campaign workers remain active.

## Stop one recipient without deleting history

The preferred control is **Manage recipients** in the Relay campaign dashboard.
Choose **Remove from campaign** beside the person. Before every initial email or
follow-up, an active worker reads that exact Supabase assignment and stops when
its status is `skipped`. If the final database check fails, the worker postpones
the send instead of delivering without confirmation. A Gmail API submission
that was already accepted cannot be recalled.

For local maintenance, never edit `recipients.csv` while its campaign worker is
running. Stop that specific worker, mark the recipient terminal with the audited
helper, and then restart the worker:

```powershell
.\stop_campaign_worker.ps1 -CampaignId <campaign-uuid>
.\skip_campaign_recipient.ps1 -CampaignId <campaign-uuid> -Email <recipient@example.com> -Reason "Repeated delivery failure"
.\start_campaign_worker.ps1 -CampaignId <campaign-uuid>
```

The helper refuses to edit a live worker, creates a timestamped CSV backup,
uses the terminal `skipped` status, clears future retry/schedule fields, and
adds a `recipient_skipped` audit event. It intentionally preserves the row and
prior delivery/thread history.

## Verification

```powershell
python -m pytest -q
python -m py_compile config.py run_saved_campaign.py csv_campaign_worker.py gmail_send_gate.py gmail_service.py db_client.py sender_engine.py reply_poller.py validator.py
```

Run only one Gmail worker per campaign. Do not run the Gmail and SMTP workers
against the same campaign recipients.
