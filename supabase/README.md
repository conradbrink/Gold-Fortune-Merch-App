# Database schema

Until now the schema existed **only** inside the hosted Supabase project
(`bvbgtsxasttjzlemumwy`) — every migration had been applied through the MCP
server with nothing recorded in the repo. If that project were deleted or the
account lost, the schema would have gone with it.

`migrations/` now holds every applied migration, reconstructed verbatim from
`supabase_migrations.schema_migrations` (the table Supabase writes when a
migration is applied). Filenames and ordering match the remote history exactly,
so this directory is a faithful, replayable record.

## ⚠️ The filename prefix is not decorative — it must equal the recorded version

Applying a migration through the Supabase MCP server stamps it with **its own**
timestamp, which is *not* the one you choose for the file. Writing the `.sql`
with a hand-picked timestamp therefore produces a file the database has no
record of, while the database holds a version with no matching file.

This drifted silently: on 30 July 2026, **32 of 71 files** carried versions the
database had never recorded. Nothing broke in production — every migration had
been applied — but the consequences would have surfaced at the worst moment:

- a staging project replayed from this directory would **not** reproduce
  production, so "we tested it in staging" would have been false;
- `supabase db push` would have tried to re-apply 32 already-applied migrations;
- rolling a schema change back by migration history was not trustworthy.

Corrected by renaming the files to the versions the database recorded — the
database was not touched. Names matched 1:1 and the ordering was already
identical, so the rename was purely cosmetic in git and made the two agree.

**The rule:** after `apply_migration`, read the version back with
`list_migrations` (or `select version, name from
supabase_migrations.schema_migrations order by version desc limit 1`) and name
the file with *that* value. Never invent the timestamp.

**To check for drift at any time**, compare the two lists — every name should
appear once on each side with the same prefix.

## Layout

The table below covers the first 17; later migrations are named for what they
do (`…211052_add_call_cycle`, `…211122_create_generate_routes_rpc`, and so on).

| migration | what it does |
|---|---|
| `…144345_init_orgs_users` | `organizations`, `profiles`, and the `current_org_id()` / `current_role()` / `set_updated_at()` helpers |
| `…144357_stores` | `stores` |
| `…144416_routes_visits` | `routes`, `visits` |
| `…144433_forms_photos` | `form_templates`, `form_fields`, `photos`, `form_submissions`, `form_responses` |
| `…144458_rls_policies` | enables RLS and creates the first pass of policies |
| `…144511_storage_buckets` | private `visit-photos` bucket + its storage policies |
| `…144612_harden_functions` | pins `search_path`; revokes helper EXECUTE from `anon` |
| `…145151_optimize_rls_policies` | rewrites every policy wrapping auth calls in `(select …)` |
| `…152920_routes_scheduled_time_window` | `routes.scheduled_start_at` / `_end_at` |
| `…155028_organizations_details` | company-profile columns |
| `…163602_store_groups` | `store_groups` + `stores.store_group_id` |
| `…173953_workday_sessions_and_location_pings` | time & mileage tables |
| `…093100_create_store_assignments` | `store_assignments`; `visits(org_id, checkin_at)` index |
| `…095454_add_form_field_metric_key` | `form_fields.metric_key` for stable compliance metrics |
| `…100648_create_dashboard_summary_rpc` | `dashboard_summary()` |
| `…121757_create_activity_feed_rpc` | `activity_feed()`, `activity_feed_summary()` |
| `…141220_fix_dashboard_coverage_denominator` | corrects the coverage numerator (was reporting 114%) |

## Applying these

The Supabase CLI is **not installed** on this machine (nor is `pg_dump`). To use
this directory:

```bash
npm i -g supabase
supabase link --project-ref bvbgtsxasttjzlemumwy
supabase migration list          # compare local vs remote
```

Against a *fresh* project, `supabase db push` replays them in order. Against
the existing project they are already applied — do not re-run them.

## Rules for new migrations

Three of these are not stylistic; getting them wrong causes silent data leaks or
silently wrong numbers.

1. **`security invoker` on every RPC, `security_invoker = true` on every view.**
   Views default to *definer* rights and bypass RLS entirely, which would leak
   across organisations.
2. **Write `public."current_role"()` with the quotes.** It shadows Postgres's
   reserved `current_role`; unquoted you silently get the database role name
   instead of the profile role.
3. **Materialise `current_org_id()` into a CTE** and filter `where org_id =
   <that>` explicitly, so the planner sees a literal and can use
   `visits_org_checkin_at_idx`. Verify with `explain analyze`.

## Demo / seed data

The database contains ~90 days of generated demo activity (346 visits, 266 form
submissions, 3,351 responses, 569 photos, 291 workday sessions). It is **not** in
this directory, because it is demo content rather than schema.

Every seeded row is tagged by a `client_generated_id` prefix, so it can be
removed cleanly:

```sql
delete from visits           where client_generated_id::text like '5eed0001-%';
delete from workday_sessions where client_generated_id::text like '5eed0005-%';
delete from photos           where client_generated_id::text like '5eed0003-%'
                                or client_generated_id::text like '5eed0004-%';
delete from routes
  where org_id = '71170c8a-d53c-4a07-bdd4-97704a3cf4bc'
    and (scheduled_date < date '2026-07-26' or scheduled_date > date '2026-07-27');
-- form_submissions and form_responses cascade from visits.
```

Two things to know about it: seeded photos deliberately reuse the five real
`storage_path` values so signed URLs resolve to objects that actually exist (the
same few images therefore repeat), and ~5% of seeded check-ins were deliberately
placed 0.8–4 km off site so the Activities page has genuine location
discrepancies to surface.
