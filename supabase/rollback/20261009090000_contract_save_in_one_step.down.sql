-- Rollback of 20261009090000_contract_save_in_one_step: the one-step save out
-- again. The web then needs the two-step save of 20261008233000.

delete from public.module_assignments where kind = 'function' and name = 'contract_save';
drop function if exists public.contract_save(uuid, jsonb, jsonb);
