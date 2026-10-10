-- Rollback of 20261010390000_internal_settings: the policies, the names as
-- production had them on 10 Oct 2026, and the column.

drop policy if exists company_settings_owner_keys_insert on public.company_settings;
drop policy if exists company_settings_owner_keys_update on public.company_settings;

update public.setting_definitions p
   set label = v.label, description = v.description
  from (values
    ('short_visit_minutes', 'Short visit (minutes)',
     'A check-out sooner than this after check-in asks the employee to confirm. 0 turns the check off.'),
    ('auto_end_enabled', 'End forgotten workdays automatically',
     'Close a workday nobody ended at the time below. Turn off for night shifts.'),
    ('auto_end_time', 'Automatic end time',
     'Local time at which a forgotten workday is closed.'),
    ('checkin_radius_m', 'Check-in radius (metres)',
     'Default distance from a site within which a check-in counts as on site. Each site can override it.')
  ) as v(key, label, description)
 where p.key = v.key;

update public.modules
   set description = 'Workday start and end, GPS trail, live map, check-in and check-out, distance flags, short-visit flags, kilometres and hours; sites, schedule and visits; photos; files.'
 where code = 'core';

alter table public.setting_definitions drop column audience;
