-- Rollback of 20261025173700_assistant_actions.
drop function if exists public.assistant_action_finish(uuid, boolean, text, uuid);
drop function if exists public.assistant_action_start(uuid, uuid, uuid, text, jsonb);
drop table if exists public.assistant_actions;
delete from public.module_assignments
 where (kind = 'table' and name = 'assistant_actions')
    or (kind = 'function' and name in ('assistant_action_start', 'assistant_action_finish'));
