-- Stage 8 Part 5: overtime on the Hours report.
--
-- * Settings `report_day_normal_hours` and `report_week_normal_hours`: the
--   Hours report counts workday hours past a normal day, and normal hours past
--   a normal week (Monday to Sunday, the company's days), as overtime
--   (0 = no rule). The arithmetic is the page's, on the rows staff_hours()
--   already returns (web lib/staff-hours.ts).
-- * Setting `report_sunday_is_overtime`: every Sunday hour is overtime.
--
-- Seeded for the service trades as a South African ordinary week: 9 hours a
-- day, 45 a week. Security keeps its 12-hour shift (the long day mark of
-- 20261009120000) as the normal day. No trade is seeded a Sunday rule; a
-- company turns it on. Distribution is seeded nothing, so Gold Fortune keeps
-- 0, 0 and off and its Hours report shows no overtime.
--
-- No function: the settings are read with my_company_config() like the rest.
--
-- Rollback: supabase/rollback/20261009180000_overtime.down.sql.

insert into public.setting_definitions
  (key, label, description, value_type, default_value, min_value, max_value, pattern, sort_order) values
  ('report_day_normal_hours', 'Normal day (hours)',
   'The Hours report counts workday hours past this in a day as overtime. 0 turns it off.',
   'integer', '0', 0, 24, null, 960),
  ('report_week_normal_hours', 'Normal week (hours)',
   'The Hours report counts normal hours past this in a week, from Monday, as overtime. 0 turns it off.',
   'integer', '0', 0, 168, null, 970),
  ('report_sunday_is_overtime', 'Sunday is all overtime',
   'The Hours report counts every hour worked on a Sunday as overtime.',
   'boolean', 'false', null, null, null, 980);

insert into public.template_settings (template_code, setting_key, value)
select v.template_code, s.setting_key, to_jsonb(case s.setting_key when 'report_day_normal_hours' then v.day_hours
                                                                  else v.week_hours end)
  from (values
    ('cleaning', 9, 45),
    ('garden', 9, 45),
    ('plumbing', 9, 45),
    ('installation', 9, 45),
    ('maintenance', 9, 45),
    ('security', 12, 45),
    ('pest_control', 9, 45),
    ('pool', 9, 45),
    ('delivery', 9, 45),
    ('generic', 9, 45)
  ) as v(template_code, day_hours, week_hours)
  cross join (values ('report_day_normal_hours'), ('report_week_normal_hours')) as s(setting_key)
 where exists (select 1 from public.industry_templates it where it.code = v.template_code);

-- Existing companies: their first trade's values, as create_company writes
-- every setting (Gold Fortune: distribution's, which are the defaults).
insert into public.company_settings (org_id, key, value)
select o.id, d.key, coalesce(
         (select ts.value from public.template_settings ts
           where ts.template_code = o.industries[1] and ts.setting_key = d.key),
         d.default_value)
  from public.organizations o
  cross join public.setting_definitions d
 where d.key in ('report_day_normal_hours', 'report_week_normal_hours', 'report_sunday_is_overtime')
on conflict (org_id, key) do nothing;
