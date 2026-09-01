-- generate_routes numbers around what is already on the day
--
-- `row_number()` restarted at 1 for every rep-day and ignored every row already
-- written there. A stop added by hand to a date the generator had not yet
-- reached took number 1, and the next run gave its own first cycle store the
-- same 1. `route_repository.dart` orders on `sequence_order` with no tiebreak,
-- so the two stops competed for one slot on the rep's phone.
--
-- #52 fixed the client half: `nextSequenceFor` reserves room for the cycle
-- stores the pattern is going to put on that date. That closes the common case
-- and leaves one window open — change the assignments *after* pinning a one-off
-- and *before* generating, and the number it reserved against is stale.
--
-- This closes it from the other side. The generator now starts after the
-- highest number already on that rep-day, so whatever the client reserved, and
-- whether or not it guessed right, the generator cannot land on it.
--
-- Consequences worth stating:
--
--   * Cycle stops sort after hand-added ones on a day that had any. That is a
--     sort order, not a priority — reps choose their own order, and "Shorten
--     the driving" renumbers the whole day across both sources anyway.
--   * Numbering can leave gaps and can exceed the number of stops on the day.
--     Nothing reads it as a count; it is an ordering key.
--   * Re-generating an unchanged day changes nothing: those rows already exist
--     and `on conflict do nothing` leaves their numbers alone.
--
-- Body is otherwise identical to 20260728184637 — only the `ordered` CTE and
-- the new `taken` CTE differ.

create or replace function public.generate_routes(
  p_weeks   int  default 8,
  p_dry_run boolean default false
)
returns table (
  created      bigint,
  removed      bigint,
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
           when 'biweekly' then
             (extract(week from d.day)::int % 2) = (c.week_of_cycle % 2)
           when 'monthly' then
             ((extract(day from d.day)::int - 1) / 7) + 1 = c.week_of_cycle
           else false
         end
  ),
  -- The highest stop number already written on each rep-day, whatever put it
  -- there. Manual rows are the reason this exists; see the header.
  taken as (
    select r.rep_id, r.scheduled_date as day, max(r.sequence_order) as max_seq
    from routes r
    cross join cfg
    where r.org_id = cfg.org
      and r.scheduled_date between v_from and v_to
    group by r.rep_id, r.scheduled_date
  ),
  ordered as (
    select m.*,
           (row_number() over (
             partition by m.rep_id, m.day
             order by coalesce(m.city, ''), m.name
           ) + coalesce(t.max_seq, 0))::int as seq
    from matched m
    left join taken t
      on t.rep_id = m.rep_id
     and t.day = m.day
  ),
  -- Future cycle-built routes the call cycle no longer calls for. Deliberately
  -- not limited to the horizon: a route stops being valid the moment the cycle
  -- changes, whenever it falls. Never touches the past, anything a rep has
  -- already checked into, or a hand-added stop.
  stale as (
    select r.id
    from routes r
    cross join cfg
    where r.org_id = cfg.org
      and r.scheduled_date > current_date
      and r.source = 'cycle'
      and not exists (select 1 from visits v where v.route_id = r.id)
      and not exists (
        select 1 from cycle c
        where c.rep_id = r.rep_id
          and c.store_id = r.store_id
          and c.day_of_week = extract(isodow from r.scheduled_date)::int
          and case c.visit_frequency
                when 'weekly' then true
                when 'biweekly' then
                  (extract(week from r.scheduled_date)::int % 2) = (c.week_of_cycle % 2)
                when 'monthly' then
                  ((extract(day from r.scheduled_date)::int - 1) / 7) + 1 = c.week_of_cycle
                else false
              end
      )
  ),
  del as (
    delete from routes
    where id in (select id from stale) and not p_dry_run
    returning 1 as gone
  ),
  ins as (
    insert into routes (org_id, rep_id, store_id, scheduled_date, sequence_order, created_by, source)
    select v_org, o.rep_id, o.store_id, o.day, o.seq, auth.uid(), 'cycle'
    from ordered o
    where not p_dry_run
    on conflict (rep_id, store_id, scheduled_date) do nothing
    returning scheduled_date, rep_id
  ),
  result as (
    select * from ins
    union all
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
         -- On a dry run nothing is deleted, so report what would go.
         case when p_dry_run
              then (select count(*)::bigint from stale)
              else (select count(*)::bigint from del)
         end,
         min(result.scheduled_date),
         max(result.scheduled_date),
         count(distinct result.rep_id)::bigint
  from result;
end;
$$;

comment on function public.generate_routes is
  'Materialises routes from the call cycle and retracts future cycle-built routes it no longer calls for. Numbers each rep-day after the highest sequence_order already on it, so a hand-added stop and a generated one can never share a number. Never touches the past, checked-in visits, or manual stops.';
