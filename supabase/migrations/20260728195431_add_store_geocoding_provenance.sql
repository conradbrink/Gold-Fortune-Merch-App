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
