-- Performance reviews.
--
-- The brief is unusually clear about what this must NOT become, so the shape is
-- as much about what is absent. There is no scoring engine, nothing reads a
-- visit or a sales figure, and no number in this schema is produced by anything
-- other than a person choosing it. Section 7 asks for the review system first
-- and the automatic metrics later; the seam for later is that a category is a
-- row rather than a column, so a future `source` column on
-- `hr_review_categories` can mark one as machine-filled without moving a single
-- rating.
--
-- Two things are computed, and both are arithmetic rather than judgement:
--
--   * `overall_rating` is the weighted mean of the category ratings, recomputed
--     by trigger whenever a rating changes. Stored rather than derived in a
--     view because the trend chart and the "below expectations" count both read
--     it per employee over years, and because a completed review's score should
--     not move when somebody later re-weights a category.
--   * The period. A review belongs to (type, year, index) — 2026 Q3 — and the
--     unique index on that triple is what makes "who has not been reviewed this
--     quarter" a left join rather than a guess.
--
-- Locking is the part with teeth. Once a review is completed the manager who
-- wrote it cannot change it; only HR can. That is enforced in a trigger and not
-- in a policy, because a policy sees one row at a time and cannot tell an edit
-- from an acknowledgement.

-- ---------------------------------------------------------------------------
-- Periods
-- ---------------------------------------------------------------------------

create or replace function public.hr_period_index(p_frequency text, p_date date)
returns integer
language sql
immutable
as $$
  select case p_frequency
    when 'monthly'     then extract(month from p_date)::int
    when 'quarterly'   then extract(quarter from p_date)::int
    when 'six_monthly' then case when extract(month from p_date) <= 6 then 1 else 2 end
    else 1
  end
$$;

create or replace function public.hr_period_bounds(p_frequency text, p_year integer, p_index integer)
returns table (period_start date, period_end date)
language sql
immutable
as $$
  select t.s,
         (t.s + case p_frequency
            when 'monthly'     then interval '1 month'
            when 'quarterly'   then interval '3 months'
            when 'six_monthly' then interval '6 months'
            else interval '1 year'
          end - interval '1 day')::date
    from (
      select (make_date(p_year, 1, 1) + case p_frequency
                when 'monthly'     then make_interval(months => p_index - 1)
                when 'quarterly'   then make_interval(months => (p_index - 1) * 3)
                when 'six_monthly' then make_interval(months => (p_index - 1) * 6)
                else make_interval()
              end)::date as s
    ) t
$$;

revoke execute on function public.hr_period_index(text, date) from anon;
revoke execute on function public.hr_period_bounds(text, integer, integer) from anon;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.hr_review_categories (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name   text not null,
  description text,
  -- Equal by default. A weight is the only honest way to say "merchandising
  -- execution matters more than product knowledge" without pretending the mean
  -- of nine equal numbers already said it.
  weight numeric(5,2) not null default 1 check (weight > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hr_review_categories_org_name_idx
  on public.hr_review_categories (org_id, lower(name));

create table if not exists public.hr_reviews (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  -- The profile, not the employee record: this is "who is accountable for
  -- writing it", and it is a signed-in user by definition.
  reviewer_id uuid references public.profiles(id) on delete set null,

  period_type  text not null default 'quarterly'
                 check (period_type in ('monthly','quarterly','six_monthly','annual')),
  period_year  integer not null,
  period_index integer not null check (period_index between 1 and 12),
  period_start date not null,
  period_end   date not null,
  review_date  date not null default current_date,

  manager_comments  text,
  employee_comments text,
  strengths         text,
  improvements      text,
  goals             text,

  -- Written by trigger from the category ratings. Never by a client.
  overall_rating numeric(4,2),

  status text not null default 'draft'
           check (status in ('draft','completed','acknowledged')),
  created_by      uuid references public.profiles(id) on delete set null,
  completed_at    timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint hr_reviews_period_dates check (period_end >= period_start)
);

-- One review per employee per period. This is what "Reviews Due" is a left join
-- against; without it two managers reviewing the same person for the same
-- quarter would both be right and the average would be neither.
create unique index if not exists hr_reviews_period_unique_idx
  on public.hr_reviews (employee_id, period_type, period_year, period_index);
create index if not exists hr_reviews_org_period_idx
  on public.hr_reviews (org_id, period_year desc, period_index desc);
create index if not exists hr_reviews_employee_idx
  on public.hr_reviews (employee_id, period_start desc);
create index if not exists hr_reviews_reviewer_idx
  on public.hr_reviews (reviewer_id, status);

create table if not exists public.hr_review_ratings (
  review_id   uuid not null references public.hr_reviews(id) on delete cascade,
  category_id uuid not null references public.hr_review_categories(id) on delete cascade,
  -- The upper bound is the widest scale `hr_settings` allows. The org's own
  -- maximum is checked in the trigger, because a check constraint cannot read
  -- another table.
  rating      smallint not null check (rating between 1 and 10),
  comment     text,
  primary key (review_id, category_id)
);

drop trigger if exists hr_review_categories_set_updated_at on public.hr_review_categories;
create trigger hr_review_categories_set_updated_at before update on public.hr_review_categories
  for each row execute function public.set_updated_at();
drop trigger if exists hr_reviews_set_updated_at on public.hr_reviews;
create trigger hr_reviews_set_updated_at before update on public.hr_reviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.hr_review_categories enable row level security;
alter table public.hr_reviews enable row level security;
alter table public.hr_review_ratings enable row level security;

drop policy if exists hr_review_categories_select on public.hr_review_categories;
create policy hr_review_categories_select on public.hr_review_categories
  for select using (org_id = (select public.current_org_id()));

drop policy if exists hr_review_categories_write on public.hr_review_categories;
create policy hr_review_categories_write on public.hr_review_categories
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

-- An employee sees their own reviews, but not while they are drafts. A
-- half-written review read over somebody's shoulder is worse than no review:
-- the manager has not finished thinking, and the employee cannot unread it.
drop policy if exists hr_reviews_select on public.hr_reviews;
create policy hr_reviews_select on public.hr_reviews
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public.hr_is_hr())
      or public.hr_manages_employee(hr_reviews.employee_id)
      or reviewer_id = (select auth.uid())
      or (employee_id = (select public.hr_my_employee_id()) and status <> 'draft')
    )
  );

drop policy if exists hr_reviews_insert on public.hr_reviews;
create policy hr_reviews_insert on public.hr_reviews
  for insert with check (
    org_id = (select public.current_org_id())
    and (
      (select public.hr_is_hr())
      or public.hr_manages_employee(hr_reviews.employee_id)
    )
  );

-- Wide on purpose, and narrowed by `hr_review_guard`. The employee must be able
-- to UPDATE their own row to acknowledge it and to add their comments; what
-- they may change is a question about two rows at once, which is a trigger's
-- job.
drop policy if exists hr_reviews_update on public.hr_reviews;
create policy hr_reviews_update on public.hr_reviews
  for update using (
    org_id = (select public.current_org_id())
    and (
      (select public.hr_is_hr())
      or public.hr_manages_employee(hr_reviews.employee_id)
      or reviewer_id = (select auth.uid())
      or (employee_id = (select public.hr_my_employee_id()) and status <> 'draft')
    )
  ) with check (org_id = (select public.current_org_id()));

-- A completed review is a permanent record; only a draft can be thrown away.
drop policy if exists hr_reviews_delete on public.hr_reviews;
create policy hr_reviews_delete on public.hr_reviews
  for delete using (
    org_id = (select public.current_org_id())
    and (select public.hr_is_hr())
    and status = 'draft'
  );

drop policy if exists hr_review_ratings_select on public.hr_review_ratings;
create policy hr_review_ratings_select on public.hr_review_ratings
  for select using (
    exists (select 1 from public.hr_reviews r where r.id = hr_review_ratings.review_id)
  );

-- Writable while the review is a draft, by whoever may write the review; HR
-- afterwards. Inherited from `hr_reviews` rather than restated, so there is one
-- definition of who owns a review and not two.
drop policy if exists hr_review_ratings_write on public.hr_review_ratings;
create policy hr_review_ratings_write on public.hr_review_ratings
  for all using (
    exists (
      select 1 from public.hr_reviews r
       where r.id = hr_review_ratings.review_id
         and r.org_id = (select public.current_org_id())
         and (
           (select public.hr_is_hr())
           or (r.status = 'draft' and (
                 public.hr_manages_employee(r.employee_id)
                 or r.reviewer_id = (select auth.uid())))
         )
    )
  ) with check (
    exists (
      select 1 from public.hr_reviews r
       where r.id = hr_review_ratings.review_id
         and r.org_id = (select public.current_org_id())
         and (
           (select public.hr_is_hr())
           or (r.status = 'draft' and (
                 public.hr_manages_employee(r.employee_id)
                 or r.reviewer_id = (select auth.uid())))
         )
    )
  );

-- ---------------------------------------------------------------------------
-- Workflow
-- ---------------------------------------------------------------------------

/**
 * The review lifecycle, in one place.
 *
 * draft → completed → acknowledged, and nothing else. The manager owns the
 * draft; completing it hands it to the employee, who may add their own comments
 * and acknowledge; after that only HR can touch it. Every stamp
 * (`completed_at`, `acknowledged_by`, `acknowledged_at`) is written here rather
 * than accepted from the client, because "the employee acknowledged this on the
 * 3rd" is a claim the database should be able to stand behind.
 */
create or replace function public.hr_review_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_hr     boolean := public.hr_is_hr();
  v_is_self   boolean;
  v_can_write boolean;
  v_ratings   integer;
begin
  if tg_op = 'INSERT' then
    if not (v_is_hr or public.hr_manages_employee(new.employee_id)) then
      raise exception 'only HR or the employee''s manager may create a review';
    end if;
    new.created_by  := coalesce(new.created_by, auth.uid());
    new.reviewer_id := coalesce(new.reviewer_id, auth.uid());
    -- A review starts as a draft however it was posted. Creating one already
    -- "acknowledged" would fabricate an acknowledgement.
    new.status := 'draft';
    new.completed_at := null;
    new.acknowledged_by := null;
    new.acknowledged_at := null;
    return new;
  end if;

  v_is_self := old.employee_id = public.hr_my_employee_id();
  v_can_write := v_is_hr
              or public.hr_manages_employee(old.employee_id)
              or old.reviewer_id = auth.uid();

  if v_is_self and not v_can_write then
    -- The employee's half of the form. Comparing the whole row minus the three
    -- fields they own is cheaper than listing the twenty they do not, and it
    -- cannot fall out of date when a column is added.
    if (to_jsonb(new) - 'employee_comments' - 'status' - 'acknowledged_at'
        - 'acknowledged_by' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'employee_comments' - 'status' - 'acknowledged_at'
        - 'acknowledged_by' - 'updated_at') then
      raise exception 'you may only add your comments and acknowledge this review';
    end if;
    if new.status is distinct from old.status
       and not (old.status = 'completed' and new.status = 'acknowledged') then
      raise exception 'you may only acknowledge a completed review';
    end if;
  else
    if not v_can_write then
      raise exception 'you may not edit this review';
    end if;
    -- The lock. Section 7: "Review becomes locked after completion, except
    -- HR/Admin edits."
    if old.status <> 'draft' and not v_is_hr then
      raise exception 'this review is locked; only HR can change a completed review';
    end if;
  end if;

  if new.status = 'completed' and old.status = 'draft' then
    select count(*) into v_ratings
      from public.hr_review_ratings where review_id = new.id;
    if v_ratings = 0 then
      raise exception 'rate at least one category before completing the review';
    end if;
    new.completed_at := now();
  end if;

  if new.status = 'acknowledged' and old.status <> 'acknowledged' then
    new.acknowledged_by := auth.uid();
    new.acknowledged_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists hr_reviews_guard on public.hr_reviews;
create trigger hr_reviews_guard before insert or update on public.hr_reviews
  for each row execute function public.hr_review_guard();

/** Ratings must fit the org's scale, which lives in another table. */
create or replace function public.hr_review_rating_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_max smallint;
begin
  select s.rating_scale_max into v_max
    from public.hr_reviews r
    join public.hr_settings s on s.org_id = r.org_id
   where r.id = new.review_id;
  if v_max is not null and new.rating > v_max then
    raise exception 'rating % is above this organisation''s scale of 1–%', new.rating, v_max;
  end if;
  return new;
end;
$$;

drop trigger if exists hr_review_ratings_guard on public.hr_review_ratings;
create trigger hr_review_ratings_guard before insert or update on public.hr_review_ratings
  for each row execute function public.hr_review_rating_guard();

/**
 * The overall score, recomputed from the parts.
 *
 * `security definer` so the UPDATE reaches the review row regardless of the
 * caller's policy — the caller has already been allowed to write the rating,
 * and refusing to update the total afterwards would leave the two disagreeing.
 */
create or replace function public.hr_recalc_review_overall()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_review uuid := coalesce(new.review_id, old.review_id);
begin
  update public.hr_reviews r
     set overall_rating = (
       select round(sum(rt.rating * c.weight) / nullif(sum(c.weight), 0), 2)
         from public.hr_review_ratings rt
         join public.hr_review_categories c on c.id = rt.category_id
        where rt.review_id = v_review)
   where r.id = v_review;
  return coalesce(new, old);
end;
$$;

drop trigger if exists hr_review_ratings_recalc on public.hr_review_ratings;
create trigger hr_review_ratings_recalc
  after insert or update or delete on public.hr_review_ratings
  for each row execute function public.hr_recalc_review_overall();

-- ---------------------------------------------------------------------------
-- Audit and notification
-- ---------------------------------------------------------------------------

create or replace function public.log_hr_review_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_employee record;
  v_label text;
begin
  select e.full_name, e.profile_id into v_employee
    from public.hr_employees e where e.id = new.employee_id;
  v_label := new.period_year || ' ' || case new.period_type
    when 'quarterly' then 'Q' || new.period_index
    when 'monthly' then to_char(new.period_start, 'Mon')
    when 'six_monthly' then 'H' || new.period_index
    else 'Annual' end;

  if tg_op = 'INSERT' then
    insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
    values (new.org_id, auth.uid(), 'hr.review_created', 'hr_review', new.id,
            jsonb_build_object('employee', v_employee.full_name, 'period', v_label,
                               'via', current_user));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
    values (new.org_id, auth.uid(), 'hr.review_' || new.status, 'hr_review', new.id,
            jsonb_build_object('employee', v_employee.full_name, 'period', v_label,
                               'overall', new.overall_rating,
                               'status', jsonb_build_object('from', old.status, 'to', new.status),
                               'via', current_user));

    if new.status = 'completed' then
      perform public.hr_notify(
        new.org_id, v_employee.profile_id, 'review.completed',
        'Your ' || v_label || ' review is ready',
        'Overall ' || coalesce(new.overall_rating::text, '—')
          || '. Open it to add your comments and acknowledge.',
        '/hr/me?tab=performance', 'hr_review', new.id);
    elsif new.status = 'acknowledged' then
      perform public.hr_notify(
        new.org_id, new.reviewer_id, 'review.acknowledged',
        v_employee.full_name || ' acknowledged their ' || v_label || ' review',
        null, '/hr/performance/' || new.id, 'hr_review', new.id);
    end if;
  elsif old.status <> 'draft' and (
        new.manager_comments is distinct from old.manager_comments
     or new.strengths is distinct from old.strengths
     or new.improvements is distinct from old.improvements
     or new.goals is distinct from old.goals
     or new.overall_rating is distinct from old.overall_rating) then
    -- Only edits made *after* completion are worth a trail entry. Every
    -- keystroke of a draft would be noise, and the draft is not yet a claim
    -- about anyone.
    insert into public.security_events (org_id, actor_id, action, subject_type, subject_id, detail)
    values (new.org_id, auth.uid(), 'hr.review_edited_after_completion', 'hr_review', new.id,
            jsonb_build_object('employee', v_employee.full_name, 'period', v_label,
                               'overall', jsonb_build_object('from', old.overall_rating,
                                                             'to', new.overall_rating),
                               'via', current_user));
  end if;
  return new;
end;
$$;

drop trigger if exists hr_reviews_log on public.hr_reviews;
create trigger hr_reviews_log after insert or update on public.hr_reviews
  for each row execute function public.log_hr_review_change();

-- ---------------------------------------------------------------------------
-- Default categories
-- ---------------------------------------------------------------------------
--
-- The nine from section 7, all weighted equally. Equal weights are a starting
-- point that is visibly a starting point; a set of weights invented here would
-- be a claim about what Gold Fortune values, and nobody has made that claim.

insert into public.hr_review_categories (org_id, name, description, sort_order)
select o.id, v.name, v.description, v.sort_order
  from public.organizations o
  cross join (values
    ('Sales Performance',            'Volume, value and target achievement in the territory.', 10),
    ('Store Coverage',               'Visiting the stores on the call cycle, at the agreed frequency.', 20),
    ('Merchandising Execution',      'Shelf presence, facings, planogram compliance, promotional set-up.', 30),
    ('Attendance & Reliability',     'Starting and ending the working day, punctuality, availability.', 40),
    ('Reporting Accuracy',           'Forms, photos and stock counts completed correctly and on time.', 50),
    ('Product Knowledge',            'Range, pack sizes, pricing and promotions.', 60),
    ('Customer/Store Relationships', 'Standing with store managers and buyers.', 70),
    ('Teamwork',                     'Working with colleagues, the warehouse and the office.', 80),
    ('Professional Conduct',         'Presentation, company property, and adherence to policy.', 90)
  ) as v(name, description, sort_order)
on conflict (org_id, lower(name)) do nothing;

comment on table public.hr_reviews is
  'One review per employee per period. overall_rating is written by trigger from hr_review_ratings and never by a client. Locked at completion; only HR can edit afterwards, and every such edit is in security_events.';
comment on function public.hr_review_guard is
  'The draft → completed → acknowledged lifecycle. Exists because the RLS policy must let an employee update their own review to acknowledge it, and a policy cannot tell an acknowledgement from a rewrite.';
