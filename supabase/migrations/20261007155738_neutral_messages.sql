-- Neutral database messages: the errors people read no longer say store,
-- visit, rep or territory.
--
-- Why: the web and the phone show these messages word for word, and the
-- platform now serves companies whose places are not stores and whose people
-- are not reps (requirements: "No hard-coded business words in UI, app,
-- reports or PDFs"). Decided on 7 Oct 2026: reword them neutrally rather than
-- look each company's words up inside the database. A message must make sense
-- to a cleaner as much as to a merchandiser: "place", "check-in", "someone
-- else", "staff", "area".
--
-- How: each function is rewritten from the catalogue with exact-match
-- replacement, each text asserted to appear exactly as often as expected, so
-- the module guards and permission checks at the top of each body are kept as
-- they are (the Stage 1-2 technique). Only message text changes; no error code
-- or condition does. Nothing in the web or phone matches on these texts
-- (checked: the one mention, in web/lib/route-order.ts, is a comment).
--
-- Left as they are: level names that come from data (country / region /
-- territory, filled in through %), and distribution's own vocabulary (order,
-- delivery, stocktake), which only distribution companies see.
--
-- Rollback: supabase/rollback/20261007155738_neutral_messages.down.sql.

do $$
declare
  r record;
  v_def text;
  v_seen int;
begin
  -- Each pair: the text as it stands in the function's source, its
  -- replacement, and how many times it must appear. Anything else refuses the
  -- whole migration, so a function changed since is never half-rewritten.
  create temp table msg_rewrites (fn text, old text, new text, times int, ord serial) on commit drop;
  insert into msg_rewrites (fn, old, new, times) values
    ($m$assign_dispatch_rep(uuid,uuid)$m$, $m$only a field rep opens the app.$m$, $m$only field staff use the app.$m$, 1),
    ($m$freeze_recorded_position()$m$, $m$A visit cannot be reassigned after it is created.$m$, $m$A check-in cannot be moved to someone else after it is created.$m$, 1),
    ($m$leads_freeze_start()$m$, $m$A sales visit cannot be reassigned.$m$, $m$A sales check-in cannot be moved to someone else.$m$, 1),
    ($m$leads_freeze_start()$m$, $m$The recorded position of a sales visit cannot be changed.$m$, $m$The recorded position of a sales check-in cannot be changed.$m$, 2),
    ($m$leads_freeze_start()$m$, $m$The start time of a sales visit cannot be changed.$m$, $m$The start time of a sales check-in cannot be changed.$m$, 1),
    ($m$orders_enforce_transition()$m$, $m$it cannot be moved to another customer.$m$, $m$it cannot be moved to another location.$m$, 1),
    ($m$set_route_day_order(uuid,date,uuid[])$m$, $m$No stops are scheduled for that rep on %.$m$, $m$Nothing is scheduled for that person on %.$m$, 1),
    ($m$set_route_day_order(uuid,date,uuid[])$m$, $m$Those are not exactly the stops scheduled for that day$m$, $m$Those are not exactly the places scheduled for that day$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$Another rep already set this store''s location on site.$m$, $m$Someone else already set this location on site.$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$Another rep set this store''s location a moment ago.$m$, $m$Someone else set this location a moment ago.$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$Check in at the store before setting its location.$m$, $m$Check in here first, then set this location.$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$That store is no longer in your organisation.$m$, $m$That place is no longer in your organisation.$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$This visit has not reached the server yet.$m$, $m$This check-in has not reached the server yet.$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$so this is not the store.$m$, $m$so this cannot be the right place.$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$You can only set a location from your own visit.$m$, $m$You can only set a location from your own check-in.$m$, 2),
    ($m$stores_enforce_territory()$m$, $m$Sub-territories no longer exist. Put the store in a territory instead.$m$, $m$Sub-areas no longer exist. Choose an area instead.$m$, 1),
    ($m$stores_enforce_territory()$m$, $m$That territory does not exist.$m$, $m$That area does not exist.$m$, 1),
    ($m$stores_enforce_territory()$m$, $m$A store can only belong to its own organisation''s territories.$m$, $m$A place can only be in its own organisation''s areas.$m$, 1),
    ($m$stores_enforce_territory()$m$, $m$% is a %. A store goes in a territory, not a %.$m$, $m$% is a %. Choose one of the areas inside it, not the % itself.$m$, 1),
    ($m$territories_enforce_shape()$m$, $m$% child territory/ies, % store(s) and % rep assignment(s) depend on it.$m$, $m$% child area(s), % place(s) and % staff assignment(s) depend on it.$m$, 1),
    ($m$territories_enforce_shape()$m$, $m$A territory cannot be its own parent.$m$, $m$An area cannot be its own parent.$m$, 1),
    ($m$territory_reps_enforce_org()$m$, $m$A rep can only cover territories in their own organisation.$m$, $m$Staff can only cover areas in their own organisation.$m$, 1),
    ($m$territory_reps_enforce_org()$m$, $m$A territory can only be covered by reps in its own organisation.$m$, $m$An area can only be covered by staff in its own organisation.$m$, 1),
    ($m$territory_reps_enforce_org()$m$, $m$That rep does not exist.$m$, $m$That person does not exist.$m$, 1),
    ($m$territory_reps_enforce_org()$m$, $m$That territory does not exist.$m$, $m$That area does not exist.$m$, 1);

  for r in select fn, array_agg(old order by ord) olds, array_agg(new order by ord) news,
                  array_agg(times order by ord) times
             from msg_rewrites group by fn order by fn
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    for i in 1 .. array_length(r.olds, 1) loop
      v_seen := (length(v_def) - length(replace(v_def, r.olds[i], ''))) / length(r.olds[i]);
      if v_seen <> r.times[i] then
        raise exception '%: expected "%" % time(s), found %', r.fn, r.olds[i], r.times[i], v_seen;
      end if;
      v_def := replace(v_def, r.olds[i], r.news[i]);
    end loop;
    execute v_def;
  end loop;
  drop table msg_rewrites;
end;
$$;
