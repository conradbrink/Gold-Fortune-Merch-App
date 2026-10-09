-- Rollback of 20261009200000_site_contacts_store_check: the two write rules
-- exactly as 20261009150000 made them.

drop policy site_contacts_insert on public.site_contacts;
drop policy site_contacts_update on public.site_contacts;

create policy site_contacts_insert on public.site_contacts for insert to authenticated
  with check (org_id = (select public.current_org_id())
              and ((select public."current_role"()) = 'manager' or (select public.has_permission('company_settings')))
              and exists (select 1 from public.stores s where s.id = store_id and s.org_id = org_id));
create policy site_contacts_update on public.site_contacts for update to authenticated
  using (org_id = (select public.current_org_id())
         and ((select public."current_role"()) = 'manager' or (select public.has_permission('company_settings'))))
  with check (org_id = (select public.current_org_id())
              and exists (select 1 from public.stores s where s.id = store_id and s.org_id = org_id));
