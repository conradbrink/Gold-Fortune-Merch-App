-- Shared documents: planograms, price lists, notices.
--
-- These currently reach reps over WhatsApp, where nobody can tell which copy is
-- current. The point of this table is not storage — it is deciding who may see
-- what, in one place that both the app and Supabase Storage obey.
create table if not exists public.files (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null,
  description  text,
  -- Matches storage.objects.name exactly. The storage policy joins on it, so a
  -- mismatch means an unreadable file rather than a leaked one.
  storage_path text not null unique,
  mime_type    text,
  size_bytes   bigint,
  audience     text not null default 'everyone',
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.files drop constraint if exists files_audience_check;
alter table public.files add constraint files_audience_check
  check (audience in ('everyone', 'reps', 'groups'));

-- Named reps, when audience = 'reps'.
create table if not exists public.file_reps (
  file_id uuid not null references public.files(id) on delete cascade,
  rep_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (file_id, rep_id)
);

-- Retail chains, when audience = 'groups'. Reps inherit access from the stores
-- they cover, so moving a store between reps moves the file access with it and
-- nobody has to remember to re-share a planogram.
create table if not exists public.file_groups (
  file_id        uuid not null references public.files(id) on delete cascade,
  store_group_id uuid not null references public.store_groups(id) on delete cascade,
  primary key (file_id, store_group_id)
);

create index if not exists files_org_created_idx on public.files (org_id, created_at desc);
create index if not exists file_reps_rep_idx on public.file_reps (rep_id);
create index if not exists file_groups_group_idx on public.file_groups (store_group_id);

alter table public.files enable row level security;
alter table public.file_reps enable row level security;
alter table public.file_groups enable row level security;

-- The single entitlement rule. Storage inherits it rather than restating it,
-- so there is no second copy to drift out of step.
--
-- Constrains the row under test instead of sub-selecting `files`, so there is
-- no policy recursion. auth.uid() is wrapped in a scalar subquery so the
-- planner evaluates it once per statement rather than per row.
drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public."current_role"()) = 'manager'
      or audience = 'everyone'
      or (audience = 'reps' and exists (
            select 1 from public.file_reps fr
            where fr.file_id = files.id and fr.rep_id = (select auth.uid())))
      or (audience = 'groups' and exists (
            select 1 from public.file_groups fg
            join public.stores s on s.store_group_id = fg.store_group_id
            join public.store_assignments sa on sa.store_id = s.id
            where fg.file_id = files.id and sa.rep_id = (select auth.uid())))
    )
  );

drop policy if exists files_insert on public.files;
create policy files_insert on public.files
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  );

drop policy if exists files_update on public.files;
create policy files_update on public.files
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  );

drop policy if exists files_delete on public.files;
create policy files_delete on public.files
  for delete using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) = 'manager'
  );

-- The join tables are readable to anyone who can read the parent file, and
-- writable only by managers. Reading them leaks nothing on its own: knowing a
-- file id is shared with a rep is meaningless without access to the file.
drop policy if exists file_reps_select on public.file_reps;
create policy file_reps_select on public.file_reps
  for select using (
    exists (select 1 from public.files f where f.id = file_reps.file_id)
  );

drop policy if exists file_reps_write on public.file_reps;
create policy file_reps_write on public.file_reps
  for all using (
    (select public."current_role"()) = 'manager'
    and exists (
      select 1 from public.files f
      where f.id = file_reps.file_id and f.org_id = (select public.current_org_id())
    )
  ) with check (
    (select public."current_role"()) = 'manager'
    and exists (
      select 1 from public.files f
      where f.id = file_reps.file_id and f.org_id = (select public.current_org_id())
    )
  );

drop policy if exists file_groups_select on public.file_groups;
create policy file_groups_select on public.file_groups
  for select using (
    exists (select 1 from public.files f where f.id = file_groups.file_id)
  );

drop policy if exists file_groups_write on public.file_groups;
create policy file_groups_write on public.file_groups
  for all using (
    (select public."current_role"()) = 'manager'
    and exists (
      select 1 from public.files f
      where f.id = file_groups.file_id and f.org_id = (select public.current_org_id())
    )
  ) with check (
    (select public."current_role"()) = 'manager'
    and exists (
      select 1 from public.files f
      where f.id = file_groups.file_id and f.org_id = (select public.current_org_id())
    )
  );

comment on table public.files is
  'Shared documents. `audience` decides visibility; storage.objects policies join on storage_path so the rule is enforced once.';
comment on column public.files.audience is
  'everyone = all org members; reps = the named reps in file_reps; groups = reps covering any store in the chains in file_groups.';
