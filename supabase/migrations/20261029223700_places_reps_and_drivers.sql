-- Drivers take a paid place, as reps do (29 Oct 2026).
--
-- Owner: "we've got obviously the reps, and then we've got the drivers. So if
-- they want the drivers, then they will also count towards using the app."
-- A place is everyone who works from the phone app. Managers, office and
-- warehouse logins stay free.
--
-- Until now only role = 'rep' counted (20261020160000_rep_plans), and the
-- driver role (20261029161700) was added as "takes no place". Three functions
-- hold the rule, and each changes the same way, `role = 'rep'` becoming
-- `role in ('rep', 'driver')`:
--
--   billing_seats_used   the places a company is billed for
--   profiles_user_limit  the trigger that stops a pilot or plan going over
--   my_setup             the places the setup screen shows taken
--
-- Each is changed in place on its live definition, anchored on the exact text
-- it has now: if any anchor is not found exactly as many times as expected,
-- nothing is changed. Nothing else in the functions moves.
--
-- The plan names on the price list ("Plan for up to 10 reps") are what
-- billing invoices print; they now say "reps and drivers".
--
-- No company has a driver on production today, so no bill changes when this
-- is applied.

do $$
declare
  def text;
  r record;
begin
  for r in
    select * from (values
      ('public.billing_seats_used(uuid, jsonb)', 'role = ''rep''', 'role in (''rep'', ''driver'')', 2),
      ('public.billing_seats_used(uuid, jsonb)', '-- A plan''s places are for reps (20261020160000)',
       '-- A plan''s places are for reps and drivers (20261020160000, 20261029223700)', 1),
      ('public.profiles_user_limit()', 'if new.role is distinct from ''rep'' then',
       'if new.role is null or new.role not in (''rep'', ''driver'') then', 1),
      ('public.profiles_user_limit()', '-- Only reps take a place (20261020160000).',
       '-- Only reps and drivers take a place (20261020160000, 20261029223700).', 1),
      ('public.profiles_user_limit()', 'and is_active and role = ''rep'';',
       'and is_active and role in (''rep'', ''driver'');', 1),
      ('public.my_setup()', 'p.role = ''rep''', 'p.role in (''rep'', ''driver'')', 1),
      ('public.my_setup()', 'the plan''s seats; reps only.', 'the plan''s seats; reps and drivers.', 1)
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
   set label = label || ' and drivers'
 where kind = 'base'
   and label ~ '^Plan for up to [0-9]+ reps$';
