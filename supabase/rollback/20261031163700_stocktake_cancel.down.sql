-- Rollback of 20261031163700_stocktake_cancel: the cancel goes, and the line
-- trigger runs as its owner again (so it lets every change through, as it
-- did) and says "has been submitted". Counts already cancelled stay
-- cancelled; the status was always allowed.

drop function if exists public.stocktake_cancel(uuid, text);

create or replace function public.stocktake_lines_enforce_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status text;
begin
  select org_id, status into v_org, v_status
  from public.stocktakes where id = new.stocktake_id;

  if v_org is distinct from new.org_id then
    raise exception 'That stocktake belongs to another organisation.' using errcode = '42501';
  end if;

  -- The submit and decide RPCs write to lines on a submitted stocktake and run
  -- as definer; a signed-in counter has no privilege on those columns.
  if v_status in ('draft', 'counting')
     or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  raise exception 'Stocktake % has been submitted; its counts cannot be changed.',
    (select stocktake_number from public.stocktakes where id = new.stocktake_id)
    using errcode = '42501';
end;
$$;
