-- Accounting sync suite (30 Oct 2026, 20261030164700).
--
--   A1  No connection, or the add-on off: issuing an invoice queues nothing.
--   A2  Connected: an invoice issued from sync_from is queued; QuickBooks
--       history and earlier invoices are not.
--   A3  A credit note or payment on a queued invoice is queued; on an invoice
--       that is not going to Sage it is not.
--   A4  claim takes due rows, oldest first, at most p_per_company for one
--       company, and none for a company over its day's calls.
--   A5  finish: sent writes the link and the call count; a failure backs
--       off; permanent or the sixth attempt fails it; wait keeps the attempt.
--   A6  A payment deleted while queued is skipped; deleted after it reached
--       Sage queues payment_removed with the Sage receipt id.
--   A7  Voided before it was sent: skipped with its credit notes and
--       payments. Voided after: invoice_voided is queued.
--   A8  queue_since picks up what was issued from sync_from before connecting.
--   A9  The office: a manager with company_settings sees the company's
--       queue but not another company's, cannot read secrets, and can retry
--       a failed row; a rep without company_settings sees nothing.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  v_fail text := '';
  v_org uuid; v_admin uuid; v_rep uuid; v_store uuid; v_other uuid;
  v_inv uuid; v_old uuid; v_qb uuid; v_cn uuid; v_pay uuid; v_pay2 uuid; v_inv2 uuid; v_inv3 uuid;
  v_n int; v_id uuid;
  q public.accounting_queue;
  c public.accounting_connections;
begin
  select p.id, p.org_id into v_admin, v_org from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.is_active and pp.permission_code = 'admin'
     and exists (select 1 from public.stores s where s.org_id = p.org_id)
   order by (p.org_id = '71170c8a-d53c-4a07-bdd4-97704a3cf4bc') desc, p.created_at
   limit 1;
  select s.id into v_store from public.stores s where s.org_id = v_org order by s.created_at limit 1;
  select p.id into v_rep from public.profiles p
   where p.org_id = v_org and p.is_active and p.role = 'rep'
     and not exists (select 1 from public.profile_permissions pp
                      where pp.profile_id = p.id and pp.permission_code in ('company_settings', 'admin'))
   limit 1;
  select o.id into v_other from public.organizations o where o.id <> v_org limit 1;
  if v_admin is null or v_store is null or v_other is null then
    raise exception 'Fixtures missing: admin %, store %, other company %', v_admin, v_store, v_other;
  end if;

  -- The add-on is not built yet; let this company have it here.
  update public.modules set is_built = true where code in ('accounting_sync', 'invoicing');
  insert into public.company_modules (org_id, module_code, enabled) values (v_org, 'invoicing', true)
  on conflict (org_id, module_code) do update set enabled = true;
  delete from public.accounting_queue where org_id = v_org;

  --------------------------------------------------------------------- A1
  insert into public.tax_invoices (org_id, invoice_number, source, store_id, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total)
  values (v_org, 'ZZ-ACC-0', 'direct', v_store, 'Seller', 'Test', current_date, current_date, 15, 100, 15, 115)
  returning id into v_old;
  insert into public.accounting_connections (org_id, sign_in, company_id, company_name, sync_from)
  values (v_org, 'password', 99, 'Test company', current_date);
  insert into public.company_modules (org_id, module_code, enabled) values (v_org, 'accounting_sync', false)
  on conflict (org_id, module_code) do update set enabled = false;
  insert into public.tax_invoices (org_id, invoice_number, source, store_id, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total)
  values (v_org, 'ZZ-ACC-OFF', 'direct', v_store, 'Seller', 'Test', current_date, current_date, 15, 100, 15, 115);
  if exists (select 1 from public.accounting_queue where org_id = v_org) then
    v_fail := v_fail || 'A1 queued with no connection or with the add-on off' || E'\n';
  end if;
  update public.company_modules set enabled = true where org_id = v_org and module_code = 'accounting_sync';

  --------------------------------------------------------------------- A2
  insert into public.tax_invoices (org_id, invoice_number, source, store_id, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total)
  values (v_org, 'ZZ-ACC-1', 'direct', v_store, 'Seller', 'Test', current_date, current_date, 15, 1000, 150, 1150)
  returning id into v_inv;
  insert into public.tax_invoices (org_id, invoice_number, source, store_id, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total)
  values (v_org, 'ZZ-ACC-QB', 'quickbooks', v_store, 'Seller', 'Test', current_date, current_date, 15, 100, 15, 115)
  returning id into v_qb;
  insert into public.tax_invoices (org_id, invoice_number, source, store_id, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total)
  values (v_org, 'ZZ-ACC-EARLY', 'direct', v_store, 'Seller', 'Test', current_date - 1, current_date, 15, 100, 15, 115);
  select * into q from public.accounting_queue where org_id = v_org and kind = 'invoice' and local_id = v_inv;
  if q.id is null or q.status <> 'queued' or q.label <> 'ZZ-ACC-1' or q.send_after <= now() then
    v_fail := v_fail || 'A2 the invoice was not queued with its number and a minute''s grace' || E'\n';
  end if;
  select count(*) into v_n from public.accounting_queue where org_id = v_org;
  if v_n <> 1 then
    v_fail := v_fail || 'A2 QuickBooks history or an earlier invoice was queued (' || v_n || ' rows)' || E'\n';
  end if;

  --------------------------------------------------------------------- A3
  insert into public.credit_notes (org_id, credit_number, invoice_id, reason, issue_date, subtotal, vat, total)
  values (v_org, 'ZZ-ACC-CN1', v_inv, 'Short', current_date, 100, 15, 115) returning id into v_cn;
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on)
  values (v_org, v_inv, 500, current_date) returning id into v_pay;
  insert into public.credit_notes (org_id, credit_number, invoice_id, reason, issue_date, subtotal, vat, total)
  values (v_org, 'ZZ-ACC-CN0', v_qb, 'Short', current_date, 10, 1.5, 11.5);
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on) values (v_org, v_qb, 5, current_date);
  if not exists (select 1 from public.accounting_queue where kind = 'credit_note' and local_id = v_cn) then
    v_fail := v_fail || 'A3 the credit note was not queued' || E'\n';
  end if;
  if not exists (select 1 from public.accounting_queue
                  where kind = 'payment' and local_id = v_pay and label = 'Payment on ZZ-ACC-1') then
    v_fail := v_fail || 'A3 the payment was not queued as "Payment on ZZ-ACC-1"' || E'\n';
  end if;
  select count(*) into v_n from public.accounting_queue where org_id = v_org;
  if v_n <> 3 then
    v_fail := v_fail || 'A3 a credit note or payment on an invoice not going to Sage was queued' || E'\n';
  end if;

  --------------------------------------------------------------------- A4
  update public.accounting_queue set send_after = now() - interval '1 minute' where org_id = v_org;
  update public.accounting_connections set calls_day = current_date, calls_today = 2400 where org_id = v_org;
  if exists (select 1 from public.accounting_claim(60, 15, 2400) r where r.org_id = v_org) then
    v_fail := v_fail || 'A4 claimed for a company over its day''s calls' || E'\n';
  end if;
  update public.accounting_connections set calls_today = 0 where org_id = v_org;
  select count(*) into v_n from public.accounting_claim(60, 2, 2400) r where r.org_id = v_org;
  if v_n <> 2 then
    v_fail := v_fail || 'A4 claim took ' || v_n || ' rows for one company, not 2' || E'\n';
  end if;
  select * into q from public.accounting_queue where org_id = v_org and kind = 'invoice' and local_id = v_inv;
  if q.status <> 'sending' or q.attempts <> 1 then
    v_fail := v_fail || 'A4 the oldest row (the invoice) was not taken first' || E'\n';
  end if;

  --------------------------------------------------------------------- A5
  perform public.accounting_finish(q.id, true, 7001, null, false, 3);
  select * into c from public.accounting_connections where org_id = v_org;
  if (select status from public.accounting_queue where id = q.id) <> 'sent'
     or not exists (select 1 from public.accounting_links
                     where org_id = v_org and company_id = 99 and kind = 'invoice'
                       and local_id = v_inv and remote_id = 7001)
     or c.calls_today <> 3 or c.last_sent_at is null then
    v_fail := v_fail || 'A5 a send did not mark sent, link 7001 and count 3 calls' || E'\n';
  end if;

  select * into q from public.accounting_queue where org_id = v_org and kind = 'credit_note' and local_id = v_cn;
  perform public.accounting_finish(q.id, false, null, 'Sage was busy', false, 1);
  select * into q from public.accounting_queue where id = q.id;
  if q.status <> 'queued' or q.send_after < now() + interval '50 seconds' or q.last_error <> 'Sage was busy' then
    v_fail := v_fail || 'A5 a failure did not go back to the queue a minute later' || E'\n';
  end if;
  update public.accounting_queue set status = 'sending', attempts = 2 where id = q.id;
  perform public.accounting_finish(q.id, false, null, 'Its invoice is not in Sage yet', false, 0, true);
  select * into q from public.accounting_queue where id = q.id;
  if q.status <> 'queued' or q.attempts <> 1 then
    v_fail := v_fail || 'A5 waiting spent an attempt' || E'\n';
  end if;
  update public.accounting_queue set status = 'sending', attempts = 6 where id = q.id;
  perform public.accounting_finish(q.id, false, null, 'still busy');
  if (select status from public.accounting_queue where id = q.id) <> 'failed' then
    v_fail := v_fail || 'A5 the sixth failure did not fail the row' || E'\n';
  end if;
  update public.accounting_queue set status = 'sending', attempts = 1 where id = q.id;
  perform public.accounting_finish(q.id, false, null, 'Customer is inactive', true);
  if (select status from public.accounting_queue where id = q.id) <> 'failed' then
    v_fail := v_fail || 'A5 a permanent failure was tried again' || E'\n';
  end if;

  --------------------------------------------------------------------- A6
  select * into q from public.accounting_queue where org_id = v_org and kind = 'payment' and local_id = v_pay;
  update public.accounting_queue set status = 'sending' where id = q.id;
  perform public.accounting_finish(q.id, true, 8001);
  delete from public.invoice_payments where id = v_pay;
  if not exists (select 1 from public.accounting_queue
                  where kind = 'payment_removed' and local_id = v_pay and remote_id = 8001 and status = 'queued') then
    v_fail := v_fail || 'A6 deleting a sent payment did not queue its removal with receipt 8001' || E'\n';
  end if;
  select * into q from public.accounting_queue where kind = 'payment_removed' and local_id = v_pay;
  update public.accounting_queue set status = 'sending' where id = q.id;
  perform public.accounting_finish(q.id, true);
  if exists (select 1 from public.accounting_links where kind = 'payment' and local_id = v_pay) then
    v_fail := v_fail || 'A6 the removed payment kept its link' || E'\n';
  end if;
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on)
  values (v_org, v_inv, 50, current_date) returning id into v_pay2;
  delete from public.invoice_payments where id = v_pay2;
  if (select status from public.accounting_queue where kind = 'payment' and local_id = v_pay2) <> 'skipped'
     or exists (select 1 from public.accounting_queue where kind = 'payment_removed' and local_id = v_pay2) then
    v_fail := v_fail || 'A6 a payment deleted while queued was not simply skipped' || E'\n';
  end if;

  --------------------------------------------------------------------- A7
  insert into public.tax_invoices (org_id, invoice_number, source, store_id, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total)
  values (v_org, 'ZZ-ACC-2', 'direct', v_store, 'Seller', 'Test', current_date, current_date, 15, 200, 30, 230)
  returning id into v_inv2;
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on)
  values (v_org, v_inv2, 20, current_date) returning id into v_pay2;
  update public.tax_invoices set status = 'void', void_reason = 'test' where id = v_inv2;
  if (select status from public.accounting_queue where kind = 'invoice' and local_id = v_inv2) <> 'skipped'
     or (select status from public.accounting_queue where kind = 'payment' and local_id = v_pay2) <> 'skipped'
     or exists (select 1 from public.accounting_queue where kind = 'invoice_voided' and local_id = v_inv2) then
    v_fail := v_fail || 'A7 voiding before sending did not skip the invoice and its payment' || E'\n';
  end if;
  update public.tax_invoices set status = 'void', void_reason = 'test' where id = v_inv;
  if not exists (select 1 from public.accounting_queue
                  where kind = 'invoice_voided' and local_id = v_inv and label = 'ZZ-ACC-1') then
    v_fail := v_fail || 'A7 voiding a sent invoice did not queue invoice_voided' || E'\n';
  end if;

  --------------------------------------------------------------------- A8
  delete from public.accounting_connections where org_id = v_org;
  insert into public.tax_invoices (org_id, invoice_number, source, store_id, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total)
  values (v_org, 'ZZ-ACC-3', 'direct', v_store, 'Seller', 'Test', current_date - 2, current_date, 15, 300, 45, 345)
  returning id into v_inv3;
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on) values (v_org, v_inv3, 45, current_date);
  insert into public.accounting_connections (org_id, sign_in, company_id, company_name, sync_from)
  values (v_org, 'password', 99, 'Test company', current_date - 2);
  v_n := public.accounting_queue_since(v_org);
  if not exists (select 1 from public.accounting_queue where kind = 'invoice' and local_id = v_inv3)
     or not exists (select 1 from public.accounting_queue q2
                     join public.invoice_payments p on p.id = q2.local_id
                    where q2.kind = 'payment' and p.invoice_id = v_inv3)
     or exists (select 1 from public.accounting_queue where kind = 'invoice' and local_id = v_qb)
     or exists (select 1 from public.accounting_queue q2 join public.tax_invoices t on t.id = q2.local_id
                 where q2.kind = 'invoice' and t.invoice_number = 'ZZ-ACC-EARLY' and t.org_id = v_org) is false
     or v_n < 2 then
    v_fail := v_fail || 'A8 queue_since did not pick up ZZ-ACC-3, its payment and ZZ-ACC-EARLY (got ' || v_n || ')' || E'\n';
  end if;

  --------------------------------------------------------------------- A9
  insert into public.accounting_secrets (org_id, sealed) values (v_org, repeat('x', 40));
  select id into v_id from public.accounting_queue where org_id = v_org and status = 'failed' and kind = 'credit_note';
  insert into public.accounting_queue (org_id, kind, local_id, label) values (v_other, 'invoice', gen_random_uuid(), 'ZZ-OTHER');

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not exists (select 1 from public.accounting_queue where org_id = v_org)
     or not exists (select 1 from public.accounting_connections where org_id = v_org)
     or exists (select 1 from public.accounting_queue where org_id = v_other) then
    v_fail := v_fail || 'A9 the manager did not see exactly their own company''s queue' || E'\n';
  end if;
  begin
    perform 1 from public.accounting_secrets;
    v_fail := v_fail || 'A9 a signed-in user read accounting_secrets' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.accounting_claim();
    v_fail := v_fail || 'A9 a signed-in user could claim the queue' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.accounting_queue set status = 'sent' where org_id = v_org;
    v_fail := v_fail || 'A9 a signed-in user could write the queue' || E'\n';
  exception when insufficient_privilege then null;
  end;
  perform public.accounting_retry(v_id);
  reset role;
  select * into q from public.accounting_queue where id = v_id;
  if q.status <> 'queued' or q.attempts <> 0 then
    v_fail := v_fail || 'A9 retry did not put the failed row back' || E'\n';
  end if;

  if v_rep is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if exists (select 1 from public.accounting_queue) or exists (select 1 from public.accounting_connections) then
      v_fail := v_fail || 'A9 a rep without company_settings saw the queue' || E'\n';
    end if;
    reset role;
  end if;

  if v_fail <> '' then
    raise exception E'accounting_sync FAILED:\n%', v_fail;
  end if;
  raise exception 'accounting_sync PASSED';
end;
$$;
