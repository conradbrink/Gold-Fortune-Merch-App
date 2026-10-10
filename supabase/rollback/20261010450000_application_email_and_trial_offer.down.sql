-- Rollback of 20261010450000_application_email_and_trial_offer: the daily offer
-- job, its record and setting, and the application's email out again. Emails
-- already queued stay in the outbox.

select cron.unschedule('trial-offers');
drop function if exists public.queue_trial_offers();
delete from public.module_assignments where kind = 'table' and name = 'trial_offers';
drop table if exists public.trial_offers;
delete from public.platform_settings where key = 'trial_offer_day';
alter table public.founding_applications drop column if exists email;
