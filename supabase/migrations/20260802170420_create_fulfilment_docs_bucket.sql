-- Private bucket for delivery notes and signed proofs of delivery.
--
-- Paths are org_id/order_id/document_id.ext. The leading org segment is what
-- every policy below checks, so a path is provably ours before anything else is
-- considered.
--
-- 15 MB: a signed page is a phone photograph or a scan, not a document. The
-- files bucket allows 25 MB because it carries planograms and price lists that
-- genuinely are large; a 25 MB proof of delivery is a mis-set camera, and it is
-- kinder to refuse it at upload than to let a driver wait on a bad connection.
--
-- A signed POD cannot be regenerated from anything. It is the only evidence
-- that a customer received goods, and `scripts/backup-export.sh` downloads the
-- bytes of this bucket for the same reason it downloads visit photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fulfilment-docs', 'fulfilment-docs', false, 15728640,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reading an object is allowed exactly when the caller can read its
-- `delivery_documents` row. That `exists` runs under the caller's own RLS, so a
-- rep sees the paperwork for their own orders and nothing else, and the
-- entitlement rule lives in one place rather than being restated here.
--
-- Without it, hiding a document in the UI would be theatre: any authenticated
-- user could mint a signed URL for a path they guessed. The same argument the
-- files bucket makes.
drop policy if exists fulfilment_docs_read on storage.objects;
create policy fulfilment_docs_read on storage.objects
  for select using (
    bucket_id = 'fulfilment-docs'
    -- Defence in depth: even a bug in the join cannot cross an org boundary.
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and exists (
      select 1 from public.delivery_documents d
      where d.storage_path = storage.objects.name
    )
  );

-- Upload comes *before* the row exists — the browser puts the bytes up, then
-- delivery_document_register() files the record that makes them readable. So
-- this cannot join to delivery_documents the way the read policy does, and
-- checks the org prefix and the role instead.
--
-- The consequence is worth naming: a warehouse user can leave an orphaned
-- object in their own org's folder by uploading and never registering it. It is
-- unreadable — the read policy finds no row — and it is theirs. That is a tidy-up
-- job, not a security hole.
drop policy if exists fulfilment_docs_insert on storage.objects;
create policy fulfilment_docs_insert on storage.objects
  for insert with check (
    bucket_id = 'fulfilment-docs'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists fulfilment_docs_update on storage.objects;
create policy fulfilment_docs_update on storage.objects
  for update using (
    bucket_id = 'fulfilment-docs'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

-- Deleting is a manager's job, matching the delete policy on the row itself.
-- A signed proof of delivery is evidence; removing one should be deliberate and
-- attributable.
drop policy if exists fulfilment_docs_delete on storage.objects;
create policy fulfilment_docs_delete on storage.objects
  for delete using (
    bucket_id = 'fulfilment-docs'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public."current_role"()) = 'manager'
  );
