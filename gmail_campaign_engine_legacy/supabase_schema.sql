-- Local Email Campaign Engine schema
-- Run this entire file once in the Supabase Dashboard SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.leads (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    first_name text,
    last_name text,
    company text,
    validation_status text not null default 'unvalidated'
        constraint leads_validation_status_check
        check (validation_status in ('unvalidated', 'valid', 'invalid', 'disposable')),
    status text not null default 'pending'
        constraint leads_status_check
        check (status in ('pending', 'sent', 'replied', 'bounced', 'unsubscribed')),
    created_at timestamptz not null default now()
);

-- Email matching in the Python poller is case-insensitive. This index also
-- prevents duplicates such as Person@example.com and person@example.com.
create unique index if not exists leads_email_lower_unique
    on public.leads (lower(email));

create index if not exists leads_send_queue_idx
    on public.leads (validation_status, status, created_at);

create table if not exists public.campaigns (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    subject_template text not null,
    body_template text not null,
    initial_send_at timestamptz,
    timezone text not null default 'UTC',
    status text not null default 'draft'
        constraint campaigns_status_check
        check (status in ('draft', 'staged', 'running', 'paused', 'completed')),
    created_at timestamptz not null default now()
);

create index if not exists campaigns_status_idx
    on public.campaigns (status);

create table if not exists public.campaign_steps (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null
        references public.campaigns(id) on delete cascade,
    step_number integer not null check (step_number > 0),
    delay_days integer not null check (delay_days > 0),
    body_template text not null,
    created_at timestamptz not null default now(),
    unique (campaign_id, step_number),
    unique (campaign_id, delay_days)
);

create index if not exists campaign_steps_sequence_idx
    on public.campaign_steps (campaign_id, step_number);

create table if not exists public.campaign_leads (
    campaign_id uuid not null
        references public.campaigns(id) on delete cascade,
    lead_id uuid not null
        references public.leads(id) on delete cascade,
    status text not null default 'pending'
        constraint campaign_leads_status_check
        check (status in ('pending', 'sent', 'replied', 'bounced', 'unsubscribed')),
    first_sent_at timestamptz,
    next_send_at timestamptz,
    current_step integer not null default 0 check (current_step >= 0),
    gmail_thread_id text,
    last_gmail_message_id text,
    last_rfc_message_id text,
    created_at timestamptz not null default now(),
    primary key (campaign_id, lead_id)
);

create index if not exists campaign_leads_queue_idx
    on public.campaign_leads (campaign_id, status, created_at);

create index if not exists campaign_leads_lead_idx
    on public.campaign_leads (lead_id, status);

create index if not exists campaign_leads_followup_queue_idx
    on public.campaign_leads (status, next_send_at)
    where next_send_at is not null;

create table if not exists public.campaign_logs (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null
        references public.campaigns(id) on delete cascade,
    lead_id uuid not null
        references public.leads(id) on delete cascade,
    gmail_thread_id text,
    gmail_message_id text,
    rfc_message_id text,
    step_number integer not null default 0 check (step_number >= 0),
    sent_at timestamptz not null default now(),
    status text not null
        constraint campaign_logs_status_check
        check (status in ('sent', 'failed'))
);

create index if not exists campaign_logs_campaign_idx
    on public.campaign_logs (campaign_id, sent_at desc);

create index if not exists campaign_logs_lead_idx
    on public.campaign_logs (lead_id, sent_at desc);

create index if not exists campaign_logs_daily_limit_idx
    on public.campaign_logs (status, sent_at desc);

-- Keep browser clients locked down by default. The local engine uses the
-- server-side secret/service-role key and therefore bypasses RLS.
alter table public.leads enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_steps enable row level security;
alter table public.campaign_leads enable row level security;
alter table public.campaign_logs enable row level security;

revoke all on table public.leads from anon;
revoke all on table public.campaigns from anon;
revoke all on table public.campaign_steps from anon;
revoke all on table public.campaign_leads from anon;
revoke all on table public.campaign_logs from anon;

grant select, insert, update, delete on table public.leads to authenticated;
grant select, insert, update, delete on table public.campaigns to authenticated;
grant select, insert, update, delete on table public.campaign_steps to authenticated;
grant select, insert, update, delete on table public.campaign_leads to authenticated;
grant select, insert, update, delete on table public.campaign_logs to authenticated;

grant all on table public.leads to service_role;
grant all on table public.campaigns to service_role;
grant all on table public.campaign_steps to service_role;
grant all on table public.campaign_leads to service_role;
grant all on table public.campaign_logs to service_role;

-- Ask the Data API to refresh immediately after the new objects are created.
notify pgrst, 'reload schema';
