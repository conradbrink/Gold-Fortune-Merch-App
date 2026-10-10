-- The day-45 offer counts from the day the free days begin (owner, 10 Oct 2026:
-- "count from 2 November instead"). A Founding business is set up from 26
-- October but its 60 free days start on Monday 2 November, so a company made
-- before that day is counted from it. `trial_offer_counts_from` is that date, a
-- platform setting the owner can change or clear (a clear or invalid value
-- counts every company from its own start, as before). A company made on or
-- after the date counts from its own start.
--
-- Rollback: supabase/rollback/20261010530000_trial_offer_counts_from.down.sql.

insert into public.platform_settings (key, value, description)
values ('trial_offer_counts_from', '"2026-11-02"', 'The day the free days begin. A company made before it is counted from it for the day-45 offer. Clear it to count every company from its own start.')
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
  for a in
    select o.id as org_id, ca.trial_ends_at, o.name, coalesce(nullif(btrim(o.timezone), ''), 'UTC') as tz
      from public.organizations o
      left join public.company_account ca on ca.org_id = o.id
     where (ca.org_id is null or ca.status = 'trial')
       -- The days count from the company's start, but never from before the day the free days begin.
       and greatest(coalesce(ca.created_at, o.created_at), coalesce(v_floor::timestamptz, coalesce(ca.created_at, o.created_at)))
           <= now() - make_interval(days => v_day)
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
