-- Rollback of 20261009210000_job_reports_evening_batch: the evening send as
-- 20261009160000 made it (today's jobs, every run after the send time), and
-- the record of evening batches out again.

create or replace function public.queue_job_reports()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  o record;
  s record;
  v_mode text;
  v_tz text;
  v_time time;
  v_today date;
  n integer := 0;
begin
  for o in select org.id from public.organizations org
            where not exists (select 1 from public.company_account a
                               where a.org_id = org.id and a.status in ('read_only', 'cancelled'))
  loop
    v_mode := coalesce(public.org_setting(o.id, 'job_report_send') #>> '{}', 'manual');
    continue when v_mode not in ('immediate', 'evening');
    v_tz := public.org_timezone(o.id);
    v_today := (now() at time zone v_tz)::date;
    v_time := coalesce((public.org_setting(o.id, 'job_report_send_time') #>> '{}')::time, time '18:00');
    continue when v_mode = 'evening' and (now() at time zone v_tz)::time < v_time;
    for s in
      select v.store_id, array_agg(public.ensure_job_report(v.id) order by v.checkin_at) as ids
        from public.visits v
       where v.org_id = o.id and v.status = 'checked_out'
         and v.checkout_at > now() - interval '2 days'
         and (v_mode = 'immediate' or (v.checkin_at at time zone v_tz)::date = v_today)
         and not exists (select 1 from public.job_reports jr where jr.visit_id = v.id and jr.first_queued_at is not null)
         and exists (select 1 from public.site_contacts sc
                      where sc.store_id = v.store_id and sc.receives_reports and sc.email is not null)
       group by v.store_id
    loop
      n := n + public.queue_job_report_emails(o.id, s.store_id, s.ids,
                                              case when v_mode = 'immediate' then 'job_report' else 'job_reports_day' end);
    end loop;
  end loop;
  return n;
end;
$function$;

revoke all on function public.queue_job_reports() from public, anon, authenticated;

delete from public.module_assignments where kind = 'table' and name = 'job_report_evenings';
drop table if exists public.job_report_evenings;
