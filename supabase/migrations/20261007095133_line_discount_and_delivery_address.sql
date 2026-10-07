-- A discount on each order line, and a delivery address on the order.
--
-- ------------------------------------------------- why unit_price stays net
--
-- Six report functions value a line as `qty * unit_price`: rep performance in
-- its three guarded versions, the catch-up variants, and the inventory value
-- report. Adding a discount as a column those functions would have to learn to
-- subtract means rewriting all six, and missing one overstates revenue on
-- exactly the orders somebody negotiated down.
--
-- So `unit_price` keeps meaning what every reader already takes it to mean —
-- what this line is actually sold at, excluding VAT — and the discount is
-- recorded beside it: `list_price` is the price before the discount and
-- `discount_pct` the percentage off. The trigger below derives `unit_price`
-- from the two whenever a list price is present. Every existing report is then
-- correct without being touched.
--
-- ------------------------------------------- the phone app and old lines
--
-- The rep app (1.1.11 and older) knows nothing of these columns. It posts
-- `unit_price` alone, which lands with `list_price` null and `discount_pct` 0,
-- and the trigger leaves it as sent — the same line it always wrote.
--
-- A later write that changes `unit_price` on its own, on a line that carried a
-- discount, is somebody typing over the net price. The discount no longer
-- describes that figure, so it is cleared rather than left to disagree with it.

alter table public.order_lines
  add column if not exists list_price numeric(12,2),
  add column if not exists discount_pct numeric(5,2) not null default 0;

alter table public.order_lines drop constraint if exists order_lines_discount_pct_check;
alter table public.order_lines add constraint order_lines_discount_pct_check
  check (discount_pct >= 0 and discount_pct <= 100);

alter table public.order_lines drop constraint if exists order_lines_list_price_check;
alter table public.order_lines add constraint order_lines_list_price_check
  check (list_price is null or list_price >= 0);

comment on column public.order_lines.list_price is
  'Price per unit before the line discount, excluding VAT. Null when no discount was given; unit_price is then the price as entered.';
comment on column public.order_lines.discount_pct is
  'Percentage off list_price. unit_price is derived from the two by order_lines_apply_discount, so reports reading unit_price see the discounted value.';

create or replace function public.order_lines_apply_discount()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Typed over the net price on a discounted line: the discount no longer
  -- describes it.
  if tg_op = 'UPDATE'
     and new.unit_price is distinct from old.unit_price
     and new.list_price is not distinct from old.list_price
     and new.discount_pct is not distinct from old.discount_pct
     and old.list_price is not null then
    new.list_price := null;
    new.discount_pct := 0;
    return new;
  end if;

  -- A discount with no list price is a discount off the price that was sent.
  if new.list_price is null and new.discount_pct > 0 then
    new.list_price := new.unit_price;
  end if;

  if new.list_price is not null then
    new.unit_price := round(new.list_price * (1 - new.discount_pct / 100), 2);
  end if;

  return new;
end;
$$;

drop trigger if exists order_lines_apply_discount on public.order_lines;
create trigger order_lines_apply_discount
  before insert or update on public.order_lines
  for each row execute function public.order_lines_apply_discount();

-- Same window as unit_price: the line's update policy only admits a `new`
-- order, so a discount closes with the price when the warehouse confirms.
grant update (list_price, discount_pct) on public.order_lines to authenticated;

-- ---------------------------------------------------- delivery address

alter table public.orders
  add column if not exists delivery_address text;

comment on column public.orders.delivery_address is
  'Where this order goes when it is not the store''s own address. Null means deliver to the store.';

grant update (delivery_address) on public.orders to authenticated;
