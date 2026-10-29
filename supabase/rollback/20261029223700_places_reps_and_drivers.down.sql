-- Rollback of 20261029223700_places_reps_and_drivers: reps only again. Each
-- function is put back by the same anchored replace, the other way round.
-- Drivers added meanwhile stay; they simply stop counting.

do $$
declare
  def text;
  r record;
begin
  for r in
    select * from (values
      ('public.billing_seats_used(uuid, jsonb)', 'role in (''rep'', ''driver'')', 'role = ''rep''', 2),
      ('public.billing_seats_used(uuid, jsonb)',
       '-- A plan''s places are for reps and drivers (20261020160000, 20261029223700)',
       '-- A plan''s places are for reps (20261020160000)', 1),
      ('public.profiles_user_limit()', 'if new.role is null or new.role not in (''rep'', ''driver'') then',
       'if new.role is distinct from ''rep'' then', 1),
      ('public.profiles_user_limit()', '-- Only reps and drivers take a place (20261020160000, 20261029223700).',
       '-- Only reps take a place (20261020160000).', 1),
      ('public.profiles_user_limit()', 'and is_active and role in (''rep'', ''driver'');',
       'and is_active and role = ''rep'';', 1),
      ('public.my_setup()', 'p.role in (''rep'', ''driver'')', 'p.role = ''rep''', 1),
      ('public.my_setup()', 'the plan''s seats; reps and drivers.', 'the plan''s seats; reps only.', 1)
    ) x(fn, old_text, new_text, expected)
  loop
    def := pg_get_functiondef(r.fn::regprocedure);
    if (length(def) - length(replace(def, r.old_text, ''))) / length(r.old_text) <> r.expected then
      raise exception '%: expected % of the anchor "%"', r.fn, r.expected, r.old_text;
    end if;
    execute replace(def, r.old_text, r.new_text);
  end loop;
end;
$$;

update public.price_list
   set label = regexp_replace(label, ' and drivers$', '')
 where kind = 'base'
   and label ~ '^Plan for up to [0-9]+ reps and drivers$';
