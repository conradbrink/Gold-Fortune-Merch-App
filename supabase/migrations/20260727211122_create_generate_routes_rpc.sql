-- Materialises dated `routes` rows from the call cycle.
--
-- Safe to run repeatedly: `on conflict do nothing` against
-- routes_rep_store_date_key makes it idempotent, and it never looks at a date
-- before tomorrow, so nothing already visited or in progress can be disturbed.
--
-- Creates routes ONLY, never `visits`. The schedule dialog eagerly inserts a
-- companion visit row and that is exactly what produced the fan-out bug fixed in
-- 20260727194019 — a visit belongs to a check-in, not to a plan.
create or replace function public.generate_routes(
  p_weeks   int  default 8,
  p_dry_run boolean default false
)
returns table (
  created      bigint,
  first_date   date,
  last_date    date,
  reps_covered bigint
)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_org   uuid;
  v_role  text;
  v_from  date;
  v_to    date;
begin
  v_org := public.current_org_id();
  -- Quoted: current_role shadows a reserved Postgres keyword, and unquoted it
  -- silently returns the database role name instead of the profile role.
  v_role := public."current_role"();

  if v_org is null then
    raise exception 'No organisation for the current user';
  end if;
  -- The routes insert policy is manager-only. An RPC has to enforce that
  -- itself rather than assume the caller already passed a check.
  if v_role is distinct from 'manager' then
    raise exception 'Only managers can generate schedules';
  end if;

  if p_weeks < 1 or p_weeks > 52 then
    raise exception 'p_weeks must be between 1 and 52';
  end if;

  -- Start tomorrow: today may already be part-worked, and back-filling the past
  -- would invent plans that were never made.
  v_from := current_date + 1;
  v_to   := current_date + (p_weeks * 7);

  return query
  with cfg as materialized (
    select v_org as org
  ),
  cycle as (
    select sa.rep_id, sa.store_id, sa.day_of_week,
           coalesce(sa.week_of_cycle, 1) as week_of_cycle,
           s.visit_frequency,
           s.city, s.name
    from store_assignments sa
    join stores s on s.id = sa.store_id
    cross join cfg
    where sa.org_id = cfg.org
      and s.active
      and sa.day_of_week is not null
  ),
  days as (
    select d::date as day
    from generate_series(v_from, v_to, interval '1 day') d
  ),
  matched as (
    select c.rep_id, c.store_id, d.day, c.city, c.name
    from cycle c
    join days d
      on extract(isodow from d.day)::int = c.day_of_week
     and case c.visit_frequency
           when 'weekly' then true
           -- Week A / week B by ISO week parity: cycle 1 = odd weeks.
           when 'biweekly' then
             (extract(week from d.day)::int % 2) = (c.week_of_cycle % 2)
           -- nth occurrence of that weekday within the month: days 1-7 are the
           -- 1st, 8-14 the 2nd, and so on.
           when 'monthly' then
             ((extract(day from d.day)::int - 1) / 7) + 1 = c.week_of_cycle
           else false
         end
  ),
  ordered as (
    select m.*,
           -- Sequenced by city then name so a day's stops group geographically.
           -- Mobile does not read sequence_order yet, but populating it now means
           -- the eventual Dart change needs no data migration.
           row_number() over (
             partition by m.rep_id, m.day
             order by coalesce(m.city, ''), m.name
           )::int as seq
    from matched m
  ),
  ins as (
    insert into routes (org_id, rep_id, store_id, scheduled_date, sequence_order, created_by)
    select v_org, o.rep_id, o.store_id, o.day, o.seq, auth.uid()
    from ordered o
    where not p_dry_run
    on conflict (rep_id, store_id, scheduled_date) do nothing
    returning scheduled_date, rep_id
  ),
  result as (
    select * from ins
    union all
    -- Dry run: report what WOULD be created, minus anything already scheduled.
    select o.day, o.rep_id
    from ordered o
    where p_dry_run
      and not exists (
        select 1 from routes r
        where r.rep_id = o.rep_id and r.store_id = o.store_id
          and r.scheduled_date = o.day
      )
  )
  select count(*)::bigint,
         min(result.scheduled_date),
         max(result.scheduled_date),
         count(distinct result.rep_id)::bigint
  from result;
end;
$$;
