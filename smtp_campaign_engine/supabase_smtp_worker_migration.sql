-- Add the campaign-local manual-removal state used by smtp_campaign_engine.
-- Run once in the Supabase SQL editor after the existing campaign schema.

alter table public.campaign_leads
    drop constraint if exists campaign_leads_status_check;

alter table public.campaign_leads
    add constraint campaign_leads_status_check
    check (status in ('pending', 'sent', 'replied', 'bounced', 'unsubscribed', 'skipped'));

notify pgrst, 'reload schema';
