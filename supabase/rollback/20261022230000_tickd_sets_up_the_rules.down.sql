-- Rollback of 20261022230000_tickd_sets_up_the_rules: the twelve settings go
-- back to the company (`owner`), as production had them on 22 Oct 2026.
-- No company's values change either way.

update public.setting_definitions
   set audience = 'owner'
 where key in (
   'short_visit_minutes',
   'report_short_day_hours',
   'report_long_day_hours',
   'report_day_normal_hours',
   'report_week_normal_hours',
   'report_sunday_is_overtime',
   'reorder_after_days',
   'range_lapse_days',
   'dashboard_cards',
   'alerts_digest_time',
   'alerts_patrol_gap_minutes',
   'document_style'
 );

update public.onboarding_steps
   set href = '/settings/company'
 where code = 'company_profile' and href = '/settings/business';
