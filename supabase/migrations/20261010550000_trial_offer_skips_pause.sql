-- The day-45 offer skips the holiday pause (owner, 10 Oct 2026: "move it to 7
-- January"). The Founding free days stop on 15 December and run again on 5
-- January (22 days of holiday, counted as the 21 days from the 15th to the
-- 5th), so a company's 45 days no longer run through them: counted from 2
-- November, the offer is due on 7 January instead of 17 December.
--
-- `trial_pause_from` and `trial_pause_to` are platform settings (dates): the
-- clock stops on the first and runs again on the second. Clear either, or give
-- one that is not a date, and there is no pause. A company that starts inside
-- the pause counts from the day it ends.
--
-- Rollback: supabase/rollback/20261010550000_trial_offer_skips_pause.down.sql.

insert into public.platform_settings (key, value, description) values
  ('trial_pause_from', '"2026-12-15"', 'The day the free days'' clock stops for the holidays. The day-45 offer does not count the days until trial_pause_to. Clear it for no pause.'),
  ('trial_pause_to', '"2027-01-05"', 'The day the free days'' clock runs again after the holidays.')
on conflict (key) do nothing;

-- Queues the offer to each company that is due it. Returns how many.
create or replace function public.queue_trial_offers()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raw text := (select value #>> '{}' from public.platform_settings where key = 'trial_offer_day');
  -- A setting that is not a whole number of days is 45, not an error that stops the daily job.
  v_day integer := case when v_raw ~ '^[0-9]{1,4}$' then v_raw::integer else 45 end;
  v_floor_raw text := (select value #>> '{}' from public.platform_settings where key = 'trial_offer_counts_from');
  v_floor date;
  v_pause_from_raw text := (select value #>> '{}' from public.platform_settings where key = 'trial_pause_from');
  v_pause_to_raw text := (select value #>> '{}' from public.platform_settings where key = 'trial_pause_to');
  v_pf date;
  v_pt date;
  a record;
  v_to record;
  v_msg uuid;
  v_status text;
  n integer := 0;
begin
  -- A date that is not a date is no date at all, not an error that stops the daily job.
  begin
    v_floor := v_floor_raw::date;
  exception when others then
    v_floor := null;
  end;
  -- The holiday pause: the days from v_pf until the clock runs again on v_pt do not count. No pause if either date is missing or not a date.
  begin
    v_pf := v_pause_from_raw::date;
    v_pt := v_pause_to_raw::date;
  exception when others then
    v_pf := null;
    v_pt := null;
  end;
  for a in
    select o.id as org_id, ca.trial_ends_at, o.name, coalesce(nullif(btrim(o.timezone), ''), 'UTC') as tz
      from public.organizations o
      left join public.company_account ca on ca.org_id = o.id
      cross join lateral (select greatest(coalesce(ca.created_at, o.created_at),
                                          coalesce(v_floor::timestamptz, coalesce(ca.created_at, o.created_at))) as start_at) s
      cross join lateral (select s.start_at + make_interval(days => v_day) as plain_due) d
      -- With the pause in the way, the days it covers are added: the clock stops on v_pf and runs again on v_pt.
      cross join lateral (
        select case when v_pf is not null and v_pt is not null and v_pt > v_pf
                         and s.start_at::date < v_pt and d.plain_due::date > v_pf
                    then d.plain_due + make_interval(days => v_pt - greatest(v_pf, s.start_at::date))
                    else d.plain_due end as due_at) x
     where (ca.org_id is null or ca.status = 'trial')
       and x.due_at <= now()
       and (ca.trial_ends_at is null or ca.trial_ends_at > now())
       and not exists (select 1 from public.trial_offers t where t.org_id = o.id)
  loop
    -- One company's bad data (an odd address, say) must not stop everyone else's offer.
    begin
      -- The administrator who set the company up: the oldest active login holding
      -- the admin permission, with a real email (not a phone login).
      select lower(e.email) as email, p.full_name into v_to
        from public.profiles p
        left join auth.users u on u.id = p.id
        cross join lateral (select coalesce(nullif(btrim(p.email), ''), u.email) as email) e
       where p.org_id = a.org_id and p.is_active and e.email is not null
         and e.email !~* '@staff\.tickd\.co\.za$'
         and exists (select 1 from public.profile_permissions pp where pp.profile_id = p.id and pp.permission_code = 'admin')
       order by p.created_at, p.id
       limit 1;
      if v_to.email is null then
        continue;
      end if;
      insert into public.trial_offers (org_id, to_address) values (a.org_id, v_to.email) on conflict do nothing;
      if not found then
        continue;
      end if;
      v_msg := public.queue_email(
        a.org_id, v_to.email, v_to.full_name, 'trial_offer',
        jsonb_build_object(
          'first_name', split_part(btrim(coalesce(v_to.full_name, '')), ' ', 1),
          'company_name', a.name,
          'trial_ends_at', a.trial_ends_at,
          -- The company's own calendar days, so the date and the days left are the ones it sees.
          'trial_ends_on', case when a.trial_ends_at is null then null else (a.trial_ends_at at time zone a.tz)::date end,
          'days_left', case when a.trial_ends_at is null then null
                            else greatest(0, (a.trial_ends_at at time zone a.tz)::date - (now() at time zone a.tz)::date) end),
        'trial_offer', a.org_id);
      select m.status into v_status from public.message_outbox m where m.id = v_msg;
      if v_status = 'cancelled' then
        -- Held back (the owner has not confirmed their email, or the day's limit): not asked yet, so asked tomorrow.
        delete from public.trial_offers where org_id = a.org_id;
      else
        n := n + 1;
      end if;
    exception when others then
      raise warning 'trial offer for % was not queued: %', a.org_id, sqlerrm;
      delete from public.trial_offers where org_id = a.org_id;
    end;
  end loop;
  return n;
end;
$function$;
