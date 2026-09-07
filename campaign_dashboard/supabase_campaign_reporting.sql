-- Relay campaign reporting and local-worker health snapshots.
-- Safe to run more than once in the Supabase SQL editor.

create table if not exists public.campaign_worker_reports (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null references public.campaigns(id) on delete cascade,
    worker_kind text not null
        constraint campaign_worker_reports_kind_check
        check (worker_kind in ('gmail', 'lark_smtp')),
    worker_status text not null default 'running'
        constraint campaign_worker_reports_status_check
        check (worker_status in ('running', 'paused', 'completed', 'stopped', 'error')),
    sender_email text,
    report_date date not null,
    sent_today integer not null default 0 check (sent_today >= 0),
    bounced_today integer not null default 0 check (bounced_today >= 0),
    replied_today integer not null default 0 check (replied_today >= 0),
    errors_today integer not null default 0 check (errors_today >= 0),
    deliveries_total integer not null default 0 check (deliveries_total >= 0),
    recipients_total integer not null default 0 check (recipients_total >= 0),
    pending_total integer not null default 0 check (pending_total >= 0),
    scheduled_total integer not null default 0 check (scheduled_total >= 0),
    completed_total integer not null default 0 check (completed_total >= 0),
    replied_total integer not null default 0 check (replied_total >= 0),
    bounced_total integer not null default 0 check (bounced_total >= 0),
    skipped_total integer not null default 0 check (skipped_total >= 0),
    unsubscribed_total integer not null default 0 check (unsubscribed_total >= 0),
    uncertain_total integer not null default 0 check (uncertain_total >= 0),
    last_error text,
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (campaign_id, worker_kind, report_date)
);

create index if not exists campaign_worker_reports_campaign_seen_idx
    on public.campaign_worker_reports (campaign_id, last_seen_at desc);

alter table public.campaign_worker_reports enable row level security;

-- Relay's server routes and local workers use the service-role key. The table
-- is deliberately unavailable to browser roles.
revoke all on public.campaign_worker_reports from anon, authenticated;
grant select, insert, update on public.campaign_worker_reports to service_role;
