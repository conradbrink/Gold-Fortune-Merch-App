-- A quote for someone new can become an order (28 Oct 2026).
--
-- The owner: "when we create a new customer on the quote and we convert the
-- order to an invoice, that customer doesn't exist." A quote's "Someone new"
-- keeps only a typed name and address (quotes.customer_name), never a
-- customer record, and an order must name one (orders.store_id). So Convert
-- to order refused every such quote with "Choose who the order is for on the
-- quote first.", and there was no way on the quote to add them. On 27 Oct
-- Gold Fortune typed 18 forecourts into quotes this way, 4 of which were
-- already on its books under the same name.
--
-- quote_convert now settles the customer itself, before the order:
--   - one active customer of the same name (case and spacing ignored): that one;
--   - more than one: refused, naming them, to be chosen on the quote;
--   - none: added, with the name and address typed on the quote, by someone
--     with the warehouse permission (stores_insert); others are told so.
-- An advisory lock per company and name stops two converts adding the same
-- customer twice.
-- The quote is pointed at them in the same transaction, so quote_mark_converted
-- (which checks the order and the quote name the same customer) is unchanged,
-- and a refusal further on (no lines, already converted) adds nobody.
--
-- The check for whole products moves above this step for the same reason.
-- Everything else is the live body (prosrc md5 4b07717e…) unchanged. Still
-- security invoker: adding a customer needs what stores_insert asks, the
-- warehouse permission, which making the order (orders_insert,
-- warehouse_manual) already needs.

CREATE OR REPLACE FUNCTION public.quote_convert(p_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  q public.quotes;
  v_order uuid;
  v_number text;
  v_matches uuid[];
  v_store uuid;
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
  if exists (select 1 from public.quote_lines
              where quote_id = q.id and (product_id is null or qty <> trunc(qty))) then
    raise exception 'Only a quote of whole products can become an order. Invoice it instead.'
      using errcode = '22023';
  end if;

  -- A quote for someone new carries only a typed name, and an order needs a
  -- customer on the books. The one of that name, when there is exactly one;
  -- otherwise they are added, from the name and address on the quote. The
  -- quote then points at them, as if they had been picked.
  if q.store_id is null then
    -- One at a time per name: two quotes for the same new customer converted
    -- together would otherwise each find nobody and each add them.
    perform pg_advisory_xact_lock(hashtext('quote_customer'),
      hashtext(q.org_id::text || lower(regexp_replace(btrim(q.customer_name), '\s+', ' ', 'g'))));
    select array_agg(s.id order by s.created_at) into v_matches
      from public.stores s
     where s.org_id = q.org_id
       and s.active
       and lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g'))
         = lower(regexp_replace(btrim(q.customer_name), '\s+', ' ', 'g'));
    if cardinality(v_matches) > 1 then
      raise exception 'More than one customer on your books is called "%". Choose which one on the quote first.',
        btrim(q.customer_name) using errcode = '22023';
    elsif cardinality(v_matches) = 1 then
      v_store := v_matches[1];
    else
      -- stores_insert would refuse anyway; this says why in words.
      if not public.has_permission('warehouse') then
        raise exception '% is not on your books yet, and adding a customer needs the warehouse permission. Ask someone who has it to convert this quote.',
          btrim(q.customer_name) using errcode = '42501';
      end if;
      insert into public.stores (org_id, name, address)
      values (q.org_id, regexp_replace(btrim(q.customer_name), '\s+', ' ', 'g'),
              nullif(btrim(q.customer_address), ''))
      returning id into v_store;
    end if;
    update public.quotes set store_id = v_store where id = q.id;
    q.store_id := v_store;
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
