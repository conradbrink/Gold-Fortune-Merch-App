-- The customer sets up their business, Tickd sets up the software (owner,
-- 22 Oct 2026).
--
-- Why: Company settings asked an owner to decide how Tickd calculates things:
-- when a day counts as short or long, what overtime is, the shortest normal
-- visit, when a store is due for an order, how recent an order must be for a
-- range, which numbers the dashboard shows, when the alerts day ends, the
-- longest gap between rounds, and how documents look. Settings is now four
-- short pages (Business, Team & Work, Notifications, Plan) and these rules are
-- set up by Tickd from the Control Centre, from the trade and the company's
-- own data.
--
-- What: these twelve settings become `internal`, like the six engine settings
-- (20261010390000_internal_settings). They keep working exactly as before:
-- same keys, same values, same readers (the phone, the reports, the alerts,
-- the ranges, the documents). Only who may change them moves: the database's
-- restrictive policies (company_settings_owner_keys_*) now refuse a
-- customer's write to them, and the operator changes them through the
-- service role. `create_company` (security definer) still copies them from
-- the trade's template.
--
-- Not moved: settings the customer's own screens still write. The set-up
-- wizard asks how they get paid (money_*), and Notifications has switches
-- over the alert rules and the alert emails (alerts_on, alerts_email); the
-- Control Centre shows their full detail without taking them away.
--
-- No company's values change. Also: the getting-started step that opened
-- Company settings opens Settings > Business (at the foot).
--
-- Rollback: supabase/rollback/20261022230000_tickd_sets_up_the_rules.down.sql.

do $$
declare
  v_missing text;
begin
  select string_agg(v.key, ', ' order by v.key) into v_missing
    from (values
      ('short_visit_minutes'),
      ('report_short_day_hours'),
      ('report_long_day_hours'),
      ('report_day_normal_hours'),
      ('report_week_normal_hours'),
      ('report_sunday_is_overtime'),
      ('reorder_after_days'),
      ('range_lapse_days'),
      ('dashboard_cards'),
      ('alerts_digest_time'),
      ('alerts_patrol_gap_minutes'),
      ('document_style')
    ) v(key)
   where not exists (select 1 from public.setting_definitions d where d.key = v.key);
  if v_missing is not null then
    raise exception 'Settings missing from setting_definitions: %', v_missing;
  end if;
end;
$$;

update public.setting_definitions
   set audience = 'internal'
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

-- The getting-started list's "Complete your company profile" opens Settings >
-- Business. The old address still forwards there; this saves the hop.
update public.onboarding_steps
   set href = '/settings/business'
 where code = 'company_profile' and href = '/settings/company';
