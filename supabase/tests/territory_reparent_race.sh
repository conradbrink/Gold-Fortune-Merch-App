#!/usr/bin/env bash
#
# Two-session regression test: opposing territory reparenting must not commit a
# cycle.
#
# WHY THIS IS A SHELL SCRIPT AND NOT PART OF security_regression.sql
#
# The race needs two database sessions interleaved *mid-transaction*, which a
# single connection cannot express. `security_regression.sql` runs as one
# transaction on one connection, so this one lives separately and needs `psql`
# and a direct connection string — neither of which was available on the machine
# where the fix was written (no psql, no DATABASE_URL, and `dblink` would need the
# database password). The guard in
# `20260730180000_serialize_territory_reparenting.sql` is therefore the only
# change on that branch that was reasoned about rather than demonstrated. This
# script is how it gets demonstrated.
#
# THE RACE
#
# `territories_enforce_shape` reads the prospective parent to check it is not
# itself a sub-territory. That read sees only committed rows, so without
# serialisation:
#
#   Session A                        Session B
#   ---------                        ---------
#   BEGIN
#   UPDATE A SET parent_id = B       BEGIN
#     -- reads B: a root. OK.        UPDATE B SET parent_id = A
#                                      -- reads A: still a root. OK.
#   COMMIT                           COMMIT
#
# Both succeed and A and B are each other's parent — a cycle, in a structure the
# whole app assumes is two levels deep.
#
# WITH the advisory lock, B's update blocks until A commits, then reads A and
# finds it is now a sub-territory, so the trigger raises "Territories are two
# levels deep". Exactly one of the two wins, which is the assertion below.
#
# USAGE
#
#   DATABASE_URL='postgresql://postgres:PASSWORD@HOST:5432/postgres' \
#     supabase/tests/territory_reparent_race.sh
#
# It creates two throwaway root territories, races them, asserts, and deletes
# them. Safe against production: it touches only the rows it created.

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. See the usage note at the top of this file." >&2
  exit 2
fi
command -v psql >/dev/null || { echo "psql is required and was not found." >&2; exit 2; }

run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -t -A -c "$1"; }

ORG=$(psql "$DATABASE_URL" -t -A -c "select id from public.organizations order by created_at limit 1")
[ -n "$ORG" ] || { echo "No organisation to test against." >&2; exit 1; }

A=$(psql "$DATABASE_URL" -t -A -c \
  "insert into public.territories (org_id, name) values ('$ORG', 'Race Root A') returning id")
B=$(psql "$DATABASE_URL" -t -A -c \
  "insert into public.territories (org_id, name) values ('$ORG', 'Race Root B') returning id")
echo "created A=$A B=$B"

cleanup() {
  psql "$DATABASE_URL" -q -c \
    "update public.territories set parent_id = null where id in ('$A','$B');
     delete from public.territories where id in ('$A','$B');" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Session B first, holding back one second so A is guaranteed to take the lock
# first. B then blocks on it rather than racing the read.
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=0 >/tmp/race_b.log 2>&1 <<SQL &
begin;
select pg_sleep(1);
update public.territories set parent_id = '$A' where id = '$B';
commit;
SQL
B_PID=$!

# Session A takes the lock, holds the transaction open past B's attempt, commits.
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=0 >/tmp/race_a.log 2>&1 <<SQL
begin;
update public.territories set parent_id = '$B' where id = '$A';
select pg_sleep(3);
commit;
SQL

wait "$B_PID" || true

echo "--- session A ---"; cat /tmp/race_a.log
echo "--- session B ---"; cat /tmp/race_b.log

# The assertion: at most one of the pair may have acquired a parent, and neither
# may point at the other in both directions.
CYCLE=$(psql "$DATABASE_URL" -t -A -c \
  "select count(*) from public.territories t
     join public.territories p on p.id = t.parent_id
    where t.id in ('$A','$B') and p.parent_id = t.id")
PARENTED=$(psql "$DATABASE_URL" -t -A -c \
  "select count(*) from public.territories where id in ('$A','$B') and parent_id is not null")

echo "cycle rows: $CYCLE   reparented: $PARENTED of 2"

if [ "$CYCLE" != "0" ]; then
  echo "FAIL: a reparenting cycle was committed — the advisory lock is not holding." >&2
  exit 1
fi
if [ "$PARENTED" = "2" ]; then
  echo "FAIL: both territories were reparented; one should have been refused." >&2
  exit 1
fi
echo "PASS: no cycle, and $PARENTED of the two was reparented."
