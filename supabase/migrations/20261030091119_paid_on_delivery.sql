-- Paid on delivery: a company whose customers pay cash when the order arrives.
--
-- A company that invoices every order (`money_invoice_orders`,
-- 20261013180000) issues the invoice when the order is confirmed and credits
-- whatever was not sent or came back. The invoice then stays outstanding until
-- the office presses "Record payment". A distributor whose customers pay the
-- driver in cash has nothing to chase, so every one of its invoices sat in
-- "owed" for the office to clear by hand.
--
-- ------------------------------------------------------------- the rule
--
-- With `money_paid_on_delivery` on, the moment an order is delivered its
-- invoice records one cash payment for whatever is still outstanding: the
-- invoice less the credit notes for what was not sent or came back, less
-- anything paid already. The payment is dated the day the order was
-- delivered, in the company's time zone, and is recorded by the person who
-- delivered it. Nothing outstanding, no payment.
--
-- It runs at commit, like orders_invoice_follow, and after it (deferred
-- triggers on the same row fire in name order), so the credit for a short
-- delivery is already written when the outstanding amount is read.
--
-- The setting is off for every company, and is the company's own
-- (audience 'owner'), next to "Invoice every order".
--
-- Rollback: supabase/rollback/20261030091119_paid_on_delivery.down.sql.
-- Suite: supabase/tests/order_paid_on_delivery.sql.

------------------------------------------------------------------ the setting

insert into public.setting_definitions (key, label, description, value_type, default_value, pattern, sort_order, audience) values
  ('money_paid_on_delivery', 'Paid on delivery',
   'Customers pay when the order is delivered, so each order''s invoice is marked paid in cash on delivery.',
   'boolean', 'false', null, 118, 'owner');

-- Every company has every setting written down (as create_company does).
insert into public.company_settings (org_id, key, value)
select o.id, 'money_paid_on_delivery', 'false'::jsonb
  from public.organizations o
on conflict (org_id, key) do nothing;

------------------------------------------------------------------ the payment

create function public.orders_paid_on_delivery()
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

revoke all on function public.orders_paid_on_delivery() from public, anon, authenticated;

create constraint trigger orders_paid_on_delivery
  after update of status on public.orders
  deferrable initially deferred
  for each row
  when (new.status = 'delivered' and old.status is distinct from 'delivered')
  execute function public.orders_paid_on_delivery();
