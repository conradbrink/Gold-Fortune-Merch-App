-- The customer signs for a delivery on the driver's phone.
--
-- The owner (29 Oct 2026): "if maybe the client that receives it can just
-- sign on the phone". On 27 Oct the proof of a drop was the receiver's name and
-- a PHOTO of the signed delivery note (20261027201700). Asked what happens to
-- the photo now, the owner chose: the on-screen signature is required, the
-- photo is optional.
--
-- What this does:
--
--   * `dispatches.received_signature_path`: where the receiver's signature
--     (a PNG) is, in `fulfilment-docs` under the order's folder, like the POD
--     photo. Written only by `delivery_confirm()` (authenticated has no UPDATE
--     on dispatches at all), so the web can show it beside "Received by".
--   * The signature is also filed as the order's POD (`delivery_documents`,
--     doc_type 'pod', image/png), so it counts as proof everywhere a photo did:
--     `pod_status` turns received, it is listed with the order's documents,
--     and `fulfilment_docs_read` lets whoever can see those documents open it.
--   * `delivery_confirm()` takes `p_signature_path`; `p_pod_path` (the photo)
--     becomes optional. The database asks for at least one of the two, not
--     the signature: a phone on the build before this one has drops queued
--     with a photo and no signature, and those must still land. The phone
--     from this build asks for the signature (the same split as the order
--     signature in 20261027201700).
--
-- A new argument is a new function in Postgres, so the five-argument one is
-- dropped and this one created in its place. Every argument after the third
-- has a default, so a call from an older phone (named arguments through
-- PostgREST, no p_signature_path) still resolves to it.

alter table public.dispatches
  add column if not exists received_signature_path text;

alter table public.dispatches
  add constraint dispatches_received_signature_in_org
  check (received_signature_path is null
         or split_part(received_signature_path, '/', 1) = org_id::text);

comment on column public.dispatches.received_signature_path is
  'The receiver''s on-screen signature for this drop, a PNG in fulfilment-docs under the order''s folder. Set by delivery_confirm(); also filed as a pod document. Null for drops recorded by the warehouse or before 29 Oct 2026.';

drop function if exists public.delivery_confirm(uuid, text, timestamptz, text, bigint);

create or replace function public.delivery_confirm(
  p_dispatch_id uuid,
  p_received_by_name text,
  p_delivered_at timestamptz,
  p_pod_path text default null,
  p_size_bytes bigint default null,
  p_signature_path text default null
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
  v_sig_doc uuid;
  v_already boolean := false;
  v_path text;
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

  -- Proof: the receiver's signature (this build on), the photo of the signed
  -- delivery note (optional now, and all a phone before this build sends), or
  -- both. Each under this order's own folder, already uploaded.
  if p_signature_path is null and p_pod_path is null then
    raise exception 'The receiver''s signature is needed to record the delivery.' using errcode = '22023';
  end if;
  foreach v_path in array array_remove(array[p_signature_path, p_pod_path], null) loop
    if split_part(v_path, '/', 1) <> v_org::text
       or split_part(v_path, '/', 2) <> v_dispatch.order_id::text then
      raise exception 'The proof of delivery must be filed under this order.' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects
                    where bucket_id = 'fulfilment-docs' and name = v_path) then
      raise exception '%', case when v_path = p_signature_path
                                then 'The receiver''s signature has not arrived yet.'
                                else 'The proof of delivery photo has not arrived yet.' end
        using errcode = 'P0002';
    end if;
  end loop;
  if p_signature_path is not null and p_signature_path = p_pod_path then
    raise exception 'The signature and the photo cannot be the same file.' using errcode = '22023';
  end if;

  -- A retry after a lost reply: this proof is already filed, so the drop was
  -- recorded with it.
  select id into v_doc from public.delivery_documents
   where org_id = v_org and storage_path in (p_signature_path, p_pod_path)
   limit 1;
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
    -- The warehouse recorded it first. Its record stands; the proof is still
    -- the proof.
    v_already := true;
  else
    raise exception 'Dispatch % was marked % by the warehouse, so it cannot be recorded as delivered.',
      v_dispatch.dispatch_number, replace(v_dispatch.status, '_', ' ')
      using errcode = '42501';
  end if;

  if p_signature_path is not null then
    insert into public.delivery_documents (
      org_id, order_id, dispatch_id, doc_type, storage_path,
      file_name, mime_type, size_bytes, signed_by_name, signed_at, uploaded_by)
    values (
      v_org, v_dispatch.order_id, v_dispatch.id, 'pod', p_signature_path,
      'Signature ' || v_dispatch.dispatch_number || '.png', 'image/png',
      (select nullif((o.metadata->>'size')::bigint, 0) from storage.objects o
        where o.bucket_id = 'fulfilment-docs' and o.name = p_signature_path),
      v_name, v_when, auth.uid())
    returning id into v_sig_doc;

    -- Where the web shows it, beside "Received by". The first signature
    -- stands: a second phone recording the same drop files its own as a
    -- document and leaves this alone.
    update public.dispatches
       set received_signature_path = p_signature_path
     where id = v_dispatch.id and received_signature_path is null;
  end if;

  if p_pod_path is not null then
    insert into public.delivery_documents (
      org_id, order_id, dispatch_id, doc_type, storage_path,
      file_name, mime_type, size_bytes, signed_by_name, signed_at, uploaded_by)
    values (
      v_org, v_dispatch.order_id, v_dispatch.id, 'pod', p_pod_path,
      'POD ' || v_dispatch.dispatch_number || '.jpg', 'image/jpeg',
      case when p_size_bytes > 0 then p_size_bytes end, v_name, v_when, auth.uid())
    returning id into v_doc;
  end if;

  return jsonb_build_object(
    'document_id', coalesce(v_sig_doc, v_doc), 'dispatch_number', v_dispatch.dispatch_number,
    'status', 'delivered', 'already_delivered', v_already,
    'signed', p_signature_path is not null,
    'pod_status', (select pod_status from public.orders where id = v_dispatch.order_id));
end;
$function$;

revoke all on function public.delivery_confirm(uuid, text, timestamptz, text, bigint, text) from public, anon;
grant execute on function public.delivery_confirm(uuid, text, timestamptz, text, bigint, text)
  to authenticated, service_role;

comment on function public.delivery_confirm(uuid, text, timestamptz, text, bigint, text) is
  'The assigned driver or rep (or the warehouse) records a full drop from the phone: who received it, their on-screen signature and/or a photo of the signed delivery note, each already in fulfilment-docs under the order. Files each as a pod document and keeps the signature on the dispatch. Replay-safe.';
