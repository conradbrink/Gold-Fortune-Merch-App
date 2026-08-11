-- Booking promotional stock *out* — and saying who took it.
--
-- The warehouse gives stock away: activations, samples, free units to a shop
-- opening an account. Until now the only promotional reason was
-- `promotional`, which moves `available -> promotional`: the stock stops being
-- sellable but stays ours, on hand, counted. That is a real and useful thing —
-- stock set aside for a promotion that has not happened yet — and it keeps its
-- meaning here.
--
-- What it is not is *issuing*. Nothing in the ledger could take stock out of
-- the promotional bucket again: `adjustment_write_off` runs from `damaged`,
-- and `adjustment_other` is not on `stock_movements_boundary_check`, so it
-- cannot destroy stock even deliberately. Every unit ever booked as
-- promotional was therefore stuck in that bucket permanently, inflating
-- on-hand with stock that physically left the building months ago.
--
-- So this adds the missing half rather than changing the existing half:
--
--   promotional        available -> promotional   set aside, still ours
--   promotional_issue  available -> (gone)        handed out, no longer ours
--
-- ------------------------------------------------ why it may destroy stock
--
-- `stock_movements_boundary_check` is the list of reasons allowed to create or
-- destroy stock, and its job is to make that *explicit*, not rare — the comment
-- on `20260802172208` says so where it widened the list for `missing` and
-- `found`. Issuing promotional stock belongs on it for the same reason: the
-- units have left the business and are not coming back, and the alternative is
-- a clerk reaching for "Missing", which is a lie that also loses the fact that
-- somebody authorised it.
--
-- It runs from `available` rather than from `promotional` deliberately. Stock
-- handed out on the day is the common case and should be one action, not two.
--
-- ------------------------------------------------------------- issued to whom
--
-- `issued_to_name` is required for this reason and cannot be whitespace. An
-- "issued to" that can be left blank is not accountability, it is a text box —
-- and this project has already shipped one signature field that accepted a
-- space (the POD dialog refused it, direct SQL did not). The constraint is
-- where the rule belongs, so it holds for every caller.
--
-- It is deliberately free text, not a reference to `profiles`. Promotional
-- stock goes to promoters hired for a weekend, to a driver, to a shop owner —
-- people who have no login and never will. A foreign key would force the clerk
-- to either misattribute it to whoever is nearest in the list or not record it
-- at all. If per-person reporting is wanted later, a nullable `profile_id`
-- alongside this is additive and cheap.

-- ------------------------------------------------------ the adjustment reason

alter table public.stock_adjustments
  add column if not exists issued_to_name text;

comment on column public.stock_adjustments.issued_to_name is
  'Who physically took promotional stock. Required for promotional_issue; free text because promoters and shop staff have no login.';

alter table public.stock_adjustments drop constraint if exists stock_adjustments_reason_check;
alter table public.stock_adjustments add constraint stock_adjustments_reason_check
  check (reason_code in ('damage', 'expiry', 'promotional', 'promotional_issue',
                         'missing', 'found', 'write_off', 'other'));

-- Required, and not satisfiable with a space. Permitted (but not demanded) on
-- other reasons: a name on a damage write-up is harmless, and refusing it would
-- be a refusal nobody could act on.
alter table public.stock_adjustments drop constraint if exists stock_adjustments_issue_attributed;
alter table public.stock_adjustments add constraint stock_adjustments_issue_attributed
  check (reason_code <> 'promotional_issue'
         or btrim(coalesce(issued_to_name, '')) <> '');

-- The update grant is an allow-list, so a new column is unwritable until it is
-- named here. Insert is granted at table level, so that side needs nothing.
grant update (issued_to_name) on public.stock_adjustments to authenticated;

-- --------------------------------------------------------- the ledger's reason

alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (
    reason in (
      'opening_stock','goods_receipt','grn_correction',
      'order_reservation','order_reservation_release',
      'order_pick','order_pick_undo','order_dispatch','order_delivery',
      'order_return_undelivered','customer_return',
      'transfer_out','transfer_in','transfer_loss',
      'adjustment_damage','adjustment_expiry','adjustment_promotional',
      'adjustment_promotional_issue',
      'adjustment_missing','adjustment_found','adjustment_write_off',
      'adjustment_other',
      'stocktake_variance_increase','stocktake_variance_decrease',
      'batch_reallocation'
    )
  );

alter table public.stock_movements drop constraint if exists stock_movements_boundary_check;
alter table public.stock_movements add constraint stock_movements_boundary_check
  check (
    (from_location_id is not null and to_location_id is not null)
    or reason in (
      'opening_stock','goods_receipt','grn_correction','customer_return',
      'order_delivery','transfer_loss','adjustment_write_off',
      'adjustment_missing','adjustment_found','adjustment_promotional_issue',
      'stocktake_variance_increase','stocktake_variance_decrease'
    )
  );

-- ------------------------------------------------------------- posting it

/**
 * Unchanged but for the reason mapping and the note. Reproduced whole because
 * `create or replace` takes the whole body, and a function edited by hand is
 * how the repo and the database drift apart.
 */
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
    insert into public.stock_movements (
      org_id, product_id, batch_id, qty,
      from_location_id, from_bucket, to_location_id, to_bucket,
      reason, reference, note, source_doc_type, source_doc_id, source_line_id,
      actor_id, approved_by)
    values (
      v_org, v_line.product_id, v_line.batch_id, v_line.qty,
      case when v_line.from_bucket is not null then v_adj.location_id end, v_line.from_bucket,
      case when v_line.to_bucket is not null then v_adj.location_id end, v_line.to_bucket,
      v_reason, v_adj.adjustment_number,
      -- Who took it rides on the movement itself for this reason, so the
      -- ledger answers "where did those units go" without a join back to the
      -- document. The line's own note still wins when there is one.
      coalesce(
        v_line.note,
        case when v_adj.reason_code = 'promotional_issue'
          then 'Issued to ' || v_adj.issued_to_name
               || coalesce(' - ' || nullif(btrim(v_adj.reason_note), ''), '')
        end,
        v_adj.reason_note),
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

-- --------------------------------------------------- and so it can be reported

/**
 * `stock_movement_summary` drops any reason it cannot name — `where category is
 * not null` — so a new reason that is not added here does not appear as
 * "other", it vanishes. Promotional stock given away is precisely the number
 * somebody will go looking for.
 */
drop function if exists public.stock_movement_summary(timestamptz, timestamptz, uuid);
create or replace function public.stock_movement_summary(
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now(),
  p_location_id uuid default null
)
returns table (
  category text,
  movements bigint,
  units bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org),
  scoped as (
    select m.*,
      case m.reason
        when 'goods_receipt' then 'Received'
        when 'opening_stock' then 'Opening stock'
        when 'customer_return' then 'Customer returns'
        when 'order_delivery' then 'Delivered to customers'
        when 'grn_correction' then 'Receipt corrections'
        when 'transfer_loss' then 'Lost in transfer'
        when 'adjustment_damage' then 'Damaged'
        when 'adjustment_expiry' then 'Expired'
        when 'adjustment_promotional' then 'Promotional'
        when 'adjustment_promotional_issue' then 'Issued for promotions'
        when 'adjustment_missing' then 'Missing'
        when 'adjustment_found' then 'Found'
        when 'adjustment_write_off' then 'Written off'
        when 'adjustment_other' then 'Other adjustments'
        when 'stocktake_variance_increase' then 'Stocktake gains'
        when 'stocktake_variance_decrease' then 'Stocktake losses'
        when 'order_return_undelivered' then 'Returned undelivered'
        else null
      end as category
    from public.stock_movements m
    cross join cfg
    where m.org_id = cfg.org
      and m.occurred_at >= p_from and m.occurred_at < p_to
      and (p_location_id is null
           or m.from_location_id = p_location_id
           or m.to_location_id = p_location_id)
  )
  -- Reservations, picks and dispatches are deliberately excluded: they move
  -- stock between buckets in the same building and would inflate every total
  -- with the same units counted three times on their way out of the door.
  select s.category, count(*)::bigint, sum(s.qty)::bigint
  from scoped s
  where s.category is not null
  group by s.category
  order by sum(s.qty) desc;
$$;

revoke all on function public.stock_movement_summary(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.stock_movement_summary(timestamptz, timestamptz, uuid) to authenticated;
