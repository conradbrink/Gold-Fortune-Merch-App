-- Stocktakes: a count that is still being counted can be cancelled.
--
-- Owner, 31 Oct 2026: "on the stock takes, I see there is not cancel button
-- on them". The table has allowed 'cancelled' since the stocktakes were made
-- (20260802172344), and the freeze refusal already says "Finish or cancel it
-- before moving stock", but nothing could cancel one. A count started by
-- mistake stayed open for good, and one open count per location meant no new
-- count could start there: Gold Fortune's STK-000006, a spot check opened on
-- 23 Oct with nothing counted, is the one in front of them.
--
-- Only while it is being counted. Nothing has touched the stock by then, so
-- the people who may start a count ('warehouse') may cancel one. A handed-in
-- sheet is the manager's, and Reject already files it with nothing changed.
--
-- Who cancelled it, when and why go in decided_by, decided_at and
-- decision_note, as for a rejection: a cancel is the count's last word. The
-- why is optional. The lines and any counts typed stay on the record, and the
-- line trigger refuses changes to them from then on (which it now really
-- does, below). A frozen count stops freezing on its own: the freeze only
-- holds while a count is open.
--
-- Rollback: supabase/rollback/20261031163700_stocktake_cancel.down.sql.

create or replace function public.stocktake_cancel(
  p_stocktake_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_st public.stocktakes;
begin
  perform public.require_writable();
  perform public.require_module('warehouse');
  v_org := public.current_org_id();
  if not public.has_permission('warehouse') then
    raise exception 'Only warehouse staff can cancel a stocktake.' using errcode = '42501';
  end if;

  -- The same lock as submit and decide, so a cancel cannot land halfway
  -- through a hand-in.
  perform pg_advisory_xact_lock(hashtext('stocktake'), hashtext(p_stocktake_id::text));

  select * into v_st from public.stocktakes where id = p_stocktake_id and org_id = v_org;
  if not found then
    raise exception 'That stocktake does not exist.' using errcode = 'P0002';
  end if;
  if v_st.status = 'submitted' then
    raise exception 'Stocktake % has been handed in. A manager can reject it instead, which leaves the stock as it is.',
      v_st.stocktake_number using errcode = '42501';
  end if;
  if v_st.status not in ('draft', 'counting') then
    raise exception 'Stocktake % is %, so it cannot be cancelled.',
      v_st.stocktake_number, v_st.status using errcode = '42501';
  end if;

  update public.stocktakes
     set status = 'cancelled', decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(p_reason), '')
   where id = v_st.id;

  return jsonb_build_object(
    'stocktake_id', v_st.id, 'stocktake_number', v_st.stocktake_number,
    'status', 'cancelled');
end;
$$;

revoke all on function public.stocktake_cancel(uuid, text) from public, anon;
grant execute on function public.stocktake_cancel(uuid, text) to authenticated;

/**
 * Lines belong to their stocktake's organisation, and only a stocktake that is
 * still being counted accepts changes to them.
 *
 * Two changes. It no longer runs as its owner: inside a security definer
 * function current_user is always the owner, so the "only the RPCs may write
 * to a handed-in sheet" test passed for everybody and a counter's page left
 * open could still save over the counts on a handed-in, approved, rejected or
 * now cancelled sheet. As the caller, current_user is 'authenticated' for a
 * signed-in counter and the owner inside the submit, recount and decide RPCs,
 * which is the distinction the test meant. Its own read of the stocktake is
 * one the counter's policies already allow.
 *
 * And the refusal said "has been submitted" whatever the count's state. A
 * counter saving on a page left open after someone else cancelled the count
 * is now told it was cancelled.
 */
create or replace function public.stocktake_lines_enforce_org()
returns trigger
language plpgsql
security invoker
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

  raise exception 'Stocktake % %, so its counts cannot be changed.',
    (select stocktake_number from public.stocktakes where id = new.stocktake_id),
    case v_status
      when 'submitted' then 'has been handed in'
      when 'cancelled' then 'was cancelled'
      else 'has been ' || v_status
    end
    using errcode = '42501';
end;
$$;
