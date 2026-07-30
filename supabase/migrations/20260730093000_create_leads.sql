-- Sales visits to prospects, and the pipeline they feed.
--
-- A scheduled visit and an unscheduled store check-in are both about a store
-- that already exists: they carry a store_id, a geofence and a form. This is
-- the other kind of call — walking into a shop that stocks nothing of ours to
-- ask for a listing. There is no store row to point at, because the whole
-- point is that it is not a customer yet.
--
-- One row is both the visit and the lead it produces. The rep fills the top
-- half on the way in (who, why) and the bottom half on the way out (what
-- happened, what next); the manager then moves it through the pipeline. A
-- separate leads table would have to be kept in step with the visit that
-- created it, for a pipeline that is currently one card per call.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,

  -- Recorded on the way in.
  company_name text not null,
  purpose text not null,
  contact_name text,
  contact_phone text,

  -- Recorded on the way out.
  outcome text,
  notes text,
  follow_up_required boolean not null default false,
  follow_up_on date,

  -- Where the pipeline has got to. Free movement between stages: a lead can go
  -- back to Contacted after a failed follow-up, so this is not a one-way ladder.
  stage text not null default 'new'
    check (stage in ('new', 'contacted', 'follow_up', 'converted', 'lost')),

  -- 'in_progress' until the rep closes it off, so an abandoned call is visible
  -- as an abandoned call rather than as a lead with no outcome.
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed')),

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,

  -- The offline idempotency key every rep-writable table here uses: the sync
  -- upserts on it, so replaying a call whose acknowledgement was lost cannot
  -- create the lead twice.
  client_generated_id uuid not null unique,
  created_at timestamptz not null default now()
);

comment on table public.leads is
  'Unscheduled sales visits to prospects, and the pipeline stage each one is at.';

create index leads_org_stage_idx on public.leads (org_id, stage);
create index leads_rep_idx on public.leads (rep_id, started_at desc);
-- The "what is due" query the follow-up view will ask.
create index leads_follow_up_idx on public.leads (org_id, follow_up_on)
  where follow_up_required and status = 'completed';

/**
 * A follow-up date only means something when a follow-up was asked for.
 *
 * Enforced rather than trusted: the date is what a manager schedules from, and
 * a stale one left behind after the rep unticked the box would put a call in
 * the diary that nobody agreed to.
 */
alter table public.leads
  add constraint leads_follow_up_date_needs_flag
  check (follow_up_on is null or follow_up_required);

/**
 * Where the rep was standing when the call started is evidence, and the person
 * it describes must not be able to revise it afterwards.
 *
 * The same rule visits already carry, for the same reason: null → value is the
 * call being completed, value → anything else is a rewrite. `service_role` and
 * direct SQL are exempt, so a genuine correction stays possible out of band.
 */
create or replace function public.leads_freeze_start()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_setting('role', true) = 'service_role' or auth.uid() is null then
    return new;
  end if;

  if old.started_at is distinct from new.started_at then
    raise exception 'The start time of a sales visit cannot be changed.';
  end if;
  if old.start_lat is not null and new.start_lat is distinct from old.start_lat then
    raise exception 'The recorded position of a sales visit cannot be changed.';
  end if;
  if old.start_lng is not null and new.start_lng is distinct from old.start_lng then
    raise exception 'The recorded position of a sales visit cannot be changed.';
  end if;
  if old.rep_id is distinct from new.rep_id or old.org_id is distinct from new.org_id then
    raise exception 'A sales visit cannot be reassigned.';
  end if;

  return new;
end;
$$;

create trigger leads_freeze_recorded_start
before update on public.leads
for each row execute function public.leads_freeze_start();

-- ------------------------------------------------------------------ RLS

alter table public.leads enable row level security;

-- A rep sees their own calls; a manager sees the organisation's pipeline.
create policy leads_select on public.leads
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'manager'
      or rep_id = (select auth.uid())
    )
  );

-- Pinned to the caller, exactly as visits_insert is: a rep cannot log a call
-- as somebody else.
create policy leads_insert on public.leads
  for insert with check (
    org_id = (select public.current_org_id())
    and rep_id = (select auth.uid())
  );

-- The rep completes their own call; the manager works the pipeline.
create policy leads_update on public.leads
  for update using (
    org_id = (select public.current_org_id())
    and (
      (select public.current_role()) = 'manager'
      or rep_id = (select auth.uid())
    )
  );

-- No delete policy, deliberately. A prospect that was called on is a record of
-- work done, and "Lost" is a stage rather than a reason to erase the visit.
