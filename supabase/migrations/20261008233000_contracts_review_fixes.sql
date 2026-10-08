-- Contracts: four fixes from the review of #94 (Stage 7 Part 1b), applied
-- after 20261008200000_contracts_and_proof_of_service.
--
-- 1. A resumed contract does not bill the months it was paused. On resume,
--    `bill_from` moves forward to the first period whose invoice day has not
--    passed, the rule a new contract starts with, and never moves back.
--    "Invoice again" still reaches a voided period.
-- 2. Contract lines are changed only by `invoicing` holders; `warehouse`
--    holders still read them. The single FOR ALL policy let them delete,
--    because a DELETE is checked against USING alone.
-- 3. "Unbilled work" leaves out exactly the work a contract bills: a visit in
--    a period the contract has claimed, or, while it is active, from
--    `bill_from` to its end. Work before billing starts, and work in paused
--    months nobody invoiced, now shows as unbilled.
-- 4. contract_lines_replace(): a contract's lines replaced in one
--    transaction, so a failed save never leaves a contract without lines.

------------------------------------------------------------- 1. resume

do $migration$
declare
  v_def text := pg_get_functiondef('public.service_contracts_stamp()'::regprocedure);
  c_old constant text := $a$    new.bill_from := s;
  end if;
  new.updated_at := now();$a$;
  c_new constant text := $b$    new.bill_from := s;
  elsif tg_op = 'UPDATE' and new.active and not old.active then
    -- Resumed: the months it was paused are not billed by themselves.
    -- Billing carries on from the first period whose invoice day has not
    -- passed, and never moves back.
    s := new.bill_from;
    while public.contract_invoice_date(s, public.contract_period_end(s, new.period), new.billing, new.invoice_day) < v_today
          and n < 1200 loop
      s := public.contract_period_end(s, new.period) + 1;
      n := n + 1;
    end loop;
    new.bill_from := s;
  end if;
  new.updated_at := now();$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'service_contracts_stamp is not the text this migration expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;

------------------------------------------------------------- 2. who may change lines

drop policy service_contract_lines_all on public.service_contract_lines;
create policy service_contract_lines_select on public.service_contract_lines for select
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse')))
         and exists (select 1 from public.service_contracts c where c.id = service_contract_lines.contract_id));
create policy service_contract_lines_write on public.service_contract_lines for all
  using ((org_id = (select public.current_org_id())) and (select public.has_permission('invoicing'))
         and exists (select 1 from public.service_contracts c where c.id = service_contract_lines.contract_id))
  with check ((org_id = (select public.current_org_id())) and (select public.has_permission('invoicing'))
              and exists (select 1 from public.service_contracts c
                           where c.id = service_contract_lines.contract_id and c.org_id = (select public.current_org_id())));

------------------------------------------------------------- 3. unbilled work

do $migration$
declare
  v_def text := pg_get_functiondef('public.unbilled_visits(uuid, date, date)'::regprocedure);
  c_old constant text := $a$     and not exists (select 1 from public.service_contracts sc
                      where sc.store_id = v.store_id and sc.active
                        and (v.checkin_at at time zone v_tz)::date >= sc.starts_on
                        and (sc.ends_on is null or (v.checkin_at at time zone v_tz)::date <= sc.ends_on))
$a$;
  c_new constant text := $b$     and not exists (select 1 from public.service_contracts sc
                      where sc.store_id = v.store_id
                        and (exists (select 1 from public.service_contract_invoices ci
                                      where ci.contract_id = sc.id and ci.active
                                        and (v.checkin_at at time zone v_tz)::date between ci.period_start and ci.period_end)
                             or (sc.active
                                 and (v.checkin_at at time zone v_tz)::date >= sc.bill_from
                                 and (sc.ends_on is null or (v.checkin_at at time zone v_tz)::date <= sc.ends_on))))
$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'unbilled_visits is not the text this migration expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;

------------------------------------------------------------- 4. lines in one go

-- The caller's own rights apply (security invoker): the policies above, the
-- module gate and the billing gate. All lines or none.
create function public.contract_lines_replace(p_contract uuid, p_lines jsonb)
returns void
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A contract needs at least one line to invoice.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.service_contracts c where c.id = p_contract and c.org_id = v_org) then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;
  delete from public.service_contract_lines where contract_id = p_contract;
  insert into public.service_contract_lines
    (contract_id, org_id, position, service_item_id, description, unit, qty, unit_price)
  select p_contract, v_org, x.ord::integer, nullif(x.l->>'service_item_id', '')::uuid,
         x.l->>'description', nullif(btrim(x.l->>'unit'), ''), (x.l->>'qty')::numeric, (x.l->>'unit_price')::numeric
    from jsonb_array_elements(p_lines) with ordinality as x(l, ord);
end;
$function$;

revoke all on function public.contract_lines_replace(uuid, jsonb) from public, anon;
grant execute on function public.contract_lines_replace(uuid, jsonb) to authenticated;

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'contract_lines_replace', 'invoicing');
