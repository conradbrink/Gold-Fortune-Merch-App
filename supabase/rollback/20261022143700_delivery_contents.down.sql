-- Rollback of 20261022143700_delivery_contents.
drop function if exists public.delivery_contents(uuid);
delete from public.module_assignments
 where kind = 'function' and name = 'delivery_contents';
