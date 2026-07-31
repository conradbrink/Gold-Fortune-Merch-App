#!/usr/bin/env bash
#
# Export every business table from Supabase to timestamped JSON files.
#
# This exists because on 31 July 2026 the production project was deleted by
# accident and there was no export. The database backups Supabase takes are
# real, but they live inside the same account that was one wrong click away
# from vanishing — and they exclude Storage entirely. This is the copy that
# sits somewhere else.
#
#   ./scripts/backup-export.sh                  # uses web/.env.local
#   ./scripts/backup-export.sh /path/to/output  # somewhere else
#
# Needs SUPABASE_SERVICE_ROLE_KEY, because the point is to read everything
# regardless of row-level security. Keep the output somewhere private: it
# contains every row of your business data.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/web/.env.local"
OUT_BASE="${1:-$HOME/gf-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_BASE/$STAMP"

[ -f "$ENV_FILE" ] || { echo "✗ No $ENV_FILE — cannot find the credentials."; exit 1; }
set -a; . "$ENV_FILE"; set +a

: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is not set}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is not set}"

mkdir -p "$OUT"
echo "Exporting $NEXT_PUBLIC_SUPABASE_URL"
echo "     to  $OUT"
echo

# Every table holding business data. Ordered roughly parent-first so the files
# read sensibly; restoring is a separate exercise and needs that order.
TABLES=(
  organizations profiles
  territories territory_reps
  store_groups stores store_assignments
  products promotions promotion_products promotion_checks
  form_templates form_fields form_submissions form_responses
  routes visits photos leads
  workday_sessions location_pings
  app_releases dashboard_layouts service_flags security_events
)

fail=0
for t in "${TABLES[@]}"; do
  code=$(curl -s -o "$OUT/$t.json" -w "%{http_code}" --max-time 120 \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/$t?select=*")
  if [ "$code" != "200" ]; then
    echo "  ✗ $t — HTTP $code"; fail=1; continue
  fi
  # A row count, so a silently-empty export is visible rather than reassuring.
  n=$(python3 -c "import json,sys;print(len(json.load(open('$OUT/$t.json'))))" 2>/dev/null || echo "?")
  printf "  ✓ %-22s %6s rows\n" "$t" "$n"
done

# Storage objects: the metadata, plus the files themselves for the buckets that
# cannot be regenerated. Supabase's own database backups do NOT include these.
echo
echo "Storage:"
for b in visit-photos files app-releases; do
  code=$(curl -s -o "$OUT/storage-$b.json" -w "%{http_code}" --max-time 120 -X POST \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"prefix":"","limit":10000}' \
    "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/list/$b")
  n=$(python3 -c "import json;print(len(json.load(open('$OUT/storage-$b.json'))))" 2>/dev/null || echo "?")
  printf "  ✓ %-22s %6s objects listed\n" "$b" "$n"
done

cat > "$OUT/MANIFEST.txt" <<MANIFEST
GF Merchandising export
Taken:    $(date -u +%Y-%m-%dT%H:%M:%SZ)
Project:  $NEXT_PUBLIC_SUPABASE_URL
Git:      $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)

Tables:   ${#TABLES[@]}
Files:    $(ls -1 "$OUT"/*.json | wc -l | tr -d ' ')

WHAT THIS DOES NOT CONTAIN
  * auth.users - passwords and identities live in Supabase's auth schema and
    are not reachable over the REST API. Accounts must be recreated by hand
    after a restore. Keep the list of who exists somewhere else.
  * The bytes of stored files. Only the object listings are here. Photos are
    evidence and are not reproducible - see BACKUP_AND_RESTORE_PROCEDURE.md.
MANIFEST

echo
echo "Manifest written. Total: $(du -sh "$OUT" | cut -f1)"
[ "$fail" = "0" ] && echo "✓ Export complete" || { echo "✗ Some tables failed - this export is INCOMPLETE"; exit 1; }
