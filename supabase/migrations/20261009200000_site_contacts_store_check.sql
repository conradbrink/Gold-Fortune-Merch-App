-- The site-contacts write rule checks that the site belongs to the contact's
-- company. In 20261009150000 the check read `s.org_id = org_id`, and inside
-- the subquery the bare `org_id` is the store's own column, so it compared the
-- store with itself and always held (CodeRabbit on #107). Nothing could leak:
-- another company's site is invisible to the caller (stores RLS), so the
-- subquery found no row and the write was refused anyway. The rule now names
-- the contact's column, so it stands on its own.
--
-- Rollback: supabase/rollback/20261009200000_site_contacts_store_check.down.sql.

drop policy site_contacts_insert on public.site_contacts;
drop policy site_contacts_update on public.site_contacts;

create policy site_contacts_insert on public.site_contacts for insert to authenticated
  with check (org_id = (select public.current_org_id())
              and ((select public."current_role"()) = 'manager' or (select public.has_permission('company_settings')))
              and exists (select 1 from public.stores s
                           where s.id = site_contacts.store_id and s.org_id = site_contacts.org_id));
create policy site_contacts_update on public.site_contacts for update to authenticated
  using (org_id = (select public.current_org_id())
         and ((select public."current_role"()) = 'manager' or (select public.has_permission('company_settings'))))
  with check (org_id = (select public.current_org_id())
              and exists (select 1 from public.stores s
                           where s.id = site_contacts.store_id and s.org_id = site_contacts.org_id));
