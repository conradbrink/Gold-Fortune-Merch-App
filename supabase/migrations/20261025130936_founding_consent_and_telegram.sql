-- Two fixes from the code review of the Founding lead alerts (25 Oct 2026).
--
-- contact_consent: the answer to "Tickd may contact me on WhatsApp, phone and
-- email about my pilot" as it was given (true, false, or null when the form
-- didn't ask). The "No" used to be guessed from the role being filled in.
-- Applications already sent: a consent time is a yes; /founding's form (the
-- only one that asks the role) without one is a no.
--
-- telegram_sent_at, telegram_error: how the owner's Telegram ping went, so the
-- applications list shows a lead whose ping never came (it was only in the
-- logs). Both null when the bot wasn't set up, and on older applications.
--
-- Applied 25 Oct 2026. Rollback:
-- supabase/rollback/20261025130936_founding_consent_and_telegram.down.sql.

alter table public.founding_applications
  add column contact_consent boolean,
  add column telegram_sent_at timestamptz,
  add column telegram_error text check (char_length(telegram_error) <= 200);

update public.founding_applications set contact_consent = true where contact_consent_at is not null;
update public.founding_applications set contact_consent = false where contact_consent_at is null and role is not null;

comment on column public.founding_applications.contact_consent is
  'The answer to being contacted about the pilot (/founding, 25 Oct 2026): true, false (they unticked it), or null when not asked.';
comment on column public.founding_applications.telegram_sent_at is
  'When the owner''s Telegram alert about this application was sent; null when it was not (see telegram_error) or the bot was not set up.';
comment on column public.founding_applications.telegram_error is
  'Why the owner''s Telegram alert was not sent, as Telegram said it; null when it was sent or not tried.';
