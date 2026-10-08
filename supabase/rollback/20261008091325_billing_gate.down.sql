-- Rollback for billing_gate: every company can write again. Removes the guard
-- line from each function it was put into (exactly once, or stop), drops the
-- billing_gate policies from every table and from storage, drops the two
-- functions. Run before the billing rollback.

do $$
declare
  r      record;
  def    text;
  guard  text := E'\n  perform public.require_writable();';
begin
  for r in
    select p.oid, p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and p.proname not in ('require_writable', 'company_writable')
       and pg_get_functiondef(p.oid) like '%require_writable(%'
  loop
    def := pg_get_functiondef(r.oid);
    if (length(def) - length(replace(def, guard, ''))) / length(guard) <> 1 then
      raise exception '%: guard not present exactly once; cannot roll back safely', r.proname;
    end if;
    execute replace(def, guard, '');
  end loop;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.tablename, p.policyname from pg_policies p
     where p.schemaname = 'public' and p.policyname in ('billing_gate_insert', 'billing_gate_update', 'billing_gate_delete')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

drop policy billing_gate_insert on storage.objects;
drop policy billing_gate_update on storage.objects;
drop policy billing_gate_delete on storage.objects;

delete from public.module_assignments
 where kind = 'function' and name in ('company_writable', 'require_writable');

drop function public.require_writable();
drop function public.company_writable();
