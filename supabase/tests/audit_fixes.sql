-- Audit fixes suite: the defects found in the 10 October 2026 audit stay fixed.
--
-- One DO block that always ends in `raise exception`, so nothing it does
-- survives: safe against production. It uses Gold Fortune's own people and
-- orders as fixtures and changes them only inside the transaction.
--
--   A1  every-two-weeks parity counts weeks from 2001-01-01, not ISO weeks
--       (20261010210000), and generate_routes uses the company's date
--       (20261010216000).
--   A2  a workday started after the auto-end time is never ended before it
--       began (20261010211000).
--   A3  a leave request cannot be moved to another employee, which is how a
--       manager without `hr` approved their own leave (20261010212000).
--   A4  a manager's write cannot set an employee's acknowledgement of a
--       warning (20261010212000).
--   A5  a field worker cannot draw a tax invoice or credit note number; an
--       order number still works (20261010212000).
--   A6  quote_convert takes VAT-inclusive prices back to VAT-exclusive, and a
--       deposit cannot be credited after the final invoice (20261010213000).
--       Checked on the definitions: quote_convert refuses to run inside a
--       nested transaction, which is how suites are rehearsed.
--   A7  an order line with no price is refused at invoicing, not invoiced at
--       0.00 (20261010213000).
--   A8  attendance leaves out employees with no login (20261010214000).
--   A9  the dashboard's Invoiced figure ends where the range ends
--       (20261010215000).
--
-- The final message is the report: `AUDIT FIX FAILURES` or
-- `ALL AUDIT FIX CHECKS PASSED`. Anything else is a fixture error.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_note text := '';
  v_admin uuid; v_r1 uuid; v_r2 uuid;
  v_e1 uuid; v_e2 uuid; v_type uuid; v_req uuid; v_warn uuid; v_wtype text;
  v_tz text; v_start timestamptz; v_session uuid;
  v_order uuid; v_line uuid; v_emp uuid; v_n int; v_def text; v_ok boolean;
begin
  select p.id into v_admin from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin' limit 1;
  select e.id, e.profile_id into v_e1, v_r1 from public.hr_employees e join public.profiles p on p.id = e.profile_id
   where e.org_id = c_gf and p.role = 'rep' and p.is_active order by e.created_at limit 1;
  select e.id, e.profile_id into v_e2, v_r2 from public.hr_employees e join public.profiles p on p.id = e.profile_id
   where e.org_id = c_gf and p.role = 'rep' and p.is_active and e.id <> v_e1 order by e.created_at limit 1;
  select id into v_type from public.hr_leave_types where org_id = c_gf order by created_at limit 1;
  v_tz := public.org_timezone(c_gf);
  if v_admin is null or v_e1 is null or v_e2 is null or v_type is null then
    raise exception 'Fixtures missing: admin %, two linked field employees %, %, a leave type %', v_admin, v_e1, v_e2, v_type;
  end if;

  -- A1 -------------------------------------------------------------------
  for v_def in select pg_get_functiondef(p.oid) from pg_proc p
                where p.pronamespace = 'public'::regnamespace and p.proname in ('generate_routes', 'call_cycle_review') loop
    if v_def ~* 'extract\s*\(\s*week' then
      v_fail := v_fail || 'A1 a schedule function still uses ISO week parity' || E'\n';
    end if;
  end loop;
  if pg_get_functiondef('public.generate_routes(int,boolean)'::regprocedure) like '%current_date%' then
    v_fail := v_fail || 'A1 generate_routes still uses the server''s date' || E'\n';
  end if;

  -- A2 -------------------------------------------------------------------
  -- Yesterday 20:10 in the company's zone, after any sensible cut-off.
  v_start := ((now() at time zone v_tz)::date - 1 + time '20:10') at time zone v_tz;
  insert into public.workday_sessions (org_id, rep_id, started_at, client_generated_id)
  values (c_gf, v_r1, v_start, gen_random_uuid()) returning id into v_session;
  perform public.auto_end_overdue_workdays();
  if exists (select 1 from public.workday_sessions where id = v_session and ended_at < started_at) then
    v_fail := v_fail || 'A2 a late-started workday was ended before it began' || E'\n';
  end if;

  -- A3 -------------------------------------------------------------------
  -- R1 manages E2 for the length of the transaction; R1 holds no `hr`.
  update public.hr_employees set manager_id = v_e1 where id = v_e2;
  insert into public.hr_leave_requests (org_id, employee_id, leave_type_id, start_date, end_date, days, status)
  values (c_gf, v_e1, v_type, current_date + 60, current_date + 60, 1, 'pending') returning id into v_req;
  perform set_config('request.jwt.claims', json_build_object('sub', v_r1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.hr_leave_requests set employee_id = v_e2, status = 'approved' where id = v_req;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_fail := v_fail || 'A3 a leave request was moved to another employee and approved' || E'\n';
    else
      v_note := v_note || 'A3 the update matched no row (RLS), so the guard was not reached' || E'\n';
    end if;
  exception when insufficient_privilege then null;
  end;

  -- A5 -------------------------------------------------------------------
  begin
    perform public.next_document_number(c_gf, 'tax_invoice', 'INV');
    v_fail := v_fail || 'A5 a field worker drew a tax invoice number' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.next_document_number(c_gf, 'credit_note', 'CN');
    v_fail := v_fail || 'A5 a field worker drew a credit note number' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.next_document_number(c_gf, 'order', 'SO');
  exception when others then
    v_fail := v_fail || 'A5 a field worker could not draw an order number: ' || sqlerrm || E'\n';
  end;
  begin
    execute 'select public.next_document_number_internal($1, ''tax_invoice'', ''INV'')' using c_gf;
    v_fail := v_fail || 'A5 a field worker called the internal counter' || E'\n';
  exception
    when insufficient_privilege then null;
    when undefined_function then v_fail := v_fail || 'A5 there is no internal counter' || E'\n';
  end;
  reset role;

  -- A4 -------------------------------------------------------------------
  select l.code into v_wtype from public.hr_lookups l
   where l.org_id = c_gf and l.kind = 'warning_type' and coalesce(l.meta->>'requires_document', '') <> 'true'
   order by l.sort_order limit 1;
  if v_wtype is null then
    v_note := v_note || 'A4 skipped: no warning type that needs no letter' || E'\n';
  else
    insert into public.hr_warnings (org_id, employee_id, warning_type, reason, issued_on)
    values (c_gf, v_e2, v_wtype, 'Audit suite', current_date) returning id into v_warn;
    perform set_config('request.jwt.claims', json_build_object('sub', v_r1, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.hr_warnings set acknowledged_by = v_r2, acknowledged_at = now() where id = v_warn;
    reset role;
    if (select acknowledged_at from public.hr_warnings where id = v_warn) is not null then
      v_fail := v_fail || 'A4 a manager wrote the employee''s acknowledgement' || E'\n';
    end if;
  end if;

  -- A6 -------------------------------------------------------------------
  v_def := pg_get_functiondef('public.quote_convert(uuid)'::regprocedure);
  if v_def not like '%q.prices_include_vat%' or v_def not like '%100 / (100 + q.vat_rate)%' then
    v_fail := v_fail || 'A6 quote_convert does not take inclusive prices back to exclusive' || E'\n';
  end if;
  if pg_get_functiondef('public.credit_note_issue(uuid,text,jsonb)'::regprocedure)
       not like '%i.kind = ''deposit''%f.kind = ''final''%' then
    v_fail := v_fail || 'A6 credit_note_issue does not refuse a deposit already taken off a final invoice' || E'\n';
  end if;

  -- A7 -------------------------------------------------------------------
  select o.id into v_order from public.orders o
   where o.org_id = c_gf and o.status in ('dispatched', 'delivered') and o.invoice_number is null
     and not exists (select 1 from public.tax_invoices t where t.order_id = o.id and t.status = 'issued')
     and exists (select 1 from public.order_lines l where l.order_id = o.id
                  and (case when o.status = 'delivered' then l.qty_delivered - l.qty_returned else l.qty_dispatched end) > 0)
   order by o.created_at limit 1;
  if v_order is null then
    v_note := v_note || 'A7 skipped: no gone-out order without an invoice' || E'\n';
  else
    select l.id into v_line from public.order_lines l join public.orders o on o.id = l.order_id
     where l.order_id = v_order
       and (case when o.status = 'delivered' then l.qty_delivered - l.qty_returned else l.qty_dispatched end) > 0
     limit 1;
    update public.order_lines set unit_price = null, list_price = null, discount_pct = 0, discount_amount = 0 where id = v_line;
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_ok := false;
    begin
      perform public.tax_invoice_issue(v_order, null);
    exception when sqlstate '22023' then v_ok := sqlerrm like '%no price%';
    end;
    reset role;
    if not v_ok then
      v_fail := v_fail || 'A7 an order with an unpriced line was invoiced, or refused for another reason' || E'\n';
    end if;
  end if;

  -- A8 -------------------------------------------------------------------
  insert into public.hr_employees (org_id, profile_id, employee_number, first_name, last_name, start_date)
  values (c_gf, null, 'ZZ-AUDIT', 'No', 'Login', current_date - 14) returning id into v_emp;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.hr_attendance_report(current_date - 14, current_date - 1) r where r.employee_id = v_emp;
  reset role;
  if v_n > 0 then
    v_fail := v_fail || format('A8 an employee with no login has %s attendance rows', v_n) || E'\n';
  end if;

  -- A9 -------------------------------------------------------------------
  if pg_get_functiondef('public.dashboard_business(timestamptz,timestamptz)'::regprocedure)
       like '%issue_date < (p_to at time zone v_tz)::date + 1%' then
    v_fail := v_fail || 'A9 dashboard_business still counts the day after the range' || E'\n';
  end if;

  perform set_config('request.jwt.claims', '', true);
  if v_fail <> '' then
    raise exception E'AUDIT FIX FAILURES (rolled back):\n%\n%', v_fail, v_note;
  end if;
  raise exception E'ALL AUDIT FIX CHECKS PASSED (rolled back)%', case when v_note <> '' then E'\nNotes:\n' || v_note else '' end;
end;
$$;
