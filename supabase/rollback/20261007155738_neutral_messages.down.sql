-- Rollback for neutral_messages: every message back to its old wording, by
-- the same exact-match rewrite in reverse.

do $$
declare
  r record;
  v_def text;
  v_seen int;
begin
  -- Each pair: the text as it stands in the function's source, its
  -- replacement, and how many times it must appear. Anything else refuses the
  -- whole rollback, so a function changed since is never half-rewritten.
  create temp table msg_rewrites (fn text, old text, new text, times int, ord serial) on commit drop;
  insert into msg_rewrites (fn, old, new, times) values
    ($m$assign_dispatch_rep(uuid,uuid)$m$, $m$only field staff use the app.$m$, $m$only a field rep opens the app.$m$, 1),
    ($m$freeze_recorded_position()$m$, $m$A check-in cannot be moved to someone else after it is created.$m$, $m$A visit cannot be reassigned after it is created.$m$, 1),
    ($m$leads_freeze_start()$m$, $m$A sales check-in cannot be moved to someone else.$m$, $m$A sales visit cannot be reassigned.$m$, 1),
    ($m$leads_freeze_start()$m$, $m$The recorded position of a sales check-in cannot be changed.$m$, $m$The recorded position of a sales visit cannot be changed.$m$, 2),
    ($m$leads_freeze_start()$m$, $m$The start time of a sales check-in cannot be changed.$m$, $m$The start time of a sales visit cannot be changed.$m$, 1),
    ($m$orders_enforce_transition()$m$, $m$it cannot be moved to another location.$m$, $m$it cannot be moved to another customer.$m$, 1),
    ($m$set_route_day_order(uuid,date,uuid[])$m$, $m$Nothing is scheduled for that person on %.$m$, $m$No stops are scheduled for that rep on %.$m$, 1),
    ($m$set_route_day_order(uuid,date,uuid[])$m$, $m$Those are not exactly the places scheduled for that day$m$, $m$Those are not exactly the stops scheduled for that day$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$Someone else already set this location on site.$m$, $m$Another rep already set this store''s location on site.$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$Someone else set this location a moment ago.$m$, $m$Another rep set this store''s location a moment ago.$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$Check in here first, then set this location.$m$, $m$Check in at the store before setting its location.$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$That place is no longer in your organisation.$m$, $m$That store is no longer in your organisation.$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$This check-in has not reached the server yet.$m$, $m$This visit has not reached the server yet.$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$so this cannot be the right place.$m$, $m$so this is not the store.$m$, 1),
    ($m$set_store_location_from_visit(uuid,double precision,double precision,double precision)$m$, $m$You can only set a location from your own check-in.$m$, $m$You can only set a location from your own visit.$m$, 2),
    ($m$stores_enforce_territory()$m$, $m$Sub-areas no longer exist. Choose an area instead.$m$, $m$Sub-territories no longer exist. Put the store in a territory instead.$m$, 1),
    ($m$stores_enforce_territory()$m$, $m$That area does not exist.$m$, $m$That territory does not exist.$m$, 1),
    ($m$stores_enforce_territory()$m$, $m$A place can only be in its own organisation''s areas.$m$, $m$A store can only belong to its own organisation''s territories.$m$, 1),
    ($m$stores_enforce_territory()$m$, $m$% is a %. Choose one of the areas inside it, not the % itself.$m$, $m$% is a %. A store goes in a territory, not a %.$m$, 1),
    ($m$territories_enforce_shape()$m$, $m$% child area(s), % place(s) and % staff assignment(s) depend on it.$m$, $m$% child territory/ies, % store(s) and % rep assignment(s) depend on it.$m$, 1),
    ($m$territories_enforce_shape()$m$, $m$An area cannot be its own parent.$m$, $m$A territory cannot be its own parent.$m$, 1),
    ($m$territory_reps_enforce_org()$m$, $m$Staff can only cover areas in their own organisation.$m$, $m$A rep can only cover territories in their own organisation.$m$, 1),
    ($m$territory_reps_enforce_org()$m$, $m$An area can only be covered by staff in its own organisation.$m$, $m$A territory can only be covered by reps in its own organisation.$m$, 1),
    ($m$territory_reps_enforce_org()$m$, $m$That person does not exist.$m$, $m$That rep does not exist.$m$, 1),
    ($m$territory_reps_enforce_org()$m$, $m$That area does not exist.$m$, $m$That territory does not exist.$m$, 1);

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
