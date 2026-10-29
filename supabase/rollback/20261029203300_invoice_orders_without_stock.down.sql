-- Rollback of 20261029203300_invoice_orders_without_stock. Orders confirmed,
-- invoiced or cancelled through these functions stay as they are.

delete from public.module_assignments
 where kind = 'function' and name in ('order_invoice_without_stock', 'order_cancel_without_stock');

drop function if exists public.order_invoice_without_stock(uuid);
drop function if exists public.order_cancel_without_stock(uuid, text);

-- The old rule again. NOT VALID when an order was confirmed without a
-- location meanwhile, so the rollback does not fail on the orders it made:
-- new rows are checked, those are left as they are.
alter table public.orders drop constraint orders_fulfil_location_set;
do $$
begin
  if exists (select 1 from public.orders where status = 'confirmed' and fulfil_location_id is null) then
    alter table public.orders add constraint orders_fulfil_location_set
      check (status in ('new', 'cancelled') or fulfil_location_id is not null) not valid;
  else
    alter table public.orders add constraint orders_fulfil_location_set
      check (status in ('new', 'cancelled') or fulfil_location_id is not null);
  end if;
end;
$$;
