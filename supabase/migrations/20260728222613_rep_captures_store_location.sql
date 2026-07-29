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
