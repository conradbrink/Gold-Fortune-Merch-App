-- Close the phantom-insert window in set_route_day_order.
--
-- 20260825120720 locked the day's routes FOR UPDATE, which stops anyone *changing*
-- those rows but does nothing about a row that does not exist yet. A route
-- inserted for the same rep-day after that read is not covered by the lock, so the
-- function validated and renumbered the old set and returned success while the day
-- ended up holding a stop the plan never saw.
--
-- That is not merely untidy, because of how the other writer numbers its rows.
-- `generate_routes` computes `row_number()` over the *whole* day's matched stops
-- and then inserts with `on conflict do nothing`, so a newly inserted stop carries
-- a number from the full-day alphabetical ranking. If it sorts first it arrives as
-- sequence 1 — colliding with the 1 this function has just written on a different
-- stop. Two stops called 1, in the column `route_repository.dart` sorts by.
--
-- Locking the rep's `profiles` row first closes it: `routes.rep_id` references
-- `profiles.id`, so *inserting* a route takes FOR KEY SHARE on that parent row,
-- and FOR UPDATE conflicts with it. Every route creator already takes that lock
-- without knowing it, which is what makes this work without changing them.
--
-- The lock is taken **before** the routes lock, so this function always acquires
-- in the same order. A concurrent `generate_routes` — which deletes stale routes
-- as well as inserting — can still deadlock against it, and Postgres will abort
-- one of the two. That is an acceptable failure here and deliberately not worked
-- around: this function is atomic, so an aborted re-order changes nothing and the
-- manager simply tries again. A wrong order that looks successful is the outcome
-- worth avoiding, not a visible error.

create or replace function public.set_route_day_order(
  p_rep_id    uuid,
  p_date      date,
  p_route_ids uuid[]
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_actual  uuid[];
  v_started int;
begin
  if p_date <= current_date then
    raise exception
      'A round can only be re-ordered before the day it falls on (% is not in the future).', p_date
      using errcode = '22023';
  end if;

  -- First, and before the routes are read: this is what stops a stop being added
  -- to the day while it is being renumbered. See the header.
  perform 1 from profiles where id = p_rep_id for update;

  select array_agg(locked.id order by locked.id) into v_actual
  from (
    select r.id
    from routes r
    where r.org_id = v_org
      and r.rep_id = p_rep_id
      and r.scheduled_date = p_date
    for update
  ) locked;

  if v_actual is null then
    raise exception 'No stops are scheduled for that rep on %.', p_date
      using errcode = '22023';
  end if;

  if not (v_actual @> p_route_ids
          and p_route_ids @> v_actual
          and coalesce(array_length(p_route_ids, 1), 0) = array_length(v_actual, 1)) then
    raise exception
      'Those are not exactly the stops scheduled for that day — reload the plan and try again.'
      using errcode = '22023';
  end if;

  select count(*) into v_started
  from visits v
  where v.route_id = any(v_actual)
    and v.checkin_at is not null;

  if v_started > 0 then
    raise exception
      'That round has already started, so its order cannot be changed.'
      using errcode = '22023';
  end if;

  update routes r
  set sequence_order = x.ord
  from (
    select unnest(p_route_ids) as id,
           generate_subscripts(p_route_ids, 1) as ord
  ) x
  where r.id = x.id;

  return array_length(p_route_ids, 1);
end;
$$;

comment on function public.set_route_day_order is
  'Sets sequence_order for a whole rep-day atomically. Locks the rep before reading the day, so a route cannot be inserted into it mid-renumber. Refuses a day in the past or today, a round already started, and any id set that is not exactly that day''s stops.';
