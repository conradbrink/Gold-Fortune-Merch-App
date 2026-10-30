-- The founding price, billed (owner, 30 Oct 2026: "we're giving them the price
-- of R2097 per month - so there should be a checkout button").
--
-- The founding offer (lib/founding-offer.ts, 20 Oct 2026) is a free pilot, then
-- 40% off the plan that fits for the first 3 months, then the plan's normal
-- price, with the setup done for them. Until now nothing billed it: the plans
-- page sent a message to our team, who were to set a custom price by hand,
-- and a founding company that paid by card in Settings > Plan was charged the
-- full plan plus setup (R3,495 + R2,500 on the 10-rep plan).
--
-- * company_account.founding_percent_off and founding_months: a founding
--   company's terms, kept on its own account so a later change to the offer
--   does not change what it was promised. Both or neither. The operator's
--   "Start on the free pilot" (web/app/platform/actions.ts) sets them; this
--   sets them for the distributors on a pilot now that have never paid.
-- * billing_founding_months_left(org): its founding months less the
--   subscription and renewal charges it has paid at the founding price. Taken
--   from paid charges rather than counted down, so a payment that fails and is
--   tried again, a cancelled checkout or a change charge uses no month.
-- * billing_lines: while a monthly company has founding months left, one more
--   line under the plan, "Founding distributor price, 40% off (month 1 of 3)",
--   the plan's price times the percentage, negative. The checkout, renewals
--   (billing_prepare_due) and invoices all take their lines from here, so all
--   three show it. Not on yearly: the founding price is monthly. A founding
--   company is never charged setup: setup is part of the offer.
-- * billing_founding(): the signed-in company's founding terms and months
--   left, for the plans page and the checkout. Null when it has none.
--
-- billing_lines is changed in place on its live definition, anchored on exact
-- text, as 20261029233700 did: if an anchor is not found exactly once, nothing
-- is changed. billing_change_lines needs no change: it compares lines by code
-- and charges only what went up, so the founding line (negative) never adds to
-- a change charge.
--
-- Rollback: supabase/rollback/20261030200000_founding_price_billed.down.sql.

alter table public.company_account
  add column founding_percent_off smallint,
  add column founding_months smallint,
  -- Both or neither; written so that a NULL cannot pass for "true".
  add constraint company_account_founding_check check (
    (founding_percent_off is null) = (founding_months is null)
    and coalesce(founding_percent_off between 1 and 100, true)
    and coalesce(founding_months between 1 and 24, true));

comment on column public.company_account.founding_percent_off is
  'The founding price: this much off the plan''s monthly price for the first founding_months months paid (20261030200000). Null for a company not on the founding offer.';
comment on column public.company_account.founding_months is
  'How many monthly payments are at the founding price. Set with founding_percent_off.';

-- The distributors on a pilot now that have never paid: the founding companies.
update public.company_account a
   set founding_percent_off = 40, founding_months = 3, updated_at = now()
 where a.status = 'trial' and a.trial_ends_at is not null and a.custom_price_cents is null
   and exists (select 1 from public.organizations o where o.id = a.org_id and 'distribution' = any (o.industries))
   and not exists (select 1 from public.billing_charges c where c.org_id = a.org_id and c.status = 'paid');

create or replace function public.billing_founding_months_left(p_org uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select greatest(a.founding_months - (
           select count(*)::int from public.billing_charges c
            where c.org_id = p_org and c.status = 'paid' and c.reason in ('subscribe', 'renewal')
              and c.lines @> '[{"code": "founding"}]'::jsonb), 0)
    from public.company_account a
   where a.org_id = p_org and a.founding_percent_off is not null;
$function$;

revoke all on function public.billing_founding_months_left(uuid) from public, anon, authenticated;
grant execute on function public.billing_founding_months_left(uuid) to service_role;

comment on function public.billing_founding_months_left(uuid) is
  'A founding company''s monthly payments still at the founding price: its founding_months less the subscription and renewal charges paid with a founding line. Null when it has no founding price.';

create or replace function public.billing_founding()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when a.founding_percent_off is not null then
           jsonb_build_object('percent_off', a.founding_percent_off, 'months', a.founding_months,
                              'months_left', public.billing_founding_months_left(a.org_id))
         end
    from public.company_account a
   where a.org_id = public.billing_my_org();
$function$;

revoke all on function public.billing_founding() from public, anon;
grant execute on function public.billing_founding() to authenticated, service_role;

comment on function public.billing_founding() is
  'The signed-in company''s founding price: percent_off, months and months_left, or null. For someone who manages the company settings (billing_my_org).';

-- billing_lines: the founding line, and no setup for a founding company.
do $$
declare
  def text := pg_get_functiondef('public.billing_lines(uuid, text, jsonb, boolean)'::regprocedure);
  edits constant text[][] := array[
    -- The founding terms, read with the custom price.
    array[$a$
  a          record;
$a$, $b$
  a          record;
  v_pct      smallint;
  v_months   smallint;
  v_left     int;
  v_off      bigint;
$b$],
    array[$a$
  select custom_price_cents into v_custom from public.company_account where org_id = p_org;
$a$, $b$
  select custom_price_cents, founding_percent_off, founding_months
    into v_custom, v_pct, v_months
    from public.company_account where org_id = p_org;
$b$],
    -- The founding line, under the plan's and before the add-ons: the
    -- percentage is off the plan, not off an add-on.
    array[$a$
  for a in select key, value from jsonb_each(coalesce(p_plan->'addons', '{}'::jsonb)) order by key loop
$a$, $b$
  -- The founding price (20261030200000): for its first months paid monthly.
  if v_pct is not null and p_period = 'monthly' then
    v_left := coalesce(public.billing_founding_months_left(p_org), 0);
    if v_left > 0 then
      v_off := round(v_base.amount_cents * v_pct / 100.0)::bigint;
      v_lines := v_lines || jsonb_build_object('code', 'founding',
                   'label', format('Founding distributor price, %s%% off (month %s of %s)', v_pct, v_months - v_left + 1, v_months),
                   'quantity', 1, 'unit_cents', -v_off, 'amount_cents', -v_off);
    end if;
  end if;

  for a in select key, value from jsonb_each(coalesce(p_plan->'addons', '{}'::jsonb)) order by key loop
$b$],
    -- Setup is part of the founding offer.
    array[$a$
  if p_with_setup and p_period = 'monthly' then
$a$, $b$
  if p_with_setup and p_period = 'monthly' and v_pct is null then
$b$]];
  i int;
begin
  for i in 1 .. array_length(edits, 1) loop
    if (length(def) - length(replace(def, edits[i][1], ''))) / length(edits[i][1]) <> 1 then
      raise exception 'billing_lines: expected 1 of the anchor "%"', edits[i][1];
    end if;
    def := replace(def, edits[i][1], edits[i][2]);
  end loop;
  execute def;
end;
$$;
