-- Rollback of 20261010510000_platform_system_health: drops the function. It only reads.
drop function if exists public.platform_system_health();
