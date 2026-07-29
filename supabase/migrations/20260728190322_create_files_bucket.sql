-- Private bucket for shared documents. Paths are org_id/file_id/filename.
--
-- 25 MB ceiling: reps open these on mobile data, and a planogram that costs
-- someone a chunk of their bundle is a planogram they will not open.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'files', 'files', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'text/csv', 'text/plain'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reading an object is allowed exactly when the caller can read its `files`
-- row. That `exists` runs under the caller's own RLS, so an unentitled rep
-- finds nothing and cannot sign the object — the entitlement rule lives in
-- public.files alone and this inherits it.
--
-- Without this, hiding a file in the UI would be theatre: any authenticated
-- rep could mint a signed URL for a path they guessed.
drop policy if exists files_read on storage.objects;
create policy files_read on storage.objects
  for select using (
    bucket_id = 'files'
    -- Defence in depth: even a bug in the join cannot cross an org boundary.
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and exists (
      select 1 from public.files f where f.storage_path = storage.objects.name
    )
  );

drop policy if exists files_insert on storage.objects;
create policy files_insert on storage.objects
  for insert with check (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public."current_role"()) = 'manager'
  );

drop policy if exists files_update on storage.objects;
create policy files_update on storage.objects
  for update using (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public."current_role"()) = 'manager'
  );

drop policy if exists files_delete on storage.objects;
create policy files_delete on storage.objects
  for delete using (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public."current_role"()) = 'manager'
  );
