-- Owners configure their business, not the software (owner, 10 Oct 2026).
--
-- Why: Company settings showed every setting in `setting_definitions` that no
-- other card claimed, as a plain box: the GPS interval, the "implausible GPS
-- distance", the off-site distance. Those are how Tickd works, not how the
-- business works, and a wrong value quietly breaks tracking. Two more are
-- formulas rather than business decisions: which report tabs a trade gets,
-- and the weights of the staff score. And one is a default no screen ever
-- changed: the trade's starting dashboard layout (each person arranges their
-- own with Customise).
--
-- What: each setting now says who it is for. `owner` settings are on Company
-- settings, in plain words; `internal` settings keep working exactly as
-- before (same keys, same values, same readers: the phone, the reports, the
-- live map) but only Tickd changes them, from the operator's area. The
-- database refuses a customer write to an internal setting: a restrictive
-- policy, so it holds whatever the screens offer. `create_company` (security
-- definer) still copies every setting from the templates, and the operator
-- writes through the service role, so neither is affected.
--
-- Also: plainer names for the four field settings an owner keeps, because
-- the names are what the database's refusals say ("... must be between"),
-- and a plain description of the core module on the Plan tab.
--
-- No company's values change.
--
-- Rollback: supabase/rollback/20261010390000_internal_settings.down.sql.

alter table public.setting_definitions
  add column audience text not null default 'owner'
    check (audience in ('owner', 'internal'));

comment on column public.setting_definitions.audience is
  'owner: the company changes it on Company settings. internal: Tickd''s own configuration, changed only by the platform operator; customer writes are refused (company_settings_owner_keys_*).';

update public.setting_definitions
   set audience = 'internal'
 where key in (
   'gps_ping_interval_minutes',
   'off_site_distance_m',
   'invalid_gps_distance_m',
   'report_tabs',
   'staff_score_weights',
   'dashboard_layout'
 );

update public.setting_definitions p
   set label = v.label, description = v.description
  from (values
    ('short_visit_minutes', 'Shortest normal visit (minutes)',
     'Leaving sooner than this after checking in asks the person to confirm, and the visit is flagged. 0 turns this off.'),
    ('auto_end_enabled', 'End unfinished workdays automatically',
     'Ends a workday that nobody ended, at the time below. Turn this off if your team works night shifts.'),
    ('auto_end_time', 'Time to end unfinished workdays',
     'The time of day at which a workday nobody ended is ended for them.'),
    ('checkin_radius_m', 'Check-in distance (metres)',
     'How close to a site someone must be for a check-in to count as on site. A site can have its own distance.')
  ) as v(key, label, description)
 where p.key = v.key;

-- The Plan tab lists what a plan includes; the core module's description
-- was the one written for engineers ("GPS trail", "distance flags").
update public.modules
   set description = 'Workdays, where your team is during work on a live map, check-ins and check-outs, flags for short visits and visits away from the site, kilometres and hours; sites, the schedule and visits; photos; files.'
 where code = 'core';

-- Restrictive: added to whatever else allows the write, never instead of it.
create policy company_settings_owner_keys_insert on public.company_settings
  as restrictive for insert to authenticated
  with check (not exists (
    select 1 from public.setting_definitions d
     where d.key = company_settings.key and d.audience = 'internal'));

create policy company_settings_owner_keys_update on public.company_settings
  as restrictive for update to authenticated
  using (not exists (
    select 1 from public.setting_definitions d
     where d.key = company_settings.key and d.audience = 'internal'))
  with check (not exists (
    select 1 from public.setting_definitions d
     where d.key = company_settings.key and d.audience = 'internal'));
