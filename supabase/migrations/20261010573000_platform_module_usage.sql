-- How much each company uses each module, for the Control Centre's Product page.
--
-- Why: the owner's spec (section 27) wants to see which features customers
-- value and which are underused: not just which modules are switched on, but
-- which are used. Each built module gets one plain "used" signal from records
-- Tickd already keeps, counted per company for a period:
--
--   core                a job checked into        visits.checkin_at
--   recurring_jobs      jobs planned              routes.created_at
--   checklists_forms    a form submitted          form_submissions.submitted_at
--   (reports            not measured: reading reports and exports isn't
--                       recorded, so it has no signal of its own)
--   owner_notifications an alert raised           alerts.occurred_at
--   distribution        an order placed           orders.created_at
--   warehouse           stock moved               stock_movements.occurred_at
--   hr                  leave, a review or a      hr_leave_requests, hr_reviews,
--                       document added            hr_documents (created_at)
--   vehicle_logbook     a vehicle day recorded    vehicle_days.created_at
--   invoicing           a quote or invoice made   quotes, tax_invoices (created_at)
--
--   platform_module_usage(from, to)  one row per module and company that used
--                                    it in [from, to): module_code, org_id, n.
--                                    Service role only.
--
-- Rollback: supabase/rollback/20261010573000_platform_module_usage.down.sql.

create or replace function public.platform_module_usage(p_from timestamptz, p_to timestamptz)
returns table (module_code text, org_id uuid, n bigint)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select u.module_code, u.org_id, sum(u.n)::bigint
  from (
    select 'core'::text, v.org_id, count(*) from public.visits v
      where v.checkin_at >= p_from and v.checkin_at < p_to group by v.org_id
    union all
    select 'recurring_jobs', r.org_id, count(*) from public.routes r
      where r.created_at >= p_from and r.created_at < p_to group by r.org_id
    union all
    select 'checklists_forms', f.org_id, count(*) from public.form_submissions f
      where f.submitted_at >= p_from and f.submitted_at < p_to group by f.org_id
    union all
    select 'owner_notifications', a.org_id, count(*) from public.alerts a
      where a.occurred_at >= p_from and a.occurred_at < p_to group by a.org_id
    union all
    select 'distribution', o.org_id, count(*) from public.orders o
      where o.created_at >= p_from and o.created_at < p_to group by o.org_id
    union all
    select 'warehouse', s.org_id, count(*) from public.stock_movements s
      where s.occurred_at >= p_from and s.occurred_at < p_to group by s.org_id
    union all
    select 'hr', h.org_id, count(*) from (
        select org_id, created_at from public.hr_leave_requests
        union all select org_id, created_at from public.hr_reviews
        union all select org_id, created_at from public.hr_documents
      ) h
      where h.created_at >= p_from and h.created_at < p_to group by h.org_id
    union all
    select 'vehicle_logbook', d.org_id, count(*) from public.vehicle_days d
      where d.created_at >= p_from and d.created_at < p_to group by d.org_id
    union all
    select 'invoicing', i.org_id, count(*) from (
        select org_id, created_at from public.quotes
        union all select org_id, created_at from public.tax_invoices
      ) i
      where i.created_at >= p_from and i.created_at < p_to group by i.org_id
  ) u (module_code, org_id, n)
  group by u.module_code, u.org_id;
$function$;

revoke all on function public.platform_module_usage(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.platform_module_usage(timestamptz, timestamptz) to service_role;

comment on function public.platform_module_usage(timestamptz, timestamptz) is
  'Control Centre: per module and company, how many times the module was used in a period (one plain signal per module). Service role only.';
