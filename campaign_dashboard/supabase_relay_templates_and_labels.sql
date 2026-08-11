-- Relay message templates and lead batch labels.
-- Run once in the Supabase SQL Editor before deploying this UI update.

create table if not exists public.message_templates (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    subject_template text not null,
    body_template text not null,
    followups jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.campaigns
    add column if not exists message_template_id uuid
    references public.message_templates(id) on delete set null;

alter table public.leads
    add column if not exists batch_label text;

alter table public.lead_import_batches
    add column if not exists label text;

alter table public.imported_prospects
    add column if not exists batch_label text;

create index if not exists campaigns_message_template_idx
    on public.campaigns (message_template_id);
create index if not exists leads_batch_label_idx
    on public.leads (batch_label);

alter table public.message_templates enable row level security;
revoke all on table public.message_templates from anon;
grant select, insert, update, delete on table public.message_templates to authenticated;
grant all on table public.message_templates to service_role;
