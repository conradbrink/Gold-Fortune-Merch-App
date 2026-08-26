-- 🔴 Close an EXECUTE hole on every HR function, and pin four search paths.
--
-- Found by the database linter after the module was applied, and it is a hole
-- I put there: the HR migrations wrote `revoke execute on function … from anon`
-- and that revoke does nothing, because it was never `anon` holding the grant.
-- Postgres grants EXECUTE on a new function to PUBLIC by default, and `anon`
-- inherits it. Revoking from a role that was relying on PUBLIC leaves the
-- privilege exactly where it was.
--
-- The existing schema gets this right — `current_org_id` and
-- `next_document_number` both revoke from `public` and are correctly closed —
-- so this is the HR module failing to copy a pattern that was already here.
--
-- What it exposed, in order of seriousness:
--
--   🔴 `hr_notify` and `hr_notify_hr` are `security definer` and INSERT into
--      `hr_notifications`, a table with no INSERT policy precisely so that
--      nothing outside a trigger can write to it. With EXECUTE held by PUBLIC,
--      anyone holding the publishable anon key — which ships in the browser
--      bundle and on the download page — could call them directly and put a
--      row with any title, body and link into any user's notification bell.
--      A believable "Your leave was approved" pointing at an attacker's URL is
--      the obvious use. Verified reachable before this migration was written.
--
--   ⚠️ Every other HR helper was readable by `anon` too. Those leak far less —
--      `hr_is_hr()` with no session returns null — but there is no reason for
--      an unauthenticated caller to reach any of them.
--
-- The fix is a loop rather than a list. A list is one `create or replace` away
-- from missing the next function somebody adds, and missing one is the whole
-- bug: `hr_notify` was individually revoked and still open.
--
-- Trigger functions are revoked from everybody, including `authenticated`.
-- Postgres checks EXECUTE on a trigger function when the trigger is CREATED,
-- not each time it fires, so a user with no EXECUTE still causes the trigger to
-- run. The smoke test after this migration exercises an insert, an update and a
-- delete through the triggers to prove it.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proname like 'hr\_%' or p.proname like 'log\_hr\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated',
                   f.signature);
  end loop;
end $$;

-- Granted back one at a time, and only where a signed-in caller genuinely needs
-- it. Three groups:

-- 1. Read by RLS policies. A policy expression is evaluated as the querying
--    user, so without EXECUTE every HR table would refuse every row.
grant execute on function public.hr_is_hr() to authenticated;
grant execute on function public.hr_is_admin() to authenticated;
grant execute on function public.hr_my_employee_id() to authenticated;
grant execute on function public.hr_manages_employee(uuid) to authenticated;
grant execute on function public.hr_can_view_employee(uuid) to authenticated;
-- Read by the `hr-documents` storage policies.
grant execute on function public.hr_try_uuid(text) to authenticated;

-- 2. Read by `hr_leave_balance_summary`, which is `security_invoker` and so
--    runs its function calls as the caller.
grant execute on function public.hr_leave_year_of(uuid, date) to authenticated;
grant execute on function public.hr_current_leave_year(uuid) to authenticated;

-- 3. Called by the web app, directly or through a `security invoker` RPC.
grant execute on function public.hr_working_days(uuid, date, date) to authenticated;
grant execute on function public.hr_period_index(text, date) to authenticated;
grant execute on function public.hr_period_bounds(text, integer, integer) to authenticated;
grant execute on function public.hr_attendance_report(date, date, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.hr_dashboard_summary() to authenticated;
grant execute on function public.hr_performance_dashboard(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.hr_disciplinary_dashboard() to authenticated;
grant execute on function public.hr_sweep_expiry_notifications() to authenticated;

-- Deliberately NOT granted to anyone: hr_notify, hr_notify_hr,
-- hr_manager_profile_of, hr_stamp_actor, every *_guard, every log_hr_*, and
-- hr_recalc_review_overall. All of them are reached only from inside a
-- security-definer trigger, which needs no grant to fire.

-- ---------------------------------------------------------------------------
-- Pin the four search paths the linter flagged
-- ---------------------------------------------------------------------------
--
-- A `security definer` function without a fixed `search_path` resolves its
-- unqualified names using the caller's, so a caller who creates their own
-- `public` schema ahead of the real one chooses which `date` operator or
-- function the body actually calls. Three of these are `immutable` helpers with
-- no table access and one is a plain trigger guard, so the exposure is small —
-- but "small" is not a reason to leave the door open when the fix is one line,
-- and the rest of this schema pins every one.

create or replace function public.hr_period_index(p_frequency text, p_date date)
returns integer
language sql
immutable
set search_path to 'public'
as $$
  select case p_frequency
    when 'monthly'     then extract(month from p_date)::int
    when 'quarterly'   then extract(quarter from p_date)::int
    when 'six_monthly' then case when extract(month from p_date) <= 6 then 1 else 2 end
    else 1
  end
$$;

create or replace function public.hr_period_bounds(p_frequency text, p_year integer, p_index integer)
returns table (period_start date, period_end date)
language sql
immutable
set search_path to 'public'
as $$
  select t.s,
         (t.s + case p_frequency
            when 'monthly'     then interval '1 month'
            when 'quarterly'   then interval '3 months'
            when 'six_monthly' then interval '6 months'
            else interval '1 year'
          end - interval '1 day')::date
    from (
      select (make_date(p_year, 1, 1) + case p_frequency
                when 'monthly'     then make_interval(months => p_index - 1)
                when 'quarterly'   then make_interval(months => (p_index - 1) * 3)
                when 'six_monthly' then make_interval(months => (p_index - 1) * 6)
                else make_interval()
              end)::date as s
    ) t
$$;

create or replace function public.hr_try_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path to 'public'
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.hr_notifications_read_only_edit()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Everything except read_at is frozen. Cheaper and clearer than listing the
  -- columns: rebuild the old row with the new read_at and require equality.
  if to_jsonb(new) - 'read_at' is distinct from to_jsonb(old) - 'read_at' then
    raise exception 'a notification can only be marked read';
  end if;
  return new;
end;
$$;

-- `create or replace` resets the privileges on those four, so close them again.
revoke all on function public.hr_period_index(text, date) from public, anon;
revoke all on function public.hr_period_bounds(text, integer, integer) from public, anon;
revoke all on function public.hr_try_uuid(text) from public, anon;
revoke all on function public.hr_notifications_read_only_edit() from public, anon, authenticated;
grant execute on function public.hr_period_index(text, date) to authenticated;
grant execute on function public.hr_period_bounds(text, integer, integer) to authenticated;
grant execute on function public.hr_try_uuid(text) to authenticated;
