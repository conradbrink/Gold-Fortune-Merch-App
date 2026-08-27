-- Gate writing your own working day on the `workday` permission.
--
-- The surprise here is what did NOT need changing. `workday_sessions_insert`
-- and `_update` never tested the role at all — they only ask that the row is
-- yours and in your organisation — so a warehouse clerk could already have
-- written her own working day. Nothing offered her a button, which is the only
-- reason she never had attendance.
--
-- So this adds the permission rather than opening a door: after it, unticking
-- "Start and stop their own day" actually stops somebody, instead of only
-- hiding a control they could have driven from the API anyway. Everyone who
-- writes a workday today — the three reps and the clerk — holds `workday` from
-- their seeded template, so nothing that works stops working.
--
-- `workday_sessions_select` is deliberately left alone. Reading everybody's
-- day belongs to the field-operations permission, which this phase does not
-- enforce in the database yet; converting it here would make
-- `app_permissions.data_enforced` lie about `field_ops`, and that flag is the
-- one thing telling an administrator which tick boxes are real.
--
-- ⚠️ Worth knowing before this feeds an attendance report: a browser gives one
-- position when the button is pressed and nothing in between. There is no
-- trail, so `road_distance_meters` stays null for a web-recorded day — the
-- Routes API needs the five-minute pings only the phone collects. The hours and
-- the start and end positions are real; the distance is simply absent rather
-- than wrong.

drop policy if exists workday_sessions_insert on public.workday_sessions;
create policy workday_sessions_insert on public.workday_sessions
  for insert with check (
    org_id = (select public.current_org_id())
    and rep_id = (select auth.uid())
    and (select public.has_permission('workday'))
  );

drop policy if exists workday_sessions_update on public.workday_sessions;
create policy workday_sessions_update on public.workday_sessions
  for update using (
    org_id = (select public.current_org_id())
    and rep_id = (select auth.uid())
    and (select public.has_permission('workday'))
  );

comment on table public.workday_sessions is
  'One working day per person: start, end, positions and distance. Written by the rep app and, since the permission model, by anyone holding `workday` from the web. A web-recorded day has no location_pings behind it, so its road distance stays null.';
