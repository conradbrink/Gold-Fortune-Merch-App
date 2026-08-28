-- Reviews for everybody, not only the people who work a round.
--
-- `hr_reviews` was never sales-only — it hangs off `hr_employees`, and the
-- Performance page already filters by department. What was sales-only is the
-- category list: `hr_review_categories` held one flat set per organisation, and
-- all nine seeded rows were field-sales criteria. A warehouse clerk's review
-- form therefore asked her manager to rate her out of five on Store Coverage
-- and Merchandising Execution, and the honest answer to both is "not
-- applicable". The draft that sat half-started this morning is the evidence.
--
-- A **scorecard** is a named set of categories. The shape follows the grain the
-- module already has:
--
--   * A category belongs to exactly one scorecard rather than being shared
--     across several. "Teamwork" appearing on three scorecards is three rows,
--     which looks like duplication and is not: the weight of teamwork on a
--     supervisor's review is a different claim from its weight on a picker's,
--     and a shared row could only carry one of them. The cost is that renaming
--     it is three edits, in a module whose whole configuration story is that HR
--     edits these lists by hand anyway.
--
--   * Which scorecard a person is reviewed on is resolved, not stored on the
--     review by a human choosing from a list every quarter: employee override →
--     their department's scorecard. A supervisor who also works a round is the
--     case the override exists for, and it is the same escape hatch
--     `hr_employees.work_start_time` already provides against the org default.
--
--   * The answer is **stamped** onto the review at creation and never
--     re-resolved. Moving somebody to another department must not silently
--     re-interpret the review their old manager wrote, in exactly the way that
--     `overall_rating` is stored rather than derived so it does not move when
--     somebody re-weights a category later.
--
-- Two integrity choices worth naming, because both replace a trigger with a
-- constraint:
--
--   * Every reference to a scorecard is a **composite** foreign key on
--     (id, org_id). `hr_review_templates` carries a redundant unique (id,
--     org_id) so that a department, an employee, a category or a review cannot
--     point at another organisation's scorecard. A single-column FK plus an RLS
--     policy would leave that to be argued about; this makes it unrepresentable.
--
--   * `hr_review_ratings.category_id` becomes `on delete restrict`. It was
--     `cascade`, which meant deleting a category silently erased every historical
--     rating against it and let the recalc trigger quietly restate completed
--     reviews' overall scores. `active = false` is how a category is retired,
--     and now it is the only way once anybody has been rated on it.

-- ---------------------------------------------------------------------------
-- Scorecards
-- ---------------------------------------------------------------------------

create table if not exists public.hr_review_templates (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name   text not null,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hr_review_templates_org_name_idx
  on public.hr_review_templates (org_id, lower(name));

-- Redundant on its own — `id` is already the primary key — and the target of
-- every composite FK below. This is what makes a cross-organisation scorecard
-- reference impossible rather than merely unlikely.
alter table public.hr_review_templates
  drop constraint if exists hr_review_templates_id_org_key;
alter table public.hr_review_templates
  add constraint hr_review_templates_id_org_key unique (id, org_id);

drop trigger if exists hr_review_templates_set_updated_at on public.hr_review_templates;
create trigger hr_review_templates_set_updated_at before update on public.hr_review_templates
  for each row execute function public.set_updated_at();

alter table public.hr_review_templates enable row level security;

drop policy if exists hr_review_templates_select on public.hr_review_templates;
create policy hr_review_templates_select on public.hr_review_templates
  for select using (org_id = (select public.current_org_id()));

drop policy if exists hr_review_templates_write on public.hr_review_templates;
create policy hr_review_templates_write on public.hr_review_templates
  for all using (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  ) with check (
    org_id = (select public.current_org_id()) and (select public.hr_is_hr())
  );

-- ---------------------------------------------------------------------------
-- The existing nine become the Field Sales scorecard
-- ---------------------------------------------------------------------------

insert into public.hr_review_templates (org_id, name, description, sort_order)
select o.id, 'Field Sales',
       'Merchandisers and sales representatives working a call cycle.', 10
  from public.organizations o
on conflict (org_id, lower(name)) do nothing;

alter table public.hr_review_categories
  add column if not exists template_id uuid;

update public.hr_review_categories c
   set template_id = t.id
  from public.hr_review_templates t
 where t.org_id = c.org_id
   and t.name = 'Field Sales'
   and c.template_id is null;

do $$
declare v_orphans integer;
begin
  select count(*) into v_orphans
    from public.hr_review_categories where template_id is null;
  if v_orphans > 0 then
    raise exception '% review categories could not be placed on a scorecard', v_orphans;
  end if;
end $$;

alter table public.hr_review_categories
  alter column template_id set not null;

alter table public.hr_review_categories
  drop constraint if exists hr_review_categories_template_fk;
alter table public.hr_review_categories
  add constraint hr_review_categories_template_fk
  foreign key (template_id, org_id)
  references public.hr_review_templates (id, org_id) on delete cascade;

-- The name was unique per organisation, which is what stops a scorecard from
-- carrying "Teamwork" twice — but it also stopped two different scorecards from
-- each having one. Uniqueness moves down a level with the categories.
drop index if exists public.hr_review_categories_org_name_idx;
create unique index if not exists hr_review_categories_template_name_idx
  on public.hr_review_categories (template_id, lower(name));
create index if not exists hr_review_categories_template_idx
  on public.hr_review_categories (template_id, sort_order);

-- Retiring a category is `active = false`. Deleting one that people have been
-- rated on would rewrite their completed scores through the recalc trigger.
alter table public.hr_review_ratings
  drop constraint if exists hr_review_ratings_category_id_fkey;
alter table public.hr_review_ratings
  add constraint hr_review_ratings_category_id_fkey
  foreign key (category_id) references public.hr_review_categories(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Who is reviewed on what
-- ---------------------------------------------------------------------------

alter table public.hr_departments
  add column if not exists review_template_id uuid;
alter table public.hr_departments
  drop constraint if exists hr_departments_review_template_fk;
alter table public.hr_departments
  add constraint hr_departments_review_template_fk
  foreign key (review_template_id, org_id)
  references public.hr_review_templates (id, org_id)
  -- The column list is not optional here. A bare `on delete set null` on a
  -- composite key nulls *every* referencing column, and `org_id` is NOT NULL —
  -- so deleting a scorecard would fail on a constraint that has nothing to do
  -- with scorecards. Naming the column is a Postgres 15 feature; this database
  -- is on 17.
  on delete set null (review_template_id);

-- The override. Null is the normal case and means "whatever my department
-- uses"; set only for the person whose job genuinely straddles two — a
-- supervisor who also works a round — in the same spirit as the null
-- `work_start_time` that falls back to the organisation's hours.
alter table public.hr_employees
  add column if not exists review_template_id uuid;
alter table public.hr_employees
  drop constraint if exists hr_employees_review_template_fk;
alter table public.hr_employees
  add constraint hr_employees_review_template_fk
  foreign key (review_template_id, org_id)
  references public.hr_review_templates (id, org_id)
  on delete set null (review_template_id);

/**
 * The scorecard a new review for this employee would use.
 *
 * Override first, then the department. No organisation-wide fallback on
 * purpose: a review created against a scorecard nobody chose is exactly the
 * failure this migration exists to fix, and "Warehouse & Logistics has no
 * scorecard" is a sentence HR can act on. `security definer` because a line
 * manager may create a review for somebody whose department row they can read
 * but whose organisation-wide scorecard list they should not have to.
 */
create or replace function public.hr_review_resolve_template(p_employee uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(e.review_template_id, d.review_template_id)
    from public.hr_employees e
    left join public.hr_departments d on d.id = e.department_id
    left join public.hr_review_templates t
           on t.id = coalesce(e.review_template_id, d.review_template_id)
          and t.active
   where e.id = p_employee
     -- A definer function bypasses RLS, so the organisation check that the
     -- policies would have applied has to be made here instead.
     and e.org_id = (select public.current_org_id())
     and t.id is not null
$$;

-- The pattern from `20260826144432`: PUBLIC holds EXECUTE on a new function by
-- default and `anon` inherits it, so revoking from `anon` alone does nothing.
revoke all on function public.hr_review_resolve_template(uuid)
  from public, anon, authenticated;
grant execute on function public.hr_review_resolve_template(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The three scorecards that were missing
-- ---------------------------------------------------------------------------
--
-- Equal weights again, and for the same reason the original nine were equal: a
-- set of weights invented here would be a claim about what Gold Fortune values
-- and nobody has made that claim. Settings → Performance is where that argument
-- gets had.
--
-- Attendance & Reliability, Teamwork and Professional Conduct appear on all
-- four scorecards as separate rows. They are the three things asked of everyone
-- regardless of the job, and the descriptions differ because who you are
-- expected to work with differs.

insert into public.hr_review_templates (org_id, name, description, sort_order)
select o.id, v.name, v.description, v.sort_order
  from public.organizations o
  cross join (values
    ('Warehouse & Logistics',
     'Pickers, packers, drivers and stock controllers.', 20),
    ('Management & Supervisory',
     'Anyone accountable for the output of a team.', 30),
    ('Office & Administration',
     'Administrative, finance and office-based staff.', 40)
  ) as v(name, description, sort_order)
on conflict (org_id, lower(name)) do nothing;

insert into public.hr_review_categories (org_id, template_id, name, description, sort_order)
select t.org_id, t.id, v.name, v.description, v.sort_order
  from public.hr_review_templates t
  join (values
    ('Warehouse & Logistics', 'Order Picking Accuracy',
     'Picking the right products, in the right quantities, against the order.', 10),
    ('Warehouse & Logistics', 'Receiving & Dispatch',
     'Checking deliveries in, loading out, and the paperwork that goes with both.', 20),
    ('Warehouse & Logistics', 'Stock Handling & Housekeeping',
     'Careful handling, correct storage locations, and a clean and orderly bay.', 30),
    ('Warehouse & Logistics', 'Stock Count Accuracy',
     'Cycle counts and stock takes that match what is actually on the shelf.', 40),
    ('Warehouse & Logistics', 'Safety & Compliance',
     'Safe lifting and equipment use, protective wear, and reporting incidents.', 50),
    ('Warehouse & Logistics', 'Attendance & Reliability',
     'Starting and ending the working day, punctuality, availability.', 60),
    ('Warehouse & Logistics', 'Teamwork',
     'Working with the sales team, the drivers and the office.', 70),
    ('Warehouse & Logistics', 'Professional Conduct',
     'Presentation, company property, and adherence to policy.', 80),

    ('Management & Supervisory', 'Team Leadership',
     'Setting direction, holding standards, and dealing with performance.', 10),
    ('Management & Supervisory', 'Planning & Prioritisation',
     'Organising the team''s work against what actually matters.', 20),
    ('Management & Supervisory', 'Delivery Against Targets',
     'The numbers the team is accountable for.', 30),
    ('Management & Supervisory', 'Developing the Team',
     'Coaching, training, and reviewing the people who report to them.', 40),
    ('Management & Supervisory', 'Reporting & Communication',
     'Reporting upward and downward, accurately and on time.', 50),
    ('Management & Supervisory', 'Decision Making',
     'Sound judgement, made in time, and owned afterwards.', 60),
    ('Management & Supervisory', 'Attendance & Reliability',
     'Availability to the team, and setting the example on hours.', 70),
    ('Management & Supervisory', 'Professional Conduct',
     'Presentation, company property, and adherence to policy.', 80),

    ('Office & Administration', 'Accuracy of Work',
     'Figures, records and correspondence right the first time.', 10),
    ('Office & Administration', 'Timeliness',
     'Work delivered by the date it was needed.', 20),
    ('Office & Administration', 'Systems & Record Keeping',
     'Filing and data capture that keep the system worth trusting.', 30),
    ('Office & Administration', 'Communication',
     'Clear and timely dealings with colleagues, customers and suppliers.', 40),
    ('Office & Administration', 'Initiative & Problem Solving',
     'Spotting what needs doing, and dealing with it.', 50),
    ('Office & Administration', 'Confidentiality',
     'Handling employee, customer and financial information appropriately.', 60),
    ('Office & Administration', 'Attendance & Reliability',
     'Starting and ending the working day, punctuality, availability.', 70),
    ('Office & Administration', 'Teamwork',
     'Working with the field team, the warehouse and management.', 80),
    ('Office & Administration', 'Professional Conduct',
     'Presentation, company property, and adherence to policy.', 90)
  ) as v(template, name, description, sort_order) on v.template = t.name
on conflict (template_id, lower(name)) do nothing;

-- ---------------------------------------------------------------------------
-- Departments point at their scorecard
-- ---------------------------------------------------------------------------
--
-- Matched on the seeded department names. A department this does not name keeps
-- a null scorecard, and the Performance page says so rather than reviewing
-- somebody against a default that was never chosen for them.

update public.hr_departments d
   set review_template_id = t.id
  from public.hr_review_templates t
 where t.org_id = d.org_id
   and d.review_template_id is null
   and t.name = case d.name
     when 'Field Sales'           then 'Field Sales'
     when 'Warehouse & Logistics' then 'Warehouse & Logistics'
     when 'Management'            then 'Management & Supervisory'
     when 'Administration'        then 'Office & Administration'
   end;

-- ---------------------------------------------------------------------------
-- The stamp on the review
-- ---------------------------------------------------------------------------

alter table public.hr_reviews
  add column if not exists template_id uuid;
alter table public.hr_reviews
  drop constraint if exists hr_reviews_template_fk;
-- RESTRICT, so a scorecard anybody was ever reviewed against cannot be deleted.
-- Retiring it (`active = false`) is the supported move and leaves every past
-- review readable. The one place this bites is deleting an entire organisation,
-- where the cascade from `organizations` could reach the scorecards before the
-- reviews — but nothing in this application deletes an organisation, and that
-- path is a multi-table problem already.
alter table public.hr_reviews
  add constraint hr_reviews_template_fk
  foreign key (template_id, org_id)
  references public.hr_review_templates (id, org_id) on delete restrict;

create index if not exists hr_reviews_template_idx
  on public.hr_reviews (template_id);

-- Backfill in two passes: evidence before inference.
--
-- A review that already carries ratings tells us its scorecard outright — the
-- categories somebody actually rated. That is a fact, and it beats re-resolving
-- from today's department, which would be a guess about the past.
update public.hr_reviews r
   set template_id = src.template_id
  from (
    select distinct rt.review_id, c.template_id
      from public.hr_review_ratings rt
      join public.hr_review_categories c on c.id = rt.category_id
  ) src
 where src.review_id = r.id
   and r.template_id is null;

-- What is left has no ratings on it — a draft nobody could fill in, which is
-- the case this migration exists for. Resolve it the way a new one would be.
update public.hr_reviews r
   set template_id = coalesce(e.review_template_id, d.review_template_id)
  from public.hr_employees e
  left join public.hr_departments d on d.id = e.department_id
 where e.id = r.employee_id
   and r.template_id is null;

-- Deliberately NOT `set not null`. Every existing review has been placed above,
-- and the guard below refuses to create one without a scorecard — but an
-- organisation that adds a department and forgets its scorecard would otherwise
-- have this migration fail on a table it has no way to repair first. The
-- constraint that matters is on the way in.
do $$
declare v_orphans integer;
begin
  select count(*) into v_orphans from public.hr_reviews where template_id is null;
  if v_orphans > 0 then
    raise warning '% existing review(s) could not be placed on a scorecard — set one on their department in Settings → Performance', v_orphans;
  end if;
end $$;

comment on column public.hr_reviews.template_id is
  'The scorecard this review was written against, stamped at creation and never re-resolved. Moving an employee between departments must not reinterpret a review their old manager already wrote.';
comment on column public.hr_employees.review_template_id is
  'Overrides the department''s scorecard for this one person. Null means "use my department''s", which is the normal case.';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

/**
 * The review lifecycle, unchanged, plus the scorecard.
 *
 * Two additions and nothing else. On insert the scorecard is resolved and
 * stamped if the client did not send one, and a review with no scorecard is
 * refused outright — the alternative is the form this migration was written to
 * abolish, one that asks a warehouse manager about shelf facings. On update it
 * may only change while the review is still a draft, because the ratings
 * already given are against the old scorecard's categories.
 *
 * The employee's own-row check needs no amendment: it compares the whole row
 * minus the three fields they own, so `template_id` is covered by construction.
 * That is the property it was written for.
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
    new.template_id := coalesce(new.template_id,
                                public.hr_review_resolve_template(new.employee_id));
    if new.template_id is null then
      raise exception 'no review scorecard is set for this employee — set one on their department, or on the employee, in Settings';
    end if;
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

  -- Changing the scorecard rewrites what the ratings already given mean, so it
  -- is a draft-only move — and even then the ratings against the old scorecard
  -- have to go first, which the rating guard's own check would otherwise only
  -- discover on the next save.
  if new.template_id is distinct from old.template_id then
    if old.status <> 'draft' then
      raise exception 'the scorecard cannot be changed once a review is completed';
    end if;
    if new.template_id is null then
      raise exception 'a review must be on a scorecard';
    end if;
    select count(*) into v_ratings
      from public.hr_review_ratings where review_id = old.id;
    if v_ratings > 0 then
      raise exception 'clear the ratings before changing this review''s scorecard';
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

/**
 * A rating must fit the organisation's scale, and belong to the review's own
 * scorecard.
 *
 * The second check is the one that makes a scorecard mean anything. Without it
 * the categories a form offers are a suggestion, and a client that posted a
 * Field Sales category id against a warehouse review would be obeyed — and the
 * weighted mean would then be computed over a mixture of two scorecards, which
 * is a number about nothing.
 */
create or replace function public.hr_review_rating_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_max      smallint;
  v_template uuid;
  v_category uuid;
  v_name     text;
begin
  select s.rating_scale_max, r.template_id into v_max, v_template
    from public.hr_reviews r
    left join public.hr_settings s on s.org_id = r.org_id
   where r.id = new.review_id;
  if v_max is not null and new.rating > v_max then
    raise exception 'rating % is above this organisation''s scale of 1–%', new.rating, v_max;
  end if;

  select c.template_id, c.name into v_category, v_name
    from public.hr_review_categories c where c.id = new.category_id;
  if v_template is not null and v_category is distinct from v_template then
    raise exception '"%" is not a category on this review''s scorecard', coalesce(v_name, new.category_id::text);
  end if;
  return new;
end;
$$;

-- `create or replace` preserves a function's ACL, so the two trigger functions
-- above keep the revokes `20260826144432` gave them. Restated rather than
-- assumed, because the cost of being wrong is the hole that migration closed.
revoke all on function public.hr_review_guard() from public, anon, authenticated;
revoke all on function public.hr_review_rating_guard() from public, anon, authenticated;

comment on table public.hr_review_templates is
  'A named set of review categories — a scorecard. Resolved per employee (their own override, else their department''s) and stamped onto the review at creation.';
comment on function public.hr_review_resolve_template is
  'The scorecard a new review for this employee would use: their override, else their department''s. Null when neither is set, which the review guard refuses rather than papering over with a default nobody chose.';
