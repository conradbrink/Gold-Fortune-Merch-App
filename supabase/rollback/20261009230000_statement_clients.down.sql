-- Rollback of 20261009230000_statement_clients: the two functions out again.

delete from public.module_assignments
 where kind = 'function' and name in ('statement_clients', 'statement_clients_json');

drop function if exists public.statement_clients_json(date);
drop function if exists public.statement_clients(date);
