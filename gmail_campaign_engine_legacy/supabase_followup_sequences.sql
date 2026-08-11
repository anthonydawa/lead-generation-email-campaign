-- Scheduled same-thread follow-up support.
-- Run this entire migration once in the Supabase SQL Editor.

alter table public.campaigns
    add column if not exists initial_send_at timestamptz,
    add column if not exists timezone text not null default 'UTC';

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

alter table public.campaign_leads
    add column if not exists first_sent_at timestamptz,
    add column if not exists next_send_at timestamptz,
    add column if not exists current_step integer not null default 0,
    add column if not exists gmail_thread_id text,
    add column if not exists last_gmail_message_id text,
    add column if not exists last_rfc_message_id text;

create index if not exists campaign_leads_followup_queue_idx
    on public.campaign_leads (status, next_send_at)
    where next_send_at is not null;

alter table public.campaign_logs
    add column if not exists gmail_message_id text,
    add column if not exists rfc_message_id text,
    add column if not exists step_number integer not null default 0;

-- Preserve the first-send/thread state of messages sent before this migration.
update public.campaign_leads as cl
set
    first_sent_at = history.first_sent_at,
    gmail_thread_id = history.gmail_thread_id
from (
    select distinct on (campaign_id, lead_id)
        campaign_id,
        lead_id,
        sent_at as first_sent_at,
        gmail_thread_id
    from public.campaign_logs
    where status = 'sent'
    order by campaign_id, lead_id, sent_at asc
) as history
where cl.campaign_id = history.campaign_id
  and cl.lead_id = history.lead_id
  and cl.first_sent_at is null;

alter table public.campaign_steps enable row level security;
revoke all on table public.campaign_steps from anon;
grant select, insert, update, delete
    on table public.campaign_steps to authenticated;
grant all on table public.campaign_steps to service_role;

notify pgrst, 'reload schema';
