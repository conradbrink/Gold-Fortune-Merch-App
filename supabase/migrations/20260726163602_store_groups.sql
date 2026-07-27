create table public.store_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index store_groups_org_id_idx on public.store_groups(org_id);

alter table public.stores
  add column store_group_id uuid references public.store_groups(id) on delete set null;

create index stores_store_group_id_idx on public.stores(store_group_id);

alter table public.store_groups enable row level security;

create policy store_groups_select on public.store_groups
  for select using (org_id = (select public.current_org_id()));

create policy store_groups_insert on public.store_groups
  for insert with check (
    org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager'
  );

create policy store_groups_update on public.store_groups
  for update using (
    org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager'
  );

create policy store_groups_delete on public.store_groups
  for delete using (
    org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager'
  );
