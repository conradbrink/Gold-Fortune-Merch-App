-- Plans by the number of reps (20261020160000).
--
--   R1  The price is the band the plan's reps fall in: up to 5 R1,995, up to
--       10 R3,495, up to 15 R5,995 a month (a year is 10 months), one line,
--       no extra users; setup is added on monthly only; above 15 is priced on
--       request (hint 'quote').
--   R2  The 5-user base price and the extra-user price ended on 20 Oct 2026
--       and are kept on record.
--   R3  Only active reps take a place: billing_seats_used counts them, not
--       managers, office or warehouse logins.
--   R4  profiles_user_limit stops a rep beyond the places, on a pilot and on a
--       paid plan, and never stops a login that is not a rep.
--
-- Needs the billing tables (20261008091250_billing, on production; its file
-- arrives with #91). Without them the suite says so and checks nothing.
--
-- HOW TO RUN: as trial_offers.sql. One DO block that always ends in
-- `raise exception`, so nothing survives. Gold Fortune stands in for a
-- company; everything it changes rolls back.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_j jsonb; v_n int; v_reps int; v_other uuid; v_rep uuid; v_hint text; v_msg text;
  t record;
begin
  if to_regclass('public.price_list') is null then
    raise exception 'REP PLANS: SKIPPED (no billing tables on this database)';
  end if;

  ---------------------------------------------------------------- R1 the bands
  -- Priced as listed, not as agreed with one company.
  update public.company_account set custom_price_cents = null where org_id = c_gf;
  for t in select * from (values
      ('monthly', 1, 199500::bigint, 'Plan for up to 5 reps'),
      ('monthly', 5, 199500, 'Plan for up to 5 reps'),
      ('monthly', 6, 349500, 'Plan for up to 10 reps'),
      ('monthly', 10, 349500, 'Plan for up to 10 reps'),
      ('monthly', 11, 599500, 'Plan for up to 15 reps'),
      ('monthly', 15, 599500, 'Plan for up to 15 reps'),
      ('yearly', 4, 1995000, 'Plan for up to 5 reps'),
      ('yearly', 10, 3495000, 'Plan for up to 10 reps'),
      ('yearly', 15, 5995000, 'Plan for up to 15 reps')) x(period, seats, cents, label)
  loop
    v_j := public.billing_lines(c_gf, t.period, public.billing_plan(t.seats, '{}'::jsonb), false);
    if jsonb_array_length(v_j->'lines') <> 1 or v_j->'lines'->0->>'code' <> 'base'
       or (v_j->>'total_cents')::bigint <> t.cents or v_j->'lines'->0->>'label' <> t.label then
      v_fail := v_fail || format('R1 %s reps %s: %s (expected one line, %s, %s)', t.seats, t.period, v_j, t.cents, t.label) || E'\n';
    end if;
  end loop;
  v_j := public.billing_lines(c_gf, 'monthly', public.billing_plan(8, '{}'::jsonb), true);
  if (v_j->>'total_cents')::bigint <> 349500 + 250000
     or not exists (select 1 from jsonb_array_elements(v_j->'lines') l where l->>'code' = 'setup') then
    v_fail := v_fail || format('R1 monthly with setup: %s', v_j) || E'\n';
  end if;
  v_j := public.billing_lines(c_gf, 'yearly', public.billing_plan(8, '{}'::jsonb), true);
  if (v_j->>'total_cents')::bigint <> 3495000 then
    v_fail := v_fail || format('R1 yearly charged setup: %s', v_j) || E'\n';
  end if;
  begin
    perform public.billing_lines(c_gf, 'monthly', public.billing_plan(16, '{}'::jsonb), false);
    v_fail := v_fail || 'R1 a plan for 16 reps was priced' || E'\n';
  exception when sqlstate '22023' then
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
    if v_hint is distinct from 'quote' or v_msg not like '%16 reps%' then
      v_fail := v_fail || format('R1 16 reps refused as %s (%s)', v_msg, v_hint) || E'\n';
    end if;
  end;

  ---------------------------------------------------------------- R2 old prices ended
  if exists (select 1 from public.price_list
              where kind in ('base', 'extra_user') and tier_min is null
                and active_from <= current_date and (active_to is null or active_to > current_date)) then
    v_fail := v_fail || 'R2 an old base or extra-user price is still active' || E'\n';
  end if;
  if not exists (select 1 from public.price_list where kind = 'extra_user' and active_to = date '2026-10-20')
     or not exists (select 1 from public.price_list where kind = 'base' and included_users = 5 and active_to = date '2026-10-20') then
    v_fail := v_fail || 'R2 the old prices are not kept on record' || E'\n';
  end if;

  ---------------------------------------------------------------- R3 only reps count
  select count(*) into v_reps from public.profiles where org_id = c_gf and is_active and role = 'rep';
  select count(*) into v_n from public.profiles where org_id = c_gf and is_active and role <> 'rep';
  if v_n = 0 then
    raise exception 'Fixtures missing: Gold Fortune needs a login that is not a rep.';
  end if;
  if public.billing_seats_used(c_gf, public.billing_plan(1, '{}'::jsonb)) <> v_reps then
    v_fail := v_fail || format('R3 seats used %s, expected the %s reps', public.billing_seats_used(c_gf, public.billing_plan(1, '{}'::jsonb)), v_reps) || E'\n';
  end if;

  ---------------------------------------------------------------- R4 the limit
  select id into v_other from public.profiles where org_id = c_gf and is_active and role <> 'rep' order by created_at limit 1;
  select id into v_rep from public.profiles where org_id = c_gf and is_active and role = 'rep' order by created_at limit 1;
  -- On a pilot, the places are exactly the reps it has now.
  update public.company_account set status = 'trial', plan = null, trial_ends_at = now() + interval '10 days' where org_id = c_gf;
  update public.platform_settings set value = to_jsonb(v_reps) where key = 'trial_user_limit';
  begin
    update public.profiles set role = role where id = v_other;
  exception when others then
    v_fail := v_fail || format('R4 a login that is not a rep was stopped on a pilot: %s', sqlerrm) || E'\n';
  end;
  begin
    update public.profiles set role = role where id = v_rep;
  exception when others then
    v_fail := v_fail || format('R4 a rep within the places was stopped: %s', sqlerrm) || E'\n';
  end;
  begin
    update public.profiles set role = 'rep' where id = v_other;
    v_fail := v_fail || 'R4 one rep too many was let in on a pilot' || E'\n';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
    if v_hint is distinct from 'user_limit' or v_msg <> format('All %s places on your plan are taken.', v_reps) then
      v_fail := v_fail || format('R4 refused as %s (%s)', v_msg, v_hint) || E'\n';
    end if;
  end;
  -- On a paid plan, the plan's places.
  update public.company_account set status = 'active', plan = public.billing_plan(v_reps, '{}'::jsonb) where org_id = c_gf;
  begin
    update public.profiles set role = role where id = v_other;
  exception when others then
    v_fail := v_fail || format('R4 a login that is not a rep was stopped on a paid plan: %s', sqlerrm) || E'\n';
  end;
  begin
    update public.profiles set role = 'rep' where id = v_other;
    v_fail := v_fail || 'R4 one rep too many was let in on a paid plan' || E'\n';
  exception when sqlstate 'P0001' then null;
  end;

  if v_fail <> '' then
    raise exception E'REP PLANS FAILED:\n%', v_fail;
  end if;
  raise exception 'REP PLANS: ALL PASSED (rolled back)';
end
$$;
