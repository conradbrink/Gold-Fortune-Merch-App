-- Rollback for short_visits: the function and its module registration.

delete from public.module_assignments where kind = 'function' and name = 'short_visits';

drop function if exists public.short_visits(timestamptz, timestamptz);
