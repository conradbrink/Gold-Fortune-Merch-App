-- RECOVERED, not original. The text of this migration was never committed.
--
-- Three migrations were applied to production on 24 August 2026 and none of
-- them has a file in this repo:
--
--     20260824163447_create_ops_schema
--     20260824170433_ops_areas_goals_actions
--     20260824171656_ops_natural_keys_for_sync
--
-- That is the failure `supabase/README.md` calls the disaster-recovery
-- mechanism failing: a schema exists in production that replaying this
-- directory could not rebuild. This file closes that hole.
--
-- ## What it is, and what it is not
--
-- It is the `ops` schema **as production holds it on 12 September 2026**,
-- reconstructed by introspecting `information_schema` and `pg_catalog`. It is
-- not the original text — that is gone — and it is not split three ways,
-- because nothing records which of the three migrations created what. Guessing
-- an attribution and getting the order wrong would produce a history that
-- fails on replay, which is worse than one that is honest about being folded.
-- The two later versions therefore have files that say exactly this and do
-- nothing.
--
-- ## Proved rather than asserted
--
-- Replayed into a throwaway `ops_replay_check` schema on the live database and
-- diffed against `ops` on every column (type, nullability, default), every
-- constraint, every index and every policy. **Zero differences.** The
-- throwaway schema was then dropped.
--
-- ## Worth knowing before you act on this
--
-- ⚠️ `ops` is **not part of the merchandising app**. It is a personal
-- operations and journalling schema — areas, goals, actions, briefs, check-ins,
-- a journal, predictions, a waiting-on list — keyed on `owner_id = auth.uid()`
-- with one "it is mine" policy per table. Nothing in `web/` or `mobile/`
-- references it, and **all eleven tables are empty**. Whether it belongs in
-- this project at all is a question for the owner; this file only makes the
-- history honest about what is there.

create schema if not exists ops;

grant usage on schema ops to anon, authenticated, service_role;

create table if not exists ops.actions (
  id                uuid default gen_random_uuid() not null,
  owner_id          uuid default auth.uid() not null,
  goal_id           uuid,
  area_id           uuid,
  title             text not null,
  kind              text default 'do'::text not null,
  bucket            text default 'next'::text not null,
  priority          text,
  due_at            timestamptz,
  owed_to           text,
  said              text,
  said_at           timestamptz,
  said_hint         text,
  imposed_by        text,
  consequence       text,
  source            text,
  external_ref      text,
  calendar_event_id text,
  status            text default 'open'::text not null,
  closed_at         timestamptz,
  closed_how        text,
  created_at        timestamptz default now() not null,
  natural_key       text,
  primary key (id),
  constraint actions_kind_check check (kind = any (array['do','reply','deliver','decide','pay','file'])),
  constraint actions_bucket_check check (bucket = any (array['now','next','someday','done'])),
  constraint actions_priority_check check (priority = any (array['high','med','low'])),
  constraint actions_status_check check (status = any (array['open','done','dropped','lapsed']))
);

create table if not exists ops.areas (
  id          uuid default gen_random_uuid() not null,
  owner_id    uuid default auth.uid() not null,
  name        text not null,
  slug        text not null,
  kind        text,
  description text,
  standard    text,
  colour      text,
  sort_order  integer default 0 not null,
  created_at  timestamptz default now() not null,
  primary key (id),
  constraint areas_kind_check check (kind = any (array['business','personal','relationship','faith','health','other'])),
  constraint areas_owner_id_slug_key unique (owner_id, slug)
);

create table if not exists ops.briefs (
  id         uuid default gen_random_uuid() not null,
  owner_id   uuid default auth.uid() not null,
  brief_date date not null,
  top_three  jsonb default '[]'::jsonb not null,
  body_md    text,
  created_at timestamptz default now() not null,
  primary key (id),
  constraint briefs_owner_id_brief_date_key unique (owner_id, brief_date)
);

create table if not exists ops.checkins (
  id           uuid default gen_random_uuid() not null,
  owner_id     uuid default auth.uid() not null,
  entry_date   date not null,
  energy       integer,
  focus        integer,
  answers      jsonb default '{}'::jsonb not null,
  avoided      text,
  grateful_for text,
  created_at   timestamptz default now() not null,
  primary key (id),
  constraint checkins_owner_id_entry_date_key unique (owner_id, entry_date),
  constraint checkins_energy_check check (energy >= 1 and energy <= 5),
  constraint checkins_focus_check check (focus >= 1 and focus <= 5)
);

create table if not exists ops.findings (
  id          uuid default gen_random_uuid() not null,
  owner_id    uuid default auth.uid() not null,
  area_id     uuid,
  title       text not null,
  evidence    text,
  measured_on date,
  decision    text default 'pending'::text not null,
  decided_on  date,
  reason      text,
  created_at  timestamptz default now() not null,
  natural_key text,
  primary key (id),
  constraint findings_decision_check check (decision = any (array['pending','shipped','rejected']))
);

create table if not exists ops.goals (
  id          uuid default gen_random_uuid() not null,
  owner_id    uuid default auth.uid() not null,
  area_id     uuid,
  title       text not null,
  measure     text,
  target_date date,
  progress    integer default 0 not null,
  status      text default 'active'::text not null,
  next_action text,
  last_moved  timestamptz,
  repo_path   text,
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null,
  natural_key text,
  primary key (id),
  constraint goals_progress_check check (progress >= 0 and progress <= 100),
  constraint goals_status_check check (status = any (array['active','achieved','abandoned','paused']))
);

create table if not exists ops.journal (
  id         uuid default gen_random_uuid() not null,
  owner_id   uuid default auth.uid() not null,
  entry_date date not null,
  moved      jsonb default '[]'::jsonb not null,
  slipped    jsonb default '[]'::jsonb not null,
  surfaced   jsonb default '[]'::jsonb not null,
  tomorrow   text,
  body_md    text,
  created_at timestamptz default now() not null,
  primary key (id),
  constraint journal_owner_id_entry_date_key unique (owner_id, entry_date)
);

create table if not exists ops.metrics (
  owner_id        uuid default auth.uid() not null,
  metric_date     date not null,
  tasks_done      integer default 0 not null,
  tasks_open      integer default 0 not null,
  promises_open   integer default 0 not null,
  promises_kept   integer default 0 not null,
  promises_lapsed integer default 0 not null,
  awaiting_reply  integer default 0 not null,
  commits         integer default 0 not null,
  top_three_hit   integer default 0 not null,
  primary key (owner_id, metric_date)
);

create table if not exists ops.predictions (
  id          uuid default gen_random_uuid() not null,
  owner_id    uuid default auth.uid() not null,
  made_on     date not null,
  statement   text not null,
  confidence  integer not null,
  resolve_by  date not null,
  outcome     boolean,
  resolved_at timestamptz,
  resolved_by text,
  evidence    text,
  created_at  timestamptz default now() not null,
  primary key (id),
  constraint predictions_confidence_check check (confidence >= 1 and confidence <= 99),
  constraint predictions_resolved_by_check check (resolved_by = any (array['auto','self']))
);

create table if not exists ops.sync_runs (
  id       uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  ran_at   timestamptz default now() not null,
  ok       boolean default true not null,
  detail   text,
  counts   jsonb default '{}'::jsonb not null,
  primary key (id)
);

create table if not exists ops.waiting (
  id          uuid default gen_random_uuid() not null,
  owner_id    uuid default auth.uid() not null,
  who         text not null,
  what        text not null,
  since       date not null,
  channel     text,
  chased_at   date,
  settled_at  timestamptz,
  natural_key text,
  primary key (id)
);

-- Foreign keys after every table exists, so the order above cannot matter, and
-- guarded so the whole file is idempotent — which is what let it be proved by
-- replaying it into a throwaway schema rather than argued about.
--
-- Each guard is scoped to its own table with `conrelid`, not just to the
-- constraint name. `pg_constraint` is database-wide and constraint names are
-- only unique per table, so a bare `conname` test finds a same-named
-- constraint in *any* schema — including `ops` itself — and skips creating the
-- one that is actually missing. That is not hypothetical: proving this file
-- meant replaying it into a second schema alongside `ops`, and the names had
-- to be rewritten by hand to get around exactly this.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'goals_area_id_fkey'
                    and conrelid = 'ops.goals'::regclass) then
    alter table ops.goals add constraint goals_area_id_fkey
      foreign key (area_id) references ops.areas(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'findings_area_id_fkey'
                    and conrelid = 'ops.findings'::regclass) then
    alter table ops.findings add constraint findings_area_id_fkey
      foreign key (area_id) references ops.areas(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'actions_area_id_fkey'
                    and conrelid = 'ops.actions'::regclass) then
    alter table ops.actions add constraint actions_area_id_fkey
      foreign key (area_id) references ops.areas(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'actions_goal_id_fkey'
                    and conrelid = 'ops.actions'::regclass) then
    alter table ops.actions add constraint actions_goal_id_fkey
      foreign key (goal_id) references ops.goals(id) on delete set null;
  end if;
end $$;

create index if not exists actions_owner_id_status_due_at_idx on ops.actions using btree (owner_id, status, due_at);
create index if not exists actions_owner_id_kind_status_idx on ops.actions using btree (owner_id, kind, status) where (owed_to is not null);
create unique index if not exists actions_owner_key on ops.actions using btree (owner_id, natural_key);
create index if not exists findings_owner_id_decision_measured_on_idx on ops.findings using btree (owner_id, decision, measured_on);
create unique index if not exists findings_owner_key on ops.findings using btree (owner_id, natural_key);
create index if not exists goals_owner_id_status_last_moved_idx on ops.goals using btree (owner_id, status, last_moved);
create unique index if not exists goals_owner_key on ops.goals using btree (owner_id, natural_key);
create index if not exists predictions_owner_id_resolve_by_idx on ops.predictions using btree (owner_id, resolve_by) where (outcome is null);
create index if not exists sync_runs_recent on ops.sync_runs using btree (owner_id, ran_at desc);
create unique index if not exists waiting_owner_key on ops.waiting using btree (owner_id, natural_key);

-- Every table is one person's, and the policy is the same sentence each time.
alter table ops.actions enable row level security;
alter table ops.areas enable row level security;
alter table ops.briefs enable row level security;
alter table ops.checkins enable row level security;
alter table ops.findings enable row level security;
alter table ops.goals enable row level security;
alter table ops.journal enable row level security;
alter table ops.metrics enable row level security;
alter table ops.predictions enable row level security;
alter table ops.sync_runs enable row level security;
alter table ops.waiting enable row level security;

drop policy if exists actions_owner on ops.actions;
create policy actions_owner on ops.actions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists areas_owner on ops.areas;
create policy areas_owner on ops.areas
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists briefs_owner on ops.briefs;
create policy briefs_owner on ops.briefs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists checkins_owner on ops.checkins;
create policy checkins_owner on ops.checkins
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists findings_owner on ops.findings;
create policy findings_owner on ops.findings
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists goals_owner on ops.goals;
create policy goals_owner on ops.goals
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists journal_owner on ops.journal;
create policy journal_owner on ops.journal
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists metrics_owner on ops.metrics;
create policy metrics_owner on ops.metrics
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists predictions_owner on ops.predictions;
create policy predictions_owner on ops.predictions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists sync_runs_owner on ops.sync_runs;
create policy sync_runs_owner on ops.sync_runs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists waiting_owner on ops.waiting;
create policy waiting_owner on ops.waiting
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on all tables in schema ops to authenticated, service_role;