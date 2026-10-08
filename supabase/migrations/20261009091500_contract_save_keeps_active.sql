-- contract_save keeps a contract's paused state when the terms leave it out
-- (review of #94). The edit path set `active` to true when the key was
-- absent, which would resume a paused contract without anyone saying so (and
-- the resume rule would then move billing on). The web always sends it; any
-- other caller now keeps the current value. A new contract still starts
-- active.

do $migration$
declare
  v_def text := pg_get_functiondef('public.contract_save(uuid, jsonb, jsonb)'::regprocedure);
  c_old constant text := $a$           active = coalesce((p_terms->>'active')::boolean, true),$a$;
  c_new constant text := $b$           active = coalesce((p_terms->>'active')::boolean, active),$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'contract_save is not the text this migration expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;
