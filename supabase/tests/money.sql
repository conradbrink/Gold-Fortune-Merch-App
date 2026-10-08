-- Money for every trade (Stage 7 Part 1a).
--
--   N1  set-up: a plumbing trial company has the invoicing module, its trade's
--       workflow and its price list (no prices); Gold Fortune has the module,
--       the distribution workflow, and `invoicing` wherever it had `warehouse`.
--   N2  quotes without a site or a product: free text and price-list lines,
--       fractional quantities; a line is one kind only; a quote names its client.
--   N3  an accepted quote invoiced in full: totals, numbering, lines copied;
--       not twice; an invoiced quote stays accepted.
--   N4  deposits: refused while switched off; a percentage, then an amount, never
--       beyond the quote; the final invoice takes the deposits off; a deposit
--       cannot be voided under its final invoice.
--   N5  prices including VAT: the VAT is the part of the price; a credit note on
--       such an invoice is worked out the same way.
--   N6  direct invoices: refused lines (none, negative, another company's
--       price-list item); refused while switched off.
--   N7  completed jobs: only finished, only one place, never twice; voiding
--       frees them.
--   N8  payments, who owes you (ageing at two dates) and a statement.
--   N9  who may: a field employee cannot bill, read invoices or read the price
--       list; companies cannot
--       see each other's money; with the module off everything refuses.
--   N10 Gold Fortune: its order → invoice route still issues INV numbers; its
--       workflow refuses direct and job invoices.
--   N11 a new cleaning company gets its price list, its workflow and the
--       permission on its managers' roles.
--
-- HOW TO RUN: paste into execute_sql (or psql -f). One DO block that always
-- ends in `raise exception`, so nothing survives — including the two quiet
-- Gold Fortune logins it removes and re-creates as the test company's people.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_note text := '';
  v_org uuid; v_org2 uuid; v_owner uuid; v_owner_email text; v_staff uuid; v_staff_email text;
  v_gf_admin uuid; v_gf_billing uuid;
  v_labour uuid; v_gf_item uuid;
  v_quote uuid; v_quote2 uuid; v_quote3 uuid; v_qnum text;
  v_inv uuid; v_dep1 uuid; v_dep2 uuid; v_final uuid; v_inv3 uuid; v_direct uuid; v_jobs uuid; v_cn uuid;
  v_s1 uuid; v_s2 uuid; v_v1 uuid; v_v2 uuid; v_v3 uuid; v_v4 uuid;
  v_order uuid;
  r record;
  v_n int; v_t text; v_num numeric;
begin
  ------------------------------------------------------------- fixtures
  select p.id into v_gf_admin from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin' limit 1;
  if v_gf_admin is null then
    raise exception 'Fixtures missing: a Gold Fortune administrator is needed.';
  end if;
  select p.id, p.email into v_owner, v_owner_email from public.profiles p
   where p.org_id = c_gf and p.role <> 'manager' and p.id <> v_gf_admin
     and not exists (select 1 from public.visits v where v.rep_id = p.id)
     and not exists (select 1 from public.location_pings l where l.rep_id = p.id)
     and not exists (select 1 from public.stock_locations s where s.rep_id = p.id)
   order by p.full_name limit 1;
  select p.id, p.email into v_staff, v_staff_email from public.profiles p
   where p.org_id = c_gf and p.role <> 'manager' and p.id not in (v_owner, v_gf_admin)
     and not exists (select 1 from public.visits v where v.rep_id = p.id)
     and not exists (select 1 from public.location_pings l where l.rep_id = p.id)
     and not exists (select 1 from public.stock_locations s where s.rep_id = p.id)
   order by p.full_name limit 1;
  if v_owner is null or v_staff is null then
    raise exception 'Fixtures missing: two quiet logins are needed.';
  end if;
  -- Someone at Gold Fortune who works with orders (the administrator, if nobody else).
  select coalesce((select p.id from public.profiles p
                     join public.profile_permissions pp on pp.profile_id = p.id
                    where p.org_id = c_gf and p.is_active and pp.permission_code = 'warehouse'
                      and p.id not in (v_owner, v_staff)
                    order by p.id limit 1), v_gf_admin)
    into v_gf_billing;
  delete from public.profiles where id in (v_owner, v_staff);

  v_org := public.start_trial_company(
    jsonb_build_object('name', 'Money check', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg', 'vat_rate', 15,
                       'owner', jsonb_build_object('full_name', 'Money Owner', 'email', v_owner_email)),
    array['plumbing'], v_owner);
  insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
  values (v_staff, v_org, 'rep', (select id from public.job_roles where org_id = v_org and code = 'sales_rep'),
          'Money Staff', v_staff_email);

  ------------------------------------------------------------- N1 set-up
  if not exists (select 1 from public.company_modules where org_id = v_org and module_code = 'invoicing' and enabled) then
    v_fail := v_fail || 'N1 the plumbing company has no invoicing module' || E'\n';
  end if;
  if (select value #>> '{}' from public.company_settings where org_id = v_org and key = 'money_workflow') <> 'quote_job_invoice' then
    v_fail := v_fail || 'N1 the plumbing company''s workflow is not quote → job → invoice' || E'\n';
  end if;
  select count(*) into v_n from public.service_items where org_id = v_org;
  if v_n <> (select count(*) from public.template_service_items where template_code = 'plumbing') then
    v_fail := v_fail || format('N1 the plumbing price list has %s items', v_n) || E'\n';
  end if;
  if exists (select 1 from public.service_items where org_id = v_org and unit_price is not null) then
    v_fail := v_fail || 'N1 the seeded price list carries prices' || E'\n';
  end if;
  select id into v_labour from public.service_items where org_id = v_org and unit = 'hour' order by sort_order limit 1;
  if not exists (select 1 from public.company_modules where org_id = c_gf and module_code = 'invoicing' and enabled) then
    v_fail := v_fail || 'N1 Gold Fortune has no invoicing module' || E'\n';
  end if;
  if (select value #>> '{}' from public.company_settings where org_id = c_gf and key = 'money_workflow') <> 'order_invoice'
     or (select value from public.company_settings where org_id = c_gf and key = 'money_invoice_direct') <> 'false'::jsonb
     or (select value from public.company_settings where org_id = c_gf and key = 'money_invoice_from_jobs') <> 'false'::jsonb then
    v_fail := v_fail || 'N1 Gold Fortune''s workflow is not order → invoice' || E'\n';
  end if;
  if exists (select 1 from public.profile_permissions pp
              where pp.permission_code = 'warehouse'
                and not exists (select 1 from public.profile_permissions x
                                 where x.profile_id = pp.profile_id and x.permission_code = 'invoicing')) then
    v_fail := v_fail || 'N1 someone with warehouse lacks invoicing' || E'\n';
  end if;

  ------------------------------------------------------------- N2 quotes
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_qnum := public.next_document_number(v_org, 'quote', 'QT');
  insert into public.quotes (org_id, quote_number, customer_name, contact_email, status)
  values (v_org, v_qnum, 'Mrs Dlamini', 'dlamini@example.com', 'draft') returning id into v_quote;
  insert into public.quote_lines (org_id, quote_id, service_item_id, description, unit, qty, list_price, position)
  values (v_org, v_quote, v_labour, 'Labour', 'hour', 1.5, 450, 1),
         (v_org, v_quote, null, 'Replace tap washer', 'each', 2, 35.50, 2);
  begin
    insert into public.quote_lines (org_id, quote_id, qty, list_price) values (v_org, v_quote, 1, 10);
    v_fail := v_fail || 'N2 a line that says nothing was accepted' || E'\n';
  exception when check_violation then null;
  end;
  begin
    insert into public.quotes (org_id, quote_number, status)
    values (v_org, public.next_document_number(v_org, 'quote', 'QT'), 'draft');
    v_fail := v_fail || 'N2 a quote for nobody was accepted' || E'\n';
  exception when check_violation then null;
  end;
  if (select vat_rate from public.quotes where id = v_quote) <> 15 then
    v_fail := v_fail || 'N2 the quote did not take the company''s VAT rate' || E'\n';
  end if;

  ------------------------------------------------------------- N3 full invoice
  begin
    perform public.invoice_from_quote(v_quote, 'full', null, null, date '2026-01-01');
    v_fail := v_fail || 'N3 a draft quote was invoiced' || E'\n';
  exception when others then
    if sqlstate <> '22023' then v_fail := v_fail || format('N3 draft refused for the wrong reason: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  update public.quotes set status = 'accepted' where id = v_quote;
  v_inv := public.invoice_from_quote(v_quote, 'full', null, null, date '2026-01-01');
  select * into r from public.tax_invoices where id = v_inv;
  if r.subtotal <> 746.00 or r.vat <> 111.90 or r.total <> 857.90 then
    v_fail := v_fail || format('N3 totals %s / %s / %s, expected 746.00 / 111.90 / 857.90', r.subtotal, r.vat, r.total) || E'\n';
  end if;
  if r.invoice_number <> 'INV-000001' or r.source <> 'quote' or r.kind <> 'standard' or r.quote_id <> v_quote
     or r.order_id is not null or r.due_date <> date '2026-01-31' or r.customer_name <> 'Mrs Dlamini' then
    v_fail := v_fail || format('N3 the invoice header is wrong: %s %s %s %s', r.invoice_number, r.source, r.due_date, r.customer_name) || E'\n';
  end if;
  if (select count(*) from public.tax_invoice_lines where invoice_id = v_inv and unit is not null) <> 2
     or (select qty from public.tax_invoice_lines where invoice_id = v_inv and position = 1) <> 1.5 then
    v_fail := v_fail || 'N3 the lines were not copied with their units and quantities' || E'\n';
  end if;
  begin
    perform public.invoice_from_quote(v_quote, 'full');
    v_fail := v_fail || 'N3 a quote was invoiced twice' || E'\n';
  exception when unique_violation then null;
  end;
  begin
    update public.quotes set status = 'draft' where id = v_quote;
    v_fail := v_fail || 'N3 an invoiced quote went back to draft' || E'\n';
  exception when others then
    if sqlstate <> '22023' then v_fail := v_fail || format('N3 reopen refused for the wrong reason: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;

  ------------------------------------------------------------- N4 deposits
  insert into public.quotes (org_id, quote_number, customer_name, status)
  values (v_org, public.next_document_number(v_org, 'quote', 'QT'), 'Mr Botha', 'draft') returning id into v_quote2;
  insert into public.quote_lines (org_id, quote_id, description, unit, qty, list_price)
  values (v_org, v_quote2, 'Geyser installed', 'each', 1, 10000);
  update public.quotes set status = 'accepted' where id = v_quote2;
  begin
    perform public.invoice_from_quote(v_quote2, 'deposit', 50);
    v_fail := v_fail || 'N4 a deposit was taken while deposits are off' || E'\n';
  exception when insufficient_privilege then null;
  end;
  update public.company_settings set value = 'true' where org_id = v_org and key = 'money_deposits';
  v_dep1 := public.invoice_from_quote(v_quote2, 'deposit', 50, null, date '2026-01-02');
  select * into r from public.tax_invoices where id = v_dep1;
  if r.kind <> 'deposit' or r.subtotal <> 5000 or r.vat <> 750 or r.total <> 5750 then
    v_fail := v_fail || format('N4 the 50%% deposit is %s %s / %s / %s', r.kind, r.subtotal, r.vat, r.total) || E'\n';
  end if;
  begin
    perform public.invoice_from_quote(v_quote2, 'deposit', 60);
    v_fail := v_fail || 'N4 deposits beyond the quote were taken' || E'\n';
  exception when others then
    if sqlstate <> '22023' then v_fail := v_fail || format('N4 over-deposit refused for the wrong reason: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  v_dep2 := public.invoice_from_quote(v_quote2, 'deposit', null, 2000, date '2026-01-03');
  v_final := public.invoice_from_quote(v_quote2, 'final', null, null, date '2026-01-04');
  select * into r from public.tax_invoices where id = v_final;
  if r.kind <> 'final' or r.subtotal <> 3000 or r.vat <> 450 or r.total <> 3450
     or (select count(*) from public.tax_invoice_lines where invoice_id = v_final and unit_price < 0) <> 2 then
    v_fail := v_fail || format('N4 the final invoice is %s / %s / %s', r.subtotal, r.vat, r.total) || E'\n';
  end if;
  begin
    perform public.tax_invoice_void(v_dep1, 'test');
    v_fail := v_fail || 'N4 a deposit was voided under its final invoice' || E'\n';
  exception when others then
    if sqlstate <> '22023' then v_fail := v_fail || format('N4 deposit void refused for the wrong reason: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  perform public.tax_invoice_void(v_final, 'test');
  perform public.tax_invoice_void(v_dep1, 'test');

  ------------------------------------------------------------- N5 VAT included
  reset role;
  update public.organizations set prices_include_vat = true where id = v_org;
  set local role authenticated;
  insert into public.quotes (org_id, quote_number, customer_name, status)
  values (v_org, public.next_document_number(v_org, 'quote', 'QT'), 'Body corporate', 'draft') returning id into v_quote3;
  insert into public.quote_lines (org_id, quote_id, description, unit, qty, list_price)
  values (v_org, v_quote3, 'Burst pipe repaired', 'each', 1, 1150);
  update public.quotes set status = 'accepted' where id = v_quote3;
  v_inv3 := public.invoice_from_quote(v_quote3, 'full', null, null, date '2026-01-05');
  select * into r from public.tax_invoices where id = v_inv3;
  if not r.prices_include_vat or r.total <> 1150 or r.vat <> 150 or r.subtotal <> 1000 then
    v_fail := v_fail || format('N5 VAT-inclusive invoice is %s / %s / %s', r.subtotal, r.vat, r.total) || E'\n';
  end if;
  v_cn := public.credit_note_issue(v_inv3, 'Half the work was under guarantee',
            jsonb_build_array(jsonb_build_object(
              'invoice_line_id', (select id from public.tax_invoice_lines where invoice_id = v_inv3), 'qty', 0.5)));
  select * into r from public.credit_notes where id = v_cn;
  if r.total <> 575 or r.vat <> 75 or r.subtotal <> 500 then
    v_fail := v_fail || format('N5 VAT-inclusive credit is %s / %s / %s', r.subtotal, r.vat, r.total) || E'\n';
  end if;
  reset role;
  update public.organizations set prices_include_vat = false where id = v_org;
  set local role authenticated;

  ------------------------------------------------------------- N6 direct
  v_direct := public.invoice_direct(jsonb_build_object('name', 'Walk-in client', 'email', 'walkin@example.com'),
                jsonb_build_array(jsonb_build_object('description', 'Call-out', 'qty', 1, 'unit_price', 350)),
                date '2026-01-10');
  select * into r from public.tax_invoices where id = v_direct;
  if r.source <> 'direct' or r.total <> 402.50 or r.store_id is not null or r.customer_email <> 'walkin@example.com' then
    v_fail := v_fail || format('N6 the direct invoice is %s %s', r.source, r.total) || E'\n';
  end if;
  begin
    perform public.invoice_direct(jsonb_build_object('name', 'X'), '[]'::jsonb);
    v_fail := v_fail || 'N6 an invoice without lines was issued' || E'\n';
  exception when others then
    if sqlstate <> '22023' then v_fail := v_fail || format('N6 no lines refused for the wrong reason: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  begin
    perform public.invoice_direct(jsonb_build_object('name', 'X'),
              jsonb_build_array(jsonb_build_object('description', 'Refund', 'qty', 1, 'unit_price', -10)));
    v_fail := v_fail || 'N6 a negative line was issued' || E'\n';
  exception when others then
    if sqlstate <> '22023' then v_fail := v_fail || format('N6 negative refused for the wrong reason: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  reset role;
  insert into public.service_items (org_id, name, unit) values (c_gf, 'Money check item', 'each') returning id into v_gf_item;
  set local role authenticated;
  begin
    perform public.invoice_direct(jsonb_build_object('name', 'X'),
              jsonb_build_array(jsonb_build_object('description', 'Theirs', 'qty', 1, 'unit_price', 1,
                                                   'service_item_id', v_gf_item)));
    v_fail := v_fail || 'N6 another company''s price-list item was invoiced' || E'\n';
  exception when others then
    if sqlstate <> '22023' then v_fail := v_fail || format('N6 foreign item refused for the wrong reason: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  update public.company_settings set value = 'false' where org_id = v_org and key = 'money_invoice_direct';
  begin
    perform public.invoice_direct(jsonb_build_object('name', 'X'),
              jsonb_build_array(jsonb_build_object('description', 'Y', 'qty', 1, 'unit_price', 1)));
    v_fail := v_fail || 'N6 a direct invoice was issued while switched off' || E'\n';
  exception when insufficient_privilege then null;
  end;
  update public.company_settings set value = 'true' where org_id = v_org and key = 'money_invoice_direct';

  ------------------------------------------------------------- N7 completed jobs
  insert into public.stores (org_id, name, address, city) values (v_org, 'Money check site 1', '1 Main Road', 'Pretoria')
    returning id into v_s1;
  insert into public.stores (org_id, name) values (v_org, 'Money check site 2') returning id into v_s2;
  reset role;
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkout_at, client_generated_id)
  values (v_org, v_staff, v_s1, 'checked_out', now() - interval '3 hours', now() - interval '2 hours', gen_random_uuid())
  returning id into v_v1;
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkout_at, client_generated_id)
  values (v_org, v_staff, v_s1, 'checked_out', now() - interval '90 minutes', now() - interval '1 hour', gen_random_uuid())
  returning id into v_v2;
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, client_generated_id)
  values (v_org, v_staff, v_s1, 'checked_in', now() - interval '10 minutes', gen_random_uuid())
  returning id into v_v3;
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkout_at, client_generated_id)
  values (v_org, v_staff, v_s2, 'checked_out', now() - interval '5 hours', now() - interval '4 hours', gen_random_uuid())
  returning id into v_v4;
  set local role authenticated;
  if (select count(*) from public.unbilled_visits(v_s1, null, null)) <> 2
     or exists (select 1 from public.unbilled_visits(null, null, null) u where u.visit_id = v_v3) then
    v_fail := v_fail || 'N7 unbilled work at the first place is not exactly the two finished jobs' || E'\n';
  end if;
  begin
    perform public.invoice_from_visits(array[v_v1, v_v3],
              jsonb_build_array(jsonb_build_object('description', 'Service', 'qty', 2, 'unit_price', 300)));
    v_fail := v_fail || 'N7 unfinished work was invoiced' || E'\n';
  exception when others then
    if sqlstate <> '22023' then v_fail := v_fail || format('N7 unfinished refused for the wrong reason: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  begin
    perform public.invoice_from_visits(array[v_v1, v_v4],
              jsonb_build_array(jsonb_build_object('description', 'Service', 'qty', 2, 'unit_price', 300)));
    v_fail := v_fail || 'N7 work at two places went on one invoice' || E'\n';
  exception when others then
    if sqlstate <> '22023' then v_fail := v_fail || format('N7 two places refused for the wrong reason: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  v_jobs := public.invoice_from_visits(array[v_v1, v_v2],
              jsonb_build_array(jsonb_build_object('description', 'Service visit', 'unit', 'visit', 'qty', 2, 'unit_price', 300)),
              date '2026-01-15');
  select * into r from public.tax_invoices where id = v_jobs;
  if r.source <> 'jobs' or r.store_id <> v_s1 or r.total <> 690 or r.customer_name <> 'Money check site 1'
     or (select count(*) from public.tax_invoice_visits where invoice_id = v_jobs and active) <> 2 then
    v_fail := v_fail || format('N7 the jobs invoice is %s %s %s', r.source, r.total, r.customer_name) || E'\n';
  end if;
  if exists (select 1 from public.unbilled_visits(v_s1, null, null)) then
    v_fail := v_fail || 'N7 invoiced work is still listed as unbilled' || E'\n';
  end if;
  begin
    perform public.invoice_from_visits(array[v_v2],
              jsonb_build_array(jsonb_build_object('description', 'Service', 'qty', 1, 'unit_price', 300)));
    v_fail := v_fail || 'N7 work was invoiced twice' || E'\n';
  exception when unique_violation then null;
  end;
  perform public.tax_invoice_void(v_jobs, 'Wrong price');
  begin
    perform public.invoice_from_visits(array[v_v2],
              jsonb_build_array(jsonb_build_object('description', 'Service', 'qty', 1, 'unit_price', 320)));
  exception when others then
    v_fail := v_fail || format('N7 voiding did not free the work: %s %s', sqlstate, sqlerrm) || E'\n';
  end;

  ------------------------------------------------------------- N8 paid and owed
  perform public.invoice_payment_record(v_direct, 100, date '2026-02-20', 'eft', 'REF1');
  begin
    perform public.invoice_payment_record(v_direct, 1000, date '2026-02-21', 'cash', null);
    v_fail := v_fail || 'N8 an overpayment was recorded' || E'\n';
  exception when others then
    if sqlstate <> '22023' then v_fail := v_fail || format('N8 overpayment refused for the wrong reason: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  select * into r from public.debtors_ageing(date '2026-02-15') a where a.client_name = 'Walk-in client';
  if r.client_name is null or r.days_1_30 <> 402.50 or r.total <> 402.50 or r.not_due <> 0 then
    v_fail := v_fail || format('N8 ageing at 15 Feb: %s', row_to_json(r)) || E'\n';
  end if;
  select * into r from public.debtors_ageing(date '2026-04-15') a where a.client_name = 'Walk-in client';
  if r.client_name is null or r.days_61_90 <> 302.50 or r.total <> 302.50 or r.last_paid_on <> date '2026-02-20' then
    v_fail := v_fail || format('N8 ageing at 15 Apr: %s', row_to_json(r)) || E'\n';
  end if;
  select count(*), (array_agg(s.balance order by s.entry_date desc, s.entry_kind))[1]
    into v_n, v_num
    from public.client_statement(null, 'walk-in client', date '2026-01-01', date '2026-03-31') s;
  if v_n <> 3 or v_num <> 302.50 then
    v_fail := v_fail || format('N8 statement: %s rows, closing %s', v_n, v_num) || E'\n';
  end if;
  reset role;

  ------------------------------------------------------------- N9 who may
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.invoice_direct(jsonb_build_object('name', 'X'),
              jsonb_build_array(jsonb_build_object('description', 'Y', 'qty', 1, 'unit_price', 1)));
    v_fail := v_fail || 'N9 a field employee issued an invoice' || E'\n';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.tax_invoices) + (select count(*) from public.invoice_payments) <> 0 then
    v_fail := v_fail || 'N9 a field employee reads invoices or payments' || E'\n';
  end if;
  if (select count(*) from public.service_items) <> 0 then
    v_fail := v_fail || 'N9 a field employee reads the price list' || E'\n';
  end if;
  begin
    insert into public.service_items (org_id, name, unit) values (v_org, 'Staff item', 'each');
    v_fail := v_fail || 'N9 a field employee changed the price list' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.debtors_ageing(null);
    v_fail := v_fail || 'N9 a field employee read who owes the company' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.tax_invoices where org_id = v_org)
     or exists (select 1 from public.service_items where org_id = v_org)
     or exists (select 1 from public.quotes where org_id = v_org)
     or exists (select 1 from public.debtors_ageing(null) a where a.client_name = 'Walk-in client') then
    v_fail := v_fail || 'N9 Gold Fortune sees the other company''s money' || E'\n';
  end if;
  begin
    perform public.invoice_from_quote(v_quote2, 'full');
    v_fail := v_fail || 'N9 Gold Fortune invoiced the other company''s quote' || E'\n';
  exception when others then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.tax_invoices where org_id = c_gf)
     or exists (select 1 from public.service_items where org_id = c_gf) then
    v_fail := v_fail || 'N9 the new company sees Gold Fortune''s money' || E'\n';
  end if;
  reset role;
  update public.company_modules set enabled = false where org_id = v_org and module_code = 'invoicing';
  set local role authenticated;
  if (select count(*) from public.quotes) + (select count(*) from public.service_items) <> 0 then
    v_fail := v_fail || 'N9 money rows are readable with the module off' || E'\n';
  end if;
  begin
    perform public.invoice_direct(null, null);
    v_fail := v_fail || 'N9 invoice_direct answered with the module off' || E'\n';
  exception when insufficient_privilege then
    if sqlerrm not like '%not enabled%' then
      v_fail := v_fail || format('N9 module-off refusal said: %s', sqlerrm) || E'\n';
    end if;
  end;
  reset role;
  update public.company_modules set enabled = true where org_id = v_org and module_code = 'invoicing';

  ------------------------------------------------------------- N10 Gold Fortune
  perform set_config('request.jwt.claims', json_build_object('sub', v_gf_billing, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.invoice_direct(jsonb_build_object('name', 'X'),
              jsonb_build_array(jsonb_build_object('description', 'Y', 'qty', 1, 'unit_price', 1)));
    v_fail := v_fail || 'N10 Gold Fortune issued a direct invoice' || E'\n';
  exception when insufficient_privilege then null;
  end;
  select o.id into v_order from public.orders o
   where o.org_id = c_gf and o.status in ('dispatched', 'delivered') and o.invoice_number is null
     and not exists (select 1 from public.tax_invoices i where i.order_id = o.id)
     and exists (select 1 from public.order_lines ol where ol.order_id = o.id
                  and case when o.status = 'delivered' then ol.qty_delivered - ol.qty_returned else ol.qty_dispatched end > 0)
   order by o.created_at desc limit 1;
  if v_order is null then
    v_note := ' (N10: no uninvoiced Gold Fortune order, so the order route was not exercised)';
  else
    v_inv := public.tax_invoice_issue(v_order, null);
    select * into r from public.tax_invoices where id = v_inv;
    if r.invoice_number not like 'INV-%' or r.source <> 'order' or r.order_id <> v_order or r.kind <> 'standard'
       or r.total <> r.subtotal + r.vat or not exists (select 1 from public.tax_invoice_lines where invoice_id = v_inv) then
      v_fail := v_fail || format('N10 the order invoice is %s %s %s', r.invoice_number, r.source, r.total) || E'\n';
    end if;
    if (select invoice_number from public.orders where id = v_order) is distinct from r.invoice_number then
      v_fail := v_fail || 'N10 the order did not get its invoice number' || E'\n';
    end if;
  end if;
  reset role;

  ------------------------------------------------------------- N11 a new company
  v_org2 := public.create_company(
    jsonb_build_object('name', 'Clean check', 'country_code', 'ZA', 'currency_code', 'ZAR', 'timezone', 'Africa/Johannesburg'),
    array['cleaning'], '{}'::jsonb, null, null);
  if (select count(*) from public.service_items where org_id = v_org2)
     <> (select count(*) from public.template_service_items where template_code = 'cleaning') then
    v_fail := v_fail || 'N11 the cleaning company did not get its price list' || E'\n';
  end if;
  if (select value #>> '{}' from public.company_settings where org_id = v_org2 and key = 'money_workflow') <> 'contract_extras' then
    v_fail := v_fail || 'N11 the cleaning company''s workflow is wrong' || E'\n';
  end if;
  select count(*) into v_n from public.job_role_permissions jrp
    join public.job_roles jr on jr.id = jrp.job_role_id
   where jr.org_id = v_org2 and jrp.permission_code = 'invoicing'
     and jr.code in ('operations_manager', 'cfo', 'warehouse_clerk');
  if v_n <> 3 then
    v_fail := v_fail || format('N11 %s of 3 roles got the invoicing permission', v_n) || E'\n';
  end if;

  if v_fail = '' then
    raise exception 'MONEY SUITE: ALL PASS (N1-N11)% — rolled back', v_note;
  end if;
  raise exception E'MONEY SUITE FAILURES:\n%', v_fail;
end;
$$;
