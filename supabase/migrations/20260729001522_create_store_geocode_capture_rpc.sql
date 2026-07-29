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
