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
