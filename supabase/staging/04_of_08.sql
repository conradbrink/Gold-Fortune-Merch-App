-- ──────────────────────────────────────────────────────────────────────────
-- STAGING SCHEMA — CHUNK 4 OF 8
-- ──────────────────────────────────────────────────────────────────────────
--
-- Paste this whole file into the staging SQL editor and run it.
-- Covers 20260728190554_fix_files_policy_recursion.sql
--    .. through 20260729080754_create_store_location_drift_rpc.sql
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
-- ──────────────────────────────────────────────────────────────────────────
-- 39/76  20260728190554_fix_files_policy_recursion.sql
-- ──────────────────────────────────────────────────────────────────────────

-- The policies in create_files were mutually recursive and Postgres refused
-- them outright ("infinite recursion detected in policy for relation files").
--
-- A subquery inside a policy is itself subject to the referenced table's RLS.
-- So files_select read file_reps, which triggered file_reps_select, which read
-- files, which triggered files_select — forever. The design intent was right;
-- the mechanism was not.
--
-- The entitlement lookup now lives in a security-definer function, which runs
-- as the owner and therefore does not re-enter RLS. It still takes the
-- audience as an argument rather than reading it from `files`, because looking
-- it up would recreate the same cycle.
create or replace function public.can_see_file(p_file_id uuid, p_audience text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_audience
    when 'everyone' then true
    when 'reps' then exists (
      select 1 from file_reps fr
      where fr.file_id = p_file_id and fr.rep_id = auth.uid()
    )
    -- Reps inherit chain access from the stores they cover, so moving a store
    -- between reps moves the planogram with it.
    when 'groups' then exists (
      select 1 from file_groups fg
      join stores s on s.store_group_id = fg.store_group_id
      join store_assignments sa on sa.store_id = s.id
      where fg.file_id = p_file_id and sa.rep_id = auth.uid()
    )
    else false
  end;
$$;

comment on function public.can_see_file is
  'Entitlement for one file. Security definer so it can be used inside the files RLS policy without recursing through file_reps/file_groups.';

revoke execute on function public.can_see_file(uuid, text) from public, anon;
grant execute on function public.can_see_file(uuid, text) to authenticated;

drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public."current_role"()) = 'manager'
      or public.can_see_file(id, audience)
    )
  );

-- Is this file in my org? Also security definer, for the same reason: the
-- write policies on the join tables need to look at `files` without dragging
-- files_select back into the cycle.
create or replace function public.file_in_my_org(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from files f
    where f.id = p_file_id and f.org_id = public.current_org_id()
  );
$$;

revoke execute on function public.file_in_my_org(uuid) from public, anon;
grant execute on function public.file_in_my_org(uuid) to authenticated;

-- The join tables no longer reference `files` through RLS at all.
--
-- A rep can read their own membership rows and nothing else; the rows carry no
-- content, and a rep learning that some file id is shared with them is
-- meaningless without the file itself, which files_select still governs.
drop policy if exists file_reps_select on public.file_reps;
create policy file_reps_select on public.file_reps
  for select using (
    (select public."current_role"()) = 'manager'
    or rep_id = (select auth.uid())
  );

drop policy if exists file_reps_write on public.file_reps;
create policy file_reps_write on public.file_reps
  for all using (
    (select public."current_role"()) = 'manager' and public.file_in_my_org(file_id)
  ) with check (
    (select public."current_role"()) = 'manager' and public.file_in_my_org(file_id)
  );

drop policy if exists file_groups_select on public.file_groups;
create policy file_groups_select on public.file_groups
  for select using (
    -- Chain tags are not rep-specific, so any org member may read them; the
    -- file itself is still gated by files_select.
    (select public.current_org_id()) is not null
  );

drop policy if exists file_groups_write on public.file_groups;
create policy file_groups_write on public.file_groups
  for all using (
    (select public."current_role"()) = 'manager' and public.file_in_my_org(file_id)
  ) with check (
    (select public."current_role"()) = 'manager' and public.file_in_my_org(file_id)
  );

insert into supabase_migrations.schema_migrations (version, name)
values ('20260728190554', 'fix_files_policy_recursion')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 40/76  20260728195431_add_store_geocoding_provenance.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Where a store's coordinates came from.
--
-- A lat/lng on its own cannot be sanity-checked later. These columns make one
-- traceable: which service answered, what address it thought it was matching,
-- and when. That matters because a wrong coordinate is worse than none — it
-- puts the geofence somewhere the rep is not, so a check-in at the right shop
-- reads as off-site.
--
-- Learned the hard way while testing: the Geocoding API returned a confident
-- ROOFTOP result 5.7 km from Choppies Game City, because it could not parse
-- "GAME CITY" as an address and fell back to a plus code. Places text search
-- found the shop by name. Recording which one answered is what lets that be
-- spotted afterwards rather than trusted forever.
alter table public.stores
  add column if not exists geocoded_at    timestamptz,
  add column if not exists geocode_source text,
  add column if not exists geocode_result text;

alter table public.stores drop constraint if exists stores_geocode_source_check;
alter table public.stores add constraint stores_geocode_source_check
  check (geocode_source is null or geocode_source in ('places', 'geocoding', 'manual'));

comment on column public.stores.geocode_source is
  'places = matched by name via Places text search (most reliable here); geocoding = address lookup; manual = set by a person.';
comment on column public.stores.geocode_result is
  'The address the service believed it matched. Kept so a coordinate can be judged later without re-querying.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260728195431', 'add_store_geocoding_provenance')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 41/76  20260728202752_rep_captures_store_location.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Let a rep set a store's location from where they are standing.
--
-- Automated geocoding reached its ceiling at 161 of 209 stores, and the 48 that
-- are left are not going to be solved by trying harder: Google has no listing
-- for many specific branches and confidently substitutes the nearest shop of
-- the same brand. Retrying the collapsed ones with location bias returned
-- *differently* wrong answers that disagreed with the unbiased ones.
--
-- The rep is inside the shop holding a GPS. That is a better instrument than
-- any geocoder, and it means the estate corrects itself over the first call
-- cycle instead of waiting on someone with a map.
--
-- The whole risk of this feature is a bad coordinate, because the geofence
-- follows it: a wrong point makes an honest check-in read as off-site forever
-- after. So the write is deliberately hard to do wrong — see the guards on the
-- function below, every one of which refuses loudly rather than silently.

alter table public.stores
  add column if not exists geocode_accuracy_m double precision,
  add column if not exists geocode_visit_id   uuid
    references public.visits(id) on delete set null;

comment on column public.stores.geocode_accuracy_m is
  'Reported accuracy of the fix in metres. Only meaningful for geocode_source = ''rep'' — the geocoders return no such number.';
comment on column public.stores.geocode_visit_id is
  'The visit a rep-captured location was taken during, so it is traceable to a person standing in a place at a time.';

alter table public.stores drop constraint if exists stores_geocode_source_check;
alter table public.stores add constraint stores_geocode_source_check
  check (geocode_source is null
         or geocode_source in ('places', 'geocoding', 'manual', 'rep'));

comment on column public.stores.geocode_source is
  'places = matched by name via Places text search (most reliable here); geocoding = address lookup; manual = set by a person; rep = captured on site by the rep''s phone during a visit.';

-- Identified by the visit's client_generated_id rather than its primary key.
--
-- The phone mints that id at check-in and always has it; the server-side `id`
-- only comes back on a later refetch, so keying on the primary key would make
-- the button fail exactly when the rep has just arrived — the moment it is
-- meant to be used. `_replayFormSubmission` resolves visits the same way.
--
-- SECURITY DEFINER because `stores_update` is manager-only and should stay
-- that way: this is the single, narrow hole through which a rep may write to a
-- store, and it can write nothing but a location, on one store, once.
create or replace function public.set_store_location_from_visit(
  p_visit_client_id uuid,
  p_lat             double precision,
  p_lng             double precision,
  p_accuracy_m      double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Keep in step with kMaxLocationAccuracyM in mobile/lib/core/location_service.dart.
  -- The app refuses a worse fix before asking the server; this is the backstop.
  -- 50 m is half the default geofence, so a location set at the limit still
  -- leaves a check-in comfortably inside it.
  c_max_accuracy_m constant double precision := 50;
  -- A fix this far from where the rep checked in is not the same building.
  -- Generous on purpose: a large centre plus a poor check-in fix can be a few
  -- hundred metres apart honestly, and a refusal here costs a store its only
  -- chance at a location.
  c_max_drift_m constant double precision := 500;

  v_visit  record;
  v_drift  double precision;
  v_result jsonb;
begin
  if p_lat is null or p_lng is null then
    raise exception 'A latitude and longitude are required.'
      using errcode = '22023';
  end if;

  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Those coordinates are not a real place.'
      using errcode = '22023';
  end if;

  -- (0, 0) is in the Atlantic and is what a broken location stack returns.
  if p_lat = 0 and p_lng = 0 then
    raise exception 'Your phone did not report a real position. Try again.'
      using errcode = '22023';
  end if;

  if p_accuracy_m is null or p_accuracy_m <= 0 then
    raise exception 'The fix reported no accuracy, so it cannot be trusted.'
      using errcode = '22023';
  end if;

  if p_accuracy_m > c_max_accuracy_m then
    raise exception 'This GPS fix is only accurate to %m. Step outside the building and try again.',
      round(p_accuracy_m)
      using errcode = '22023';
  end if;

  -- RLS is bypassed here, so every check the policies would have made is made
  -- explicitly below.
  select v.id, v.store_id, v.org_id, v.rep_id, v.status,
         v.checkin_lat, v.checkin_lng
    into v_visit
  from public.visits v
  where v.client_generated_id = p_visit_client_id;

  if not found then
    raise exception 'This visit has not reached the server yet. Connect and try again.'
      using errcode = 'P0002';
  end if;

  if v_visit.rep_id is distinct from auth.uid() then
    raise exception 'You can only set a location from your own visit.'
      using errcode = '42501';
  end if;

  -- current_org_id() returns null for a deactivated profile, so a rep who has
  -- been switched off cannot write even while holding a valid session.
  if v_visit.org_id is distinct from public.current_org_id() then
    raise exception 'You can only set a location from your own visit.'
      using errcode = '42501';
  end if;

  if v_visit.status <> 'checked_in' then
    raise exception 'Check in at the store before setting its location.'
      using errcode = '42501';
  end if;

  -- Anchor the point to where the rep actually checked in. Without this, a
  -- forgotten check-out means a rep could set a store's location from home
  -- that evening without meaning any harm by it.
  if v_visit.checkin_lat is not null and v_visit.checkin_lng is not null then
    v_drift := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_visit.checkin_lat) / 2), 2)
      + cos(radians(v_visit.checkin_lat)) * cos(radians(p_lat))
        * power(sin(radians(p_lng - v_visit.checkin_lng) / 2), 2)
    ));
    if v_drift > c_max_drift_m then
      raise exception 'You are %m from where you checked in, so this is not the store.',
        round(v_drift)
        using errcode = '42501';
    end if;
  end if;

  -- `lat is null` is the whole safety story for existing data: this can create
  -- a location but can never overwrite one, so a geocoded point a manager has
  -- already reviewed is untouchable from a phone.
  update public.stores s
     set lat                = p_lat,
         lng                = p_lng,
         geocoded_at        = now(),
         geocode_source     = 'rep',
         geocode_result     = null,
         geocode_accuracy_m = p_accuracy_m,
         geocode_visit_id   = v_visit.id
   where s.id = v_visit.store_id
     and s.org_id = v_visit.org_id
     and s.lat is null
     and s.lng is null
  returning jsonb_build_object(
    'store_id',   s.id,
    'lat',        s.lat,
    'lng',        s.lng,
    'accuracy_m', s.geocode_accuracy_m
  ) into v_result;

  -- A PostgREST update that matches nothing succeeds silently; a function that
  -- matched nothing says so. Two reps in the same shop can both tap the button
  -- and the second one lands here.
  if v_result is null then
    raise exception 'This store already has a location.'
      using errcode = '55000';
  end if;

  return v_result;
end;
$$;

comment on function public.set_store_location_from_visit is
  'Writes a store''s coordinates from the rep''s own GPS during a checked-in visit. Refuses unless the caller is that rep, the store has no location yet, the fix is accurate to 50m, and the rep is near where they checked in. Never overwrites an existing location.';

revoke all on function public.set_store_location_from_visit(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.set_store_location_from_visit(uuid, double precision, double precision, double precision) to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260728202752', 'rep_captures_store_location')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 42/76  20260728221554_create_store_geocode_capture_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Who put a store on the map, and during which visit.
--
-- `stores.geocode_visit_id` records the visit a rep-captured location was taken
-- during, but a visit id is not something a manager can read. This resolves it
-- to a name and a time, so "Rep on site" in the dashboard can say *which* rep
-- and *when* rather than asserting trust and leaving it there.
--
-- One function rather than a PostgREST embed. `stores` and `visits` are joined
-- by two foreign keys in opposite directions — stores_geocode_visit_id_fkey and
-- visits_store_id_fkey — so an embed has to be disambiguated by constraint name
-- and nested a second time to reach the rep's name, and the Stores page reads
-- `select("*")`, which is what makes every row a plain Tables<"stores">.
-- Changing that select would change the inferred row type across a dozen
-- signatures on that page for the sake of one nullable name. This follows
-- store_last_visit instead: an aggregate keyed by store id, merged client-side,
-- where a store with nothing to say simply has no row.
create or replace function public.store_geocode_capture()
returns table (
  store_id         uuid,
  visit_id         uuid,
  rep_id           uuid,
  rep_name         text,
  visit_checkin_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  )
  select s.id, v.id, v.rep_id, p.full_name, v.checkin_at
  from stores s
  cross join cfg
  -- The visit is re-scoped to the org rather than trusted through the store:
  -- this runs security invoker, so RLS already filters both, but the join
  -- condition says out loud that a capture never crosses an org boundary.
  join visits v on v.id = s.geocode_visit_id and v.org_id = cfg.org
  -- Left, not inner. If a rep's profile is ever removed the store should still
  -- report that its location was captured during a visit, with the name
  -- unknown, rather than silently losing its provenance.
  left join profiles p on p.id = v.rep_id
  where s.org_id = cfg.org
    and s.geocode_visit_id is not null;
$$;

comment on function public.store_geocode_capture is
  'The rep and visit behind each store location captured in the field. Deliberately not filtered on geocode_source = ''rep'': clearing a coordinate keeps geocode_visit_id, so a withdrawn capture still has a rep worth naming in the past tense. The caller decides the wording.';

insert into supabase_migrations.schema_migrations (version, name)
values ('20260728221554', 'create_store_geocode_capture_rpc')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 43/76  20260728223143_add_store_location_confirmation.sql
-- ──────────────────────────────────────────────────────────────────────────

-- A person has looked at this store's position and vouched for it.
--
-- Deliberately separate from `geocode_source`. That column says where a
-- coordinate came from; these two say that a human checked it, which is a
-- different fact with a different lifetime. A store can be geocoded twice and
-- confirmed once, or confirmed and then re-geocoded — and it is the second case
-- that makes this worth storing rather than inferring.
--
-- Learned expensively: a batch geocode re-ran over 31 stores whose coordinates
-- a person had already judged wrong and cleared, and silently re-applied the
-- same wrong answers, because nothing in the schema recorded that a human had
-- already ruled on them. `geocode_result` was preserved for exactly that
-- purpose and only a comment asked anyone to honour it. A comment is not a
-- constraint. This is the fact an automatic run must check before it writes.
--
-- The point of the whole feature is a new customer importing thousands of
-- stores: the ones that cannot be trusted surface for review, a person confirms
-- or repositions each, and nothing automatic touches them again afterwards.
alter table public.stores
  add column if not exists location_confirmed_at timestamptz,
  add column if not exists location_confirmed_by uuid
    references public.profiles(id) on delete set null;

comment on column public.stores.location_confirmed_at is
  'When a person confirmed this store is where the map says. Null means nobody has ruled on it. Survives re-geocoding on purpose — an automatic run must not clear or overwrite it.';
comment on column public.stores.location_confirmed_by is
  'Who confirmed it. Set null if that profile is removed, keeping the confirmation itself intact — that it was checked matters more than by whom.';

-- The review queue reads "unconfirmed, in this org" on every load, and for a
-- customer with thousands of stores that is the query that has to stay cheap.
-- Partial, because confirmed rows are exactly the ones it never asks for.
create index if not exists stores_org_unconfirmed_idx
  on public.stores (org_id)
  where location_confirmed_at is null;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260728223143', 'add_store_location_confirmation')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 44/76  20260728224851_rep_capture_confirms_location.sql
-- ──────────────────────────────────────────────────────────────────────────

-- A rep standing in the shop is a confirmation, and the strongest one there is.
--
-- `set_store_location_from_visit` recorded where the coordinate came from but
-- left `location_confirmed_at` null, which put every rep-captured store back in
-- the review queue for a manager at a desk to second-guess — and, once a rep
-- may not be assigned to an unconfirmed store, would have made a rep's own
-- fieldwork block their own assignment.
--
-- The confirmation is attributed to the rep, because they are the person who
-- checked it. That is what `location_confirmed_by` is for.
--
-- Everything else about the function is unchanged; see
-- 20260728222613_rep_captures_store_location.sql for the guards and why each
-- one is there.
create or replace function public.set_store_location_from_visit(
  p_visit_client_id uuid,
  p_lat             double precision,
  p_lng             double precision,
  p_accuracy_m      double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Keep in step with kMaxLocationAccuracyM in mobile/lib/core/location_service.dart.
  c_max_accuracy_m constant double precision := 50;
  c_max_drift_m constant double precision := 500;

  v_visit  record;
  v_drift  double precision;
  v_result jsonb;
begin
  if p_lat is null or p_lng is null then
    raise exception 'A latitude and longitude are required.'
      using errcode = '22023';
  end if;

  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Those coordinates are not a real place.'
      using errcode = '22023';
  end if;

  if p_lat = 0 and p_lng = 0 then
    raise exception 'Your phone did not report a real position. Try again.'
      using errcode = '22023';
  end if;

  if p_accuracy_m is null or p_accuracy_m <= 0 then
    raise exception 'The fix reported no accuracy, so it cannot be trusted.'
      using errcode = '22023';
  end if;

  if p_accuracy_m > c_max_accuracy_m then
    raise exception 'This GPS fix is only accurate to %m. Step outside the building and try again.',
      round(p_accuracy_m)
      using errcode = '22023';
  end if;

  select v.id, v.store_id, v.org_id, v.rep_id, v.status,
         v.checkin_lat, v.checkin_lng
    into v_visit
  from public.visits v
  where v.client_generated_id = p_visit_client_id;

  if not found then
    raise exception 'This visit has not reached the server yet. Connect and try again.'
      using errcode = 'P0002';
  end if;

  if v_visit.rep_id is distinct from auth.uid() then
    raise exception 'You can only set a location from your own visit.'
      using errcode = '42501';
  end if;

  if v_visit.org_id is distinct from public.current_org_id() then
    raise exception 'You can only set a location from your own visit.'
      using errcode = '42501';
  end if;

  if v_visit.status <> 'checked_in' then
    raise exception 'Check in at the store before setting its location.'
      using errcode = '42501';
  end if;

  if v_visit.checkin_lat is not null and v_visit.checkin_lng is not null then
    v_drift := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_visit.checkin_lat) / 2), 2)
      + cos(radians(v_visit.checkin_lat)) * cos(radians(p_lat))
        * power(sin(radians(p_lng - v_visit.checkin_lng) / 2), 2)
    ));
    if v_drift > c_max_drift_m then
      raise exception 'You are %m from where you checked in, so this is not the store.',
        round(v_drift)
        using errcode = '42501';
    end if;
  end if;

  update public.stores s
     set lat                   = p_lat,
         lng                   = p_lng,
         geocoded_at           = now(),
         geocode_source        = 'rep',
         geocode_result        = null,
         geocode_accuracy_m    = p_accuracy_m,
         geocode_visit_id      = v_visit.id,
         -- The new part: measuring it on site settles it. No desk review can
         -- improve on a person who was standing in the door.
         location_confirmed_at = now(),
         location_confirmed_by = v_visit.rep_id
   where s.id = v_visit.store_id
     and s.org_id = v_visit.org_id
     and s.lat is null
     and s.lng is null
  returning jsonb_build_object(
    'store_id',   s.id,
    'lat',        s.lat,
    'lng',        s.lng,
    'accuracy_m', s.geocode_accuracy_m
  ) into v_result;

  if v_result is null then
    raise exception 'This store already has a location.'
      using errcode = '55000';
  end if;

  return v_result;
end;
$$;

comment on function public.set_store_location_from_visit is
  'Writes a store''s coordinates from the rep''s own GPS during a checked-in visit, and records it as confirmed by that rep. Refuses unless the caller is that rep, the store has no location yet, the fix is accurate to 50m, and the rep is near where they checked in. Never overwrites an existing location.';

revoke all on function public.set_store_location_from_visit(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.set_store_location_from_visit(uuid, double precision, double precision, double precision) to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260728224851', 'rep_capture_confirms_location')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 45/76  20260729062249_create_workday_trail_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- What the GPS trail actually shows, as opposed to what the phone reported.
--
-- `workday_sessions.distance_meters` is accumulated on the device between
-- 20-minute samples and written once, when the rep ends their day. It cannot be
-- audited, it reads 0 all day for a session still open, and it is lost entirely
-- if the app is killed before the day is ended. In the current data one session
-- claims 4,371 m of travel while holding **no pings at all** — there is nothing
-- on the server that could corroborate or refute it.
--
-- This derives the same quantity from `location_pings`, which is the evidence
-- itself. Same underlying samples, so it is no more precise — but it is
-- checkable, it works mid-day, and it can say how much of the day it did not
-- see, which is the part that decides whether the number means anything.
--
-- It does not replace the reported figure. Both are returned, because the gap
-- between them is information: it is how you find a rep whose app was killed,
-- or a phone that spent the afternoon with location services off.
--
-- Sums straight-line chords between consecutive fixes, so it is a floor on
-- road distance, never an estimate of it. Nothing here should be used to pay
-- anyone; see the Time & Mileage note in the handoff for why.
--
-- It is also, on the evidence, *more* accurate than the device's own figure.
-- The one session ever checked against a known route reported 4,965 m; its
-- pings describe a round trip of 4,959 m each way. The phone dropped the entire
-- outbound leg, because `recordIntervalPing` measures from the previous
-- *interval* ping and has none to measure from on the first one — it ignores
-- the `workday_start` fix sitting right there. This function starts the trail
-- at whichever fix came first, whatever its source, so the first leg survives.
create or replace function public.workday_trail(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  session_id       uuid,
  rep_id           uuid,
  rep_name         text,
  started_at       timestamptz,
  ended_at         timestamptz,
  duration_seconds int,
  reported_m       double precision,
  trail_m          double precision,
  legs             int,
  dropped_legs     int,
  max_gap_seconds  int,
  worst_accuracy_m double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  -- Each ping paired with the one before it, within its own session.
  steps as (
    select
      lp.workday_session_id as sid,
      public.haversine_m(
        lag(lp.lat) over w, lag(lp.lng) over w, lp.lat, lp.lng
      ) as leg_m,
      extract(epoch from lp.recorded_at - lag(lp.recorded_at) over w) as gap_s,
      greatest(lp.accuracy_m, lag(lp.accuracy_m) over w) as leg_accuracy_m
    from location_pings lp
    cross join cfg
    where lp.org_id = cfg.org
      and lp.workday_session_id is not null
    window w as (
      partition by lp.workday_session_id order by lp.recorded_at
    )
  ),
  -- Aggregated per session before anything is joined to it. Joining sessions
  -- to pings and aggregating afterwards fans out — the same trap that needed
  -- correcting twice already in the schedule and OOS reports.
  trail as (
    select
      s.sid,
      -- A leg implying more than 200 km/h is not a rep driving; it is a stale
      -- last-known fix, which `LocationService` returns rather than failing.
      -- Counted rather than silently included, because a single bogus leg can
      -- be larger than the rest of the day put together.
      coalesce(sum(s.leg_m) filter (
        where s.gap_s > 0 and (s.leg_m / s.gap_s) <= 55.6
      ), 0)::double precision as trail_m,
      count(*) filter (
        where s.leg_m is not null and s.gap_s > 0 and (s.leg_m / s.gap_s) <= 55.6
      )::int as legs,
      count(*) filter (
        where s.leg_m is not null and (s.gap_s is null or s.gap_s <= 0
              or (s.leg_m / s.gap_s) > 55.6)
      )::int as dropped_legs,
      -- The honesty column. Twenty-minute sampling with no background service
      -- means a long gap is a stretch of the day nobody observed, and a trail
      -- across it is a straight line drawn through the unknown.
      coalesce(max(s.gap_s), 0)::int as max_gap_seconds,
      max(s.leg_accuracy_m) as worst_accuracy_m
    from steps s
    group by s.sid
  )
  select
    ws.id,
    ws.rep_id,
    p.full_name,
    ws.started_at,
    ws.ended_at,
    ws.duration_seconds,
    ws.distance_meters,
    coalesce(t.trail_m, 0),
    coalesce(t.legs, 0),
    coalesce(t.dropped_legs, 0),
    coalesce(t.max_gap_seconds, 0),
    t.worst_accuracy_m
  from workday_sessions ws
  cross join cfg
  left join profiles p on p.id = ws.rep_id
  left join trail t on t.sid = ws.id
  where ws.org_id = cfg.org
    and ws.started_at >= p_from
    and ws.started_at < p_to
  order by ws.started_at desc;
$$;

comment on function public.workday_trail is
  'Per workday session: the distance the phone reported alongside the distance its own pings actually support, plus how much of the day went unobserved. Straight-line chords between fixes, so a floor on road distance and not a basis for payment.';

-- The review query is org-wide over a date range, which is this table's whole
-- access pattern and the one index it lacked. `visits` has had the equivalent
-- (visits_org_checkin_at_idx) since the assignments migration.
create index if not exists workday_sessions_org_started_at_idx
  on public.workday_sessions (org_id, started_at desc);

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729062249', 'create_workday_trail_rpc')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 46/76  20260729074623_close_abandoned_workday.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Let a manager close a workday a rep never ended.
--
-- `workday_sessions_update` allows the rep and nobody else, which is right for
-- the ordinary case and leaves no way out of the common one: the app is killed,
-- the phone dies, or the rep simply forgets, and the session stays open with a
-- null `ended_at` and a null `duration_seconds` for ever. It then counts as an
-- open day against every later report, and no one — not the rep, who has moved
-- on, and not the manager, whom RLS refuses — can correct it.
--
-- Two things this deliberately does not do.
--
-- It does not end the day at `now()`. That would credit the rep with every hour
-- between walking away and somebody noticing, which could be days. The day ends
-- at the last position actually recorded, which is the last moment there is any
-- evidence they were working. With no pings at all there is no evidence of any
-- work, so it closes at the start: a zero-length day, which is the honest
-- reading of a session with nothing in it.
--
-- It does not pretend the rep did it. `ended_by` records the manager, so a
-- closed-out day is distinguishable for ever from one the rep ended properly.
-- Without that column the row would simply assert the rep finished at a time
-- they did not, and nothing downstream could tell the difference.
alter table public.workday_sessions
  add column if not exists ended_by uuid
    references public.profiles(id) on delete set null;

comment on column public.workday_sessions.ended_by is
  'Null when the rep ended their own day, which is the normal case. Set to the manager who closed a session the rep abandoned — the day''s end time is then inferred, not reported.';

create or replace function public.close_abandoned_workday(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- A rep on a long day must never be closed out from under themselves. Twelve
  -- hours is past any real shift here while still catching yesterday's ghost
  -- the next morning.
  c_min_age interval := interval '12 hours';

  v_session record;
  v_last_ping timestamptz;
  v_ends_at timestamptz;
  v_result jsonb;
begin
  if public.current_role() is distinct from 'manager' then
    raise exception 'Only a manager can close someone else''s workday.'
      using errcode = '42501';
  end if;

  select ws.id, ws.org_id, ws.rep_id, ws.started_at, ws.ended_at
    into v_session
  from public.workday_sessions ws
  where ws.id = p_session_id;

  if not found then
    raise exception 'That workday no longer exists.' using errcode = 'P0002';
  end if;

  -- current_org_id() is null for a deactivated profile, so a switched-off
  -- manager holding a live session cannot write either.
  if v_session.org_id is distinct from public.current_org_id() then
    raise exception 'That workday belongs to another organisation.'
      using errcode = '42501';
  end if;

  if v_session.ended_at is not null then
    raise exception 'That workday has already been closed.'
      using errcode = '55000';
  end if;

  if v_session.started_at > now() - c_min_age then
    raise exception 'That workday started less than 12 hours ago and may still be in progress.'
      using errcode = '55000';
  end if;

  select max(lp.recorded_at) into v_last_ping
  from public.location_pings lp
  where lp.workday_session_id = v_session.id;

  v_ends_at := coalesce(v_last_ping, v_session.started_at);

  update public.workday_sessions ws
     set ended_at         = v_ends_at,
         ended_by         = auth.uid(),
         duration_seconds = greatest(
           extract(epoch from v_ends_at - ws.started_at)::int, 0)
   where ws.id = v_session.id
     -- Re-checked in the WHERE clause, not just above: two managers looking at
     -- the same stale list must not both close it, and the second one should
     -- be told rather than silently succeeding.
     and ws.ended_at is null
  returning jsonb_build_object(
    'session_id',       ws.id,
    'ended_at',         ws.ended_at,
    'duration_seconds', ws.duration_seconds,
    'inferred_from',    case when v_last_ping is null
                             then 'no positions recorded'
                             else 'last recorded position' end
  ) into v_result;

  if v_result is null then
    raise exception 'That workday was closed by someone else a moment ago.'
      using errcode = '55000';
  end if;

  return v_result;
end;
$$;

comment on function public.close_abandoned_workday is
  'Closes a workday the rep never ended, at the last position recorded rather than at now(), and records which manager closed it. Refuses on a session under 12 hours old, one already closed, or one outside the caller''s org.';

revoke all on function public.close_abandoned_workday(uuid) from public, anon;
grant execute on function public.close_abandoned_workday(uuid) to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729074623', 'close_abandoned_workday')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 47/76  20260729080525_rep_fix_supersedes_a_guess.sql
-- ──────────────────────────────────────────────────────────────────────────

-- A rep standing in the shop outranks anything that guessed at it.
--
-- The first version of this function refused when a store already had
-- coordinates, on the reasoning that a location should never be overwritten.
-- That was the wrong shape for this estate. 194 of 209 stores hold a Google
-- Places guess, and a guess is exactly what a rep on site is qualified to
-- replace — so the guard meant the one instrument that actually works could
-- never be used on the stores that most needed it.
--
-- The rule is now about *provenance*, not about emptiness: a rep's fix
-- supersedes anything that is not itself a rep's fix. Places, address lookups,
-- and points a manager accepted from a desk all yield. Another rep's on-site
-- capture does not — two people who both stood in the shop do not need this
-- function to arbitrate between them, and silently letting the second one
-- overwrite the first would hide a disagreement worth seeing. That case is
-- caught by drift detection instead, which watches where check-ins land and
-- flags the store rather than moving it.
--
-- Everything else is unchanged; see 20260728222613 for the guards and why each
-- one exists, and 20260729004747 for why a capture confirms the location.
create or replace function public.set_store_location_from_visit(
  p_visit_client_id uuid,
  p_lat             double precision,
  p_lng             double precision,
  p_accuracy_m      double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Keep in step with kMaxLocationAccuracyM in mobile/lib/core/location_service.dart.
  c_max_accuracy_m constant double precision := 50;
  c_max_drift_m constant double precision := 500;

  v_visit  record;
  v_store  record;
  v_drift  double precision;
  v_moved  double precision;
  v_result jsonb;
begin
  if p_lat is null or p_lng is null then
    raise exception 'A latitude and longitude are required.' using errcode = '22023';
  end if;

  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Those coordinates are not a real place.' using errcode = '22023';
  end if;

  if p_lat = 0 and p_lng = 0 then
    raise exception 'Your phone did not report a real position. Try again.' using errcode = '22023';
  end if;

  if p_accuracy_m is null or p_accuracy_m <= 0 then
    raise exception 'The fix reported no accuracy, so it cannot be trusted.' using errcode = '22023';
  end if;

  if p_accuracy_m > c_max_accuracy_m then
    raise exception 'This GPS fix is only accurate to %m. Step outside the building and try again.',
      round(p_accuracy_m) using errcode = '22023';
  end if;

  select v.id, v.store_id, v.org_id, v.rep_id, v.status,
         v.checkin_lat, v.checkin_lng
    into v_visit
  from public.visits v
  where v.client_generated_id = p_visit_client_id;

  if not found then
    raise exception 'This visit has not reached the server yet. Connect and try again.'
      using errcode = 'P0002';
  end if;

  if v_visit.rep_id is distinct from auth.uid() then
    raise exception 'You can only set a location from your own visit.' using errcode = '42501';
  end if;

  if v_visit.org_id is distinct from public.current_org_id() then
    raise exception 'You can only set a location from your own visit.' using errcode = '42501';
  end if;

  if v_visit.status <> 'checked_in' then
    raise exception 'Check in at the store before setting its location.' using errcode = '42501';
  end if;

  if v_visit.checkin_lat is not null and v_visit.checkin_lng is not null then
    v_drift := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_visit.checkin_lat) / 2), 2)
      + cos(radians(v_visit.checkin_lat)) * cos(radians(p_lat))
        * power(sin(radians(p_lng - v_visit.checkin_lng) / 2), 2)
    ));
    if v_drift > c_max_drift_m then
      raise exception 'You are %m from where you checked in, so this is not the store.',
        round(v_drift) using errcode = '42501';
    end if;
  end if;

  select s.id, s.lat, s.lng, s.geocode_source
    into v_store
  from public.stores s
  where s.id = v_visit.store_id and s.org_id = v_visit.org_id;

  if not found then
    raise exception 'That store is no longer in your organisation.' using errcode = '42501';
  end if;

  -- The one location this will not touch.
  if v_store.geocode_source = 'rep' then
    raise exception 'Another rep already set this store''s location on site. If it looks wrong, tell your manager — do not overwrite it.'
      using errcode = '55000';
  end if;

  -- How far the shop is about to move, for the record. Null when it had no
  -- location at all, which is the ordinary first capture.
  if v_store.lat is not null and v_store.lng is not null then
    v_moved := public.haversine_m(v_store.lat, v_store.lng, p_lat, p_lng);
  end if;

  update public.stores s
     set lat                   = p_lat,
         lng                   = p_lng,
         geocoded_at           = now(),
         geocode_source        = 'rep',
         -- What the guesser thought is no longer relevant to where the shop is,
         -- and leaving it would make an automatic run treat this as a store
         -- someone had ruled against rather than one now settled.
         geocode_result        = null,
         geocode_accuracy_m    = p_accuracy_m,
         geocode_visit_id      = v_visit.id,
         location_confirmed_at = now(),
         location_confirmed_by = v_visit.rep_id
   where s.id = v_store.id
     -- Re-read in the WHERE clause so two reps checking in at the same moment
     -- cannot both decide the store was unclaimed.
     and (s.geocode_source is distinct from 'rep')
  returning jsonb_build_object(
    'store_id',   s.id,
    'lat',        s.lat,
    'lng',        s.lng,
    'accuracy_m', s.geocode_accuracy_m,
    'moved_m',    round(v_moved::numeric, 1)
  ) into v_result;

  if v_result is null then
    raise exception 'Another rep set this store''s location a moment ago.'
      using errcode = '55000';
  end if;

  return v_result;
end;
$$;

comment on function public.set_store_location_from_visit is
  'Writes a store''s coordinates from the rep''s own GPS during a checked-in visit and records it as confirmed by that rep. Supersedes a geocoded or desk-set point; refuses to overwrite another rep''s on-site capture, which drift detection handles instead. Requires the caller to be the rep on that visit, a fix accurate to 50m, and a position within 500m of their check-in.';

revoke all on function public.set_store_location_from_visit(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.set_store_location_from_visit(uuid, double precision, double precision, double precision) to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729080525', 'rep_fix_supersedes_a_guess')
on conflict (version) do nothing;


-- ──────────────────────────────────────────────────────────────────────────
-- 48/76  20260729080754_create_store_location_drift_rpc.sql
-- ──────────────────────────────────────────────────────────────────────────

-- Does the store still seem to be where we think it is?
--
-- Once a rep has set a location on site, nothing overwrites it — not another
-- rep, not a geocoder. That is deliberate, but it means a mistaken first
-- capture would be wrong for ever unless something watched. This is the watch.
--
-- Every check-in already records `checkin_distance_from_store_m`. A store whose
-- visits keep landing hundreds of metres away is telling you something, and
-- which of the two possible things it is telling you matters:
--
--   * the stored point is wrong — visits cluster somewhere else, consistently,
--     across more than one rep;
--   * the reps are not going in — visits are scattered, or it is one rep.
--
-- The difference is in the spread. A tight cluster far from the point is a
-- wrong point; a loose scatter is behaviour. So this reports both the typical
-- distance and how much the check-ins agree with each other, and leaves the
-- judgement to a person. It moves nothing.
--
-- Deliberately median, not mean: one check-in recorded from the car park on the
-- way past should not drag an otherwise consistent store into the report, and
-- one wild fix should not create a false alarm.
create or replace function public.store_location_drift(
  p_min_visits int default 3,
  p_min_median_m double precision default 150
)
returns table (
  store_id          uuid,
  store_name        text,
  city              text,
  visits_considered int,
  reps_involved     int,
  median_offset_m   double precision,
  spread_m          double precision,
  cluster_lat       double precision,
  cluster_lng       double precision,
  cluster_offset_m  double precision,
  geofence_radius_m int,
  location_source   text,
  last_visit_at     timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  -- Only check-ins that carry a position and a distance. A visit with no fix
  -- says nothing either way and must not be counted as agreement.
  recent as (
    select v.store_id, v.rep_id, v.checkin_at, v.checkin_lat, v.checkin_lng,
           v.checkin_distance_from_store_m as offset_m
    from visits v
    cross join cfg
    where v.org_id = cfg.org
      and v.checkin_at is not null
      and v.checkin_lat is not null
      and v.checkin_lng is not null
      and v.checkin_distance_from_store_m is not null
  ),
  -- Aggregated per store before joining to stores, so the store row cannot
  -- fan out across its visits — the same trap that needed correcting in the
  -- schedule and OOS reports.
  agg as (
    select
      r.store_id,
      count(*)::int as visits_considered,
      count(distinct r.rep_id)::int as reps_involved,
      percentile_cont(0.5) within group (order by r.offset_m) as median_offset_m,
      -- How much the check-ins agree with each other. Half the gap between the
      -- quartiles: small means they keep landing in the same wrong place.
      (percentile_cont(0.75) within group (order by r.offset_m)
       - percentile_cont(0.25) within group (order by r.offset_m)) / 2 as spread_m,
      avg(r.checkin_lat) as cluster_lat,
      avg(r.checkin_lng) as cluster_lng,
      max(r.checkin_at) as last_visit_at
    from recent r
    group by r.store_id
  )
  select
    s.id,
    s.name,
    s.city,
    a.visits_considered,
    a.reps_involved,
    round(a.median_offset_m::numeric, 1)::double precision,
    round(a.spread_m::numeric, 1)::double precision,
    a.cluster_lat,
    a.cluster_lng,
    -- Where the check-ins actually cluster, and how far that is from the point
    -- on file. This is the suggestion a manager would act on — never applied
    -- automatically, because the centroid of a few fixes is not a shopfront.
    public.haversine_m(s.lat, s.lng, a.cluster_lat, a.cluster_lng)::double precision,
    s.geofence_radius_m,
    s.geocode_source,
    a.last_visit_at
  from agg a
  join stores s on s.id = a.store_id
  cross join cfg
  where s.org_id = cfg.org
    and s.active
    and s.lat is not null
    and a.visits_considered >= p_min_visits
    -- Judged against the store's own geofence as well as the flat threshold: a
    -- large site legitimately has people checking in further from its centre.
    and a.median_offset_m >= greatest(p_min_median_m, s.geofence_radius_m)
  order by a.median_offset_m desc;
$$;

comment on function public.store_location_drift is
  'Stores whose check-ins keep landing far from the recorded position. Reports the typical offset, how tightly the check-ins agree, and where they cluster. Read spread_m first: a small spread with a large median means the stored point is wrong and cluster_lat/lng is worth offering as a correction; a large spread means the visits are scattered and the cluster is a meaningless average of them — do not offer it. Suggests, never moves.';

-- The drift query reads every check-in in the org with a position. That is the
-- fastest-growing table here and this will run on a dashboard.
create index if not exists visits_org_store_checkin_idx
  on public.visits (org_id, store_id, checkin_at desc)
  where checkin_lat is not null;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260729080754', 'create_store_location_drift_rpc')
on conflict (version) do nothing;

commit;
