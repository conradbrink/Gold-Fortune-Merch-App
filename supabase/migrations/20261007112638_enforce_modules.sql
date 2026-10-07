-- Enforce modules in the database: a company without a module cannot read or
-- write that module's data, nor call its functions, whatever the web or the
-- phone shows. Requirements §6: "Module check on every API call".
--
-- HOW, and why this way.
--
-- * Tables get one RESTRICTIVE policy each, `module_gate`, using
--   `(select module_enabled('<module>'))`. Postgres ANDs restrictive policies
--   with the permissive ones, so none of the ~150 existing policies is
--   touched, and the rollback is "drop the module_gate policies". The
--   `(select …)` form makes it one evaluation per query, the same pattern as
--   every other policy here (`20260726_optimize_rls_policies`).
--   A query on a gated table from a company without the module returns no rows,
--   and a write is refused by RLS.
--
-- * Functions: SECURITY DEFINER functions bypass RLS, so a policy alone would
--   not stop `order_confirm` for a company without the warehouse. Every RPC of a
--   gated module therefore gets `require_module('<module>')` as its first
--   statement. For plpgsql that is a `perform` right after the top-level
--   `begin`; for `language sql` it is a separate first statement (not folded
--   into a CTE, which the planner can skip; see `20261007101102`). Invoker RPCs
--   get it too, so a caller sees "… is not enabled for your company's plan"
--   rather than an empty report. The bodies are rewritten from the catalogue,
--   with an assertion that each change happened exactly once.
--
-- * Helpers that policies, triggers or other modules' functions call
--   (hr_is_hr, hr_can_view_employee, reconcile_week_of_cycle,
--   recurring_next_date, oos_visit_flags, …) are deliberately NOT gated.
--   Raising inside a policy would turn "no rows" into an error for every
--   query on the table, and the tables are gated anyway.
--
-- * `module_assignments` records which module every public table and every
--   function callable by `authenticated` belongs to, `core` included.
--   `supabase/tests/module_enforcement.sql` fails if anything is missing from
--   it. That is how a table added tomorrow (or by another branch) is forced to
--   be classified instead of slipping through ungated.
--
-- Gold Fortune has every built module on, so for it every gate is open and
-- nothing changes. The service role and database sessions are never gated
-- (`module_enabled`), so the crons are unaffected.
--
-- Tables from the parallel distribution work (#68 quotes, #70 targets and
-- commissions, #71 invoices and recurring orders) are already in production
-- and are assigned to `distribution` here.
--
-- Rollback: supabase/rollback/<this version>_enforce_modules.down.sql.

create table public.module_assignments (
  kind        text not null check (kind in ('table','function','bucket')),
  name        text not null,
  module_code text not null references public.modules(code),
  primary key (kind, name)
);

alter table public.module_assignments enable row level security;
create policy module_assignments_select on public.module_assignments
  for select to authenticated using (true);
revoke insert, update, delete on public.module_assignments from anon, authenticated;

comment on table public.module_assignments is
  'Which module every public table, storage bucket and authenticated-callable function belongs to. Every new one must be added; module_enforcement.sql checks.';

insert into public.module_assignments (kind, name, module_code)
select 'table', t, m from (values
  -- core: never gated
  ('app_permissions','core'), ('app_releases','core'), ('company_modules','core'),
  ('company_settings','core'), ('dashboard_layouts','core'), ('document_counters','core'),
  ('file_groups','core'), ('file_reps','core'), ('files','core'),
  ('job_role_permissions','core'), ('job_roles','core'), ('location_pings','core'),
  ('module_assignments','core'), ('module_dependencies','core'), ('modules','core'),
  ('organizations','core'), ('photos','core'), ('platform_admins','core'),
  ('platform_audit_log','core'), ('profile_permissions','core'), ('profiles','core'),
  ('rate_limits','core'), ('routes','core'), ('security_events','core'),
  ('service_flags','core'), ('setting_definitions','core'), ('store_assignments','core'),
  ('store_groups','core'), ('stores','core'), ('territories','core'),
  ('territory_reps','core'), ('visits','core'), ('workday_sessions','core'),
  -- checklists and forms
  ('form_fields','checklists_forms'), ('form_responses','checklists_forms'),
  ('form_submissions','checklists_forms'), ('form_templates','checklists_forms'),
  -- distribution
  ('products','distribution'), ('promotions','distribution'),
  ('promotion_products','distribution'), ('promotion_stores','distribution'),
  ('promotion_checks','distribution'), ('leads','distribution'),
  ('orders','distribution'), ('order_lines','distribution'),
  ('order_status_events','distribution'), ('quotes','distribution'),
  ('quote_lines','distribution'), ('sales_targets','distribution'),
  ('commission_rules','distribution'), ('commissions','distribution'),
  ('tax_invoices','distribution'), ('tax_invoice_lines','distribution'),
  ('credit_notes','distribution'), ('credit_note_lines','distribution'),
  ('invoice_payments','distribution'), ('recurring_orders','distribution'),
  ('recurring_order_lines','distribution'), ('recurring_order_runs','distribution'),
  -- warehouse and deliveries
  ('delivery_documents','warehouse'), ('dispatch_lines','warehouse'),
  ('dispatches','warehouse'), ('drivers','warehouse'),
  ('goods_receipt_lines','warehouse'), ('goods_receipts','warehouse'),
  ('order_allocations','warehouse'), ('product_batches','warehouse'),
  ('product_location_settings','warehouse'), ('stock_adjustment_lines','warehouse'),
  ('stock_adjustments','warehouse'), ('stock_balances','warehouse'),
  ('stock_locations','warehouse'), ('stock_movements','warehouse'),
  ('stock_transfer_lines','warehouse'), ('stock_transfers','warehouse'),
  ('stocktake_lines','warehouse'), ('stocktakes','warehouse'),
  ('suppliers','warehouse'), ('vehicles','warehouse'),
  -- HR
  ('hr_case_evidence','hr'), ('hr_case_responses','hr'), ('hr_departments','hr'),
  ('hr_disciplinary_cases','hr'), ('hr_documents','hr'), ('hr_employee_assets','hr'),
  ('hr_employee_compensation','hr'), ('hr_employees','hr'), ('hr_leave_balances','hr'),
  ('hr_leave_requests','hr'), ('hr_leave_types','hr'), ('hr_lookups','hr'),
  ('hr_notifications','hr'), ('hr_review_categories','hr'), ('hr_review_ratings','hr'),
  ('hr_review_templates','hr'), ('hr_reviews','hr'), ('hr_settings','hr'),
  ('hr_warnings','hr')
) as v(t, m);

insert into public.module_assignments (kind, name, module_code) values
  ('bucket', 'visit-photos', 'core'),
  ('bucket', 'files', 'core'),
  ('bucket', 'app-releases', 'core'),
  ('bucket', 'fulfilment-docs', 'warehouse'),
  ('bucket', 'hr-documents', 'hr');

insert into public.module_assignments (kind, name, module_code)
select 'function', f, m from (values
  -- core, including helpers that policies and triggers call (never gated)
  ('activity_feed','core'), ('activity_feed_summary','core'), ('caller_may_read_org','core'),
  ('can_see_file','core'), ('close_abandoned_workday','core'), ('company_setting','core'),
  ('consume_rate_limit','core'), ('current_org_id','core'), ('current_role','core'),
  ('dashboard_operations','core'), ('dashboard_summary','core'), ('delete_job_role','core'),
  ('file_in_my_org','core'), ('has_permission','core'), ('haversine_m','core'),
  ('hr_can_configure','core'), ('hr_can_view_employee','core'),
  ('hr_current_leave_year','core'), ('hr_is_admin','core'), ('hr_is_hr','core'),
  ('hr_leave_year_of','core'), ('hr_manages_employee','core'), ('hr_my_employee_id','core'),
  ('hr_period_bounds','core'), ('hr_period_index','core'), ('hr_try_uuid','core'),
  ('hr_working_days','core'), ('is_platform_admin','core'), ('module_enabled','core'),
  -- Read-only helpers that report functions in other modules call: gating
  -- them would break Reports for a company without Distribution. The form
  -- data they read is gated by its own module's policies regardless.
  ('oos_names_skus','core'), ('oos_visit_flags','core'),
  ('my_company_config','core'), ('my_permissions','core'), ('next_document_number','core'),
  ('org_setting','core'), ('org_timezone','core'), ('reapply_job_role','core'),
  ('reconcile_week_of_cycle','core'), ('recurring_next_date','core'),
  ('rep_day_times','core'), ('rep_day_times_per_day','core'), ('rep_delete_impact','core'),
  ('rep_directory','core'), ('require_module','core'), ('require_permission','core'),
  ('save_job_role','core'), ('service_flag','core'), ('set_job_role','core'),
  ('set_profile_permission','core'), ('set_route_day_order','core'),
  ('set_store_location_from_visit','core'), ('store_delete_impact','core'),
  ('store_geocode_capture','core'), ('store_last_visit','core'),
  ('store_location_drift','core'), ('territory_subtree','core'), ('workday_trail','core'),
  -- recurring jobs
  ('call_cycle_gaps','recurring_jobs'), ('call_cycle_review','recurring_jobs'),
  ('generate_routes','recurring_jobs'),
  -- checklists and forms
  ('form_field_delete_impact','checklists_forms'), ('form_report','checklists_forms'),
  ('form_response_rows','checklists_forms'),
  -- reports
  ('compliance_trends','reports'), ('coverage_gaps','reports'), ('rep_scorecard','reports'),
  ('schedule_adherence','reports'), ('route_catchups','reports'),
  ('rep_performance_daily','reports'), ('rep_performance_missed','reports'),
  ('rep_performance_stores','reports'), ('rep_performance_summary','reports'),
  -- distribution
  ('perfect_store_score','distribution'), ('oos_hotspots','distribution'),
  ('promotion_store_status','distribution'), ('promotion_summaries','distribution'),
  ('product_delete_impact','distribution'), ('orders_pipeline_summary','distribution'),
  ('quote_convert','distribution'), ('quote_mark_converted','distribution'),
  ('commissions_recalculate','distribution'), ('commissions_set_status','distribution'),
  ('sales_target_progress','distribution'), ('tax_invoice_issue','distribution'),
  ('tax_invoice_void','distribution'), ('credit_note_issue','distribution'),
  ('invoice_payment_record','distribution'), ('invoice_payment_delete','distribution'),
  ('recurring_order_run_now','distribution'), ('recurring_order_save','distribution'),
  -- warehouse and deliveries
  ('assign_dispatch_rep','warehouse'), ('delivery_document_register','warehouse'),
  ('expiring_stock','warehouse'), ('goods_receipt_cancel','warehouse'),
  ('goods_receipt_post','warehouse'), ('low_stock_alerts','warehouse'),
  ('order_availability_check','warehouse'), ('order_cancel','warehouse'),
  ('order_confirm','warehouse'), ('order_dispatch','warehouse'), ('order_hold','warehouse'),
  ('order_mark_delivered','warehouse'), ('order_mark_packed','warehouse'),
  ('order_picking_list','warehouse'), ('order_record_pick','warehouse'),
  ('order_release_hold','warehouse'), ('order_return_undelivered','warehouse'),
  ('order_start_picking','warehouse'), ('orders_missing_pod','warehouse'),
  ('product_velocity','warehouse'), ('stock_adjustment_decide','warehouse'),
  ('stock_adjustment_submit','warehouse'), ('stock_ageing','warehouse'),
  ('stock_balance_drift','warehouse'), ('stock_movement_history','warehouse'),
  ('stock_movement_summary','warehouse'), ('stock_on_hand','warehouse'),
  ('stock_position_summary','warehouse'), ('stock_reservation_drift','warehouse'),
  ('stock_transfer_dispatch','warehouse'), ('stock_transfer_receive','warehouse'),
  ('stock_valuation','warehouse'), ('stocktake_decide','warehouse'),
  ('stocktake_open','warehouse'), ('stocktake_submit','warehouse'),
  ('stocktake_variance_report','warehouse'), ('warehouse_performance','warehouse'),
  -- HR
  ('hr_attendance_report','hr'), ('hr_dashboard_summary','hr'),
  ('hr_disciplinary_dashboard','hr'), ('hr_performance_dashboard','hr'),
  ('hr_review_resolve_template','hr'), ('hr_sweep_expiry_notifications','hr')
) as v(f, m);

---------------------------------------------------------------- table gates

do $$
declare r record;
begin
  for r in
    select a.name, a.module_code
      from public.module_assignments a
     where a.kind = 'table' and a.module_code <> 'core'
       and to_regclass('public.' || quote_ident(a.name)) is not null
  loop
    execute format(
      'create policy module_gate on public.%I as restrictive for all '
      'using ((select public.module_enabled(%L))) '
      'with check ((select public.module_enabled(%L)))',
      r.name, r.module_code, r.module_code);
  end loop;
end;
$$;

--------------------------------------------------------------- bucket gates

create policy module_gate_fulfilment_docs on storage.objects as restrictive for all
  using (bucket_id <> 'fulfilment-docs' or (select public.module_enabled('warehouse')))
  with check (bucket_id <> 'fulfilment-docs' or (select public.module_enabled('warehouse')));

create policy module_gate_hr_documents on storage.objects as restrictive for all
  using (bucket_id <> 'hr-documents' or (select public.module_enabled('hr')))
  with check (bucket_id <> 'hr-documents' or (select public.module_enabled('hr')));

------------------------------------------------------------- function gates

do $$
declare
  r record;
  def text;
  newdef text;
  lang text;
  guard text;
begin
  for r in
    select p.oid, p.proname, a.module_code
      from public.module_assignments a
      join pg_proc p on p.proname = a.name and p.pronamespace = 'public'::regnamespace
     where a.kind = 'function' and a.module_code <> 'core'
       and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
  loop
    def := pg_get_functiondef(r.oid);
    select l.lanname into lang from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = r.oid;

    if def like '%require_module(%' then
      raise exception '%: already module-guarded — has this migration run before?', r.proname;
    end if;

    if lang = 'plpgsql' then
      guard := format('  perform public.require_module(%L);', r.module_code);
      -- The first line that is only `begin` is the top-level block: the
      -- declare section cannot contain one. No 'g' flag: first match only.
      newdef := regexp_replace(def, E'\\n(begin)[ \\t]*\\n', E'\n\\1\n' || guard || E'\n', 'i');
    elsif lang = 'sql' then
      guard := format('  select public.require_module(%L);', r.module_code);
      if (length(def) - length(replace(def, 'AS $function$', ''))) / length('AS $function$') <> 1 then
        raise exception '%: body delimiter not found exactly once', r.proname;
      end if;
      newdef := replace(def, 'AS $function$', E'AS $function$\n' || guard);
    else
      raise exception '%: unexpected language %', r.proname, lang;
    end if;

    if newdef = def or (length(newdef) - length(replace(newdef, guard, ''))) / length(guard) <> 1 then
      raise exception '%: could not place the module guard exactly once', r.proname;
    end if;

    execute newdef;
  end loop;
end;
$$;
