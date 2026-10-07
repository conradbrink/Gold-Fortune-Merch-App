-- Two fixes to 20261007095715_quotes from review.
--
-- 1. An accepted or declined quote's lines could still be edited. The customer
--    agreed to (or turned down) a specific set of lines; changing them
--    afterwards would make the quote say something nobody agreed to. Lines
--    can now be inserted or changed only while the quote is draft or sent.
--    Deleting stays possible until conversion, so a non-converted quote can
--    still be deleted with its lines.
--
-- 2. `quote_mark_converted` is executable by `authenticated` because
--    `quote_convert` is security invoker and has to call it. Called directly,
--    it could link a quote to any `new` order for the same store, which would
--    then claim a provenance it does not have. It now also requires that the
--    order was inserted in the current transaction — which, through PostgREST,
--    one request being one transaction, only `quote_convert` can arrange. The
--    invoker design is kept on purpose: the `orders` policies still decide who
--    may place the order.

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
  where id = coalesce(new.quote_id, old.quote_id);
  if tg_op <> 'DELETE' and v_org is distinct from new.org_id then
    raise exception 'That quote belongs to another organisation.' using errcode = '42501';
  end if;
  if v_status = 'converted' then
    raise exception 'This quote is already an order. Change the order instead.'
      using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and v_status in ('accepted', 'declined') then
    raise exception 'This quote was %; its lines are fixed. Reopen it to change them.', v_status
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.quote_mark_converted(p_quote_id uuid, p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q public.quotes;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found
     or q.org_id is distinct from public.current_org_id()
     or q.status = 'converted'
     or not (public.has_permission('warehouse') or q.rep_id = auth.uid()) then
    raise exception 'You cannot convert this quote.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.org_id = q.org_id
      and o.store_id = q.store_id and o.status = 'new'
      -- Inserted by this very transaction: only quote_convert's own order.
      and o.xmin = xid(pg_current_xact_id())
  ) or exists (select 1 from public.quotes where converted_order_id = p_order_id) then
    raise exception 'That order was not made from this quote.' using errcode = '42501';
  end if;
  update public.quotes
     set status = 'converted', converted_order_id = p_order_id, converted_at = now()
   where id = p_quote_id;
end;
$$;

-- `create or replace` keeps existing grants; restated so the file says what is true.
revoke all on function public.quote_lines_enforce_org() from public, anon, authenticated;
revoke execute on function public.quote_mark_converted(uuid, uuid) from public, anon;
grant execute on function public.quote_mark_converted(uuid, uuid) to authenticated;
