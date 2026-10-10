-- Rollback of 20261010430000_founding_application_company: drops the link (and
-- its index). The applications and companies themselves are untouched.
drop index if exists public.founding_applications_organization_idx;
alter table public.founding_applications drop column if exists organization_id;
