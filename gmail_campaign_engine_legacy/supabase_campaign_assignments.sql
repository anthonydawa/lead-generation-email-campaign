-- Campaign-specific recipient assignments
-- Run once after the original supabase_schema.sql.

create table if not exists public.campaign_leads (
    campaign_id uuid not null
        references public.campaigns(id) on delete cascade,
    lead_id uuid not null
        references public.leads(id) on delete cascade,
    status text not null default 'pending'
        constraint campaign_leads_status_check
        check (status in ('pending', 'sent', 'replied', 'bounced', 'unsubscribed', 'skipped')),
    created_at timestamptz not null default now(),
    primary key (campaign_id, lead_id)
);

create index if not exists campaign_leads_queue_idx
    on public.campaign_leads (campaign_id, status, created_at);

create index if not exists campaign_leads_lead_idx
    on public.campaign_leads (lead_id, status);

-- Preserve recipient history for campaigns already sent before this migration.
insert into public.campaign_leads (campaign_id, lead_id, status, created_at)
select
    campaign_id,
    lead_id,
    case
        when bool_or(status = 'sent') then 'sent'
        else 'pending'
    end,
    min(sent_at)
from public.campaign_logs
group by campaign_id, lead_id
on conflict (campaign_id, lead_id) do nothing;

alter table public.campaign_leads enable row level security;
revoke all on table public.campaign_leads from anon;
grant select, insert, update, delete
    on table public.campaign_leads to authenticated;
grant all on table public.campaign_leads to service_role;

notify pgrst, 'reload schema';
