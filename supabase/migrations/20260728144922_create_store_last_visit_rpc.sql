-- Last visit per store, for the Stores list.
--
-- One aggregate rather than pulling `visits` to the browser: that table grows
-- faster than any other here (~583 check-in/out events already) and the store
-- list would otherwise download all of it just to find a maximum per row.
--
-- `current_org_id()` is materialised into a CTE so the planner sees a literal
-- and uses visits_org_checkin_at_idx.
create or replace function public.store_last_visit()
returns table (
  store_id      uuid,
  last_visit_at timestamptz,
  visits_total  bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  )
  select v.store_id, max(v.checkin_at), count(*)::bigint
  from visits v
  cross join cfg
  where v.org_id = cfg.org
    and v.checkin_at is not null
  group by v.store_id;
$$;

comment on function public.store_last_visit is
  'Last check-in and total visits per store. Stores never visited simply have no row.';
