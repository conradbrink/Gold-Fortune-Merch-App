insert into storage.buckets (id, name, public)
values ('visit-photos', 'visit-photos', false)
on conflict (id) do nothing;

-- Object paths are org_id/rep_id/visit_id/filename.jpg
create policy visit_photos_select on storage.objects
  for select using (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (
      public.current_role() = 'manager'
      or (storage.foldername(name))[2] = auth.uid()::text
    )
  );

create policy visit_photos_insert on storage.objects
  for insert with check (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy visit_photos_update on storage.objects
  for update using (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );
