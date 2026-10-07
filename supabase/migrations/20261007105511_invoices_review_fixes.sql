-- Two fixes to 20261007102716_tax_invoices_and_recurring_orders from review.
--
-- 1. credit_note_issue checked each entry of `p_lines` on its own, so the same
--    invoice line sent twice in one request — [{line, 4}, {line, 4}] against 5
--    invoiced — passed both checks and credited 8. Entries are now summed per
--    line before the check and before the insert.
--
--    It also refuses a credit note larger than what is still owed. There is no
--    refund record in this module, so a credit after payment would drive the
--    balance negative with nothing to say the money went back. A credit for a
--    paid invoice belongs with a refund, which is a later feature.
--
-- 2. Editing a recurring order replaced its lines in two requests — delete,
--    then insert — so a failed insert left it with no products and the next
--    morning run placed nothing. `recurring_order_save` does the update, the
--    delete and the insert in one call, which is one transaction. It is
--    security invoker: the same policies decide what the caller may write.

create or replace function public.credit_note_issue(p_invoice_id uuid, p_reason text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.tax_invoices;
  v_id uuid;
  v_number text;
  v_subtotal numeric;
  v_vat numeric;
  v_outstanding numeric;
  l record;
begin
  perform public.require_permission('warehouse');
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the credit is being given.' using errcode = '22023';
  end if;
  select * into i from public.tax_invoices where id = p_invoice_id and org_id = public.current_org_id() for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  if i.status = 'void' then
    raise exception '% is void; there is nothing to credit.', i.invoice_number using errcode = '22023';
  end if;

  -- Every statement below reads the request summed per line, so a line sent
  -- twice counts once, with both quantities.
  for l in
    select x.invoice_line_id, x.qty, tl.qty as invoiced, tl.description,
           coalesce((select sum(cl.qty) from public.credit_note_lines cl where cl.invoice_line_id = tl.id), 0) as credited
    from (select r.invoice_line_id, sum(r.qty)::integer as qty
          from jsonb_to_recordset(p_lines) as r(invoice_line_id uuid, qty integer)
          where r.qty > 0 group by r.invoice_line_id) x
    left join public.tax_invoice_lines tl on tl.id = x.invoice_line_id and tl.invoice_id = i.id
  loop
    if l.invoiced is null then
      raise exception 'A line on this credit note is not on %.', i.invoice_number using errcode = '22023';
    end if;
    if l.qty + l.credited > l.invoiced then
      raise exception 'Only % of "%" is left to credit.', l.invoiced - l.credited, l.description
        using errcode = '22023';
    end if;
  end loop;

  select coalesce(sum(round(x.qty * tl.unit_price, 2)), 0) into v_subtotal
  from (select r.invoice_line_id, sum(r.qty)::integer as qty
          from jsonb_to_recordset(p_lines) as r(invoice_line_id uuid, qty integer)
          where r.qty > 0 group by r.invoice_line_id) x join public.tax_invoice_lines tl on tl.id = x.invoice_line_id;
  if v_subtotal = 0 then
    raise exception 'Choose at least one line to credit.' using errcode = '22023';
  end if;
  v_vat := round(v_subtotal * i.vat_rate / 100, 2);
  select outstanding into v_outstanding from public.tax_invoice_balances where invoice_id = i.id;
  if v_subtotal + v_vat > v_outstanding then
    raise exception 'This credit (%) is more than the % still owed on %. A credit after payment needs a refund, which is not recorded here.',
      v_subtotal + v_vat, v_outstanding, i.invoice_number using errcode = '22023';
  end if;

  v_number := public.next_document_number(i.org_id, 'credit_note', 'CN');
  insert into public.credit_notes (org_id, credit_number, invoice_id, reason, issue_date, subtotal, vat, total, created_by)
  values (i.org_id, v_number, i.id, trim(p_reason),
          (now() at time zone public.org_timezone(i.org_id))::date,
          v_subtotal, v_vat, v_subtotal + v_vat, auth.uid())
  returning id into v_id;

  insert into public.credit_note_lines (credit_note_id, invoice_line_id, qty, unit_price, line_total)
  select v_id, tl.id, x.qty, tl.unit_price, round(x.qty * tl.unit_price, 2)
  from (select r.invoice_line_id, sum(r.qty)::integer as qty
          from jsonb_to_recordset(p_lines) as r(invoice_line_id uuid, qty integer)
          where r.qty > 0 group by r.invoice_line_id) x
  join public.tax_invoice_lines tl on tl.id = x.invoice_line_id;

  return v_id;
end;
$$;

revoke all on function public.credit_note_issue(uuid, text, jsonb) from public, anon;
grant execute on function public.credit_note_issue(uuid, text, jsonb) to authenticated;

/**
 * Creates (p_id null) or replaces a recurring order and all its lines, in one
 * transaction. `p_row` carries the editable columns; `p_lines` is
 * `[{"product_id": "…", "qty": 2, "unit_price": null, "discount_pct": 0}, …]`.
 */
create or replace function public.recurring_order_save(p_id uuid, p_row jsonb, p_lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
begin
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

  insert into public.recurring_order_lines (recurring_order_id, product_id, qty, unit_price, discount_pct)
  select v_id, (x->>'product_id')::uuid, (x->>'qty')::integer,
         nullif(x->>'unit_price', '')::numeric, coalesce(nullif(x->>'discount_pct', '')::numeric, 0)
  from jsonb_array_elements(p_lines) as x;

  return v_id;
end;
$$;

revoke all on function public.recurring_order_save(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.recurring_order_save(uuid, jsonb, jsonb) to authenticated;
