-- Territories: a per-organisation, two-level geography.
--
-- A main territory is normally a city, town or region; a sub-territory divides
-- one up ("Gaborone" → "Gaborone North"). Nothing here is hardcoded — every
-- name belongs to one organisation and is invisible to the others, because the
-- next customer's estate is a different set of towns entirely.
--
-- This replaces `stores.territory`, a free-text column that was dropped from
-- the UI on 27 July because nobody filled it in. It is filled on 0 of 209 rows,
-- so it is removed here rather than left to be confused with the real thing.

create table public.territories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Null means this is a main territory. A sub-territory points at its main.
  parent_id uuid references public.territories(id) on delete restrict,
  name text not null,
  -- Deactivating keeps the history a store or a route already refers to;
  -- deleting is for genuine mistakes and is guarded separately.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.territories is
  'Two-level sales geography, scoped to one organisation. parent_id null = main territory.';

-- Names are unique within their level, case-insensitively: "Gaborone North"
-- and "gaborone north" in the same parent are the same place typed twice.
create unique index territories_main_name_idx
  on public.territories (org_id, lower(name))
  where parent_id is null;

create unique index territories_sub_name_idx
  on public.territories (parent_id, lower(name))
  where parent_id is not null;

create index territories_org_parent_idx on public.territories (org_id, parent_id);

/**
 * Keeps the tree two deep and inside one organisation.
 *
 * A check constraint cannot see another row, so this has to be a trigger. Both
 * rules matter: a sub-territory of a sub-territory would break every "main →
 * subs" query in the app, and a parent in another organisation would be a hole
 * straight through tenancy.
 */
create or replace function public.territories_enforce_shape()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent public.territories;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A territory cannot be its own parent.';
  end if;

  select * into v_parent from public.territories where id = new.parent_id;

  if v_parent is null then
    raise exception 'That parent territory does not exist.';
  end if;
  if v_parent.org_id <> new.org_id then
    raise exception 'A sub-territory must belong to the same organisation as its main territory.';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'Territories are two levels deep: % is already a sub-territory.', v_parent.name;
  end if;

  return new;
end;
$$;

create trigger territories_shape
before insert or update on public.territories
for each row execute function public.territories_enforce_shape();

-- Which reps cover which territory. A rep may cover several, and a territory
-- may be shared — the same arrangement store_assignments already allows.
create table public.territory_reps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (territory_id, rep_id)
);

comment on table public.territory_reps is
  'Which reps cover which territory or sub-territory.';

create index territory_reps_rep_idx on public.territory_reps (rep_id);

-- A store sits in a main territory and, optionally, one of its sub-territories.
--
-- ON DELETE RESTRICT rather than SET NULL: silently unassigning every store in
-- a territory is exactly the outcome the brief asks to be warned about, so the
-- database refuses and the UI has to say what will happen first.
alter table public.stores
  add column territory_id uuid references public.territories(id) on delete restrict,
  add column sub_territory_id uuid references public.territories(id) on delete restrict;

create index stores_territory_idx on public.stores (territory_id);
create index stores_sub_territory_idx on public.stores (sub_territory_id);

/**
 * A store's two territory columns have to agree with each other.
 *
 * Storing both is deliberate — every filter and report reads "main" far more
 * often than it walks up a parent chain — but two columns can disagree, so the
 * relationship between them is enforced here rather than trusted.
 */
create or replace function public.stores_enforce_territory()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_main public.territories;
  v_sub public.territories;
begin
  if new.territory_id is null and new.sub_territory_id is null then
    return new;
  end if;

  if new.territory_id is null and new.sub_territory_id is not null then
    raise exception 'A store in a sub-territory must also carry its main territory.';
  end if;

  select * into v_main from public.territories where id = new.territory_id;
  if v_main is null then
    raise exception 'That territory does not exist.';
  end if;
  if v_main.org_id <> new.org_id then
    raise exception 'A store can only belong to its own organisation''s territories.';
  end if;
  if v_main.parent_id is not null then
    raise exception '% is a sub-territory, not a main territory.', v_main.name;
  end if;

  if new.sub_territory_id is not null then
    select * into v_sub from public.territories where id = new.sub_territory_id;
    if v_sub is null then
      raise exception 'That sub-territory does not exist.';
    end if;
    if v_sub.parent_id is distinct from new.territory_id then
      raise exception '% is not inside %.', v_sub.name, v_main.name;
    end if;
  end if;

  return new;
end;
$$;

create trigger stores_territory_shape
before insert or update of territory_id, sub_territory_id, org_id on public.stores
for each row execute function public.stores_enforce_territory();

-- ------------------------------------------------------------------ RLS

alter table public.territories enable row level security;
alter table public.territory_reps enable row level security;

-- Everyone in the organisation reads the territory list: a rep's schedule and
-- store list are described in terms of it. Only a manager changes it.
create policy territories_select on public.territories
  for select using (org_id = (select public.current_org_id()));

create policy territories_insert on public.territories
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

create policy territories_update on public.territories
  for update using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

create policy territories_delete on public.territories
  for delete using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

-- A rep sees their own coverage; a manager sees the whole team's. Mirrors
-- store_assignments, which answers the same question about stores.
create policy territory_reps_select on public.territory_reps
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'manager'
      or rep_id = (select auth.uid())
    )
  );

create policy territory_reps_insert on public.territory_reps
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

create policy territory_reps_delete on public.territory_reps
  for delete using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

-- ------------------------------------------------------- seed from the estate

-- Every organisation's own towns become its main territories, and its stores
-- are placed in them. Derived from data rather than from a list of names, so
-- this is correct for the next customer's estate too. Organisations with no
-- stores get nothing.
insert into public.territories (org_id, name)
select distinct s.org_id, btrim(s.city)
from public.stores s
where s.city is not null and btrim(s.city) <> ''
on conflict do nothing;

update public.stores s
set territory_id = t.id
from public.territories t
where t.org_id = s.org_id
  and t.parent_id is null
  and lower(t.name) = lower(btrim(s.city))
  and s.city is not null
  and s.territory_id is null;

-- The free-text column this replaces. Confirmed empty before dropping.
alter table public.stores drop column territory;
