-- 0084 — service_role grants on the media registry (T-01a, owner phone look 2026-09-17).
--
-- WHY: `POST /api/media/upload` registers every stored object in
-- public.media_objects THROUGH THE SERVICE ROLE (src/app/api/media/upload/route.ts;
-- the signed-url route reads the same table the same way). On STAGING every
-- upload answered 500 `server_error` and the runtime log said
--   [media/upload] registry insert failed: permission denied for table media_objects
-- because staging's `pg_default_acl` for schema public is EMPTY: Supabase's
-- stock `alter default privileges ... grant all on tables to anon,
-- authenticated, service_role` is not there, so every table a migration
-- created on staging arrived with no service_role grant at all (service_role
-- held grants only on analytics_events, bars, bars_v01_legacy). Production
-- still has the default ACL and service_role already holds ALL on this table,
-- so this file is a no-op there — the grant is made explicit rather than
-- inherited, which is what the revoke-first migrations (0034, 0069) do for
-- `authenticated` anyway.
--
-- SCOPE: the one public table the service-role client writes, PLUS the three
-- sweep functions it calls (src/lib/media/destinations.ts, reclaim.ts). 0066
-- revoked EXECUTE from public on those and granted only authenticated
-- (release_media_claim: nobody — "SERVICE ROLE ONLY" via the default ACL), so
-- the same empty default ACL leaves service_role without EXECUTE on staging
-- (verified 2026-09-19: has_function_privilege false for all three; true on
-- prod) and the daily /api/media/reclaim cron answers sweep_incomplete there.
-- The storage bucket and auth admin calls need no grant. Nothing is revoked.
-- Idempotent; safe to re-run. Applied to STAGING on the owner's word;
-- production as its own authorised step (no-op).

grant select, insert, update, delete on table public.media_objects to service_role;
grant execute on function public.claim_media_for_removal(uuid, integer) to service_role;
grant execute on function public.claim_orphan_paths(integer) to service_role;
grant execute on function public.release_media_claim(uuid, timestamptz) to service_role;
