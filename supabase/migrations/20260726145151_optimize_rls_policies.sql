-- Drop and recreate all policies wrapping auth.uid()/current_org_id()/current_role()
-- in (select ...) so Postgres evaluates them once per query, not once per row.
-- Also split the form_fields/form_responses FOR ALL "write" policies into
-- separate insert/update/delete policies so they no longer duplicate the
-- select policy (multiple_permissive_policies warning).

drop policy organizations_select on public.organizations;
drop policy organizations_update on public.organizations;
create policy organizations_select on public.organizations
  for select using (id = (select public.current_org_id()));
create policy organizations_update on public.organizations
  for update using (id = (select public.current_org_id()) and (select public.current_role()) = 'manager');

drop policy profiles_select on public.profiles;
drop policy profiles_insert on public.profiles;
drop policy profiles_update on public.profiles;
create policy profiles_select on public.profiles
  for select using (org_id = (select public.current_org_id()));
create policy profiles_insert on public.profiles
  for insert with check (
    org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager'
  );
create policy profiles_update on public.profiles
  for update using (
    id = (select auth.uid())
    or (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager')
  );

drop policy stores_select on public.stores;
drop policy stores_insert on public.stores;
drop policy stores_update on public.stores;
drop policy stores_delete on public.stores;
create policy stores_select on public.stores
  for select using (org_id = (select public.current_org_id()));
create policy stores_insert on public.stores
  for insert with check (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');
create policy stores_update on public.stores
  for update using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');
create policy stores_delete on public.stores
  for delete using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');

drop policy routes_select on public.routes;
drop policy routes_insert on public.routes;
drop policy routes_update on public.routes;
drop policy routes_delete on public.routes;
create policy routes_select on public.routes
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );
create policy routes_insert on public.routes
  for insert with check (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');
create policy routes_update on public.routes
  for update using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');
create policy routes_delete on public.routes
  for delete using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');

drop policy visits_select on public.visits;
drop policy visits_insert on public.visits;
drop policy visits_update on public.visits;
create policy visits_select on public.visits
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );
create policy visits_insert on public.visits
  for insert with check (org_id = (select public.current_org_id()) and rep_id = (select auth.uid()));
create policy visits_update on public.visits
  for update using (
    org_id = (select public.current_org_id())
    and (rep_id = (select auth.uid()) or (select public.current_role()) = 'manager')
  );

drop policy form_templates_select on public.form_templates;
drop policy form_templates_insert on public.form_templates;
drop policy form_templates_update on public.form_templates;
drop policy form_templates_delete on public.form_templates;
create policy form_templates_select on public.form_templates
  for select using (org_id = (select public.current_org_id()));
create policy form_templates_insert on public.form_templates
  for insert with check (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');
create policy form_templates_update on public.form_templates
  for update using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');
create policy form_templates_delete on public.form_templates
  for delete using (org_id = (select public.current_org_id()) and (select public.current_role()) = 'manager');

drop policy form_fields_select on public.form_fields;
drop policy form_fields_write on public.form_fields;
create policy form_fields_select on public.form_fields
  for select using (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = (select public.current_org_id())
    )
  );
create policy form_fields_insert on public.form_fields
  for insert with check (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = (select public.current_org_id())
        and (select public.current_role()) = 'manager'
    )
  );
create policy form_fields_update on public.form_fields
  for update using (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = (select public.current_org_id())
        and (select public.current_role()) = 'manager'
    )
  );
create policy form_fields_delete on public.form_fields
  for delete using (
    exists (
      select 1 from public.form_templates ft
      where ft.id = form_fields.form_template_id
        and ft.org_id = (select public.current_org_id())
        and (select public.current_role()) = 'manager'
    )
  );

drop policy form_submissions_select on public.form_submissions;
drop policy form_submissions_insert on public.form_submissions;
drop policy form_submissions_update on public.form_submissions;
create policy form_submissions_select on public.form_submissions
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );
create policy form_submissions_insert on public.form_submissions
  for insert with check (org_id = (select public.current_org_id()) and rep_id = (select auth.uid()));
create policy form_submissions_update on public.form_submissions
  for update using (org_id = (select public.current_org_id()) and rep_id = (select auth.uid()));

drop policy form_responses_select on public.form_responses;
drop policy form_responses_write on public.form_responses;
create policy form_responses_select on public.form_responses
  for select using (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = (select public.current_org_id())
        and ((select public.current_role()) = 'manager' or fs.rep_id = (select auth.uid()))
    )
  );
create policy form_responses_insert on public.form_responses
  for insert with check (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = (select public.current_org_id())
        and fs.rep_id = (select auth.uid())
    )
  );
create policy form_responses_update on public.form_responses
  for update using (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = (select public.current_org_id())
        and fs.rep_id = (select auth.uid())
    )
  );
create policy form_responses_delete on public.form_responses
  for delete using (
    exists (
      select 1 from public.form_submissions fs
      where fs.id = form_responses.form_submission_id
        and fs.org_id = (select public.current_org_id())
        and fs.rep_id = (select auth.uid())
    )
  );

drop policy photos_select on public.photos;
drop policy photos_insert on public.photos;
drop policy photos_update on public.photos;
create policy photos_select on public.photos
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );
create policy photos_insert on public.photos
  for insert with check (org_id = (select public.current_org_id()) and rep_id = (select auth.uid()));
create policy photos_update on public.photos
  for update using (org_id = (select public.current_org_id()) and rep_id = (select auth.uid()));
