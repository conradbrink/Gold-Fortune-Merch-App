-- Statements and document style suite (9 Oct 2026).
--
--   S1  The `document_style` setting: classic by default, classic / bold /
--       clean accepted, anything else refused.
--   S2  statement_clients: one row per client (by place, or by the name on the
--       invoices, whatever its case and spacing), counting issued invoices
--       only, less credit notes and payments, as at a date; a client with no
--       invoice by that date is not there; a void invoice is not counted; a
--       paid-up client is listed with a balance of 0.
--   S3  Who may: a field employee cannot read it; with the module off it
--       refuses; the JSON form matches the table form.
--   S4  Grants and module registration.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_admin uuid; v_staff uuid;
  v_s1 uuid; v_s2 uuid;
  v_a uuid; v_b uuid; v_c1 uuid; v_c2 uuid; v_d uuid; v_e uuid;
  r record; v_n int; v_j jsonb; v_ok boolean;
begin
  select p.id into v_admin from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin' limit 1;
  select p.id into v_staff from public.profiles p
   where p.org_id = c_gf and p.role <> 'manager' and p.id <> v_admin
     and not exists (select 1 from public.profile_permissions pp where pp.profile_id = p.id and pp.permission_code in ('admin', 'invoicing'))
   limit 1;
  select s.id into v_s1 from public.stores s where s.org_id = c_gf order by s.created_at limit 1;
  select s.id into v_s2 from public.stores s where s.org_id = c_gf and s.id <> v_s1 order by s.created_at limit 1;
  if v_admin is null or v_s2 is null then
    raise exception 'Fixtures missing: admin %, stores %, %', v_admin, v_s1, v_s2;
  end if;

  ---------------------------------------------------------------- S1 the setting
  if not exists (select 1 from public.setting_definitions where key = 'document_style' and default_value = '"classic"'::jsonb) then
    v_fail := v_fail || 'S1 document_style is missing or does not default to classic' || E'\n';
  end if;
  begin
    insert into public.company_settings (org_id, key, value) values (c_gf, 'document_style', '"bold"');
    update public.company_settings set value = '"clean"' where org_id = c_gf and key = 'document_style';
  exception when others then
    v_fail := v_fail || format('S1 a real style was refused: %s', sqlerrm) || E'\n';
  end;
  begin
    update public.company_settings set value = '"fancy"' where org_id = c_gf and key = 'document_style';
    v_fail := v_fail || 'S1 an unknown style was accepted' || E'\n';
  exception when others then null;
  end;

  ---------------------------------------------------------------- S2 fixtures
  -- A: place one. 1000 issued 10 Jan, 100 credit on 20 Jan, 400 paid on 1 Feb.
  insert into public.tax_invoices (org_id, invoice_number, seller_name, customer_name, store_id, issue_date, due_date, vat_rate, subtotal, vat, total, source)
  values (c_gf, 'ZZ-S-A', 'Seller', 'Place one', v_s1, date '2026-01-10', date '2026-02-09', 15, 869.57, 130.43, 1000, 'direct') returning id into v_a;
  insert into public.credit_notes (org_id, credit_number, invoice_id, reason, issue_date, subtotal, vat, total)
  values (c_gf, 'ZZ-S-CN1', v_a, 'Returned', date '2026-01-20', 86.96, 13.04, 100);
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on, method) values (c_gf, v_a, 400, date '2026-02-01', 'eft');
  -- B: place one again. 200 issued 1 Mar, paid in full on 5 Mar.
  insert into public.tax_invoices (org_id, invoice_number, seller_name, customer_name, store_id, issue_date, due_date, vat_rate, subtotal, vat, total, source)
  values (c_gf, 'ZZ-S-B', 'Seller', 'Place one', v_s1, date '2026-03-01', date '2026-03-31', 15, 173.91, 26.09, 200, 'direct') returning id into v_b;
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on, method) values (c_gf, v_b, 200, date '2026-03-05', 'cash');
  -- C: a client with no place, typed twice with different case and spacing.
  insert into public.tax_invoices (org_id, invoice_number, seller_name, customer_name, issue_date, due_date, vat_rate, subtotal, vat, total, source)
  values (c_gf, 'ZZ-S-C1', 'Seller', 'ZZ Walk-in Client', date '2026-02-02', date '2026-03-04', 15, 130.43, 19.57, 150, 'direct') returning id into v_c1;
  insert into public.tax_invoices (org_id, invoice_number, seller_name, customer_name, issue_date, due_date, vat_rate, subtotal, vat, total, source)
  values (c_gf, 'ZZ-S-C2', 'Seller', '  zz walk-in client ', date '2026-04-02', date '2026-05-02', 15, 86.96, 13.04, 100, 'direct') returning id into v_c2;
  -- D: place two, only a void invoice: not a client of the statements.
  insert into public.tax_invoices (org_id, invoice_number, seller_name, customer_name, store_id, issue_date, due_date, vat_rate, subtotal, vat, total, source, status, void_reason)
  values (c_gf, 'ZZ-S-D', 'Seller', 'Place two', v_s2, date '2026-01-12', date '2026-02-11', 15, 86.96, 13.04, 100, 'direct', 'void', 'Test') returning id into v_d;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- As at the end of the year: everything counted.
  select * into r from public.statement_clients(date '2026-12-31') where store_id = v_s1;
  if r is null or r.invoices <> 2 or r.invoiced <> 1200 or r.credited <> 100 or r.paid <> 600 or r.balance <> 500
     or r.first_date <> date '2026-01-10' or r.last_date <> date '2026-03-05' then
    v_fail := v_fail || format('S2 place one (year end) is wrong: %s', row_to_json(r)::text) || E'\n';
  end if;
  select count(*), min(invoices), min(balance), min(first_date), max(last_date)
    into v_n, r.invoices, r.balance, r.first_date, r.last_date
    from public.statement_clients(date '2026-12-31') where store_id is null and lower(btrim(client_name)) = 'zz walk-in client';
  if v_n <> 1 or r.invoices <> 2 or r.balance <> 250 or r.first_date <> date '2026-02-02' or r.last_date <> date '2026-04-02' then
    v_fail := v_fail || format('S2 the walk-in client is %s rows, %s invoices, balance %s (want 1, 2, 250)', v_n, r.invoices, r.balance) || E'\n';
  end if;
  if exists (select 1 from public.statement_clients(date '2026-12-31') where store_id = v_s2) then
    v_fail := v_fail || 'S2 a void invoice made a client' || E'\n';
  end if;

  -- As at 15 January: only A, before its credit and payment.
  select * into r from public.statement_clients(date '2026-01-15') where store_id = v_s1;
  if r is null or r.invoices <> 1 or r.balance <> 1000 or r.credited <> 0 or r.paid <> 0 then
    v_fail := v_fail || format('S2 place one (15 Jan) is wrong: %s', row_to_json(r)::text) || E'\n';
  end if;
  -- Before any invoice: not there.
  if exists (select 1 from public.statement_clients(date '2026-01-05') where store_id = v_s1) then
    v_fail := v_fail || 'S2 a client appears before its first invoice' || E'\n';
  end if;
  -- Paid up: B alone is paid, but A still owes; so check a paid-up client through the walk-in after paying.
  reset role;
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on, method) values (c_gf, v_c1, 150, date '2026-02-10', 'eft');
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on, method) values (c_gf, v_c2, 100, date '2026-04-10', 'eft');
  set local role authenticated;
  select * into r from public.statement_clients(date '2026-12-31')
   where store_id is null and lower(btrim(client_name)) = 'zz walk-in client';
  if r is null or r.balance <> 0 or r.paid <> 250 then
    v_fail := v_fail || format('S2 a paid-up client is not listed with 0: %s', row_to_json(r)::text) || E'\n';
  end if;

  ---------------------------------------------------------------- S3 who may
  v_j := public.statement_clients_json(date '2026-12-31');
  if jsonb_typeof(v_j) <> 'array'
     or (select count(*) from jsonb_array_elements(v_j) e where e ->> 'client_name' ilike '%walk-in%' or e ->> 'store_id' = v_s1::text) <> 2
     or (select count(*) from public.statement_clients(date '2026-12-31')) <> jsonb_array_length(v_j) then
    v_fail := v_fail || 'S3 the JSON form does not match the table form' || E'\n';
  end if;
  reset role;
  if v_staff is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.statement_clients(date '2026-12-31');
      v_fail := v_fail || 'S3 an employee without invoicing read the clients' || E'\n';
    exception when others then null;
    end;
    reset role;
  end if;
  update public.company_modules set enabled = false where org_id = c_gf and module_code = 'invoicing';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.statement_clients(date '2026-12-31');
    v_fail := v_fail || 'S3 statement_clients answered with the module off' || E'\n';
  exception when others then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- S4 grants
  if has_function_privilege('anon', 'public.statement_clients(date)', 'execute')
     or has_function_privilege('anon', 'public.statement_clients_json(date)', 'execute')
     or not has_function_privilege('authenticated', 'public.statement_clients(date)', 'execute')
     or not has_function_privilege('authenticated', 'public.statement_clients_json(date)', 'execute')
     or (select count(*) from public.module_assignments
          where kind = 'function' and name in ('statement_clients', 'statement_clients_json') and module_code = 'invoicing') <> 2 then
    v_fail := v_fail || 'S4 grants or module registration are wrong' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'STATEMENT FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL STATEMENT CHECKS PASSED (rolled back)';
end;
$$;
