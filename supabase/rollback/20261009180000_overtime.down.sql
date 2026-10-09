-- Rollback of 20261009180000_overtime: the three overtime settings, out
-- again. Nothing else is touched; companies keep every other setting.

delete from public.company_settings
 where key in ('report_day_normal_hours', 'report_week_normal_hours', 'report_sunday_is_overtime');
delete from public.template_settings
 where setting_key in ('report_day_normal_hours', 'report_week_normal_hours', 'report_sunday_is_overtime');
delete from public.setting_definitions
 where key in ('report_day_normal_hours', 'report_week_normal_hours', 'report_sunday_is_overtime');
