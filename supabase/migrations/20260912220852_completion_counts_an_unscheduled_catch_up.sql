-- Visit completion counts a store the rep went back to.
--
-- The owner's request, and it needed measuring before it could be built. The
-- obvious reading — "any later visit at that store counts" — is wrong by a
-- wide margin:
--
--     rep              missed   caught up by ANY visit   by an UNSCHEDULED one
--     Tshepo Mmereki      165                       72                      11
--     Jerry Habana         81                       42                      42
--     Atang Kheumla        79                       40                       3
--
-- For Atang, 37 of those 40 "catch-ups" were the store's **next scheduled
-- visit**, which already counts as completing a round of its own. Crediting it
-- twice would have moved his completion from 69.5% to 84.6% on the strength of
-- work that was already counted. That is flattery, not a fix.
--
-- So only an **unscheduled** visit — `route_id is null`, the rep going back off
-- their own bat — can pay off a missed round. And it pays off exactly one:
-- Tshepo's 11 matches came from 6 real visits, so without one-to-one matching
-- a single return trip would settle two or three missed rounds.
--
-- `route_catchups` is that rule, in one place, because more than one caller
-- needs it and this schema has been bitten before by the same definition
-- written out three times and drifting (`oos_visit_flags` exists for exactly
-- that reason). `rep_performance_missed` and `schedule_adherence` read it
-- directly, and the Rep Performance Report composes its completion figure from
-- the rows `rep_performance_missed` already hands it — so the report and the
-- Adherence tab cannot disagree about whether a rep made their round.
--
-- What this does to the numbers, over 1 Aug – today:
--
--     rep                planned   on the day   credited   was      now
--     Tshepo Mmereki         260           95          5   36.5%   38.5%
--     Atang Kheumla          259          180          3   69.5%   70.7%
--     Jerry Habana           124           43         25   34.7%   54.8%
--
-- Jerry is the case the owner was describing: a fifth of his round is ad-hoc
-- return trips that the report credited him nothing for.
--
-- ⚠️ Unbounded above, as before: a round missed on 31 August and caught up on
-- 2 September counts. The consequence is that a past period's figure can still
-- improve, which is why the sheet carries its generation date.

/**
 * Which missed rounds an unscheduled visit paid off, one for one.
 *
 * A missed round is a `routes` row with no checked-out visit carrying its id.
 * A free visit is a checked-out visit with **no** `route_id` — one that is not
 * already counted as completing a round of its own. Both are numbered per
 * rep-and-store in date order and paired on that number, then the pair is kept
 * only if the visit is on or after the round it is being credited to.
 *
 * Pairing on `row_number` rather than "the earliest visit after this date" is
 * what makes it one-to-one. Both sides are sorted by date, so the k-th missed
 * round gets the k-th return trip and no trip is spent twice.
 *
 * Not gated on `insights`: it is a helper, and its callers are the boundary —
 * the same shape as `oos_visit_flags`.
 */
create or replace function public.route_catchups(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (route_id uuid, caught_up_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz
  ),
  bounds as materialized (
    select (p_from at time zone c.tz)::date as from_date,
           (p_to   at time zone c.tz)::date as to_date,
           (now()  at time zone c.tz)::date as today
    from cfg c
  ),
  missed as (
    select ro.id, ro.rep_id, ro.store_id, ro.scheduled_date,
           row_number() over (partition by ro.rep_id, ro.store_id
                              order by ro.scheduled_date, ro.id) as rn
    from routes ro
    cross join cfg
    cross join bounds b
    where ro.org_id = cfg.org
      and ro.scheduled_date >= b.from_date
      and ro.scheduled_date <  b.to_date
      and ro.scheduled_date <= b.today
      and not exists (select 1 from visits v
                       where v.route_id = ro.id and v.status = 'checked_out')
  ),
  free_visits as (
    -- No upper bound: the catch-up may fall after the reporting period, and a
    -- store served two days into September was still served.
    select v.rep_id, v.store_id, v.checkin_at,
           row_number() over (partition by v.rep_id, v.store_id
                              order by v.checkin_at) as rn
    from visits v
    cross join cfg
    where v.org_id = cfg.org
      and v.status = 'checked_out'
      and v.route_id is null
      and v.checkin_at >= p_from
  )
  select m.id, f.checkin_at
  from missed m
  join free_visits f
    on f.rep_id = m.rep_id and f.store_id = m.store_id and f.rn = m.rn
  cross join cfg
  where (f.checkin_at at time zone cfg.tz)::date >= m.scheduled_date;
$$;

revoke all on function public.route_catchups(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.route_catchups(timestamptz, timestamptz)
  to authenticated;

comment on function public.route_catchups is
  'Missed rounds paid off by an unscheduled return visit, matched one-to-one. The single definition of a caught-up visit, read by rep_performance_missed and schedule_adherence.';

-- `rep_performance_summary` is deliberately **not** touched. It reports what
-- happened — rounds planned, rounds done on the day — and the report composes
-- the served figure from that plus the credited catch-ups it already fetches.
-- Keeping the RPC to plain facts is why `missed_visits` there still matches the
-- number of rows the missed list returns, and it saves restating a
-- three-hundred-line function to change one arithmetic decision that belongs to
-- the page.
--
-- The missed list does change shape, so its old signature goes first:
-- `create or replace` cannot widen a `returns table` (42P13).

drop function if exists public.rep_performance_missed(uuid, timestamptz, timestamptz, uuid);

create or replace function public.rep_performance_missed(
  p_rep_id       uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_territory_id uuid
)
returns table (
  route_id       uuid,
  store_id       uuid,
  store_name     text,
  store_group    text,
  city           text,
  planned_date   date,
  reason         text,
  visited_at     timestamptz,
  last_visit_at  timestamptz,
  previous_sales numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz,
           -- Raises before a single row is read. `cfg` is the one CTE every
           -- query below joins against, so the guard cannot be planned away.
           public.require_permission('insights') as allowed
  ),
  bounds as materialized (
    select (p_from at time zone c.tz)::date as from_date,
           (p_to   at time zone c.tz)::date as to_date,
           (now()  at time zone c.tz)::date as today
    from cfg c
  ),
  terr as materialized (
    select t.territory_id from public.territory_subtree(p_territory_id) t
  ),
  missed as materialized (
    select ro.id, ro.store_id, ro.scheduled_date
    from routes ro
    join stores s on s.id = ro.store_id
    cross join cfg
    cross join bounds b
    where ro.org_id = cfg.org
      and ro.rep_id = p_rep_id
      and ro.scheduled_date >= b.from_date
      and ro.scheduled_date <  b.to_date
      and ro.scheduled_date <= b.today
      and (p_territory_id is null
           or s.territory_id in (select territory_id from terr))
      and not exists (select 1 from visits v
                       where v.route_id = ro.id and v.status = 'checked_out')
  )
  select m.id,
         m.store_id,
         s.name,
         g.name,
         s.city,
         m.scheduled_date,
         -- What the application recorded, and nothing inferred. `routes` holds
         -- no outcome, so this is the only thing the data can say.
         case
           when exists (select 1 from visits v
                         where v.route_id = m.id and v.status = 'checked_in')
             then 'Checked in, not checked out'
         end,
         -- The rep going back, as `route_catchups` credits it — one
         -- unscheduled visit to one missed round. Null is the row that
         -- matters: this one was never served.
         (select c.caught_up_at from public.route_catchups(p_from, p_to) c
           where c.route_id = m.id),
         -- The last time anybody closed a visit at this store before the day it
         -- was missed. Any rep, not only this one: management is asking how
         -- long the shop has gone unserved, which is not a question about who.
         (select max(v.checkout_at) from visits v
           where v.org_id = cfg.org
             and v.store_id = m.store_id
             and v.status = 'checked_out'
             and v.checkout_at < (m.scheduled_date::timestamp at time zone cfg.tz)),
         -- The most recent delivered order at the store before that day, valued
         -- the same way as everything else here.
         --
         -- Shaped as "the newest order, then its value" rather than "the value
         -- of the newest order's lines": summing `order_lines` against an order
         -- id that came back null matches no rows, and `coalesce(sum(…), 0)`
         -- over no rows is 0 — a store that has never bought anything would
         -- print P0.00 where the truth is that there is nothing to show. This
         -- way the outer select returns no row, the column is null, and the
         -- page prints an em dash.
         (select (select coalesce(sum(greatest(ol.qty_delivered - ol.qty_returned, 0)
                                      * coalesce(ol.unit_price, 0)), 0)
                    from order_lines ol where ol.order_id = o.id)
            from orders o
           where o.org_id = cfg.org
             and o.store_id = m.store_id
             and o.status = 'delivered'
             and o.delivered_at < (m.scheduled_date::timestamp at time zone cfg.tz)
           order by o.delivered_at desc
           limit 1)
  from missed m
  join stores s on s.id = m.store_id
  left join store_groups g on g.id = s.store_group_id
  cross join cfg
  -- Never caught up first, then by the money behind the shop. The list is not
  -- truncated and runs to a hundred rows on this data, so the ordering decides
  -- what a manager reads before their attention runs out — and a store nobody
  -- ever went back to outranks a valuable one that was served on Thursday.
  -- Column 8 is `visited_at`. An ordinal rather than a second copy of the
  -- subquery: the first version of this repeated the expression, which is two
  -- definitions of the same thing waiting to drift apart.
  order by 8 asc nulls first, 10 desc nulls last, m.scheduled_date desc, s.name;
$$;

create or replace function public.schedule_adherence(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  rep_id         uuid,
  rep_name       text,
  planned        bigint,
  completed      bigint,
  missed         bigint,
  adherence_rate numeric,
  missed_detail  jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz
  ),
  bounds as materialized (
    -- `scheduled_date` is a calendar date, so both bounds have to be resolved
    -- to a calendar date in the organisation's zone. `p_to::date` alone used
    -- the session's TimeZone: the web sends an exclusive bound at local
    -- midnight, which is 22:00Z the day before in Gaborone, so the cast landed
    -- a day early and dropped the last day of the range.
    select (p_from at time zone c.tz)::date as from_date,
           (p_to   at time zone c.tz)::date as to_date,
           (now()  at time zone c.tz)::date as today
    from cfg c
  ),
  r as materialized (
    select ro.id, ro.rep_id, ro.store_id, ro.scheduled_date,
           -- Done on the day, **or** gone back to on an unscheduled visit that
           -- `route_catchups` credits to this round. The Rep Performance
           -- Report counts it the same way; two adherence figures that
           -- disagree would be worse than either.
           (exists (
             select 1 from visits v
             where v.route_id = ro.id and v.status = 'checked_out'
           )
           or exists (
             select 1 from public.route_catchups(p_from, p_to) c
             where c.route_id = ro.id
           )) as done
    from routes ro
    cross join cfg
    cross join bounds b
    where ro.org_id = cfg.org
      and ro.scheduled_date >= b.from_date
      and ro.scheduled_date <  b.to_date
      -- A route scheduled for tomorrow is not "missed" — it simply hasn't
      -- happened yet. Counting it would make every rep look negligent.
      and ro.scheduled_date <= b.today
  )
  select r.rep_id,
         p.full_name,
         count(*),
         count(*) filter (where r.done),
         count(*) filter (where not r.done),
         case when count(*) > 0
              then round((count(*) filter (where r.done))::numeric / count(*), 4)
         end,
         coalesce((
           select jsonb_agg(jsonb_build_object('store', st.name, 'date', r2.scheduled_date)
                            order by r2.scheduled_date desc)
           from (
             select r3.store_id, r3.scheduled_date
             from r r3
             where r3.rep_id is not distinct from r.rep_id and not r3.done
             order by r3.scheduled_date desc
             limit 10
           ) r2
           join stores st on st.id = r2.store_id
         ), '[]'::jsonb)
  from r
  left join profiles p on p.id = r.rep_id
  group by r.rep_id, p.full_name
  order by 6 asc nulls last;
$$;

revoke all on function public.rep_performance_missed(uuid, timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.rep_performance_missed(uuid, timestamptz, timestamptz, uuid)
  to authenticated;

comment on function public.rep_performance_missed is
  'Every planned visit the rep did not complete on the day, whether an unscheduled return trip was credited to it (visited_at), and the store''s last visit and last delivered order before that date.';
