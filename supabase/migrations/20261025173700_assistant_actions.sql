-- A record of the changes the AI Manager makes (owner, 25 Oct 2026: "Keep a
-- record").
--
-- The AI Manager can now do things in the app for a person. It drafts a card
-- of exactly what will change, and the change is made only when the person
-- presses its button (web: /api/assistant/act). This keeps one row per card:
--   * who pressed it;
--   * which action;
--   * what it was asked to change (the card's input);
--   * how it ended.
-- Never the chat: questions are still not stored.
--
-- Only the server writes it. The route reads who is asking and their company
-- with the person's own session, then starts and finishes the record with the
-- service role. Nobody signed in can write a row of their own, so a row is
-- one the route wrote: proof of what was pressed, and words that come only
-- from the app. Those words are read back to a manager's AI Manager.
--
--   * `assistant_action_start` refuses before anything is changed, in these
--     cases:
--       - a person who isn't active at the company;
--       - a closed or read-only company (with the billing gate's words and
--         its hint `read_only`);
--       - more than 200 starts an hour from one person (locked per person,
--         so a burst can't slip past).
--     The route makes no change if the record can't be started.
--   * One record per card (`draft_id`), so a card's change is made once
--     however often its button reaches the route: a lost answer, a second
--     press, a reopened chat.
--       - A card already done answers with its result.
--       - A card still under way is refused.
--       - A card that was tried and not done may be tried again, on the same
--         row.
--   * `assistant_action_finish` says how it ended, once.
--   * Managers read their own company's rows. The service role reads them
--     for the Control Centre.
--   * A row outlives the person: when the person is removed, `user_id` is
--     cleared and `person_name` still says who it was.
--
-- Core: the AI Manager is in every plan.
--
-- Rollback: supabase/rollback/20261025173700_assistant_actions.down.sql.
-- Tests: supabase/tests/assistant_actions.sql.

create table public.assistant_actions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  -- Who it was, as named when they pressed it.
  person_name text check (person_name is null or char_length(person_name) <= 200),
  -- The card. One record, and one change, per card.
  draft_id    uuid not null unique,
  action      text not null check (action ~ '^[a-z_]{1,60}$'),
  -- What the card asked to change, as its button sent it (ids, names, dates).
  input       jsonb not null check (octet_length(input::text) <= 1048576),
  -- Null until it has finished: true done, false not done.
  ok          boolean,
  result      text check (result is null or char_length(result) <= 2000),
  -- What it made or changed, when there is one row to point at.
  target_id   uuid,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
comment on table public.assistant_actions is
  'One row per AI Manager card a person pressed: who, which action, what it was asked to change, how it ended. Written only by the server (service role). Never the chat.';

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

-- Starts a card's record, or answers for the card's record already there.
-- p_org and p_user are the company and the person the route read with the
-- person's own session; they are checked here again.
create function public.assistant_action_start(
  p_org uuid, p_user uuid, p_draft uuid, p_action text, p_input jsonb
)
returns table (record_id uuid, fresh boolean, was_ok boolean, was_result text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_name text;
  r      record;
  v_id   uuid;
begin
  if p_org is null or p_user is null or p_draft is null then
    raise exception 'Who, which company and which card are all needed.' using errcode = '22023';
  end if;
  if p_action is null or p_action !~ '^[a-z_]{1,60}$' then
    raise exception 'That is not a change the AI Manager makes.' using errcode = '22023';
  end if;
  if p_input is null or octet_length(p_input::text) > 1048576 then
    raise exception 'That change is too big to record.' using errcode = '22023';
  end if;

  select p.full_name into v_name
    from public.profiles p
   where p.id = p_user and p.org_id = p_org and p.is_active;
  if not found then
    raise exception 'Sign in to your company to make changes.' using errcode = '42501';
  end if;
  if exists (select 1 from public.company_account a where a.org_id = p_org and a.closed_at is not null) then
    raise exception 'This company is closed.' using errcode = '42501';
  end if;
  -- The billing gate's own words and hint (require_writable), for a company
  -- the person's session would find read-only.
  if exists (select 1 from public.company_account a
              where a.org_id = p_org and a.status in ('read_only', 'cancelled')) then
    raise exception 'Your company''s account is read-only until the plan is paid.'
      using errcode = '42501', hint = 'read_only';
  end if;

  -- One person's presses one at a time: the card's record and the hourly
  -- count are both read and written under it.
  perform pg_advisory_xact_lock(hashtextextended('assistant_actions:' || p_user::text, 0));

  select a.id, a.user_id, a.org_id, a.ok, a.result into r
    from public.assistant_actions a
   where a.draft_id = p_draft;
  if found then
    if r.user_id is distinct from p_user or r.org_id <> p_org then
      raise exception 'That card is not yours.' using errcode = '42501';
    end if;
    if r.ok is false then
      -- Tried and not done: tried again, on the same record.
      update public.assistant_actions
         set ok = null, result = null, target_id = null, finished_at = null,
             action = p_action, input = p_input, person_name = v_name
       where id = r.id;
      return query select r.id, true, null::boolean, null::text;
      return;
    end if;
    -- Done, or still under way: answered, never made twice.
    return query select r.id, false, r.ok, r.result;
    return;
  end if;

  -- The web allows 30 an hour; this is the database's own ceiling.
  if (select count(*) from public.assistant_actions a
       where a.user_id = p_user and a.created_at > now() - interval '1 hour') >= 200 then
    raise exception 'Too many changes in the last hour. Try again later.' using errcode = '54000';
  end if;

  insert into public.assistant_actions (org_id, user_id, person_name, draft_id, action, input)
  values (p_org, p_user, v_name, p_draft, p_action, p_input)
  returning id into v_id;
  return query select v_id, true, null::boolean, null::text;
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
     and finished_at is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'That record has finished already, or is not there.' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.assistant_action_start(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.assistant_action_finish(uuid, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.assistant_action_start(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.assistant_action_finish(uuid, boolean, text, uuid) to service_role;
