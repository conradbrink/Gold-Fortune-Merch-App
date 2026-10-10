-- Rollback of 20261010573000_platform_module_usage: drops the function. It only reads.
drop function if exists public.platform_module_usage(timestamptz, timestamptz);
