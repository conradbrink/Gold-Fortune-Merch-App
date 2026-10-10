-- The Control Centre's "is Tickd healthy?" line.
--
-- Why: the owner's spec (sections 30 and 48) wants the main dashboard to say
-- "All systems operational" or name the problem. This reads what Tickd
-- already records about its own machinery:
--
--   scheduled jobs   pg_cron's history (cron.job_run_details): each job's
--                    schedule, last run and any failures in the last 24 hours
--   email            message_outbox: failed in the last 24 hours, and anything
--                    still waiting more than 30 minutes after it was due
--   website count    web_events in the last 24 hours, and the latest one
--
-- SECURITY DEFINER because cron's tables belong to the database owner; so it
-- is callable by the service role only (the server, after its own
-- is_platform_admin() check).
--
-- Rollback: supabase/rollback/20261010510000_platform_system_health.down.sql.

create or replace function public.platform_system_health()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'jobs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', j.jobname,
               'schedule', j.schedule,
               'active', j.active,
               'last_run', l.start_time,
               'last_status', l.status,
               'failed_24h', coalesce(f.n, 0),
               'last_error', f.last_error) order by j.jobname), '[]'::jsonb)
      from cron.job j
      left join lateral (
        select d.start_time, d.status from cron.job_run_details d
        where d.jobid = j.jobid order by d.start_time desc limit 1
      ) l on true
      left join lateral (
        select count(*) as n, (array_agg(left(d.return_message, 200) order by d.start_time desc))[1] as last_error
        from cron.job_run_details d
        where d.jobid = j.jobid and d.status = 'failed' and d.start_time > now() - interval '24 hours'
      ) f on true
    ),
    'emails_failed_24h', (
      select count(*) from public.message_outbox m
      where m.status = 'failed' and m.updated_at > now() - interval '24 hours'
    ),
    'emails_waiting', (
      select count(*) from public.message_outbox m
      where m.status in ('queued', 'sending') and m.send_after < now() - interval '30 minutes'
    ),
    'web_events_24h', (select count(*) from public.web_events w where w.at > now() - interval '24 hours'),
    'web_last_event', (select max(w.at) from public.web_events w)
  );
$function$;

revoke all on function public.platform_system_health() from public, anon, authenticated;
grant execute on function public.platform_system_health() to service_role;

comment on function public.platform_system_health() is
  'Control Centre: scheduled jobs (last run, failures in 24 h), failed and stuck emails, and the website count''s recent events. Service role only.';
