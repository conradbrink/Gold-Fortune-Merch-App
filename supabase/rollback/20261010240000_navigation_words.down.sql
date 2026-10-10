-- Rollback of 20261010240000_navigation_words: the words as production had
-- them on 10 Oct 2026 (read before applying).

update public.term_definitions
   set singular = 'Area', plural = 'Areas'
 where key = 'territory';

-- Every company on "Territory" goes back to "Area", except Gold Fortune, which
-- chose "Territory" itself (its Distribution template's word). A company
-- created after the migration got "Territory" from the new default, and goes
-- back with it.
update public.company_terminology
   set singular = 'Area', plural = 'Areas'
 where key = 'territory' and singular = 'Territory' and plural = 'Territories'
   and org_id <> '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';

update public.template_terminology
   set singular = 'Clean', plural = 'Cleans'
 where template_code = 'cleaning' and term_key = 'job';

update public.template_terminology
   set singular = 'Today''s cleans', plural = 'Today''s cleans'
 where template_code = 'cleaning' and term_key = 'day_plan';

delete from public.template_terminology
 where template_code = 'generic' and term_key = 'site';

update public.industry_templates set version = version - 1
 where code in ('cleaning', 'generic');

update public.app_permissions p
   set label = v.label, description = v.description, area = v.area
  from (values
    ('admin', 'Full administrator',
     'Everything, including creating people and granting permissions.', 'Administration'),
    ('dashboard', 'Dashboard',
     'The main dashboard: visits, coverage, the live rep map and the working day.', 'Overview'),
    ('insights', 'Sales and reports',
     'Sales, Reports and Warehouse insights — commercial and staff performance.', 'Insights'),
    ('sales_coverage', 'Leads, stores and territories',
     'The customer estate and who covers it.', 'Sales & Coverage'),
    ('field_ops', 'Field operations',
     'Schedule, Visits & Activities, Promotions, and the store GPS review queue.', 'Field Operations'),
    ('warehouse', 'Warehouse and fulfilment',
     'Warehouse, Orders, Inventory and warehouse setup.', 'Warehouse & Fulfilment'),
    ('warehouse_approve', 'Approve stock decisions',
     'Approve or reject stock adjustments and stocktakes. Separate from warehouse work on purpose: whoever counts the stock should not be the one who signs off the variance.',
     'Warehouse & Fulfilment'),
    ('team', 'Representatives',
     'The rep directory and store assignments.', 'Team'),
    ('resources', 'Products, forms and files',
     'The shared reference material reps work from.', 'Resources'),
    ('hr', 'Human resources',
     'Employees, attendance, leave, documents, reviews and disciplinary records — including salaries and dates of birth.',
     'Human Resources'),
    ('hr_settings', 'HR settings',
     'Working hours, leave types, departments, review and disciplinary vocabularies, and creating HR staff.',
     'Human Resources'),
    ('company_settings', 'Company settings',
     'The organisation profile, VAT rate and timezone.', 'Administration'),
    ('invoicing', 'Quotes and invoices',
     'Quotes, invoices, credit notes, payments, the price list and who owes you.', 'Money')
  ) as v(code, label, description, area)
 where p.code = v.code;
