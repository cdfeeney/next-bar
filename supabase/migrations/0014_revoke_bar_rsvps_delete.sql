-- Next Bar — 0014 revoke bar_rsvps table DELETE (closes the 0013 window)
--
-- Committed follow-up demanded by the 0013 review (HIGH): 0012 granted
-- own-row table DELETE so clients could do "I'm out" directly; 0013
-- moved that write into the advisory-lock-serialized unrsvp_bar RPC
-- but RETAINED the grant so already-loaded clients kept working
-- through the deploy window.
--
-- APPLY GATE (attended): only after the 0013 lib-swap deploy is
-- smoke-verified in prod (post-merge /api/health sha match + the RSVP
-- toggle exercised). Once applied, rsvp_bar/unrsvp_bar are the ONLY
-- write paths to bar_rsvps and every write serializes under the
-- per-user advisory lock — the race is closed at the DB layer, not by
-- client convention.
--
-- Idempotent: safe to re-run (revoke of an absent grant is a no-op).

revoke delete on table public.bar_rsvps from authenticated;
drop policy if exists bar_rsvps_delete_own on public.bar_rsvps;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   grant delete on table public.bar_rsvps to authenticated;
--   create policy bar_rsvps_delete_own on public.bar_rsvps
--     for delete to authenticated
--     using (user_id = auth.uid());
------------------------------------------------------------------------------
