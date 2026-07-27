create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- These SECURITY DEFINER helpers only ever return the caller's own org_id/role
-- (filtered by auth.uid()), so anon callers get null — no data leak — but
-- restrict EXECUTE to authenticated users only per the linter's recommendation.
revoke execute on function public.current_org_id() from public, anon;
revoke execute on function public.current_role() from public, anon;
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.current_role() to authenticated;
