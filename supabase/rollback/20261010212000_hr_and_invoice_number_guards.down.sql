-- Rollback of 20261010212000_hr_and_invoice_number_guards: the inverse
-- replacements (the values list is the migration's own, read the other way
-- round), then the public counter's refusal is removed and the internal
-- counter dropped.

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
    ) v(fn, new_text, old_text)
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

do $$
declare
  def text := pg_get_functiondef('public.next_document_number(uuid,text,text)'::regprocedure);
  added constant text :=
    E'  if p_doc_type in (''tax_invoice'', ''credit_note'') then\n'
    || E'    raise exception ''Tax invoice and credit note numbers are issued with the document.'' using errcode = ''42501'';\n'
    || E'  end if;\n';
begin
  if (length(def) - length(replace(def, added, ''))) / length(added) <> 1 then
    raise exception 'next_document_number: the added check is not there exactly once';
  end if;
  execute replace(def, added, '');
end;
$$;

delete from public.module_assignments where kind = 'function' and name = 'next_document_number_internal';
drop function public.next_document_number_internal(uuid, text, text);
