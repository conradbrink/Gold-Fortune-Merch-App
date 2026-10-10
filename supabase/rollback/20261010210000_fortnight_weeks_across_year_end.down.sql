-- Rollback of 20261010210000_fortnight_weeks_across_year_end: back to ISO week
-- parity, by the inverse replacement.
do $$
declare
  r record;
  def text;
  n int;
begin
  for r in
    select * from (values
      ('generate_routes',   '((d.day - date ''2001-01-01'') / 7 + 1) % 2',            'extract(week from d.day)::int % 2', 1),
      ('generate_routes',   '((r.scheduled_date - date ''2001-01-01'') / 7 + 1) % 2', 'extract(week from r.scheduled_date)::int % 2', 1),
      ('call_cycle_review', '((d.the_day - date ''2001-01-01'') / 7 + 1) % 2',        'extract(week from d.the_day)::int % 2', 1)
    ) v(fn, old_text, new_text, expected)
  loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = r.fn;
    n := (length(def) - length(replace(def, r.old_text, ''))) / length(r.old_text);
    if n <> r.expected then
      raise exception '%: expected % of "%", found %', r.fn, r.expected, r.old_text, n;
    end if;
    execute replace(def, r.old_text, r.new_text);
  end loop;
end;
$$;
