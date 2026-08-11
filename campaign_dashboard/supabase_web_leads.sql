-- Relay web lead discovery extension
-- Run once in the same Supabase project's SQL Editor.

create table if not exists public.lead_searches (
    id uuid primary key default gen_random_uuid(),
    query text not null,
    location text,
    provider text not null default 'tavily',
    result_count integer not null default 0,
    created_at timestamptz not null default now()
);

create table if not exists public.web_prospects (
    id uuid primary key default gen_random_uuid(),
    website text not null unique,
    company_name text not null,
    description text,
    location text,
    public_emails jsonb not null default '[]'::jsonb,
    public_phones jsonb not null default '[]'::jsonb,
    linkedin_url text,
    source_url text,
    website_status text not null default 'unknown',
    website_status_code integer not null default 0,
    website_secure boolean not null default false,
    last_search_id uuid references public.lead_searches(id) on delete set null,
    last_checked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.lead_provider_usage (
    id uuid primary key default gen_random_uuid(),
    provider text not null,
    operation text not null,
    units integer not null default 1 check (units > 0),
    success boolean not null default true,
    called_at timestamptz not null default now()
);

create table if not exists public.company_research (
    id uuid primary key default gen_random_uuid(),
    website text not null unique,
    company_name text not null,
    summary text,
    industry text,
    services jsonb not null default '[]'::jsonb,
    target_customers jsonb not null default '[]'::jsonb,
    locations jsonb not null default '[]'::jsonb,
    people jsonb not null default '[]'::jsonb,
    public_emails jsonb not null default '[]'::jsonb,
    public_phones jsonb not null default '[]'::jsonb,
    linkedin_url text,
    outreach_angle text,
    qualification_score integer not null default 0
        check (qualification_score between 0 and 100),
    qualification_reason text,
    sources jsonb not null default '[]'::jsonb,
    ai_provider text not null default 'rules-only',
    ai_model text,
    researched_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.contact_candidates (
    id uuid primary key default gen_random_uuid(),
    website text not null,
    company_name text not null,
    person_name text not null,
    first_name text,
    last_name text,
    role text,
    person_source_url text not null,
    email text not null,
    origin text not null default 'inferred',
    verification_status text not null default 'unknown',
    confidence integer not null default 0 check (confidence between 0 and 100),
    verification_provider text not null default 'local',
    verification_reason text,
    mx_found boolean not null default false,
    catch_all boolean not null default false,
    disposable boolean not null default false,
    role_address boolean not null default false,
    evidence_urls jsonb not null default '[]'::jsonb,
    verification_details jsonb not null default '{}'::jsonb,
    campaign_eligible boolean not null default false,
    approved boolean not null default false,
    approved_at timestamptz,
    lead_id uuid references public.leads(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (website, person_name, email)
);

create table if not exists public.email_domain_intelligence (
    id uuid primary key default gen_random_uuid(),
    domain text not null unique,
    mx_found boolean,
    mx_records jsonb not null default '[]'::jsonb,
    observed_emails jsonb not null default '[]'::jsonb,
    email_pattern text,
    pattern_confidence integer not null default 0
        check (pattern_confidence between 0 and 100),
    evidence_urls jsonb not null default '[]'::jsonb,
    checked_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '7 days'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.email_verification_cache (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    status text not null default 'unknown',
    score integer not null default 0 check (score between 0 and 100),
    provider text not null,
    reason text,
    catch_all boolean not null default false,
    disposable boolean not null default false,
    role_address boolean not null default false,
    details jsonb not null default '{}'::jsonb,
    verified_at timestamptz not null default now(),
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.lead_import_batches (
    id uuid primary key default gen_random_uuid(),
    source_file text not null,
    total_rows integer not null default 0,
    imported_rows integer not null default 0,
    created_at timestamptz not null default now()
);

create table if not exists public.imported_prospects (
    id uuid primary key default gen_random_uuid(),
    import_batch_id uuid references public.lead_import_batches(id) on delete set null,
    company_name text not null,
    company_website text not null,
    company_linkedin text,
    location text,
    industry_services text,
    employee_size text,
    contact_name text not null,
    job_title text,
    contact_linkedin text,
    business_email text,
    email_status text not null default 'Missing',
    why_this_lead_fits text,
    lead_tier text,
    outreach_status text not null default 'Research',
    last_contacted date,
    next_step text,
    next_step_date date,
    notes text,
    assigned_to text,
    source_file text not null default 'uploaded-spreadsheet.csv',
    source_row integer,
    find_email_status text not null default 'pending',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (company_website, contact_name)
);

create index if not exists lead_searches_created_at_idx
    on public.lead_searches (created_at desc);
create index if not exists web_prospects_company_idx
    on public.web_prospects (company_name);
create index if not exists web_prospects_status_idx
    on public.web_prospects (website_status, last_checked_at desc);
create index if not exists lead_provider_usage_quota_idx
    on public.lead_provider_usage (provider, success, called_at desc);
create index if not exists company_research_score_idx
    on public.company_research (qualification_score desc, researched_at desc);
create index if not exists company_research_company_idx
    on public.company_research (company_name);
create index if not exists contact_candidates_person_idx
    on public.contact_candidates (company_name, person_name);
create index if not exists contact_candidates_approval_idx
    on public.contact_candidates (campaign_eligible, approved, created_at desc);
create index if not exists email_domain_intelligence_expiry_idx
    on public.email_domain_intelligence (expires_at);
create index if not exists email_verification_cache_expiry_idx
    on public.email_verification_cache (expires_at);
create index if not exists imported_prospects_email_queue_idx
    on public.imported_prospects (find_email_status, created_at desc);
create index if not exists imported_prospects_company_idx
    on public.imported_prospects (company_name, contact_name);

alter table public.lead_searches enable row level security;
alter table public.web_prospects enable row level security;
alter table public.lead_provider_usage enable row level security;
alter table public.company_research enable row level security;
alter table public.contact_candidates enable row level security;
alter table public.email_domain_intelligence enable row level security;
alter table public.email_verification_cache enable row level security;
alter table public.lead_import_batches enable row level security;
alter table public.imported_prospects enable row level security;
revoke all on table public.lead_searches from anon;
revoke all on table public.web_prospects from anon;
revoke all on table public.lead_provider_usage from anon;
revoke all on table public.company_research from anon;
revoke all on table public.contact_candidates from anon;
revoke all on table public.email_domain_intelligence from anon;
revoke all on table public.email_verification_cache from anon;
revoke all on table public.lead_import_batches from anon;
revoke all on table public.imported_prospects from anon;
grant select, insert, update, delete on table public.lead_searches to authenticated;
grant select, insert, update, delete on table public.web_prospects to authenticated;
grant select, insert on table public.lead_provider_usage to authenticated;
grant select, insert, update, delete on table public.company_research to authenticated;
grant select, insert, update, delete on table public.contact_candidates to authenticated;
grant select, insert, update, delete on table public.email_domain_intelligence to authenticated;
grant select, insert, update, delete on table public.email_verification_cache to authenticated;
grant select, insert, update, delete on table public.lead_import_batches to authenticated;
grant select, insert, update, delete on table public.imported_prospects to authenticated;
grant all on table public.lead_searches to service_role;
grant all on table public.web_prospects to service_role;
grant all on table public.lead_provider_usage to service_role;
grant all on table public.company_research to service_role;
grant all on table public.contact_candidates to service_role;
grant all on table public.email_domain_intelligence to service_role;
grant all on table public.email_verification_cache to service_role;
grant all on table public.lead_import_batches to service_role;
grant all on table public.imported_prospects to service_role;

notify pgrst, 'reload schema';
