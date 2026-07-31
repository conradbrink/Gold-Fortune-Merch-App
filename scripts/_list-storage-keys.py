"""Print every object key in a Supabase Storage bucket, one per line.

`/storage/v1/object/list` is not recursive — it returns folder placeholders at
each level — so this walks them. Used by backup-export.sh.
"""
import json, sys, urllib.request

url, key, bucket = sys.argv[1], sys.argv[2], sys.argv[3]


def ls(prefix):
    req = urllib.request.Request(
        f"{url}/storage/v1/object/list/{bucket}",
        data=json.dumps({"prefix": prefix, "limit": 10000}).encode(),
        headers={
            "apikey": key,
            "Content-Type": "application/json",
        },
    )
    return json.load(urllib.request.urlopen(req, timeout=120))


def walk(prefix=""):
    for obj in ls(prefix):
        name = obj.get("name")
        if not name:
            continue
        full = f"{prefix}{name}"
        # A folder placeholder carries no id; a real object does.
        if obj.get("id") is None:
            walk(full + "/")
        else:
            print(full)


walk()
