-- The founding price, billed (20261030200000).
--
--   F1  A founding company's first monthly payment is the plan less its
--       percentage, as a line of its own ("month 1 of 3"), with no setup.
--   F2  The percentage is off the plan only: an add-on is at its full price.
--   F3  Yearly has no founding line (the founding price is monthly).
--   F4  Each paid subscription or renewal charge with a founding line uses a
--       month; failed, cancelled and change charges do not. After the last
--       month the plan is at its full price, still with no setup.
--   F5  A company with no founding price is priced as before: full plan, and
--       setup on its first monthly payment.
--   F6  billing_founding() gives the signed-in manager's company its terms and
--       months left; billing_founding_months_left is not callable by a user.
--   F7  The terms are both set or both empty.
--
-- HOW TO RUN: as billing_paystack.sql. One DO block that always ends in
-- `raise exception`, so nothing survives. Gold Fortune stands in for a
-- company; everything it changes rolls back.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_admin uuid; v_band bigint; v_addon bigint;
  v_j jsonb; v_lines jsonb; v_plan jsonb := '{"seats": 6, "addons": {}}'::jsonb;
  v_n int;
begin
  if to_regprocedure('public.billing_founding()') is null then
    raise exception 'FOUNDING PRICE: SKIPPED (20261030200000 is not on this database)';
  end if;

  select p.id into v_admin from public.profiles p join public.job_roles jr on jr.id = p.job_role_id
   where p.org_id = c_gf and jr.code = 'administrator' and p.is_active order by p.created_at limit 1;
  select amount_cents into v_band from public.price_list
   where code = 'base' and kind = 'base' and period = 'monthly' and 6 between tier_min and tier_max
     and active_from <= current_date and (active_to is null or active_to > current_date);
  select amount_cents into v_addon from public.price_list
   where code = 'warehouse' and kind = 'addon' and period = 'monthly'
     and active_from <= current_date and (active_to is null or active_to > current_date);
  if v_admin is null or v_band is null or v_addon is null then
    raise exception 'Fixtures missing: a Gold Fortune administrator, the 6-place price and the Stock control price.';
  end if;

  -- Gold Fortune as a founding company on its pilot. Its own charges stay:
  -- none has a founding line, so none uses a founding month.
  update public.company_account
     set status = 'trial', trial_ends_at = now() + interval '5 days', plan = null, period = null,
         period_start = null, period_end = null, custom_price_cents = null, setup_charged = false,
         founding_percent_off = 40, founding_months = 3
   where org_id = c_gf;

  ---------------------------------------------------------------- F1 the first month
  v_j := public.billing_lines(c_gf, 'monthly', v_plan, true);
  v_lines := v_j->'lines';
  if (v_j->>'total_cents')::bigint <> v_band - round(v_band * 0.4)::bigint
     or (select count(*) from jsonb_array_elements(v_lines) l where l->>'code' = 'setup') <> 0
     or (select (l->>'amount_cents')::bigint from jsonb_array_elements(v_lines) l where l->>'code' = 'founding') <> -round(v_band * 0.4)::bigint
     or (select l->>'label' from jsonb_array_elements(v_lines) l where l->>'code' = 'founding') <> 'Founding distributor price, 40% off (month 1 of 3)' then
    v_fail := v_fail || format('F1 first founding month: %s', v_j) || E'\n';
  end if;
  if v_band = 349500 and (v_j->>'total_cents')::bigint <> 209700 then
    v_fail := v_fail || format('F1 the 10-place plan is not R2,097: %s', v_j->>'total_cents') || E'\n';
  end if;

  ---------------------------------------------------------------- F2 add-ons at full price
  v_j := public.billing_lines(c_gf, 'monthly', '{"seats": 6, "addons": {"warehouse": 1}}'::jsonb, true);
  if (v_j->>'total_cents')::bigint <> v_band - round(v_band * 0.4)::bigint + v_addon then
    v_fail := v_fail || format('F2 founding price with Stock control and HR: %s', v_j->>'total_cents') || E'\n';
  end if;

  ---------------------------------------------------------------- F3 yearly
  v_j := public.billing_lines(c_gf, 'yearly', v_plan, true);
  if exists (select 1 from jsonb_array_elements(v_j->'lines') l where l->>'code' in ('founding', 'setup')) then
    v_fail := v_fail || format('F3 yearly has a founding or setup line: %s', v_j) || E'\n';
  end if;

  ---------------------------------------------------------------- F4 months used
  -- Charges that use no month: not paid, or not a subscription or renewal.
  insert into public.billing_charges (org_id, reason, status, period, plan_after, lines, total_cents)
  select c_gf, r, s, 'monthly', v_plan, v_lines, 209700
    from (values ('subscribe', 'failed'), ('subscribe', 'cancelled'), ('renewal', 'pending'), ('change', 'paid')) x(r, s);
  if public.billing_founding_months_left(c_gf) <> 3 then
    v_fail := v_fail || format('F4 unpaid or change charges used a month: %s left', public.billing_founding_months_left(c_gf)) || E'\n';
  end if;
  -- Paid at the founding price: a month each.
  insert into public.billing_charges (org_id, reason, status, period, plan_after, lines, total_cents)
  values (c_gf, 'subscribe', 'paid', 'monthly', v_plan, v_lines, 209700);
  v_j := public.billing_lines(c_gf, 'monthly', v_plan, false);
  if (select l->>'label' from jsonb_array_elements(v_j->'lines') l where l->>'code' = 'founding')
     is distinct from 'Founding distributor price, 40% off (month 2 of 3)' then
    v_fail := v_fail || format('F4 second month: %s', v_j) || E'\n';
  end if;
  insert into public.billing_charges (org_id, reason, status, period, plan_after, lines, total_cents)
  values (c_gf, 'renewal', 'paid', 'monthly', v_plan, v_lines, 209700),
         (c_gf, 'renewal', 'paid', 'monthly', v_plan, v_lines, 209700);
  v_j := public.billing_lines(c_gf, 'monthly', v_plan, true);
  if public.billing_founding_months_left(c_gf) <> 0
     or (v_j->>'total_cents')::bigint <> v_band
     or exists (select 1 from jsonb_array_elements(v_j->'lines') l where l->>'code' in ('founding', 'setup')) then
    v_fail := v_fail || format('F4 after the founding months: %s left, %s', public.billing_founding_months_left(c_gf), v_j) || E'\n';
  end if;

  ---------------------------------------------------------------- F5 not founding
  update public.company_account set founding_percent_off = null, founding_months = null where org_id = c_gf;
  v_j := public.billing_lines(c_gf, 'monthly', v_plan, true);
  if (v_j->>'total_cents')::bigint <> v_band + 250000
     or exists (select 1 from jsonb_array_elements(v_j->'lines') l where l->>'code' = 'founding')
     or public.billing_founding_months_left(c_gf) is not null then
    v_fail := v_fail || format('F5 a company with no founding price: %s', v_j) || E'\n';
  end if;

  ---------------------------------------------------------------- F6 who sees it
  -- Only this suite's charges carry a founding line, and none has a payment.
  delete from public.billing_charges where org_id = c_gf and lines @> '[{"code": "founding"}]'::jsonb;
  update public.company_account set founding_percent_off = 40, founding_months = 3 where org_id = c_gf;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_j := public.billing_founding();
  if v_j is distinct from '{"percent_off": 40, "months": 3, "months_left": 3}'::jsonb then
    v_fail := v_fail || format('F6 billing_founding(): %s', v_j) || E'\n';
  end if;
  v_j := public.billing_quote('monthly', 6, '{}'::jsonb);
  if not exists (select 1 from jsonb_array_elements(v_j->'lines') l where l->>'code' = 'founding') then
    v_fail := v_fail || format('F6 the quote has no founding line: %s', v_j) || E'\n';
  end if;
  begin
    perform public.billing_founding_months_left(c_gf);
    v_fail := v_fail || 'F6 billing_founding_months_left is callable by a user' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- F7 both or neither
  begin
    update public.company_account set founding_months = null where org_id = c_gf;
    v_fail := v_fail || 'F7 a percentage with no months was accepted' || E'\n';
  exception when check_violation then null;
  end;
  begin
    update public.company_account set founding_percent_off = 0 where org_id = c_gf;
    v_fail := v_fail || 'F7 0% off was accepted' || E'\n';
  exception when check_violation then null;
  end;

  if v_fail <> '' then
    raise exception E'FOUNDING PRICE FAILED:\n%', v_fail;
  end if;
  raise exception 'FOUNDING PRICE: ALL PASSED (rolled back)';
end
$$;
