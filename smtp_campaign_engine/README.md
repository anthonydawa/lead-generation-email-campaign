# Direct Python Email Campaign Worker

This is the standalone sender for campaigns created in the Relay/Vercel app.
It reads a campaign UUID from the existing Supabase tables, then sends through
your outbound mail server using Python's standard SMTP. It has
no Gmail API, AWS SES, Brevo, SendGrid, Resend, or other delivery-app integration.

The worker is deliberately local and restart-safe. Each campaign has its own
background process, recipient snapshot, event audit log, PID, and rotating log.
It stays alive between sequence steps and exits only when every recipient is
completed, rejected, suppressed in the imported state, or manually skipped.

## What it supports

- Relay campaign UUID input and existing `campaigns`, `campaign_steps`,
  `campaign_leads`, `campaign_logs`, and `leads` tables
- one initial email with zero or more delayed follow-ups
- RFC `Message-ID`, `In-Reply-To`, and `References` headers so follow-ups remain
  in the same email thread
- plain-text and HTML message alternatives
- shared pacing and daily quota across concurrently running campaign workers
- restart recovery and an append-only CSV event audit
- terminal handling for permanent SMTP recipient rejections (for example, 550)
- safe manual recipient removal while the worker is running
- optional read-only reply check immediately before each follow-up
- campaign-local reply stops that do not suppress the lead globally
- Supabase progress projection for the Relay dashboard

"Sent" means the authenticated SMTP server accepted the message. Standard SMTP
does not expose opens, clicks, or guaranteed final delivery. When explicitly
enabled, the worker reads only Lark inbox headers immediately before a follow-up
to identify a reply to that campaign thread. It never deletes, moves, marks read,
or otherwise changes a message. A match stops only that recipient's current
campaign assignment; it does not add a permanent suppression or alter another
campaign.

The historical Supabase columns still contain names such as
`gmail_thread_id`. They are retained for compatibility with the current Relay
schema, but this worker stores ordinary RFC message IDs in them and does not use
Gmail.

## 1. Mailbox prerequisites

Use the outbound SMTP account intended for the campaign. If that is your Lark
mailbox, enable SMTP client access and create the required client/app password.
Copy the exact SMTP host and port shown by the provider into `.env`; the worker
uses no inbox access unless `CHECK_REPLIES_BEFORE_SEND=true` is enabled.

For campaign-local reply stopping, also enter the Lark IMAP host and credentials
and set `CHECK_REPLIES_BEFORE_SEND=true`. The checker selects `INBOX` read-only
and fetches only `From`, `In-Reply-To`, and `References` header information.

Your domain being registered at Hostinger does not make Hostinger the mail
server. Hostinger is where you manage DNS if its nameservers are authoritative;
the domain's MX, SPF, DKIM, and DMARC records must match the mailbox provider
that actually sends and receives the mail. Do not leave Hostinger Email MX/SPF
records active alongside Lark records.

Before campaigning, confirm:

- Lark's MX records receive mail for the domain
- Lark's sending servers are authorized by the domain's single SPF policy
- DKIM is enabled in Lark and the public key is present in Hostinger DNS
- DMARC is present and initially monitored with a suitable policy
- the configured From address is approved for the authenticating mailbox

Hostinger's DNS editor guidance is at
<https://support.hostinger.com/en/articles/1583249-how-to-manage-dns-records-at-hostinger>.

## 2. Install

```powershell
cd "C:\Users\antho\Documents\Lead Generation & Email Campaign\smtp_campaign_engine"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Fill in `.env` with the existing Relay Supabase URL/service-role key and the
outbound SMTP credentials. Secrets stay only on this computer.

Run `supabase_smtp_worker_migration.sql` once in the same Supabase project used
by Relay. It adds the campaign-local `skipped` assignment status used for manual
removal.

Verify authentication without sending a message:

```powershell
.\.venv\Scripts\python.exe test_smtp.py
```

When reply checking is enabled, verify read-only inbox access separately:

```powershell
.\.venv\Scripts\python.exe test_reply_access.py
```

## 3. Start a campaign

Create and stage the campaign in Relay, copy its campaign ID, then either run it
in the foreground:

```powershell
.\.venv\Scripts\python.exe run_saved_campaign.py --campaign-id <campaign-uuid>
```

or as a hidden background worker:

```powershell
.\start_campaign_worker.ps1 -CampaignId <campaign-uuid>
```

The worker imports the campaign exactly once. Later edits to the Relay campaign
body, recipients, or sequence do not mutate that in-flight local snapshot.
This prevents accidental mid-run changes.

## 4. Progress and control

The preferred control is **Manage recipients** in the Relay campaign dashboard.
Choose **Remove from campaign** beside the person. Before every initial email or
follow-up, an active worker reads that exact Supabase assignment and stops when
its status is `skipped`. If the final database check fails, the worker postpones
the send instead of delivering without confirmation. An SMTP submission that
was already accepted cannot be recalled.

List every local campaign worker and its pending/completed counts:

```powershell
.\list_campaign_workers.ps1
```

Show the detailed status counts for one campaign:

```powershell
.\.venv\Scripts\python.exe manage_campaign.py status --campaign-id <campaign-uuid>
```

Remove one recipient without stopping the live worker:

```powershell
.\remove_campaign_recipient.ps1 `
  -CampaignId <campaign-uuid> `
  -Email recipient@example.com `
  -Reason "Removed by campaign owner"
```

The command is queued atomically. The worker applies it before its next send
cycle, records `recipient_skipped` in `events.csv`, clears all future schedule
fields, and updates the Relay assignment to `skipped`. A message already
accepted by SMTP cannot be recalled.

Stop a worker while keeping all state for a later resume:

```powershell
.\stop_campaign_worker.ps1 -CampaignId <campaign-uuid>
```

Run the start command again to resume. Never run more than one worker for the
same campaign.

## State and recovery behavior

State is stored under `campaign_state/<campaign-uuid>/`. `recipients.csv` is
the local operational truth and `events.csv` is the audit trail. Supabase is
updated after successful SMTP acceptance so Relay can show campaign progress.

SMTP cannot provide a universal exactly-once transaction. Before submitting a
message, the worker persists a unique RFC Message-ID. If the process stops during
submission, an inbox reply check cannot determine whether SMTP accepted that
message. After ten minutes it marks the recipient `uncertain`, pauses the
campaign, and does not retry automatically. This prevents an accidental
duplicate without reading or changing the Sent folder.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m py_compile `
  config.py mail_service.py reply_checker.py csv_campaign_worker.py db_client.py `
  send_gate.py run_saved_campaign.py manage_campaign.py test_smtp.py `
  test_reply_access.py
```

Start with a very small internal campaign. Confirm receipt, the Sent copy,
thread grouping, SPF/DKIM/DMARC results, and the Relay progress
before increasing volume. Keep `DAILY_SEND_LIMIT` and the randomized delay at
values allowed by your mailbox plan.
