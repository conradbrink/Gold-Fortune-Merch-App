-- Which reps cover which stores. Many-to-many so a store can have cover reps
-- (holiday, job-share), with at most one primary owner.
create table public.store_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  is_primary boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (store_id, rep_id)
);

-- At most one primary rep per store.
create unique index store_assignments_one_primary_idx
  on public.store_assignments (store_id) where is_primary;

-- "My stores" for a rep, and "who covers this store" for a manager.
create index store_assignments_org_rep_idx on public.store_assignments (org_id, rep_id);
create index store_assignments_store_idx on public.store_assignments (store_id);

alter table public.store_assignments enable row level security;

-- Mirrors routes_select: managers see the whole org, reps see their own.
create policy store_assignments_select on public.store_assignments
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );

create policy store_assignments_insert on public.store_assignments
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

create policy store_assignments_update on public.store_assignments
  for update using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

create policy store_assignments_delete on public.store_assignments
  for delete using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

-- The most common analytics filter is a date range over visits, and no time
-- column on visits was indexed.
create index visits_org_checkin_at_idx on public.visits (org_id, checkin_at desc);
