-- Rollback of 20261009130000_staff_score_per_trade: the score inputs, the
-- leave days and the weights setting, out again. Nothing else is touched.

delete from public.module_assignments
 where kind = 'function' and name in ('approved_leave_days', 'staff_score_inputs');
drop function if exists public.staff_score_inputs(timestamptz, timestamptz, uuid);
drop function if exists public.approved_leave_days(date, date);

delete from public.company_settings where key = 'staff_score_weights';
delete from public.template_settings where setting_key = 'staff_score_weights';
delete from public.setting_definitions where key = 'staff_score_weights';
