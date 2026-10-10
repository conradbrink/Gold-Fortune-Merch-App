-- Four permission holes found in the 10 Oct 2026 audit, each reproduced on a
-- local copy of the schema before this was written.
--
-- 1. A line manager without `hr` could approve their own leave. The leave
--    guard decides "is this the employee's manager?" from the NEW row, and
--    nothing stopped `employee_id` changing: move the request to someone you
--    manage and approve it in one update, then move it back. A request, a
--    warning and a review now stay with the employee they were made for.
-- 2. A manager could write an employee's acknowledgement of a warning: the
--    warning guard checked the acknowledgement only for the employee.
--    Acknowledgement fields now change only by the employee's own action.
-- 3. A manager could move a review from draft straight to "acknowledged",
--    skipping "completed". Only the employee acknowledges, and only a
--    completed review.
-- 4. Any signed-in user, a field worker included, could call
--    next_document_number for 'tax_invoice' or 'credit_note' and leave gaps in
--    the tax-invoice sequence. Those two now come only from the invoicing
--    functions, through next_document_number_internal, which no client may
--    call. Orders, quotes and warehouse documents are unchanged.
--
-- Every body is patched in place with each anchor asserted to appear once; the
-- rollback reverses each patch and drops the internal function.

do $$
declare
  r record;
  def text;
  n int;
begin
  for r in
    select * from (values
      ('hr_leave_request_guard()',
       '    if new.status is distinct from old.status then',
       E'    if new.employee_id is distinct from old.employee_id or new.org_id is distinct from old.org_id then\n'
       || E'      raise exception ''a leave request stays with the employee it was made for'' using errcode = ''42501'';\n'
       || E'    end if;\n'
       || '    if new.status is distinct from old.status then'),
      ('hr_warning_guard()',
       E'  if not v_can_write then\n    if not v_is_self then',
       E'  if new.employee_id is distinct from old.employee_id or new.org_id is distinct from old.org_id then\n'
       || E'    raise exception ''a warning stays with the employee it was issued to'' using errcode = ''42501'';\n'
       || E'  end if;\n'
       || E'  if v_can_write and not v_is_self then\n'
       || E'    new.acknowledged_by := old.acknowledged_by;\n'
       || E'    new.acknowledged_at := old.acknowledged_at;\n'
       || E'  end if;\n'
       || E'  if not v_can_write then\n    if not v_is_self then'),
      ('hr_review_guard()',
       E'    if not v_can_write then\n      raise exception ''you may not edit this review'';\n    end if;',
       E'    if not v_can_write then\n      raise exception ''you may not edit this review'';\n    end if;\n'
       || E'    if new.employee_id is distinct from old.employee_id or new.org_id is distinct from old.org_id then\n'
       || E'      raise exception ''a review stays with the employee it is about'' using errcode = ''42501'';\n'
       || E'    end if;\n'
       || E'    if new.status = ''acknowledged'' and old.status <> ''acknowledged'' and not v_is_self then\n'
       || E'      raise exception ''only the employee acknowledges their review'' using errcode = ''42501'';\n'
       || E'    end if;'),
      ('invoice_write(uuid,text,text,uuid,uuid,text,text,text,text,date,numeric,boolean,jsonb,boolean)',
       'public.next_document_number(p_org, ''tax_invoice''',
       'public.next_document_number_internal(p_org, ''tax_invoice'''),
      ('tax_invoice_issue(uuid,date)',
       'public.next_document_number(v_org, ''tax_invoice''',
       'public.next_document_number_internal(v_org, ''tax_invoice'''),
      ('credit_note_issue(uuid,text,jsonb)',
       'public.next_document_number(i.org_id, ''credit_note''',
       'public.next_document_number_internal(i.org_id, ''credit_note''')
    ) v(fn, old_text, new_text)
  loop
    def := pg_get_functiondef(('public.' || r.fn)::regprocedure);
    n := (length(def) - length(replace(def, r.old_text, ''))) / length(r.old_text);
    if n <> 1 then
      raise exception '%: expected 1 of the anchor, found %', r.fn, n;
    end if;
    execute replace(def, r.old_text, r.new_text);
  end loop;
end;
$$;

-- The internal counter: the same body under another name, for the invoicing
-- functions only. Created from the live definition so the two cannot differ.
do $$
declare
  def text := pg_get_functiondef('public.next_document_number(uuid,text,text)'::regprocedure);
  anchor constant text := 'FUNCTION public.next_document_number(';
begin
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'next_document_number: unexpected definition';
  end if;
  execute replace(def, anchor, 'FUNCTION public.next_document_number_internal(');
end;
$$;
revoke all on function public.next_document_number_internal(uuid, text, text) from public, anon, authenticated;
grant execute on function public.next_document_number_internal(uuid, text, text) to service_role;

-- The public counter refuses the two gapless tax documents.
do $$
declare
  def text := pg_get_functiondef('public.next_document_number(uuid,text,text)'::regprocedure);
  anchor constant text := '  if p_prefix is null or p_prefix !~';
begin
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'next_document_number: anchor not found exactly once';
  end if;
  execute replace(def, anchor,
    E'  if p_doc_type in (''tax_invoice'', ''credit_note'') then\n'
    || E'    raise exception ''Tax invoice and credit note numbers are issued with the document.'' using errcode = ''42501'';\n'
    || E'  end if;\n'
    || anchor);
end;
$$;

insert into public.module_assignments (kind, name, module_code)
values ('function', 'next_document_number_internal', 'core')
on conflict do nothing;
