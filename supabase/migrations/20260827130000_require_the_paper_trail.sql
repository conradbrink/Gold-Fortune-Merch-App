-- A sick note and a warning letter are required, and the database is what says so.
--
-- Both rules already existed and neither was a rule. `hr_leave_types.
-- requires_document` was true for Sick Leave and the request dialog refused to
-- submit without a file; `hr_warnings.document_path` existed and the dialog
-- offered "Attach the letter". Both checks lived entirely in the browser, so
-- both were advice to one screen rather than a property of the record.
--
-- That gap matters here more than it usually would. This module feeds
-- disciplinary cases and a CCMA-style hearing, where "there is no note on file"
-- and "the note was never required" are the same sentence to anyone reading the
-- record afterwards. And the leave screens are about to exist on the phone as
-- well, at which point a rule enforced by one dialog is a rule that quietly
-- stops applying to whoever files from the other one.
--
-- Both tables are empty today, so nothing is grandfathered and nothing needs a
-- backfill. If they had rows, this would need an `is_legacy` escape and a
-- decision about them; it does not, and pretending otherwise would leave a hole
-- that only ever gets used by accident.

-- ---------------------------------------------------------------------------
-- Which warning types need a letter
-- ---------------------------------------------------------------------------
--
-- In `meta`, not a new column, for the reason `meta` exists — `{"terminal":
-- true}` on a case status is the same shape of fact. A verbal warning has no
-- letter to attach and is deliberately exempt; so is "Other", which is a
-- catch-all and would otherwise refuse a record nobody meant to make formal.
-- An HR manager can move the flag on any of them, and a warning type they add
-- themselves carries no requirement until they say so.

update public.hr_lookups
   set meta = meta || '{"requires_document": true}'::jsonb
 where kind = 'warning_type'
   and code in ('written', 'final_written')
   and coalesce(meta->>'requires_document', '') <> 'true';

-- ---------------------------------------------------------------------------
-- Leave: the type decides
-- ---------------------------------------------------------------------------

create or replace function public.hr_leave_requires_document()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_type record;
begin
  select name, requires_document into v_type
    from public.hr_leave_types
   where id = new.leave_type_id;

  -- An unknown type is the FK's problem, not this trigger's. Raising here would
  -- report a missing document for a request whose real fault is a bad type id.
  if v_type is null or not v_type.requires_document then return new; end if;

  if new.document_path is null or btrim(new.document_path) = '' then
    raise exception '% needs a supporting document — attach it before filing the request.',
      v_type.name
      using errcode = '23514';
  end if;
  return new;
end;
$$;

/**
 * Insert, and the two updates that could evade it.
 *
 * Not every update: a request is approved, rejected, withdrawn and cancelled by
 * updates that touch neither the type nor the document, and a blanket trigger
 * would make a legacy row impossible to decide on. Firing only when the two
 * columns that matter change closes the actual hole — swapping the leave type
 * after filing, or clearing the path afterwards — and leaves the lifecycle
 * alone.
 */
drop trigger if exists hr_leave_requests_require_document on public.hr_leave_requests;
create trigger hr_leave_requests_require_document
  before insert on public.hr_leave_requests
  for each row execute function public.hr_leave_requires_document();

drop trigger if exists hr_leave_requests_require_document_upd on public.hr_leave_requests;
create trigger hr_leave_requests_require_document_upd
  before update of leave_type_id, document_path on public.hr_leave_requests
  for each row
  when (new.leave_type_id is distinct from old.leave_type_id
        or new.document_path is distinct from old.document_path)
  execute function public.hr_leave_requires_document();

revoke all on function public.hr_leave_requires_document() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Warnings: the lookup decides
-- ---------------------------------------------------------------------------

create or replace function public.hr_warning_requires_document()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_label text;
begin
  select l.label into v_label
    from public.hr_lookups l
   where l.org_id = new.org_id
     and l.kind = 'warning_type'
     and l.code = new.warning_type
     and coalesce(l.meta->>'requires_document', '') = 'true';

  if v_label is null then return new; end if;

  if new.document_path is null or btrim(new.document_path) = '' then
    raise exception 'A % must have the signed letter attached.', lower(v_label)
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists hr_warnings_require_document on public.hr_warnings;
create trigger hr_warnings_require_document
  before insert on public.hr_warnings
  for each row execute function public.hr_warning_requires_document();

drop trigger if exists hr_warnings_require_document_upd on public.hr_warnings;
create trigger hr_warnings_require_document_upd
  before update of warning_type, document_path on public.hr_warnings
  for each row
  when (new.warning_type is distinct from old.warning_type
        or new.document_path is distinct from old.document_path)
  execute function public.hr_warning_requires_document();

revoke all on function public.hr_warning_requires_document() from public, anon, authenticated;

comment on function public.hr_leave_requires_document() is
  'Refuses a leave request with no document when its leave type requires one. The browser asks; this is what makes it a rule.';
comment on function public.hr_warning_requires_document() is
  'Refuses a warning with no letter when its warning type carries meta.requires_document. Verbal warnings are exempt by not carrying the flag.';
