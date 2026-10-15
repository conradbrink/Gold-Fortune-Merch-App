-- Price lists for groups of stores (owner, 15 Oct 2026: "automatic pricing
-- structures that I can create per group … my admin staff invoices for a
-- forecourt, then the forecourt prices are already put in, or for Choppies").
--
-- A price list is a name and a price per case for some products. A store group
-- uses at most one list. A store is priced from its group's list, and from the
-- product's own price (the catalogue) for anything the list leaves out, or when
-- its group has no list. Gold Fortune, 15 Oct 2026: the catalogue holds its
-- Retailers listing, and "Forecourts & HRC" is a list for the Forecourts and the
-- Hotels, Restaurants & Caterers groups.
--
-- WHERE THE PRICE IS USED
--   * A new order line saved with no price and no discount (a rep's order from
--     the phone, or an office order with the price left blank) takes its
--     store's price as it is saved: `order_lines_price_from_list`. The office
--     can still change it until the order is confirmed. A line that brings a
--     price or a discount keeps what it brings. Before this, a rep's order
--     arrived unpriced on purpose, because only the office knew which customer
--     paid which price; the list is where that knowledge now lives.
--   * A recurring order line with no fixed price takes the store's price on
--     the day the order is placed. It used to take the catalogue's.
--   * The web prefills the same figure on the order, quote and recurring-order
--     screens, so what the clerk sees is what gets saved.
--
-- Prices are per case (shrink) and exclude VAT, like
-- `products.shrink_price_excl_vat`. Order lines are per unit, so the case price
-- is divided by the pack size and rounded to the cent, as the web's
-- `unitPriceFor` does.
--
-- WHO
--   Read: whoever handles orders or bills (warehouse, invoicing), as with
--   `service_items`. Reps read none of it: their lines are priced by the
--   trigger, which is security definer.
--   Write: invoicing, through `price_list_save` and `price_list_delete` only.
--   A list, its prices and the groups using it change together, and an
--   office clerk can give a group a list without the manager role that
--   `store_groups`' own policies require.
--   Module: distribution (products and orders).
--
-- Rollback: supabase/rollback/20261015210000_group_price_lists.down.sql.

------------------------------------------------------------------ the tables

create table public.customer_price_lists (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- For the composite keys below: a price, or a group's choice of list, can
  -- only ever point at a list in its own company.
  unique (org_id, id)
);
comment on table public.customer_price_lists is
  'A company''s named price lists, e.g. "Forecourts & HRC". Store groups use one each (store_groups.price_list_id); a store with no list, or a product the list leaves out, uses the product''s own price.';
create unique index customer_price_lists_org_name_key
  on public.customer_price_lists (org_id, lower(btrim(name)));

create trigger customer_price_lists_updated_at before update on public.customer_price_lists
  for each row execute function public.set_updated_at();

create table public.customer_price_list_items (
  price_list_id         uuid not null,
  org_id                uuid not null,
  product_id            uuid not null references public.products(id) on delete cascade,
  shrink_price_excl_vat numeric(12,2) not null check (shrink_price_excl_vat >= 0),
  primary key (price_list_id, product_id),
  foreign key (org_id, price_list_id)
    references public.customer_price_lists (org_id, id) on delete cascade
);
comment on table public.customer_price_list_items is
  'One product''s price on one price list: per case (shrink), excluding VAT, like products.shrink_price_excl_vat. No row means the product''s own price.';
create index customer_price_list_items_product_idx
  on public.customer_price_list_items (product_id);

alter table public.store_groups
  add column price_list_id uuid,
  add constraint store_groups_price_list_fkey
    foreign key (org_id, price_list_id)
    references public.customer_price_lists (org_id, id)
    on delete set null (price_list_id);
create index store_groups_price_list_id_idx on public.store_groups (price_list_id);
comment on column public.store_groups.price_list_id is
  'The price list this group''s stores are charged from. Null: the products'' own prices. Set through price_list_save.';

------------------------------------------------------------------ who sees it

alter table public.customer_price_lists enable row level security;
create policy customer_price_lists_select on public.customer_price_lists for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))));
create policy module_gate on public.customer_price_lists as restrictive for all
  using ((select public.module_enabled('distribution'))) with check ((select public.module_enabled('distribution')));
revoke all on public.customer_price_lists from anon, authenticated;
grant select on public.customer_price_lists to authenticated;

alter table public.customer_price_list_items enable row level security;
create policy customer_price_list_items_select on public.customer_price_list_items for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse'))));
create policy module_gate on public.customer_price_list_items as restrictive for all
  using ((select public.module_enabled('distribution'))) with check ((select public.module_enabled('distribution')));
revoke all on public.customer_price_list_items from anon, authenticated;
grant select on public.customer_price_list_items to authenticated;

--------------------------------------------------------- a store's unit price

-- What one unit of a product costs a store: its group's list price, else the
-- product's own, per case divided by the pack size. Null when there is no
-- price or no pack size, so a line is left for the office rather than priced
-- from a missing factor (as unitPriceFor). Every join is held to the product's
-- company.
--
-- Not callable by `authenticated`: it answers for any product id it is given.
-- Only the security-definer callers below use it, with ids from rows of the
-- caller's own company.
create function public.store_unit_price(p_store_id uuid, p_product_id uuid)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select round(coalesce(i.shrink_price_excl_vat, p.shrink_price_excl_vat)
               / nullif(p.units_per_shrink, 0), 2)
    from public.products p
    left join public.stores s
           on s.id = p_store_id and s.org_id = p.org_id
    left join public.store_groups g
           on g.id = s.store_group_id and g.org_id = p.org_id
    left join public.customer_price_list_items i
           on i.price_list_id = g.price_list_id and i.product_id = p.id and i.org_id = p.org_id
   where p.id = p_product_id
$$;
revoke all on function public.store_unit_price(uuid, uuid) from public, anon, authenticated;

comment on function public.store_unit_price(uuid, uuid) is
  'Per-unit price excl VAT of a product for a store: its group''s price list, else the product''s own price; case price / units_per_shrink, rounded to the cent. Internal: not granted to authenticated.';

----------------------------------------------- new order lines are priced

-- Fires after `order_lines_apply_discount` and `order_lines_org_guard`
-- (triggers of one kind fire in name order), so it sees the line as those
-- left it, and only ever fills a line that has no price and no discount at all.
create function public.order_lines_price_from_list()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.unit_price is null and new.list_price is null
     and new.discount_pct = 0 and new.discount_amount = 0 then
    select public.store_unit_price(o.store_id, new.product_id)
      into new.unit_price
      from public.orders o
     where o.id = new.order_id and o.org_id = new.org_id;
  end if;
  return new;
end;
$$;
revoke all on function public.order_lines_price_from_list() from public, anon, authenticated;

create trigger order_lines_price_from_list before insert on public.order_lines
  for each row execute function public.order_lines_price_from_list();

----------------------------------- recurring orders: the store's price on the day

-- As 20261009220000, with one change: a line with no fixed price takes
-- store_unit_price (its group's list) instead of the catalogue price.
create or replace function public.recurring_order_place(p_id uuid, p_run_date date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.recurring_orders;
  v_order uuid;
  v_next date;
begin
  select * into r from public.recurring_orders where id = p_id for update;
  if not found or r.status <> 'active' then return null; end if;

  insert into public.recurring_order_runs (recurring_order_id, run_date)
  values (r.id, p_run_date)
  on conflict (recurring_order_id, run_date) do nothing;
  if not found then return null; end if;

  if not exists (select 1 from public.recurring_order_lines where recurring_order_id = r.id) then
    update public.recurring_order_runs set error = 'No products on this recurring order.'
     where recurring_order_id = r.id and run_date = p_run_date;
    return null;
  end if;

  insert into public.orders (
    org_id, order_number, store_id, source, received_via, contact_name, contact_phone,
    rep_id, notes, recurring_order_id, client_generated_id
  ) values (
    r.org_id, public.next_document_number(r.org_id, 'order', 'SO'), r.store_id,
    'warehouse_manual', 'other', r.contact_name, r.contact_phone, r.rep_id,
    concat_ws(E'\n', 'Recurring order: ' || r.name || '.', r.notes),
    r.id, gen_random_uuid()
  ) returning id into v_order;

  -- An amount off the line is spread over the quantity, never below nothing
  -- (the product's price may have dropped since the amount was set).
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  select r.org_id, v_order, l.product_id, l.qty,
         case when l.discount_amount > 0
              then greatest(round(x.price - l.discount_amount / l.qty, 2), 0)
              else round(x.price * (1 - l.discount_pct / 100), 2) end,
         gen_random_uuid()
  from public.recurring_order_lines l
  join public.products p on p.id = l.product_id
  cross join lateral (select coalesce(l.unit_price, public.store_unit_price(r.store_id, l.product_id)) as price) x
  where l.recurring_order_id = r.id;

  update public.recurring_order_runs set order_id = v_order
   where recurring_order_id = r.id and run_date = p_run_date;

  v_next := r.next_run;
  while v_next <= p_run_date loop
    v_next := public.recurring_next_date(v_next, r.frequency);
  end loop;
  update public.recurring_orders
     set runs = runs + 1,
         next_run = v_next,
         status = case when max_runs is not null and runs + 1 >= max_runs then 'ended' else status end,
         updated_at = now()
   where id = r.id;
  return v_order;
end;
$$;

------------------------------------------------------------- saving a list

-- Creates (p_id null) or replaces a price list: its name, every price on it,
-- and which groups use it. p_prices is [{"product_id": …, "price": …}], price
-- per case excl VAT; a product left out uses its own price. A group named here
-- moves to this list from any other; a group that used this list and is not
-- named stops using it. All or nothing.
create function public.price_list_save(
  p_id uuid,
  p_name text,
  p_group_ids uuid[],
  p_prices jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid := public.current_org_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
  v_txt  text;
begin
  perform public.require_module('distribution');
  perform public.require_permission('invoicing');

  if v_name = '' or length(v_name) > 80 then
    raise exception 'A price list needs a name of up to 80 characters.' using errcode = '22023';
  end if;
  if p_prices is null or jsonb_typeof(p_prices) <> 'array' then
    raise exception 'The prices have to be a list.' using errcode = '22023';
  end if;

  if exists (select 1 from public.customer_price_lists
              where org_id = v_org and lower(btrim(name)) = lower(v_name)
                and id is distinct from p_id) then
    raise exception 'There is already a price list called "%".', v_name using errcode = '23505';
  end if;

  -- Every price is checked before anything is written.
  if exists (select 1 from jsonb_array_elements(p_prices) e where jsonb_typeof(e) <> 'object') then
    raise exception 'Each price needs a product and a price.' using errcode = '22023';
  end if;
  select string_agg(coalesce(x.product_id::text, '(none)'), ', ') into v_txt
    from jsonb_to_recordset(p_prices) as x(product_id uuid, price numeric)
   where x.product_id is null
      or not exists (select 1 from public.products p where p.id = x.product_id and p.org_id = v_org);
  if v_txt is not null then
    raise exception 'These are not your products: %', v_txt using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_prices) as x(product_id uuid, price numeric)
              where x.price is null or x.price < 0 or x.price >= 10000000000) then
    raise exception 'A price has to be a number, nothing below zero.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_prices) as x(product_id uuid, price numeric)
              group by x.product_id having count(*) > 1) then
    raise exception 'A product is on the list twice.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_group_ids, '{}')) gid
              where not exists (select 1 from public.store_groups g where g.id = gid and g.org_id = v_org)) then
    raise exception 'One of those groups is not yours.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.customer_price_lists (org_id, name)
    values (v_org, v_name)
    returning id into v_id;
  else
    update public.customer_price_lists
       set name = v_name, updated_at = now()
     where id = p_id and org_id = v_org
    returning id into v_id;
    if v_id is null then
      raise exception 'That price list no longer exists.' using errcode = 'P0002';
    end if;
  end if;

  delete from public.customer_price_list_items where price_list_id = v_id;
  insert into public.customer_price_list_items (price_list_id, org_id, product_id, shrink_price_excl_vat)
  select v_id, v_org, x.product_id, round(x.price, 2)
    from jsonb_to_recordset(p_prices) as x(product_id uuid, price numeric);

  update public.store_groups
     set price_list_id = null
   where org_id = v_org and price_list_id = v_id
     and not (id = any (coalesce(p_group_ids, '{}')));
  update public.store_groups
     set price_list_id = v_id
   where org_id = v_org and id = any (coalesce(p_group_ids, '{}'));

  return v_id;
end;
$$;
revoke all on function public.price_list_save(uuid, text, uuid[], jsonb) from public, anon;
grant execute on function public.price_list_save(uuid, text, uuid[], jsonb) to authenticated;

comment on function public.price_list_save(uuid, text, uuid[], jsonb) is
  'Creates (p_id null) or replaces a price list: name, every price (per case excl VAT; a product left out uses its own price) and the store groups that use it. Needs invoicing; all or nothing.';

-- Deletes a list. Its groups go back to the products' own prices; orders
-- already priced from it keep their prices.
create function public.price_list_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_module('distribution');
  perform public.require_permission('invoicing');

  delete from public.customer_price_lists
   where id = p_id and org_id = public.current_org_id();
  if not found then
    raise exception 'That price list no longer exists.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.price_list_delete(uuid) from public, anon;
grant execute on function public.price_list_delete(uuid) to authenticated;

------------------------------------------------------------------ modules

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'customer_price_lists', 'distribution'),
  ('table', 'customer_price_list_items', 'distribution'),
  ('function', 'price_list_save', 'distribution'),
  ('function', 'price_list_delete', 'distribution')
on conflict do nothing;
