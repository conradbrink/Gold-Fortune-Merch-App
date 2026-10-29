-- Rollback of 20261029203300_invoice_orders_without_stock. Orders invoiced,
-- finished or cancelled through these functions stay as they are.

delete from public.module_assignments
 where kind = 'function' and name in ('order_invoice_without_stock', 'order_cancel_without_stock');

drop function if exists public.order_invoice_without_stock(uuid);
drop function if exists public.order_cancel_without_stock(uuid, text);

-- The transition guard as it was (prosrc md5 d2eeddeb0d6c2d023dc67022e4ab6731).
CREATE OR REPLACE FUNCTION public.orders_enforce_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_legal boolean;
begin
  if new.status is not distinct from old.status then
    if new.org_id is distinct from old.org_id then
      raise exception 'An order cannot be moved to another organisation.'
        using errcode = '42501';
    end if;
    if new.store_id is distinct from old.store_id and old.status <> 'new' then
      raise exception 'Order % has been confirmed; it cannot be moved to another location.',
        old.order_number using errcode = '42501';
    end if;
    return new;
  end if;

  if old.on_hold and new.status <> 'cancelled' then
    raise exception 'Order % is on hold (%). Release the hold first.',
      old.order_number, coalesce(old.hold_reason, 'no reason given')
      using errcode = '42501';
  end if;

  v_legal := (old.status, new.status) in (
    ('new', 'confirmed'),       ('new', 'cancelled'),
    ('confirmed', 'picking'),   ('confirmed', 'cancelled'),
    ('picking', 'confirmed'),   ('picking', 'packed'),      ('picking', 'cancelled'),
    ('packed', 'picking'),      ('packed', 'dispatched'),   ('packed', 'cancelled'),
    ('dispatched', 'delivered'),('dispatched', 'cancelled'),('dispatched', 'packed')
  );

  if not v_legal then
    raise exception 'An order cannot go from % to %.', old.status, new.status
      using errcode = '42501';
  end if;

  if old.status = 'dispatched' and new.status in ('cancelled', 'packed')
     and coalesce(current_setting('app.stock_returned', true), '') <> new.id::text then
    raise exception
      'Take a dispatched order back through order_return_undelivered(), so the stock comes with it.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- The old location rule, only while no order was finished without stock. A
-- CHECK is enforced on every update even when added NOT VALID, so with such
-- orders present the old rule would stop their invoices being voided or their
-- details edited: the current rule stays, which says the same for every
-- other order.
do $$
begin
  if not exists (select 1 from public.orders
                  where status = 'delivered' and dispatched_at is null and fulfil_location_id is null) then
    alter table public.orders drop constraint orders_fulfil_location_set;
    alter table public.orders add constraint orders_fulfil_location_set
      check (status in ('new', 'cancelled') or fulfil_location_id is not null);
  else
    raise notice 'Orders were finished without stock: orders_fulfil_location_set keeps the rule that allows them.';
  end if;
end;
$$;
