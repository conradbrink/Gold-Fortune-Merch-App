-- ──────────────────────────────────────────────────────────────────────────
-- Where did it get to?
-- ──────────────────────────────────────────────────────────────────────────
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
