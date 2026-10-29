-- Rollback for 20261029181700_delivery_receiver_signature.
--
-- Puts delivery_confirm back as 20261027201700 made it (photo required, no
-- signature) and drops the column. Signatures already filed stay as pod
-- documents in delivery_documents and in the bucket; only the pointer on the
-- dispatch goes. The rehearsal compares md5(pg_get_functiondef) before the up
-- and after this.

drop function if exists public.delivery_confirm(uuid, text, timestamptz, text, bigint, text);

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


alter table public.dispatches drop constraint if exists dispatches_received_signature_in_org;
alter table public.dispatches drop column if exists received_signature_path;
