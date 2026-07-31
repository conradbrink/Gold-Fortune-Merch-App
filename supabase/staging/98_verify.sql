-- ──────────────────────────────────────────────────────────────────────────
-- Does staging match production?
-- ──────────────────────────────────────────────────────────────────────────
--
-- Run this in the staging SQL editor once every chunk has been applied. Every
-- row must say OK. The expected numbers were read from production
-- (rxtlnetlzmbqirqaalkw) when this file was generated — regenerate it if the
-- schema has moved on since.
--
-- A mismatch is not a formality. It means "we tested it on staging" would be
-- a false statement, which is the entire reason staging exists.

with actual (item, n) as (
  values
    ('tables', (select count(*) from pg_tables where schemaname='public')),
    ('functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')),
    ('security definer functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef)),
    ('rls policies (public)', (select count(*) from pg_policies where schemaname='public')),
    ('rls policies (storage)', (select count(*) from pg_policies where schemaname='storage')),
    ('indexes', (select count(*) from pg_indexes where schemaname='public')),
    ('triggers', (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal)),
    ('foreign keys', (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='f')),
    ('check constraints', (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='c')),
    ('tables with RLS on', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity)),
    ('storage buckets', (select count(*) from storage.buckets)),
    ('public storage buckets', (select count(*) from storage.buckets where public)),
    ('migrations recorded', (select count(*) from supabase_migrations.schema_migrations))
),
expected (item, n) as (
  values
    ('tables', 30),
    ('functions', 44),
    ('security definer functions', 15),
    ('rls policies (public)', 82),
    ('rls policies (storage)', 7),
    ('indexes', 97),
    ('triggers', 12),
    ('foreign keys', 69),
    ('check constraints', 31),
    ('tables with RLS on', 30),
    ('storage buckets', 3),
    ('public storage buckets', 0),
    ('migrations recorded', 73)
)
select
  a.item,
  e.n::bigint  as expected,
  a.n::bigint  as actual,
  case when a.n = e.n then 'OK' else '*** MISMATCH ***' end as result
from actual a
join expected e using (item)
order by (a.n = e.n), a.item;
