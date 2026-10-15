-- Damaged stock (owner, 15 Oct 2026: "add a box for if they have any damages
-- and then ask for what is damaged with a photo"; chose "A box at every store"
-- and "A list for you, mark sorted").
--
-- A rep at a store reports stock of ours that is damaged there: which product
-- (or, for something not in the product list, what it is), how many single
-- items, what is wrong with it, and a photo. Written from the phone through the
-- outbox; it waits for its check-in to land so it can name the visit.
--
-- The photo has a bucket of its own, `damage-photos`, and is not filed in
-- `photos`. Everything that reads `photos` takes a photo on a visit as proof
-- the work was done (the staff score, the dashboard's photo figures, the
-- reports, and the job report a client is sent), and a picture of a broken
-- box is not that. Who may see a damage photo is who may see the report.
--
-- The manager sees every report with its photo, and marks it sorted once it
-- is replaced or credited. Who marked it, and when, is the database's to
-- record.

create table public.damage_reports (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.organizations(id) on delete cascade,
  store_id                  uuid not null references public.stores(id) on delete cascade,
  rep_id                    uuid references public.profiles(id) on delete set null,
  visit_id                  uuid references public.visits(id) on delete set null,
  visit_client_generated_id uuid,
  client_generated_id       uuid not null unique,
  -- A product from the list, or `item` for anything that is not in it.
  -- Restrict, like orders: a product with reports against it is history, and
  -- is deactivated, not deleted. Set null would leave a report saying nothing
  -- (and `damage_reports_what` would refuse the delete with a check error).
  product_id                uuid references public.products(id) on delete restrict,
  item                      text check (item is null or length(item) between 1 and 200),
  -- Single items, not shrinks: damage is counted one broken unit at a time.
  qty                       integer not null check (qty between 1 and 100000),
  problem                   text check (problem is null or length(problem) <= 500),
  -- `damage-photos/<org>/<rep>/<id>.jpg`; null when no photo was taken.
  photo_path                text check (photo_path is null
                                        or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  status                    text not null default 'open' check (status in ('open', 'sorted')),
  sorted_at                 timestamptz,
  sorted_by                 uuid references public.profiles(id) on delete set null,
  created_at                timestamptz not null default now(),
  constraint damage_reports_what check (product_id is not null or item is not null)
);
comment on table public.damage_reports is
  'Damaged stock a rep found at a store: product (or item), how many single items, what is wrong, a photo. The manager marks it sorted once replaced or credited.';
create index damage_reports_org_status_idx on public.damage_reports (org_id, status, created_at desc);
create index damage_reports_store_idx on public.damage_reports (store_id, created_at desc);

-- Sorted is stamped here, not by the page: who and when are facts, not input.
create function public.damage_reports_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.status = 'sorted' and old.status is distinct from 'sorted' then
    new.sorted_at := now();
    new.sorted_by := auth.uid();
  elsif new.status = 'open' then
    new.sorted_at := null;
    new.sorted_by := null;
  end if;
  return new;
end;
$$;
revoke all on function public.damage_reports_stamp() from public, anon, authenticated;

create trigger damage_reports_stamp
  before update of status on public.damage_reports
  for each row execute function public.damage_reports_stamp();

alter table public.damage_reports enable row level security;
-- The rep who reported it, whoever looks after the customers (the page is
-- under Customers, sales_coverage), and the warehouse, which replaces it.
-- `damage_photos_select` below is the same rule, so the report and its photo
-- are never seen apart.
create policy damage_reports_select on public.damage_reports for select
  using ((org_id = (select public.current_org_id()))
         and (rep_id = (select auth.uid())
              or (select public.has_permission('sales_coverage'))
              or (select public.has_permission('insights'))
              or (select public.has_permission('warehouse'))));
create policy damage_reports_insert on public.damage_reports for insert
  with check ((org_id = (select public.current_org_id()))
              and rep_id = (select auth.uid())
              and status = 'open'
              and exists (select 1 from public.stores s
                           where s.id = damage_reports.store_id
                             and s.org_id = (select public.current_org_id()))
              -- The visit and the photo are the rep's own, at this store.
              and (visit_id is null
                   or exists (select 1 from public.visits v
                               where v.id = damage_reports.visit_id
                                 and v.rep_id = (select auth.uid())
                                 and v.store_id = damage_reports.store_id))
              and (photo_path is null
                   or (split_part(photo_path, '/', 1) = (select public.current_org_id())::text
                       and split_part(photo_path, '/', 2) = (select auth.uid())::text)));
-- Marking sorted (or open again) only; the report itself is a record.
create policy damage_reports_update on public.damage_reports for update
  using ((org_id = (select public.current_org_id()))
         and ((select public.has_permission('sales_coverage'))
              or (select public.has_permission('insights'))
              or (select public.has_permission('warehouse'))))
  with check (org_id = (select public.current_org_id()));
create policy module_gate on public.damage_reports as restrictive for all
  using ((select public.module_enabled('distribution')))
  with check ((select public.module_enabled('distribution')));
revoke all on public.damage_reports from anon, authenticated;
grant select on public.damage_reports to authenticated;
grant insert (org_id, store_id, rep_id, visit_id, visit_client_generated_id, client_generated_id,
              product_id, item, qty, problem, photo_path, created_at)
  on public.damage_reports to authenticated;
grant update (status) on public.damage_reports to authenticated;

do $migration$
begin
  if to_regprocedure('public.company_writable()') is null then
    return;
  end if;
  create policy billing_gate_insert on public.damage_reports as restrictive for insert to authenticated
    with check ((select public.company_writable()));
  create policy billing_gate_update on public.damage_reports as restrictive for update to authenticated
    using ((select public.company_writable())) with check ((select public.company_writable()));
  create policy billing_gate_delete on public.damage_reports as restrictive for delete to authenticated
    using ((select public.company_writable()));
end;
$migration$;

insert into public.module_assignments (kind, name, module_code)
values ('table', 'damage_reports', 'distribution')
on conflict do nothing;

------------------------------------------------------------------ the photos

-- Private. Paths are <org>/<rep>/<report client id>.jpg, as the phone uploads
-- them; a rep writes only into their own folder, and reads are the report's
-- own rule.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('damage-photos', 'damage-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

create policy damage_photos_select on storage.objects for select
  using (bucket_id = 'damage-photos'
         and (storage.foldername(name))[1] = (select public.current_org_id())::text
         and ((storage.foldername(name))[2] = (select auth.uid())::text
              or (select public.has_permission('sales_coverage'))
              or (select public.has_permission('insights'))
              or (select public.has_permission('warehouse'))));
create policy damage_photos_insert on storage.objects for insert
  with check (bucket_id = 'damage-photos'
              and (storage.foldername(name))[1] = (select public.current_org_id())::text
              and (storage.foldername(name))[2] = (select auth.uid())::text);
-- The phone uploads with upsert, so a retry after a lost reply overwrites its
-- own file rather than failing.
create policy damage_photos_update on storage.objects for update
  using (bucket_id = 'damage-photos'
         and (storage.foldername(name))[1] = (select public.current_org_id())::text
         and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy module_gate_damage_photos on storage.objects as restrictive for all
  using (bucket_id <> 'damage-photos' or (select public.module_enabled('distribution')))
  with check (bucket_id <> 'damage-photos' or (select public.module_enabled('distribution')));

insert into public.module_assignments (kind, name, module_code)
values ('bucket', 'damage-photos', 'distribution')
on conflict do nothing;
