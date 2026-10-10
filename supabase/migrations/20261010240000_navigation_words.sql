-- The words the new menu uses (owner, 10 Oct 2026: "simple navigation, deep
-- pages").
--
-- Why: the sidebar was regrouped into Customers, Operations, Team, Finance,
-- Reports, People, Admin and Resources (web/components/layout/nav-items.ts,
-- docs/navigation.md). Three things in the database still spoke the old menu:
--
--   1. "Area" was the default word for a territory. The owner asked for
--      "Territories" throughout: it reads the same for a cleaner and a
--      distributor. The catalogue default changes, and so does every company
--      still on the untouched default ("Area"/"Areas"); a company that chose
--      its own word keeps it.
--   2. Two templates differ from the words the owner gave per trade: Cleaning's
--      work is a "Visit" (was "Clean"), and Other / general's customer is a
--      "Client" (was the default "Site"). Templates change for new companies
--      only (each bumps its version); existing companies keep their words,
--      which they can change under Company settings, Terminology & branding.
--   3. The permission areas on People & permissions were named after the old
--      menu groups ("Sales & Coverage", "Field Operations", "Insights"). They
--      now name the new ones, so the screen that grants access reads like the
--      menu it opens. Codes, grants and enforcement are unchanged.
--
-- Data only: no table, function, policy or grant changes.
--
-- Rollback: supabase/rollback/20261010240000_navigation_words.down.sql.

----------------------------------------------------------- 1. Territories

update public.term_definitions
   set singular = 'Territory', plural = 'Territories'
 where key = 'territory' and singular = 'Area' and plural = 'Areas';

update public.company_terminology
   set singular = 'Territory', plural = 'Territories'
 where key = 'territory' and singular = 'Area' and plural = 'Areas';

------------------------------------------------------------- 2. templates

update public.template_terminology
   set singular = 'Visit', plural = 'Visits'
 where template_code = 'cleaning' and term_key = 'job';

update public.template_terminology
   set singular = 'Today''s visits', plural = 'Today''s visits'
 where template_code = 'cleaning' and term_key = 'day_plan';

insert into public.template_terminology (template_code, term_key, singular, plural) values
  ('generic', 'site', 'Client', 'Clients')
on conflict (template_code, term_key) do update
  set singular = excluded.singular, plural = excluded.plural;

update public.industry_templates set version = version + 1
 where code in ('cleaning', 'generic');

------------------------------------------------------ 3. permission areas

update public.app_permissions p
   set label = v.label, description = v.description, area = v.area
  from (values
    ('admin', 'Full administrator',
     'Everything, including adding people and granting permissions.', 'Admin'),
    ('dashboard', 'Dashboard',
     'The main dashboard: today''s work, coverage and the live map.', 'Dashboard'),
    ('insights', 'Reports and tracking',
     'Reports, staff performance, tracking and the vehicle logbook; for a distributor also sales, targets, commissions and warehouse insights.',
     'Reports'),
    ('sales_coverage', 'Customers and territories',
     'The customer list, territories and leads.', 'Customers'),
    ('field_ops', 'Operations',
     'The schedule, the work done in the field, promotions and location exceptions.', 'Operations'),
    ('warehouse', 'Orders and warehouse',
     'Orders, recurring orders, inventory, the warehouse and its setup.', 'Inventory'),
    ('warehouse_approve', 'Approve stock decisions',
     'Approve or reject stock adjustments and stocktakes. Separate from warehouse work on purpose: whoever counts the stock should not be the one who signs off the variance.',
     'Inventory'),
    ('team', 'Team',
     'The list of field staff and the customers each one covers.', 'Team'),
    ('resources', 'Products, forms and files',
     'The shared reference material the team works from.', 'Resources'),
    ('hr', 'Human resources',
     'Employees, attendance, leave, documents, reviews and disciplinary records, including salaries and dates of birth.',
     'People'),
    ('hr_settings', 'HR settings',
     'Working hours, leave types, departments, review and disciplinary vocabularies, and creating HR staff.',
     'People'),
    ('company_settings', 'Company settings',
     'The company''s details, money, emails, words, branding and plan.', 'Admin'),
    ('invoicing', 'Quotes and invoices',
     'Quotes, invoices, credit notes, payments, the price list and who owes you.', 'Finance')
  ) as v(code, label, description, area)
 where p.code = v.code;
