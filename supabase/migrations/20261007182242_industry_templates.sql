-- Industry templates: the starting point a new company is copied from.
--
-- Why: the platform serves cleaning, garden, plumbing, installation,
-- maintenance, security, pest control, pool and distribution companies from
-- one codebase, and "industries differ only in configuration: modules,
-- terminology, job types, checklists, forms, report labels and settings"
-- (requirements, Draft v6, §5.1). A template is "a starting point, copied into
-- the new company"; after that the company's settings are its own, and "improving
-- a template later does not silently change existing customers" — so every
-- company records which template versions it started from.
--
-- What is here: the catalogue (global, read-only, written only by migrations)
-- and the 10 suggested starting templates of §5.4, as data. Job types are
-- stored with their duration, minimum photos and signature rule for the jobs
-- stage; until then each one becomes a ready-made checklist form when a
-- company is created (decided 7 Oct 2026). `create_company` (the next
-- migration) does the copying.
--
-- Gold Fortune is recorded as the first company on the Distribution template.
-- Nothing it sees changes.
--
-- Rollback: supabase/rollback/<this version>_industry_templates.down.sql.

----------------------------------------------------------------- the catalogue

create table public.industry_templates (
  code         text primary key check (code ~ '^[a-z][a-z_]*$'),
  name         text not null,
  description  text not null,
  -- Bumped when a template's contents change; companies keep the version they
  -- were created from (organizations.template_versions).
  version      integer not null default 1 check (version >= 1),
  is_active    boolean not null default true,
  -- How often a site is visited by default (organizations.default_visit_frequency).
  default_visit_frequency text not null default 'monthly'
               check (default_visit_frequency in ('weekly', 'biweekly', 'monthly')),
  sort_order   integer not null default 0
);

create table public.template_modules (
  template_code text not null references public.industry_templates(code) on delete cascade,
  module_code   text not null references public.modules(code),
  primary key (template_code, module_code)
);

create table public.template_terminology (
  template_code text not null references public.industry_templates(code) on delete cascade,
  term_key      text not null references public.term_definitions(key),
  singular      text not null check (length(btrim(singular)) between 1 and 40),
  plural        text not null check (length(btrim(plural)) between 1 and 40),
  article       text check (article in ('a', 'an')),
  primary key (template_code, term_key)
);

create table public.template_settings (
  template_code text not null references public.industry_templates(code) on delete cascade,
  setting_key   text not null references public.setting_definitions(key),
  -- Validated when copied: company_settings_validate refuses a bad value, and
  -- the creation rolls back (supabase/tests/template_creation.sql creates a
  -- company from every template).
  value         jsonb not null,
  primary key (template_code, setting_key)
);

create table public.template_job_types (
  template_code            text not null references public.industry_templates(code) on delete cascade,
  code                     text not null check (code ~ '^[a-z][a-z_]*$'),
  name                     text not null,
  default_duration_minutes integer check (default_duration_minutes between 5 and 1440),
  min_photos               integer not null default 0 check (min_photos between 0 and 20),
  requires_signature       boolean not null default false,
  sort_order               integer not null default 0,
  primary key (template_code, code)
);

create table public.template_checklist_items (
  template_code  text not null,
  job_type_code  text not null,
  sort_order     integer not null,
  item_text      text not null,
  required       boolean not null default false,
  photo_required boolean not null default false,
  primary key (template_code, job_type_code, sort_order),
  foreign key (template_code, job_type_code)
    references public.template_job_types(template_code, code) on delete cascade
);

create table public.template_forms (
  template_code text not null references public.industry_templates(code) on delete cascade,
  code          text not null check (code ~ '^[a-z][a-z_]*$'),
  name          text not null,
  description   text not null default '',
  -- [{label, field_type, required, options?}], field_type as form_fields allows.
  fields        jsonb not null check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) > 0),
  sort_order    integer not null default 0,
  primary key (template_code, code)
);

alter table public.organizations
  add column industries text[] not null default '{}',
  add column template_versions jsonb not null default '{}'::jsonb;

----------------------------------------------------------------------- RLS

alter table public.industry_templates enable row level security;
alter table public.template_modules enable row level security;
alter table public.template_terminology enable row level security;
alter table public.template_settings enable row level security;
alter table public.template_job_types enable row level security;
alter table public.template_checklist_items enable row level security;
alter table public.template_forms enable row level security;

create policy industry_templates_select on public.industry_templates for select to authenticated using (true);
create policy template_modules_select on public.template_modules for select to authenticated using (true);
create policy template_terminology_select on public.template_terminology for select to authenticated using (true);
create policy template_settings_select on public.template_settings for select to authenticated using (true);
create policy template_job_types_select on public.template_job_types for select to authenticated using (true);
create policy template_checklist_items_select on public.template_checklist_items for select to authenticated using (true);
create policy template_forms_select on public.template_forms for select to authenticated using (true);

revoke insert, update, delete on public.industry_templates, public.template_modules,
  public.template_terminology, public.template_settings, public.template_job_types,
  public.template_checklist_items, public.template_forms from anon, authenticated;
revoke all on public.industry_templates, public.template_modules,
  public.template_terminology, public.template_settings, public.template_job_types,
  public.template_checklist_items, public.template_forms from anon;

-- All core: the catalogue is the same for every company (README rule 4).
insert into public.module_assignments (kind, name, module_code) values
  ('table', 'industry_templates',       'core'),
  ('table', 'template_modules',         'core'),
  ('table', 'template_terminology',     'core'),
  ('table', 'template_settings',        'core'),
  ('table', 'template_job_types',       'core'),
  ('table', 'template_checklist_items', 'core'),
  ('table', 'template_forms',           'core');

------------------------------------------------- the 10 starting templates
-- "Suggested starting defaults. Refine them as real customers are onboarded"
-- (§5.4). Everything below is editable per company after creation.

insert into public.industry_templates (code, name, description, default_visit_frequency, sort_order) values
  ('cleaning',     'Cleaning',                'Office, home and contract cleaning on a recurring roster.', 'weekly', 10),
  ('garden',       'Garden & landscaping',    'Lawn, hedge and garden services on a regular round.', 'biweekly', 20),
  ('plumbing',     'Plumbing',                'Call-outs, installations and maintenance for clients.', 'monthly', 30),
  ('installation', 'Installation',            'CCTV, solar, electrical and satellite installers.', 'monthly', 40),
  ('maintenance',  'Maintenance & facilities','Planned maintenance, repairs and inspections.', 'monthly', 50),
  ('security',     'Security patrols',        'Guarding and patrol rounds with checkpoint check-ins.', 'weekly', 60),
  ('pest_control', 'Pest control',            'Inspections, treatments and follow-ups.', 'monthly', 70),
  ('pool',         'Pool service',            'Weekly pool cleaning and water care.', 'weekly', 80),
  ('distribution', 'Distribution & FMCG',     'Merchandising, orders and deliveries to stores.', 'monthly', 90),
  ('generic',      'Other / general',         'Any other field team: jobs with notes and photos.', 'monthly', 100);

-- Modules. The three "included" modules are part of every plan; the rest are
-- each industry's extras. Some are not built yet (assets, vehicle logbook,
-- proof of work, owner notifications, invoicing): they are kept here so the
-- template is complete, and switched on for a company only once built.
insert into public.template_modules (template_code, module_code)
select t, m
  from (values
    ('cleaning',     '{recurring_jobs,checklists_forms,reports,proof_of_work,assets}'),
    ('garden',       '{recurring_jobs,checklists_forms,reports,assets,vehicle_logbook}'),
    ('plumbing',     '{recurring_jobs,checklists_forms,reports,proof_of_work,invoicing,vehicle_logbook}'),
    ('installation', '{recurring_jobs,checklists_forms,reports,assets,proof_of_work,vehicle_logbook}'),
    ('maintenance',  '{recurring_jobs,checklists_forms,reports,assets}'),
    ('security',     '{recurring_jobs,checklists_forms,reports,owner_notifications}'),
    ('pest_control', '{recurring_jobs,checklists_forms,reports,proof_of_work}'),
    ('pool',         '{recurring_jobs,checklists_forms,reports,proof_of_work}'),
    ('distribution', '{recurring_jobs,checklists_forms,reports,distribution,warehouse}'),
    ('generic',      '{recurring_jobs,checklists_forms,reports}')
  ) as v(t, ms), unnest(ms::text[]) as m;

-- Words. Each industry names its place, its work and its people (§5.4); the day
-- list follows the work. Terms not listed keep the catalogue's neutral default.
insert into public.template_terminology (template_code, term_key, singular, plural) values
  ('cleaning', 'site', 'Site', 'Sites'), ('cleaning', 'job', 'Clean', 'Cleans'),
  ('cleaning', 'staff', 'Cleaner', 'Cleaners'), ('cleaning', 'day_plan', 'Today''s cleans', 'Today''s cleans'),
  ('garden', 'site', 'Property', 'Properties'), ('garden', 'job', 'Service', 'Services'),
  ('garden', 'staff', 'Gardener', 'Gardeners'), ('garden', 'day_plan', 'Today''s services', 'Today''s services'),
  ('plumbing', 'site', 'Client', 'Clients'), ('plumbing', 'job', 'Job', 'Jobs'),
  ('plumbing', 'staff', 'Plumber', 'Plumbers'),
  ('installation', 'site', 'Site', 'Sites'), ('installation', 'job', 'Installation', 'Installations'),
  ('installation', 'staff', 'Installer', 'Installers'), ('installation', 'day_plan', 'Today''s installations', 'Today''s installations'),
  ('maintenance', 'site', 'Site', 'Sites'), ('maintenance', 'job', 'Work order', 'Work orders'),
  ('maintenance', 'staff', 'Technician', 'Technicians'), ('maintenance', 'day_plan', 'Today''s work orders', 'Today''s work orders'),
  ('security', 'site', 'Site', 'Sites'), ('security', 'job', 'Patrol', 'Patrols'),
  ('security', 'staff', 'Officer', 'Officers'), ('security', 'day_plan', 'Today''s patrols', 'Today''s patrols'),
  ('pest_control', 'site', 'Property', 'Properties'), ('pest_control', 'job', 'Treatment', 'Treatments'),
  ('pest_control', 'staff', 'Technician', 'Technicians'), ('pest_control', 'day_plan', 'Today''s treatments', 'Today''s treatments'),
  ('pool', 'site', 'Property', 'Properties'), ('pool', 'job', 'Service', 'Services'),
  ('pool', 'staff', 'Technician', 'Technicians'), ('pool', 'day_plan', 'Today''s services', 'Today''s services'),
  -- Gold Fortune's words: the Distribution template is its setup.
  ('distribution', 'site', 'Store', 'Stores'), ('distribution', 'site_group', 'Chain', 'Chains'),
  ('distribution', 'job', 'Visit', 'Visits'), ('distribution', 'staff', 'Rep', 'Reps'),
  ('distribution', 'client', 'Customer', 'Customers'), ('distribution', 'territory', 'Territory', 'Territories'),
  ('distribution', 'schedule_cycle', 'Call cycle', 'Call cycles'),
  ('distribution', 'day_plan', 'Today''s route', 'Today''s route');
  -- generic: the neutral defaults, so no rows.

-- Settings that differ from the catalogue defaults.
insert into public.template_settings (template_code, setting_key, value) values
  ('cleaning', 'short_visit_minutes', '15'),
  ('plumbing', 'checkin_radius_m', '150'),
  ('installation', 'checkin_radius_m', '150'),
  -- Patrols: positions often, and nights — no automatic end of the day.
  ('security', 'gps_ping_interval_minutes', '2'),
  ('security', 'auto_end_enabled', 'false'),
  -- Gold Fortune's values, written down so a later change to a catalogue
  -- default does not move a new distribution company.
  ('distribution', 'gps_ping_interval_minutes', '5'),
  ('distribution', 'short_visit_minutes', '5'),
  ('distribution', 'auto_end_enabled', 'true'),
  ('distribution', 'auto_end_time', '"19:30"'),
  ('distribution', 'checkin_radius_m', '100');

-- Job types (kept for the jobs stage) and their checklists (copied as forms now).
insert into public.template_job_types
  (template_code, code, name, default_duration_minutes, min_photos, requires_signature, sort_order) values
  ('cleaning', 'office_clean', 'Office clean', 120, 2, false, 10),
  ('cleaning', 'deep_clean', 'Deep clean', 240, 2, false, 20),
  ('cleaning', 'window_clean', 'Window clean', 90, 2, false, 30),
  ('garden', 'lawn_cut', 'Lawn cut', 60, 2, false, 10),
  ('garden', 'hedge_trim', 'Hedge trim', 90, 2, false, 20),
  ('garden', 'garden_cleanup', 'Garden clean-up', 120, 2, false, 30),
  ('plumbing', 'call_out', 'Call-out', 60, 1, true, 10),
  ('plumbing', 'installation', 'Installation', 180, 2, true, 20),
  ('plumbing', 'maintenance', 'Maintenance', 90, 1, true, 30),
  ('installation', 'survey', 'Site survey', 60, 2, false, 10),
  ('installation', 'install', 'Installation', 240, 2, true, 20),
  ('installation', 'commissioning', 'Commissioning', 90, 1, true, 30),
  ('installation', 'service', 'Service', 60, 1, true, 40),
  ('maintenance', 'planned_maintenance', 'Planned maintenance', 120, 1, false, 10),
  ('maintenance', 'reactive_repair', 'Reactive repair', 90, 1, true, 20),
  ('maintenance', 'inspection', 'Inspection', 60, 1, false, 30),
  ('security', 'patrol_round', 'Patrol round', 60, 1, false, 10),
  ('pest_control', 'inspection', 'Inspection', 45, 1, false, 10),
  ('pest_control', 'treatment', 'Treatment', 60, 1, true, 20),
  ('pest_control', 'follow_up', 'Follow-up', 30, 1, false, 30),
  ('pool', 'weekly_service', 'Weekly service', 45, 2, false, 10),
  ('generic', 'general_job', 'General job', 60, 1, false, 10);

insert into public.template_checklist_items
  (template_code, job_type_code, sort_order, item_text, required, photo_required) values
  ('cleaning', 'office_clean', 10, 'Desks and surfaces wiped', true, false),
  ('cleaning', 'office_clean', 20, 'Floors vacuumed and mopped', true, false),
  ('cleaning', 'office_clean', 30, 'Kitchen cleaned', true, false),
  ('cleaning', 'office_clean', 40, 'Bathrooms cleaned and restocked', true, false),
  ('cleaning', 'office_clean', 50, 'Bins emptied', true, false),
  ('cleaning', 'office_clean', 60, 'After photo of each area', true, true),
  ('cleaning', 'deep_clean', 10, 'Before photo', true, true),
  ('cleaning', 'deep_clean', 20, 'Carpets and upholstery cleaned', false, false),
  ('cleaning', 'deep_clean', 30, 'Appliances cleaned inside and out', false, false),
  ('cleaning', 'deep_clean', 40, 'Walls and skirtings wiped', false, false),
  ('cleaning', 'deep_clean', 50, 'After photo', true, true),
  ('cleaning', 'window_clean', 10, 'Before photo', true, true),
  ('cleaning', 'window_clean', 20, 'Inside panes cleaned', true, false),
  ('cleaning', 'window_clean', 30, 'Outside panes cleaned', true, false),
  ('cleaning', 'window_clean', 40, 'Frames and sills wiped', false, false),
  ('cleaning', 'window_clean', 50, 'After photo', true, true),
  ('garden', 'lawn_cut', 10, 'Before photo', true, true),
  ('garden', 'lawn_cut', 20, 'Lawn mowed', true, false),
  ('garden', 'lawn_cut', 30, 'Edges trimmed', true, false),
  ('garden', 'lawn_cut', 40, 'Clippings removed', true, false),
  ('garden', 'lawn_cut', 50, 'After photo', true, true),
  ('garden', 'hedge_trim', 10, 'Before photo', true, true),
  ('garden', 'hedge_trim', 20, 'Hedges trimmed to shape', true, false),
  ('garden', 'hedge_trim', 30, 'Cuttings removed', true, false),
  ('garden', 'hedge_trim', 40, 'After photo', true, true),
  ('garden', 'garden_cleanup', 10, 'Before photo', true, true),
  ('garden', 'garden_cleanup', 20, 'Beds weeded', true, false),
  ('garden', 'garden_cleanup', 30, 'Leaves and debris removed', true, false),
  ('garden', 'garden_cleanup', 40, 'Green waste taken away', false, false),
  ('garden', 'garden_cleanup', 50, 'After photo', true, true),
  ('plumbing', 'call_out', 10, 'Problem assessed on arrival', true, false),
  ('plumbing', 'call_out', 20, 'Water isolated where needed', false, false),
  ('plumbing', 'call_out', 30, 'Repair completed and tested', true, false),
  ('plumbing', 'call_out', 40, 'No leaks after testing', true, false),
  ('plumbing', 'call_out', 50, 'Photo of the finished work', true, true),
  ('plumbing', 'installation', 10, 'Before photo', true, true),
  ('plumbing', 'installation', 20, 'Installed to specification', true, false),
  ('plumbing', 'installation', 30, 'Pressure tested, no leaks', true, false),
  ('plumbing', 'installation', 40, 'Area left clean', true, false),
  ('plumbing', 'installation', 50, 'After photo', true, true),
  ('plumbing', 'maintenance', 10, 'System inspected', true, false),
  ('plumbing', 'maintenance', 20, 'Worn parts replaced', false, false),
  ('plumbing', 'maintenance', 30, 'Tested after maintenance', true, false),
  ('plumbing', 'maintenance', 40, 'Photo of the work', true, true),
  ('installation', 'survey', 10, 'Photos of the installation points', true, true),
  ('installation', 'survey', 20, 'Measurements taken', true, false),
  ('installation', 'survey', 30, 'Power and cable routes checked', true, false),
  ('installation', 'survey', 40, 'Client requirements noted', true, false),
  ('installation', 'install', 10, 'Equipment installed', true, false),
  ('installation', 'install', 20, 'Serial numbers recorded', true, false),
  ('installation', 'install', 30, 'Cabling neat and secured', true, false),
  ('installation', 'install', 40, 'Photo of the installation', true, true),
  ('installation', 'commissioning', 10, 'System powered and tested', true, false),
  ('installation', 'commissioning', 20, 'Client shown how to use it', true, false),
  ('installation', 'commissioning', 30, 'Photo of the test results', true, true),
  ('installation', 'service', 10, 'Fault checked', true, false),
  ('installation', 'service', 20, 'Equipment cleaned', false, false),
  ('installation', 'service', 30, 'System tested after service', true, false),
  ('maintenance', 'planned_maintenance', 10, 'Equipment inspected', true, false),
  ('maintenance', 'planned_maintenance', 20, 'Service tasks completed', true, false),
  ('maintenance', 'planned_maintenance', 30, 'Readings recorded', false, false),
  ('maintenance', 'planned_maintenance', 40, 'After photo', true, true),
  ('maintenance', 'reactive_repair', 10, 'Fault found', true, false),
  ('maintenance', 'reactive_repair', 20, 'Repair completed', true, false),
  ('maintenance', 'reactive_repair', 30, 'Tested after repair', true, false),
  ('maintenance', 'reactive_repair', 40, 'Photo of the repair', true, true),
  ('maintenance', 'inspection', 10, 'Area inspected', true, false),
  ('maintenance', 'inspection', 20, 'Defects noted', true, false),
  ('maintenance', 'inspection', 30, 'Photo of any defect', false, true),
  ('security', 'patrol_round', 10, 'Perimeter checked', true, false),
  ('security', 'patrol_round', 20, 'Gates and doors locked', true, false),
  ('security', 'patrol_round', 30, 'Lights working', true, false),
  ('security', 'patrol_round', 40, 'Checkpoint photo', true, true),
  ('security', 'patrol_round', 50, 'Nothing unusual to report', false, false),
  ('pest_control', 'inspection', 10, 'Areas inspected', true, false),
  ('pest_control', 'inspection', 20, 'Signs of activity recorded', true, false),
  ('pest_control', 'inspection', 30, 'Photo of any activity', false, true),
  ('pest_control', 'treatment', 10, 'Treatment applied', true, false),
  ('pest_control', 'treatment', 20, 'Bait stations checked and refilled', true, false),
  ('pest_control', 'treatment', 30, 'Safety signage placed', true, false),
  ('pest_control', 'treatment', 40, 'Photo of the treated area', true, true),
  ('pest_control', 'follow_up', 10, 'Activity reduced', true, false),
  ('pest_control', 'follow_up', 20, 'Stations checked', true, false),
  ('pest_control', 'follow_up', 30, 'Photo', false, true),
  ('pool', 'weekly_service', 10, 'Before photo', true, true),
  ('pool', 'weekly_service', 20, 'Skimmed and brushed', true, false),
  ('pool', 'weekly_service', 30, 'Vacuumed', true, false),
  ('pool', 'weekly_service', 40, 'Filter backwashed', true, false),
  ('pool', 'weekly_service', 50, 'Chemicals dosed', true, false),
  ('pool', 'weekly_service', 60, 'After photo', true, true),
  ('generic', 'general_job', 10, 'Work completed', true, false),
  ('generic', 'general_job', 20, 'Photo of the work', true, true);

-- Forms beyond the checklists (§5.4: fault, cause and fix; serial capture;
-- incident; chemical usage; chemical readings).
insert into public.template_forms (template_code, code, name, description, fields, sort_order) values
  ('plumbing', 'job_report', 'Job report', 'What was wrong, why, and what was done.',
   '[{"label":"Fault","field_type":"text","required":true},
     {"label":"Cause","field_type":"text","required":false},
     {"label":"Fix","field_type":"text","required":true},
     {"label":"Parts used","field_type":"text","required":false},
     {"label":"Photo of the work","field_type":"photo","required":false}]', 10),
  ('installation', 'equipment_installed', 'Equipment installed', 'One per item of equipment fitted.',
   '[{"label":"Equipment","field_type":"text","required":true},
     {"label":"Serial number","field_type":"text","required":true},
     {"label":"Where it is fitted","field_type":"text","required":false},
     {"label":"Photo of the serial label","field_type":"photo","required":true}]', 10),
  ('security', 'incident_report', 'Incident report', 'Anything that happened on the round.',
   '[{"label":"What happened","field_type":"text","required":true},
     {"label":"Where","field_type":"text","required":false},
     {"label":"People involved","field_type":"text","required":false},
     {"label":"Police case number","field_type":"text","required":false},
     {"label":"Photo","field_type":"photo","required":false}]', 10),
  ('pest_control', 'chemical_usage', 'Chemical usage', 'Products and quantities used.',
   '[{"label":"Product","field_type":"text","required":true},
     {"label":"Quantity used","field_type":"number","required":true},
     {"label":"Unit","field_type":"multiple_choice","required":true,"options":["ml","l","g","kg"]},
     {"label":"Area treated","field_type":"text","required":false}]', 10),
  ('pool', 'water_readings', 'Water readings', 'Readings before chemicals are added.',
   '[{"label":"pH","field_type":"number","required":true},
     {"label":"Chlorine (ppm)","field_type":"number","required":true},
     {"label":"Alkalinity (ppm)","field_type":"number","required":false},
     {"label":"Notes","field_type":"text","required":false}]', 10);

------------------------------------------------------------ Gold Fortune

update public.organizations
   set industries = '{distribution}', template_versions = '{"distribution": 1}'::jsonb
 where id = '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
