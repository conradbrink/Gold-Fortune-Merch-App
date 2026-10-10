-- Three money defects found in the 10 Oct 2026 audit, each reproduced on a
-- local copy before this was written.
--
-- 1. quote_convert copied a VAT-inclusive quote's prices into the order as
--    they were, and an order always adds VAT on top: a R1,150 quote (R150 VAT
--    included, at 15%) became an order invoiced at R1,322.50. Inclusive
--    prices and amount discounts are now taken back to their VAT-exclusive
--    value on the way in. No converted inclusive quote exists on production.
-- 2. tax_invoice_issue priced an order line with no price at 0.00 and said
--    nothing. It now refuses and names the products. (Confirming an order
--    with unpriced lines is still allowed, as before.)
-- 3. A deposit invoice could still be credited after the final invoice had
--    taken that deposit off, so the client owed less than the quote. Voiding
--    it was already refused; crediting it now is too.
--
-- Bodies are patched in place, each anchor asserted to appear once; the
-- rollback reverses each patch.

do $$
declare
  r record;
  def text;
  n int;
begin
  for r in
    select * from (values
      ('quote_convert(uuid)',
       '         l.list_price, l.list_price, l.discount_pct, l.discount_amount, gen_random_uuid()',
       '         x.list_price, x.list_price, l.discount_pct, x.discount_amount, gen_random_uuid()'),
      ('quote_convert(uuid)',
       E'  from public.quote_lines l\n  where l.quote_id = q.id;',
       E'  from public.quote_lines l\n'
       || E'  cross join lateral (\n'
       || E'    select case when q.prices_include_vat and coalesce(q.vat_rate, 0) > 0\n'
       || E'                then round(l.list_price * 100 / (100 + q.vat_rate), 2) else l.list_price end as list_price,\n'
       || E'           case when q.prices_include_vat and coalesce(q.vat_rate, 0) > 0 and l.discount_amount is not null\n'
       || E'                then round(l.discount_amount * 100 / (100 + q.vat_rate), 2) else l.discount_amount end as discount_amount\n'
       || E'  ) x\n'
       || E'  where l.quote_id = q.id;'),
      ('tax_invoice_issue(uuid,date)',
       E'  select * into org from public.organizations where id = v_org;\n  select * into s from public.stores where id = o.store_id;',
       E'  if exists (select 1 from public.order_lines ol\n'
       || E'              where ol.order_id = o.id and ol.unit_price is null\n'
       || E'                and (case when o.status = ''delivered'' then ol.qty_delivered - ol.qty_returned\n'
       || E'                          else ol.qty_dispatched end) > 0) then\n'
       || E'    raise exception ''% has products with no price: %. Price them before invoicing.'', o.order_number,\n'
       || E'      (select string_agg(p.name, '', '' order by p.name) from public.order_lines ol\n'
       || E'         join public.products p on p.id = ol.product_id\n'
       || E'        where ol.order_id = o.id and ol.unit_price is null)\n'
       || E'      using errcode = ''22023'';\n'
       || E'  end if;\n'
       || E'  select * into org from public.organizations where id = v_org;\n  select * into s from public.stores where id = o.store_id;'),
      ('credit_note_issue(uuid,text,jsonb)',
       E'    raise exception ''% is void; there is nothing to credit.'', i.invoice_number using errcode = ''22023'';\n  end if;',
       E'    raise exception ''% is void; there is nothing to credit.'', i.invoice_number using errcode = ''22023'';\n  end if;\n'
       || E'  if i.kind = ''deposit'' and exists (select 1 from public.tax_invoices f\n'
       || E'                                     where f.quote_id = i.quote_id and f.status = ''issued'' and f.kind = ''final'') then\n'
       || E'    raise exception ''The final invoice for this quote takes % off. Credit the final invoice instead.'', i.invoice_number\n'
       || E'      using errcode = ''22023'';\n'
       || E'  end if;')
    ) v(fn, old_text, new_text)
  loop
    def := pg_get_functiondef(('public.' || r.fn)::regprocedure);
    n := (length(def) - length(replace(def, r.old_text, ''))) / length(r.old_text);
    if n <> 1 then
      raise exception '%: expected 1 of the anchor, found %', r.fn, n;
    end if;
    execute replace(def, r.old_text, r.new_text);
  end loop;
end;
$$;
