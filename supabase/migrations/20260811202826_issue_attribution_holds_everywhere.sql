-- Two holes CodeRabbit found in 20260811200652, on the PR, before anyone used
-- the feature. Both are about the recipient surviving paths the form does not
-- control, which was the whole point of putting the rule in the database.
--
-- 1. `btrim(text)` with no trim set removes *spaces*, not whitespace. A name
--    of tabs or newlines satisfied the constraint — the exact class of hollow
--    value the constraint exists to refuse, admitted by the function chosen to
--    refuse it. The web form was never the risk (JS trim() strips these); a
--    direct caller was. Replaced with a POSIX whitespace-class match.
--
-- 2. In `stock_adjustment_decide`, `coalesce(v_line.note, <issued-to text>,…)`
--    let a line's own note *replace* the recipient on the posted movement, so
--    any issue whose lines carried notes produced ledger rows with no record
--    of who took the stock. For `promotional_issue` the note now always leads
--    with the recipient and appends the line note (or, failing that, the
--    header note); other reasons keep their old behaviour exactly.
--
-- A new migration rather than an edit, because 20260811200652 is applied and
-- an applied migration is history, not source.

alter table public.stock_adjustments drop constraint if exists stock_adjustments_issue_attributed;
alter table public.stock_adjustments add constraint stock_adjustments_issue_attributed
  check (reason_code <> 'promotional_issue'
         or coalesce(issued_to_name, '') !~ '^[[:space:]]*$');

create or replace function public.stock_adjustment_decide(
  p_adjustment_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
  v_adj public.stock_adjustments;
  v_line record;
  v_reason text;
  v_note text;
  v_total integer := 0;
  v_lines integer := 0;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();

  if v_role <> 'manager' then
    raise exception 'Only a manager can approve or reject a stock adjustment.'
      using errcode = '42501';
  end if;
  if not p_approve and (p_note is null or btrim(p_note) = '') then
    raise exception 'Say why the adjustment is being rejected.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('stock_adjustment'), hashtext(p_adjustment_id::text));

  select * into v_adj from public.stock_adjustments
  where id = p_adjustment_id and org_id = v_org;

  if not found then
    raise exception 'That adjustment does not exist.' using errcode = 'P0002';
  end if;
  if v_adj.status <> 'pending' then
    raise exception 'Adjustment % is %, not waiting for a decision.',
      v_adj.adjustment_number, v_adj.status using errcode = '42501';
  end if;

  if not p_approve then
    update public.stock_adjustments
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           decision_note = p_note
     where id = v_adj.id;
    return jsonb_build_object('adjustment_id', v_adj.id,
      'adjustment_number', v_adj.adjustment_number, 'status', 'rejected');
  end if;

  v_reason := case v_adj.reason_code
    when 'damage' then 'adjustment_damage'
    when 'expiry' then 'adjustment_expiry'
    when 'promotional' then 'adjustment_promotional'
    when 'promotional_issue' then 'adjustment_promotional_issue'
    when 'missing' then 'adjustment_missing'
    when 'found' then 'adjustment_found'
    when 'write_off' then 'adjustment_write_off'
    else 'adjustment_other'
  end;

  for v_line in
    select * from public.stock_adjustment_lines
    where adjustment_id = v_adj.id
    order by product_id, batch_id nulls first, id
  loop
    -- The recipient is not a fallback, it is the point: for an issue the note
    -- always leads with who took the stock, and the line's own note (or the
    -- header note) is appended rather than allowed to displace it. Every other
    -- reason keeps the original precedence untouched.
    if v_adj.reason_code = 'promotional_issue' then
      v_note := 'Issued to ' || v_adj.issued_to_name
        || coalesce(' - ' || nullif(btrim(coalesce(v_line.note, v_adj.reason_note)), ''), '');
    else
      v_note := coalesce(v_line.note, v_adj.reason_note);
    end if;

    insert into public.stock_movements (
      org_id, product_id, batch_id, qty,
      from_location_id, from_bucket, to_location_id, to_bucket,
      reason, reference, note, source_doc_type, source_doc_id, source_line_id,
      actor_id, approved_by)
    values (
      v_org, v_line.product_id, v_line.batch_id, v_line.qty,
      case when v_line.from_bucket is not null then v_adj.location_id end, v_line.from_bucket,
      case when v_line.to_bucket is not null then v_adj.location_id end, v_line.to_bucket,
      v_reason, v_adj.adjustment_number, v_note,
      'adjustment', v_adj.id, v_line.id,
      -- Who asked, and who allowed it. Both, because either alone is half the
      -- story a stock auditor is trying to reconstruct.
      v_adj.requested_by, auth.uid());

    v_total := v_total + v_line.qty;
    v_lines := v_lines + 1;
  end loop;

  update public.stock_adjustments
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = p_note
   where id = v_adj.id;

  return jsonb_build_object(
    'adjustment_id', v_adj.id, 'adjustment_number', v_adj.adjustment_number,
    'status', 'approved', 'reason', v_reason,
    'lines', v_lines, 'units', v_total);
end;
$$;
