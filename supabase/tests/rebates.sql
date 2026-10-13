-- Rebates suite (13 Oct 2026).
--
--   R1  A payment short by the rebate, then the rebate: the invoice owes
--       nothing; the rebate is a credit note with no lines, reason "Rebate…",
--       its VAT the part of the amount at the invoice's rate.
--   R2  Refused: more than is owed, zero, fractions of a cent, a void invoice.
--   R3  A field worker without invoicing cannot record one; anon cannot call it.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_admin uuid; v_rep uuid; v_store uuid; v_inv uuid; v_void uuid; v_cn uuid;
  c public.credit_notes;
  v_owed numeric;
begin
  select p.id into v_admin from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin' limit 1;
  select p.id into v_rep from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'rep'
     and not exists (select 1 from public.profile_permissions pp where pp.profile_id = p.id and pp.permission_code in ('invoicing', 'admin'))
   limit 1;
  select s.id into v_store from public.stores s where s.org_id = c_gf order by s.created_at limit 1;
  if v_admin is null or v_store is null then
    raise exception 'Fixtures missing: admin %, store %', v_admin, v_store;
  end if;

  insert into public.tax_invoices (org_id, invoice_number, source, store_id, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total)
  values (c_gf, 'ZZ-REB-1', 'direct', v_store, 'Gold Fortune', 'Test', current_date, current_date, 14, 1000, 140, 1140)
  returning id into v_inv;
  insert into public.tax_invoices (org_id, invoice_number, source, store_id, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total, status, void_reason)
  values (c_gf, 'ZZ-REB-2', 'direct', v_store, 'Gold Fortune', 'Test', current_date, current_date, 14, 100, 14, 114, 'void', 'test')
  returning id into v_void;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ------------------------------------------------------------------ R1
  perform public.invoice_payment_record(v_inv, 1026.00, current_date, 'eft', 'short by the rebate');
  v_cn := public.invoice_rebate(v_inv, 114.00, null, 'Choppies listing');
  select outstanding into v_owed from public.tax_invoice_balances where invoice_id = v_inv;
  select * into c from public.credit_notes where id = v_cn;
  if v_owed <> 0 then
    v_fail := v_fail || format('R1 the invoice still owes %s', v_owed) || E'\n';
  end if;
  if c.total <> 114 or c.vat <> 14 or c.subtotal <> 100 or c.reason <> 'Rebate: Choppies listing'
     or c.created_by is distinct from v_admin
     or exists (select 1 from public.credit_note_lines where credit_note_id = v_cn) then
    v_fail := v_fail || format('R1 the rebate is %s / %s / %s, "%s"', c.subtotal, c.vat, c.total, c.reason) || E'\n';
  end if;

  ------------------------------------------------------------------ R2
  begin
    perform public.invoice_rebate(v_inv, 0.01);
    v_fail := v_fail || 'R2 a rebate beyond what is owed was taken' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.invoice_rebate(v_void, 1);
    v_fail := v_fail || 'R2 a rebate on a void invoice was taken' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.invoice_rebate(v_inv, 0);
    v_fail := v_fail || 'R2 a rebate of zero was taken' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.invoice_rebate(v_inv, 0.001);
    v_fail := v_fail || 'R2 a rebate of a fraction of a cent was taken' || E'\n';
  exception when sqlstate '22023' then null;
  end;

  ------------------------------------------------------------------ R3
  if v_rep is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
    begin
      perform public.invoice_rebate(v_inv, 1);
      v_fail := v_fail || 'R3 a field worker recorded a rebate' || E'\n';
    exception when sqlstate '42501' or sqlstate 'P0002' then null;
    end;
  end if;
  reset role;
  if has_function_privilege('anon', 'public.invoice_rebate(uuid,numeric,date,text)', 'EXECUTE') then
    v_fail := v_fail || 'R3 anon can call invoice_rebate' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'rebates FAILED:\n%', v_fail;
  end if;
  raise exception 'rebates PASSED';
end;
$$;
