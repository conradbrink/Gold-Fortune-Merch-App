-- Security regression suite.
--
-- Every check here corresponds to a hole that was open on 29 July 2026 and was
-- confirmed by exploiting it. They are written as attacks, not as assertions
-- about policy text, because the manager-escalation bug came from a policy that
-- read correctly for weeks: `profiles_update` said `id = auth.uid()`, which is
-- true and sounds right, and permitted a rep to set their own role.
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

  ------------------------------------------------------------------- verdict

  if v_fail <> '' then
    raise exception E'SECURITY REGRESSIONS:\n%', v_fail;
  end if;

  -- Always aborts: the suite writes fixtures and must leave nothing behind.
  raise exception 'ALL SECURITY CHECKS PASSED (rolled back)';
end $$;
