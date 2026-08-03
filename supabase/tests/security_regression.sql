-- Security regression suite.
--
-- Every check here corresponds to a hole that was open on 29 or 30 July 2026, or
-- to an invariant a new table has to hold. **30 checks** — 1-18 are the 29 July
-- audit; 19-20 the `territory_reps` tenancy gap, 21-22 the per-user
-- `dashboard_layouts`, 23-24 `territories_enforce_shape` ignoring dependents on
-- UPDATE, and 25-26 the territory depth and tenancy invariants, all found in
-- review on 30 July. 27-30 are the warehouse module of 2 August: the third role
-- and the order/adjustment tables it brought with it.
--
-- 25 and 26 are invariants about the *data*, not attacks: the races that could
-- produce those states need two interleaved sessions to stage, which one
-- connection cannot do (see `territory_reparent_race.sh`). They catch the result
-- however it arose.
--
-- The checks are written as attacks, not as assertions about policy text, because
-- the manager-escalation bug came from a policy that read correctly for weeks:
-- `profiles_update` said `id = auth.uid()`, which is true and sounds right, and
-- permitted a rep to set their own role.
--
-- Two rules the fixtures learned the hard way, both from false readings:
--
--   * **Create fixtures; never query tenant data for them.** A real saved layout
--     collided with check 21's insert and was reported as a regression; a tenant
--     with no root territory made check 20 skip itself in silence.
--   * **Every attack gets a control** asserting the legitimate case still works —
--     a lock that also breaks real use is one the next person removes in a hurry.
--   * **A schema change can break the fixtures rather than the checks.** The
--     country tier landed and this file stopped running at all: its territory
--     fixtures had no country parent, so the suite aborted before check 19 and
--     reported nothing. Every territory fixture now creates its own country.
--     If this file raises anything other than PASSED or SECURITY REGRESSIONS,
--     the suite is broken, not the database — fix it before trusting a green run.
--
-- And the rule those three add up to: **a probe that passes for the wrong reason
-- is worse than one that fails**, because it is counted as coverage. So a check
-- that asserts something is refused has to say *which guard* refused it. Check
-- 23's comment is the worked example — a foreign key was answering for a trigger
-- that had been deleted. Where the refusal is an error, the checks below match on
-- its message or SQLSTATE; where it is RLS quietly returning no rows, they prove
-- first that the rows exist and that the impersonated caller is who the check
-- thinks, because "zero rows" is also what an empty table and a deactivated user
-- look like.
--
-- HOW TO RUN
--
--   Supabase MCP:  paste this whole file into execute_sql
--   psql:          psql "$DATABASE_URL" -f supabase/tests/security_regression.sql
--
-- The whole file runs inside one transaction that always rolls back, so it is
-- safe against production and leaves nothing behind. It raises on the first
-- failure with the check that failed; silence at the end means everything held.
--
-- It needs at least one manager, two reps and one store to exist.

do $$
declare
  v_org uuid; v_mgr uuid; v_rep uuid; v_rep2 uuid; v_store uuid;
  v_visit uuid; v_n int; v_r jsonb; v_fail text := '';
  v_other_org uuid; v_other_terr uuid; v_terr uuid;
  v_shape_main uuid; v_shape_other uuid;
  v_other_country uuid; v_own_country uuid;
  v_other_region uuid; v_own_region uuid; v_shape_region uuid; v_err text;
  -- Warehouse module (checks 27-30).
  v_loc uuid; v_prod uuid;
  v_order_other uuid; v_order_own uuid; v_order_clerk uuid;
  v_adj uuid; v_adj_mgr uuid; v_decided text;

begin
  select id, org_id into v_mgr, v_org from public.profiles where role = 'manager' limit 1;
  select id into v_rep  from public.profiles where role = 'rep' and org_id = v_org order by full_name limit 1;
  select id into v_rep2 from public.profiles where role = 'rep' and org_id = v_org and id <> v_rep limit 1;
  select id into v_store from public.stores where org_id = v_org limit 1;

  if v_mgr is null or v_rep is null or v_rep2 is null or v_store is null then
    raise exception 'Fixtures missing: need a manager, two reps and a store.';
  end if;

  -- Seed a visit belonging to the *other* rep, for the cross-user checks.
  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkin_lat, checkin_lng, client_generated_id)
  values (v_org, v_rep2, v_store, 'checked_out', now() - interval '2 days', -24.6, 25.9, gen_random_uuid());

  -- Everything below runs AS A FIELD REP.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------------- privileges

  -- 1. A rep must not be able to promote themselves.
  begin
    update public.profiles set role = 'manager' where id = v_rep;
    v_fail := v_fail || '1. a rep could set their own role' || E'\n';
  exception when others then null; end;

  -- 2. A rep must not be able to switch their own account on or off.
  begin
    update public.profiles set is_active = true where id = v_rep;
    v_fail := v_fail || '2. a rep could set their own is_active' || E'\n';
  exception when others then null; end;

  -- 3. A rep must not be able to move themselves between organisations.
  begin
    update public.profiles set org_id = gen_random_uuid() where id = v_rep;
    v_fail := v_fail || '3. a rep could change their own org_id' || E'\n';
  exception when others then null; end;

  -- 4. Editing their own ordinary details must still work — a lock that also
  --    breaks legitimate use gets removed by the next person in a hurry.
  begin
    update public.profiles set phone = '+267 71 000 000' where id = v_rep;
    get diagnostics v_n = row_count;
    if v_n <> 1 then v_fail := v_fail || '4. a rep could NOT edit their own phone' || E'\n'; end if;
  exception when others then
    v_fail := v_fail || '4. a rep could NOT edit their own phone: ' || sqlerrm || E'\n'; end;

  -- 5. No reaching into another rep's profile.
  update public.profiles set full_name = 'tampered' where id = v_rep2;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_fail := v_fail || '5. a rep could edit another rep''s profile' || E'\n'; end if;

  ------------------------------------------------------------------- tenancy

  -- 6. Another rep's visits are not visible.
  select count(*) into v_n from public.visits where rep_id = v_rep2;
  if v_n > 0 then v_fail := v_fail || '6. a rep could read another rep''s visits' || E'\n'; end if;

  -- 7. Nor their GPS trail.
  select count(*) into v_n from public.location_pings where rep_id = v_rep2;
  if v_n > 0 then v_fail := v_fail || '7. a rep could read another rep''s GPS pings' || E'\n'; end if;

  -- 8. A visit cannot be reassigned to yourself.
  begin
    update public.visits set rep_id = v_rep where rep_id = v_rep2;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_fail := v_fail || '8. a rep could steal another rep''s visit' || E'\n'; end if;
  exception when others then null; end;

  -- 9. Nor created on someone else's behalf.
  begin
    insert into public.visits (org_id, rep_id, store_id, status, client_generated_id)
    values (v_org, v_rep2, v_store, 'checked_in', gen_random_uuid());
    v_fail := v_fail || '9. a rep could create a visit as another rep' || E'\n';
  exception when others then null; end;

  ------------------------------------------------------------------ evidence

  insert into public.visits (org_id, rep_id, store_id, status, checkin_at, checkin_lat, checkin_lng,
                             checkin_distance_from_store_m, client_generated_id)
  values (v_org, v_rep, v_store, 'checked_in', now(), -24.6, 25.9, 4200, gen_random_uuid())
  returning id into v_visit;

  -- 10. A recorded check-in distance is evidence and must not be editable by
  --     the person it measures.
  begin
    update public.visits set checkin_distance_from_store_m = 5 where id = v_visit;
    v_fail := v_fail || '10. a rep could rewrite their own check-in distance' || E'\n';
  exception when others then null; end;

  -- 11. Nor the position itself.
  begin
    update public.visits set checkin_lat = -24.0 where id = v_visit;
    v_fail := v_fail || '11. a rep could move their own recorded check-in' || E'\n';
  exception when others then null; end;

  -- 12. But a normal check-out, which fills columns that were null, must work.
  begin
    update public.visits
       set status = 'checked_out', checkout_at = now(), checkout_lat = -24.6, checkout_lng = 25.9
     where id = v_visit;
    get diagnostics v_n = row_count;
    if v_n <> 1 then v_fail := v_fail || '12. a normal check-out was blocked' || E'\n'; end if;
  exception when others then
    v_fail := v_fail || '12. a normal check-out was blocked: ' || sqlerrm || E'\n'; end;

  -- 13. GPS pings are immutable (no UPDATE policy at all).
  update public.location_pings set lat = 0 where rep_id = v_rep;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_fail := v_fail || '13. a rep could edit GPS pings' || E'\n'; end if;

  -- 14. Visits cannot be deleted through the API.
  delete from public.visits where rep_id = v_rep;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_fail := v_fail || '14. a rep could delete their own visits' || E'\n'; end if;

  --------------------------------------------------------------- rate limits

  -- 15. The limiter refuses once the window is spent.
  for i in 1..3 loop
    v_r := public.consume_rate_limit('regression_test', 3, 60, 1);
  end loop;
  v_r := public.consume_rate_limit('regression_test', 3, 60, 1);
  if (v_r->>'allowed')::boolean then
    v_fail := v_fail || '15. the rate limiter allowed a 4th call past a limit of 3' || E'\n';
  end if;

  -- 16. Counters are neither readable nor resettable by the people they bind.
  begin
    select count(*) into v_n from public.rate_limits;
    v_fail := v_fail || '16. a user could read the rate-limit counters' || E'\n';
  exception when others then null; end;
  begin
    delete from public.rate_limits;
    v_fail := v_fail || '16b. a user could reset the rate-limit counters' || E'\n';
  exception when others then null; end;

  --------------------------------------------------------------- audit trail

  -- 17. The audit log is readable by managers but never writable through the API.
  begin
    insert into public.security_events (org_id, action, subject_type)
    values (v_org, 'forged', 'profile');
    v_fail := v_fail || '17. a user could write to the audit log' || E'\n';
  exception when others then null; end;

  reset role;

  -- 18. A privilege change must leave a trail. Done as the service role,
  --     because that is the only path that can still make one.
  update public.profiles set role = 'manager' where id = v_rep2;
  select count(*) into v_n from public.security_events
   where subject_id = v_rep2 and action = 'profile.permissions_changed';
  if v_n = 0 then v_fail := v_fail || '18. a role change left no audit trail' || E'\n'; end if;

  ------------------------------------------------------------ territory scope

  -- Confirmed by exploit on 30 July: `territory_reps` had no trigger proving
  -- its `territory_id` and `rep_id` live in the organisation named by its
  -- `org_id`, and the insert policy only checks the org_id *in the row*. Closed
  -- by `20260730153000_enforce_territory_reps_org.sql`.
  --
  -- Run as the manager, because a rep cannot insert coverage at all.
  --
  -- The tier list has changed twice and this fixture has had to change with it
  -- both times, so state where it stands rather than the history: since
  -- `20260731181954_restructure_territories_into_regions.sql` the tree is
  -- **country → region → territory**, stores hang off the territory (the
  -- deepest tier), and `'sub'` is gone from `territories_level_check`
  -- altogether. `territories_enforce_shape` reads the expected parent off a
  -- CASE — country: none, region: country, territory: region — so a territory
  -- hung straight off a country now raises "<name> is a country, not a region"
  -- and aborts the suite before check 19 ever runs.
  --
  -- That is not hypothetical: it is what this file did on 3 August, the first
  -- time it was run against production after the regions migration of 31 July.
  -- The suite had been silently unrunnable for three days. Whoever changes the
  -- tiers again changes these four inserts, checks 23-24b and the invariant in
  -- check 25 — and the cheapest way to find that out is to run the file.
  insert into public.organizations (name) values ('Regression Foreign Org')
    returning id into v_other_org;
  insert into public.territories (org_id, name, level, parent_id)
    values (v_other_org, 'Regression Foreign Country', 'country', null)
    returning id into v_other_country;
  insert into public.territories (org_id, name, level, parent_id)
    values (v_other_org, 'Regression Foreign Region', 'region', v_other_country)
    returning id into v_other_region;
  insert into public.territories (org_id, name, level, parent_id)
    values (v_other_org, 'Regression Foreign Territory', 'territory', v_other_region)
    returning id into v_other_terr;
  -- Created, not found. The header promises only a manager, two reps and a
  -- store, so querying the estate for a root territory made check 20 skip itself
  -- silently on a tenant that has none — a check that reports nothing is worse
  -- than one that fails. The same reasoning applies to the country and now the
  -- region: the estate has both, but borrowing them would make this check depend
  -- on tenant data.
  insert into public.territories (org_id, name, level, parent_id)
    values (v_org, 'Regression Own Country', 'country', null)
    returning id into v_own_country;
  insert into public.territories (org_id, name, level, parent_id)
    values (v_org, 'Regression Own Region', 'region', v_own_country)
    returning id into v_own_region;
  insert into public.territories (org_id, name, level, parent_id)
    values (v_org, 'Regression Own Territory', 'territory', v_own_region)
    returning id into v_terr;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 19. Coverage must not reach a territory in another organisation.
  begin
    insert into public.territory_reps (org_id, territory_id, rep_id)
    values (v_org, v_other_terr, v_rep);
    v_fail := v_fail || '19. a manager could cover another org''s territory' || E'\n';
  exception when others then null; end;

  -- 20. Legitimate coverage must still be insertable — see check 4.
  begin
    insert into public.territory_reps (org_id, territory_id, rep_id)
    values (v_org, v_terr, v_rep);
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      v_fail := v_fail || '20. a manager could NOT assign coverage in their own org' || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || '20. a manager could NOT assign coverage in their own org: '
              || sqlerrm || E'\n'; end;

  --------------------------------------------------------- dashboard layouts

  -- A saved dashboard layout is one person's, and `dashboard_layouts` is the
  -- only table keyed on the user rather than the organisation — so being in the
  -- same org must not be enough to reach it.
  reset role;
  -- Clear the fixture users' real rows first. `user_id` is the primary key, so
  -- without this the insert below raises `duplicate key` the moment any of these
  -- people has actually customised their dashboard: the check-21 insert is
  -- outside a handler and would abort the entire suite reporting nothing, and
  -- check 22's is inside one and would be reported as a regression that is not
  -- there. Safe to delete — the whole file runs in a transaction that rolls back,
  -- so their real layouts come straight back.
  delete from public.dashboard_layouts where user_id in (v_mgr, v_rep, v_rep2);

  insert into public.dashboard_layouts (user_id, org_id, widget_ids)
  values (v_rep, v_org, array['oos_rate']);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 21. Somebody else's layout is invisible, unwritable, and cannot be planted.
  select count(*) into v_n from public.dashboard_layouts where user_id = v_rep;
  if v_n > 0 then v_fail := v_fail || '21. could read another user''s dashboard layout' || E'\n'; end if;

  update public.dashboard_layouts set widget_ids = array['hijacked'] where user_id = v_rep;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_fail := v_fail || '21b. could edit another user''s dashboard layout' || E'\n'; end if;

  begin
    insert into public.dashboard_layouts (user_id, org_id, widget_ids)
    values (v_rep2, v_org, array['oos_rate']);
    v_fail := v_fail || '21c. could create a layout for another user' || E'\n';
  exception when others then null; end;

  -- 22. Your own must still save and read back — see check 4.
  begin
    insert into public.dashboard_layouts (user_id, org_id, widget_ids)
    values (v_mgr, v_org, array['oos_rate','working_day']);
    select count(*) into v_n from public.dashboard_layouts where user_id = v_mgr;
    if v_n <> 1 then v_fail := v_fail || '22. could not read back own layout' || E'\n'; end if;
  exception when others then
    v_fail := v_fail || '22. could not save own layout: ' || sqlerrm || E'\n'; end;

  ------------------------------------------------- territory shape under UPDATE

  -- Confirmed by exploit on 30 July: `territories_enforce_shape` validated only
  -- the row being written, so an UPDATE could create states the same triggers
  -- refuse on INSERT — a main territory with 75 stores and a sub was turned into
  -- a sub-territory, and a main was moved to another organisation leaving its
  -- stores pointing across the tenancy line. Closed by
  -- `20260730170000_territories_shape_guards_dependents.sql`.
  --
  -- Built self-contained rather than reusing the estate, so the check does not
  -- depend on which territories happen to have dependents.
  -- Three levels since the country tier: country → territory → sub. Fixtures are
  -- built as that whole chain, created rather than found — the estate's own
  -- country would do, but a check that depends on tenant data is the mistake
  -- checks 20-23 already made twice.
  reset role;
  insert into public.territories (org_id, name, level, parent_id)
    values (v_org, 'Regression Country', 'country', null)
    returning id into v_shape_other;
  insert into public.territories (org_id, name, level, parent_id)
    values (v_org, 'Regression Territory', 'territory', v_shape_other)
    returning id into v_shape_main;
  insert into public.territories (org_id, name, level, parent_id)
    values (v_org, 'Regression Sub', 'sub', v_shape_main);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 23. A territory with a sub under it must not become a sub itself — that is
  --     the state `stores_enforce_territory` refuses to create, arrived at
  --     sideways. Note this is a *level* change: reparenting a territory between
  --     countries is ordinary reorganisation and is allowed (see check 24).
  begin
    update public.territories set level = 'sub' where id = v_shape_main;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_fail := v_fail || '23. a territory with a sub could become a sub itself' || E'\n';
    end if;
  exception when others then null; end;

  -- `v_other_org`, not a random uuid. With a random one the FK refuses the update
  -- regardless, so this check passed even with the guard removed — verified by
  -- disabling the trigger: random uuid still refused (23503, the foreign key),
  -- real organisation accepted. A check that survives the deletion of the thing
  -- it tests is not a check.
  begin
    update public.territories set org_id = v_other_org where id = v_shape_main;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_fail := v_fail || '23b. a territory with dependents could change organisation' || E'\n';
    end if;
  exception when others then null; end;

  -- 24. Renaming and deactivating — the only updates the UI makes — must still
  --     work, and so must moving a childless territory to another country, which
  --     is what the guard was narrowed to allow. See check 4.
  begin
    update public.territories set name = 'Regression Territory renamed', active = false
     where id = v_shape_main;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      v_fail := v_fail || '24. a territory could NOT be renamed or deactivated' || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || '24. a territory could NOT be renamed or deactivated: '
              || sqlerrm || E'\n'; end;

  begin
    insert into public.territories (org_id, name, level, parent_id)
      values (v_org, 'Regression Country Two', 'country', null)
      returning id into v_terr;
    insert into public.territories (org_id, name, level, parent_id)
      values (v_org, 'Regression Spare', 'territory', v_shape_other)
      returning id into v_other_terr;
    update public.territories set parent_id = v_terr where id = v_other_terr;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      v_fail := v_fail || '24b. a childless territory could NOT move country' || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || '24b. a childless territory could NOT move country: '
              || sqlerrm || E'\n'; end;

  reset role;

  -- 25. Every row sits under the right *kind* of parent.
  --
  -- Was "nothing is three levels deep", which the country tier made wrong —
  -- three levels is now the design. The invariant that survived the change is
  -- the one that was really being tested: a country has no parent, a territory
  -- hangs off a country, a sub hangs off a territory. That catches a fourth
  -- level, a skipped level and a cycle alike, because every one of them puts a
  -- row under a parent of the wrong level.
  --
  -- An invariant rather than an attack, deliberately: a cycle can only be
  -- committed by two transactions reparenting past each other, which no
  -- single-connection test can stage (see `territory_reparent_race.sh`). This
  -- catches the result however it arose.
  select count(*) into v_n
    from public.territories t
    left join public.territories p on p.id = t.parent_id
   where (t.level = 'country' and t.parent_id is not null)
      or (t.level = 'territory' and coalesce(p.level, '') <> 'country')
      or (t.level = 'sub' and coalesce(p.level, '') <> 'territory');
  if v_n > 0 then
    v_fail := v_fail || format(
      '25. %s territory/ies sit under a parent of the wrong level (skipped level, fourth level or cycle)%s',
      v_n, E'\n');
  end if;

  -- 25b. And no store is attached to anything but a territory. The country is
  --      reached through the territory, so this is the other half of "a store is
  --      never in two places".
  select count(*) into v_n
    from public.stores s
    join public.territories t on t.id = s.territory_id
   where t.level <> 'territory';
  if v_n > 0 then
    v_fail := v_fail || format(
      '25b. %s store(s) are attached to a country or a sub rather than a territory%s',
      v_n, E'\n');
  end if;

  -- 26. No sub-territory belongs to a different organisation than its parent.
  --
  -- The companion to 25, and for the same reason: a cross-org pair can be
  -- committed by two transactions moving past each other (one reparenting, one
  -- changing `org_id`), which needs two sessions to stage. This catches the
  -- result, which is the thing that actually matters — a sub-territory on the
  -- wrong side of the tenancy line.
  select count(*) into v_n
    from public.territories t
    join public.territories p on p.id = t.parent_id
   where t.org_id <> p.org_id;
  if v_n > 0 then
    v_fail := v_fail || format(
      '26. %s sub-territory/ies belong to a different organisation than their parent%s',
      v_n, E'\n');
  end if;

  ------------------------------------------------- the warehouse module (27-30)
  --
  -- Added 3 August 2026 with `feature/warehouse-fulfilment-foundations`. The
  -- module introduced a third role and two tables whose guards are of a kind
  -- this file had not had to test before, so read the fixture notes: three of
  -- these four checks can be made to pass by accident.
  --
  -- The clerk is `v_rep` re-roled, not a new profile. `profiles.id` references
  -- `auth.users(id)` and this suite has no business writing to the auth schema;
  -- check 18 already establishes that a role change through the service role is
  -- the way to stage one. It is `v_rep` rather than `v_rep2` because every probe
  -- below reads `v_rep2`'s rows, and a clerk reading their *own* history is not
  -- the attack — see check 28.
  --
  -- Created, never found: there is no warehouse profile in the estate at all
  -- (there has never been a warehouse login), so `where role = 'warehouse'`
  -- would leave the variable null and every check here would skip itself in
  -- silence, which is the failure the header describes.

  reset role;

  insert into public.stock_locations (org_id, name, type)
    values (v_org, 'Regression Warehouse', 'warehouse')
    returning id into v_loc;
  insert into public.products (org_id, name)
    values (v_org, 'Regression Product')
    returning id into v_prod;

  -- Three orders: one belonging to the other rep, one to the reader, and one for
  -- the clerk to attack. `fulfil_location_id` is set on all three so that the
  -- `orders_fulfil_location_set` constraint is not what refuses check 29 — see
  -- the note there.
  insert into public.orders (org_id, order_number, store_id, rep_id, source,
                             received_via, fulfil_location_id, client_generated_id)
  values (v_org, 'ORD-REGRESSION-1', v_store, v_rep2, 'rep_app', 'rep_visit',
          v_loc, gen_random_uuid())
  returning id into v_order_other;

  insert into public.order_lines (org_id, order_id, product_id, qty_ordered,
                                  client_generated_id)
  values (v_org, v_order_other, v_prod, 5, gen_random_uuid());

  insert into public.orders (org_id, order_number, store_id, rep_id, source,
                             received_via, fulfil_location_id, client_generated_id)
  values (v_org, 'ORD-REGRESSION-2', v_store, v_rep, 'rep_app', 'rep_visit',
          v_loc, gen_random_uuid())
  returning id into v_order_own;

  insert into public.orders (org_id, order_number, store_id, source,
                             received_via, fulfil_location_id, client_generated_id)
  values (v_org, 'ORD-REGRESSION-3', v_store, 'warehouse_manual', 'whatsapp',
          v_loc, gen_random_uuid())
  returning id into v_order_clerk;

  -- Check 18 left `v_rep2` a manager and this file has been promoting people for
  -- twenty-six checks. State what the *reader* is rather than assuming it: if
  -- `v_rep` were not an active rep, check 27 would report a locked door that is
  -- really an unlit room.
  update public.profiles set role = 'rep', is_active = true where id = v_rep;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;

  if public."current_role"() <> 'rep' or public.current_org_id() is distinct from v_org then
    raise exception 'Fixtures broken: the check-27 caller is % in org %, not a rep in %.',
      coalesce(public."current_role"(), 'null'), coalesce(public.current_org_id()::text, 'null'), v_org;
  end if;

  -- 27. A rep sees their own orders and nobody else's. `orders_select` is
  --     `manager or warehouse or rep_id = auth.uid()`, so this is a silent RLS
  --     filter rather than an error — nothing is raised, the row simply is not
  --     there, which is also what an empty table looks like. Hence 27d.
  select count(*) into v_n from public.orders where id = v_order_other;
  if v_n > 0 then v_fail := v_fail || '27. a rep could read another rep''s order' || E'\n'; end if;

  -- 27b. And not through the child tables either. `order_lines` carries its own
  --      policy rather than inheriting one, so a lock on the parent proves
  --      nothing about the line — which is where the quantities and prices are.
  select count(*) into v_n from public.order_lines where order_id = v_order_other;
  if v_n > 0 then v_fail := v_fail || '27b. a rep could read another rep''s order lines' || E'\n'; end if;

  select count(*) into v_n from public.order_status_events where order_id = v_order_other;
  if v_n > 0 then v_fail := v_fail || '27c. a rep could read another rep''s order history' || E'\n'; end if;

  -- 27d. Their own order must still be readable — see check 4. Without this,
  --      27 passes just as well when a rep can read no orders at all, which is
  --      what a null `current_org_id()` would produce.
  select count(*) into v_n from public.orders where id = v_order_own;
  if v_n <> 1 then
    v_fail := v_fail || '27d. a rep could NOT read their own order' || E'\n';
  end if;

  ------------------------------------------------------ the warehouse clerk

  reset role;

  -- Now the same person is a clerk. `is_active` is forced true deliberately:
  -- `current_role()` and `current_org_id()` both return null for a deactivated
  -- user (`20260727203059_enforce_is_active_in_rls_helpers.sql`) and a null role
  -- is refused by every policy in the schema — a deactivated fixture would make
  -- checks 28-30 pass while proving nothing whatever about the warehouse role.
  update public.profiles set role = 'warehouse', is_active = true where id = v_rep;

  -- The field data the clerk must not reach. Seeded here, not searched for: a
  -- count of zero against an empty table is the textbook probe that passes for
  -- the wrong reason. The visit from the top of the file would do, but leads and
  -- pings have none, and one of the three silently testing nothing is worse than
  -- three fixtures.
  insert into public.leads (org_id, rep_id, company_name, purpose, client_generated_id)
  values (v_org, v_rep2, 'Regression Prospect', 'listing', gen_random_uuid());

  insert into public.location_pings (org_id, rep_id, lat, lng, client_generated_id)
  values (v_org, v_rep2, -24.65, 25.91, gen_random_uuid());

  select count(*) into v_n from public.visits where rep_id = v_rep2;
  if v_n = 0 then raise exception 'Fixtures broken: no visit exists for check 28 to be refused.'; end if;
  select count(*) into v_n from public.leads where rep_id = v_rep2;
  if v_n = 0 then raise exception 'Fixtures broken: no lead exists for check 28 to be refused.'; end if;
  select count(*) into v_n from public.location_pings where rep_id = v_rep2;
  if v_n = 0 then raise exception 'Fixtures broken: no GPS ping exists for check 28 to be refused.'; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- The impersonation is the guard under test here, so assert it took. Every
  -- refusal below is a policy returning false for role 'warehouse'; if the role
  -- is anything else — or null — the refusals are real but they are not this
  -- check's.
  if public."current_role"() <> 'warehouse' or public.current_org_id() is distinct from v_org
     or auth.uid() is distinct from v_rep then
    raise exception 'Fixtures broken: the check-28 caller is % (uid %) in org %, not the warehouse clerk %.',
      coalesce(public."current_role"(), 'null'), coalesce(auth.uid()::text, 'null'),
      coalesce(public.current_org_id()::text, 'null'), v_rep;
  end if;

  -- 28. A warehouse clerk is not a manager: no visits, no leads pipeline, no GPS
  --     trail. `20260802161258_add_warehouse_role.sql` claims widening the role
  --     *closes* these doors rather than opening them, because every one of these
  --     policies reads `current_role() = 'manager' or rep_id = auth.uid()` and a
  --     clerk is neither. This is that claim, tested.
  --
  --     Scoped to `v_rep2` on purpose. A clerk who used to be a rep still sees
  --     their own historical rows through the `rep_id = auth.uid()` arm — that is
  --     their own data and not a hole, but it means an unscoped count would fail
  --     this check for a reason that has nothing to do with the warehouse role.
  select count(*) into v_n from public.visits where rep_id = v_rep2;
  if v_n > 0 then v_fail := v_fail || '28. a warehouse clerk could read a rep''s visits' || E'\n'; end if;

  select count(*) into v_n from public.leads where rep_id = v_rep2;
  if v_n > 0 then v_fail := v_fail || '28b. a warehouse clerk could read the leads pipeline' || E'\n'; end if;

  select count(*) into v_n from public.location_pings where rep_id = v_rep2;
  if v_n > 0 then v_fail := v_fail || '28c. a warehouse clerk could read a rep''s GPS trail' || E'\n'; end if;

  -- 28d. And the module they *are* for must be readable — see check 4. This is
  --      the control that makes the three above mean "the clerk was refused"
  --      rather than "the clerk can read nothing".
  select count(*) into v_n from public.orders where id = v_order_clerk;
  if v_n <> 1 then
    v_fail := v_fail || '28d. a warehouse clerk could NOT read the orders they fulfil' || E'\n';
  end if;

  -- 29. A warehouse clerk must not be able to set `orders.status` directly.
  --
  --     The single most damaging thing in the module, per the header of
  --     `20260802164130_create_orders.sql`: PATCH /rest/v1/orders {"status":
  --     "dispatched"} marks an order gone while the goods are still on the
  --     shelf, because nothing in the ledger moved. RLS cannot express it — a
  --     policy is shown the row, not the diff — so the guard is a column grant.
  --
  --     Three things are arranged so that the grant is the *only* thing that can
  --     refuse this, because two other guards would otherwise answer for it and
  --     the check would survive the grant being dropped:
  --
  --       * `new -> confirmed` is a legal transition, so `orders_enforce_transition`
  --         has nothing to say. Asking for 'dispatched' would be refused by the
  --         trigger — and it raises 42501 too, so the SQLSTATE would look right.
  --       * the order is not on hold, which the same trigger refuses first.
  --       * `fulfil_location_id` is set, so `orders_fulfil_location_set` does not
  --         refuse 'confirmed' on a check constraint instead.
  --
  --     Which leaves the message as the only thing that tells the guards apart:
  --     a privilege error, not a raised one.
  begin
    update public.orders set status = 'confirmed' where id = v_order_clerk;
    v_fail := v_fail || '29. a clerk could PATCH orders.status directly' || E'\n';
  exception when others then
    if sqlerrm not ilike '%permission denied%' then
      v_fail := v_fail || format(
        '29. a clerk was refused orders.status, but by "%s" (%s) rather than by the column grant%s',
        sqlerrm, sqlstate, E'\n');
    end if;
  end;

  -- 29b. The columns a clerk is *meant* to edit must still be editable, or the
  --      refusal above is just "clerks cannot touch orders" and the column grant
  --      is untested — the whole point is that it is per-column.
  begin
    update public.orders set notes = 'regression: keyed from WhatsApp'
     where id = v_order_clerk;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      v_fail := v_fail || '29b. a clerk could NOT edit an order''s notes' || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || '29b. a clerk could NOT edit an order''s notes: ' || sqlerrm || E'\n'; end;

  -- 29c. The catalogue, naming the guard directly. 29 proves *a* privilege error
  --      was raised; this proves it is this exact grant, so a failure says what
  --      to put back rather than only that something is open. It is also the
  --      half that still works if a later migration adds a trigger over
  --      `orders.status` — the attack would then be refused by the trigger and
  --      29 would go on passing with the grant wide open, which is the shape of
  --      the mistake check 23 was written up for.
  if has_column_privilege('authenticated', 'public.orders', 'status', 'update') then
    v_fail := v_fail || '29c. authenticated holds UPDATE on orders.status' || E'\n';
  end if;
  if not has_column_privilege('authenticated', 'public.orders', 'notes', 'update') then
    v_fail := v_fail || '29c. authenticated has lost UPDATE on orders.notes' || E'\n';
  end if;

  -- 29d. The same mechanism on the adjustment's decision columns, and for the
  --      same reason the migration gives: without it a clerk sets
  --      `status = 'approved'` on their own request, moves no stock, and tells
  --      everyone reading the list that a manager signed it off.
  if has_column_privilege('authenticated', 'public.stock_adjustments', 'status', 'update')
     or has_column_privilege('authenticated', 'public.stock_adjustments', 'decided_by', 'update') then
    v_fail := v_fail || '29d. authenticated holds UPDATE on the adjustment decision columns' || E'\n';
  end if;

  ----------------------------------------------- approving your own correction

  -- 30. A clerk must not be able to approve their own adjustment.
  --
  --     What the intended rule is, from `20260802172208_create_stock_adjustments.sql`:
  --     `stock_adjustment_decide()` is manager-only, and its comment says "an
  --     approval gate that the requester can operate is not a gate" — but then
  --     names one deliberate exception, a manager raising and approving their
  --     own, "they could approve a clerk's identical request a second later, so
  --     refusing it would be ceremony rather than control".
  --
  --     So the rule is **not** maker-checker, and 30e below asserts the exception
  --     on purpose so that nobody reads ADJ-000001 (raised and approved by the
  --     same manager in production on 2 August) as evidence of a bug. What
  --     actually stops a clerk is the role gate, and the clerk's own request is
  --     the case where the difference between the two rules is visible.
  --
  --     Reason 'found' is chosen so the approval in 30d posts a one-legged
  --     inbound movement. An 'available -> damaged' line would need stock to
  --     already exist at the location, and `stock_movements_apply()` would refuse
  --     it with "no stock of that product at that location" — a control that
  --     fails for want of a fixture reads exactly like the gate being broken.
  insert into public.stock_adjustments (org_id, adjustment_number, location_id,
                                        reason_code, created_by)
  values (v_org, 'ADJ-REGRESSION-1', v_loc, 'found', v_rep)
  returning id into v_adj;

  insert into public.stock_adjustment_lines (org_id, adjustment_id, product_id,
                                             from_bucket, to_bucket, qty)
  values (v_org, v_adj, v_prod, null, 'available', 1);

  -- 30a. Raising and submitting is the clerk's job and must work — the control
  --      for 30, and the thing that puts the clerk's id in `requested_by`.
  begin
    perform public.stock_adjustment_submit(v_adj);
  exception when others then
    v_fail := v_fail || '30a. a clerk could NOT submit their own adjustment: ' || sqlerrm || E'\n'; end;

  select status into v_decided from public.stock_adjustments where id = v_adj;
  if v_decided is distinct from 'pending' then
    v_fail := v_fail || format('30a. a clerk''s submitted adjustment is %s, not pending%s',
                               coalesce(v_decided, 'unreadable'), E'\n');
  end if;

  -- 30. The attack. Refused by the role gate, and the message has to say so:
  --     `stock_adjustment_decide` raises 42501 for "not a manager", for "not
  --     pending" and for a foreign adjustment alike, so the SQLSTATE alone
  --     cannot tell a working gate from one that only refused because 30a's
  --     submit had quietly failed and the row was still a draft.
  begin
    perform public.stock_adjustment_decide(v_adj, true, 'approving my own');
    v_fail := v_fail || '30. a clerk could approve their own adjustment' || E'\n';
  exception when others then
    if sqlerrm not ilike '%only a manager%' then
      v_fail := v_fail || format(
        '30. a clerk was refused the approval, but by "%s" (%s) rather than by the manager gate%s',
        sqlerrm, sqlstate, E'\n');
    end if;
  end;

  -- 30b. Nothing may have moved on a refused approval. `is distinct from`, not
  --      `<>`: a null here means the clerk could no longer read their own
  --      adjustment, which is a different failure and must not read as a pass.
  select status into v_decided from public.stock_adjustments where id = v_adj;
  if v_decided is distinct from 'pending' then
    v_fail := v_fail || format('30b. a refused approval left the adjustment %s%s',
                               coalesce(v_decided, 'unreadable'), E'\n');
  end if;

  -- 30c. And the ledger is the thing that would actually be wrong. Readable to
  --      the clerk in their own right (`stock_movements_select` names
  --      'warehouse'), so a count of zero here is a real answer rather than an
  --      invisible table.
  select count(*) into v_n from public.stock_movements where source_doc_id = v_adj;
  if v_n > 0 then
    v_fail := v_fail || '30c. a refused approval posted stock movements anyway' || E'\n';
  end if;

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  if public."current_role"() <> 'manager' then
    raise exception 'Fixtures broken: the check-30d caller is %, not a manager.',
      coalesce(public."current_role"(), 'null');
  end if;

  -- 30d. A manager approving the clerk's request must work — see check 4. A gate
  --      that no one can open is not a gate either.
  begin
    perform public.stock_adjustment_decide(v_adj, true, 'regression approval');
  exception when others then
    v_fail := v_fail || '30d. a manager could NOT approve a clerk''s adjustment: ' || sqlerrm || E'\n'; end;

  select status into v_decided from public.stock_adjustments where id = v_adj;
  if v_decided is distinct from 'approved' then
    v_fail := v_fail || format('30d. a manager''s approval left the adjustment %s%s',
                               coalesce(v_decided, 'unreadable'), E'\n');
  end if;

  -- 30e. And the documented exception, asserted so that it stays a decision
  --      rather than becoming a discovery: a manager may raise and approve the
  --      same adjustment. If maker-checker is ever the rule — the requirement
  --      would be "no one decides their own", not "managers only" — this is the
  --      check that is *supposed* to fail, and the comment on
  --      `stock_adjustment_decide` is what has to change with it.
  insert into public.stock_adjustments (org_id, adjustment_number, location_id,
                                        reason_code, created_by)
  values (v_org, 'ADJ-REGRESSION-2', v_loc, 'found', v_mgr)
  returning id into v_adj_mgr;

  insert into public.stock_adjustment_lines (org_id, adjustment_id, product_id,
                                             from_bucket, to_bucket, qty)
  values (v_org, v_adj_mgr, v_prod, null, 'available', 1);

  begin
    perform public.stock_adjustment_submit(v_adj_mgr);
    perform public.stock_adjustment_decide(v_adj_mgr, true, 'raised and approved by the same manager');
    select status into v_decided from public.stock_adjustments where id = v_adj_mgr;
    if v_decided is distinct from 'approved' then
      v_fail := v_fail || format(
        '30e. a manager could not approve their own adjustment (it is %s) — deliberate per the migration; if that rule changed, change this check%s',
        coalesce(v_decided, 'unreadable'), E'\n');
    end if;
  exception when others then
    v_fail := v_fail || format(
      '30e. a manager could not approve their own adjustment: %s — deliberate per the migration; if that rule changed, change this check%s',
      sqlerrm, E'\n'); end;

  reset role;

  ------------------------------------------------------------------- verdict

  if v_fail <> '' then
    raise exception E'SECURITY REGRESSIONS:\n%', v_fail;
  end if;

  -- Always aborts: the suite writes fixtures and must leave nothing behind.
  raise exception 'ALL SECURITY CHECKS PASSED (rolled back)';
end $$;
