-- ──────────────────────────────────────────────────────────────────────────
-- STAGING SCHEMA — CHUNK 1 OF 8
-- ──────────────────────────────────────────────────────────────────────────
--
-- Paste this whole file into the staging SQL editor and run it.
-- Covers 20260726144345_init_orgs_users.sql
--    .. through 20260727121757_create_activity_feed_rpc.sql
--
-- Run the chunks in order.
--
-- Wrapped in a transaction, so a statement that fails should take the
-- whole chunk back out with it. That is a *should*: supabase/README.md
-- records a 377 KB script that failed and had partly applied anyway,
-- so the editor cannot be assumed to honour it. The per-migration
-- stamps and 99_resume.sql are still the authority on what landed —
-- check them rather than re-running blind.
-- ──────────────────────────────────────────────────────────────────────────

begin;

-- Records which migrations have been applied. A fresh project may already
-- have this from Supabase; the alters cover a project that has it in an older
-- shape. Without it, a later `supabase db push` replays all 71.
create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version text primary key
);

alter table supabase_migrations.schema_migrations
  add column if not exists statements text[];
alter table supabase_migrations.schema_migrations
  add column if not exists name text;

-- ──────────────────────────────────────────────────────────────────────────
--  1/76  20260726144345_init_orgs_users.sql
-- ──────────────────────────────────────────────────────────────────────────

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('rep','manager')),
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

create index profiles_org_id_idx on public.profiles(org_id);

-- SECURITY DEFINER helpers so RLS policies on other tables can look up the
-- caller's org/role without recursively hitting profiles' own RLS.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260726144345', 'init_orgs_users')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
--  2/76  20260726144357_stores.sql
-- ──────────────────────────────────────────────────────────────────────────

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  city text,
  state text,
  zip text,
  place_code text,
  territory text,
  lat double precision,
  lng double precision,
  geofence_radius_m int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index stores_org_id_idx on public.stores(org_id);

insert into supabase_migrations.schema_migrations (version, name)
values ('20260726144357', 'stores')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
--  3/76  20260726144416_routes_visits.sql
-- ──────────────────────────────────────────────────────────────────────────

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  scheduled_date date not null,
  sequence_order int,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index routes_org_rep_date_idx on public.routes(org_id, rep_id, scheduled_date);
create index routes_store_id_idx on public.routes(store_id);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  route_id uuid references public.routes(id) on delete set null,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started','checked_in','checked_out','missed')),
  checkin_at timestamptz,
  checkin_lat double precision,
  checkin_lng double precision,
  checkin_gps_accuracy_m double precision,
  checkin_distance_from_store_m double precision,
  checkout_at timestamptz,
  checkout_lat double precision,
  checkout_lng double precision,
  duration_seconds int,
  client_generated_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index visits_org_rep_idx on public.visits(org_id, rep_id);
create index visits_route_id_idx on public.visits(route_id);
create index visits_store_id_idx on public.visits(store_id);

drop trigger if exists visits_set_updated_at on public.visits;
create trigger visits_set_updated_at
  before update on public.visits
  for each row
  execute function public.set_updated_at();

insert into supabase_migrations.schema_migrations (version, name)
values ('20260726144416', 'routes_visits')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
--  4/76  20260726144433_forms_photos.sql
-- ──────────────────────────────────────────────────────────────────────────

create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index form_templates_org_id_idx on public.form_templates(org_id);

drop trigger if exists form_templates_set_updated_at on public.form_templates;
create trigger form_templates_set_updated_at
  before update on public.form_templates
  for each row
  execute function public.set_updated_at();

create table public.form_fields (
  id uuid primary key default gen_random_uuid(),
  form_template_id uuid not null references public.form_templates(id) on delete cascade,
  label text not null,
  field_type text not null check (field_type in ('text','number','photo','multiple_choice','boolean','date')),
  options jsonb,
  required boolean not null default false,
  sort_order int not null default 0
);

create index form_fields_template_id_idx on public.form_fields(form_template_id);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  taken_at timestamptz,
  uploaded_at timestamptz,
  lat double precision,
  lng double precision,
  client_generated_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index photos_visit_id_idx on public.photos(visit_id);
create index photos_org_rep_idx on public.photos(org_id, rep_id);

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  form_template_id uuid not null references public.form_templates(id),
  rep_id uuid not null references public.profiles(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  client_generated_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index form_submissions_visit_id_idx on public.form_submissions(visit_id);
create index form_submissions_org_rep_idx on public.form_submissions(org_id, rep_id);

create table public.form_responses (
  id uuid primary key default gen_random_uuid(),
  form_submission_id uuid not null references public.form_submissions(id) on delete cascade,
  form_field_id uuid not null references public.form_fields(id) on delete cascade,
  value_text text,
  value_number numeric,
  value_boolean boolean,
  photo_id uuid references public.photos(id) on delete set null
);

create index form_responses_submission_id_idx on public.form_responses(form_submission_id);

insert into supabase_migrations.schema_migrations (version, name)
values ('20260726144433', 'forms_photos')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
--  5/76  20260726144458_rls_policies.sql
-- ──────────────────────────────────────────────────────────────────────────

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.routes enable row level security;
alter table public.visits enable row level security;
alter table public.form_templates enable row level security;
alter table public.form_fields enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_responses enable row level security;
alter table public.photos enable row level security;

-- organizations: members can read their own org; managers can update it
create policy organizations_select on public.organizations
  for select using (id = public.current_org_id());

create policy organizations_update on public.organizations
  for update using (id = public.current_org_id() and public.current_role() = 'manager');

-- profiles: readable org-wide; users manage their own row, managers manage all in their org
create policy profiles_select on public.profiles
  for select using (org_id = public.current_org_id());

create policy profiles_insert on public.profiles
  for insert with check (
    org_id = public.current_org_id() and public.current_role() = 'manager'
  );

create policy profiles_update on public.profiles
  for update using (
    id = auth.uid()
    or (org_id = public.current_org_id() and public.current_role() = 'manager')
  );

-- stores: org-wide read, manager-only write
create policy stores_select on public.stores
  for select using (org_id = public.current_org_id());

create policy stores_insert on public.stores
  for insert with check (org_id = public.current_org_id() and public.current_role() = 'manager');

create policy stores_update on public.stores
  for update using (org_id = public.current_org_id() and public.current_role() = 'manager');

create policy stores_delete on public.stores
  for delete using (org_id = public.current_org_id() and public.current_role() = 'manager');

-- routes: managers see/manage all in their org; reps see only their own assignments
create policy routes_select on public.routes
  for select using (
    org_id = public.current_org_id()
    and (public.current_role() = 'manager' or rep_id = auth.uid())
  );

create policy routes_insert on public.routes
  for insert with check (org_id = public.current_org_id() and public.current_role() = 'manager');

create policy routes_update on public.routes
  for update using (org_id = public.current_org_id() and public.current_role() = 'manager');

create policy routes_delete on public.routes
  for delete using (org_id = public.current_org_id() and public.current_role() = 'manager');

-- visits: managers see all in org; reps see/manage only their own
create policy visits_select on public.visits
  for select using (
    org_id = public.current_org_id()
    and (public.current_role() = 'manager' or rep_id = auth.uid())
  );

create policy visits_insert on public.visits
  for insert with check (org_id = public.current_org_id() and rep_id = auth.uid());

create policy visits_update on public.visits
  for update using (
    org_id = public.current_org_id()
    and (rep_id = auth.uid() or public.current_role() = 'manager')
  );

-- form_templates: org-wide read, manager-only write
create policy form_templates_select on public.form_templates
  for select using (org_id = public.current_org_id());

create policy form_templates_insert on public.form_templates
  for insert with check (org_id = public.current_org_id() and public.current_role() = 'manager');

create policy form_templates_update on public.form_templates
  for update using (org_id = public.current_org_id() and public.current_role() = 'manager');

create policy form_templates_delete on public.form_templates
  for delete using (org_id = public.current_org_id() and public.current_role() = 'manager');

-- form_fields: scoped via parent template's org
create policy form_fields_select on public.form_fields
  for select using (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = public.current_org_id()
    )
  );

create policy form_fields_write on public.form_fields
  for all using (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = public.current_org_id()
        and public.current_role() = 'manager'
    )
  ) with check (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = public.current_org_id()
        and public.current_role() = 'manager'
    )
  );

-- form_submissions: managers see all in org; reps see/manage only their own
create policy form_submissions_select on public.form_submissions
  for select using (
    org_id = public.current_org_id()
    and (public.current_role() = 'manager' or rep_id = auth.uid())
  );

create policy form_submissions_insert on public.form_submissions
  for insert with check (org_id = public.current_org_id() and rep_id = auth.uid());

create policy form_submissions_update on public.form_submissions
  for update using (org_id = public.current_org_id() and rep_id = auth.uid());

-- form_responses: scoped via parent submission's org/rep
create policy form_responses_select on public.form_responses
  for select using (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = public.current_org_id()
        and (public.current_role() = 'manager' or fs.rep_id = auth.uid())
    )
  );

create policy form_responses_write on public.form_responses
  for all using (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = public.current_org_id()
        and fs.rep_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = public.current_org_id()
        and fs.rep_id = auth.uid()
    )
  );

-- photos: managers see all in org; reps see/manage only their own
create policy photos_select on public.photos
  for select using (
    org_id = public.current_org_id()
    and (public.current_role() = 'manager' or rep_id = auth.uid())
  );

create policy photos_insert on public.photos
  for insert with check (org_id = public.current_org_id() and rep_id = auth.uid());

create policy photos_update on public.photos
  for update using (org_id = public.current_org_id() and rep_id = auth.uid());

insert into supabase_migrations.schema_migrations (version, name)
values ('20260726144458', 'rls_policies')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
--  6/76  20260726144511_storage_buckets.sql
-- ──────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('visit-photos', 'visit-photos', false)
on conflict (id) do nothing;

-- Object paths are org_id/rep_id/visit_id/filename.jpg
create policy visit_photos_select on storage.objects
  for select using (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (
      public.current_role() = 'manager'
      or (storage.foldername(name))[2] = auth.uid()::text
    )
  );

create policy visit_photos_insert on storage.objects
  for insert with check (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy visit_photos_update on storage.objects
  for update using (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

insert into supabase_migrations.schema_migrations (version, name)
values ('20260726144511', 'storage_buckets')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
--  7/76  20260726144612_harden_functions.sql
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- These SECURITY DEFINER helpers only ever return the caller's own org_id/role
-- (filtered by auth.uid()), so anon callers get null — no data leak — but
-- restrict EXECUTE to authenticated users only per the linter's recommendation.
revoke execute on function public.current_org_id() from public, anon;
revoke execute on function public.current_role() from public, anon;
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.current_role() to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260726144612', 'harden_functions')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
--  8/76  20260726145151_optimize_rls_policies.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Drop and recreate all policies wrapping auth.uid()/current_org_id()/current_role()
-- in (select ...) so Postgres evaluates them once per query, not once per row.
-- Also split the form_fields/form_responses FOR ALL "write" policies into
-- separate insert/update/delete policies so they no longer duplicate the
-- select policy (multiple_permissive_policies warning).

drop policy organizations_select on public.organizations;
drop policy organizations_update on public.organizations;
create policy organizations_select on public.organizations
  for select using (id = (select public.current_org_id()));
create policy organizations_update on public.organizations
  for update using (id = (select public.current_org_id()) and (select public.current_role()) = 'manager');

drop policy profiles_select on public.profiles;
drop policy profiles_insert on public.profiles;
drop policy profiles_update on public.profiles;
create policy profiles_select on public.profiles
  for select using (org_id = (select public.current_org_id()));
create policy profiles_insert on public.profiles
  for insert with check (
    org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager'
  );
create policy profiles_update on public.profiles
  for update using (
    id = (select auth.uid())
    or (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager')
  );

drop policy stores_select on public.stores;
drop policy stores_insert on public.stores;
drop policy stores_update on public.stores;
drop policy stores_delete on public.stores;
create policy stores_select on public.stores
  for select using (org_id = (select public.current_org_id()));
create policy stores_insert on public.stores
  for insert with check (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');
create policy stores_update on public.stores
  for update using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');
create policy stores_delete on public.stores
  for delete using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');

drop policy routes_select on public.routes;
drop policy routes_insert on public.routes;
drop policy routes_update on public.routes;
drop policy routes_delete on public.routes;
create policy routes_select on public.routes
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );
create policy routes_insert on public.routes
  for insert with check (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');
create policy routes_update on public.routes
  for update using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');
create policy routes_delete on public.routes
  for delete using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');

drop policy visits_select on public.visits;
drop policy visits_insert on public.visits;
drop policy visits_update on public.visits;
create policy visits_select on public.visits
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );
create policy visits_insert on public.visits
  for insert with check (org_id = (select public.current_org_id()) and rep_id = (select auth.uid()));
create policy visits_update on public.visits
  for update using (
    org_id = (select public.current_org_id())
    and (rep_id = (select auth.uid()) or (select public.current_role()) = 'manager')
  );

drop policy form_templates_select on public.form_templates;
drop policy form_templates_insert on public.form_templates;
drop policy form_templates_update on public.form_templates;
drop policy form_templates_delete on public.form_templates;
create policy form_templates_select on public.form_templates
  for select using (org_id = (select public.current_org_id()));
create policy form_templates_insert on public.form_templates
  for insert with check (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');
create policy form_templates_update on public.form_templates
  for update using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');
create policy form_templates_delete on public.form_templates
  for delete using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');

drop policy form_fields_select on public.form_fields;
drop policy form_fields_write on public.form_fields;
create policy form_fields_select on public.form_fields
  for select using (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = (select public.current_org_id())
    )
  );
create policy form_fields_insert on public.form_fields
  for insert with check (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = (select public.current_org_id())
        and (select public.current_role()) = 'manager'
    )
  );
create policy form_fields_update on public.form_fields
  for update using (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = (select public.current_org_id())
        and (select public.current_role()) = 'manager'
    )
  );
create policy form_fields_delete on public.form_fields
  for delete using (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = (select public.current_org_id())
        and (select public.current_role()) = 'manager'
    )
  );

drop policy form_submissions_select on public.form_submissions;
drop policy form_submissions_insert on public.form_submissions;
drop policy form_submissions_update on public.form_submissions;
create policy form_submissions_select on public.form_submissions
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );
create policy form_submissions_insert on public.form_submissions
  for insert with check (org_id = (select public.current_org_id()) and rep_id = (select auth.uid()));
create policy form_submissions_update on public.form_submissions
  for update using (org_id = (select public.current_org_id()) and rep_id = (select auth.uid()));

drop policy form_responses_select on public.form_responses;
drop policy form_responses_write on public.form_responses;
create policy form_responses_select on public.form_responses
  for select using (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = (select public.current_org_id())
        and ((select public.current_role()) = 'manager' or fs.rep_id = (select auth.uid()))
    )
  );
create policy form_responses_insert on public.form_responses
  for insert with check (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = (select public.current_org_id())
        and fs.rep_id = (select auth.uid())
    )
  );
create policy form_responses_update on public.form_responses
  for update using (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = (select public.current_org_id())
        and fs.rep_id = (select auth.uid())
    )
  );
create policy form_responses_delete on public.form_responses
  for delete using (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = (select public.current_org_id())
        and fs.rep_id = (select auth.uid())
    )
  );

drop policy photos_select on public.photos;
drop policy photos_insert on public.photos;
drop policy photos_update on public.photos;
create policy photos_select on public.photos
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );
create policy photos_insert on public.photos
  for insert with check (org_id = (select public.current_org_id()) and rep_id = (select auth.uid()));
create policy photos_update on public.photos
  for update using (org_id = (select public.current_org_id()) and rep_id = (select auth.uid()));

insert into supabase_migrations.schema_migrations (version, name)
values ('20260726145151', 'optimize_rls_policies')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
--  9/76  20260726152920_routes_scheduled_time_window.sql
-- ──────────────────────────────────────────────────────────────────────────

alter table public.routes
  add column scheduled_start_at timestamptz,
  add column scheduled_end_at timestamptz;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260726152920', 'routes_scheduled_time_window')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 10/76  20260726155028_organizations_details.sql
-- ──────────────────────────────────────────────────────────────────────────

alter table public.organizations
  add column legal_name text,
  add column industry text,
  add column website text,
  add column address text,
  add column support_email text;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260726155028', 'organizations_details')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 11/76  20260726163602_store_groups.sql
-- ──────────────────────────────────────────────────────────────────────────

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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260726163602', 'store_groups')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 12/76  20260726173953_workday_sessions_and_location_pings.sql
-- ──────────────────────────────────────────────────────────────────────────

-- A rep's workday: started when they tap "Start workday", ended on "End
-- workday". distance_meters accumulates from consecutive GPS pings.
create table public.workday_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,
  distance_meters double precision not null default 0,
  duration_seconds int,
  client_generated_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workday_sessions_org_rep_idx on public.workday_sessions(org_id, rep_id);
create index workday_sessions_started_at_idx on public.workday_sessions(started_at desc);

drop trigger if exists workday_sessions_set_updated_at on public.workday_sessions;
create trigger workday_sessions_set_updated_at
  before update on public.workday_sessions
  for each row execute function public.set_updated_at();

-- Periodic location samples taken while a workday is active (~every 20 min),
-- plus the one-off sample captured at store check-in.
create table public.location_pings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  workday_session_id uuid references public.workday_sessions(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  recorded_at timestamptz not null default now(),
  source text not null default 'interval' check (source in ('interval','checkin','checkout','workday_start','workday_end')),
  client_generated_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index location_pings_org_rep_idx on public.location_pings(org_id, rep_id);
create index location_pings_session_idx on public.location_pings(workday_session_id);
create index location_pings_recorded_at_idx on public.location_pings(recorded_at desc);

alter table public.workday_sessions enable row level security;
alter table public.location_pings enable row level security;

-- Managers see the whole org; reps see and write only their own rows.
create policy workday_sessions_select on public.workday_sessions
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );

create policy workday_sessions_insert on public.workday_sessions
  for insert with check (
    org_id = (select public.current_org_id()) and rep_id = (select auth.uid())
  );

create policy workday_sessions_update on public.workday_sessions
  for update using (
    org_id = (select public.current_org_id()) and rep_id = (select auth.uid())
  );

create policy location_pings_select on public.location_pings
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );

create policy location_pings_insert on public.location_pings
  for insert with check (
    org_id = (select public.current_org_id()) and rep_id = (select auth.uid())
  );

insert into supabase_migrations.schema_migrations (version, name)
values ('20260726173953', 'workday_sessions_and_location_pings')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 13/76  20260727093100_create_store_assignments.sql
-- ──────────────────────────────────────────────────────────────────────────

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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727093100', 'create_store_assignments')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 14/76  20260727095454_add_form_field_metric_key.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Compliance KPIs need to know which field *means* "in stock" or "planogram ok".
-- Matching on the label would break silently the moment a manager renames a
-- question in the form builder, showing 0% rather than an error.
alter table public.form_fields add column metric_key text;

alter table public.form_fields add constraint form_fields_metric_key_check
  check (metric_key is null or metric_key in (
    'in_stock', 'facings', 'shelf_position', 'planogram_ok',
    'price_correct', 'promo_display', 'damaged_expired', 'coupons'
  ));

-- One field per metric per template.
create unique index form_fields_template_metric_idx
  on public.form_fields (form_template_id, metric_key)
  where metric_key is not null;

update public.form_fields set metric_key = case sort_order
    when 1  then 'in_stock'
    when 2  then 'facings'
    when 3  then 'shelf_position'
    when 4  then 'planogram_ok'
    when 6  then 'price_correct'
    when 8  then 'promo_display'
    when 10 then 'damaged_expired'
    when 11 then 'coupons'
  end
where form_template_id = '3de65e08-382e-424c-acc7-9db1be5e5f46'
  and sort_order in (1, 2, 3, 4, 6, 8, 10, 11);

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727095454', 'add_form_field_metric_key')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 15/76  20260727100648_create_dashboard_summary_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Replaces the dashboard's 7 sequential client queries with one call, two of
-- which pulled whole tables to the browser just to run count(distinct) in JS.
-- security invoker so RLS still applies: a rep calling this sees only their rows.
--
-- NOTE: superseded by 20260727141220_fix_dashboard_coverage_denominator.sql,
-- which corrects the coverage numerator. Kept here so the history replays.
create or replace function public.dashboard_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    -- Materialised so the planner sees a literal org_id and can actually use
    -- visits_org_checkin_at_idx rather than re-evaluating the helper per row.
    select public.current_org_id() as org,
           p_from as cur_from,
           p_to   as cur_to,
           p_from - (p_to - p_from) as prev_from
  ),
  -- Missed / not-started visits have no checkin_at, so fall back to the
  -- scheduled time or they'd vanish from every period filter.
  scoped as materialized (
    select v.id, v.rep_id, v.store_id, v.status, v.route_id, v.duration_seconds,
           coalesce(v.checkin_at, r.scheduled_start_at) as occurred_at
    from visits v
    left join routes r on r.id = v.route_id
    cross join cfg
    where v.org_id = cfg.org
      and coalesce(v.checkin_at, r.scheduled_start_at) >= cfg.prev_from
      and coalesce(v.checkin_at, r.scheduled_start_at) <  cfg.cur_to
  ),
  period as (
    select s.*, case when s.occurred_at >= cfg.cur_from then 'current' else 'previous' end as bucket
    from scoped s cross join cfg
  ),
  agg as (
    select bucket,
      count(*) as visits_total,
      count(*) filter (where status = 'checked_out') as visits_completed,
      count(*) filter (where status = 'missed') as visits_missed,
      count(*) filter (where route_id is null) as visits_unscheduled,
      count(distinct rep_id) filter (where status = 'checked_out') as active_reps,
      count(distinct store_id) filter (where status = 'checked_out') as stores_covered,
      avg(duration_seconds) filter (where status = 'checked_out') as avg_duration
    from period group by bucket
  ),
  subagg as (
    select case when s.submitted_at >= cfg.cur_from then 'current' else 'previous' end as bucket,
           count(*) as submissions
    from form_submissions s cross join cfg
    where s.org_id = cfg.org and s.submitted_at >= cfg.prev_from and s.submitted_at < cfg.cur_to
    group by 1
  ),
  formagg as (
    select case when s.submitted_at >= cfg.cur_from then 'current' else 'previous' end as bucket,
      count(*) filter (where f.metric_key = 'in_stock') as instock_n,
      count(*) filter (where f.metric_key = 'in_stock' and r.value_boolean is false) as oos_n,
      count(*) filter (where f.metric_key = 'planogram_ok') as plano_n,
      count(*) filter (where f.metric_key = 'planogram_ok' and r.value_boolean is true) as plano_ok_n
    from form_responses r
    join form_fields f on f.id = r.form_field_id
    join form_submissions s on s.id = r.form_submission_id
    cross join cfg
    where s.org_id = cfg.org and s.submitted_at >= cfg.prev_from and s.submitted_at < cfg.cur_to
    group by 1
  ),
  blocks as (
    select b.bucket, jsonb_build_object(
        'visits_total',       coalesce(a.visits_total, 0),
        'visits_completed',   coalesce(a.visits_completed, 0),
        'visits_missed',      coalesce(a.visits_missed, 0),
        'visits_unscheduled', coalesce(a.visits_unscheduled, 0),
        'active_reps',        coalesce(a.active_reps, 0),
        'stores_covered',     coalesce(a.stores_covered, 0),
        'avg_duration_seconds', round(coalesce(a.avg_duration, 0)),
        'submissions',        coalesce(sa.submissions, 0),
        -- null (not zero) when there is nothing to measure, so the UI can show
        -- an em dash instead of claiming a real 0%.
        'oos_rate',        case when fa.instock_n > 0 then round(fa.oos_n::numeric / fa.instock_n, 4) end,
        'planogram_rate',  case when fa.plano_n   > 0 then round(fa.plano_ok_n::numeric / fa.plano_n, 4) end
      ) as obj
    from (values ('current'), ('previous')) b(bucket)
    left join agg     a  on a.bucket  = b.bucket
    left join subagg  sa on sa.bucket = b.bucket
    left join formagg fa on fa.bucket = b.bucket
  ),
  -- generate_series so days with no activity return 0 rather than being absent,
  -- otherwise a sparse range renders as a broken-looking chart.
  series as (
    select to_char(d.day, 'YYYY-MM-DD') as day,
           count(p.id) filter (where p.status = 'checked_out') as completed,
           count(p.id) as total
    from cfg
    cross join lateral generate_series(cfg.cur_from::date,
                                       (cfg.cur_to - interval '1 second')::date,
                                       interval '1 day') as d(day)
    left join period p on p.bucket = 'current'
                      and (p.occurred_at at time zone 'UTC')::date = d.day::date
    group by d.day
  )
  select jsonb_build_object(
    'stores_active', (select count(*) from stores s, cfg where s.org_id = cfg.org and s.active),
    'current',       (select obj from blocks where bucket = 'current'),
    'previous',      (select obj from blocks where bucket = 'previous'),
    'series',        (select coalesce(jsonb_agg(jsonb_build_object(
                                'day', day, 'completed', completed, 'total', total
                              ) order by day), '[]'::jsonb) from series)
  );
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727100648', 'create_dashboard_summary_rpc')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 16/76  20260727121757_create_activity_feed_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Chronological feed of field activity, with a location verdict per event.
-- Unioning in SQL (rather than merging two client streams) is what makes
-- pagination correct; new event kinds can be added here without touching the UI.
create or replace function public.activity_feed(
  p_from         timestamptz,
  p_to           timestamptz,
  p_rep_ids      uuid[]  default null,
  p_store_ids    uuid[]  default null,
  p_only_flagged boolean default false,
  p_limit        int     default 50,
  p_offset       int     default 0
)
returns table (
  event_id          text,
  kind              text,
  occurred_at       timestamptz,
  visit_id          uuid,
  rep_id            uuid,
  rep_name          text,
  store_id          uuid,
  store_name        text,
  distance_m        numeric,
  accuracy_m        numeric,
  geofence_radius_m int,
  verdict           text,
  submission_id     uuid,
  total_count       bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  events as (
    select v.id::text || ':in' as event_id,
           'check_in'::text    as kind,
           v.checkin_at        as occurred_at,
           v.id as visit_id, v.rep_id, v.store_id,
           v.checkin_distance_from_store_m::numeric as distance_m,
           v.checkin_gps_accuracy_m::numeric        as accuracy_m
    from visits v cross join cfg
    where v.org_id = cfg.org and v.checkin_at is not null

    union all

    -- No checkout_distance_from_store_m column exists, so derive it the same
    -- way the check-in distance was derived.
    select v.id::text || ':out',
           'check_out',
           v.checkout_at,
           v.id, v.rep_id, v.store_id,
           case when v.checkout_lat is not null and s.lat is not null then
             round((6371000 * 2 * asin(sqrt(
               power(sin(radians(s.lat - v.checkout_lat) / 2), 2)
               + cos(radians(v.checkout_lat)) * cos(radians(s.lat))
               * power(sin(radians(s.lng - v.checkout_lng) / 2), 2)
             )))::numeric, 1)
           end,
           null::numeric
    from visits v
    join stores s on s.id = v.store_id
    cross join cfg
    where v.org_id = cfg.org and v.checkout_at is not null
  ),
  enriched as (
    select e.event_id, e.kind, e.occurred_at, e.visit_id, e.rep_id, e.store_id,
           e.distance_m, e.accuracy_m,
           s.name as store_name, s.geofence_radius_m,
           p.full_name as rep_name,
           case
             when e.distance_m is null            then 'unknown'
             -- Beyond 5km is a corrupt reading, not behaviour. Never present
             -- it as fact; it destroys trust in every other number here.
             when e.distance_m > 5000             then 'invalid_gps'
             when e.distance_m > 500              then 'off_site'
             when e.distance_m > s.geofence_radius_m then 'nearby'
             else 'at_store'
           end as verdict,
           (select fs.id from form_submissions fs
             where fs.visit_id = e.visit_id
             order by fs.submitted_at limit 1) as submission_id
    from events e
    join stores s on s.id = e.store_id
    left join profiles p on p.id = e.rep_id
  ),
  filtered as (
    select * from enriched
    where occurred_at >= p_from
      and occurred_at <  p_to
      and (p_rep_ids   is null or rep_id   = any(p_rep_ids))
      and (p_store_ids is null or store_id = any(p_store_ids))
      and (not p_only_flagged or verdict in ('off_site', 'invalid_gps'))
  )
  select event_id, kind, occurred_at, visit_id, rep_id, rep_name,
         store_id, store_name, distance_m, accuracy_m, geofence_radius_m,
         verdict, submission_id,
         count(*) over () as total_count
  from filtered
  -- event_id tiebreaks so paging can't duplicate or skip rows sharing a timestamp.
  order by occurred_at desc, event_id
  limit p_limit offset p_offset;
$$;

-- Counts for the summary strip, across the whole range rather than one page.
create or replace function public.activity_feed_summary(
  p_from      timestamptz,
  p_to        timestamptz,
  p_rep_ids   uuid[] default null,
  p_store_ids uuid[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(verdict, n) || jsonb_build_object('total', sum(n)),
    '{"total": 0}'::jsonb
  )
  from (
    select verdict, count(*) as n
    from public.activity_feed(p_from, p_to, p_rep_ids, p_store_ids,
                              false, 1000000, 0)
    group by verdict
  ) x;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260727121757', 'create_activity_feed_rpc')
on conflict (version) do nothing;

commit;
