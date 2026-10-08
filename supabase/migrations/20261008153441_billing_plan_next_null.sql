-- Fix: "no change at renewal" was stored as JSON null, and a renewal then
-- priced the plan as having no seats.
--
-- Found 8 Oct 2026 by the Payfast sandbox run of Stage 6: after a paid "more
-- users" change, company_account.plan_next held the JSON value null (not SQL
-- NULL). billing_change_lines built `'plan_next', case … end` inside
-- jsonb_build_object, which turns a NULL into JSON null, and
-- billing_request_change / billing_record_payment copied `v_c->'plan_next'`
-- as it was. billing_prepare_due's coalesce(plan_next, plan) then picked the
-- JSON null, so the renewal was written for 1 seat (the active users) with no
-- add-ons, and paying it would have switched paid add-ons off.
-- (billing.sql's B5 hid it: it set plan_next by hand before the renewal.)
--
-- The fix: billing_change_lines leaves the key out when there is nothing to
-- apply (jsonb_strip_nulls), so every reader gets SQL NULL; rows already
-- holding JSON null are set to SQL NULL; and both columns now refuse anything
-- but SQL NULL or an object, so it cannot come back unnoticed.
--
-- Rollback: supabase/rollback/<this version>_billing_plan_next_null.down.sql.

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

  -- jsonb_strip_nulls: with nothing to apply at renewal, `plan_next` is left
  -- out rather than written as JSON null, so callers reading ->'plan_next'
  -- get SQL NULL (see the header of this migration).
  return jsonb_strip_nulls(jsonb_build_object(
    'plan_after', v_up,
    'plan_next', case when v_less then public.billing_plan((p_plan->>'seats')::int, p_plan->'addons') end,
    'more', v_more, 'less', v_less,
    'lines', v_lines,
    'total_cents', (select coalesce(sum((l->>'amount_cents')::bigint), 0) from jsonb_array_elements(v_lines) l),
    'next_total_cents', (public.billing_lines(p_org, a.period,
        public.billing_plan((p_plan->>'seats')::int, p_plan->'addons'), false)->>'total_cents')::bigint,
    'period_end', a.period_end));
end;
$function$;
revoke all on function public.billing_change_lines(uuid, jsonb, timestamptz) from public, anon, authenticated;

update public.company_account set plan_next = null where plan_next = 'null'::jsonb;
update public.billing_charges set plan_next = null where plan_next = 'null'::jsonb;

alter table public.company_account
  add constraint company_account_plan_next_shape check (plan_next is null or jsonb_typeof(plan_next) = 'object');
alter table public.billing_charges
  add constraint billing_charges_plan_next_shape check (plan_next is null or jsonb_typeof(plan_next) = 'object');
