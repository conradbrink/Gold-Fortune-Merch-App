-- Rollback for 20261007101108_platform_admin. Drops the operator list and the
-- audit log. ⚠️ Destroys their rows: export `platform_audit_log` first if it
-- has any.

drop table if exists public.platform_audit_log;
drop function if exists public.is_platform_admin();
drop table if exists public.platform_admins;
