-- create_company refuses a checklist or form code that is not in the proposal.
--
-- Why: a chosen module that does not exist was already refused ("Unknown
-- module"), but a chosen checklist or form code that is not in the templates'
-- proposal was skipped without a word — a stale or mistyped code made a company
-- without a form the operator ticked, and nobody was told (CodeRabbit on #89).
-- Now it fails the whole creation with 22023, like the module check.
--
-- An exact-match insert into the function's own text, after the module check:
-- the rest of create_company, its grants and its owner are untouched. The
-- anchor must occur exactly once or nothing changes.
--
-- Rollback: supabase/rollback/<this version>_create_company_checks_choices.down.sql.

do $migration$
declare
  v_def text := pg_get_functiondef('public.create_company(jsonb, text[], jsonb, uuid, uuid)'::regprocedure);
  c_anchor constant text := $a$    raise exception 'Unknown module: %', v_bad using errcode = '22023';
  end if;
$a$;
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
  if (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor) <> 1 then
    raise exception 'create_company is not the text this migration expects';
  end if;
  execute replace(v_def, c_anchor, c_anchor || c_added);
end;
$migration$;
