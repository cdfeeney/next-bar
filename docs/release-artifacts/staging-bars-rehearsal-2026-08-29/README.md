# Staging bars rehearsal — 2026-08-29

A rehearsal of phase D's bars load, run against **staging** (`wqxovhiovgcijmfzxgby`). Production was
not connected to.

## Result

| | |
|---|---|
| payload | `curated-payload-a29b7d4.json`, 1255 rows, sha256 `d47819f8a2e2d2…` |
| payload origin | `docs/release-artifacts/v7-manhattan-staging-2026-08-13-v3/curated-payload.json` @ `a29b7d4` |
| bars before | 1256 |
| planned / skipped | **851 / 404** (dedupe by `placeId`) |
| inserted | **851**, one transaction |
| bars after | **2107** |
| ledger head | `0071_story_media_legacy_policy_removal.sql`, 64 rows |

The 851/404 split matches the work order's independent estimate exactly: *"404 of them share a
placeId with prod's 1,256 → 851 new."*

## Why a new tool

`finalize-apply-manhattan-staging.mts` (the v7 script that produced this payload) cannot be reused
for phase D. It hard-asserts a 412-row starting state (line 18 `BASELINE = 412`, enforced at line
61), has no dry-run/apply split — the dry run at line 91 and the insert at line 185+ are one pass —
and its `EXPECTED_INSERTS = 1255` arithmetic describes the v7 staging database rather than any
target phase D has. `scripts/db-load-bars.mts` derives its plan from what the target holds right
now, and asserts no baseline.

## Not done here

`scripts/backfill-venue-tags.mts` was NOT run. It writes through the REST API and requires
`SUPABASE_SERVICE_ROLE_KEY`; `.env.staging.local` carries only the anon key, and the only
service-role key on this machine belongs to PRODUCTION. Copying that into a staging worktree is
forbidden, so the backfill needs a staging service-role key before it can be rehearsed.

## The phase D script

The exact commands are recorded in `D:\harness-handoffs\FACTS.md`. Substituting the production
secrets file for the staging one is the whole difference, and phase D additionally requires R5-3
(the URL-borne `sslrootcert` re-read) to be fixed first.
