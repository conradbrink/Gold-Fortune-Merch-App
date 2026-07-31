-- ──────────────────────────────────────────────────────────────────────────
-- 1. SMOKE CHECK — object counts
-- ──────────────────────────────────────────────────────────────────────────
--
-- Cheap, and it proves only that nothing is obviously missing. Two schemas can
-- match on every number here and still differ in a column type, a default, a
-- function body, a grant, or an RLS predicate. Passing this is not equivalence;
-- failing it means something is plainly wrong.

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
  e.n::bigint as expected,
  a.n::bigint as actual,
  case when a.n = e.n then 'OK' else '*** MISMATCH ***' end as result
from actual a
join expected e using (item)
order by (a.n = e.n), a.item;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. THE REAL CHECK — digests over the definitions themselves
-- ──────────────────────────────────────────────────────────────────────────
--
-- Every row must say OK. These hash what the objects actually *are*: full
-- function bodies, every column with its type, default and nullability, every
-- RLS policy with its USING and WITH CHECK expressions and the roles they
-- apply to, every index, constraint and trigger definition.
--
-- A mismatch names the category, not the row. To find it, run the same
-- `string_agg` without the `md5()` on both projects and diff the output.
--
-- Read from production (rxtlnetlzmbqirqaalkw) when this file was generated.
-- Regenerate after every migration, or this measures staging against a
-- production that no longer exists.

with actual (item, digest) as (
  values
    ('functions', (select md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname, pg_get_function_identity_arguments(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')),
    ('columns', (select md5(string_agg(table_name||'.'||column_name||' '||data_type||' '||coalesce(column_default,'-')||' '||is_nullable, E'\n' order by table_name, column_name)) from information_schema.columns where table_schema='public')),
    ('rls policies', (select md5(string_agg(schemaname||'.'||tablename||'.'||policyname||' '||cmd||' '||coalesce(qual,'-')||' '||coalesce(with_check,'-')||' '||array_to_string(roles,','), E'\n' order by schemaname, tablename, policyname)) from pg_policies where schemaname in ('public','storage'))),
    ('indexes', (select md5(string_agg(indexdef, E'\n' order by indexname)) from pg_indexes where schemaname='public')),
    ('constraints', (select md5(string_agg(conname||' '||pg_get_constraintdef(c.oid), E'\n' order by conname)) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public')),
    ('triggers', (select md5(string_agg(pg_get_triggerdef(t.oid), E'\n' order by tgname)) from pg_trigger t join pg_class cl on cl.oid=t.tgrelid join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public' and not t.tgisinternal))
),
expected (item, digest) as (
  values
    ('functions', '0d3267eecbff8f3f6ed3873efd91a55d'),
    ('columns', 'de65792cf23e5bcf1e0aea26a36366ee'),
    ('rls policies', '6dc453293ab8b25cbe2a26fb180f3b8c'),
    ('indexes', 'f8f64b2ab5420196757111f23bfc691c'),
    ('constraints', 'f8ab861be664c33b4474805c2f2755bb'),
    ('triggers', 'caccd7b4d6bf76948074d670143163cb')
)
select
  a.item,
  case when a.digest = e.digest then 'OK' else '*** MISMATCH ***' end as result,
  e.digest as expected,
  a.digest as actual
from actual a
join expected e using (item)
order by (a.digest = e.digest), a.item;
