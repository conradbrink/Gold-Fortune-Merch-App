-- When each store last ordered, how often it usually orders, and when it is due
-- to order again (owner, 15 Oct 2026: "I want the rep to see when last they
-- ordered so that they can pick up that they need to order again … after 30
-- days it prompts them and then it uses … the average store order dates").
--
-- One function, read by two screens:
--   * the rep's phone, on the store it is about to walk into ("Last order 26
--     days ago. They usually order every 3 weeks. Ask for an order.");
--   * the manager's "Stores due for an order" list on the web.
--
-- WHAT COUNTS AS AN ORDER
--   * every Tickd order that was not cancelled, whoever took it — a rep, the
--     office, or a recurring order;
--   * every QuickBooks invoice (20261013170000) that has no order of its own:
--     the store's history from before Tickd. Without it 134 of Gold Fortune's
--     266 stores would read "never ordered" on 15 Oct 2026, when 259 of them
--     have bought something.
--   An imported invoice that names its order is that order, counted once.
--   A back-order (an order with a parent_order_id) is the warehouse finishing
--   an earlier order, not the store ordering again, so it is left out.
--   Days are the company's calendar days, and two orders on one day are one.
--
-- WHEN A STORE IS DUE
--   The company's rule, `reorder_after_days` (30 unless the owner changes it),
--   is the longest a store goes before somebody asks it for an order. A store
--   with a rhythm of its own — three or more order days in the last year — is
--   due at its usual gap (the median days between its orders) when that is
--   sooner. So a store that orders every 2 weeks is due after 2 weeks, and one
--   with no pattern yet, or one that orders every 2 months, after 30 days.
--   `due_on` is the last order day plus that many days; a store that has never
--   ordered has none.
--
-- Whether a store is due *today* is left to the caller, from `due_on`: the
-- phone keeps this list for a day or more without signal, and a "due" worked
-- out yesterday is wrong at midnight.
--
-- SECURITY DEFINER, deliberately. A rep reads only their own orders
-- (orders_select) and no invoices at all, but the question a rep is asking at
-- the door is about the store, whoever sold to it last. The function answers
-- that and nothing more: dates, an order or invoice number and its status. No
-- amounts, no products, no names. Scoped to the caller's company and gated on
-- the distribution module, like the order screens it sits beside.

------------------------------------------------------------------ the setting

insert into public.setting_definitions
  (key, label, description, value_type, default_value, min_value, max_value, sort_order, audience)
values
  ('reorder_after_days', 'Ask for an order after (days)',
   'A store that hasn''t ordered for this many days is due for an order. Your team sees it on their phones at the store, and you see it on the dashboard. A store that usually orders sooner is due at its own usual time.',
   'integer', '30', 7, 180, 119, 'owner');

-- Every company has every setting written down (as create_company does).
insert into public.company_settings (org_id, key, value)
select o.id, 'reorder_after_days', '30'::jsonb
  from public.organizations o
on conflict (org_id, key) do nothing;

------------------------------------------------------- the dashboard card

-- "Stores due for an order" sits beside Store health on the distribution
-- dashboard: in the trade's default and for every company still on it (Gold
-- Fortune included). Nobody has a saved layout of their own
-- (dashboard_layouts is empty on 15 Oct 2026), so every manager sees it.
update public.template_settings
   set value = to_jsonb(regexp_replace(value #>> '{}', '(^|,)store_health(,|$)', '\1store_health,store_reorder\2'))
 where setting_key = 'dashboard_layout'
   and 'store_health' = any (string_to_array(value #>> '{}', ','))
   and not 'store_reorder' = any (string_to_array(value #>> '{}', ','));

update public.company_settings
   set value = to_jsonb(regexp_replace(value #>> '{}', '(^|,)store_health(,|$)', '\1store_health,store_reorder\2'))
 where key = 'dashboard_layout'
   and 'store_health' = any (string_to_array(value #>> '{}', ','))
   and not 'store_reorder' = any (string_to_array(value #>> '{}', ','));

update public.setting_definitions
   set default_value = to_jsonb(regexp_replace(default_value #>> '{}', '(^|,)store_health(,|$)', '\1store_health,store_reorder\2'))
 where key = 'dashboard_layout'
   and 'store_health' = any (string_to_array(default_value #>> '{}', ','))
   and not 'store_reorder' = any (string_to_array(default_value #>> '{}', ','));

------------------------------------------------------------------ the function

create function public.store_reorder()
returns table (
  store_id uuid,
  store_name text,
  city text,
  last_order_on date,
  last_order_ref text,
  last_order_status text,
  order_days_year integer,
  usual_days integer,
  due_after_days integer,
  due_on date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.require_module('distribution');

  with cfg as materialized (
    select public.current_org_id() as org,
           public.org_timezone(public.current_org_id()) as tz,
           (now() at time zone public.org_timezone(public.current_org_id()))::date as today,
           coalesce((public.org_setting(public.current_org_id(), 'reorder_after_days') #>> '{}')::integer, 30) as rule
  ),
  ev as (
    -- Tickd's own orders, whoever took them.
    select o.store_id,
           (o.created_at at time zone cfg.tz)::date as on_day,
           o.created_at as at,
           o.order_number as ref,
           o.status
      from public.orders o
     cross join cfg
     where o.org_id = cfg.org
       and o.status <> 'cancelled'
       and o.parent_order_id is null
       and o.store_id is not null
    union all
    -- The QuickBooks history, where it is not already one of the orders above.
    select t.store_id,
           t.issue_date,
           t.issue_date::timestamp at time zone cfg.tz,
           t.invoice_number,
           'invoiced'
      from public.tax_invoices t
     cross join cfg
     where t.org_id = cfg.org
       and t.source = 'quickbooks'
       and t.status <> 'void'
       and t.order_id is null
       and t.store_id is not null
  ),
  latest as (
    -- On a day with an order and an invoice, the order (it has a time).
    select distinct on (ev.store_id) ev.store_id, ev.on_day, ev.ref, ev.status
      from ev
     order by ev.store_id, ev.on_day desc, ev.at desc, ev.ref desc
  ),
  days as (
    select distinct ev.store_id, ev.on_day
      from ev
     cross join cfg
     where ev.on_day > cfg.today - 365
       and ev.on_day <= cfg.today
  ),
  gaps as (
    select d.store_id,
           d.on_day - lag(d.on_day) over (partition by d.store_id order by d.on_day) as gap
      from days d
  ),
  rhythm as (
    select g.store_id,
           count(*)::integer as order_days,
           -- Three order days make two gaps: the least that says "usually".
           case when count(*) >= 3
                then percentile_disc(0.5) within group (order by g.gap)
                       filter (where g.gap is not null) end as usual
      from gaps g
     group by g.store_id
  )
  select s.id,
         s.name,
         s.city,
         l.on_day,
         l.ref,
         l.status,
         coalesce(r.order_days, 0),
         r.usual,
         least(coalesce(r.usual, cfg.rule), cfg.rule),
         l.on_day + least(coalesce(r.usual, cfg.rule), cfg.rule)
    from public.stores s
   cross join cfg
    left join latest l on l.store_id = s.id
    left join rhythm r on r.store_id = s.id
   where s.org_id = cfg.org
     and s.active
   order by s.name, s.id
$$;

revoke all on function public.store_reorder() from public, anon;
grant execute on function public.store_reorder() to authenticated;

comment on function public.store_reorder() is
  'Each active store: its last order day (Tickd orders and QuickBooks invoices with no order), that order''s number and status, its order days in the last year, its usual gap between orders (3+ order days), and when it is due to order again: the usual gap or reorder_after_days, whichever is sooner. Security definer: reps see the store''s last order whoever took it, but no amounts, products or names.';

insert into public.module_assignments (kind, name, module_code)
values ('function', 'store_reorder', 'distribution')
on conflict do nothing;
