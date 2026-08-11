-- Relay lead-finder extension
-- Run once in the Supabase SQL Editor before enabling one-click prospect saves.

create table if not exists public.linkedin_prospects (
    id uuid primary key default gen_random_uuid(),
    source_member_id text not null unique,
    full_name text not null,
    first_name text,
    last_name text,
    headline text,
    job_title text,
    company text,
    industry text,
    location text,
    profile_url text,
    source text not null default 'linkedin'
        constraint linkedin_prospects_source_check check (source = 'linkedin'),
    raw_data jsonb,
    saved_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists linkedin_prospects_company_idx
    on public.linkedin_prospects (company);
create index if not exists linkedin_prospects_role_idx
    on public.linkedin_prospects (job_title);
create index if not exists linkedin_prospects_saved_at_idx
    on public.linkedin_prospects (saved_at desc);

create table if not exists public.linkedin_api_usage (
    id uuid primary key default gen_random_uuid(),
    endpoint text not null,
    status_code integer not null,
    called_at timestamptz not null default now()
);

create index if not exists linkedin_api_usage_day_idx
    on public.linkedin_api_usage (called_at desc);

alter table public.linkedin_prospects enable row level security;
alter table public.linkedin_api_usage enable row level security;
revoke all on table public.linkedin_prospects from anon;
revoke all on table public.linkedin_api_usage from anon;
grant select, insert, update, delete on table public.linkedin_prospects to authenticated;
grant select, insert on table public.linkedin_api_usage to authenticated;
grant all on table public.linkedin_prospects to service_role;
grant all on table public.linkedin_api_usage to service_role;

notify pgrst, 'reload schema';
