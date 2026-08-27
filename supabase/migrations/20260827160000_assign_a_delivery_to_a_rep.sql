-- A dispatch can be given to a rep, and that rep can see it.
--
-- Deliveries were dispatched to a `driver` — a name, a phone number and a
-- licence, with no login behind it. That models a contracted driver correctly
-- and models the actual arrangement not at all: a rep often runs the drop
-- themselves on their own round, and until now the only way they learned what
-- was coming to their stores was somebody telling them.
--
-- `assigned_rep_id` is deliberately **not** the driver.
--
--   * A driver record has no `profile_id` and cannot get one without turning
--     every contracted driver into a login. Overloading it would mean either
--     inventing accounts for people who do not need them, or a `drivers` row
--     that sometimes means a person and sometimes means a user.
--   * The two answer different questions. `driver_id` is who was carrying the
--     stock — a fact about the consignment that has to stay true forever, and
--     which the delivery history already names. `assigned_rep_id` is whose job
--     this is, which is a decision somebody makes and can change.
--   * A dispatch can have both: a driver drives, a rep is responsible for it
--     arriving and for the shop being happy.
--
-- Null means nobody in particular, which is every dispatch made before today
-- and every one the warehouse handles itself. It is not "unassigned" as an
-- error state — most deliveries never need a rep's name on them.

alter table public.dispatches
  add column if not exists assigned_rep_id uuid references public.profiles(id) on delete set null;

comment on column public.dispatches.assigned_rep_id is
  'The rep responsible for this delivery, when one is. Not the driver — driver_id is who carried it, this is whose job it is. Null is the normal case.';

-- The rep's own list, which is the only query the phone makes.
--
-- Not `concurrently`, deliberately. A concurrent build cannot run inside a
-- transaction, so it would mean a second, non-transactional migration for an
-- index on a table holding 54 rows — the lock is measured in milliseconds and
-- the warehouse is asleep at deploy time. Revisit if `dispatches` ever gets
-- large enough for the build to be worth the split.
create index if not exists dispatches_assigned_rep_idx
  on public.dispatches (assigned_rep_id, status, dispatched_at desc)
  where assigned_rep_id is not null;

-- ---------------------------------------------------------------------------
-- Who can see a dispatch
-- ---------------------------------------------------------------------------
--
-- Widened by exactly one clause. A rep sees a dispatch when it is assigned to
-- them, and nothing else changes.
--
-- 🔴 **These are rewritten from the live policy, not from the migration that
-- created them.** The file that first wrote `dispatches_select` says
-- `current_role() in ('manager','warehouse')`; the policy in the database says
-- `has_permission('warehouse')`, because the permission model converted it in
-- 20260826152506. Copying the original text forward would have silently put the
-- warehouse back on role-based access and undone that conversion — for two
-- tables, quietly, in a migration about something else entirely. Read
-- `pg_policies` before you widen a policy in this schema.
--
-- Not `or rep_id = auth.uid()` on the order behind it, which was the tempting
-- shortcut. That would show a rep every consignment for every order they have
-- ever taken — hundreds of rows they have no job to do about — and would make
-- "assigned to me" mean nothing.

drop policy if exists dispatches_select on public.dispatches;
create policy dispatches_select on public.dispatches
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public.has_permission('warehouse'))
      or assigned_rep_id = (select auth.uid())
    )
  );

drop policy if exists dispatch_lines_select on public.dispatch_lines;
create policy dispatch_lines_select on public.dispatch_lines
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public.has_permission('warehouse'))
      or exists (
        select 1 from public.dispatches d
        where d.id = dispatch_lines.dispatch_id
          and d.assigned_rep_id = (select auth.uid())
      )
    )
  );

-- The order behind an assigned dispatch, so the phone can name the store and
-- the order number. Same shape: one clause added, the rest untouched.
--
-- Worth being explicit about what this grants. A rep assigned somebody else's
-- order can now read that order — the store, the number, the status. That is
-- the point: they are about to drive to that shop with its stock. It does not
-- extend to the order's lines, its pricing or anything else, because nothing
-- here touches `order_lines`.
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public.has_permission('warehouse'))
      or rep_id = (select auth.uid())
      or exists (
        select 1 from public.dispatches d
        where d.order_id = orders.id
          and d.assigned_rep_id = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Who can assign one
-- ---------------------------------------------------------------------------
--
-- The existing update policy governs the rest of the row and is left alone.
-- This is a function rather than a widened policy because the rule is not
-- "may update dispatches" — it is "may hand this specific job to somebody who
-- is actually a rep in this organisation", and a policy cannot check the
-- second half without trusting the value it is checking.

create or replace function public.assign_dispatch_rep(p_dispatch uuid, p_rep uuid)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_org uuid := public.current_org_id();
  v_number text;
  v_role   text;
  v_active boolean;
  -- Scalars, not a record. A plpgsql `record` that was never assigned raises
  -- on any field read, so `coalesce(v_rep.full_name, 'unassigned')` in the
  -- audit line below would have thrown on every *unassign* — the one path with
  -- no rep to look up. Exactly the trap `save_job_role` fell into on 26 August.
  v_rep_name text;
begin
  if not public.has_permission('warehouse') then
    raise exception 'Only the warehouse can assign a delivery.' using errcode = '42501';
  end if;

  select dispatch_number into v_number
    from public.dispatches
   where id = p_dispatch and org_id = v_org;
  if not found then
    raise exception 'That dispatch does not exist.' using errcode = '42501';
  end if;

  -- Clearing it is allowed and is not an error: a delivery reassigned back to
  -- the warehouse is an ordinary thing to do.
  if p_rep is not null then
    select role, is_active, full_name into v_role, v_active, v_rep_name
      from public.profiles where id = p_rep and org_id = v_org;
    if not found then
      raise exception 'That person is not in your organisation.' using errcode = '42501';
    end if;
    if not v_active then
      raise exception 'That account is deactivated.' using errcode = '42501';
    end if;
    -- The base role, not a permission. Mobile access is still decided by
    -- `profiles.role` — see the app's own gate — so assigning a delivery to
    -- somebody who cannot open the app would be a job nobody can be shown.
    if v_role <> 'rep' then
      raise exception '% cannot be given a delivery: only a field rep opens the app.',
        coalesce(v_rep_name, 'That account') using errcode = '42501';
    end if;
  end if;

  update public.dispatches
     set assigned_rep_id = p_rep
   where id = p_dispatch;

  insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
  values (v_org, auth.uid(), 'dispatch.rep_assigned', 'dispatch', p_dispatch,
          jsonb_build_object('dispatch_number', v_number,
                             'rep', coalesce(v_rep_name, 'unassigned')));
end;
$$;

revoke all on function public.assign_dispatch_rep(uuid, uuid) from public, anon;
grant execute on function public.assign_dispatch_rep(uuid, uuid) to authenticated;

comment on function public.assign_dispatch_rep(uuid, uuid) is
  'Gives a dispatch to a field rep, or takes it back with null. Refuses anyone who is not an active rep in the caller''s organisation, because only a rep can open the app the job appears in.';
