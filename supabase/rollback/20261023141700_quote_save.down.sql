-- Rollback of 20261023141700_quote_save.
drop function if exists public.quote_save(uuid, timestamptz, jsonb, jsonb);
delete from public.module_assignments
 where kind = 'function' and name = 'quote_save';
