-- Rollback of 20261019190000_rate_limit_left: the function did not exist
-- before, so this removes it and its module assignment. The web falls back to
-- showing the full allowance until the first answer, as before.

delete from public.module_assignments
 where kind = 'function' and name = 'rate_limit_left';

drop function if exists public.rate_limit_left(text, int, int);
