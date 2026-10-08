-- Rollback for billing_plan_next_null: billing_change_lines as the billing
-- migration wrote it, and the two shape checks dropped. Rows set from JSON
-- null to SQL NULL stay so (both mean "nothing at renewal").

alter table public.billing_charges drop constraint billing_charges_plan_next_shape;
alter table public.company_account drop constraint company_account_plan_next_shape;

create or replace function public.billing_change_lines(p_org uuid, p_plan jsonb, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  a        public.company_account;
  v_up     jsonb;
  v_old    jsonb;
  v_new    jsonb;
  v_share  numeric;
  v_lines  jsonb := '[]'::jsonb;
  v_more   boolean := false;
  v_less   boolean := false;
  n        record;
  v_was    bigint;
  v_amount bigint;
begin
  select * into a from public.company_account where org_id = p_org;
  if a.status not in ('active', 'past_due') or a.plan is null then
    raise exception 'There is no plan to change yet.' using errcode = '22023';
  end if;
  if a.custom_price_cents is not null then
    raise exception 'Your plan was arranged with us. Talk to us to change it.' using errcode = '22023';
  end if;

  -- Seats and every add-on quantity: the larger of now and asked for is what
  -- is paid for until the renewal.
  v_up := jsonb_build_object(
    'seats', greatest((a.plan->>'seats')::int, (p_plan->>'seats')::int),
    'addons', coalesce((
      select jsonb_object_agg(k, greatest(coalesce((a.plan->'addons'->>k)::int, 0),
                                          coalesce((p_plan->'addons'->>k)::int, 0)) order by k)
        from (select jsonb_object_keys(coalesce(a.plan->'addons', '{}'::jsonb)) k
              union select jsonb_object_keys(coalesce(p_plan->'addons', '{}'::jsonb))) keys), '{}'::jsonb));
  v_up := public.billing_plan((v_up->>'seats')::int, v_up->'addons');

  v_more := v_up <> a.plan;
  v_less := public.billing_plan((p_plan->>'seats')::int, p_plan->'addons') <> v_up;

  v_old := public.billing_lines(p_org, a.period, a.plan, false);
  v_new := public.billing_lines(p_org, a.period, v_up, false);
  v_share := public.billing_remaining_share(a.period_start, a.period_end, p_now);

  for n in select l from jsonb_array_elements(v_new->'lines') l loop
    select coalesce(sum((o->>'amount_cents')::bigint), 0) into v_was
      from jsonb_array_elements(v_old->'lines') o where o->>'code' = n.l->>'code';
    v_amount := round(((n.l->>'amount_cents')::bigint - v_was) * v_share);
    if v_amount > 0 then
      v_lines := v_lines || (n.l || jsonb_build_object(
        'label', (n.l->>'label') || ', to ' || to_char(a.period_end at time zone 'UTC', 'FMDD Mon YYYY'),
        'amount_cents', v_amount, 'prorated', true));
    end if;
  end loop;

  return jsonb_build_object(
    'plan_after', v_up,
    'plan_next', case when v_less then public.billing_plan((p_plan->>'seats')::int, p_plan->'addons') end,
    'more', v_more, 'less', v_less,
    'lines', v_lines,
    'total_cents', (select coalesce(sum((l->>'amount_cents')::bigint), 0) from jsonb_array_elements(v_lines) l),
    'next_total_cents', (public.billing_lines(p_org, a.period,
        public.billing_plan((p_plan->>'seats')::int, p_plan->'addons'), false)->>'total_cents')::bigint,
    'period_end', a.period_end);
end;
$function$;
