-- Where a route came from, so re-generating can clean up after itself.
--
-- Until now generate_routes only ever added (`on conflict do nothing`). Change
-- a store's day and the old dated routes stayed behind: after one re-plan, 139
-- of 204 future routes no longer matched the cycle, and reps would still have
-- seen every one of them. That is worse under hand-built schedules than
-- automatic ones, because the manager changes days one at a time.
--
-- Cleanup has to distinguish the generator's own output from a stop somebody
-- added deliberately, or "Add stop" on the day board would be undone by the
-- next generate. Existing rows are marked 'cycle' because they came from the
-- generator; only the day-board dialog writes 'manual'.
alter table public.routes
  add column if not exists source text not null default 'cycle';

alter table public.routes drop constraint if exists routes_source_check;
alter table public.routes add constraint routes_source_check
  check (source in ('cycle', 'manual'));

comment on column public.routes.source is
  'cycle = written by generate_routes and safe for it to retract; manual = added by hand, never touched.';

-- Return type changes, so this cannot be a CREATE OR REPLACE.
drop function if exists public.generate_routes(int, boolean);

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
  ordered as (
    select m.*,
           row_number() over (
             partition by m.rep_id, m.day
             order by coalesce(m.city, ''), m.name
           )::int as seq
    from matched m
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
  'Materialises routes from the call cycle and retracts future cycle-built routes it no longer calls for. Never touches the past, checked-in visits, or manual stops.';
