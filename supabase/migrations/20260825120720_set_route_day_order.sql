-- Write a day's stop order in one transaction, or not at all.
--
-- The order itself is worked out in the browser (`web/lib/route-order.ts`), and
-- deliberately stays there — it needs 2-opt, and plpgsql is a poor place for it.
-- This function is only the *write*, and it exists because doing that write from
-- the browser could not be made safe:
--
--   * One PostgREST update per stop is one transaction per stop. A failure part
--     way through leaves a day holding new numbers for some stops and old ones
--     for others, which means duplicate `sequence_order` values — and
--     `route_repository.dart` orders by that column, so the rep opens their phone
--     to a broken round. There was no rollback, only an error message asking the
--     user to reload after the damage was done.
--   * The "has this round already started" check ran when the *proposal* was
--     built, then sat in component state while a manager read it. A rep checking
--     in during that window had their day renumbered under them.
--
-- Both stop being possible when the check and the write are the same statement.

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
  -- Nothing today and nothing past. A rep can be halfway through today's round
  -- without having checked in anywhere yet, so "no check-ins" is not enough on
  -- its own; `generate_routes` draws the same line for the same reason.
  if p_date <= current_date then
    raise exception
      'A round can only be re-ordered before the day it falls on (% is not in the future).', p_date
      using errcode = '22023';
  end if;

  -- Lock the day's routes.
  --
  -- This is what makes the started-day check below trustworthy rather than
  -- advisory. `visits.route_id` references `routes.id`, so inserting a check-in
  -- takes FOR KEY SHARE on these very rows, and FOR UPDATE conflicts with it —
  -- a rep checking in cannot slip between the check and the update, they block
  -- until this transaction ends and then find the day already re-ordered.
  -- The lock sits in the subquery because Postgres refuses FOR UPDATE alongside
  -- an aggregate ("FOR UPDATE is not allowed with aggregate functions"). The rows
  -- are still locked before `array_agg` sees them, which is what matters.
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

  -- Exactly this day's stops, no more and no fewer.
  --
  -- Containment both ways plus equal length, so a caller cannot renumber *part*
  -- of a day: not one built from a truncated PostgREST page, not one whose stops
  -- changed while the proposal was on screen, and not one carrying a duplicate id
  -- (which fails containment against the real set). Renumbering a subset is what
  -- produces two stops called 3.
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

  -- One statement. `generate_subscripts` carries the position, so the array's
  -- own order is the stop order — there is no second source of truth to disagree
  -- with it, and no window in which half the day is renumbered.
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
  'Sets sequence_order for a whole rep-day atomically. Refuses a day in the past or today, a round already started, and any id set that is not exactly that day''s stops.';
