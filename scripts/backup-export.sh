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

# Storage. Supabase's own database backups do NOT include any of this — the
# dashboard says so on the Backups page. Visit photos are evidence that a rep
# stood in a shop, and they cannot be regenerated from anything.
#
# Listings are recorded for every bucket. The *bytes* are downloaded only for
# the buckets that cannot be rebuilt:
#
#   visit-photos  irreplaceable — downloaded
#   files         uploaded documents, irreplaceable — downloaded
#   app-releases  an APK is reproducible from a tagged commit plus the
#                 keystore, and each one is ~40 MB. Listed, not downloaded.
echo
echo "Storage:"
DOWNLOAD_BUCKETS=" visit-photos files "

for b in visit-photos files app-releases; do
  code=$(curl -s -o "$OUT/storage-$b.json" -w "%{http_code}" --max-time 120 -X POST \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"prefix":"","limit":10000}' \
    "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/list/$b")
  if [ "$code" != "200" ]; then
    echo "  ✗ $b — listing failed, HTTP $code"; fail=1; continue
  fi
  n=$(python3 -c "import json;print(len(json.load(open('$OUT/storage-$b.json'))))" 2>/dev/null || echo 0)
  printf "  ✓ %-22s %6s objects listed\n" "$b" "$n"

  case "$DOWNLOAD_BUCKETS" in *" $b "*) ;; *) continue ;; esac
  [ "$n" = "0" ] && continue

  mkdir -p "$OUT/storage/$b"
  got=0; missed=0

  # The key list is produced into a temp file rather than piped straight into
  # the loop. A heredoc nested inside a process substitution is what bash
  # rejects with "ambiguous redirect", and it fails *quietly* — the loop simply
  # never runs and the export reports "0 files downloaded", which reads like an
  # empty bucket rather than a broken backup.
  KEYS="$(mktemp)"
  python3 "$ROOT/scripts/_list-storage-keys.py" \
    "$NEXT_PUBLIC_SUPABASE_URL" "$SUPABASE_SERVICE_ROLE_KEY" "$b" > "$KEYS"

  while IFS= read -r key; do
    [ -z "$key" ] && continue
    dest="$OUT/storage/$b/$key"
    mkdir -p "$(dirname "$dest")"
    dcode=$(curl -s -o "$dest" -w "%{http_code}" --max-time 300 \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/$b/$key")
    if [ "$dcode" = "200" ]; then got=$((got+1)); else rm -f "$dest"; missed=$((missed+1)); fi
  done < "$KEYS"
  rm -f "$KEYS"

  if [ "$missed" -gt 0 ]; then
    echo "    ✗ downloaded $got, FAILED $missed — this export is incomplete"; fail=1
  elif [ "$got" = "0" ]; then
    echo "    ✗ listed $n object(s) but downloaded NONE — the walk is broken"; fail=1
  else
    printf "    ↓ %s file(s) downloaded\n" "$got"
  fi
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
  * The bytes of app-releases. An APK is reproducible from a tagged commit
    plus the signing keystore, and each is ~40 MB. Listed, not downloaded.

WHAT IT DOES CONTAIN
  * Every business table as JSON.
  * The actual FILES from visit-photos and files, under storage/ - these are
    irreplaceable and are NOT in Supabase's own database backups.
MANIFEST

echo
echo "Manifest written. Total: $(du -sh "$OUT" | cut -f1)"
[ "$fail" = "0" ] && echo "✓ Export complete" || { echo "✗ Some tables failed - this export is INCOMPLETE"; exit 1; }
