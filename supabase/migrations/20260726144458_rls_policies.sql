alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.routes enable row level security;
alter table public.visits enable row level security;
alter table public.form_templates enable row level security;
alter table public.form_fields enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_responses enable row level security;
alter table public.photos enable row level security;

-- organizations: members can read their own org; managers can update it
create policy organizations_select on public.organizations
  for select using (id = public.current_org_id());

create policy organizations_update on public.organizations
  for update using (id = public.current_org_id() and public.current_role() = 'manager');

-- profiles: readable org-wide; users manage their own row, managers manage all in their org
create policy profiles_select on public.profiles
  for select using (org_id = public.current_org_id());

create policy profiles_insert on public.profiles
  for insert with check (
    org_id = public.current_org_id() and public.current_role() = 'manager'
  );

create policy profiles_update on public.profiles
  for update using (
    id = auth.uid()
    or (org_id = public.current_org_id() and public.current_role() = 'manager')
  );

-- stores: org-wide read, manager-only write
create policy stores_select on public.stores
  for select using (org_id = public.current_org_id());

create policy stores_insert on public.stores
  for insert with check (org_id = public.current_org_id() and public.current_role() = 'manager');

create policy stores_update on public.stores
  for update using (org_id = public.current_org_id() and public.current_role() = 'manager');

create policy stores_delete on public.stores
  for delete using (org_id = public.current_org_id() and public.current_role() = 'manager');

-- routes: managers see/manage all in their org; reps see only their own assignments
create policy routes_select on public.routes
  for select using (
    org_id = public.current_org_id()
    and (public.current_role() = 'manager' or rep_id = auth.uid())
  );

create policy routes_insert on public.routes
  for insert with check (org_id = public.current_org_id() and public.current_role() = 'manager');

create policy routes_update on public.routes
  for update using (org_id = public.current_org_id() and public.current_role() = 'manager');

create policy routes_delete on public.routes
  for delete using (org_id = public.current_org_id() and public.current_role() = 'manager');

-- visits: managers see all in org; reps see/manage only their own
create policy visits_select on public.visits
  for select using (
    org_id = public.current_org_id()
    and (public.current_role() = 'manager' or rep_id = auth.uid())
  );

create policy visits_insert on public.visits
  for insert with check (org_id = public.current_org_id() and rep_id = auth.uid());

create policy visits_update on public.visits
  for update using (
    org_id = public.current_org_id()
    and (rep_id = auth.uid() or public.current_role() = 'manager')
  );

-- form_templates: org-wide read, manager-only write
create policy form_templates_select on public.form_templates
  for select using (org_id = public.current_org_id());

create policy form_templates_insert on public.form_templates
  for insert with check (org_id = public.current_org_id() and public.current_role() = 'manager');

create policy form_templates_update on public.form_templates
  for update using (org_id = public.current_org_id() and public.current_role() = 'manager');

create policy form_templates_delete on public.form_templates
  for delete using (org_id = public.current_org_id() and public.current_role() = 'manager');

-- form_fields: scoped via parent template's org
create policy form_fields_select on public.form_fields
  for select using (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = public.current_org_id()
    )
  );

create policy form_fields_write on public.form_fields
  for all using (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = public.current_org_id()
        and public.current_role() = 'manager'
    )
  ) with check (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = public.current_org_id()
        and public.current_role() = 'manager'
    )
  );

-- form_submissions: managers see all in org; reps see/manage only their own
create policy form_submissions_select on public.form_submissions
  for select using (
    org_id = public.current_org_id()
    and (public.current_role() = 'manager' or rep_id = auth.uid())
  );

create policy form_submissions_insert on public.form_submissions
  for insert with check (org_id = public.current_org_id() and rep_id = auth.uid());

create policy form_submissions_update on public.form_submissions
  for update using (org_id = public.current_org_id() and rep_id = auth.uid());

-- form_responses: scoped via parent submission's org/rep
create policy form_responses_select on public.form_responses
  for select using (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = public.current_org_id()
        and (public.current_role() = 'manager' or fs.rep_id = auth.uid())
    )
  );

create policy form_responses_write on public.form_responses
  for all using (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = public.current_org_id()
        and fs.rep_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = public.current_org_id()
        and fs.rep_id = auth.uid()
    )
  );

-- photos: managers see all in org; reps see/manage only their own
create policy photos_select on public.photos
  for select using (
    org_id = public.current_org_id()
    and (public.current_role() = 'manager' or rep_id = auth.uid())
  );

create policy photos_insert on public.photos
  for insert with check (org_id = public.current_org_id() and rep_id = auth.uid());

create policy photos_update on public.photos
  for update using (org_id = public.current_org_id() and rep_id = auth.uid());
