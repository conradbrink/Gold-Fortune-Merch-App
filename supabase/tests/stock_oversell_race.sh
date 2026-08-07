#!/usr/bin/env bash
#
# Two-session regression test: the last unit of stock must not be reserved twice.
#
# WHY THIS IS A SHELL SCRIPT AND NOT PART OF security_regression.sql
#
# The race needs two database sessions interleaved *mid-transaction*, and a
# single connection cannot express that. `security_regression.sql` runs as one
# transaction on one connection, so this lives separately and needs `psql` and a
# direct connection string.
#
# 🔴 As of writing, neither was available on the machine where `order_confirm`
# was built — no psql, no DATABASE_URL, and no Postgres client library of any
# kind. **The oversell guard is therefore the one part of the warehouse module
# that has been reasoned about and verified single-threaded, but never watched
# under a real race.** Every SQL fragment below has been executed against
# production inside a rolled-back transaction, so the harness is known to work;
# the interleaving itself is what remains unproven. This script is how it gets
# proven.
#
# THE RACE
#
# `order_confirm` reserves stock by walking the balance rows for a product,
# oldest expiry first, under `FOR UPDATE`:
#
#     select b.id, b.batch_id, b.qty_available
#       from stock_balances b ...
#      where b.qty_available > 0
#      order by pb.expiry_date nulls last, ...
#      for update of b
#
# Two clerks confirming two orders for the same last units:
#
#   Session A                             Session B
#   ---------                             ---------
#   BEGIN                                 BEGIN
#   order_confirm(A)                      order_confirm(B)
#     locks the balance row                 blocks on that lock
#     posts available -> reserved
#   COMMIT
#                                           lock released; re-reads the row
#                                           qty_available is now 0, so the row
#                                           leaves the result set entirely
#                                         → shortfall path, and with the
#                                           'reject' action, a refusal
#
# The claim being tested is the one the design rests on: under READ COMMITTED a
# blocked `FOR UPDATE` waiter re-evaluates its WHERE clause against the version
# the winner committed (EvalPlanQual), rather than proceeding on the snapshot it
# took before blocking. If that were not so, B would reserve stock that is no
# longer there and `check (qty_available >= 0)` on stock_balances would fire —
# which is the backstop, not the mechanism, and firing it means the mechanism
# failed.
#
# So there are two distinct failure modes and this script distinguishes them:
#
#   both orders confirmed        the lock did nothing
#   B failed with a 23514        the lock held but EvalPlanQual did not; the
#     constraint violation       backstop caught it. Still a failure of the
#                                design, and a much noisier one in production.
#   B failed with "Not enough"   correct.
#
# USAGE
#
#   DATABASE_URL='postgresql://postgres:PASSWORD@HOST:5432/postgres' \
#     supabase/tests/stock_oversell_race.sh
#
# It creates a throwaway product, ten units of it, and two orders that each want
# all ten; races them; asserts; and deletes everything it made. Safe against
# production: it touches only the rows it created.

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. See the usage note at the top of this file." >&2
  exit 2
fi
command -v psql >/dev/null || { echo "psql is required and was not found." >&2; exit 2; }

q() { psql "$DATABASE_URL" -t -A -c "$1"; }

ORG=$(q "select id from public.organizations order by created_at limit 1")
[ -n "$ORG" ] || { echo "No organisation to test against." >&2; exit 1; }

LOC=$(q "select id from public.stock_locations
          where org_id = '$ORG' and is_default limit 1")
[ -n "$LOC" ] || { echo "No default stock location." >&2; exit 1; }

STORE=$(q "select id from public.stores where org_id = '$ORG' limit 1")
[ -n "$STORE" ] || { echo "No store to order for." >&2; exit 1; }

# order_confirm is SECURITY DEFINER and checks current_role(); connecting as
# postgres leaves auth.uid() null, so the sessions below impersonate a real
# member of staff who is allowed to confirm.
ACTOR=$(q "select id from public.profiles
            where org_id = '$ORG' and is_active
              and role in ('manager','warehouse') limit 1")
[ -n "$ACTOR" ] || {
  echo "No active manager or warehouse profile to act as." >&2
  exit 1
}

# The trap goes on BEFORE the first insert, not after the fixtures are built.
# `set -e` is active, so a failure part-way through the setup below would
# otherwise exit the shell before the trap existed, and leave a probe product,
# an opening_stock movement and a half-built order sitting in production —
# where stock_movements is append-only and its foreign keys are ON DELETE
# RESTRICT, so clearing it up by hand is genuinely awkward.
#
# Every id is therefore declared empty first, and cleanup skips whatever was
# never assigned.
PRODUCT=""; ORDER_A=""; ORDER_B=""

# Per-run temporary logs. The fixed /tmp names were both guessable by another
# user on a shared host and shared between concurrent runs of this script.
LOG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/oversell.XXXXXX")
LOG_A="$LOG_DIR/session_a.log"
LOG_B="$LOG_DIR/session_b.log"

cleanup() {
  # An `if`, not a `&&` chain: a false test as the first statement of the
  # function would return non-zero and take the database clean-up below with
  # it, which is the half that actually matters.
  if [ -n "${LOG_DIR:-}" ]; then rm -rf "$LOG_DIR"; fi
  [ -n "$PRODUCT$ORDER_A$ORDER_B" ] || return 0
  # Deleting from stock_movements trips `stock_movements_immutable` for anyone
  # who is not postgres/service_role/supabase_admin. DATABASE_URL is a direct
  # postgres connection, so this is allowed — but the failure has to be visible
  # rather than swallowed, or the script reports a clean exit while leaving the
  # ledger dirty.
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 <<SQL || echo "CLEANUP FAILED — remove the probe rows for product '$PRODUCT' by hand." >&2
    delete from public.order_allocations
     where order_id in (nullif('$ORDER_A','')::uuid, nullif('$ORDER_B','')::uuid);
    delete from public.order_status_events
     where order_id in (nullif('$ORDER_A','')::uuid, nullif('$ORDER_B','')::uuid);
    delete from public.order_lines
     where order_id in (nullif('$ORDER_A','')::uuid, nullif('$ORDER_B','')::uuid);
    delete from public.orders
     where id in (nullif('$ORDER_A','')::uuid, nullif('$ORDER_B','')::uuid);
    -- Movements before balances before the product: the ledger's foreign keys
    -- to products and locations are ON DELETE RESTRICT, on purpose.
    delete from public.stock_movements where product_id = nullif('$PRODUCT','')::uuid;
    delete from public.stock_balances  where product_id = nullif('$PRODUCT','')::uuid;
    delete from public.products        where id = nullif('$PRODUCT','')::uuid;
SQL
}
trap cleanup EXIT

PRODUCT=$(q "insert into public.products (org_id, name)
             values ('$ORG', 'Oversell Race Probe') returning id")

# Exactly ten units, and two orders that each want all ten. One of them has to
# lose.
q "insert into public.stock_movements
     (org_id, product_id, qty, to_location_id, to_bucket, reason, source_doc_type)
   values ('$ORG', '$PRODUCT', 10, '$LOC', 'available', 'opening_stock', 'system')" >/dev/null

ORDER_A=$(q "insert into public.orders
   (org_id, order_number, store_id, source, client_generated_id)
   values ('$ORG', 'RACE-A-'||substr(gen_random_uuid()::text,1,8), '$STORE',
           'warehouse_manual', gen_random_uuid()) returning id")
ORDER_B=$(q "insert into public.orders
   (org_id, order_number, store_id, source, client_generated_id)
   values ('$ORG', 'RACE-B-'||substr(gen_random_uuid()::text,1,8), '$STORE',
           'warehouse_manual', gen_random_uuid()) returning id")

for O in "$ORDER_A" "$ORDER_B"; do
  q "insert into public.order_lines
       (org_id, order_id, product_id, qty_ordered, client_generated_id)
     values ('$ORG', '$O', '$PRODUCT', 10, gen_random_uuid())" >/dev/null
done

echo "created product=$PRODUCT order_a=$ORDER_A order_b=$ORDER_B (10 units available)"

# Session B second in wall-clock terms but started first, holding back a second
# so A is guaranteed to take the row lock first. B then blocks on it rather than
# racing the read, which is the situation being tested.
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=0 >"$LOG_B" 2>&1 <<SQL &
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','$ACTOR','role','authenticated')::text, true);
set local role authenticated;
select pg_sleep(1);
select public.order_confirm('$ORDER_B'::uuid, '$LOC'::uuid, 'reject');
commit;
SQL
B_PID=$!

# Session A takes the lock, holds the transaction open past B's attempt, commits.
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=0 >"$LOG_A" 2>&1 <<SQL
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','$ACTOR','role','authenticated')::text, true);
set local role authenticated;
select public.order_confirm('$ORDER_A'::uuid, '$LOC'::uuid, 'reject');
select pg_sleep(3);
commit;
SQL

wait "$B_PID" || true

echo "--- session A ---"; cat "$LOG_A"
echo "--- session B ---"; cat "$LOG_B"

CONFIRMED=$(q "select count(*) from public.orders
                where id in ('$ORDER_A','$ORDER_B') and status = 'confirmed'")
RESERVED=$(q "select coalesce(sum(qty_reserved),0) from public.stock_balances
               where product_id = '$PRODUCT' and location_id = '$LOC'")
AVAILABLE=$(q "select coalesce(sum(qty_available),0) from public.stock_balances
                where product_id = '$PRODUCT' and location_id = '$LOC'")
NEGATIVE=$(q "select count(*) from public.stock_balances
               where product_id = '$PRODUCT' and qty_available < 0")

echo "confirmed: $CONFIRMED of 2   reserved: $RESERVED   available: $AVAILABLE"

FAILED=0

if [ "$NEGATIVE" != "0" ]; then
  echo "FAIL: stock went negative. The non-negative constraint did not hold." >&2
  FAILED=1
fi

if [ "$CONFIRMED" = "2" ]; then
  echo "FAIL: both orders were confirmed against ten units. The FOR UPDATE" >&2
  echo "      lock in order_confirm is not serialising the reservation." >&2
  FAILED=1
fi

# Zero confirmed means the race was never staged — a bad actor id, a permissions
# problem, a connection that never opened. A harness reporting success without
# having run the thing it tests is worse than a failing one, because it looks
# like evidence. The territory race script carries the same guard for the same
# reason.
if [ "$CONFIRMED" = "0" ]; then
  echo "FAIL: neither order was confirmed — the race was never staged." >&2
  echo "      Check the session logs above. This is a harness failure, not a" >&2
  echo "      passing test." >&2
  FAILED=1
fi

if [ "$CONFIRMED" = "1" ] && { [ "$RESERVED" != "10" ] || [ "$AVAILABLE" != "0" ]; }; then
  echo "FAIL: one order confirmed but the buckets do not add up" >&2
  echo "      (expected reserved=10 available=0)." >&2
  FAILED=1
fi

# The loser should have been refused by order_confirm's own shortfall path, not
# by the balance constraint. Both prevent the oversell; only the first means the
# lock did its job.
# Both logs, not just B's. Which session loses is decided by wall-clock
# timing — B sleeps a second to let A take the lock first, but on a loaded host
# or a slow handshake B can still get there first and A becomes the loser. The
# other assertions survive that because they count confirmed orders rather than
# naming a winner; this one would not. Grepping only B would find nothing and
# print PASS in exactly the case the script exists to catch.
if grep -qi 'violates check constraint "stock_balances_non_negative"' "$LOG_A" "$LOG_B"; then
  echo "FAIL: the second order was stopped by the non-negative constraint, not" >&2
  echo "      by the reservation loop. The lock held but the blocked session did" >&2
  echo "      not re-read the row — the backstop caught what the mechanism" >&2
  echo "      should have." >&2
  FAILED=1
fi

DRIFT=$(q "select count(*) from (
  with legs as (
    select m.to_location_id lid, m.product_id, m.batch_id, m.to_bucket bucket, m.qty::bigint q
      from public.stock_movements m
     where m.product_id = '$PRODUCT' and m.to_location_id is not null
    union all
    select m.from_location_id, m.product_id, m.batch_id, m.from_bucket, -m.qty::bigint
      from public.stock_movements m
     where m.product_id = '$PRODUCT' and m.from_location_id is not null),
  led as (select lid, product_id, batch_id, bucket, sum(q) q from legs group by 1,2,3,4),
  cac as (select b.location_id lid, b.product_id, b.batch_id, v.bucket, v.qty::bigint q
      from public.stock_balances b
      cross join lateral (values ('available',b.qty_available),('reserved',b.qty_reserved),
        ('damaged',b.qty_damaged),('expired',b.qty_expired),
        ('in_transit',b.qty_in_transit),('promotional',b.qty_promotional)) as v(bucket,qty)
     where b.product_id = '$PRODUCT')
  select 1 from led l full join cac c on c.lid = l.lid and c.product_id = l.product_id
    and c.batch_id is not distinct from l.batch_id and c.bucket = l.bucket
   where coalesce(c.q,0) is distinct from coalesce(l.q,0)) d")

if [ "$DRIFT" != "0" ]; then
  echo "FAIL: the balance and the ledger disagree for this product ($DRIFT rows)." >&2
  FAILED=1
fi

[ "$FAILED" = "0" ] || exit 1

echo "PASS: exactly one order reserved the stock, the other was refused by the"
echo "      reservation loop, and the ledger and balance agree."
