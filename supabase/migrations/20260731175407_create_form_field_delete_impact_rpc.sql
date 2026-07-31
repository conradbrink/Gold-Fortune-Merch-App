-- What deleting a form question would destroy.
--
-- `form_responses.form_field_id` cascades, so removing a question erases every
-- answer ever given to it — every store, every visit, every month, including
-- audits whose compliance figures then change retroactively. The builder
-- currently deletes on a single click of a bin icon, with nothing said.
--
-- Same trap, and same remedy, as `store_delete_impact` (20260728145421),
-- `rep_delete_impact` (20260727202504) and `product_delete_impact`
-- (20260729142051). The dialog has to be able to state the cost before anyone
-- confirms it.
--
-- Deactivating the whole form keeps its history; there is no per-question
-- equivalent, which is exactly why the count matters here.
create or replace function public.form_field_delete_impact(p_field_id uuid)
returns table (
  field_label       text,
  metric_key        text,
  answers           bigint,
  submissions       bigint,
  stores_answered   bigint,
  photos            bigint,
  first_answered_at timestamptz,
  last_answered_at  timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  -- Every answer to this question that the caller's organisation owns. The
  -- org filter is on form_submissions because form_responses carries no
  -- org_id of its own.
  mine as (
    select fr.form_submission_id,
           fr.photo_id,
           fs.visit_id,
           fs.submitted_at
    from form_responses fr
    join form_submissions fs on fs.id = fr.form_submission_id
    cross join cfg
    where fr.form_field_id = p_field_id
      and fs.org_id = cfg.org
  ),
  field as (
    select ff.label, ff.metric_key
    from form_fields ff
    join form_templates ft on ft.id = ff.form_template_id
    cross join cfg
    where ff.id = p_field_id
      and ft.org_id = cfg.org
  )
  select
    (select f.label from field f),
    (select f.metric_key from field f),
    (select count(*) from mine),
    (select count(distinct m.form_submission_id) from mine m),
    -- Outlets rather than visits: "answers from 34 shops" is the number a
    -- manager can weigh, where a raw row count is not.
    (select count(distinct v.store_id)
       from mine m join visits v on v.id = m.visit_id),
    -- Photo answers are worth naming separately: the image itself is not
    -- deleted by the cascade, but nothing will point at it again.
    (select count(*) from mine m where m.photo_id is not null),
    (select min(m.submitted_at) from mine m),
    (select max(m.submitted_at) from mine m);
$$;

comment on function public.form_field_delete_impact is
  'Answers a hard delete of a form question would cascade away, with how many outlets and what date range they span. Shown before confirming — there is no per-question deactivate, so the only alternatives are keep or lose the history.';
