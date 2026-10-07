-- Rollback for enforce_modules: remove the guard line from every function it
-- was put into, drop every module_gate policy, drop the assignment registry.
-- Each removal must match exactly once, or the rollback stops rather than
-- guessing.

do $$
declare
  r record;
  def text;
  newdef text;
  lang text;
  guard text;
begin
  for r in
    select p.oid, p.proname, a.module_code
      from public.module_assignments a
      join pg_proc p on p.proname = a.name and p.pronamespace = 'public'::regnamespace
     where a.kind = 'function' and a.module_code <> 'core'
       and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
  loop
    def := pg_get_functiondef(r.oid);
    select l.lanname into lang from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = r.oid;
    guard := case lang
               when 'plpgsql' then format(E'\n  perform public.require_module(%L);', r.module_code)
               else format(E'\n  select public.require_module(%L);', r.module_code)
             end;
    if (length(def) - length(replace(def, guard, ''))) / length(guard) <> 1 then
      raise exception '%: guard not present exactly once; cannot roll back safely', r.proname;
    end if;
    newdef := replace(def, guard, '');
    execute newdef;
  end loop;
end;
$$;

do $$
declare r record;
begin
  for r in
    select c.relname from pg_policies p
      join pg_class c on c.relname = p.tablename and c.relnamespace = 'public'::regnamespace
     where p.schemaname = 'public' and p.policyname = 'module_gate'
  loop
    execute format('drop policy module_gate on public.%I', r.relname);
  end loop;
end;
$$;

drop policy if exists module_gate_fulfilment_docs on storage.objects;
drop policy if exists module_gate_hr_documents on storage.objects;

drop table if exists public.module_assignments;
