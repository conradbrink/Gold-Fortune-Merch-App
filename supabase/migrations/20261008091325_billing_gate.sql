-- Read-only for a company that has not paid (Stage 6, with billing).
--
-- Why: requirements §5.5 — a trial that ends unpaid leaves the account
-- read-only (then, after 30 days, its data may be deleted); a failed renewal
-- gets retries and a 7-day grace period, then read-only until paid. The owner
-- chose to build this together with billing (8 Oct 2026). The daily billing
-- run (billing_prepare_due, previous migration) is the only thing that moves a
-- company to `read_only` or `cancelled`; paying moves it back at once.
--
-- HOW, the same way as the module gate (20261007112638_enforce_modules):
--
-- * company_writable(): false when the caller's company is read_only or
--   cancelled. The service role and database sessions are never blocked, so
--   the crons, the billing run and the operator's console keep working.
--
-- * Tables: three RESTRICTIVE policies each — billing_gate_insert,
--   billing_gate_update, billing_gate_delete — on every table in
--   module_assignments except the service's own (catalogues, templates,
--   billing, logs). Reads are untouched: a read-only company sees everything.
--   The gate looks at the caller's company, not the row, so child tables with
--   no org_id are covered too. Restrictive policies AND with the existing ones;
--   none of those is touched.
--
-- * Storage: the same three on storage.objects, so no photo or file is
--   uploaded into a company that cannot save the row that points at it.
--
-- * Functions: SECURITY DEFINER bypasses RLS, so every definer function that
--   writes and that a signed-in user can call gets `perform
--   public.require_writable();` right after its top-level `begin`, placed and
--   checked exactly once (the enforce_modules method). Not guarded, on purpose:
--   close_abandoned_workday (ending a day must always work), dismiss_onboarding,
--   consume_rate_limit and next_document_number (helpers), and billing's own
--   functions (paying must always work). Invoker functions are covered by the
--   table policies.
--
-- Phones: the phone writes through the same tables, so a read-only company's
-- phones are refused too. Phone 1.1.13 shows its general sync error and drops
-- each refused item after its eight attempts; a clear message comes with the
-- 1.2.0 release. Only Gold Fortune has phones today, and it is exempt.
--
-- Rollback: supabase/rollback/<this version>_billing_gate.down.sql.

create or replace function public.company_writable()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select current_setting('role', true) in ('none', 'service_role')
      or not exists (select 1 from public.company_account a
                      where a.org_id = public.current_org_id()
                        and a.status in ('read_only', 'cancelled'))
$function$;
revoke all on function public.company_writable() from public, anon;
grant execute on function public.company_writable() to authenticated;

create or replace function public.require_writable()
returns boolean
language plpgsql
stable
set search_path to 'public'
as $function$
begin
  if not public.company_writable() then
    raise exception 'Your company''s account is read-only until the plan is paid.'
      using errcode = '42501', hint = 'read_only';
  end if;
  return true;
end;
$function$;
revoke all on function public.require_writable() from public, anon;
grant execute on function public.require_writable() to authenticated;

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'company_writable', 'core'),
  ('function', 'require_writable', 'core');

---------------------------------------------------------------- table gates

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select a.name
      from public.module_assignments a
     where a.kind = 'table'
       and to_regclass('public.' || quote_ident(a.name)) is not null
       and a.name not in (
         -- the service's own: catalogues, templates, settings, logs, billing
         'app_permissions', 'app_releases', 'module_assignments', 'module_dependencies',
         'modules', 'platform_admins', 'platform_audit_log', 'platform_settings',
         'rate_limits', 'security_events', 'service_flags', 'setting_definitions',
         'industry_templates', 'template_modules', 'template_terminology', 'template_settings',
         'template_job_types', 'template_checklist_items', 'template_forms',
         'onboarding_steps', 'price_list', 'company_account', 'billing_counters',
         'billing_charges', 'billing_invoices', 'billing_payments')
     order by a.name
  loop
    execute format('create policy billing_gate_insert on public.%I as restrictive for insert to authenticated '
                   'with check ((select public.company_writable()))', r.name);
    execute format('create policy billing_gate_update on public.%I as restrictive for update to authenticated '
                   'using ((select public.company_writable())) with check ((select public.company_writable()))', r.name);
    execute format('create policy billing_gate_delete on public.%I as restrictive for delete to authenticated '
                   'using ((select public.company_writable()))', r.name);
    n := n + 1;
  end loop;
  if n < 80 then
    raise exception 'Only % tables were gated; expected every company table.', n;
  end if;
end;
$$;

---------------------------------------------------------------- bucket gates

create policy billing_gate_insert on storage.objects as restrictive for insert to authenticated
  with check ((select public.company_writable()));
create policy billing_gate_update on storage.objects as restrictive for update to authenticated
  using ((select public.company_writable())) with check ((select public.company_writable()));
create policy billing_gate_delete on storage.objects as restrictive for delete to authenticated
  using ((select public.company_writable()));

------------------------------------------------------------- function gates

do $$
declare
  f      text;
  v_oid  oid;
  def    text;
  newdef text;
  lang   text;
  guard  text := '  perform public.require_writable();';
begin
  foreach f in array array[
    'assign_dispatch_rep', 'commissions_recalculate', 'commissions_set_status', 'credit_note_issue',
    'delete_job_role', 'delivery_document_register', 'goods_receipt_cancel', 'goods_receipt_post',
    'hr_sweep_expiry_notifications', 'invoice_payment_delete', 'invoice_payment_record',
    'order_cancel', 'order_confirm', 'order_dispatch', 'order_hold', 'order_mark_delivered',
    'order_mark_packed', 'order_record_pick', 'order_release_hold', 'order_return_undelivered',
    'order_start_picking', 'quote_mark_converted', 'reapply_job_role', 'recurring_order_run_now',
    'save_job_role', 'set_job_role', 'set_profile_permission', 'set_store_location_from_visit',
    'stock_adjustment_decide', 'stock_adjustment_submit', 'stock_transfer_dispatch',
    'stock_transfer_receive', 'stocktake_decide', 'stocktake_open', 'stocktake_submit',
    'tax_invoice_issue', 'tax_invoice_void']
  loop
    select p.oid, l.lanname into v_oid, lang
      from pg_proc p join pg_language l on l.oid = p.prolang
     where p.proname = f and p.pronamespace = 'public'::regnamespace and p.prokind = 'f';
    if v_oid is null then
      raise exception '%: not found', f;
    end if;
    if (select count(*) from pg_proc where proname = f and pronamespace = 'public'::regnamespace) <> 1 then
      raise exception '%: more than one function by this name', f;
    end if;
    if lang <> 'plpgsql' then
      raise exception '%: expected plpgsql, found %', f, lang;
    end if;
    def := pg_get_functiondef(v_oid);
    if def like '%require_writable(%' then
      raise exception '%: already guarded — has this migration run before?', f;
    end if;
    -- The first line that is only `begin` is the top-level block (as in
    -- enforce_modules). An existing module guard stays right after it.
    newdef := regexp_replace(def, E'\\n(begin)[ \\t]*\\n', E'\n\\1\n' || guard || E'\n', 'i');
    if newdef = def or (length(newdef) - length(replace(newdef, guard, ''))) / length(guard) <> 1 then
      raise exception '%: could not place the guard exactly once', f;
    end if;
    execute newdef;
  end loop;
end;
$$;
