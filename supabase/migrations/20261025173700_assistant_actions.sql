-- A record of the changes the AI Manager makes (owner, 25 Oct 2026: "Keep a
-- record").
--
-- The AI Manager can now do things in the app for a person: it drafts a card
-- of exactly what will change, and the change is made only when the person
-- presses its button (web: /api/assistant/act). This keeps one row per press:
-- who pressed it, which action, what it was asked to change (the card's
-- input), and how it ended. Never the chat: questions are still not stored.
--
--   * `assistant_action_start` writes the row before the change is made, and
--     the web makes no change if it can't. It takes the company and the
--     person from the session, never from the caller, and refuses a
--     read-only company (require_writable), an inactive person or a closed
--     company, and more than 200 starts an hour from one person.
--   * `assistant_action_finish` says how it ended (done, or not and why), and
--     only for the person's own row, once.
--   * Managers read their own company's rows; nobody writes the table
--     directly. The service role reads it for the Control Centre.
--
-- Core: the AI Manager is in every plan.
--
-- Rollback: supabase/rollback/20261025173700_assistant_actions.down.sql.
-- Tests: supabase/tests/assistant_actions.sql.

create table public.assistant_actions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  action      text not null check (action ~ '^[a-z_]{1,60}$'),
  -- What the card asked to change, as its button sent it (ids, names, dates).
  input       jsonb not null check (octet_length(input::text) <= 262144),
  -- Null until it has finished: true done, false not done.
  ok          boolean,
  result      text check (result is null or char_length(result) <= 2000),
  -- What it made or changed, when there is one row to point at.
  target_id   uuid,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
comment on table public.assistant_actions is
  'One row per change the AI Manager made for a person when they pressed its card''s button: who, which action, what it was asked to change, how it ended. Never the chat.';

create index assistant_actions_org_created on public.assistant_actions (org_id, created_at desc);
create index assistant_actions_user_created on public.assistant_actions (user_id, created_at desc);

alter table public.assistant_actions enable row level security;
revoke all on public.assistant_actions from public, anon, authenticated;
grant select on public.assistant_actions to authenticated;
grant select, insert, update, delete on public.assistant_actions to service_role;

create policy assistant_actions_select on public.assistant_actions
  for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'assistant_actions', 'core'),
  ('function', 'assistant_action_start', 'core'),
  ('function', 'assistant_action_finish', 'core')
on conflict do nothing;

create function public.assistant_action_start(p_action text, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_org  uuid := public.current_org_id();
  v_id   uuid;
begin
  -- current_role() is null for an inactive person or a closed company.
  if v_user is null or v_org is null or public.current_role() is null then
    raise exception 'Sign in to your company to make changes.' using errcode = '42501';
  end if;
  perform public.require_writable();
  if p_action is null or p_action !~ '^[a-z_]{1,60}$' then
    raise exception 'That is not a change the AI Manager makes.' using errcode = '22023';
  end if;
  if p_input is null or octet_length(p_input::text) > 262144 then
    raise exception 'That change is too big to record.' using errcode = '22023';
  end if;
  -- The web allows 30 an hour; this stops a caller going round it.
  if (select count(*) from public.assistant_actions
       where user_id = v_user and created_at > now() - interval '1 hour') >= 200 then
    raise exception 'Too many changes in the last hour. Try again later.' using errcode = '54000';
  end if;

  insert into public.assistant_actions (org_id, user_id, action, input)
  values (v_org, v_user, p_action, p_input)
  returning id into v_id;
  return v_id;
end;
$function$;

create function public.assistant_action_finish(p_id uuid, p_ok boolean, p_result text, p_target uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n integer;
begin
  if p_ok is null then
    raise exception 'Say whether the change was made.' using errcode = '22023';
  end if;
  update public.assistant_actions
     set ok = p_ok,
         result = left(p_result, 2000),
         target_id = p_target,
         finished_at = now()
   where id = p_id
     and user_id = auth.uid()
     and finished_at is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'That record is not yours to finish, or it has finished.' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.assistant_action_start(text, jsonb) from public, anon;
revoke all on function public.assistant_action_finish(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.assistant_action_start(text, jsonb) to authenticated;
grant execute on function public.assistant_action_finish(uuid, boolean, text, uuid) to authenticated;
