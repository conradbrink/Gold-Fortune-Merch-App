-- Founding applications: the company made from each one.
--
-- Why: the owner's Control Centre (10 Oct 2026) must answer "where did our
-- customers come from?" An application records how the applicant found us
-- (attribution); the operator then creates their company by hand. Nothing tied
-- the two together, so the funnel stopped at "applied". The operator now links
-- an application to its company on /platform/founding, and the Acquisition
-- pages follow the link: applied -> company set up -> free period -> paying.
--
--   organization_id  the company made from this application, or null. One
--                    company per application and one application per company
--                    (a unique index; nulls are many). Deleting the company
--                    leaves the application and clears the link.
--
-- Grants and RLS unchanged: the service role only. Every link and unlink is
-- written to platform_audit_log by the operator action (app/platform/actions.ts).
--
-- Rollback: supabase/rollback/20261010430000_founding_application_company.down.sql.

alter table public.founding_applications
  add column organization_id uuid references public.organizations(id) on delete set null;

create unique index founding_applications_organization_idx
  on public.founding_applications (organization_id)
  where organization_id is not null;

comment on column public.founding_applications.organization_id is
  'The company the operator made from this application (linked on /platform/founding). Null until linked; cleared if the company is deleted.';
