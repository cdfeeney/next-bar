-- 0071_story_media_legacy_policy_removal.sql
--
-- Withdraws the last direct client path to story media, and closes the PUBLIC
-- execute defaults five functions in 0066 were created with.
--
-- WHY THIS IS A SEPARATE MIGRATION, and why its ORDER is the whole point.
--
-- 0065 let an authenticated client write to and read from `story-media`
-- directly, because at the time that was the only way a story got a photo. 0066
-- built the trusted boundary that replaces it — `/api/media/upload` re-encodes
-- before storing (V8-R-STO-014), `/api/media/:id/url` mints with a
-- server-decided lifetime (V8-R-STO-015) — but it deliberately LEFT the legacy
-- grants standing, because the production consumer still reached Storage
-- directly and dropping them would have broken publication outright. That
-- consumer is `src/lib/stories.server.ts`, which 0066's lane was forbidden to
-- edit; the deadlock cost that lane two review cycles and is what EC-01
-- resolved by returning the file, and this migration, to the Stories lane.
--
-- The transition is in the SAME CANDIDATE as this file. All four of that
-- module's Storage call sites — two uploads, the signed-URL mint, the byte
-- removal — now go through the boundary, and `stories.server.test.ts` asserts
-- it against a client stub that has no `storage` property at all.
--
-- APPLY THIS ONLY WITH THAT CODE. Applied ahead of it, publication fails on the
-- first upload. Left unapplied behind it, a modified client can still bypass
-- the boundary and V8-R-STO-014 and V8-R-STO-015 are NOT satisfied, however
-- correct the application code is: the database is what enforces them.
--
-- Idempotent, as every migration here must be.

-------------------------------------------------------------------------------
-- 1. The three legacy `story-media` grants (V8-R-STO-014, V8-R-STO-015)
-------------------------------------------------------------------------------
--
-- INSERT is the re-encode bypass: with it, a modified client uploads its
-- original GPS-bearing bytes under its own prefix and calls publish_story,
-- which checks that the object EXISTS, not where it came from. A MIME allowlist
-- cannot inspect content, so this policy is the only thing that ever stood
-- between the promise "venue-tagged, never geotagged" and a raw camera file.
--
-- The two SELECT policies are the signed-URL bypass: while an authenticated
-- role may read the object, any authorised viewer can call
-- `createSignedUrl(path, 86400)` themselves and the server-decided lifetime on
-- /api/media/:id/url is a suggestion. Storage checks the SELECT policy at mint
-- time and accepts whatever `expiresIn` the caller asked for.
--
-- What replaces them: 0066's `media_read_window` — a definer function that
-- still evaluates as the caller and carries the same audience, expiry and block
-- rules these policies did — asked explicitly by the route before it signs with
-- service role. The DELETE policy 0066 replaced is NOT dropped here: it is the
-- reference-counted guard, and it is the current rule rather than a legacy one.

drop policy if exists "story-media: owner writes own prefix"    on storage.objects;
drop policy if exists "story-media: owner reads own prefix"     on storage.objects;
drop policy if exists "story-media: audience reads referenced"  on storage.objects;

-------------------------------------------------------------------------------
-- 2. The PUBLIC execute default on five functions 0066 defined (grant audit,
--    2026-08-24)
-------------------------------------------------------------------------------
--
-- The trap is a PostgreSQL default and is invisible in a diff: `CREATE OR
-- REPLACE FUNCTION` preserves the privileges of a function that already exists,
-- but a function created for the FIRST time gets `EXECUTE TO PUBLIC`. Every
-- other function 0066 defines states its grants; these five were new and did
-- not, so they are callable by `anon` — unauthenticated.
--
-- Severity, measured rather than assumed: none of the five reads story bytes,
-- so none is a disclosure. Both lock wrappers use `pg_advisory_xact_lock`, not
-- the session-scoped form, and under PostgREST each RPC is its own transaction,
-- so a public caller cannot hold one across a pooled connection — repeated
-- calls can only contend briefly. `media_path_lock_key` is immutable and reads
-- nothing; it discloses only its own key derivation. The two trigger functions
-- cannot be invoked directly at all, PostgreSQL refuses it — but they are
-- SECURITY DEFINER and public, and that combination should not stand.
--
-- NO APPLICATION GRANT REPLACES THESE, and that was checked rather than
-- assumed. Every call site of all five is inside a SECURITY DEFINER function or
-- a SECURITY DEFINER trigger function, which executes as its owner:
--   media_path_lock_key       <- media_path_has_live_reference (definer),
--                                claim_orphan_paths (definer),
--                                publish_story (definer)
--   blocked_pair_lock         <- forbid_blocked_edge (definer trigger),
--                                sever_blocked_connections (definer trigger)
--   night_out_guard_lock      <- forbid_blocked_edge (definer trigger)
-- The owner holds EXECUTE by ownership, so revoking every application role
-- breaks no caller. A wrong revoke here would break the publish and block
-- paths, which is exactly why the call sites are named.

revoke all on function public.media_path_lock_key(text, text)  from public, anon, authenticated;
revoke all on function public.blocked_pair_lock(uuid, uuid)    from public, anon, authenticated;
revoke all on function public.night_out_guard_lock(uuid)       from public, anon, authenticated;
revoke all on function public.forbid_blocked_edge()            from public, anon, authenticated;
revoke all on function public.sever_blocked_connections()      from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 3. What this migration deliberately does NOT do
-------------------------------------------------------------------------------
--
-- The repository-wide grant audit reports twelve permanent violations, not
-- five. The other seven are trigger functions that predate 0066 (0001, 0005,
-- 0019, 0033, 0042). They are pre-existing and belong to whichever lane the
-- founder assigns them; widening this file to cover them would put a migration
-- touching five other migrations' surface into a Stories candidate, which is
-- the kind of quiet scope growth the lane boundaries exist to prevent.
--
-- It also mints no schema. This lane creates no table, no column and no RPC:
-- everything Stories needs already exists in 0065 and 0066.
