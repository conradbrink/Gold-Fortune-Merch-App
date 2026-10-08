-- Rollback of 20261009120000_reports_per_trade: the two reports and the three
-- report settings, out again. Nothing else is touched; companies keep every
-- other setting.

delete from public.module_assignments
 where kind = 'function' and name in ('service_log', 'staff_hours');
drop function if exists public.service_log(timestamptz, timestamptz, uuid);
drop function if exists public.staff_hours(timestamptz, timestamptz);

delete from public.company_settings
 where key in ('report_tabs', 'report_short_day_hours', 'report_long_day_hours');
delete from public.template_settings
 where setting_key in ('report_tabs', 'report_short_day_hours', 'report_long_day_hours');
delete from public.setting_definitions
 where key in ('report_tabs', 'report_short_day_hours', 'report_long_day_hours');
