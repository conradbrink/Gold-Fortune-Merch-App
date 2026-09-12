-- RECOVERED as a deliberate no-op. The original text is gone.
--
-- The database records this version as applied on 24 August 2026, and its name
-- says it concerned areas, goals and actions. The text was never committed and cannot be
-- reconstructed: introspection shows the *end state* of the `ops` schema, not
-- which of the three 24 August migrations produced which part of it.
--
-- Rather than invent an attribution — which would risk a replay that creates a
-- table before the one it references — the whole schema is reproduced in the
-- first of the three, `20260824163447_create_ops_schema`, which was proved
-- against production by replaying it into a throwaway schema and diffing every
-- column, constraint, index and policy: zero differences.
--
-- This file exists so that the repo and `supabase_migrations.schema_migrations`
-- list the same versions, which is the property `supabase/README.md` asks for
-- and the thing that was broken. Replaying it does nothing, and that is
-- correct: the state it once produced is already in place by this point.

select 1 where false;
