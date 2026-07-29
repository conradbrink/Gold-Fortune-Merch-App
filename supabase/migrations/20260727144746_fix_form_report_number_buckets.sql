-- The first cut emitted one bucket per distinct value, capped at 25. That is
-- right for facings (integers 1–15) but wrong for a continuous measure: shelf
-- price has 262 distinct values, so the "distribution" was really just the 25
-- cheapest prices sorted ascending — a chart that looks plausible and means
-- nothing. Branch on cardinality: exact bars for low-cardinality integers,
-- equal-width range bins otherwise. Both shapes now use {label, count}.
create or replace function public.form_report(
  p_template_id uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_rep_ids     uuid[] default null,
  p_store_ids   uuid[] default null
)
returns table (
  field_id       uuid,
  label          text,
  field_type     text,
  metric_key     text,
  sort_order     int,
  response_count bigint,
  stats          jsonb
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
    select s.id, s.submitted_at
    from form_submissions s
    left join visits v on v.id = s.visit_id
    cross join cfg
    where s.org_id = cfg.org
      and s.form_template_id = p_template_id
      and s.submitted_at >= p_from
      and s.submitted_at <  p_to
      and (p_rep_ids   is null or s.rep_id   = any(p_rep_ids))
      and (p_store_ids is null or v.store_id = any(p_store_ids))
  ),
  resp as materialized (
    select r.form_field_id, r.value_text, r.value_number, r.value_boolean,
           r.photo_id, sb.id as sub_id, sb.submitted_at
    from form_responses r
    join subs sb on sb.id = r.form_submission_id
  )
  select
    f.id, f.label, f.field_type, f.metric_key, f.sort_order,
    (select count(*) from resp r where r.form_field_id = f.id) as response_count,
    case f.field_type

      when 'number' then (
        with vals as (
          select r.value_number as v
          from resp r
          where r.form_field_id = f.id and r.value_number is not null
        ),
        b as (
          select min(v) as mn, max(v) as mx, count(*) as n,
                 count(distinct v) as d, coalesce(bool_and(v = round(v)), false) as all_int
          from vals
        )
        select jsonb_build_object(
          'min', b.mn,
          'avg', (select round(avg(v), 2) from vals),
          'max', b.mx,
          'sum', (select sum(v) from vals),
          'buckets', case
            when b.n = 0 then '[]'::jsonb
            -- Discrete counts (facings): one bar per exact value.
            when b.all_int and b.d <= 25 then coalesce((
              select jsonb_agg(jsonb_build_object('label', t.v::text, 'count', t.c) order by t.v)
              from (select v, count(*) as c from vals group by v) t
            ), '[]'::jsonb)
            -- Continuous measures (price): ten equal-width range bins.
            when b.mx > b.mn then coalesce((
              select jsonb_agg(jsonb_build_object(
                       'label', round(b.mn + (i - 1) * s.step, 2)::text || ' – ' ||
                                round(b.mn + i * s.step, 2)::text,
                       'count', (select count(*) from vals
                                  where v >= b.mn + (i - 1) * s.step
                                    and (v < b.mn + i * s.step or i = 10))
                     ) order by i)
              from generate_series(1, 10) as i,
                   lateral (select (b.mx - b.mn) / 10.0 as step) s
            ), '[]'::jsonb)
            -- Every response identical: one bar, not a divide-by-zero.
            else jsonb_build_array(jsonb_build_object('label', b.mn::text, 'count', b.n))
          end
        )
        from b
      )

      when 'boolean' then (
        select jsonb_build_object(
          'yes', count(*) filter (where r.value_boolean),
          'no',  count(*) filter (where not r.value_boolean)
        )
        from resp r
        where r.form_field_id = f.id and r.value_boolean is not null
      )

      -- Options with zero responses must still appear, or "nobody ever picks
      -- Top shelf" becomes invisible instead of being the finding.
      when 'multiple_choice' then (
        select jsonb_build_object('options', coalesce(
          jsonb_agg(jsonb_build_object('option', o.opt, 'count', o.n) order by o.ord),
          '[]'::jsonb))
        from (
          select opt.value #>> '{}' as opt,
                 opt.ordinality     as ord,
                 (select count(*) from resp r
                   where r.form_field_id = f.id
                     and r.value_text = opt.value #>> '{}') as n
          from jsonb_array_elements(coalesce(f.options, '[]'::jsonb))
               with ordinality as opt(value, ordinality)
        ) o
      )

      when 'photo' then (
        select jsonb_build_object(
          'count', (select count(*) from resp r2
                     join photos p2 on p2.id = r2.photo_id
                     where r2.form_field_id = f.id),
          -- Capped: a 90-day range holds hundreds, and each path costs a
          -- signed-URL slot on the client.
          'paths', coalesce((
            select jsonb_agg(t.storage_path)
            from (
              select p.storage_path
              from resp r join photos p on p.id = r.photo_id
              where r.form_field_id = f.id and p.storage_path is not null
              order by p.taken_at desc nulls last
              limit 60
            ) t
          ), '[]'::jsonb)
        )
      )

      when 'text' then (
        select jsonb_build_object('recent', coalesce(jsonb_agg(t.x), '[]'::jsonb))
        from (
          select jsonb_build_object(
                   'text', r.value_text,
                   'submitted_at', r.submitted_at
                 ) as x
          from resp r
          where r.form_field_id = f.id
            and nullif(btrim(r.value_text), '') is not null
          order by r.submitted_at desc
          limit 20
        ) t
      )
    end as stats
  from form_fields f
  where f.form_template_id = p_template_id
  order by f.sort_order;
$$;
