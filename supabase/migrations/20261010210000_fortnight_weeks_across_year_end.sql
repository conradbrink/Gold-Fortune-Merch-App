-- Every-two-weeks schedules keep alternating across the ISO year end.
--
-- `generate_routes` and `call_cycle_review` chose week A or week B by the
-- parity of the ISO week number: `extract(week from day) % 2`. ISO years have
-- 52 or 53 weeks, and 2026 has 53. Week 53 (from 28 Dec 2026) and week 1
-- (from 4 Jan 2027) are both odd, so a week-A site was planned two weeks
-- running and a week-B site went three weeks without a visit. That repeats
-- after every 53-week year.
--
-- The parity now counts whole weeks from Monday 1 January 2001, which was the
-- Monday of ISO week 1. It gives the same A and B as the old rule on every day
-- from 2021 to 27 Dec 2026 (checked day by day: 0 of 2,184 days differ), so no
-- plan already made moves. From 28 Dec 2026 it simply keeps alternating.
--
--   old: (extract(week from X)::int % 2)
--   new: ((((X) - date '2001-01-01') / 7 + 1) % 2)
--
-- `web/lib/schedule.ts` (`fortnightParity`) uses the same count for the
-- preview and the A/B label. The bodies are patched in place, each anchor
-- asserted to appear the expected number of times; the rollback reverses it.

do $$
declare
  r record;
  def text;
  n int;
begin
  for r in
    select * from (values
      ('generate_routes',   'extract(week from d.day)::int % 2',            '((d.day - date ''2001-01-01'') / 7 + 1) % 2', 1),
      ('generate_routes',   'extract(week from r.scheduled_date)::int % 2', '((r.scheduled_date - date ''2001-01-01'') / 7 + 1) % 2', 1),
      ('call_cycle_review', 'extract(week from d.the_day)::int % 2',        '((d.the_day - date ''2001-01-01'') / 7 + 1) % 2', 1)
    ) v(fn, old_text, new_text, expected)
  loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = r.fn;
    if def is null then
      raise exception '%: not found', r.fn;
    end if;
    n := (length(def) - length(replace(def, r.old_text, ''))) / length(r.old_text);
    if n <> r.expected then
      raise exception '%: expected % of "%", found %', r.fn, r.expected, r.old_text, n;
    end if;
    execute replace(def, r.old_text, r.new_text);
  end loop;
end;
$$;
