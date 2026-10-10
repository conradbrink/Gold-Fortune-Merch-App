-- Rollback of 20261010410000_founding_attribution: drops the column and
-- whatever attribution it holds. The applications themselves are untouched.
alter table public.founding_applications drop column if exists attribution;
