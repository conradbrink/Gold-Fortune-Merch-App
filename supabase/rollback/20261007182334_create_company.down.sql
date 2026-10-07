-- Rollback for create_company: the two functions go and new companies'
-- field department is "Field Sales" again. Companies already created keep
-- what they were given.

delete from public.module_assignments
 where kind = 'function' and name in ('template_defaults', 'create_company');

drop function public.create_company(jsonb, text[], jsonb, uuid, uuid);
drop function public.template_defaults(text[]);

do $$
declare
  v_def text := pg_get_functiondef('public.provision_organization(uuid)'::regprocedure);
  c_new constant text := '(''Field Team'', ''FIELD'', 10)';
  c_old constant text := '(''Field Sales'', ''FIELD'', 10)';
begin
  if (length(v_def) - length(replace(v_def, c_new, ''))) / length(c_new) <> 1 then
    raise exception 'provision_organization is not the text this rollback expects';
  end if;
  execute replace(v_def, c_new, c_old);
end;
$$;
