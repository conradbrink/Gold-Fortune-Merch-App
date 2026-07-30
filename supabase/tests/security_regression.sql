-- Security regression suite.
--
-- Every check here corresponds to a hole that was open on 29 or 30 July 2026, or
-- to an invariant a new table has to hold. **26 checks** — 1-18 are the 29 July
-- audit; 19-20 the `territory_reps` tenancy gap, 21-22 the per-user
-- `dashboard_layouts`, 23-24 `territories_enforce_shape` ignoring dependents on
-- UPDATE, and 25-26 the territory depth and tenancy invariants, all found in
-- review on 30 July.
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
  insert into public.organizations (name) values ('Regression Foreign Org')
    returning id into v_other_org;
  insert into public.territories (org_id, name) values (v_other_org, 'Regression Foreign Territory')
    returning id into v_other_terr;
  -- Created, not found. The header promises only a manager, two reps and a
  -- store, so querying the estate for a root territory made check 20 skip itself
  -- silently on a tenant that has none — a check that reports nothing is worse
  -- than one that fails.
  insert into public.territories (org_id, name) values (v_org, 'Regression Own Territory')
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
  reset role;
  insert into public.territories (org_id, name) values (v_org, 'Regression Main')
    returning id into v_shape_main;
  insert into public.territories (org_id, name, parent_id)
    values (v_org, 'Regression Sub', v_shape_main);
  -- Also created rather than found. With no second root in the estate this was
  -- null, so check 23's update became `parent_id = null` — which the trigger
  -- correctly allows, since nothing changes — and the check then reported the
  -- vulnerability as present. A false alarm, from a fixture that was not there.
  insert into public.territories (org_id, name) values (v_org, 'Regression Other Root')
    returning id into v_shape_other;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 23. A territory something depends on cannot be restructured out from under it.
  begin
    update public.territories set parent_id = v_shape_other where id = v_shape_main;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_fail := v_fail || '23. a main with a sub-territory could become a sub' || E'\n';
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
      v_fail := v_fail || '23b. a main with dependents could change organisation' || E'\n';
    end if;
  exception when others then null; end;

  -- 24. But renaming and deactivating — the only updates the UI makes — must
  --     still work. See check 4.
  begin
    update public.territories set name = 'Regression Main renamed', active = false
     where id = v_shape_main;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      v_fail := v_fail || '24. a territory could NOT be renamed or deactivated' || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || '24. a territory could NOT be renamed or deactivated: '
              || sqlerrm || E'\n'; end;

  reset role;

  -- 25. No territory is its own ancestor, and none is three levels deep.
  --
  -- An invariant rather than an attack, and deliberately about the *data* rather
  -- than a permission: a cycle can only be committed by two transactions
  -- reparenting past each other, which no single-connection test can stage (see
  -- `territory_reparent_race.sh`). This catches the result however it arose —
  -- the race, a direct SQL fix, a restore, a future trigger change.
  select count(*) into v_n
    from public.territories t
    join public.territories p on p.id = t.parent_id
   where p.parent_id is not null;
  if v_n > 0 then
    v_fail := v_fail || format(
      '25. %s territory/ies sit under a parent that is itself a sub-territory (cycle or three levels)%s',
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

  ------------------------------------------------------------------- verdict

  if v_fail <> '' then
    raise exception E'SECURITY REGRESSIONS:\n%', v_fail;
  end if;

  -- Always aborts: the suite writes fixtures and must leave nothing behind.
  raise exception 'ALL SECURITY CHECKS PASSED (rolled back)';
end $$;
