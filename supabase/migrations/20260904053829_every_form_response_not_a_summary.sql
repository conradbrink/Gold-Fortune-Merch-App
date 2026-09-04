-- Export every form that was filled in, not a summary of them.
--
-- The Form tab's export wrote one row per *question* — type, answer count, and
-- `summariseFieldStats`'s five-answers-and-a-count preview. For a price survey
-- that is the wrong artefact entirely: a 98-answer question came out as
-- "mpo mini 400puffs P69.99 | mpo p231 | … (+15 more)" in a single cell, and
-- the other 93 prices were nowhere in the file. `form_report` cannot serve
-- this, and should not: it aggregates in Postgres precisely so the browser
-- never holds `form_responses`, and its text branch keeps only the 20 most
-- recent answers per field.
--
-- So this is a second, separate read — one row per **submission**, with the
-- answers as a `field_id -> text` object. The client turns that into a column
-- per question, which is the shape somebody can sort, filter and pivot: the
-- Google-Forms-style sheet, not a screenshot of the charts.
--
-- Three deliberate choices.
--
-- **Paged, not capped.** A silent `limit` on an export is the same lie in a
-- smaller font — the file looks complete. This takes a keyset cursor and the
-- client walks it to the end, so "every response" means every response. The
-- per-call ceiling is 2,000 rows, which bounds one round trip without bounding
-- the answer.
--
-- **Keyset, not `offset`.** Two pages of an `offset` walk over a live table can
-- repeat a submission or skip one. `(submitted_at, id) < (cursor)` cannot: the
-- pair is unique and totally ordered, and `id` is the tiebreaker for the
-- submissions that share a millisecond (a rep syncing a day's work offline
-- posts several at once, so ties are the normal case here, not the edge).
--
-- **The value is text.** One column per question holds whatever that question
-- is — a price, Yes/No, a chosen option, a photo path — and a jsonb object
-- cannot hold a numeric for one field and a string for the next without the
-- client having to re-derive which is which. It already knows the field types
-- from `form_report`; it re-numbers the number columns itself.
--
-- `security invoker` and the `current_org_id()` filter match `form_report`
-- exactly, so RLS decides what a caller sees: a manager reads the org, a rep
-- reads their own submissions, and neither gets a row from another tenant.
create or replace function public.form_response_rows(
  p_template_id        uuid,
  p_from               timestamptz,
  p_to                 timestamptz,
  p_rep_ids            uuid[]      default null,
  p_store_ids          uuid[]      default null,
  p_limit              int         default 500,
  p_after_submitted_at timestamptz default null,
  p_after_id           uuid        default null
)
returns table (
  submission_id uuid,
  submitted_at  timestamptz,
  rep_name      text,
  store_name    text,
  store_group   text,
  city          text,
  visit_status  text,
  answers       jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  subs as materialized (
    select s.id, s.submitted_at, s.rep_id, v.store_id, v.status
    from form_submissions s
    left join visits v on v.id = s.visit_id
    cross join cfg
    where s.org_id = cfg.org
      and s.form_template_id = p_template_id
      and s.submitted_at >= p_from
      and s.submitted_at <  p_to
      and (p_rep_ids   is null or s.rep_id   = any(p_rep_ids))
      and (p_store_ids is null or v.store_id = any(p_store_ids))
      -- Both cursor arguments or neither. A half-set cursor would make the row
      -- comparison null and return an empty page, which the client would read
      -- as "that was the last one" and stop — an export missing everything
      -- after the first page, silently. Nulls mean "from the beginning".
      and (
        p_after_submitted_at is null
        or p_after_id is null
        or (s.submitted_at, s.id) < (p_after_submitted_at, p_after_id)
      )
    order by s.submitted_at desc, s.id desc
    limit least(greatest(coalesce(p_limit, 500), 1), 2000)
  )
  select
    sb.id,
    sb.submitted_at,
    p.full_name,
    st.name,
    g.name,
    st.city,
    sb.status,
    coalesce(
      (
        select jsonb_object_agg(a.field_id::text, a.value)
        from (
          select
            r.form_field_id as field_id,
            -- A field answered twice in one submission is not supposed to
            -- happen and nothing in the schema forbids it, so both answers are
            -- kept rather than one of them being picked arbitrarily.
            string_agg(
              coalesce(
                nullif(btrim(r.value_text), ''),
                r.value_number::text,
                -- `case when r.value_boolean then …` alone would write "No"
                -- for an unanswered checkbox: an unknown is not false.
                case
                  when r.value_boolean is null then null
                  when r.value_boolean then 'Yes'
                  else 'No'
                end,
                ph.storage_path
              ),
              ' | ' order by r.id
            ) as value
          from form_responses r
          left join photos ph on ph.id = r.photo_id
          where r.form_submission_id = sb.id
          group by r.form_field_id
        ) a
      ),
      '{}'::jsonb
    ) as answers
  from subs sb
  left join profiles p     on p.id = sb.rep_id
  left join stores st      on st.id = sb.store_id
  left join store_groups g on g.id = st.store_group_id
  order by sb.submitted_at desc, sb.id desc;
$$;

comment on function public.form_response_rows(
  uuid, timestamptz, timestamptz, uuid[], uuid[], int, timestamptz, uuid
) is
  'One row per form submission with its answers as a field_id -> text object, '
  'newest first, keyset-paged on (submitted_at, id). Backs the Form tab''s '
  '"every response" export; form_report backs the charts.';

-- The index the paged read wants. `form_submissions` is indexed on
-- (visit_id) and (org_id, rep_id) — neither helps a template-and-date window
-- ordered by the cursor's own columns, so today this is a filtered sort over
-- every submission the org has ever made. It grows by one row per audit
-- forever, and the export is the one read that walks all of it.
create index if not exists form_submissions_template_submitted_idx
  on public.form_submissions (org_id, form_template_id, submitted_at desc, id desc);
