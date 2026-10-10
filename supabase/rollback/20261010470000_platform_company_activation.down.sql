-- Rollback of 20261010470000_platform_company_activation: drops the function.
-- It only reads; nothing else depends on it in the database.
drop function if exists public.platform_company_activation(uuid[]);
