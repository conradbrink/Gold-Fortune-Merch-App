-- The manager signs for an order, and the driver records the drop (27 Oct 2026).
--
-- Two things the owner asked for on the rep's phone:
--
--   1. "a little signature spot where the manager can sign for the order".
--      The shop's manager signs on the screen before the rep saves the order.
--      The phone requires it (owner's choice: every order). The database
--      does not, on purpose: phones on older builds still have orders queued
--      without one, and refusing those would leave them stuck in the outbox.
--
--   2. "when someone is doing deliveries, for them to be able to go into the
--      delivery and capture POD". The rep a dispatch is assigned to types who
--      received it and photographs the signed delivery note. Owner's choices:
--      a photo of the note (no on-screen signature), and full deliveries only.
--      A short drop is still the warehouse's to record on the web.
--
-- ---------------------------------------------------------------- signatures
--
-- `orders.signature_path` names a PNG in the new private `order-signatures`
-- bucket, at <org>/<rep>/<order client id>.png, as the phone uploads it.
-- Written once, when the order arrives: authenticated gets INSERT on the
-- three columns and no UPDATE, so nobody can swap a signature afterwards.
-- The picture is readable by whoever can read its order (the read policy asks
-- `orders` under the caller's own RLS), as fulfilment_docs_read does for PODs.
--
-- ---------------------------------------------------------------- driver POD
--
-- `order_mark_delivered` stays the warehouse's: its body moves unchanged into
-- `order_mark_delivered_unchecked`, which nobody but the two wrappers can call,
-- and `order_mark_delivered` keeps its permission check in front of it.
--
-- `delivery_confirm` is the phone's way in. It admits the assigned rep (or the
-- warehouse), takes no per-line quantities (full deliveries only), and will
-- only run with the POD photo already in storage, under the order's folder,
-- so a delivery cannot be recorded from the phone without its proof. It files
-- the photo as the order's `pod` document in the same transaction, which flips
-- `pod_status` to received through delivery_documents_mark_pod.
--
-- It is safe to replay, because the phone queues it and resends it after a
-- lost reply: a photo already filed returns at once, and a dispatch the
-- warehouse marked delivered meanwhile gets the photo and keeps its record.
--
-- The photo goes into `fulfilment-docs` at <org>/<order>/<client id>.jpg, the
-- folder the web's own POD uploads use. A new insert policy lets the assigned
-- rep write there; reading stays fulfilment_docs_read's rule.
--
-- SECURITY DEFINER, as order_mark_delivered is (README rule 1 is invoker):
-- recording a drop moves stock out of the in-transit location, which a rep
-- has no right to write directly.

------------------------------------------------------------------ 1. signatures

alter table public.orders
  add column signature_path text,
  add column signed_by_name text,
  add column signed_at timestamptz;

-- All three or none: a picture without a name, or a name without a picture,
-- is not a signature anyone can rely on.
alter table public.orders
  add constraint orders_signature_complete check (
    (signature_path is null and signed_by_name is null and signed_at is null)
    or (signature_path is not null and signed_by_name is not null and signed_at is not null)),
  add constraint orders_signed_by_name_check check (
    signed_by_name is null
    or char_length(btrim(signed_by_name)) between 1 and 120),
  -- Under this company's own folder, which is what the storage policies check.
  -- Pointing at another company's object would make it readable here.
  add constraint orders_signature_path_org check (
    signature_path is null or signature_path like org_id::text || '/%');

grant insert (signature_path, signed_by_name, signed_at) on public.orders to authenticated;

comment on column public.orders.signature_path is
  'The manager''s signature for the order, a PNG in the order-signatures bucket (<org>/<rep>/<order client id>.png). Set when the order arrives from the phone; never updated.';
comment on column public.orders.signed_by_name is
  'The name typed beside the signature: who signed for the order in the shop.';
comment on column public.orders.signed_at is
  'When the manager signed, on the rep''s phone clock.';

-- The read policy below looks a stored picture up by its path.
create index orders_signature_path_idx on public.orders (signature_path)
  where signature_path is not null;

-- Private, PNG only, small: a signature drawn on a phone is tens of kilobytes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-signatures', 'order-signatures', false, 524288, array['image/png'])
on conflict (id) do nothing;

-- Whoever can read the order can read its signature: `orders` answers under
-- the caller's own RLS (the rep who took it, a rep delivering it, the
-- warehouse). And a rep reads their own folder, which the phone's upsert
-- needs: storage refuses an upsert the uploader cannot read back, and before
-- the order lands no order points at the picture yet.
create policy order_signatures_select on storage.objects for select
  using (bucket_id = 'order-signatures'
         and (storage.foldername(name))[1] = (select public.current_org_id())::text
         and ((storage.foldername(name))[2] = (select auth.uid())::text
              or exists (select 1 from public.orders o where o.signature_path = objects.name)));
-- A rep writes only into their own folder.
create policy order_signatures_insert on storage.objects for insert
  with check (bucket_id = 'order-signatures'
              and (storage.foldername(name))[1] = (select public.current_org_id())::text
              and (storage.foldername(name))[2] = (select auth.uid())::text);
-- The phone uploads with upsert, so a retry after a lost reply overwrites its
-- own file rather than failing. Only while no order points at it yet: once
-- one does, the signature on record is the one the manager drew.
create policy order_signatures_update on storage.objects for update
  using (bucket_id = 'order-signatures'
         and (storage.foldername(name))[1] = (select public.current_org_id())::text
         and (storage.foldername(name))[2] = (select auth.uid())::text
         and not exists (select 1 from public.orders o where o.signature_path = objects.name));
create policy module_gate_order_signatures on storage.objects as restrictive for all
  using (bucket_id <> 'order-signatures' or (select public.module_enabled('distribution')))
  with check (bucket_id <> 'order-signatures' or (select public.module_enabled('distribution')));

insert into public.module_assignments (kind, name, module_code)
values ('bucket', 'order-signatures', 'distribution')
on conflict do nothing;

------------------------------------------------------------------ 2. delivery, unchecked

-- The live order_mark_delivered body (md5 of prosrc d6f7b191…), with only the
-- permission check taken out. Not callable by anyone but its owner.
create or replace function public.order_mark_delivered_unchecked(
  p_dispatch_id uuid,
  p_received_by_name text,
  p_delivered_at timestamptz default null,
  p_lines jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
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
$function$;

revoke all on function public.order_mark_delivered_unchecked(uuid, text, timestamptz, jsonb)
  from public, anon, authenticated;

comment on function public.order_mark_delivered_unchecked(uuid, text, timestamptz, jsonb) is
  'The body of order_mark_delivered without its permission check. Callable only by its owner: order_mark_delivered (warehouse) and delivery_confirm (assigned rep) check first.';

-- No module_assignments row: README rule 4 covers what a client can call, and
-- nothing can call this one. module_enforcement.sql M3 calls every assigned
-- function as the company's administrator, which here would only meet the
-- revoked grant. It still opens with require_module('warehouse').

------------------------------------------------------------------ 3. the warehouse's, unchanged in effect

create or replace function public.order_mark_delivered(
  p_dispatch_id uuid,
  p_received_by_name text,
  p_delivered_at timestamptz default null,
  p_lines jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.require_writable();
  perform public.require_module('warehouse');
  if not public.has_permission('warehouse') then
    raise exception 'Only warehouse staff can record a delivery.' using errcode = '42501';
  end if;
  return public.order_mark_delivered_unchecked(
    p_dispatch_id, p_received_by_name, p_delivered_at, p_lines);
end;
$function$;

------------------------------------------------------------------ 4. the phone's

create or replace function public.delivery_confirm(
  p_dispatch_id uuid,
  p_received_by_name text,
  p_delivered_at timestamptz,
  p_pod_path text,
  p_size_bytes bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
  v_dispatch public.dispatches;
  v_name text := btrim(p_received_by_name);
  v_when timestamptz;
  v_doc uuid;
  v_already boolean := false;
begin
  perform public.require_writable();
  perform public.require_module('warehouse');
  v_org := public.current_org_id();

  select * into v_dispatch from public.dispatches
   where id = p_dispatch_id and org_id = v_org;
  -- One message for "no such dispatch" and "not yours", as delivery_contents
  -- gives: telling them apart would confirm another rep's dispatch exists.
  if not found
     or not (v_dispatch.assigned_rep_id = auth.uid() or public.has_permission('warehouse')) then
    raise exception 'That delivery is not assigned to you.' using errcode = '42501';
  end if;

  if v_name is null or v_name = '' then
    raise exception 'Who took delivery? A name is what makes the record worth keeping.'
      using errcode = '22023';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'That name is too long.' using errcode = '22023';
  end if;

  -- The photo, under this order's own folder, already uploaded. Without it
  -- there is no proof, and the phone does not record a drop without proof.
  if p_pod_path is null
     or split_part(p_pod_path, '/', 1) <> v_org::text
     or split_part(p_pod_path, '/', 2) <> v_dispatch.order_id::text then
    raise exception 'The proof of delivery must be filed under this order.' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects
                  where bucket_id = 'fulfilment-docs' and name = p_pod_path) then
    raise exception 'The proof of delivery photo has not arrived yet.' using errcode = 'P0002';
  end if;

  -- A retry after a lost reply: this photo is already filed, so the drop was
  -- recorded with it.
  select id into v_doc from public.delivery_documents
   where org_id = v_org and storage_path = p_pod_path;
  if found then
    return jsonb_build_object('document_id', v_doc, 'dispatch_number', v_dispatch.dispatch_number,
                              'status', v_dispatch.status, 'already_filed', true);
  end if;

  -- When the driver pressed the button, which may be hours before signal.
  -- Kept between the dispatch and now: a phone clock running fast must not
  -- make the drop "in the future" and stick in the outbox for good.
  v_when := least(greatest(coalesce(p_delivered_at, now()), v_dispatch.dispatched_at), now());

  if v_dispatch.status = 'in_transit' then
    perform public.order_mark_delivered_unchecked(p_dispatch_id, v_name, v_when, null);
  elsif v_dispatch.status = 'delivered' then
    -- The warehouse recorded it first. Its record stands; the photo is still
    -- the proof.
    v_already := true;
  else
    raise exception 'Dispatch % was marked % by the warehouse, so it cannot be recorded as delivered.',
      v_dispatch.dispatch_number, replace(v_dispatch.status, '_', ' ')
      using errcode = '42501';
  end if;

  insert into public.delivery_documents (
    org_id, order_id, dispatch_id, doc_type, storage_path,
    file_name, mime_type, size_bytes, signed_by_name, signed_at, uploaded_by)
  values (
    v_org, v_dispatch.order_id, v_dispatch.id, 'pod', p_pod_path,
    'POD ' || v_dispatch.dispatch_number || '.jpg', 'image/jpeg',
    case when p_size_bytes > 0 then p_size_bytes end, v_name, v_when, auth.uid())
  returning id into v_doc;

  return jsonb_build_object(
    'document_id', v_doc, 'dispatch_number', v_dispatch.dispatch_number,
    'status', 'delivered', 'already_delivered', v_already,
    'pod_status', (select pod_status from public.orders where id = v_dispatch.order_id));
end;
$function$;

revoke all on function public.delivery_confirm(uuid, text, timestamptz, text, bigint) from public, anon;
grant execute on function public.delivery_confirm(uuid, text, timestamptz, text, bigint)
  to authenticated, service_role;

comment on function public.delivery_confirm(uuid, text, timestamptz, text, bigint) is
  'The driver''s phone records a full delivery with its POD photo (already in fulfilment-docs under the order) for a dispatch assigned to them. Safe to replay.';

insert into public.module_assignments (kind, name, module_code)
values ('function', 'delivery_confirm', 'warehouse')
on conflict do nothing;

-- The assigned rep may put a POD photo in the order's folder of
-- fulfilment-docs. `dispatches` answers under the caller's RLS, which shows a
-- rep only the dispatches assigned to them.
create policy fulfilment_docs_insert_assigned on storage.objects for insert
  with check (bucket_id = 'fulfilment-docs'
              and (storage.foldername(name))[1] = (select public.current_org_id())::text
              and exists (select 1 from public.dispatches d
                           where d.order_id::text = (storage.foldername(objects.name))[2]
                             and d.assigned_rep_id = (select auth.uid())
                             and d.status in ('in_transit', 'delivered')));
