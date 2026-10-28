-- Rollback of 20261027201700_order_signature_driver_pod.
--
-- order_mark_delivered goes back to the live body as it was before (md5 of
-- prosrc d6f7b191d46d8a3ef187b9a639853bdc), so it no longer calls the
-- unchecked copy before that is dropped.
--
-- Signatures already stored are lost with the columns, and their pictures stay
-- in the bucket; PODs the phones filed stay as ordinary delivery documents.

drop policy if exists fulfilment_docs_insert_assigned on storage.objects;
drop function if exists public.delivery_confirm(uuid, text, timestamptz, text, bigint);
delete from public.module_assignments where kind = 'function' and name = 'delivery_confirm';

CREATE OR REPLACE FUNCTION public.order_mark_delivered(p_dispatch_id uuid, p_received_by_name text, p_delivered_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_lines jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  perform public.require_writable();
  perform public.require_module('warehouse');
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if not public.has_permission('warehouse') then
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
$function$
;

drop function if exists public.order_mark_delivered_unchecked(uuid, text, timestamptz, jsonb);

drop policy if exists module_gate_order_signatures on storage.objects;
drop policy if exists order_signatures_update on storage.objects;
drop policy if exists order_signatures_insert on storage.objects;
drop policy if exists order_signatures_select on storage.objects;
-- The bucket only when empty: the pictures are worth keeping until somebody
-- decides otherwise. storage.protect_delete refuses any SQL delete unless
-- this is set, for this transaction only.
set local storage.allow_delete_query = 'true';
delete from storage.buckets b
 where b.id = 'order-signatures'
   and not exists (select 1 from storage.objects o where o.bucket_id = b.id);
delete from public.module_assignments where kind = 'bucket' and name = 'order-signatures';

drop index if exists public.orders_signature_path_idx;
alter table public.orders
  drop constraint if exists orders_signature_path_org,
  drop constraint if exists orders_signed_by_name_check,
  drop constraint if exists orders_signature_complete,
  drop column if exists signed_at,
  drop column if exists signed_by_name,
  drop column if exists signature_path;
