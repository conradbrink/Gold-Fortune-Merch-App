-- Rep directory for the Representatives page. One call rather than a query per
-- rep: with 11 reps the N+1 version would fire 34 requests from the browser.
create or replace function public.rep_directory()
returns table (
  rep_id          uuid,
  rep_name        text,
  email           text,
  assigned_stores bigint,
  primary_stores  bigint,
  last_active_at  timestamptz,
  visits_30d      bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org, now() - interval '30 days' as since
  ),
  a as (
    select sa.rep_id,
           count(*) as assigned_stores,
           count(*) filter (where sa.is_primary) as primary_stores
    from store_assignments sa
    cross join cfg
    where sa.org_id = cfg.org
    group by sa.rep_id
  ),
  v as (
    select vi.rep_id,
           max(vi.checkin_at) as last_active_at,
           count(*) filter (where vi.checkin_at >= cfg.since
                              and vi.status = 'checked_out') as visits_30d
    from visits vi
    cross join cfg
    where vi.org_id = cfg.org and vi.checkin_at is not null
    group by vi.rep_id
  )
  select p.id, p.full_name, p.email,
         coalesce(a.assigned_stores, 0),
         coalesce(a.primary_stores, 0),
         v.last_active_at,
         coalesce(v.visits_30d, 0)
  from profiles p
  cross join cfg
  left join a on a.rep_id = p.id
  left join v on v.rep_id = p.id
  where p.org_id = cfg.org
    and p.role = 'rep'
  order by p.full_name;
$$;
