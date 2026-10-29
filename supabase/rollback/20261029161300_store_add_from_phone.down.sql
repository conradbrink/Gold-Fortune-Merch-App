-- Rollback of 20261029161300_store_add_from_phone. Customers it added stay:
-- orders and visits point at them.

delete from public.module_assignments
 where kind = 'function' and name = 'store_add_from_phone';

drop function if exists public.store_add_from_phone(
  uuid, text, text, text, double precision, double precision, double precision, uuid);
