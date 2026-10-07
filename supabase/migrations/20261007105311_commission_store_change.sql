-- From review: a commission is chosen partly by store (a store-specific rule),
-- and a manager can change a delivered order's store, but `orders_commission`
-- only watched status and rep. A pending commission could keep the old store's
-- rule and amount. Now it watches store_id too. Approved and paid commissions
-- are still left alone by commission_calculate.
drop trigger if exists orders_commission on public.orders;
create trigger orders_commission
  after update of status, rep_id, store_id on public.orders
  for each row
  when (new.status = 'delivered' or old.status = 'delivered')
  execute function public.commission_on_order_change();
