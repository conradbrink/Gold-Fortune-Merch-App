-- Rollback of 20261009091500_contract_save_keeps_active: an edit without
-- `active` resumes the contract again, as 20261009090000 wrote it.

do $rollback$
declare
  v_def text := pg_get_functiondef('public.contract_save(uuid, jsonb, jsonb)'::regprocedure);
  c_new constant text := $b$           active = coalesce((p_terms->>'active')::boolean, active),$b$;
  c_old constant text := $a$           active = coalesce((p_terms->>'active')::boolean, true),$a$;
begin
  if (length(v_def) - length(replace(v_def, c_new, ''))) / length(c_new) <> 1 then
    raise exception 'contract_save is not the text this rollback expects';
  end if;
  execute replace(v_def, c_new, c_old);
end;
$rollback$;
