-- In-app notifications, built because there were none.
--
-- Section 16 of the brief says "use the existing notification system if one
-- exists". Checked before writing: nothing in `public` stores a notification,
-- the web app has no bell, and the only `notification` in the Flutter code is
-- the Android foreground-service notice that keeps location tracking alive.
-- There was nothing to reuse.
--
-- So: the smallest thing that works. A row per recipient, written by triggers,
-- read by the person it names and nobody else. No email, no push, no digest,
-- no preferences — every one of those is a decision that should be taken when
-- somebody asks for it rather than guessed at now.
--
-- The split between event-driven and time-driven is worth stating plainly,
-- because it is the one place this falls short of the brief. A leave request
-- arriving is an INSERT and a trigger catches it. A contract expiring in seven
-- days is not an event at all — nothing happens in the database on the day it
-- becomes true. Postgres cron is not enabled on this project, so the time-based
-- alerts (documents expiring, contracts expiring, reviews overdue) are produced
-- by `hr_sweep_expiry_notifications()`, which is idempotent per day and is
-- called when the HR dashboard loads. That is not a scheduler and does not
-- pretend to be one: if nobody opens the dashboard, nobody is told. The
-- dashboard shows the same counts directly, so the notification is a
-- convenience rather than the only route to the fact.

create table if not exists public.hr_notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind         text not null,
  title        text not null,
  body         text,
  -- Where to go. Relative to the web app, e.g. /hr/leave?request=<id>.
  href         text,
  subject_type text,
  subject_id   uuid,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists hr_notifications_recipient_idx
  on public.hr_notifications (recipient_id, created_at desc);
create index if not exists hr_notifications_unread_idx
  on public.hr_notifications (recipient_id) where read_at is null;
-- What makes the daily sweep idempotent: one notification per recipient, per
-- kind, per subject, per day. A partial unique index rather than an ON CONFLICT
-- on a wider key, because event-driven notifications must NOT be deduplicated —
-- two leave requests from the same person on the same day are two facts.
-- `created_at::date` is only STABLE — the answer depends on the session's
-- TimeZone — and Postgres refuses a stable expression in an index. Pinning the
-- zone makes it immutable, and UTC is the right pin: the alternative is that
-- the same row indexes differently depending on who is connected.
create unique index if not exists hr_notifications_sweep_once_idx
  on public.hr_notifications
     (recipient_id, kind, subject_id, (((created_at at time zone 'UTC'))::date))
  where subject_id is not null and kind like 'expiry.%';

alter table public.hr_notifications enable row level security;

drop policy if exists hr_notifications_select on public.hr_notifications;
create policy hr_notifications_select on public.hr_notifications
  for select using (recipient_id = (select auth.uid()));

-- Marking as read is the only edit anyone may make. The `with check` repeats
-- the recipient test so a row cannot be reassigned to somebody else on its way
-- through; the trigger below is what stops the title being rewritten.
drop policy if exists hr_notifications_update on public.hr_notifications;
create policy hr_notifications_update on public.hr_notifications
  for update using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

drop policy if exists hr_notifications_delete on public.hr_notifications;
create policy hr_notifications_delete on public.hr_notifications
  for delete using (recipient_id = (select auth.uid()));

-- No INSERT policy, and insert revoked: rows appear only through the security
-- definer helpers below, which is what stops a user notifying their manager
-- that their leave was approved.
revoke insert on public.hr_notifications from authenticated, anon;

create or replace function public.hr_notifications_read_only_edit()
returns trigger
language plpgsql
as $$
begin
  -- Everything except read_at is frozen. Cheaper and clearer than listing the
  -- columns: rebuild the old row with the new read_at and require equality.
  if to_jsonb(new) - 'read_at' is distinct from to_jsonb(old) - 'read_at' then
    raise exception 'a notification can only be marked read';
  end if;
  return new;
end;
$$;

drop trigger if exists hr_notifications_guard on public.hr_notifications;
create trigger hr_notifications_guard before update on public.hr_notifications
  for each row execute function public.hr_notifications_read_only_edit();

/**
 * Send one. Silently does nothing when there is nobody to send to.
 *
 * A null recipient is the normal case, not an error: an employee with no
 * profile has no inbox, and a manager who has not been named on the employee
 * record does not exist to be told. Raising here would abort the leave request
 * that triggered it, which is exactly the wrong trade — the record matters more
 * than the notice about it.
 */
create or replace function public.hr_notify(
  p_org uuid, p_recipient uuid, p_kind text, p_title text,
  p_body text default null, p_href text default null,
  p_subject_type text default null, p_subject_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_recipient is null or p_org is null then return; end if;
  insert into public.hr_notifications
    (org_id, recipient_id, kind, title, body, href, subject_type, subject_id)
  values (p_org, p_recipient, p_kind, p_title, p_body, p_href, p_subject_type, p_subject_id)
  on conflict do nothing;
end;
$$;

/** Everyone who holds the HR brief in this org. */
create or replace function public.hr_notify_hr(
  p_org uuid, p_kind text, p_title text,
  p_body text default null, p_href text default null,
  p_subject_type text default null, p_subject_id uuid default null,
  p_except uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record;
begin
  for r in
    select id from public.profiles
     where org_id = p_org and is_active and role in ('manager', 'hr_manager')
       and (p_except is null or id <> p_except)
  loop
    perform public.hr_notify(p_org, r.id, p_kind, p_title, p_body, p_href, p_subject_type, p_subject_id);
  end loop;
end;
$$;

/** The profile of an employee's line manager, or null. */
create or replace function public.hr_manager_profile_of(p_employee_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.profile_id
    from public.hr_employees e
    join public.hr_employees m on m.id = e.manager_id
   where e.id = p_employee_id
$$;

revoke execute on function public.hr_notify(uuid, uuid, text, text, text, text, text, uuid) from anon, authenticated;
revoke execute on function public.hr_notify_hr(uuid, text, text, text, text, text, uuid, uuid) from anon, authenticated;
revoke execute on function public.hr_manager_profile_of(uuid) from anon;

comment on table public.hr_notifications is
  'In-app notices. Written only by security-definer helpers called from triggers; readable and markable-read by the recipient alone. There was no prior notification system to reuse.';
