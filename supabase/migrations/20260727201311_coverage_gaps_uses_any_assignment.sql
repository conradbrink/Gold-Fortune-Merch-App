-- Assignment now means responsibility: if a store is assigned to a rep, that rep
-- is accountable for it. There is no separate "primary" concept in the UI any
-- more, so filtering the responsible rep on is_primary would leave every store
-- assigned after this change reading as Unassigned in the coverage report.
--
-- is_primary stays on the table (and keeps its partial unique index) rather than
-- being dropped — no code writes it now, and removing a column is not worth the
-- migration risk while the flag is harmless.
--
-- Return type changes, so drop rather than replace.
drop function if exists public.coverage_gaps(timestamptz, timestamptz);

create function public.coverage_gaps(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  store_id         uuid,
  store_name       text,
  store_group      text,
  city             text,
  state            text,
  last_visit_at    timestamptz,
  days_since       numeric,
  visits_in_period bigint,
  assigned_reps    text,
  assigned_count   bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  sc as (
    select s.id, s.name, s.city, s.state, g.name as grp
    from stores s
    left join store_groups g on g.id = s.store_group_id
    cross join cfg
    where s.org_id = cfg.org and s.active
  ),
  -- Deliberately over all history, not the filtered range: "last visited"
  -- means last visited, not last visited inside the window you happen to
  -- be looking at.
  lv as (
    select v.store_id, max(v.checkin_at) as last_visit_at
    from visits v cross join cfg
    where v.org_id = cfg.org and v.checkin_at is not null
    group by 1
  ),
  inper as (
    select v.store_id, count(*) as n
    from visits v cross join cfg
    where v.org_id = cfg.org
      and v.checkin_at >= p_from and v.checkin_at < p_to
      and v.status = 'checked_out'
    group by 1
  ),
  owners as (
    select a.store_id,
           string_agg(p.full_name, ', ' order by p.full_name) as names,
           count(*) as n
    from store_assignments a
    left join profiles p on p.id = a.rep_id
    cross join cfg
    where a.org_id = cfg.org
    group by a.store_id
  )
  select sc.id, sc.name, sc.grp, sc.city, sc.state,
         lv.last_visit_at,
         case when lv.last_visit_at is not null
              then round((extract(epoch from (p_to - lv.last_visit_at)) / 86400.0)::numeric, 1)
         end,
         coalesce(inper.n, 0),
         owners.names,
         coalesce(owners.n, 0)
  from sc
  left join lv     on lv.store_id     = sc.id
  left join inper  on inper.store_id  = sc.id
  left join owners on owners.store_id = sc.id
  order by lv.last_visit_at asc nulls first, sc.name;
$$;
