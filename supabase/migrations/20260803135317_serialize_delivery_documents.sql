-- The same lock ordering for the delivery pair, and a line status that adds up.
--
-- ------------------------------------------------------------------ the race
--
-- `order_mark_delivered` and `order_return_undelivered` read the dispatch and
-- check its status before taking any lock, exactly as the two transfer RPCs did
-- before `20260803134033_serialize_transfer_documents.sql`. The lock they do
-- take is keyed on `v_dispatch.order_id`, which is not known until the row has
-- been read, so it cannot be moved above the read — the same shape, and the
-- same fix: lock the **dispatch id** first, then carry on.
--
-- These two are the milder half of the finding, and the reason is worth writing
-- down rather than leaving to be re-derived. Both move stock *out of*
-- `in_transit`. A second posting drives that bucket below zero and dies on
-- `stock_balances_non_negative`, so the loser rolls back with a loud
-- constraint violation. Nothing is corrupted; somebody just gets an ugly error
-- for something the system should have refused politely.
--
-- Dispatch was the dangerous one because it moves stock *into* in_transit, and
-- posting that twice succeeds wherever enough stock happens to be available.
-- That one is already fixed.
--
-- Fixing these anyway, for two reasons. A guard that holds because a constraint
-- elsewhere happens to catch it is not a guard, and the day somebody adds a
-- reason code that moves stock the other way, this becomes silent too. And an
-- error a customer-facing clerk cannot act on is its own defect: "Dispatch
-- GF-000012 is already delivered" is a sentence; a 23514 on
-- `stock_balances_non_negative` is not.
--
-- ------------------------------------------------------- the line status bug
--
-- Separately, and unrelated to concurrency: `order_mark_delivered` sets
--
--     line_status = case when v_delivered >= qty_ordered then 'fulfilled' …
--
-- where `v_delivered` is the quantity on **one** `dispatch_lines` row. An order
-- line with more than one allocation produces more than one dispatch line, so
-- each iteration compares its own slice against the whole ordered quantity and
-- the last one overwrites whatever the earlier ones decided. A line delivered
-- in full across two batches never reaches `fulfilled`, and the order looks
-- part-delivered for ever.
--
-- The comparison now uses the running total on the row being updated, which is
-- the column's own value plus what this iteration is adding.

-- ------------------------------------------------------------ mark delivered

drop function if exists public.order_mark_delivered(uuid, text, timestamptz, jsonb);
create or replace function public.order_mark_delivered(
  p_dispatch_id uuid,
  p_received_by_name text,
  p_delivered_at timestamptz default null,
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
  v_dispatch public.dispatches;
  v_order public.orders;
  v_line record;
  v_delivered integer;
  v_back integer;
  v_total_delivered integer := 0;
  v_total_back integer := 0;
  v_when timestamptz;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can record a delivery.' using errcode = '42501';
  end if;
  if p_received_by_name is null or btrim(p_received_by_name) = '' then
    raise exception 'Who took delivery? A name is what makes the record worth keeping.'
      using errcode = '22023';
  end if;

  -- Before the read. The order-level lock below cannot go here: it is keyed on
  -- a column of the row this select is about to fetch.
  perform pg_advisory_xact_lock(hashtext('dispatch_doc'), hashtext(p_dispatch_id::text));

  select * into v_dispatch from public.dispatches where id = p_dispatch_id and org_id = v_org;
  if not found then
    raise exception 'That dispatch does not exist.' using errcode = 'P0002';
  end if;
  if v_dispatch.status <> 'in_transit' then
    raise exception 'Dispatch % is already %.', v_dispatch.dispatch_number, v_dispatch.status
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('order_transition'),
                                hashtext(v_dispatch.order_id::text));

  select * into v_order from public.orders where id = v_dispatch.order_id;

  v_when := coalesce(p_delivered_at, now());
  if v_when > now() + interval '1 minute' then
    raise exception 'A delivery cannot be recorded in the future.' using errcode = '22023';
  end if;

  for v_line in
    select dl.*, ol.product_id
    from public.dispatch_lines dl
    join public.order_lines ol on ol.id = dl.order_line_id
    where dl.dispatch_id = v_dispatch.id
    order by ol.product_id, dl.batch_id nulls first, dl.id
  loop
    v_delivered := coalesce(
      (select (e->>'qty_delivered')::integer
       from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
       where (e->>'dispatch_line_id')::uuid = v_line.id),
      v_line.qty);

    if v_delivered < 0 or v_delivered > v_line.qty then
      raise exception 'Cannot deliver % of a consignment line of %.', v_delivered, v_line.qty
        using errcode = '23514';
    end if;
    v_back := v_line.qty - v_delivered;

    if v_delivered > 0 then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket,
        reason, reference, source_doc_type, source_doc_id, source_line_id,
        occurred_at, actor_id)
      values (
        v_org, v_line.product_id, v_line.batch_id, v_delivered,
        v_dispatch.transit_location_id, 'in_transit',
        'order_delivery', v_dispatch.dispatch_number,
        'dispatch', v_dispatch.id, v_line.order_line_id, v_when, auth.uid());
    end if;

    -- Whatever the customer would not take goes back on the shelf, not into
    -- the gap between two numbers.
    if v_back > 0 then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket, to_location_id, to_bucket,
        reason, reference, source_doc_type, source_doc_id, source_line_id,
        occurred_at, actor_id, note)
      values (
        v_org, v_line.product_id, v_line.batch_id, v_back,
        v_dispatch.transit_location_id, 'in_transit',
        v_dispatch.dispatch_location_id, 'available',
        'order_return_undelivered', v_dispatch.dispatch_number,
        'dispatch', v_dispatch.id, v_line.order_line_id, v_when, auth.uid(),
        'Not accepted at delivery');
    end if;

    update public.dispatch_lines
       set qty_delivered = v_delivered, qty_returned = v_back
     where id = v_line.id;

    -- `qty_delivered + v_delivered`, not `v_delivered` alone. The old test
    -- compared one consignment line against the whole ordered quantity, so a
    -- line delivered in full across two batches never reached 'fulfilled' and
    -- the last iteration overwrote what the earlier ones had set.
    update public.order_lines
       set qty_delivered = qty_delivered + v_delivered,
           qty_returned = qty_returned + v_back,
           line_status = case
             when qty_delivered + v_delivered >= qty_ordered then 'fulfilled'
             when qty_delivered + v_delivered > 0 then 'partial'
             else line_status end
     where id = v_line.order_line_id;

    v_total_delivered := v_total_delivered + v_delivered;
    v_total_back := v_total_back + v_back;
  end loop;

  update public.dispatches
     set status = 'delivered', delivered_at = v_when,
         delivered_by = auth.uid(), received_by_name = btrim(p_received_by_name)
   where id = v_dispatch.id and status = 'in_transit';
  if not found then
    raise exception 'Dispatch % was closed by somebody else while this was running.',
      v_dispatch.dispatch_number using errcode = '40001';
  end if;

  update public.orders
     set status = 'delivered', delivered_by = auth.uid(), delivered_at = v_when,
         pod_status = 'outstanding'
   where id = v_order.id;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number,
    'dispatch_number', v_dispatch.dispatch_number,
    'status', 'delivered', 'pod_status', 'outstanding',
    'units_delivered', v_total_delivered, 'units_returned', v_total_back);
end;
$$;

comment on function public.order_mark_delivered(uuid, text, timestamptz, jsonb) is
  'Records a delivery: in_transit leaves the system, anything refused goes back to available. Locks the dispatch id before reading it.';

revoke all on function public.order_mark_delivered(uuid, text, timestamptz, jsonb) from public, anon;
grant execute on function public.order_mark_delivered(uuid, text, timestamptz, jsonb) to authenticated;

-- -------------------------------------------------------- return undelivered

drop function if exists public.order_return_undelivered(uuid, text, boolean);
create or replace function public.order_return_undelivered(
  p_dispatch_id uuid,
  p_reason text,
  p_cancel boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
  v_dispatch public.dispatches;
  v_order public.orders;
  v_line record;
  v_total integer := 0;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can record a failed delivery.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the delivery did not happen.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('dispatch_doc'), hashtext(p_dispatch_id::text));

  select * into v_dispatch from public.dispatches where id = p_dispatch_id and org_id = v_org;
  if not found then
    raise exception 'That dispatch does not exist.' using errcode = 'P0002';
  end if;
  if v_dispatch.status <> 'in_transit' then
    raise exception 'Dispatch % is already %.', v_dispatch.dispatch_number, v_dispatch.status
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('order_transition'),
                                hashtext(v_dispatch.order_id::text));

  select * into v_order from public.orders where id = v_dispatch.order_id;

  for v_line in
    select dl.*, ol.product_id
    from public.dispatch_lines dl
    join public.order_lines ol on ol.id = dl.order_line_id
    where dl.dispatch_id = v_dispatch.id
    order by ol.product_id, dl.batch_id nulls first, dl.id
  loop
    -- Back to `reserved` when the order lives on, so re-dispatching is the same
    -- code path with nothing special about it; to `available` when it is being
    -- cancelled, because nothing is holding it any more.
    insert into public.stock_movements (
      org_id, product_id, batch_id, qty,
      from_location_id, from_bucket, to_location_id, to_bucket,
      reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id, note)
    values (
      v_org, v_line.product_id, v_line.batch_id, v_line.qty,
      v_dispatch.transit_location_id, 'in_transit',
      v_dispatch.dispatch_location_id, case when p_cancel then 'available' else 'reserved' end,
      'order_return_undelivered', v_dispatch.dispatch_number,
      'dispatch', v_dispatch.id, v_line.order_line_id, auth.uid(), p_reason);

    update public.dispatch_lines set qty_returned = v_line.qty where id = v_line.id;

    update public.order_lines
       set qty_dispatched = qty_dispatched - v_line.qty,
           qty_reserved = qty_reserved + case when p_cancel then 0 else v_line.qty end
     where id = v_line.order_line_id;

    if v_line.order_allocation_id is not null then
      update public.order_allocations
         set status = case when p_cancel then 'released' else 'picked' end,
             qty_dispatched = 0,
             qty_reserved = case when p_cancel then 0 else v_line.qty end
       where id = v_line.order_allocation_id;
    end if;

    v_total := v_total + v_line.qty;
  end loop;

  update public.dispatches
     set status = 'returned', failure_reason = p_reason
   where id = v_dispatch.id and status = 'in_transit';
  if not found then
    raise exception 'Dispatch % was closed by somebody else while this was running.',
      v_dispatch.dispatch_number using errcode = '40001';
  end if;

  -- The flag the transition guard is looking for. Transaction-local, and set
  -- only here, so no other path can move an order out of `dispatched`.
  perform set_config('app.stock_returned', v_order.id::text, true);

  if p_cancel then
    update public.order_lines set line_status = 'cancelled'
     where order_id = v_order.id and line_status <> 'cancelled';
    update public.orders
       set status = 'cancelled', cancel_reason = p_reason,
           cancelled_by = auth.uid(), cancelled_at = now()
     where id = v_order.id;
  else
    update public.orders
       set status = 'packed', dispatched_at = null, dispatched_by = null
     where id = v_order.id;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number,
    'dispatch_number', v_dispatch.dispatch_number,
    'status', case when p_cancel then 'cancelled' else 'packed' end,
    'units_returned', v_total);
end;
$$;

comment on function public.order_return_undelivered(uuid, text, boolean) is
  'Brings an undelivered consignment back: in_transit returns to reserved, or to available when the order is cancelled with it. Locks the dispatch id before reading it.';

revoke all on function public.order_return_undelivered(uuid, text, boolean) from public, anon;
grant execute on function public.order_return_undelivered(uuid, text, boolean) to authenticated;
