-- Rollback for industry_templates: the catalogue, its module assignments and
-- the two organisation columns go. Run create_company's rollback first.

delete from public.module_assignments
 where kind = 'table' and name in ('industry_templates', 'template_modules', 'template_terminology',
   'template_settings', 'template_job_types', 'template_checklist_items', 'template_forms');

alter table public.organizations drop column template_versions, drop column industries;

drop table public.template_forms;
drop table public.template_checklist_items;
drop table public.template_job_types;
drop table public.template_settings;
drop table public.template_terminology;
drop table public.template_modules;
drop table public.industry_templates;
