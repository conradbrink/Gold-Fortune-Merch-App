-- Founding 10: a much shorter application form.
--
-- Why: on 11 Oct 2026 the ads sent 80 people to the site and none applied; the
-- one visitor who started the form left after 11 seconds. The owner cut the
-- form to the applicant's first and last name, email, the business's name, how
-- many staff, and the WhatsApp number to reach them on. No longer asked: type
-- of work, town, how they run jobs, what costs them the most, the whole-team
-- and video/review commitments and the marketing consent.
--
-- The columns stay, so the applications already saved keep their answers, and
-- a visitor still on the old form (or a half-done deploy) is not turned away.
-- They become optional: null means "not asked". The checks stay as they are (a
-- check passes on null), so a blank town, or marketing_ok = false, is still
-- refused. name stays required; email was optional already.
--
-- Rollback: supabase/rollback/20261011200000_founding_short_form.down.sql.

alter table public.founding_applications
  alter column trade        drop not null,
  alter column town         drop not null,
  alter column how_run      drop not null,
  alter column biggest_cost drop not null,
  alter column whole_team   drop not null,
  alter column video_review drop not null,
  alter column marketing_ok drop not null;

comment on column public.founding_applications.trade is
  'An industry template code. Null: not asked (the form stopped asking on 11 Oct 2026).';
comment on column public.founding_applications.town is
  'Town or city. Null: not asked (the form stopped asking on 11 Oct 2026).';
comment on column public.founding_applications.how_run is
  'How they run jobs today. Null: not asked (the form stopped asking on 11 Oct 2026).';
comment on column public.founding_applications.biggest_cost is
  'What costs them the most, in their words. Null: not asked (the form stopped asking on 11 Oct 2026).';
comment on column public.founding_applications.whole_team is
  'Will the whole team use Tickd every workday for 60 days? Null: not asked (the form stopped asking on 11 Oct 2026).';
comment on column public.founding_applications.video_review is
  'Happy to do a 60-second video and a Google review at the end? Null: not asked (the form stopped asking on 11 Oct 2026).';
comment on column public.founding_applications.marketing_ok is
  'Agreed that Tickd may use their name, logo, video and results in marketing. Never false; null: not asked, so no consent.';
