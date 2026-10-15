-- Following up on stores due for an order (owner, 15 Oct 2026, after
-- 20261015100000): "Same again", "Reason for no order", and the manager's
-- win-back list.
--
-- 1. order_declines: why a store did not order when the rep asked. Written from
--    the phone (offline, through the outbox, so it carries its own
--    client_generated_id), one row per visit at most. The manager reads them on
--    "Stores due for an order": the last reason beside each store, and what
--    the reasons add up to.
--
-- 2. store_reorder() gains the last order's products and shrinks, so the phone
--    can fill a new order with "the same again". From the same last order the
--    function already names (a Tickd order, or a QuickBooks invoice), so the
--    number on the screen and the products filled in are one order. Quantities
--    are shrinks: Tickd keeps an order line in single units (qty_ordered / the
--    product's units_per_shrink), QuickBooks invoiced in shrinks (its unit
--    price is the shrink price). A QuickBooks line with no product in Tickd
--    cannot be filled in, and is counted instead, so the phone can say so.
--    The column list changes, so the function is dropped and made again; the
--    1.2.1 phone reads the columns it knows by name and ignores the rest.
--
-- 3. store_year_sales(): what each store bought in the last year, for "biggest
--    buyers first" on the win-back list. Money, so for whoever may read the
--    invoices (invoicing), checked first so anyone else is refused rather than
--    shown nothing; security invoker over those same invoices.
--
-- 4. An index for the invoice lines of one invoice, which store_reorder() now
--    reads and nothing indexed (the table has no org_id).

---------------------------------------------------------------- 1. the reasons

create table public.order_declines (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.organizations(id) on delete cascade,
  store_id                  uuid not null references public.stores(id) on delete cascade,
  rep_id                    uuid references public.profiles(id) on delete set null,
  -- The visit it was given on, by the phone's own id for it: the reason can
  -- reach the server before or after its visit, and the visit's id is only
  -- known once it has.
  visit_client_generated_id uuid,
  client_generated_id       uuid not null unique,
  reason                    text not null check (reason in
    ('has_stock', 'buyer_away', 'no_money', 'price', 'other_supplier', 'other')),
  note                      text check (note is null or length(note) <= 500),
  created_at                timestamptz not null default now()
);
comment on table public.order_declines is
  'Why a store did not order when it was asked: has_stock, buyer_away, no_money, price, other_supplier or other (with a note). Given by the rep on the phone at the store.';
comment on column public.order_declines.visit_client_generated_id is
  'The visit''s client_generated_id: the phone knows it before the visit has synced.';
create index order_declines_org_store_idx on public.order_declines (org_id, store_id, created_at desc);
-- One reason per visit: answering twice keeps the first, and a replay of the
-- same entry is the same row (client_generated_id).
create unique index order_declines_visit_key on public.order_declines (visit_client_generated_id)
  where visit_client_generated_id is not null;

alter table public.order_declines enable row level security;
-- The rep who gave it, and whoever reads "Stores due for an order": the
-- page is under Customers (sales_coverage), and the figures are Reports'.
create policy order_declines_select on public.order_declines for select
  using ((org_id = (select public.current_org_id()))
         and (rep_id = (select auth.uid())
              or (select public.has_permission('insights'))
              or (select public.has_permission('sales_coverage'))));
-- A rep records their own, at a store of their own company. No update and no
-- delete: what the shop said is a record of the visit, like the visit.
create policy order_declines_insert on public.order_declines for insert
  with check ((org_id = (select public.current_org_id()))
              and rep_id = (select auth.uid())
              and exists (select 1 from public.stores s
                           where s.id = order_declines.store_id
                             and s.org_id = (select public.current_org_id())));
create policy module_gate on public.order_declines as restrictive for all
  using ((select public.module_enabled('distribution')))
  with check ((select public.module_enabled('distribution')));
revoke all on public.order_declines from anon, authenticated;
grant select on public.order_declines to authenticated;
grant insert (org_id, store_id, rep_id, visit_client_generated_id, client_generated_id, reason, note, created_at)
  on public.order_declines to authenticated;

-- The billing gate, where it exists (production), as for every table a
-- company writes.
do $migration$
begin
  if to_regprocedure('public.company_writable()') is null then
    return;
  end if;
  create policy billing_gate_insert on public.order_declines as restrictive for insert to authenticated
    with check ((select public.company_writable()));
  create policy billing_gate_update on public.order_declines as restrictive for update to authenticated
    using ((select public.company_writable())) with check ((select public.company_writable()));
  create policy billing_gate_delete on public.order_declines as restrictive for delete to authenticated
    using ((select public.company_writable()));
end;
$migration$;

insert into public.module_assignments (kind, name, module_code)
values ('table', 'order_declines', 'distribution')
on conflict do nothing;

------------------------------------------------- 2. the last order's products

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
  due_on date,
  -- [{"product_id": …, "shrinks": n}, …]: what the phone can fill in.
  last_lines jsonb,
  -- Lines of the last order the phone cannot fill in: a QuickBooks line with
  -- no product in Tickd, or a product the phone cannot order (not active, not
  -- stock-tracked, or no shrink size on record).
  last_lines_missing integer
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
           o.status,
           o.id as order_id,
           null::uuid as invoice_id
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
           'invoiced',
           null::uuid,
           t.id
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
    select distinct on (ev.store_id) ev.store_id, ev.on_day, ev.ref, ev.status, ev.order_id, ev.invoice_id
      from ev
     order by ev.store_id, ev.on_day desc, ev.at desc, ev.ref desc
  ),
  last_raw as (
    -- Each line of the last order, in shrinks (fractions kept until the sum).
    --
    -- A Tickd order line is in single units; a cancelled line was not sent.
    select l.store_id, ol.product_id, ol.id as line_id,
           ol.qty_ordered::numeric / nullif(p.units_per_shrink, 0) as shrinks,
           true as is_product
      from latest l
      join public.order_lines ol on ol.order_id = l.order_id
      left join public.products p on p.id = ol.product_id
     where ol.line_status <> 'cancelled'
    union all
    -- A QuickBooks line is usually in shrinks, priced per shrink. Some were
    -- invoiced per single item instead ("Mango Ice", 10 at P140): a unit price
    -- under half the shrink price says so, and the quantity is converted. A
    -- line with no price or no quantity is a note ("As invoiced in
    -- QuickBooks") or a discount, not a product, so it is not counted as left
    -- out either.
    select l.store_id, il.product_id, il.id,
           case when p.units_per_shrink > 0
                 and p.shrink_price_excl_vat > 0
                 and il.unit_price > 0
                 and il.unit_price < p.shrink_price_excl_vat / 2
                then il.qty / p.units_per_shrink
                else il.qty end,
           il.unit_price > 0 and il.qty > 0
      from latest l
      join public.tax_invoice_lines il on il.invoice_id = l.invoice_id
      left join public.products p on p.id = il.product_id
  ),
  last_grouped as (
    -- One entry per product; a line with no product stays on its own, so each
    -- one is counted.
    select r.store_id, r.product_id, sum(r.shrinks) as shrinks, bool_or(r.is_product) as is_product
      from last_raw r
     group by r.store_id, r.product_id, case when r.product_id is null then r.line_id end
  ),
  last_fill as (
    select g.store_id,
           jsonb_agg(jsonb_build_object('product_id', g.product_id,
                                        'shrinks', greatest(1, ceil(g.shrinks))::integer)
                     order by p.name)
             filter (where p.id is not null) as lines,
           (count(*) filter (where p.id is null and g.is_product))::integer as missing
      from last_grouped g
      -- Only what the phone can order: active, stock-tracked, a shrink size.
      left join public.products p
        on p.id = g.product_id
       and p.active
       and p.is_stock_tracked
       and coalesce(p.units_per_shrink, 0) > 0
     group by g.store_id
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
         l.on_day + least(coalesce(r.usual, cfg.rule), cfg.rule),
         coalesce(f.lines, '[]'::jsonb),
         coalesce(f.missing, 0)
    from public.stores s
   cross join cfg
    left join latest l on l.store_id = s.id
    left join rhythm r on r.store_id = s.id
    left join last_fill f on f.store_id = s.id
   where s.org_id = cfg.org
     and s.active
   order by s.name, s.id
$$;

revoke all on function public.store_reorder() from public, anon;
grant execute on function public.store_reorder() to authenticated;

comment on function public.store_reorder() is
  'Each active store: its last order day (Tickd orders, not back-orders, and QuickBooks invoices with no order), that order''s number and status, its products and shrinks (last_lines) and how many lines cannot be filled in (last_lines_missing), its order days in the last year, its usual gap between orders (3+ order days), and when it is due to order again: the usual gap or reorder_after_days, whichever is sooner. Security definer: reps see the store''s last order whoever took it, but no amounts and no names.';

-- Registered by 20261015100000; kept so this file stands alone.
insert into public.module_assignments (kind, name, module_code)
values ('function', 'store_reorder', 'distribution')
on conflict do nothing;

------------------------------------------- 3. what each store bought in a year

-- For the win-back list's "biggest buyers first". Every invoice in the last
-- year, Tickd's and QuickBooks', excluding VAT as the Sales page counts; a void
-- invoice is not a sale. Security invoker: the rows are the invoices this
-- person may already read (tax_invoices_select), and both the module and the
-- permission behind that are checked first, so someone without them is told
-- so (42501) rather than given an empty list that reads as "nothing bought".
create function public.store_year_sales()
returns table (store_id uuid, sales_excl_vat numeric, invoices integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select public.require_module('distribution');
  select public.require_module('invoicing');
  select public.require_permission('invoicing');

  select t.store_id, sum(t.subtotal), count(*)::integer
    from public.tax_invoices t
   where t.org_id = public.current_org_id()
     and t.status = 'issued'
     and t.store_id is not null
     and t.issue_date > (now() at time zone public.org_timezone(public.current_org_id()))::date - 365
   group by t.store_id
$$;

revoke all on function public.store_year_sales() from public, anon;
grant execute on function public.store_year_sales() to authenticated;

comment on function public.store_year_sales() is
  'What each store was invoiced in the last 365 days, excluding VAT, and how many invoices: for the win-back list on Stores due for an order. Invoicing permission (and module) only; security invoker.';

insert into public.module_assignments (kind, name, module_code)
values ('function', 'store_year_sales', 'distribution')
on conflict do nothing;

------------------------------------------------------------------ 4. an index

create index if not exists tax_invoice_lines_invoice_idx on public.tax_invoice_lines (invoice_id);
