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
