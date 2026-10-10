-- Rollback of 20261010100000_plan_includes_five_users: the 5-user base rows go
-- and the 3-user rows are open-ended again.

do $$
begin
  if to_regclass('public.price_list') is null then
    return;
  end if;

  delete from public.price_list
   where code = 'base' and kind = 'base' and included_users = 5
     and label = 'Plan with 5 users' and active_from = date '2026-10-10';

  update public.price_list
     set active_to = null
   where code = 'base' and kind = 'base' and included_users = 3
     and active_to = date '2026-10-10';
end
$$;
