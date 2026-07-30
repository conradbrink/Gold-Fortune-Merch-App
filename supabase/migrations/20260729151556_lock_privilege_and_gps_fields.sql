-- Two holes found by audit, both confirmed by exploiting them against the live
-- database inside a rolled-back transaction.
--
-- ## 1. Any rep could make themselves a manager (critical)
--
-- `profiles_update` reads:
--
--     using (id = auth.uid() or (org_id = current_org_id() and current_role() = 'manager'))
--
-- with no `with check`, so Postgres reuses the `using` expression for the new
-- row. That tests *who owns the row*, never *which columns changed* — and a rep
-- setting `role = 'manager'` on their own row still satisfies `id = auth.uid()`.
-- One PostgREST call was enough:
--
--     PATCH /rest/v1/profiles?id=eq.<own id>   {"role":"manager"}
--
-- Confirmed: role came back 'manager'. From there they read every visit, GPS
-- trail, photo and store in the organisation, and can write to all of them.
--
-- The same path let a rep flip their own `is_active` back to true after being
-- deactivated (the RLS helpers return null for an inactive profile, which stops
-- them *reading*, but `id = auth.uid()` still allowed the write), and change
-- their own `org_id` to any organisation whose id they could learn.
--
-- RLS cannot express "these columns are read-only" — a policy sees the whole
-- row, not the diff. Column privileges can, so the fix is to take UPDATE away
-- at the column level and hand back only the fields a person may edit about
-- themselves. `service_role` is unaffected, which is what matters: deactivation
-- already runs through `/api/reps/[id]`, which uses the service key and also
-- bans the auth user, and rep creation runs through `/api/reps/invite`, which
-- sets `role` server-side after verifying the caller is a manager.
--
-- Anything that needs to change a role from now on must go through a server
-- route that checks the caller, not through the table.

revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;

-- The fields a person may legitimately change about themselves or, as a
-- manager, about a rep. Everything omitted here — id, org_id, role, is_active,
-- email, created_at — is now server-controlled.
grant update (full_name, phone, job_title) on public.profiles to authenticated;

comment on column public.profiles.role is
  'Server-controlled. UPDATE is revoked from `authenticated` at column level; changing it requires the service role via a route that verifies the caller is a manager. A policy cannot enforce this — RLS sees the row, not which columns changed.';
comment on column public.profiles.is_active is
  'Server-controlled, and paired with an auth ban in /api/reps/[id]. Revoking the column stops a deactivated user simply setting it back to true.';
comment on column public.profiles.org_id is
  'Server-controlled. It is the tenancy boundary every policy is built on, so a user must never be able to move themselves between organisations.';

-- ## 2. A rep could rewrite their own GPS history (high)
--
-- `visits_update` allows a rep to update their own rows, which they must be
-- able to do — a check-out writes `checkout_at` and its coordinates onto the
-- row created at check-in. But the same policy let them go back afterwards and
-- move `checkin_lat`/`checkin_lng`, change `checkin_at`, or rewrite
-- `checkin_distance_from_store_m`. Confirmed: an off-site check-in recorded at
-- 4,200 m was edited to 5 m.
--
-- Every geofencing claim in this product rests on those columns. If the person
-- being measured can edit the measurement afterwards, the activity feed's
-- "off site" verdict, the rep scorecard's verified rate and the whole audit
-- trail mean nothing.
--
-- Recorded once, then frozen: null to a value is allowed, because that is the
-- check-out completing a row the check-in opened. A value to a *different*
-- value is refused. Nulling a recorded value out is refused too — that would
-- erase the evidence rather than alter it.
create or replace function public.freeze_recorded_position()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- The service role and direct SQL are exempt: a manager correcting genuinely
  -- broken data is a deliberate, logged, out-of-band act, not something the
  -- field app can do.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if old.checkin_at is not null and new.checkin_at is distinct from old.checkin_at then
    raise exception 'A recorded check-in time cannot be changed.' using errcode = '42501';
  end if;
  if old.checkin_lat is not null and new.checkin_lat is distinct from old.checkin_lat then
    raise exception 'A recorded check-in position cannot be changed.' using errcode = '42501';
  end if;
  if old.checkin_lng is not null and new.checkin_lng is distinct from old.checkin_lng then
    raise exception 'A recorded check-in position cannot be changed.' using errcode = '42501';
  end if;
  if old.checkin_distance_from_store_m is not null
     and new.checkin_distance_from_store_m is distinct from old.checkin_distance_from_store_m then
    raise exception 'A recorded check-in distance cannot be changed.' using errcode = '42501';
  end if;
  if old.checkin_gps_accuracy_m is not null
     and new.checkin_gps_accuracy_m is distinct from old.checkin_gps_accuracy_m then
    raise exception 'A recorded GPS accuracy cannot be changed.' using errcode = '42501';
  end if;

  if old.checkout_at is not null and new.checkout_at is distinct from old.checkout_at then
    raise exception 'A recorded check-out time cannot be changed.' using errcode = '42501';
  end if;
  if old.checkout_lat is not null and new.checkout_lat is distinct from old.checkout_lat then
    raise exception 'A recorded check-out position cannot be changed.' using errcode = '42501';
  end if;
  if old.checkout_lng is not null and new.checkout_lng is distinct from old.checkout_lng then
    raise exception 'A recorded check-out position cannot be changed.' using errcode = '42501';
  end if;

  -- Ownership and tenancy are set once, at insert, under a policy that pins
  -- them to the caller. Nothing should move a visit between reps, stores or
  -- organisations afterwards.
  if new.org_id is distinct from old.org_id
     or new.rep_id is distinct from old.rep_id
     or new.store_id is distinct from old.store_id then
    raise exception 'A visit cannot be reassigned after it is created.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists visits_freeze_recorded_position on public.visits;
create trigger visits_freeze_recorded_position
  before update on public.visits
  for each row execute function public.freeze_recorded_position();

comment on function public.freeze_recorded_position is
  'Makes a recorded GPS position and its timestamps write-once. A check-out may fill a null column; nothing may change or erase a value already there. Without this, the person being measured could edit the measurement.';
