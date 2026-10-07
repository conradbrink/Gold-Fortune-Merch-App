-- Two gaps in 20261007105228's quote_lines guard, from review.
--
-- 1. The status was read without a lock, so a line change could race a
--    concurrent "accept" and be judged against the status from before it. The
--    quote row is now read FOR SHARE: an accept (an UPDATE of that row) waits
--    for the line change to finish, and a line change waits for an accept.
--
-- 2. Deleting a single line from an accepted or declined quote changed what
--    the customer agreed to as surely as editing one did, and was still
--    allowed. It is now refused too. Deleting the whole quote still works: the
--    cascade removes its lines after the quote row is gone, so the lookup finds
--    nothing and the guard has nothing to protect.
--
-- A trigger helper, so it stays ungated by the module check (README rule 4).

create or replace function public.quote_lines_enforce_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status text;
begin
  select org_id, status into v_org, v_status from public.quotes
  where id = coalesce(new.quote_id, old.quote_id)
  for share;

  -- The quote is being deleted along with its lines (cascade): nothing to guard.
  if not found and tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op <> 'DELETE' and v_org is distinct from new.org_id then
    raise exception 'That quote belongs to another organisation.' using errcode = '42501';
  end if;
  if v_status = 'converted' then
    raise exception 'This quote is already an order. Change the order instead.'
      using errcode = '42501';
  end if;
  if v_status in ('accepted', 'declined') then
    raise exception 'This quote was %; its lines are fixed. Reopen it to change them.', v_status
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.quote_lines_enforce_org() from public, anon, authenticated;
