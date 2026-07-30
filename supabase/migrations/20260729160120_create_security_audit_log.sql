-- An audit trail for the changes that decide who can see what.
--
-- Nothing recorded a role change, a deactivation or a store moving between reps.
-- Those are exactly the events you need after the fact — "who gave this person
-- manager?" is unanswerable today, and the escalation hole closed in
-- 20260729171447 means it was a question worth being able to answer.
--
-- Written by triggers rather than by application code, deliberately. Code that
-- remembers to log is code that eventually forgets, and both the web app and
-- the service-role routes write to these tables — a trigger catches every path
-- including direct SQL.

create table if not exists public.security_events (
  id           bigint generated always as identity primary key,
  org_id       uuid,
  -- Null when the change came from the service role or direct SQL, which is
  -- itself worth knowing: it means it did not come from a signed-in person.
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  subject_type text not null,
  subject_id   uuid,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists security_events_org_time_idx
  on public.security_events (org_id, created_at desc);
create index if not exists security_events_subject_idx
  on public.security_events (subject_type, subject_id);

alter table public.security_events enable row level security;

-- Managers read their own organisation's trail. Nobody writes through the API:
-- there is no INSERT, UPDATE or DELETE policy, so the only way a row appears is
-- a trigger, and the only way one changes is direct SQL by an administrator.
-- An audit log a user can edit is not an audit log.
create policy security_events_select on public.security_events
  for select using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );

revoke insert, update, delete on public.security_events from authenticated, anon;

comment on table public.security_events is
  'Append-only trail of permission-relevant changes. Written by triggers so no code path can forget; readable by managers in the same org; not writable through the API by anyone.';

/**
 * Records changes to the fields that decide access.
 *
 * Only fires on the three that matter — role, is_active and org_id. Ordinary
 * profile edits (name, phone, job title) are noise here and would bury the
 * events worth finding.
 */
create or replace function public.log_profile_security_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if new.role is distinct from old.role then
    v_changes := v_changes || jsonb_build_object('role',
      jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  if new.is_active is distinct from old.is_active then
    v_changes := v_changes || jsonb_build_object('is_active',
      jsonb_build_object('from', old.is_active, 'to', new.is_active));
  end if;
  if new.org_id is distinct from old.org_id then
    v_changes := v_changes || jsonb_build_object('org_id',
      jsonb_build_object('from', old.org_id, 'to', new.org_id));
  end if;

  if v_changes = '{}'::jsonb then
    return new;
  end if;

  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (
    coalesce(new.org_id, old.org_id),
    auth.uid(),
    'profile.permissions_changed',
    'profile',
    new.id,
    v_changes || jsonb_build_object(
      'subject_name', new.full_name,
      -- Names the connection role, so a change made with the service key is
      -- distinguishable from one made by a signed-in manager.
      'via', current_user
    )
  );
  return new;
end;
$$;

drop trigger if exists profiles_log_security_change on public.profiles;
create trigger profiles_log_security_change
  after update on public.profiles
  for each row execute function public.log_profile_security_change();

/**
 * Records a store moving into or out of a rep's patch.
 *
 * Coverage decides which files a rep can see through the chain audience, so an
 * assignment is a permission change as much as a scheduling one.
 */
create or replace function public.log_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  v_row := coalesce(new, old);
  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (
    v_row.org_id,
    auth.uid(),
    case when tg_op = 'INSERT' then 'store.assigned' else 'store.unassigned' end,
    'store',
    v_row.store_id,
    jsonb_build_object('rep_id', v_row.rep_id, 'via', current_user)
  );
  return v_row;
end;
$$;

drop trigger if exists store_assignments_log_change on public.store_assignments;
create trigger store_assignments_log_change
  after insert or delete on public.store_assignments
  for each row execute function public.log_assignment_change();

comment on function public.log_profile_security_change is
  'Audit trigger. Fires only for role, is_active and org_id — the fields that decide access. Ordinary profile edits would bury the events worth finding.';
comment on function public.log_assignment_change is
  'Audit trigger for store coverage, which is a permission change as much as a scheduling one: chain-audience files follow the stores a rep covers.';
