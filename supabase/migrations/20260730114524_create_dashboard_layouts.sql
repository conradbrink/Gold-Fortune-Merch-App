-- Which dashboard cards a person wants, and in what order.
--
-- Deliberately *not* a saved-query or report-builder table. What a
-- QuickBooks-style dashboard needs is a catalogue of cards that already know
-- their own query — `dashboard_summary`, `dashboard_operations`, `rep_day_times`
-- and the scorecard family are that catalogue — plus somewhere to record which
-- ones this person keeps and in what order. Storing a *query* per widget would
-- put SQL the user composed inside the security boundary and make every RPC's
-- guarantees unenforceable; storing an id keeps the queries in migrations where
-- they can be reviewed.
--
-- So the only thing here is an ordered list of widget ids. An id the running
-- code does not recognise is ignored rather than rejected, so a widget retired
-- in a later release does not break the page for whoever still has it saved.
create table public.dashboard_layouts (
  -- One layout per person, not per organisation: two managers looking at the
  -- same estate want different things on top.
  user_id uuid primary key references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Order is the array order. Absent from the array = not shown.
  widget_ids text[] not null,
  updated_at timestamptz not null default now(),
  -- A layout is a preference, not a payload. Both of these stop this row being
  -- used as free storage.
  constraint dashboard_layouts_size_check
    check (cardinality(widget_ids) <= 64),
  constraint dashboard_layouts_no_nulls_check
    check (array_position(widget_ids, null) is null)
);

comment on table public.dashboard_layouts is
  'Per-user dashboard composition: an ordered list of widget ids from the registry in web/components/dashboard/widget-registry.tsx.';

alter table public.dashboard_layouts enable row level security;

create policy dashboard_layouts_select on public.dashboard_layouts
  for select using (user_id = (select auth.uid()));

create policy dashboard_layouts_insert on public.dashboard_layouts
  for insert with check (
    user_id = (select auth.uid())
    and org_id = (select public.current_org_id())
  );

-- WITH CHECK stated explicitly rather than left to default to USING. That
-- default is what the `profiles_update` escalation came down to: Postgres reuses
-- the USING expression for the new row, and it tests *who owns the row*, never
-- which columns changed. Here USING keeps a caller on their own row and
-- WITH CHECK keeps the row theirs afterwards — no reassigning it to another user
-- or another organisation.
create policy dashboard_layouts_update on public.dashboard_layouts
  for update using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and org_id = (select public.current_org_id())
  );

-- Deleting is how "reset to the default layout" is expressed: no row means the
-- default, so the reset does not have to hardcode a copy of it.
create policy dashboard_layouts_delete on public.dashboard_layouts
  for delete using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.dashboard_layouts to authenticated;
