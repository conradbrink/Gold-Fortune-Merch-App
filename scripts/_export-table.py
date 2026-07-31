"""Export one table to JSON, paging until every row is fetched.

Why this is not a single request: PostgREST caps how many rows it will return
(Supabase defaults to 1000) and answers a larger request by silently returning
the first page. A backup that quietly stops at 1000 rows is worse than no
backup, because it produces the confidence without the safety — and it would
not have shown up yet, with 209 stores, but `routes` was 789 before the July
2026 incident and `location_pings` grows every 20 minutes per rep per day.

The row count is taken from the Content-Range header PostgREST returns
(`0-208/209`) and compared against what was actually written. A mismatch is an
error, not a warning: it is exactly the silent-truncation case this exists to
catch.

Usage:  _export-table.py <url> <key> <table> <outfile>
Prints the row count on success; exits non-zero on any problem.
"""
import json
import sys
import urllib.error
import urllib.request

PAGE = 1000

url, key, table, outfile = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]


def fetch(offset: int):
    req = urllib.request.Request(
        f"{url}/rest/v1/{table}?select=*",
        headers={
            "apikey": key,
            "Prefer": "count=exact",
            "Range-Unit": "items",
            "Range": f"{offset}-{offset + PAGE - 1}",
        },
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        rows = json.load(resp)
        # e.g. "0-208/209"; the total may be "*" if PostgREST declines to count.
        content_range = resp.headers.get("Content-Range", "")
        total = None
        if "/" in content_range:
            tail = content_range.split("/")[-1]
            if tail.isdigit():
                total = int(tail)
        return rows, total


try:
    all_rows, total = fetch(0)
    while total is not None and len(all_rows) < total:
        page, _ = fetch(len(all_rows))
        if not page:
            break  # No progress: stop rather than loop forever.
        all_rows.extend(page)
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}", file=sys.stderr)
    sys.exit(2)
except Exception as e:  # noqa: BLE001 - any failure here must fail the backup
    print(str(e)[:200], file=sys.stderr)
    sys.exit(2)

with open(outfile, "w") as f:
    json.dump(all_rows, f)

if total is not None and len(all_rows) != total:
    print(
        f"TRUNCATED: wrote {len(all_rows)} of {total} rows",
        file=sys.stderr,
    )
    sys.exit(3)

print(len(all_rows))
