-- Rollback of 20261015100000_store_reorder: the function, its module
-- registration, the reorder_after_days setting and the dashboard card go.

delete from public.module_assignments where kind = 'function' and name = 'store_reorder';
drop function public.store_reorder();

delete from public.company_settings where key = 'reorder_after_days';
delete from public.setting_definitions where key = 'reorder_after_days';

update public.template_settings
   set value = to_jsonb(array_to_string(array_remove(string_to_array(value #>> '{}', ','), 'store_reorder'), ','))
 where setting_key = 'dashboard_layout' and 'store_reorder' = any (string_to_array(value #>> '{}', ','));
update public.company_settings
   set value = to_jsonb(array_to_string(array_remove(string_to_array(value #>> '{}', ','), 'store_reorder'), ','))
 where key = 'dashboard_layout' and 'store_reorder' = any (string_to_array(value #>> '{}', ','));
update public.setting_definitions
   set default_value = to_jsonb(array_to_string(array_remove(string_to_array(default_value #>> '{}', ','), 'store_reorder'), ','))
 where key = 'dashboard_layout' and 'store_reorder' = any (string_to_array(default_value #>> '{}', ','));
