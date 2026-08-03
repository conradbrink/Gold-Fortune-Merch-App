-- Lock the document before reading it, and make the closing update a swap.
--
-- ------------------------------------------------------------------ the race
--
-- `stock_transfer_dispatch` and `stock_transfer_receive` both read the transfer
-- and check its status *before* taking any lock:
--
--     select * into v_t from public.stock_transfers where id = p_transfer_id …
--     if v_t.status <> 'draft' then raise … end if;
--     perform pg_advisory_xact_lock(hashtext('stock_transfer'), …locations…);
--
-- Two clerks pressing Send at the same moment both pass the status check before
-- either holds a lock. The locations lock then serialises them, and the loser
-- walks the same lines and posts every movement a second time. The closing
-- `update … where id = v_t.id` carries no status predicate, so it succeeds too.
--
-- The locks that are there are for deadlock ordering between two transfers
-- moving stock in opposite directions between the same pair of sites. They were
-- never a guard on this document's own state, and they cannot be: the location
-- ids are not known until the row has been read.
--
-- ------------------------------------------------- why dispatch is the bad one
--
-- Posting a delivery or a receipt twice drives `in_transit` below zero and dies
-- on `stock_balances_non_negative`. Loud, and the transaction rolls back.
--
-- Dispatch moves `available -> in_transit`. Post it twice where enough stock
-- happens to be available and **nothing objects**: the ledger balances, the
-- cache agrees with the ledger, and `stock_balance_drift()` returns zero rows
-- because it compares those two and nothing else. Twice the stock leaves the
-- shelf, the destination is told to expect twice what was sent, and the only
-- record that disagrees is the paper the driver is holding.
--
-- That is the failure this migration exists for. It is unreachable today —
-- there is one stock location, so no transfer can be raised at all — and it
-- becomes reachable the moment a second one is inserted, which is an INSERT
-- rather than a migration.
--
-- ------------------------------------------------------------------- the fix
--
-- Two layers, and the first is the one that matters:
--
--   1. Take an advisory lock on the **transfer id** before the select. The
--      second caller then blocks until the first commits, re-reads, sees
--      `in_transit`, and is refused by the status check that already exists.
--      Keyed on the document rather than the locations, so it says what it
--      means and needs nothing read first.
--
--   2. Put the expected status in the WHERE clause of the closing update, and
--      check that a row was actually hit. A compare-and-swap catches anything
--      that reaches the update with the state changed underneath it —
--      including a future caller that forgets step 1.
--
-- The existing location locks stay exactly where they are. They solve a
-- different problem and still solve it.
--
-- ------------------------------------------------ also here, while in the file
--
-- * `variance_reason` is validated. The error text at the shortfall check names
--   the five permitted values, but the value itself was never checked against
--   them: it reached `stock_movements.note` unexamined and only met
--   `stock_transfer_lines_variance_reason_check` on the update afterwards, so
--   the caller got a raw constraint violation from a function that already knew
--   how to say it properly.
--
-- * Three `security definer` trigger functions kept the default `EXECUTE` grant
--   to `PUBLIC`. `20260802161921_revoke_trigger_function_execute.sql` ran before
--   they existed, so it could not have covered them, and unlike their
--   neighbours in the dispatch and transfer migrations they never revoked their
--   own. They are trigger functions: nothing should be calling them directly.
--
-- * The `fulfilment-docs` bucket's `on conflict` updated the size limit and the
--   mime list but not `public`. A bucket that already existed and was public
--   would have stayed public, and the signed proofs of delivery in it readable
--   without a signed URL. Belt and braces — it is private today.

-- ---------------------------------------------------------------- dispatch

drop function if exists public.stock_transfer_dispatch(uuid);
create or replace function public.stock_transfer_dispatch(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
  v_t public.stock_transfers;
  v_line record;
  v_a uuid;
  v_b uuid;
  v_total integer := 0;
  v_lines integer := 0;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can send a transfer.' using errcode = '42501';
  end if;

  -- Before the read, not after it. Everything below this line is then looking
  -- at a document nobody else can be acting on, which is what makes the status
  -- check underneath it mean anything.
  perform pg_advisory_xact_lock(hashtext('stock_transfer_doc'),
                                hashtext(p_transfer_id::text));

  select * into v_t from public.stock_transfers where id = p_transfer_id and org_id = v_org;
  if not found then
    raise exception 'That transfer does not exist.' using errcode = 'P0002';
  end if;
  if v_t.status <> 'draft' then
    raise exception 'Transfer % is already %.', v_t.transfer_number, v_t.status
      using errcode = '42501';
  end if;

  -- Sorted pair, so two transfers between the same places in opposite
  -- directions queue rather than deadlock. Unchanged, and still needed: this
  -- is about two *different* transfers, not two callers of this one.
  v_a := least(v_t.from_location_id, v_t.to_location_id);
  v_b := greatest(v_t.from_location_id, v_t.to_location_id);
  perform pg_advisory_xact_lock(hashtext('stock_transfer'), hashtext(v_a::text));
  perform pg_advisory_xact_lock(hashtext('stock_transfer'), hashtext(v_b::text));

  if not exists (select 1 from public.stock_transfer_lines where transfer_id = v_t.id) then
    raise exception 'Transfer % has no lines.', v_t.transfer_number using errcode = '42501';
  end if;

  for v_line in
    select * from public.stock_transfer_lines
    where transfer_id = v_t.id
    order by product_id, batch_id nulls first, id
  loop
    insert into public.stock_movements (
      org_id, product_id, batch_id, qty,
      from_location_id, from_bucket, to_location_id, to_bucket,
      reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id)
    values (
      v_org, v_line.product_id, v_line.batch_id, v_line.qty_sent,
      v_t.from_location_id, 'available', v_t.to_location_id, 'in_transit',
      'transfer_out', v_t.transfer_number,
      'transfer', v_t.id, v_line.id, auth.uid());

    v_total := v_total + v_line.qty_sent;
    v_lines := v_lines + 1;
  end loop;

  -- Compare-and-swap. The lock above should mean this always hits, so a miss
  -- means something reached here with the state changed underneath it and the
  -- movements just posted are wrong. Raising rolls them back with everything
  -- else in the transaction.
  update public.stock_transfers
     set status = 'in_transit', dispatched_at = now(), dispatched_by = auth.uid()
   where id = v_t.id and status = 'draft';
  if not found then
    raise exception 'Transfer % was sent by somebody else while this was running.',
      v_t.transfer_number using errcode = '40001';
  end if;

  return jsonb_build_object(
    'transfer_id', v_t.id, 'transfer_number', v_t.transfer_number,
    'status', 'in_transit', 'lines', v_lines, 'units', v_total);
end;
$$;

comment on function public.stock_transfer_dispatch(uuid) is
  'Sends a draft transfer: available at the source becomes in_transit at the destination. Locks the transfer id before reading it, so two callers cannot both pass the status check.';

revoke all on function public.stock_transfer_dispatch(uuid) from public, anon;
grant execute on function public.stock_transfer_dispatch(uuid) to authenticated;

-- ----------------------------------------------------------------- receive

drop function if exists public.stock_transfer_receive(uuid, jsonb);
create or replace function public.stock_transfer_receive(
  p_transfer_id uuid,
  p_lines jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
  v_t public.stock_transfers;
  v_line record;
  v_got integer;
  v_lost integer;
  v_reason text;
  v_a uuid;
  v_b uuid;
  v_received integer := 0;
  v_written_off integer := 0;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can receive a transfer.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('stock_transfer_doc'),
                                hashtext(p_transfer_id::text));

  select * into v_t from public.stock_transfers where id = p_transfer_id and org_id = v_org;
  if not found then
    raise exception 'That transfer does not exist.' using errcode = 'P0002';
  end if;
  if v_t.status <> 'in_transit' then
    raise exception 'Transfer % is %, not on its way.', v_t.transfer_number, v_t.status
      using errcode = '42501';
  end if;

  v_a := least(v_t.from_location_id, v_t.to_location_id);
  v_b := greatest(v_t.from_location_id, v_t.to_location_id);
  perform pg_advisory_xact_lock(hashtext('stock_transfer'), hashtext(v_a::text));
  perform pg_advisory_xact_lock(hashtext('stock_transfer'), hashtext(v_b::text));

  for v_line in
    select * from public.stock_transfer_lines
    where transfer_id = v_t.id
    order by product_id, batch_id nulls first, id
  loop
    v_got := coalesce(
      (select (e->>'qty_received')::integer
       from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
       where (e->>'line_id')::uuid = v_line.id),
      v_line.qty_sent);
    v_reason := (
      select nullif(btrim(coalesce(e->>'variance_reason', '')), '')
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
      where (e->>'line_id')::uuid = v_line.id);

    if v_got < 0 or v_got > v_line.qty_sent then
      raise exception 'Cannot receive % of a line of %.', v_got, v_line.qty_sent
        using errcode = '23514';
    end if;
    v_lost := v_line.qty_sent - v_got;

    if v_lost > 0 and v_reason is null then
      raise exception
        'Short by % on one line. Say why: short_shipped, damaged_in_transit, lost, miscount or other.',
        v_lost using errcode = '22023';
    end if;

    -- Checked here rather than left to the constraint on the update below. The
    -- value reaches `stock_movements.note` first, so without this the caller
    -- gets a raw constraint violation from a function whose own error text two
    -- lines up already names the five it accepts.
    if v_reason is not null and v_reason not in
       ('short_shipped', 'damaged_in_transit', 'lost', 'miscount', 'other') then
      raise exception
        'Unknown variance reason "%". Use short_shipped, damaged_in_transit, lost, miscount or other.',
        v_reason using errcode = '22023';
    end if;

    if v_got > 0 then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket, to_location_id, to_bucket,
        reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id)
      values (
        v_org, v_line.product_id, v_line.batch_id, v_got,
        v_t.to_location_id, 'in_transit', v_t.to_location_id, 'available',
        'transfer_in', v_t.transfer_number,
        'transfer', v_t.id, v_line.id, auth.uid());
    end if;

    -- The difference leaves the system with a reason attached. Left in
    -- in_transit it would sit there for ever, counted nowhere and owned by
    -- nobody.
    if v_lost > 0 then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket,
        reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id, note)
      values (
        v_org, v_line.product_id, v_line.batch_id, v_lost,
        v_t.to_location_id, 'in_transit',
        'transfer_loss', v_t.transfer_number,
        'transfer', v_t.id, v_line.id, auth.uid(), v_reason);
    end if;

    update public.stock_transfer_lines
       set qty_received = v_got, variance_reason = v_reason
     where id = v_line.id;

    v_received := v_received + v_got;
    v_written_off := v_written_off + v_lost;
  end loop;

  update public.stock_transfers
     set status = 'received', received_at = now(), received_by = auth.uid()
   where id = v_t.id and status = 'in_transit';
  if not found then
    raise exception 'Transfer % was received by somebody else while this was running.',
      v_t.transfer_number using errcode = '40001';
  end if;

  return jsonb_build_object(
    'transfer_id', v_t.id, 'transfer_number', v_t.transfer_number,
    'status', 'received', 'units_received', v_received,
    'units_written_off', v_written_off);
end;
$$;

comment on function public.stock_transfer_receive(uuid, jsonb) is
  'Receives a transfer in transit; the shortfall leaves the system as transfer_loss with a reason. Locks the transfer id before reading it.';

revoke all on function public.stock_transfer_receive(uuid, jsonb) from public, anon;
grant execute on function public.stock_transfer_receive(uuid, jsonb) to authenticated;

-- ------------------------------------------- trigger functions: EXECUTE grants

revoke all on function public.order_children_enforce_org() from public, anon, authenticated;
revoke all on function public.orders_log_status_change() from public, anon, authenticated;
revoke all on function public.goods_receipt_lines_enforce_org() from public, anon, authenticated;

-- --------------------------------------------------- the bucket stays private

update storage.buckets set public = false where id = 'fulfilment-docs';

-- ------------------------------------------------------- dispatch index shape

-- `dispatches_order_idx (order_id)` supports the filter but not the ordering,
-- so the per-order lookup in `warehouse_performance` sorts every matching row.
create index if not exists dispatches_order_dispatched_idx
  on public.dispatches (order_id, dispatched_at desc);
