-- A line's discount as a percentage or as an amount off the whole line
-- (owner, 9 Oct). Until now a discount was only a percentage (two decimals),
-- and "P50 off" could not be given exactly.
--
-- * quote_lines, order_lines and recurring_order_lines get `discount_amount`:
--   the amount off the whole line, before VAT. A line has a percentage or an
--   amount, never both. 0 means none, so every existing line and every phone
--   that sends only a percentage is unchanged.
-- * The unit price stays what every total, report and invoice multiplies:
--   with an amount it is the list price less the amount spread over the
--   quantity, to the cent. P50 off 10 is P5.00 each exactly; P50 off 3 is
--   P16.67 each, so the line comes to 1 cent more off than typed (the screens
--   show the line's real total).
-- * A quote turned into an order, and a recurring order when it is placed,
--   keep the amount.
--
-- Rollback: supabase/rollback/20261009220000_line_discount_amount.down.sql.

alter table public.quote_lines
  add column discount_amount numeric(12,2) not null default 0,
  add constraint quote_lines_discount_amount_check
    check (discount_amount >= 0 and not (discount_amount > 0 and discount_pct > 0)
           and discount_amount <= round(qty * list_price, 2));
alter table public.order_lines
  add column discount_amount numeric(12,2) not null default 0,
  add constraint order_lines_discount_amount_check
    check (discount_amount >= 0 and not (discount_amount > 0 and discount_pct > 0));
alter table public.recurring_order_lines
  add column discount_amount numeric(12,2) not null default 0,
  add constraint recurring_order_lines_discount_amount_check
    check (discount_amount >= 0 and not (discount_amount > 0 and discount_pct > 0));

-- Writable where the percentage is (the other columns' grants are by column).
grant update (discount_amount) on public.quote_lines to authenticated;
grant update (discount_amount) on public.order_lines to authenticated;

alter table public.quote_lines alter column unit_price set expression as (
  round(case when discount_amount > 0 then list_price - discount_amount / qty
             else list_price * (1 - discount_pct / 100) end, 2));

CREATE OR REPLACE FUNCTION public.order_lines_apply_discount()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A price typed over a discounted line replaces the discount.
  if tg_op = 'UPDATE'
     and new.unit_price is distinct from old.unit_price
     and new.list_price is not distinct from old.list_price
     and new.discount_pct is not distinct from old.discount_pct
     and new.discount_amount is not distinct from old.discount_amount
     and new.qty_ordered is not distinct from old.qty_ordered
     and old.list_price is not null then
    new.list_price := null;
    new.discount_pct := 0;
    new.discount_amount := 0;
    return new;
  end if;

  if new.list_price is null and (new.discount_pct > 0 or new.discount_amount > 0) then
    new.list_price := new.unit_price;
  end if;

  if new.discount_amount > 0 then
    if new.list_price is null then
      raise exception 'A discounted line needs a price.' using errcode = '22023';
    end if;
    if new.discount_amount > round(new.list_price * new.qty_ordered, 2) then
      raise exception 'The discount is more than the line is worth.' using errcode = '22023';
    end if;
    new.unit_price := round(new.list_price - new.discount_amount / new.qty_ordered, 2);
  elsif new.list_price is not null then
    new.unit_price := round(new.list_price * (1 - new.discount_pct / 100), 2);
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.quote_convert(p_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  q public.quotes;
  v_order uuid;
  v_number text;
begin
  perform public.require_module('distribution');
  perform public.require_module('invoicing');
  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Quote not found.' using errcode = 'P0002';
  end if;
  perform 1 from public.quotes where id = p_quote_id for update;
  select * into q from public.quotes where id = p_quote_id;
  if q.status = 'converted' then
    raise exception 'This quote is already order %.',
      (select order_number from public.orders where id = q.converted_order_id)
      using errcode = '23505';
  end if;
  if q.status = 'declined' then
    raise exception 'This quote was declined. Reopen it before converting it.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.quote_lines where quote_id = q.id) then
    raise exception 'This quote has no products on it.' using errcode = '22023';
  end if;
  if q.store_id is null then
    raise exception 'Choose who the order is for on the quote first.' using errcode = '22023';
  end if;
  if exists (select 1 from public.quote_lines
              where quote_id = q.id and (product_id is null or qty <> trunc(qty))) then
    raise exception 'Only a quote of whole products can become an order. Invoice it instead.'
      using errcode = '22023';
  end if;

  v_number := public.next_document_number(q.org_id, 'order', 'SO');

  insert into public.orders (
    org_id, order_number, store_id, source, received_via,
    contact_name, contact_phone, rep_id, delivery_address, notes,
    client_generated_id
  ) values (
    q.org_id, v_number, q.store_id, 'warehouse_manual', 'other',
    q.contact_name, q.contact_phone, q.rep_id, q.delivery_address,
    concat_ws(E'\n', 'From quote ' || q.quote_number || '.', q.notes),
    gen_random_uuid()
  ) returning id into v_order;

  insert into public.order_lines (
    org_id, order_id, product_id, qty_ordered,
    unit_price, list_price, discount_pct, discount_amount, client_generated_id
  )
  select q.org_id, v_order, l.product_id, l.qty::integer,
         l.list_price, l.list_price, l.discount_pct, l.discount_amount, gen_random_uuid()
  from public.quote_lines l
  where l.quote_id = q.id;

  perform public.quote_mark_converted(q.id, v_order);

  return v_order;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.recurring_order_place(p_id uuid, p_run_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.recurring_order_save(p_id uuid, p_row jsonb, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid := p_id;
begin
  perform public.require_module('distribution');
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one product.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.recurring_orders (
      org_id, name, store_id, rep_id, contact_name, contact_phone,
      frequency, next_run, max_runs, notes
    ) values (
      public.current_org_id(), p_row->>'name', (p_row->>'store_id')::uuid,
      nullif(p_row->>'rep_id', '')::uuid, p_row->>'contact_name', p_row->>'contact_phone',
      p_row->>'frequency', (p_row->>'next_run')::date,
      nullif(p_row->>'max_runs', '')::integer, p_row->>'notes'
    ) returning id into v_id;
  else
    update public.recurring_orders set
      name = p_row->>'name',
      store_id = (p_row->>'store_id')::uuid,
      rep_id = nullif(p_row->>'rep_id', '')::uuid,
      contact_name = p_row->>'contact_name',
      contact_phone = p_row->>'contact_phone',
      frequency = p_row->>'frequency',
      next_run = (p_row->>'next_run')::date,
      max_runs = nullif(p_row->>'max_runs', '')::integer,
      notes = p_row->>'notes',
      updated_at = now()
    where id = v_id;
    if not found then
      raise exception 'Recurring order not found.' using errcode = 'P0002';
    end if;
    delete from public.recurring_order_lines where recurring_order_id = v_id;
  end if;

  insert into public.recurring_order_lines (recurring_order_id, product_id, qty, unit_price, discount_pct, discount_amount)
  select v_id, (x->>'product_id')::uuid, (x->>'qty')::integer,
         nullif(x->>'unit_price', '')::numeric, coalesce(nullif(x->>'discount_pct', '')::numeric, 0),
         coalesce(nullif(x->>'discount_amount', '')::numeric, 0)
  from jsonb_array_elements(p_lines) as x;

  return v_id;
end;
$function$
;
