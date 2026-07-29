-- What the AI plan critic reads.
--
-- The manager sets the call cycle by hand; these functions describe the result
-- so a model can say what is wrong with it. Every number is computed here — the
-- model is given prose to write, never arithmetic to do.

-- The haversine formula already existed inline inside activity_feed
-- (20260727121757). Lifting it into one immutable function means there is a
-- single copy to be wrong.
--
-- `strict` is the important word: a null coordinate yields null rather than a
-- confidently wrong distance. activity_feed is deliberately left alone — it is
-- verified, and rewriting it is not part of this change.
create or replace function public.haversine_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns numeric
language sql
immutable
strict
parallel safe
set search_path = public
as $$
  select round((6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
    * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::numeric, 1);
$$;

comment on function public.haversine_m is
  'Straight-line metres between two points. Strict: a null coordinate returns null, never 0.';

-- One row per (rep, weekday) that actually carries stores.
--
-- The cycle / days / matched CTEs are deliberately identical to
-- generate_routes (20260727211122). The critic must review exactly the plan the
-- generator will write — if these two ever drift, the AI is commenting on a
-- schedule that does not exist.
create or replace function public.call_cycle_review(p_weeks int default 8)
returns table (
  rep_id              uuid,
  rep_name            text,
  day_of_week         smallint,
  peak_stores         int,
  avg_stores          numeric,
  occurrences         int,
  cities              text[],
  stores_without_city int,
  span_km             numeric,
  frequency_mix       jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           current_date + 1 as d_from,
           current_date + (greatest(least(coalesce(p_weeks, 8), 52), 1) * 7) as d_to
  ),
  cycle as (
    select sa.rep_id, sa.store_id, sa.day_of_week,
           coalesce(sa.week_of_cycle, 1) as week_of_cycle,
           s.visit_frequency, s.city, s.name, s.lat, s.lng
    from store_assignments sa
    join stores s on s.id = sa.store_id
    cross join cfg
    where sa.org_id = cfg.org
      and s.active
      and sa.day_of_week is not null
  ),
  days as (
    select d::date as the_day
    from cfg, generate_series(cfg.d_from, cfg.d_to, interval '1 day') d
  ),
  matched as (
    select c.rep_id, c.store_id, c.day_of_week, c.visit_frequency,
           c.city, c.name, c.lat, c.lng, d.the_day
    from cycle c
    join days d
      on extract(isodow from d.the_day)::int = c.day_of_week
     and case c.visit_frequency
           when 'weekly' then true
           when 'biweekly' then
             (extract(week from d.the_day)::int % 2) = (c.week_of_cycle % 2)
           when 'monthly' then
             ((extract(day from d.the_day)::int - 1) / 7) + 1 = c.week_of_cycle
           else false
         end
  ),
  occ as (
    select m.rep_id, m.day_of_week, m.the_day, count(*)::int as stores
    from matched m
    group by m.rep_id, m.day_of_week, m.the_day
  ),
  -- The busiest single occurrence, not the total. A rep with four monthly
  -- stores on a Tuesday is not carrying four stores every Tuesday, and a
  -- figure that said so would advise against a perfectly sensible plan.
  peak as (
    select distinct on (o.rep_id, o.day_of_week)
           o.rep_id, o.day_of_week, o.the_day as peak_day, o.stores as peak_stores
    from occ o
    order by o.rep_id, o.day_of_week, o.stores desc, o.the_day
  ),
  spread as (
    select o.rep_id, o.day_of_week,
           round(avg(o.stores)::numeric, 1) as avg_stores,
           count(*)::int as occurrences
    from occ o
    group by o.rep_id, o.day_of_week
  ),
  peak_detail as (
    select m.rep_id, m.day_of_week, m.store_id, m.city, m.lat, m.lng
    from matched m
    join peak p
      on p.rep_id = m.rep_id
     and p.day_of_week = m.day_of_week
     and p.peak_day = m.the_day
  ),
  places as (
    select d.rep_id, d.day_of_week,
           array_agg(distinct d.city) filter (where d.city is not null) as cities,
           count(*) filter (where d.city is null)::int as stores_without_city,
           count(*) filter (where d.lat is null or d.lng is null)::int as without_coords
    from peak_detail d
    group by d.rep_id, d.day_of_week
  ),
  -- Widest straight-line gap between any two stops on the peak day.
  spans as (
    select a.rep_id, a.day_of_week,
           round(max(public.haversine_m(a.lat, a.lng, b.lat, b.lng)) / 1000.0, 1) as span_km
    from peak_detail a
    join peak_detail b
      on b.rep_id = a.rep_id
     and b.day_of_week = a.day_of_week
     and b.store_id > a.store_id
    group by a.rep_id, a.day_of_week
  ),
  freq as (
    select c.rep_id, c.day_of_week,
           jsonb_object_agg(c.visit_frequency, c.n) as frequency_mix
    from (
      select cy.rep_id, cy.day_of_week, cy.visit_frequency, count(*) as n
      from cycle cy
      group by cy.rep_id, cy.day_of_week, cy.visit_frequency
    ) c
    group by c.rep_id, c.day_of_week
  )
  select p.rep_id,
         pr.full_name,
         p.day_of_week,
         p.peak_stores,
         sp.avg_stores,
         sp.occurrences,
         coalesce(pl.cities, '{}'::text[]),
         pl.stores_without_city,
         -- Null, never 0, when any stop that day has no coordinates: a zero
         -- would read as "these stores are all in the same place", which is the
         -- most misleading thing this function could say. A genuine single-stop
         -- day is 0 — there is no travel between stops.
         case
           when pl.without_coords > 0 then null
           when p.peak_stores = 1 then 0
           else s.span_km
         end,
         f.frequency_mix
  from peak p
  join profiles pr on pr.id = p.rep_id
  join spread sp on sp.rep_id = p.rep_id and sp.day_of_week = p.day_of_week
  left join places pl on pl.rep_id = p.rep_id and pl.day_of_week = p.day_of_week
  left join spans s on s.rep_id = p.rep_id and s.day_of_week = p.day_of_week
  left join freq f on f.rep_id = p.rep_id and f.day_of_week = p.day_of_week
  order by pr.full_name, p.day_of_week;
$$;

comment on function public.call_cycle_review is
  'Per (rep, weekday) call-cycle load over a rolling horizon. Figures are the busiest single occurrence, matching generate_routes.';

-- Everything the plan is missing, in one row.
--
-- call_cycle_review only returns days that carry stores, so on its own it would
-- silently omit exactly the problems worth reporting: a rep with stores but no
-- days, and stores nobody covers at all.
create or replace function public.call_cycle_gaps()
returns table (
  stores_active            int,
  stores_unassigned        int,
  unassigned_store_names   text[],
  stores_without_city      int,
  stores_without_coords    int,
  unplanned_assignments    int,
  unplanned_by_rep         jsonb,
  reps_active              int,
  reps_without_stores      int,
  reps_without_stores_names text[]
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  s as (
    select st.* from stores st cross join cfg
    where st.org_id = cfg.org and st.active
  ),
  r as (
    select p.id, p.full_name from profiles p cross join cfg
    where p.org_id = cfg.org and p.role = 'rep' and p.is_active
  ),
  unassigned as (
    select s.id, s.name from s
    where not exists (select 1 from store_assignments sa where sa.store_id = s.id)
  ),
  unplanned as (
    select sa.rep_id, count(*)::int as n
    from store_assignments sa
    join s on s.id = sa.store_id
    where sa.day_of_week is null
    group by sa.rep_id
  ),
  bare_reps as (
    select r.id, r.full_name from r
    where not exists (select 1 from store_assignments sa where sa.rep_id = r.id)
  )
  select (select count(*)::int from s),
         (select count(*)::int from unassigned),
         -- Capped: the point is that they exist, and a 200-name array would
         -- dominate the prompt for no extra insight.
         (select coalesce(array_agg(u.name order by u.name), '{}'::text[])
          from (select name from unassigned order by name limit 25) u),
         (select count(*)::int from s where s.city is null),
         (select count(*)::int from s where s.lat is null or s.lng is null),
         (select coalesce(sum(n), 0)::int from unplanned),
         (select coalesce(jsonb_object_agg(coalesce(pr.full_name, 'Unknown'), u.n), '{}'::jsonb)
          from unplanned u join profiles pr on pr.id = u.rep_id),
         (select count(*)::int from r),
         (select count(*)::int from bare_reps),
         (select coalesce(array_agg(b.full_name order by b.full_name), '{}'::text[]) from bare_reps b);
$$;

comment on function public.call_cycle_gaps is
  'Org-level call-cycle gaps: stores nobody covers, assignments with no day, and missing location data.';
