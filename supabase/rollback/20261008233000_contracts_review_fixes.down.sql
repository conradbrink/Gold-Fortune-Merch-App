-- Rollback of 20261008233000_contracts_review_fixes: the four review fixes
-- out again, everything as 20261008200000 left it. Run before that
-- migration's own rollback, never instead of it.

delete from public.module_assignments where kind = 'function' and name = 'contract_lines_replace';
drop function if exists public.contract_lines_replace(uuid, jsonb);

drop policy if exists service_contract_lines_write on public.service_contract_lines;
drop policy if exists service_contract_lines_select on public.service_contract_lines;
create policy service_contract_lines_all on public.service_contract_lines for all
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('invoicing')) or (select public.has_permission('warehouse')))
         and exists (select 1 from public.service_contracts c where c.id = service_contract_lines.contract_id))
  with check ((org_id = (select public.current_org_id())) and (select public.has_permission('invoicing'))
              and exists (select 1 from public.service_contracts c
                           where c.id = service_contract_lines.contract_id and c.org_id = (select public.current_org_id())));

do $rollback$
declare
  v_def text := pg_get_functiondef('public.unbilled_visits(uuid, date, date)'::regprocedure);
  c_new constant text := $b$     and not exists (select 1 from public.service_contracts sc
                      where sc.store_id = v.store_id
                        and (exists (select 1 from public.service_contract_invoices ci
                                      where ci.contract_id = sc.id and ci.active
                                        and (v.checkin_at at time zone v_tz)::date between ci.period_start and ci.period_end)
                             or (sc.active
                                 and (v.checkin_at at time zone v_tz)::date >= sc.bill_from
                                 and (sc.ends_on is null or (v.checkin_at at time zone v_tz)::date <= sc.ends_on))))
$b$;
  c_old constant text := $a$     and not exists (select 1 from public.service_contracts sc
                      where sc.store_id = v.store_id and sc.active
                        and (v.checkin_at at time zone v_tz)::date >= sc.starts_on
                        and (sc.ends_on is null or (v.checkin_at at time zone v_tz)::date <= sc.ends_on))
$a$;
begin
  if (length(v_def) - length(replace(v_def, c_new, ''))) / length(c_new) <> 1 then
    raise exception 'unbilled_visits is not the text this rollback expects';
  end if;
  execute replace(v_def, c_new, c_old);
end;
$rollback$;

do $rollback$
declare
  v_def text := pg_get_functiondef('public.service_contracts_stamp()'::regprocedure);
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
  c_old constant text := $a$    new.bill_from := s;
  end if;
  new.updated_at := now();$a$;
begin
  if (length(v_def) - length(replace(v_def, c_new, ''))) / length(c_new) <> 1 then
    raise exception 'service_contracts_stamp is not the text this rollback expects';
  end if;
  execute replace(v_def, c_new, c_old);
end;
$rollback$;
