-- The evening job report goes once a day per company. In 20261009160000 the
-- evening send took today's finished jobs not yet sent every 15 minutes after
-- the send time, so a job finished after it went in a second email that
-- night, and a job checked in before midnight and out after it was never sent
-- (it was not "today's") (CodeRabbit on #112).
--
-- Now each company's evening batch is recorded when it runs, and runs once a
-- day. It takes every finished job not yet sent from the last two days, by
-- when it finished: a job finished after tonight's email goes in tomorrow's,
-- and a job that crosses midnight is included. "immediate" is unchanged.
--
-- Rollback: supabase/rollback/20261009210000_job_reports_evening_batch.down.sql.

-- One row per company per day its evening batch ran. Internal: no one reads
-- it but the scheduled job.
create table public.job_report_evenings (
  org_id    uuid not null references public.organizations(id) on delete cascade,
  day       date not null,
  queued_at timestamptz not null default now(),
  primary key (org_id, day)
);

alter table public.job_report_evenings enable row level security;
revoke all on public.job_report_evenings from public, anon, authenticated;

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'job_report_evenings', 'core');

-- Every 15 minutes. "immediate": each finished job of the last two days not
-- yet sent, as it finishes. "evening": once a day, when the company's clock
-- passes the send time, every finished job of the last two days not yet sent,
-- one email per site. Companies that cannot write (read only) or send
-- manually are skipped.
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
  v_claimed integer;
  n integer := 0;
begin
  for o in select org.id from public.organizations org
            where not exists (select 1 from public.company_account a
                               where a.org_id = org.id and a.status in ('read_only', 'cancelled'))
  loop
    v_mode := coalesce(public.org_setting(o.id, 'job_report_send') #>> '{}', 'manual');
    continue when v_mode not in ('immediate', 'evening');
    if v_mode = 'evening' then
      v_tz := public.org_timezone(o.id);
      v_today := (now() at time zone v_tz)::date;
      v_time := coalesce((public.org_setting(o.id, 'job_report_send_time') #>> '{}')::time, time '18:00');
      continue when (now() at time zone v_tz)::time < v_time;
      -- Tonight's batch, claimed once: a later run the same day finds it taken.
      insert into public.job_report_evenings (org_id, day) values (o.id, v_today)
      on conflict do nothing;
      get diagnostics v_claimed = row_count;
      continue when v_claimed = 0;
    end if;
    for s in
      select v.store_id, array_agg(public.ensure_job_report(v.id) order by v.checkin_at) as ids
        from public.visits v
       where v.org_id = o.id and v.status = 'checked_out'
         and v.checkout_at > now() - interval '2 days'
         and not exists (select 1 from public.job_reports jr where jr.visit_id = v.id and jr.first_queued_at is not null)
         and exists (select 1 from public.site_contacts sc
                      where sc.store_id = v.store_id and sc.receives_reports and sc.email is not null)
       group by v.store_id
    loop
      n := n + public.queue_job_report_emails(o.id, s.store_id, s.ids,
                                              case when v_mode = 'immediate' then 'job_report' else 'job_reports_day' end);
    end loop;
  end loop;
  -- A month of batches is plenty to know tonight's has run.
  delete from public.job_report_evenings where day < current_date - 30;
  return n;
end;
$function$;

revoke all on function public.queue_job_reports() from public, anon, authenticated;
