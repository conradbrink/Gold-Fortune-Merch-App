-- Rollback of 20261015200000_order_followups: the reasons table and
-- store_year_sales go, and store_reorder() goes back to 20261015100000's
-- columns (without last_lines). Refuses while reasons exist: they are what the
-- shops told the reps, and dropping them is not a rollback.

do $$
begin
  if exists (select 1 from public.order_declines) then
    raise exception 'order_declines has rows; export them before rolling back';
  end if;
end $$;

drop index if exists public.tax_invoice_lines_invoice_idx;

delete from public.module_assignments where kind = 'function' and name = 'store_year_sales';
drop function public.store_year_sales();

delete from public.module_assignments where kind = 'table' and name = 'order_declines';
drop table public.order_declines;

drop function public.store_reorder();
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
