-- Off-site check-ins are measured against the store's pin as it is now
-- (owner: "Both", 7 Oct 2026, after the off-site list showed most of one rep's
-- flags were bad pins rather than the rep).
--
-- 20261007160113 used visits.checkin_distance_from_store_m, the distance the
-- phone saved at check-in. When a pin is corrected afterwards, that saved
-- distance still points at the old, wrong pin, so the flag never clears: two
-- Tlokweng stores showed 2–3 km for check-ins that are now exactly on their pin.
-- The distance is now haversine_m(check-in point, current pin); the saved
-- distance is only the fallback for a check-in with no coordinates.
--
-- The same day, three store pins were corrected as a data fix (two Sefalana
-- stores swapped; Liquorama Block 8 moved to where its visits are). Last 30
-- days as the manager: 30 → 21 with this rule → 12 with the pins fixed.
-- Rehearsed in a rolled-back transaction first. Signature, grants and module
-- are unchanged, and dashboard_business still counts this function.

create or replace function public.offsite_checkins(p_from timestamptz, p_to timestamptz)
returns table (
  visit_id uuid,
  checkin_at timestamptz,
  rep_id uuid,
  rep_name text,
  store_id uuid,
  store_name text,
  distance_m double precision,
  gps_accuracy_m double precision,
  checkin_lat double precision,
  checkin_lng double precision,
  store_lat double precision,
  store_lng double precision,
  off_site_m double precision
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with t as (
    select coalesce((public.company_setting('off_site_distance_m') #>> '{}')::double precision, 500) as off_site_m,
           coalesce((public.company_setting('invalid_gps_distance_m') #>> '{}')::double precision, 5000) as invalid_m
  )
  select v.id, v.checkin_at, v.rep_id, p.full_name, s.id, s.name,
         d.m,
         v.checkin_gps_accuracy_m::double precision,
         v.checkin_lat::double precision, v.checkin_lng::double precision,
         s.lat::double precision, s.lng::double precision,
         t.off_site_m
  from public.visits v
  join public.stores s on s.id = v.store_id
  left join public.profiles p on p.id = v.rep_id
  cross join t
  -- Measured against the store's pin as it is now, not the distance the phone
  -- saved at check-in: a pin corrected later clears the flags it caused. The
  -- saved distance is only the fallback for a check-in without coordinates.
  cross join lateral (
    select case
             when v.checkin_lat is not null and v.checkin_lng is not null
              and s.lat is not null and s.lng is not null
             then public.haversine_m(v.checkin_lat::double precision, v.checkin_lng::double precision,
                                     s.lat::double precision, s.lng::double precision)
             else v.checkin_distance_from_store_m::double precision
           end as m
  ) d
  where v.org_id = public.current_org_id()
    and v.checkin_at >= p_from and v.checkin_at < p_to
    and d.m is not null
    and s.location_confirmed_at is not null
    and d.m - coalesce(v.checkin_gps_accuracy_m, 0) > t.off_site_m
    and d.m <= t.invalid_m
  order by v.checkin_at desc
$$;

revoke all on function public.offsite_checkins(timestamptz, timestamptz) from public, anon;
grant execute on function public.offsite_checkins(timestamptz, timestamptz) to authenticated;
