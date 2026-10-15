-- Rollback of 20261015210000_group_price_lists: price lists, their prices, the
-- groups' choice of list, the order-line trigger and the internal price
-- function go; recurring orders take the catalogue price again
-- (recurring_order_place as 20261009220000).
--
-- Refuses while any company has a price list: those are prices somebody typed
-- in, and dropping the tables would lose them without a word. Delete the lists
-- deliberately first (price_list_delete, or the Price lists page), or take a
-- copy of customer_price_lists and customer_price_list_items, then run this.
-- Orders already priced from a list keep their prices either way.

do $$
begin
  if exists (select 1 from public.customer_price_lists) then
    raise exception 'Price lists exist (%). Delete them, or copy them, before rolling back.',
      (select count(*) from public.customer_price_lists);
  end if;
end $$;

delete from public.module_assignments
 where (kind = 'table' and name in ('customer_price_lists', 'customer_price_list_items'))
    or (kind = 'function' and name in ('price_list_save', 'price_list_delete'));

drop function public.price_list_delete(uuid);
drop function public.price_list_save(uuid, text, uuid[], jsonb);

drop trigger order_lines_price_from_list on public.order_lines;
drop function public.order_lines_price_from_list();

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
  cross join lateral (select coalesce(l.unit_price, p.shrink_price_excl_vat / nullif(p.units_per_shrink, 0)) as price) x
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

drop function public.store_unit_price(uuid, uuid);

alter table public.store_groups drop constraint store_groups_price_list_fkey;
drop index public.store_groups_price_list_id_idx;
alter table public.store_groups drop column price_list_id;

drop table public.customer_price_list_items;
drop table public.customer_price_lists;
