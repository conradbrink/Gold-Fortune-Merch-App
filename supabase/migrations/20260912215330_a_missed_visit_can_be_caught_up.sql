-- A missed visit that the rep went back for is not the same as one nobody ever
-- made, and the report could not tell them apart.
--
-- `rep_performance_missed` lists every planned visit with no checked-out visit
-- carrying its `route_id`. That is the right test for "did the round happen as
-- planned", and it is the same one `schedule_adherence` makes, so the two agree.
-- But it says nothing about what happened next, and on this data what happens
-- next is the larger half of the story:
--
--     rep              missed   caught up later   average delay
--     Tshepo Mmereki      165          72 (44%)        13.0 days
--     Jerry Habana         81          38 (47%)         6.6 days
--     Atang Kheumla        79          40 (51%)        13.1 days
--
-- Around half of every "missed" row was a store the rep returned to. Printing
-- all of them as flat misses overstates the problem by roughly a factor of two,
-- and buries the ones that genuinely were never served — which are the rows a
-- manager actually needs.
--
-- `visited_at` is the earliest checked-out visit by that rep at that store on or
-- after the planned date. On, not after: a rep who reached the store the same
-- day without the app linking it to the route is in exactly the same position
-- as one who came back on Thursday, and the old `reason` text handled only the
-- same-day case while calling it "Visited off-schedule". One column says it
-- better than a reason string, so that branch is gone and `reason` is left to
-- mean what it says — the outcome the application recorded, which for all but a
-- handful of rows is nothing.
--
-- ⚠️ **Unbounded above, deliberately.** It looks for the catch-up up to now,
-- not up to the end of the reporting period — a store missed on the last day of
-- August and served on 2 September was still served, and a manager reading the
-- August report wants to know that. The consequence is that this section is a
-- statement about the period *as it stands today* rather than a frozen record,
-- which is why the sheet carries its generation date in the header.
--
-- ⚠️ **The same rep, not any rep.** This is one person's performance report and
-- the planned visit was theirs. A colleague covering the store is a real and
-- different fact, and one this column would quietly disguise as the rep going
-- back.
--
-- The return type gains a column, so the old signature is **dropped first**.
-- `create or replace` cannot widen a `returns table` — it fails with 42P13,
-- which is the trap `supabase/README.md` records having broken a replay once
-- already. Nothing but `web/lib/rep-report.ts` calls this; it shipped today.

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
         -- The rep going back. Earliest closed visit at this store, by this
         -- rep, on or after the day it was planned for — bounded below by the
         -- planned date and not above, so a catch-up after the period still
         -- counts. Null is the row that matters: nobody ever went.
         (select min(v.checkin_at) from visits v
           cross join cfg c3
           where v.org_id = cfg.org
             and v.rep_id = p_rep_id
             and v.store_id = m.store_id
             and v.status = 'checked_out'
             and (v.checkin_at at time zone c3.tz)::date >= m.scheduled_date),
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
  order by (select min(v.checkin_at) from visits v cross join cfg c4
             where v.org_id = cfg.org and v.rep_id = p_rep_id
               and v.store_id = m.store_id and v.status = 'checked_out'
               and (v.checkin_at at time zone c4.tz)::date >= m.scheduled_date)
           asc nulls first,
           10 desc nulls last, m.scheduled_date desc, s.name;
$$;

revoke all on function public.rep_performance_missed(uuid, timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.rep_performance_missed(uuid, timestamptz, timestamptz, uuid)
  to authenticated;

comment on function public.rep_performance_missed is
  'Every planned visit the rep did not complete in the period, whether they later went back (visited_at), and the store''s last visit and last delivered order before that date.';
