-- Founding applications: where the applicant first came from.
--
-- Why: the owner (10 Oct 2026) wants to know which adverts, sites and pages
-- bring the businesses that become customers. Google Analytics counts the
-- anonymous visits; it cannot say which visitor became which company. The
-- sales site therefore keeps the first visit's UTM tags, the other site's host
-- name, the first page and the kind of ad click in the visitor's browser, and
-- sends them only with an application: the point where an anonymous visitor
-- becomes someone we know. The app checks them (lib/founding.ts
-- checkAttribution) and saves them here.
--
--   attribution  jsonb object, or null when nothing is known. Keys the app
--                writes: utm_source, utm_medium, utm_campaign, utm_content,
--                utm_term, referrer (host only), landing_page (path only),
--                click_id ('gclid' | 'fbclid' | 'msclkid' | 'ttclid', the
--                kind of click, never its ID), first_seen_at.
--
-- The table's grants and RLS are unchanged: the service role only.
--
-- Rollback: supabase/rollback/20261010410000_founding_attribution.down.sql.

alter table public.founding_applications
  add column attribution jsonb
    check (attribution is null or (jsonb_typeof(attribution) = 'object' and pg_column_size(attribution) <= 4096));

comment on column public.founding_applications.attribution is
  'Where the applicant first came from (UTM tags, referring host, first page, kind of ad click, first seen), as the sales site recorded it in the visitor''s browser and sent with the application. Null when unknown.';
