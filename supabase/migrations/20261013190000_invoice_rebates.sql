-- Rebates kept by the customer (13 Oct 2026).
--
-- Gold Fortune's owner: "the rebate is deducted from the invoice from these
-- big retail groups and entered in after payment is received". A retail group
-- pays the invoice short, keeping its rebate, and the office closes the
-- invoice by recording the rebate.
--
-- A rebate is an amount of money, not goods coming back, so it is a credit
-- note with no lines: its total is the amount, the VAT in it worked out at the
-- invoice's rate (the amount was taken off a total that included VAT). Its
-- reason starts "Rebate", which is how statements and the invoice page tell it
-- from a credit for returned goods. It can be at most what is still owed.

create function public.invoice_rebate(p_invoice_id uuid, p_amount numeric, p_on date default null,
                                      p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  i public.tax_invoices;
  v_outstanding numeric;
  v_vat numeric;
  v_number text;
  v_id uuid;
  v_reason text := 'Rebate' || coalesce(': ' || nullif(btrim(p_reason), ''), '');
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  select * into i from public.tax_invoices where id = p_invoice_id and org_id = public.current_org_id() for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  if i.status = 'void' then
    raise exception '% is void.', i.invoice_number using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'A rebate is more than zero, to the cent.' using errcode = '22023';
  end if;
  select outstanding into v_outstanding from public.tax_invoice_balances where invoice_id = i.id;
  if p_amount > v_outstanding then
    raise exception 'Only % is still owed on %.', v_outstanding, i.invoice_number using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'The reason is up to 490 characters.' using errcode = '22023';
  end if;

  v_vat := round(p_amount * i.vat_rate / (100 + i.vat_rate), 2);
  v_number := public.next_document_number_internal(i.org_id, 'credit_note', 'CN');
  insert into public.credit_notes (org_id, credit_number, invoice_id, reason, issue_date, subtotal, vat, total, created_by)
  values (i.org_id, v_number, i.id, v_reason,
          coalesce(p_on, (now() at time zone public.org_timezone(i.org_id))::date),
          p_amount - v_vat, v_vat, p_amount, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.invoice_rebate(uuid, numeric, date, text) from public, anon;
grant execute on function public.invoice_rebate(uuid, numeric, date, text) to authenticated;

insert into public.module_assignments (kind, name, module_code)
values ('function', 'invoice_rebate', 'invoicing')
on conflict do nothing;
