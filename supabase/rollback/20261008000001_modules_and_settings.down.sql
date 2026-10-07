-- Rollback for modules_and_settings. Drops everything it created. ⚠️ Destroys
-- every company's module switches and settings: export `company_modules` and
-- `company_settings` first if they have been edited since. Roll back
-- `enforce_modules` and `per_company_auto_end_and_thresholds` before this one;
-- both depend on these helpers.

drop trigger if exists organizations_provision_modules on public.organizations;
drop function if exists public.provision_company_modules();

drop function if exists public.my_company_config();
drop function if exists public.org_setting(uuid, text);
drop function if exists public.company_setting(text);
drop function if exists public.require_module(text);
drop function if exists public.module_enabled(text);

drop table if exists public.company_settings;
drop table if exists public.company_modules;
drop function if exists public.company_settings_validate();
drop function if exists public.company_modules_guard();
drop table if exists public.setting_definitions;
drop table if exists public.module_dependencies;
drop table if exists public.modules;
