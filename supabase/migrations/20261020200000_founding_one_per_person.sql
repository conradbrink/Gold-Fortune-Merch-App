-- One Founding application per person (owner, 20 Oct 2026): a WhatsApp number
-- or an email address can be on one application only. The app looks first and
-- answers "already applied" (web/app/api/founding/route.ts); these indexes stop
-- two arriving at the same moment (it answers the same on 23505).
--
-- Applications from before today keep their repeats (6 numbers and 5 email
-- addresses appear twice): the indexes cover only rows made from 20 Oct 2026
-- 17:00 UTC, and the app's lookup covers the older ones. whatsapp is stored
-- as digits and email in lower case by the app, so these compare like for like.
--
-- Rollback: supabase/rollback/20261020200000_founding_one_per_person.down.sql.

create unique index founding_applications_one_per_number
  on public.founding_applications (whatsapp)
  where created_at >= timestamptz '2026-10-20 17:00:00+00';

create unique index founding_applications_one_per_email
  on public.founding_applications (lower(email))
  where email is not null and created_at >= timestamptz '2026-10-20 17:00:00+00';
