-- Allow Relay to stop one campaign recipient without deleting send history.
-- Safe to rerun after the base campaign assignment schema.

alter table public.campaign_leads
    drop constraint if exists campaign_leads_status_check;

alter table public.campaign_leads
    add constraint campaign_leads_status_check
    check (status in ('pending', 'sent', 'replied', 'bounced', 'unsubscribed', 'skipped'));

notify pgrst, 'reload schema';
