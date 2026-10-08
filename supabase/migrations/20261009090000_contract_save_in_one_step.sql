-- A contract's terms and lines saved in one step (review of #94).
--
-- The web wrote a contract's terms, then replaced its lines with a second
-- call. When the second failed (a line the database refuses, a dropped
-- connection), the contract kept its new terms with its old lines, and a new
-- contract had to be deleted again by hand. contract_save() does both in one
-- transaction, for a new contract (p_contract null) or an edited one, so a
-- failed save changes nothing. The caller's own rights apply (security
-- invoker): the policies, column grants, module gate and billing gate.

create function public.contract_save(p_contract uuid, p_terms jsonb, p_lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid := public.current_org_id();
  v_id uuid := p_contract;
begin
  perform public.require_writable();
  perform public.require_module('invoicing');
  perform public.require_permission('invoicing');
  if p_terms is null or jsonb_typeof(p_terms) <> 'object' then
    raise exception 'The contract''s terms are missing.' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A contract needs at least one line to invoice.' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.service_contracts
      (org_id, store_id, name, period, billing, invoice_day, starts_on, ends_on, active, reference, notes)
    values (v_org, (p_terms->>'store_id')::uuid, p_terms->>'name', p_terms->>'period', p_terms->>'billing',
            (p_terms->>'invoice_day')::smallint, (p_terms->>'starts_on')::date, nullif(p_terms->>'ends_on', '')::date,
            coalesce((p_terms->>'active')::boolean, true), nullif(p_terms->>'reference', ''), nullif(p_terms->>'notes', ''))
    returning id into v_id;
  else
    update public.service_contracts
       set store_id = (p_terms->>'store_id')::uuid,
           name = p_terms->>'name',
           period = p_terms->>'period',
           billing = p_terms->>'billing',
           invoice_day = (p_terms->>'invoice_day')::smallint,
           starts_on = (p_terms->>'starts_on')::date,
           ends_on = nullif(p_terms->>'ends_on', '')::date,
           active = coalesce((p_terms->>'active')::boolean, true),
           reference = nullif(p_terms->>'reference', ''),
           notes = nullif(p_terms->>'notes', '')
     where id = v_id and org_id = v_org;
    if not found then
      raise exception 'Contract not found.' using errcode = 'P0002';
    end if;
  end if;
  perform public.contract_lines_replace(v_id, p_lines);
  return v_id;
end;
$function$;

revoke all on function public.contract_save(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.contract_save(uuid, jsonb, jsonb) to authenticated;

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'contract_save', 'invoicing');
