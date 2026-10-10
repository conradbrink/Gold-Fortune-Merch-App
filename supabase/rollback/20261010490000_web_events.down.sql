-- Rollback of 20261010490000_web_events: drops the stats function and the
-- table with every website event it holds.
drop function if exists public.platform_web_stats(timestamptz, timestamptz, text, text, text);
drop table if exists public.web_events;
