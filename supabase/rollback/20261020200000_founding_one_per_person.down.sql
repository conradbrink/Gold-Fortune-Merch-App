-- Rollback of 20261020200000_founding_one_per_person.
drop index if exists public.founding_applications_one_per_email;
drop index if exists public.founding_applications_one_per_number;
