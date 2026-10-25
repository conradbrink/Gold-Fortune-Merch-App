-- Rollback of founding_consent_and_telegram. The consent answer goes back to
-- being read from contact_consent_at and the role; the Telegram notes are lost.

alter table public.founding_applications
  drop column telegram_error,
  drop column telegram_sent_at,
  drop column contact_consent;
