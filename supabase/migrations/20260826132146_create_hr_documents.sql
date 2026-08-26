-- HR documents, and the one private bucket every HR attachment lives in.
--
-- One bucket, not five. Leave notes, case evidence, an employee's response, a
-- warning letter and the contract itself are all "a file about a person", they
-- all need the same answer to "who may read this", and five buckets would mean
-- five copies of that answer drifting apart. The path carries the scope —
-- `<org_id>/<employee_id>/<uuid>-<filename>` — and the read policy asks the
-- tables, not the path, which row entitles the object.
--
-- That last part is the design worth defending. The storage policy could have
-- read the employee id straight out of the path and checked it, and that would
-- have been shorter. It would also have been a *second* entitlement rule, and
-- the moment a disciplinary case became visible to somebody the employee record
-- was not, the two would disagree and one of them would be wrong. Instead each
-- `exists` below runs under the caller's own RLS against the table that owns
-- the path: if you cannot read the row, you cannot sign the object. The `files`
-- bucket already works this way and this follows it deliberately.

create table if not exists public.hr_documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  name        text not null,
  -- An hr_lookups code of kind 'document_category'. Text rather than a foreign
  -- key so that disabling a category does not orphan the documents filed under
  -- it — the label is looked up for display and falls back to the raw code.
  category    text not null default 'other',
  -- Matches storage.objects.name exactly; the storage policy joins on it.
  storage_path text not null unique,
  mime_type   text,
  size_bytes  bigint,
  issued_on   date,
  -- Null means it does not expire. Every expiry figure in the module treats
  -- null as "valid", never as "expired" — a certificate with no end date is the
  -- common case, not a missing value.
  expiry_date date,
  notes       text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists hr_documents_employee_idx
  on public.hr_documents (employee_id, created_at desc);
create index if not exists hr_documents_org_expiry_idx
  on public.hr_documents (org_id, expiry_date)
  where expiry_date is not null;

drop trigger if exists hr_documents_set_updated_at on public.hr_documents;
create trigger hr_documents_set_updated_at before update on public.hr_documents
  for each row execute function public.set_updated_at();

alter table public.hr_documents enable row level security;

drop policy if exists hr_documents_select on public.hr_documents;
create policy hr_documents_select on public.hr_documents
  for select using (
    org_id = (select public.current_org_id())
    and public.hr_can_view_employee(hr_documents.employee_id)
  );

-- HR files documents. A line manager can read their reports' paperwork but does
-- not add to it: an employment contract or a medical note arriving through a
-- manager rather than HR is a filing problem, not a feature.
drop policy if exists hr_documents_write on public.hr_documents;
create policy hr_documents_write on public.hr_documents
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

create or replace function public.log_hr_document_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_row record;
begin
  v_row := coalesce(new, old);
  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_row.org_id, auth.uid(),
          case tg_op when 'INSERT' then 'hr.document_uploaded'
                     when 'DELETE' then 'hr.document_deleted'
                     else 'hr.document_changed' end,
          'hr_employee', v_row.employee_id,
          jsonb_build_object('document_id', v_row.id, 'name', v_row.name,
                             'category', v_row.category, 'expiry_date', v_row.expiry_date,
                             'via', current_user));
  return v_row;
end;
$$;

drop trigger if exists hr_documents_log on public.hr_documents;
create trigger hr_documents_log after insert or update or delete on public.hr_documents
  for each row execute function public.log_hr_document_change();

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hr-documents', 'hr-documents', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv', 'text/plain'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/**
 * A uuid, or null if the text is not one.
 *
 * The storage policies need the employee id out of the path, and a cast that
 * throws inside a policy does not refuse one row — it kills the whole query.
 * An object whose path was never written by this application would take the
 * bucket down for everyone; returning null instead makes it simply invisible.
 */
create or replace function public.hr_try_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

revoke execute on function public.hr_try_uuid(text) from anon;

-- Readable exactly when the row that names the path is readable. Six `exists`
-- clauses because six tables can hold a path in this bucket; each one is the
-- table's own RLS answering for itself.
drop policy if exists hr_documents_read on storage.objects;
create policy hr_documents_read on storage.objects
  for select using (
    bucket_id = 'hr-documents'
    -- Defence in depth. Even a mistake in the joins below cannot cross an
    -- organisation boundary.
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (
      exists (select 1 from public.hr_documents d       where d.storage_path  = storage.objects.name)
      or exists (select 1 from public.hr_employees e    where e.photo_path    = storage.objects.name)
      or exists (select 1 from public.hr_leave_requests r where r.document_path = storage.objects.name)
      or exists (select 1 from public.hr_case_evidence v  where v.storage_path  = storage.objects.name)
      or exists (select 1 from public.hr_case_responses cr where cr.document_path = storage.objects.name)
      or exists (select 1 from public.hr_warnings w     where w.document_path = storage.objects.name)
    )
  );

-- Uploading happens before the row exists, so this cannot ask the tables. It
-- asks the path instead: the second segment must be an employee this caller is
-- entitled to. That lets a rep attach a sick note to their own leave request
-- and a manager attach evidence to their report's case, and lets neither near
-- anybody else's folder.
drop policy if exists hr_documents_upload on storage.objects;
create policy hr_documents_upload on storage.objects
  for insert with check (
    bucket_id = 'hr-documents'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and public.hr_can_view_employee(
          public.hr_try_uuid((storage.foldername(name))[2]))
  );

-- Replacing or removing bytes is HR's alone, whoever put them there. A leave
-- note that can be swapped after approval is not evidence of anything.
drop policy if exists hr_documents_modify on storage.objects;
create policy hr_documents_modify on storage.objects
  for update using (
    bucket_id = 'hr-documents'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public.hr_is_hr())
  );

drop policy if exists hr_documents_remove on storage.objects;
create policy hr_documents_remove on storage.objects
  for delete using (
    bucket_id = 'hr-documents'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public.hr_is_hr())
  );

comment on table public.hr_documents is
  'Employee paperwork. storage_path matches storage.objects.name exactly; the bucket policy joins on it so the entitlement rule lives here alone. expiry_date null means the document does not expire.';
comment on function public.hr_try_uuid(text) is
  'Cast-or-null. Used by the hr-documents storage policies: a raising cast inside a policy fails the whole query rather than the one row.';
