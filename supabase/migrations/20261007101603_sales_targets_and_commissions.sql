-- Monthly sales targets per rep, and commissions on delivered orders.
--
-- ------------------------------------------------------- what a sale is
--
-- Both features count the same thing the Sales page and the Rep Performance
-- Report already count, so the three can never disagree about a rep's month:
--
--   an order with status 'delivered', counted on its `delivered_at` in the
--   organisation's own timezone, valued on `qty_delivered - qty_returned` at
--   the line's `unit_price` (which is net of any line discount), excluding VAT.
--
-- Lines with nothing left after returns contribute nothing — the same
-- `if (qty <= 0) continue` that `lib/sales.ts` applies.
--
-- ------------------------------------------------- gross profit, frozen
--
-- Gross profit needs a cost, and the only cost on file is
-- `products.unit_cost_excl_vat`, which a manager can change at any time.
-- Reading it live would let a cost update quietly rewrite last month's target
-- progress and the commission somebody was already paid on. So each order line
-- now keeps the cost as it stood when the line was written, the way `orders`
-- keeps `vat_rate`.
--
-- Lines written before today are backfilled from the current product cost —
-- the best figure that exists for them, and stated here so nobody mistakes it
-- for a historic snapshot. A line whose product has no cost stays null, and
-- contributes its full net to gross profit rather than a guessed margin; the
-- progress function reports how many such units there were so the page can say
-- so.
--
-- ------------------------------------------------------------ commissions
--
-- A commission is worked out when an order becomes delivered, from the
-- highest-priority active rule that matches it (a rule for this rep or this
-- store beats a rule for everyone at the same priority). It is recomputed while
-- it is still pending — a return, a late price fix, a rule change followed by
-- "Recalculate" — and frozen once approved. Working it out can never stop a
-- delivery being recorded: any failure is caught and logged as a warning.
--
-- ------------------------------------------------------------------ who
--
-- Targets, rules and other people's commissions are management information
-- (`insights`). A rep reads their own targets and commissions and nothing
-- else, which is what the phone will want later.

-- ---------------------------------------------------------- cost snapshot

alter table public.order_lines
  add column if not exists unit_cost_excl_vat numeric(12,2);

comment on column public.order_lines.unit_cost_excl_vat is
  'products.unit_cost_excl_vat as it stood when the line was written. Lines from before 7 Oct 2026 were backfilled from the cost on that day. Null when the product had no cost.';

create or replace function public.order_lines_snapshot_cost()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Assigned, not defaulted, so a caller cannot choose its own margin.
  select p.unit_cost_excl_vat into new.unit_cost_excl_vat
  from public.products p where p.id = new.product_id;
  return new;
end;
$$;

drop trigger if exists order_lines_snapshot_cost on public.order_lines;
create trigger order_lines_snapshot_cost
  before insert on public.order_lines
  for each row execute function public.order_lines_snapshot_cost();

-- A product swapped on a line while the order is still new takes its cost.
drop trigger if exists order_lines_snapshot_cost_on_product on public.order_lines;
create trigger order_lines_snapshot_cost_on_product
  before update of product_id on public.order_lines
  for each row when (new.product_id is distinct from old.product_id)
  execute function public.order_lines_snapshot_cost();

update public.order_lines ol
   set unit_cost_excl_vat = p.unit_cost_excl_vat
  from public.products p
 where p.id = ol.product_id
   and ol.unit_cost_excl_vat is null
   and p.unit_cost_excl_vat is not null;

-- -------------------------------------------------------- what was sold

/**
 * Each delivered order in a window, valued the way the Sales page values it.
 *
 * Internal: not granted to anybody. The two callers below decide who may see
 * which rep's figures before they ask.
 */
create or replace function public.delivered_order_values(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  order_id uuid,
  rep_id uuid,
  store_id uuid,
  delivered_at timestamptz,
  units bigint,
  revenue_excl_vat numeric,
  revenue_incl_vat numeric,
  gross_profit numeric,
  uncosted_units bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, o.rep_id, o.store_id, o.delivered_at,
         coalesce(sum(q.qty), 0)::bigint,
         coalesce(sum(q.qty * coalesce(q.unit_price, 0)), 0),
         round(coalesce(sum(q.qty * coalesce(q.unit_price, 0)), 0) * (1 + o.vat_rate / 100), 2),
         coalesce(sum(q.qty * (coalesce(q.unit_price, 0) - coalesce(q.unit_cost_excl_vat, 0))), 0),
         coalesce(sum(q.qty) filter (where q.unit_cost_excl_vat is null), 0)::bigint
  from public.orders o
  left join lateral (
    select ol.qty_delivered - ol.qty_returned as qty, ol.unit_price, ol.unit_cost_excl_vat
    from public.order_lines ol
    where ol.order_id = o.id and ol.qty_delivered - ol.qty_returned > 0
  ) q on true
  where o.org_id = p_org
    and o.status = 'delivered'
    and o.delivered_at >= p_from
    and o.delivered_at < p_to
  group by o.id, o.rep_id, o.store_id, o.delivered_at, o.vat_rate
$$;

revoke all on function public.delivered_order_values(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

-- --------------------------------------------------------------- targets

create table if not exists public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  period_month date not null,
  measure text not null default 'revenue',
  target numeric(14,2) not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_targets_month_start check (extract(day from period_month) = 1),
  constraint sales_targets_measure_check
    check (measure in ('revenue', 'gross_profit', 'units', 'orders')),
  constraint sales_targets_positive check (target > 0)
);

comment on table public.sales_targets is
  'One target per rep per calendar month. Revenue and gross profit are excluding VAT; progress counts delivered orders on their local delivery date.';

create unique index if not exists sales_targets_rep_month_key
  on public.sales_targets (org_id, rep_id, period_month);

alter table public.sales_targets enable row level security;

drop policy if exists sales_targets_select on public.sales_targets;
create policy sales_targets_select on public.sales_targets
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.has_permission('insights')) or rep_id = (select auth.uid()))
  );

drop policy if exists sales_targets_write on public.sales_targets;
create policy sales_targets_write on public.sales_targets
  for all using (
    org_id = (select public.current_org_id())
    and (select public.has_permission('insights'))
  ) with check (
    org_id = (select public.current_org_id())
    and (select public.has_permission('insights'))
  );

grant select, insert, update, delete on public.sales_targets to authenticated;

create or replace function public.sales_targets_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sales_targets_touch on public.sales_targets;
create trigger sales_targets_touch
  before update on public.sales_targets
  for each row execute function public.sales_targets_touch();

/**
 * Every active rep's progress for one month: their target (if any) and what
 * they have achieved on all four measures, so the page can show the measure
 * that was set and a manager can see the others beside it.
 *
 * Definer, so a manager without the warehouse permission can still be told a
 * rep's revenue; guarded inside, so a rep calling it gets only their own row.
 */
create or replace function public.sales_target_progress(p_month date)
returns table (
  rep_id uuid,
  rep_name text,
  measure text,
  target numeric,
  orders bigint,
  units bigint,
  revenue_excl_vat numeric,
  gross_profit numeric,
  uncosted_units bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.current_org_id();
  v_tz text := public.org_timezone(v_org);
  v_month date := date_trunc('month', p_month)::date;
  v_all boolean := public.has_permission('insights');
begin
  if v_org is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  return query
  with sold as (
    select * from public.delivered_order_values(
      v_org,
      (v_month::timestamp at time zone v_tz),
      ((v_month + interval '1 month')::timestamp at time zone v_tz)
    )
  )
  select p.id, p.full_name, t.measure, t.target,
         count(s.order_id),
         coalesce(sum(s.units), 0)::bigint,
         coalesce(sum(s.revenue_excl_vat), 0),
         coalesce(sum(s.gross_profit), 0),
         coalesce(sum(s.uncosted_units), 0)::bigint
  from public.profiles p
  left join public.sales_targets t
    on t.rep_id = p.id and t.org_id = v_org and t.period_month = v_month
  left join sold s on s.rep_id = p.id
  where p.org_id = v_org
    and (p.role = 'rep' or t.id is not null)
    and (p.is_active or t.id is not null)
    and (v_all or p.id = auth.uid())
  group by p.id, p.full_name, t.measure, t.target
  order by p.full_name;
end;
$$;

revoke all on function public.sales_target_progress(date) from public, anon;
grant execute on function public.sales_target_progress(date) to authenticated;

-- ------------------------------------------------------- commission rules

create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  kind text not null default 'percentage',
  -- Percentage of the basis, for 'percentage'.
  rate numeric(7,3),
  -- Rand per order, for 'fixed'.
  fixed_amount numeric(12,2),
  -- For 'tiered': [{"from": 0, "to": 5000, "rate": 2}, {"from": 5000, "to": null, "rate": 3}],
  -- matched on the order's value excluding VAT; the matching tier's rate
  -- applies to the whole basis.
  tiers jsonb,
  basis text not null default 'revenue_excl_vat',
  applies_to text not null default 'all',
  rep_id uuid references public.profiles(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  min_order_value numeric(12,2) not null default 0,
  priority integer not null default 0,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_rules_kind_check check (kind in ('percentage', 'fixed', 'tiered')),
  constraint commission_rules_basis_check
    check (basis in ('revenue_excl_vat', 'revenue_incl_vat', 'gross_profit')),
  constraint commission_rules_applies_check check (
    (applies_to = 'all' and rep_id is null and store_id is null)
    or (applies_to = 'rep' and rep_id is not null and store_id is null)
    or (applies_to = 'store' and store_id is not null and rep_id is null)
  ),
  constraint commission_rules_kind_fields check (
    (kind = 'percentage' and rate is not null and rate >= 0 and rate <= 100)
    or (kind = 'fixed' and fixed_amount is not null and fixed_amount >= 0)
    or (kind = 'tiered' and jsonb_typeof(tiers) = 'array' and jsonb_array_length(tiers) > 0)
  ),
  constraint commission_rules_min_check check (min_order_value >= 0)
);

alter table public.commission_rules enable row level security;

drop policy if exists commission_rules_all on public.commission_rules;
create policy commission_rules_all on public.commission_rules
  for all using (
    org_id = (select public.current_org_id())
    and (select public.has_permission('insights'))
  ) with check (
    org_id = (select public.current_org_id())
    and (select public.has_permission('insights'))
  );

grant select, insert, update, delete on public.commission_rules to authenticated;

drop trigger if exists commission_rules_touch on public.commission_rules;
create trigger commission_rules_touch
  before update on public.commission_rules
  for each row execute function public.sales_targets_touch();

-- ------------------------------------------------------------ commissions

create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  rule_id uuid references public.commission_rules(id) on delete set null,
  -- Kept as text too: a deleted rule must not leave a payslip line unexplained.
  rule_name text not null,
  delivered_at timestamptz not null,
  order_value numeric(12,2) not null,
  basis_amount numeric(12,2) not null,
  rate numeric(7,3),
  amount numeric(12,2) not null,
  status text not null default 'pending',
  calculated_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,
  constraint commissions_status_check check (status in ('pending', 'approved', 'paid'))
);

comment on table public.commissions is
  'One commission per delivered order. Written only by commission_calculate; recomputed while pending, frozen once approved.';

create index if not exists commissions_org_delivered_idx
  on public.commissions (org_id, delivered_at desc);
create index if not exists commissions_rep_idx
  on public.commissions (org_id, rep_id, delivered_at desc);

alter table public.commissions enable row level security;

drop policy if exists commissions_select on public.commissions;
create policy commissions_select on public.commissions
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.has_permission('insights')) or rep_id = (select auth.uid()))
  );

-- Read-only to everyone. Written by the definer functions below and nothing else.
grant select on public.commissions to authenticated;
revoke insert, update, delete on public.commissions from authenticated, anon;

/**
 * Works out (or re-works) the commission on one order.
 *
 * Internal. Leaves an approved or paid commission alone; removes a pending one
 * when the order no longer earns anything (no rep, no matching rule, returned
 * in full) so the list never shows money that is not owed.
 */
create or replace function public.commission_calculate(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.orders;
  r public.commission_rules;
  v_excl numeric;
  v_incl numeric;
  v_gp numeric;
  v_existing text;
  v_basis numeric;
  v_rate numeric;
  v_amount numeric;
  t jsonb;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then return; end if;

  select status into v_existing from public.commissions where order_id = p_order_id;
  if v_existing in ('approved', 'paid') then return; end if;

  if o.status <> 'delivered' or o.rep_id is null or o.delivered_at is null then
    delete from public.commissions where order_id = p_order_id and status = 'pending';
    return;
  end if;

  -- The same valuation as delivered_order_values, for this one order.
  select coalesce(sum(q.qty * coalesce(q.unit_price, 0)), 0),
         coalesce(sum(q.qty * (coalesce(q.unit_price, 0) - coalesce(q.unit_cost_excl_vat, 0))), 0)
    into v_excl, v_gp
  from (
    select ol.qty_delivered - ol.qty_returned as qty, ol.unit_price, ol.unit_cost_excl_vat
    from public.order_lines ol
    where ol.order_id = o.id and ol.qty_delivered - ol.qty_returned > 0
  ) q;
  v_incl := round(v_excl * (1 + o.vat_rate / 100), 2);

  select * into r from public.commission_rules cr
  where cr.org_id = o.org_id
    and cr.active
    and (cr.applies_to = 'all'
         or (cr.applies_to = 'rep' and cr.rep_id = o.rep_id)
         or (cr.applies_to = 'store' and cr.store_id = o.store_id))
    and v_excl >= cr.min_order_value
  order by cr.priority desc, (cr.applies_to <> 'all') desc, cr.created_at
  limit 1;

  if not found or v_excl <= 0 then
    delete from public.commissions where order_id = p_order_id and status = 'pending';
    return;
  end if;

  v_basis := case r.basis
    when 'revenue_incl_vat' then v_incl
    when 'gross_profit' then greatest(v_gp, 0)
    else v_excl
  end;

  if r.kind = 'percentage' then
    v_rate := r.rate;
    v_amount := round(v_basis * r.rate / 100, 2);
  elsif r.kind = 'fixed' then
    v_rate := null;
    v_amount := r.fixed_amount;
  else
    v_rate := null;
    for t in select * from jsonb_array_elements(r.tiers) loop
      if v_excl >= coalesce((t->>'from')::numeric, 0)
         and (t->>'to' is null or v_excl < (t->>'to')::numeric) then
        v_rate := (t->>'rate')::numeric;
        exit;
      end if;
    end loop;
    if v_rate is null then
      delete from public.commissions where order_id = p_order_id and status = 'pending';
      return;
    end if;
    v_amount := round(v_basis * v_rate / 100, 2);
  end if;

  insert into public.commissions (
    org_id, order_id, rep_id, rule_id, rule_name, delivered_at,
    order_value, basis_amount, rate, amount, status, calculated_at
  ) values (
    o.org_id, o.id, o.rep_id, r.id, r.name, o.delivered_at,
    v_excl, v_basis, v_rate, v_amount, 'pending', now()
  )
  on conflict (order_id) do update set
    rep_id = excluded.rep_id,
    rule_id = excluded.rule_id,
    rule_name = excluded.rule_name,
    delivered_at = excluded.delivered_at,
    order_value = excluded.order_value,
    basis_amount = excluded.basis_amount,
    rate = excluded.rate,
    amount = excluded.amount,
    calculated_at = now()
  where public.commissions.status = 'pending';
end;
$$;

revoke all on function public.commission_calculate(uuid) from public, anon, authenticated;

-- Never let commission arithmetic refuse a delivery or a return.
create or replace function public.commission_for_order_safely(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.commission_calculate(p_order_id);
exception when others then
  raise warning 'commission for order % not calculated: %', p_order_id, sqlerrm;
end;
$$;

revoke all on function public.commission_for_order_safely(uuid) from public, anon, authenticated;

-- Two trigger functions rather than one that branches on the table: a single
-- body naming `new.order_id` fails to plan when it fires for `orders`.
create or replace function public.commission_on_order_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.commission_for_order_safely(new.id);
  return null;
end;
$$;

create or replace function public.commission_on_line_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.commission_for_order_safely(new.order_id);
  return null;
end;
$$;

drop trigger if exists orders_commission on public.orders;
create trigger orders_commission
  after update of status, rep_id on public.orders
  for each row
  when (new.status = 'delivered' or old.status = 'delivered')
  execute function public.commission_on_order_change();

drop trigger if exists order_lines_commission on public.order_lines;
create trigger order_lines_commission
  after update of qty_delivered, qty_returned, unit_price on public.order_lines
  for each row execute function public.commission_on_line_change();

/**
 * Works out every commission for orders delivered in a window. For after a rule
 * changes, and for the first run over orders delivered before rules existed.
 * Approved and paid commissions are left as they are.
 */
create or replace function public.commissions_recalculate(p_from timestamptz, p_to timestamptz)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.current_org_id();
  v_id uuid;
  n integer := 0;
begin
  perform public.require_permission('insights');
  for v_id in
    select id from public.orders
    where org_id = v_org and status = 'delivered'
      and delivered_at >= p_from and delivered_at < p_to
  loop
    perform public.commission_calculate(v_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.commissions_recalculate(timestamptz, timestamptz) from public, anon;
grant execute on function public.commissions_recalculate(timestamptz, timestamptz) to authenticated;

/**
 * Approve, un-approve, or mark paid. Paid is final.
 *
 * Returns how many rows moved; a row not in a state that allows the move is
 * left alone rather than failing the whole batch.
 */
create or replace function public.commissions_set_status(p_ids uuid[], p_status text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.current_org_id();
  n integer;
begin
  perform public.require_permission('insights');
  if p_status = 'approved' then
    update public.commissions
       set status = 'approved', approved_by = auth.uid(), approved_at = now()
     where org_id = v_org and id = any(p_ids) and status = 'pending';
  elsif p_status = 'pending' then
    update public.commissions
       set status = 'pending', approved_by = null, approved_at = null
     where org_id = v_org and id = any(p_ids) and status = 'approved';
  elsif p_status = 'paid' then
    update public.commissions
       set status = 'paid', paid_by = auth.uid(), paid_at = now()
     where org_id = v_org and id = any(p_ids) and status = 'approved';
  else
    raise exception 'Unknown status %.', p_status using errcode = '22023';
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.commissions_set_status(uuid[], text) from public, anon;
grant execute on function public.commissions_set_status(uuid[], text) to authenticated;
