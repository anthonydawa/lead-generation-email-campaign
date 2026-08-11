# Relay Lead Generation and Email Campaign

This repository contains the active Relay campaign dashboard and the two local
email delivery options that are still supported.

## Projects

- `campaign_dashboard/` - the Next.js dashboard deployed to Vercel for lead
  research, campaign creation, templates, and recipient management.
- `smtp_campaign_engine/` - the current SMTP sender, including optional Lark
  IMAP reply checks before follow-ups.
- `gmail_campaign_engine_legacy/` - the preserved legacy Gmail API sender.

Each project has its own README and example environment file. Copy the relevant
`.env.example` file locally and keep real secrets out of source control.

## Start locally

For the dashboard:

```powershell
cd campaign_dashboard
npm install
npm run dev
```

For either Python sender:

```powershell
cd smtp_campaign_engine # or gmail_campaign_engine_legacy
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

See the project-specific README before starting a campaign worker.
