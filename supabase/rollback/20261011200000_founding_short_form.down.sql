-- Rollback of 20261011200000_founding_short_form: the seven answers become
-- required again. It fails while any application sent on the short form is
-- saved (those rows have nulls); decide what to do with them before rolling
-- back. Nothing is invented here.
alter table public.founding_applications
  alter column trade        set not null,
  alter column town         set not null,
  alter column how_run      set not null,
  alter column biggest_cost set not null,
  alter column whole_team   set not null,
  alter column video_review set not null,
  alter column marketing_ok set not null;

comment on column public.founding_applications.trade is null;
comment on column public.founding_applications.town is null;
comment on column public.founding_applications.how_run is null;
comment on column public.founding_applications.biggest_cost is null;
comment on column public.founding_applications.whole_team is null;
comment on column public.founding_applications.video_review is null;
comment on column public.founding_applications.marketing_ok is null;
