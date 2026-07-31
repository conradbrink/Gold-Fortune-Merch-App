#!/usr/bin/env python3
"""Build the SQL that raises a new project to production's schema.

Why this exists
---------------
Staging lives in a separate free organisation that the Supabase connection
here cannot see, so the schema cannot be pushed to it. It has to be pasted
into that project's SQL editor by hand, once. This produces what to paste.

Three things make that harder than concatenating `supabase/migrations`:

1. **The history does not replay, in exactly one place.** Five functions widen
   their return type, which `create or replace` cannot do (42P13). Four of
   them already `drop function` first inside their own migration.
   `promotion_summaries` does not, and is the only one that still stops a
   replay dead.

   `supabase/README.md` names two outstanding cases; that is stale. The
   `generate_routes` workaround it describes is already in the migration file.
   Checking the `returns` clause alone flags all five — the check that matters
   is whether a drop precedes the redefinition in the same file.

2. **The SQL editor does not honour an outer `begin`.** A script that fails
   half way through has still applied everything before the failure, so a
   plain re-run is not safe. Every migration therefore stamps itself into
   `supabase_migrations.schema_migrations` as it lands, and the output is cut
   into chunks on migration boundaries — so "where did it get to" is a
   question the database can answer.

3. **A fresh project must end up with the migration history recorded**, or a
   later `supabase db push` tries to replay all 71 against a database that
   already has them.

Usage
-----
    python3 scripts/build-staging-schema.py

Re-run it after adding migrations; it regenerates `supabase/staging/`.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"
OUT = ROOT / "supabase" / "staging"

# Roughly how much SQL to put in one chunk. Split only ever happens on a
# migration boundary, so chunks overshoot rather than cut a statement in half.
CHUNK_TARGET_BYTES = 50_000

# A function whose return type changes cannot be replaced, only dropped and
# recreated. Keyed by the migration that does the redefining; the drop is
# emitted immediately before it.
#
# Only one entry, and that is the point: rep_scorecard, coverage_gaps,
# rep_directory and generate_routes all widen their return type too, but each
# already drops itself inside its own migration. Adding a redundant drop for
# them would be harmless but would misrepresent those files as broken.
#
# Verified by checking, for every redefinition whose `returns` clause changed,
# whether a `drop function` for that name appears earlier in the same file.
DROPS_BEFORE = {
    "20260729141843_fix_promotion_check_counting.sql": [
        # promotion_summaries gained `stores_not_stocked int` and is redefined
        # with `create or replace`, with no drop anywhere in the file.
        "drop function if exists public.promotion_summaries();",
    ],
}

# What production actually contains, read from rxtlnetlzmbqirqaalkw. The
# verification script compares staging against these rather than asking anyone
# to eyeball a number.
#
# Re-read these whenever migrations are added, or the check quietly measures
# staging against a production that no longer exists. Everything except the
# function and migration counts survived the region restructure unchanged —
# it moved rows and rewrote triggers, and created no new object.
EXPECTED = [
    ("tables", 30, "(select count(*) from pg_tables where schemaname='public')"),
    ("functions", 44,
     "(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace"
     " where n.nspname='public')"),
    ("security definer functions", 15,
     "(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace"
     " where n.nspname='public' and p.prosecdef)"),
    ("rls policies (public)", 82,
     "(select count(*) from pg_policies where schemaname='public')"),
    ("rls policies (storage)", 7,
     "(select count(*) from pg_policies where schemaname='storage')"),
    ("indexes", 97, "(select count(*) from pg_indexes where schemaname='public')"),
    ("triggers", 12,
     "(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid"
     " join pg_namespace n on n.oid=c.relnamespace"
     " where n.nspname='public' and not t.tgisinternal)"),
    ("foreign keys", 69,
     "(select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace"
     " where n.nspname='public' and c.contype='f')"),
    ("check constraints", 31,
     "(select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace"
     " where n.nspname='public' and c.contype='c')"),
    ("tables with RLS on", 30,
     "(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace"
     " where n.nspname='public' and c.relkind='r' and c.relrowsecurity)"),
    ("storage buckets", 3, "(select count(*) from storage.buckets)"),
    ("public storage buckets", 0,
     "(select count(*) from storage.buckets where public)"),
    ("migrations recorded", 73,
     "(select count(*) from supabase_migrations.schema_migrations)"),
]

RULE = "-- " + "─" * 74

PRELUDE = """\
-- Records which migrations have been applied. A fresh project may already
-- have this from Supabase; the alters cover a project that has it in an older
-- shape. Without it, a later `supabase db push` replays all 71.
create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version text primary key
);

alter table supabase_migrations.schema_migrations
  add column if not exists statements text[];
alter table supabase_migrations.schema_migrations
  add column if not exists name text;
"""


TRIGGER_RE = re.compile(
    r"^create trigger\s+(\S+)\s*\n\s*(?:before|after|instead of)[\s\S]*?\bon\s+([\w.\"]+)",
    re.IGNORECASE | re.MULTILINE,
)


def guard_triggers(sql: str) -> str:
    """Makes `create trigger` survive a second run of the same chunk.

    Everything else in these files is already re-runnable — `create table if
    not exists`, `create index if not exists`, `drop constraint if exists`.
    `create trigger` has no such form, so a chunk re-run after a partial
    failure dies with 42710 on the first trigger it reaches, before it gets to
    the stamp that would have told it the migration was already applied.
    """
    seen: list[tuple[str, str]] = []
    for m in TRIGGER_RE.finditer(sql):
        seen.append((m.group(1), m.group(2)))

    for name, table in seen:
        sql = sql.replace(
            f"create trigger {name}",
            f"drop trigger if exists {name} on {table};\ncreate trigger {name}",
            1,
        )
    return sql


def stamp(version: str, name: str) -> str:
    escaped = name.replace("'", "''")
    return (
        "insert into supabase_migrations.schema_migrations (version, name)\n"
        f"values ('{version}', '{escaped}')\non conflict (version) do nothing;\n"
    )


DIGESTS = [
    ("functions", "0d3267eecbff8f3f6ed3873efd91a55d",
     "select md5(string_agg(pg_get_functiondef(p.oid), E'\\n'"
     " order by p.proname, pg_get_function_identity_arguments(p.oid)))"
     " from pg_proc p join pg_namespace n on n.oid=p.pronamespace"
     " where n.nspname='public'"),
    ("columns", "de65792cf23e5bcf1e0aea26a36366ee",
     "select md5(string_agg(table_name||'.'||column_name||' '||data_type||' '||"
     "coalesce(column_default,'-')||' '||is_nullable, E'\\n'"
     " order by table_name, column_name))"
     " from information_schema.columns where table_schema='public'"),
    ("rls policies", "6dc453293ab8b25cbe2a26fb180f3b8c",
     "select md5(string_agg(schemaname||'.'||tablename||'.'||policyname||' '||cmd||' '||"
     "coalesce(qual,'-')||' '||coalesce(with_check,'-')||' '||array_to_string(roles,','), E'\\n'"
     " order by schemaname, tablename, policyname))"
     " from pg_policies where schemaname in ('public','storage')"),
    ("indexes", "f8f64b2ab5420196757111f23bfc691c",
     "select md5(string_agg(indexdef, E'\\n' order by indexname))"
     " from pg_indexes where schemaname='public'"),
    ("constraints", "f8ab861be664c33b4474805c2f2755bb",
     "select md5(string_agg(conname||' '||pg_get_constraintdef(c.oid), E'\\n' order by conname))"
     " from pg_constraint c join pg_namespace n on n.oid=c.connamespace"
     " where n.nspname='public'"),
    ("triggers", "caccd7b4d6bf76948074d670143163cb",
     "select md5(string_agg(pg_get_triggerdef(t.oid), E'\\n' order by tgname))"
     " from pg_trigger t join pg_class cl on cl.oid=t.tgrelid"
     " join pg_namespace n on n.oid=cl.relnamespace"
     " where n.nspname='public' and not t.tgisinternal"),
]


def build_verify() -> str:
    """Two checks, and only the second one proves anything.

    Counting objects is a smoke test: two schemas can agree on every count and
    still differ in a column type, a default, a function body, a grant or an
    RLS predicate — and an RLS predicate that differs is a data leak, not a
    cosmetic difference. So the counts stay, labelled as what they are, and the
    real comparison is a digest over the actual definitions.
    """
    count_rows = ",\n".join(
        f"    ('{label}', {expr})" for label, _, expr in EXPECTED
    )
    count_expected = ",\n".join(
        f"    ('{label}', {n})" for label, n, _ in EXPECTED
    )
    digest_rows = ",\n".join(
        f"    ('{label}', ({sql}))" for label, _, sql in DIGESTS
    )
    digest_expected = ",\n".join(
        f"    ('{label}', '{h}')" for label, h, _ in DIGESTS
    )
    return f"""\
{RULE}
-- 1. SMOKE CHECK — object counts
{RULE}
--
-- Cheap, and it proves only that nothing is obviously missing. Two schemas can
-- match on every number here and still differ in a column type, a default, a
-- function body, a grant, or an RLS predicate. Passing this is not equivalence;
-- failing it means something is plainly wrong.

with actual (item, n) as (
  values
{count_rows}
),
expected (item, n) as (
  values
{count_expected}
)
select
  a.item,
  e.n::bigint as expected,
  a.n::bigint as actual,
  case when a.n = e.n then 'OK' else '*** MISMATCH ***' end as result
from actual a
join expected e using (item)
order by (a.n = e.n), a.item;

{RULE}
-- 2. THE REAL CHECK — digests over the definitions themselves
{RULE}
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
{digest_rows}
),
expected (item, digest) as (
  values
{digest_expected}
)
select
  a.item,
  case when a.digest = e.digest then 'OK' else '*** MISMATCH ***' end as result,
  e.digest as expected,
  a.digest as actual
from actual a
join expected e using (item)
order by (a.digest = e.digest), a.item;
"""


RESUME = f"""\
{RULE}
-- Where did it get to?
{RULE}
--
-- The SQL editor does not honour an outer `begin`, so a chunk that fails part
-- way through has still applied everything before the failure. Do not simply
-- re-run it — ask the database what landed:

select
  count(*)                      as migrations_applied,
  max(version)                  as last_applied
from supabase_migrations.schema_migrations;

-- Match `last_applied` against the version headers in the chunk files and
-- carry on from the next one.
"""


def main() -> int:
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        print(f"No migrations found in {MIGRATIONS}", file=sys.stderr)
        return 1

    # Every drop must point at a migration that exists, or a rename has
    # silently disarmed it and the replay dies where it used to.
    names = {f.name for f in files}
    unknown = sorted(set(DROPS_BEFORE) - names)
    if unknown:
        print(
            "These migrations are named in DROPS_BEFORE but do not exist:\n  "
            + "\n  ".join(unknown),
            file=sys.stderr,
        )
        return 1

    blocks = []
    for i, path in enumerate(files, start=1):
        version, _, name = path.name[:-4].partition("_")
        body = path.read_text().rstrip()

        parts = [
            RULE,
            f"-- {i:2d}/{len(files)}  {path.name}",
            RULE,
            "",
        ]
        drops = DROPS_BEFORE.get(path.name)
        if drops:
            parts += [
                "-- This migration widens a function's return type, which",
                "-- `create or replace` cannot do (42P13). Dropping first is the",
                "-- only way the history replays onto an empty database.",
                *drops,
                "",
            ]
        parts += [guard_triggers(body), "", stamp(version, name), ""]
        blocks.append(("\n".join(parts), path.name))

    # Cut into chunks, only ever between migrations.
    chunks, current, size = [], [], 0
    for text, fname in blocks:
        if current and size + len(text) > CHUNK_TARGET_BYTES:
            chunks.append(current)
            current, size = [], 0
        current.append((text, fname))
        size += len(text)
    if current:
        chunks.append(current)

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.sql"):
        old.unlink()

    total = len(chunks)
    for n, chunk in enumerate(chunks, start=1):
        first, last = chunk[0][1], chunk[-1][1]
        header = [
            RULE,
            f"-- STAGING SCHEMA — CHUNK {n} OF {total}",
            RULE,
            "--",
            "-- Paste this whole file into the staging SQL editor and run it.",
            f"-- Covers {first}",
            f"--    .. through {last}",
            "--",
            "-- Run the chunks in order.",
            "--",
            "-- Wrapped in a transaction, so a statement that fails should take the",
            "-- whole chunk back out with it. That is a *should*: supabase/README.md",
            "-- records a 377 KB script that failed and had partly applied anyway,",
            "-- so the editor cannot be assumed to honour it. The per-migration",
            "-- stamps and 99_resume.sql are still the authority on what landed —",
            "-- check them rather than re-running blind.",
            RULE,
            "",
            "begin;",
            "",
        ]
        if n == 1:
            header += [PRELUDE, ""]

        body = "\n".join(header) + "\n".join(text for text, _ in chunk)
        (OUT / f"{n:02d}_of_{total:02d}.sql").write_text(
            body.rstrip() + "\n\ncommit;\n"
        )

    (OUT / "98_verify.sql").write_text(build_verify())
    (OUT / "99_resume.sql").write_text(RESUME)

    written = sorted(OUT.glob("*.sql"))
    print(f"Wrote {len(written)} files to {OUT.relative_to(ROOT)}/")
    for f in written:
        print(f"  {f.name:20s} {f.stat().st_size:>7,} bytes")
    print(f"\n{len(files)} migrations, {len(DROPS_BEFORE)} function drops inserted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
