-- Rollback of 20261028113700_quote_convert_adds_customer: the live body as it
-- was (prosrc md5 4b07717ec5ac88c9a2263c7ff1481c40). Customers it added and
-- quotes it pointed at them stay.

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

  -- An order counts units: a line per shrink becomes its units, at the
  -- shrink's VAT-exclusive price shared across them, to the cent. An amount
  -- off the line is at most what the order's line is worth, which rounding
  -- the unit price down can make a few cents less than the quote's.
  insert into public.order_lines (
    org_id, order_id, product_id, qty_ordered,
    unit_price, list_price, discount_pct, discount_amount, client_generated_id
  )
  select q.org_id, v_order, l.product_id, (l.qty * coalesce(l.units_per_shrink, 1))::integer,
         x.list_price, x.list_price, l.discount_pct,
         least(x.discount_amount, round(l.qty * coalesce(l.units_per_shrink, 1) * x.list_price, 2)), gen_random_uuid()
  from public.quote_lines l
  cross join lateral (
    select round(case when q.prices_include_vat and coalesce(q.vat_rate, 0) > 0
                      then l.list_price * 100 / (100 + q.vat_rate) else l.list_price end
                 / coalesce(l.units_per_shrink, 1), 2) as list_price,
           case when q.prices_include_vat and coalesce(q.vat_rate, 0) > 0 and l.discount_amount is not null
                then round(l.discount_amount * 100 / (100 + q.vat_rate), 2) else l.discount_amount end as discount_amount
  ) x
  where l.quote_id = q.id;

  perform public.quote_mark_converted(q.id, v_order);

  return v_order;
end;
$function$;
