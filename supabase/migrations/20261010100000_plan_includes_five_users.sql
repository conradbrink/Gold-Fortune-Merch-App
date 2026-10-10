-- The base plan includes 5 users instead of 3, at the same price (owner,
-- 10 Oct 2026; the sales site says the same since #122).
--
-- Prices are data with dates (price_list): the two 3-user base rows end on
-- 10 Oct 2026 and two 5-user rows, at the same amounts, start that day, so
-- the old price stays on record. billing_lines takes the active base row, so
-- every quote, first payment and renewal from 10 Oct counts 5 included users
-- before any extra user is charged. No company pays yet (one trial, and Gold
-- Fortune, which is exempt), so no running plan changes price.
--
-- price_list is created by 20261008091250_billing (on the billing branch,
-- already applied on production). On a database without it this does nothing.

do $$
begin
  if to_regclass('public.price_list') is null then
    raise notice 'price_list does not exist yet; nothing to change.';
    return;
  end if;

  insert into public.price_list
    (code, kind, period, module_code, unit, tier_min, tier_max, amount_cents, included_users, included_roles, label, active_from)
  select 'base', 'base', p.period, null, 'company', null, null, p.amount_cents, 5, null, 'Plan with 5 users', date '2026-10-10'
    from public.price_list p
   where p.code = 'base' and p.kind = 'base' and p.included_users = 3
     and p.active_from < date '2026-10-10' and p.active_to is null;

  update public.price_list
     set active_to = date '2026-10-10'
   where code = 'base' and kind = 'base' and included_users = 3
     and active_from < date '2026-10-10' and active_to is null;
end
$$;
