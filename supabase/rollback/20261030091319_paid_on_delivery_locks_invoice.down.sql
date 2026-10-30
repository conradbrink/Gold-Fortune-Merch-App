-- Rollback of 20261030091319_paid_on_delivery_locks_invoice: the function as
-- 20261030091119 wrote it, reading the invoice without its lock.

create or replace function public.orders_paid_on_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  o public.orders;
  i public.tax_invoices;
  v_outstanding numeric;
  v_paid_on date;
begin
  -- Read again at commit: the order may have moved on since this was queued.
  select * into o from public.orders where id = new.id;
  if not found or o.status <> 'delivered' or not public.order_invoices_on(o.org_id)
     or not coalesce((select (cs.value)::boolean from public.company_settings cs
                       where cs.org_id = o.org_id and cs.key = 'money_paid_on_delivery'), false) then
    return null;
  end if;

  select * into i from public.tax_invoices t
   where t.order_id = o.id and t.status = 'issued' and t.source = 'order';
  if not found then
    return null;
  end if;
  select b.outstanding into v_outstanding from public.tax_invoice_balances b where b.invoice_id = i.id;
  if coalesce(v_outstanding, 0) <= 0 then
    return null;
  end if;

  -- The delivery day where the company is. A time zone the database does not
  -- know must not stop a delivery from saving: the server's day stands in.
  begin
    select (coalesce(o.delivered_at, now()) at time zone coalesce(org.timezone, 'Africa/Johannesburg'))::date
      into v_paid_on
      from public.organizations org where org.id = o.org_id;
  exception when others then
    v_paid_on := current_date;
  end;

  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on, method, reference, created_by)
  values (i.org_id, i.id, v_outstanding, coalesce(v_paid_on, current_date), 'cash',
          'Paid on delivery', coalesce(o.delivered_by, auth.uid()));
  return null;
end;
$function$;
