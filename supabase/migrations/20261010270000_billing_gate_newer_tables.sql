-- The billing gate covers the company tables created after it.
--
-- 20261008091325_billing_gate put three restrictive policies (insert, update,
-- delete; `company_writable()`) on every company table that existed on
-- 8 October 2026. Tables made since, for alerts, messaging, job reports and
-- sending documents, never got them, so once the daily billing run makes an
-- unpaid company read-only, a signed-in user could still write to them:
-- `message_outbox`, `message_suppressions` and `job_reports` are writable by
-- signed-in users at the table level. Found in the 10 Oct 2026 audit.
--
-- This gates every table in module_assignments that does not yet have the
-- three policies, apart from the gate's own exclusions (catalogues,
-- templates, settings, logs, billing) and two more of the same kind:
-- `template_service_items` (a template catalogue) and `founding_applications`
-- (Tickd's own list, service role only). On production that is nine tables.
--
-- Functions: every definer function a signed-in user can call that writes
-- already calls require_writable(), except mark_alerts_read and
-- save_setup_step, which only record that an alert was seen and how far the
-- set-up wizard got. They stay ungated on purpose, like dismiss_onboarding.
--
-- The tables gated are recorded in a temporary list the rollback repeats.

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
         'app_permissions', 'app_releases', 'module_assignments', 'module_dependencies',
         'modules', 'platform_admins', 'platform_audit_log', 'platform_settings',
         'rate_limits', 'security_events', 'service_flags', 'setting_definitions',
         'industry_templates', 'template_modules', 'template_terminology', 'template_settings',
         'template_job_types', 'template_checklist_items', 'template_forms',
         'onboarding_steps', 'price_list', 'company_account', 'billing_counters',
         'billing_charges', 'billing_invoices', 'billing_payments',
         'template_service_items', 'founding_applications')
       and not exists (select 1 from pg_policies p
                        where p.schemaname = 'public' and p.tablename = a.name
                          and p.policyname like 'billing_gate_%')
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
  raise notice 'billing gate added to % tables', n;
end;
$$;
