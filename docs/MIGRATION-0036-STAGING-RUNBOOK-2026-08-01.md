# Migration 0036 — attended staging runbook

Use only after the T0 review converges. The current `next-bar-staging` database
already passed the clean `0000`–`0035` bootstrap; do not delete or reset it.

## 1. Confirm the target

- Supabase project name: `next-bar-staging`, not `next-bar`.
- `.env.local` public URL and database URL identify the same staging reference.
- `NEXT_BAR_PRODUCTION_PROJECT_REF` identifies a different project.
- `LOOP_UNATTENDED` is absent.

## 2. Preflight

```powershell
cd C:\Users\cdfee\projects\nb-overnight
Remove-Item Env:LOOP_UNATTENDED -ErrorAction SilentlyContinue
npm run typecheck
npm test
npm run secret-scan
git diff --check
git diff --exit-code f11d94b -- supabase/migrations/0000_reconcile_v01_schema.sql supabase/migrations/0001_v0.5.0_auth_and_ratings.sql supabase/migrations/0002_v0.5.1_pairwise.sql supabase/migrations/0003_demo_cleanup.sql supabase/migrations/0004_backfill_profiles.sql supabase/migrations/0005_sync_hardening.sql supabase/migrations/0006_usernames.sql supabase/migrations/0007_follows.sql supabase/migrations/0008_follow_requests.sql supabase/migrations/0009_push_subscriptions.sql supabase/migrations/0010_followers.sql supabase/migrations/0011_bar_suggestions.sql supabase/migrations/0012_bar_rsvps.sql supabase/migrations/0013_unrsvp_rpc.sql supabase/migrations/0014_revoke_bar_rsvps_delete.sql supabase/migrations/0015_public_shared_list.sql supabase/migrations/0016_shared_nights.sql supabase/migrations/0017_vibe_votes.sql supabase/migrations/0018_analytics_events.sql supabase/migrations/0019_bars_catalog.sql supabase/migrations/0020_provenance_and_media.sql supabase/migrations/0021_provenance_hardening.sql supabase/migrations/0022_hours_trust_constraint_fix.sql supabase/migrations/0023_purge_google_reviews.sql supabase/migrations/0024_hours_source_osm.sql supabase/migrations/0025_hours_sweep_support.sql supabase/migrations/0026_clear_misresolved_place_ids.sql supabase/migrations/0027_merge_duplicate_venues.sql supabase/migrations/0028_resolve_flemings_and_slaughtered_lamb.sql supabase/migrations/0029_correct_coordinates_from_osm.sql supabase/migrations/0030_resource_coordinates_from_osm.sql supabase/migrations/0031_diamond_dogs_rocka_rolla_osm.sql supabase/migrations/0032_geocode_remaining_from_osm.sql supabase/migrations/0033_vibe_profiles.sql supabase/migrations/0034_revoke_first_grants.sql supabase/migrations/0035_share_night_date_bound.sql
```

Stop on any failure. The final command must print nothing.

## 3. Apply only the pending migration

```powershell
npm run db:migrate
```

Expected: 36 migrations skipped, `0036_protect_schema_migrations.sql` applied,
and one migration reported applied. Do not use bootstrap or baseline flags.

## 4. Verify in the staging SQL Editor

Confirm the top-left project says `next-bar-staging`, then run:

```sql
select count(*) as migration_count, max(name) as last_migration
from public.schema_migrations;

select c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', 'public.schema_migrations', 'select') as anon_select,
       has_table_privilege('authenticated', 'public.schema_migrations', 'select') as authenticated_select,
       has_table_privilege('anon', 'public.schema_migrations', 'insert,update,delete') as anon_write,
       has_table_privilege('authenticated', 'public.schema_migrations', 'insert,update,delete') as authenticated_write
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'schema_migrations';
```

Expected:

- migration count `37`;
- last migration `0036_protect_schema_migrations.sql`;
- `rls_enabled = true`;
- all four browser privilege checks = `false`.

Refresh/rerun Supabase Security Advisor. The `RLS Disabled in Public` finding for
`public.schema_migrations` must disappear before this staging step is complete.

Expect the Advisor to keep showing a lower-severity informational note that the
table has RLS enabled with **no policies**. That is the intended end state here,
not a new defect: this table has no browser-facing role, so a policy would be the
regression. Do not "resolve" that note by adding one.

The SQL probes above read the catalog directly and are accurate immediately; only
the Advisor panel itself may lag behind by a refresh.

## 5. Stop boundary

Do not apply 0036 to Production in this session. Production requires its own
attended release approval after staging evidence is recorded.

