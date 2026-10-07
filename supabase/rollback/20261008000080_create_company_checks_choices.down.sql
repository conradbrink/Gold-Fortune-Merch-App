-- Rollback for create_company_checks_choices: the checklist and form code
-- checks come out again; everything else in create_company is untouched.

do $rollback$
declare
  v_def text := pg_get_functiondef('public.create_company(jsonb, text[], jsonb, uuid, uuid)'::regprocedure);
  c_added constant text := $b$
  -- Every chosen checklist and form must be one the templates propose.
  select string_agg(x, ', ') into v_bad
    from jsonb_array_elements_text(coalesce(v_choices->'checklists', '[]'::jsonb)) x
   where not exists (select 1 from jsonb_array_elements(v_def->'checklists') c where c->>'code' = x);
  if v_bad is not null then
    raise exception 'Unknown checklist: %', v_bad using errcode = '22023';
  end if;
  select string_agg(x, ', ') into v_bad
    from jsonb_array_elements_text(coalesce(v_choices->'forms', '[]'::jsonb)) x
   where not exists (select 1 from jsonb_array_elements(v_def->'forms') f where f->>'code' = x);
  if v_bad is not null then
    raise exception 'Unknown form: %', v_bad using errcode = '22023';
  end if;
$b$;
begin
  if (length(v_def) - length(replace(v_def, c_added, ''))) / length(c_added) <> 1 then
    raise exception 'create_company is not the text this rollback expects';
  end if;
  execute replace(v_def, c_added, '');
end;
$rollback$;
