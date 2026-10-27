-- A quote's product priced per shrink (27 Oct 2026).
--
-- The catalogue and the price lists are per shrink, but a quote's product line
-- was priced per unit only: R771.69 a shrink of 10 had to be typed as 77.17 a
-- unit. A product line can now be per shrink: its qty counts shrinks and its
-- price is a shrink's, so the quote, its PDF and the client's link show the
-- shrink price as typed.
--
--   * quote_lines.units_per_shrink: how many units were in the product's
--     shrink when the line was written, kept on the line so a later change to
--     the catalogue does not change what the quote offered. Null = per unit.
--     The screens also write unit = 'shrink' on such a line, which is what the
--     PDF and the client's page print beside the qty.
--   * quote_save writes it.
--   * quote_convert makes the order in units, as every order is: qty x units
--     per shrink, at the shrink price divided by the units, to the cent, the
--     same rule a rep's order is priced by (store_unit_price). So a shrink at
--     771.69 becomes 10 units at 77.17 and the order can differ from the quote
--     by a few cents. A percentage discount stays the same; an amount off the
--     line stays the same amount.
--
-- Totals everywhere are qty x unit_price, which holds for a shrink line too,
-- so nothing else changes.

alter table public.quote_lines
  add column units_per_shrink integer,
  add constraint quote_lines_units_per_shrink check (
    units_per_shrink is null or (product_id is not null and units_per_shrink > 0));

create or replace function public.quote_save(p_quote uuid, p_loaded_at timestamptz, p_header jsonb, p_lines jsonb)
returns void
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  q record;
  v_status text;
  v_n integer;
  v_added jsonb;
begin
  perform public.require_module('invoicing');
  perform public.require_writable();
  if p_header is null or jsonb_typeof(p_header) <> 'object' then
    raise exception 'Who the quote is for is missing.' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line before saving the quote.' using errcode = '22023';
  end if;

  select id, org_id, status, updated_at into q from public.quotes where id = p_quote for update;
  if not found then
    -- A converted quote is visible but cannot be locked for update.
    select status into v_status from public.quotes where id = p_quote;
    if v_status = 'converted' then
      raise exception 'This quote is already an order. Change the order instead.' using errcode = '42501';
    end if;
    raise exception 'Quote not found.' using errcode = 'P0002';
  end if;
  if q.status = 'accepted' then
    raise exception 'This quote was accepted. Reopen it on its page to change it; if it has been invoiced, void the invoices first.'
      using errcode = '42501';
  end if;
  if q.status not in ('draft', 'sent') then
    raise exception 'This quote was %. Reopen it on its page to change it.', q.status using errcode = '42501';
  end if;
  if p_loaded_at is null or q.updated_at is distinct from p_loaded_at then
    raise exception 'This quote was changed after you opened it, perhaps by someone else or by sending it. Reload the page to see it as it is now, then make your changes again.'
      using hint = 'stale';
  end if;

  update public.quotes
     set store_id = case when q.status = 'draft' then (p_header->>'store_id')::uuid else store_id end,
         customer_name = case when q.status = 'draft' then p_header->>'customer_name' else customer_name end,
         customer_address = case when q.status = 'draft' then p_header->>'customer_address' else customer_address end,
         contact_email = case when q.status = 'draft' then p_header->>'contact_email' else contact_email end,
         contact_name = p_header->>'contact_name',
         contact_phone = p_header->>'contact_phone',
         rep_id = (p_header->>'rep_id')::uuid,
         valid_until = (p_header->>'valid_until')::date,
         delivery_address = p_header->>'delivery_address',
         notes = p_header->>'notes'
   where id = q.id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'The quote was not saved. Reload the page to see where it stands.' using errcode = '42501';
  end if;

  -- When each saved line was added, so a line that stays keeps it.
  select jsonb_object_agg(id, created_at) into v_added from public.quote_lines where quote_id = q.id;
  delete from public.quote_lines where quote_id = q.id;
  insert into public.quote_lines
    (id, org_id, quote_id, position, product_id, service_item_id, description, unit, units_per_shrink,
     qty, list_price, discount_pct, discount_amount, created_at)
  select y.id, q.org_id, q.id, y.ord::integer,
         nullif(y.l->>'product_id', '')::uuid, nullif(y.l->>'service_item_id', '')::uuid,
         nullif(btrim(y.l->>'description'), ''), nullif(btrim(y.l->>'unit'), ''),
         nullif(y.l->>'units_per_shrink', '')::integer,
         (y.l->>'qty')::numeric, (y.l->>'list_price')::numeric,
         coalesce((y.l->>'discount_pct')::numeric, 0), coalesce((y.l->>'discount_amount')::numeric, 0),
         coalesce((v_added->>y.id::text)::timestamptz, now())
    from (select coalesce(nullif(x.l->>'id', '')::uuid, gen_random_uuid()) as id, x.l, x.ord
            from jsonb_array_elements(p_lines) with ordinality as x(l, ord)) y;
end;
$function$;

create or replace function public.quote_convert(p_quote_id uuid)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
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
  -- shrink's VAT-exclusive price shared across them, to the cent.
  insert into public.order_lines (
    org_id, order_id, product_id, qty_ordered,
    unit_price, list_price, discount_pct, discount_amount, client_generated_id
  )
  select q.org_id, v_order, l.product_id, (l.qty * coalesce(l.units_per_shrink, 1))::integer,
         x.list_price, x.list_price, l.discount_pct, x.discount_amount, gen_random_uuid()
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
