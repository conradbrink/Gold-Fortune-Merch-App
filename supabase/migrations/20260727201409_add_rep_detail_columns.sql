-- profiles carried only name/email/role, which is not enough to manage a field
-- team: a manager needs to phone a rep, and needs a way to retire someone who
-- has left.
--
-- Deactivating rather than deleting matters here — a rep's visits, photos and
-- form submissions reference their profile, so deleting would orphan history.
alter table public.profiles
  add column if not exists phone      text,
  add column if not exists job_title  text,
  add column if not exists is_active  boolean not null default true;

comment on column public.profiles.is_active is
  'Soft delete. Deactivated reps keep their visit history but should not be assigned new work.';

-- Extend the directory with the new fields plus when they joined.
drop function if exists public.rep_directory();

create function public.rep_directory()
returns table (
  rep_id          uuid,
  rep_name        text,
  email           text,
  phone           text,
  job_title       text,
  is_active       boolean,
  joined_at       timestamptz,
  assigned_stores bigint,
  store_names     text,
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
           string_agg(s.name, ', ' order by s.name) as store_names
    from store_assignments sa
    join stores s on s.id = sa.store_id
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
  select p.id, p.full_name, p.email, p.phone, p.job_title, p.is_active,
         p.created_at,
         coalesce(a.assigned_stores, 0),
         a.store_names,
         v.last_active_at,
         coalesce(v.visits_30d, 0)
  from profiles p
  cross join cfg
  left join a on a.rep_id = p.id
  left join v on v.rep_id = p.id
  where p.org_id = cfg.org
    and p.role = 'rep'
  -- Active reps first; a retired rep should not sit at the top of the list.
  order by p.is_active desc, p.full_name;
$$;
