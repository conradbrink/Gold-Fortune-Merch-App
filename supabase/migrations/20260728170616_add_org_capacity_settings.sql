-- How much work one rep-day holds, per organisation.
--
-- These were constants in the web app (FULL_DAY_STORES = 6). That is fine for
-- one customer and wrong for the next: a merchandiser covering small kiosks
-- fits far more stops in a day than one covering hypermarkets, and an estate
-- that works Saturdays has a different week. The call cycle, the load strip,
-- the capacity meter and the AI critic all key off these, so they belong with
-- the organisation rather than in the bundle.
alter table public.organizations
  add column if not exists stores_per_day int not null default 8,
  add column if not exists working_days smallint[] not null default '{1,2,3,4,5}',
  add column if not exists default_visit_frequency text not null default 'monthly';

alter table public.organizations drop constraint if exists organizations_stores_per_day_check;
alter table public.organizations add constraint organizations_stores_per_day_check
  check (stores_per_day between 1 and 50);

alter table public.organizations drop constraint if exists organizations_working_days_check;
alter table public.organizations add constraint organizations_working_days_check
  -- ISO weekdays, 1 = Monday .. 7 = Sunday, matching extract(isodow) and the
  -- day_of_week on store_assignments. At least one day, or nothing can ever be
  -- scheduled.
  check (
    array_length(working_days, 1) between 1 and 7
    and working_days <@ array[1,2,3,4,5,6,7]::smallint[]
  );

alter table public.organizations drop constraint if exists organizations_default_frequency_check;
alter table public.organizations add constraint organizations_default_frequency_check
  check (default_visit_frequency in ('weekly', 'biweekly', 'monthly'));

comment on column public.organizations.stores_per_day is
  'Stops one rep can realistically make in a day. Drives capacity, the load strip and the auto-spread.';
comment on column public.organizations.working_days is
  'ISO weekdays the team works. 1=Mon..7=Sun.';
comment on column public.organizations.default_visit_frequency is
  'Applied to newly imported stores, so a bulk import does not silently default everything to weekly.';
