-- Rollback of 20261030200000_founding_price_billed. billing_lines goes back to
-- its definition before it (pg_get_functiondef md5
-- f08ef7e513373f89cbd980d1eab7110c), undone in place by the same anchors.
-- Charges already written keep their founding lines; renewals written after
-- this are at the plan's full price.

do $$
declare
  def text := pg_get_functiondef('public.billing_lines(uuid, text, jsonb, boolean)'::regprocedure);
  edits constant text[][] := array[
    array[$b$
  a          record;
  v_pct      smallint;
  v_months   smallint;
  v_left     int;
  v_off      bigint;
$b$, $a$
  a          record;
$a$],
    array[$b$
  select custom_price_cents, founding_percent_off, founding_months
    into v_custom, v_pct, v_months
    from public.company_account where org_id = p_org;
$b$, $a$
  select custom_price_cents into v_custom from public.company_account where org_id = p_org;
$a$],
    array[$b$
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
$b$, $a$
  for a in select key, value from jsonb_each(coalesce(p_plan->'addons', '{}'::jsonb)) order by key loop
$a$],
    array[$b$
  if p_with_setup and p_period = 'monthly' and v_pct is null then
$b$, $a$
  if p_with_setup and p_period = 'monthly' then
$a$]];
  i int;
begin
  for i in 1 .. array_length(edits, 1) loop
    if (length(def) - length(replace(def, edits[i][1], ''))) / length(edits[i][1]) <> 1 then
      raise exception 'billing_lines rollback: expected 1 of "%"', edits[i][1];
    end if;
    def := replace(def, edits[i][1], edits[i][2]);
  end loop;
  execute def;
end;
$$;

drop function public.billing_founding();
drop function public.billing_founding_months_left(uuid);

alter table public.company_account
  drop constraint company_account_founding_check,
  drop column founding_months,
  drop column founding_percent_off;
