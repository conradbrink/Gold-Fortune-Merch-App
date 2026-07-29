-- Let a manager close a workday a rep never ended.
--
-- `workday_sessions_update` allows the rep and nobody else, which is right for
-- the ordinary case and leaves no way out of the common one: the app is killed,
-- the phone dies, or the rep simply forgets, and the session stays open with a
-- null `ended_at` and a null `duration_seconds` for ever. It then counts as an
-- open day against every later report, and no one — not the rep, who has moved
-- on, and not the manager, whom RLS refuses — can correct it.
--
-- Two things this deliberately does not do.
--
-- It does not end the day at `now()`. That would credit the rep with every hour
-- between walking away and somebody noticing, which could be days. The day ends
-- at the last position actually recorded, which is the last moment there is any
-- evidence they were working. With no pings at all there is no evidence of any
-- work, so it closes at the start: a zero-length day, which is the honest
-- reading of a session with nothing in it.
--
-- It does not pretend the rep did it. `ended_by` records the manager, so a
-- closed-out day is distinguishable for ever from one the rep ended properly.
-- Without that column the row would simply assert the rep finished at a time
-- they did not, and nothing downstream could tell the difference.
alter table public.workday_sessions
  add column if not exists ended_by uuid
    references public.profiles(id) on delete set null;

comment on column public.workday_sessions.ended_by is
  'Null when the rep ended their own day, which is the normal case. Set to the manager who closed a session the rep abandoned — the day''s end time is then inferred, not reported.';

create or replace function public.close_abandoned_workday(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- A rep on a long day must never be closed out from under themselves. Twelve
  -- hours is past any real shift here while still catching yesterday's ghost
  -- the next morning.
  c_min_age interval := interval '12 hours';

  v_session record;
  v_last_ping timestamptz;
  v_ends_at timestamptz;
  v_result jsonb;
begin
  if public.current_role() is distinct from 'manager' then
    raise exception 'Only a manager can close someone else''s workday.'
      using errcode = '42501';
  end if;

  select ws.id, ws.org_id, ws.rep_id, ws.started_at, ws.ended_at
    into v_session
  from public.workday_sessions ws
  where ws.id = p_session_id;

  if not found then
    raise exception 'That workday no longer exists.' using errcode = 'P0002';
  end if;

  -- current_org_id() is null for a deactivated profile, so a switched-off
  -- manager holding a live session cannot write either.
  if v_session.org_id is distinct from public.current_org_id() then
    raise exception 'That workday belongs to another organisation.'
      using errcode = '42501';
  end if;

  if v_session.ended_at is not null then
    raise exception 'That workday has already been closed.'
      using errcode = '55000';
  end if;

  if v_session.started_at > now() - c_min_age then
    raise exception 'That workday started less than 12 hours ago and may still be in progress.'
      using errcode = '55000';
  end if;

  select max(lp.recorded_at) into v_last_ping
  from public.location_pings lp
  where lp.workday_session_id = v_session.id;

  v_ends_at := coalesce(v_last_ping, v_session.started_at);

  update public.workday_sessions ws
     set ended_at         = v_ends_at,
         ended_by         = auth.uid(),
         duration_seconds = greatest(
           extract(epoch from v_ends_at - ws.started_at)::int, 0)
   where ws.id = v_session.id
     -- Re-checked in the WHERE clause, not just above: two managers looking at
     -- the same stale list must not both close it, and the second one should
     -- be told rather than silently succeeding.
     and ws.ended_at is null
  returning jsonb_build_object(
    'session_id',       ws.id,
    'ended_at',         ws.ended_at,
    'duration_seconds', ws.duration_seconds,
    'inferred_from',    case when v_last_ping is null
                             then 'no positions recorded'
                             else 'last recorded position' end
  ) into v_result;

  if v_result is null then
    raise exception 'That workday was closed by someone else a moment ago.'
      using errcode = '55000';
  end if;

  return v_result;
end;
$$;

comment on function public.close_abandoned_workday is
  'Closes a workday the rep never ended, at the last position recorded rather than at now(), and records which manager closed it. Refuses on a session under 12 hours old, one already closed, or one outside the caller''s org.';

revoke all on function public.close_abandoned_workday(uuid) from public, anon;
grant execute on function public.close_abandoned_workday(uuid) to authenticated;
