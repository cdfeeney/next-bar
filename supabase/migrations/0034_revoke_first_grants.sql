-- Next Bar — 0034 revoke-first grants on the core user tables (C3 audit F3)
--                + reachable public-shared-list opt-in (C3 audit F5)
--
-- Two findings from docs/C3-RLS-AUDIT-2026-07-30.md, in one file because
-- they touch the same GRANT surface on public.profiles and would otherwise
-- fight over it.
--
-- F3 — `0019:80` states the house rule: "the house pattern is per-object
-- revoke-first". Twelve migration files follow it; the four core user tables
-- did not. `ratings` revoked only from `anon` (0015:96),
-- `pairwise_comparisons` revoked nothing at all, and `profiles` revoked only
-- UPDATE (0006:82) — everything else leaned on Supabase's default
-- `grant all on all tables in schema public to anon, authenticated`.
-- (`vibe_profiles` is the fourth; it is fixed in 0033 itself, which has
-- never been applied.)
--
-- NOTHING HERE CHANGES WHO CAN READ WHAT TODAY. RLS is enabled on all four
-- and every policy is owner-scoped, so `anon` — which has no auth.uid() —
-- already matches no row. This is defence in depth: a revoke-first table
-- still has to pass a grant check if RLS is ever accidentally disabled on
-- it, and a defaults-reliant table does not. That is the whole value, and
-- overstating it would be dishonest.
--
-- The grants below are deliberately narrower than "all": each table gets
-- exactly the verbs its POLICIES already allow, so the two layers agree.
-- Where they disagreed, the policy set is authoritative — see
-- pairwise_comparisons, which is immutable by design.
--
-- `service_role` is untouched throughout (we revoke only from public / anon /
-- authenticated), so the account-deletion path and every SECURITY DEFINER
-- function keep working exactly as before.
--
-- Idempotent: revoke + grant are both re-runnable and this file holds no
-- DDL. Safe to re-run.

------------------------------------------------------------------------------
-- 1. profiles — revoke-first, and re-open the opt-in column (F5)
------------------------------------------------------------------------------
-- `revoke all` also drops the COLUMN-level update grant from 0006:83, so the
-- re-grant below must restore it. That is the point of doing both findings
-- in one file: 0006's column list is the thing F5 needs to extend.
revoke all on table public.profiles from public, anon, authenticated;

grant select, insert on table public.profiles to authenticated;

-- F5 — `0015:37` added shares_list_publicly and `0015:74` made
-- get_public_ratings return rows only where it is true, but nothing ever
-- extended 0006's column grant and no RPC sets it. An authenticated owner
-- running `update profiles set shares_list_publicly = true` therefore got a
-- column-permission error: the opt-in was unreachable by the people it is
-- for, and get_public_ratings could only ever be empty.
--
-- Extending the column list (rather than adding a definer RPC) is the
-- smaller change and keeps 0006's design intact — the C3 audit calls that
-- column-scoped grant "F-good", the pattern other update paths should copy.
-- The row is still fenced by the 0001 owner-update policy, so a user can
-- only ever flip their OWN flag.
--
-- `handle` stays absent ON PURPOSE. 0006 removed table-level UPDATE
-- precisely so handles could not be PATCHed around claim_handle's rate cap
-- and no-renames rule; adding it here would silently undo that. Same for
-- `id`, `created_at`, `updated_at` (trigger-owned) and the GENERATED
-- `handle_normalized`, which is never directly writable.
grant update (display_name, is_private, shares_list_publicly)
  on table public.profiles to authenticated;

-- No DELETE: account deletion runs service-role through
-- src/app/api/account/delete/route.ts and cascades from auth.users. There is
-- no owner-delete policy on profiles either, so the two layers now agree.

------------------------------------------------------------------------------
-- 2. ratings
------------------------------------------------------------------------------
-- 0015:96 already revoked from `anon` when the public-share feature landed.
-- This widens that to the full revoke-first form and states the authenticated
-- grant explicitly instead of inheriting it.
revoke all on table public.ratings from public, anon, authenticated;

-- All four verbs are genuinely used by src/lib/ratings.server.ts:
-- select (load), upsert (= insert + update), update (pairwise scores),
-- delete (clear one rating, and "clear all ratings" in Settings).
grant select, insert, update, delete on table public.ratings to authenticated;

-- Anonymous read of rating TIERS stays available only through
-- get_public_ratings(), which is SECURITY DEFINER and gates on the owner's
-- opt-in. Granting anon anything direct here would bypass that gate.

------------------------------------------------------------------------------
-- 3. pairwise_comparisons
------------------------------------------------------------------------------
revoke all on table public.pairwise_comparisons from public, anon, authenticated;

-- select, insert, delete — and deliberately NO update. 0002:55 records the
-- rule: "comparisons are immutable. Users redo a judgment by ...", and the
-- table has no UPDATE policy. Until now the default grant handed
-- `authenticated` an UPDATE privilege that only RLS was refusing; now the
-- grant layer refuses it too. src/lib/pairwise.server.ts uses exactly these
-- three verbs.
grant select, insert, delete on table public.pairwise_comparisons to authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   grant all on table public.profiles             to anon, authenticated;
--   grant all on table public.ratings              to anon, authenticated;
--   grant all on table public.pairwise_comparisons to anon, authenticated;
--   revoke all on table public.ratings from anon;  -- restore 0015:96
--   revoke update on table public.profiles from public, anon, authenticated;
--   grant update (display_name, is_private) on table public.profiles
--     to authenticated;                            -- restore 0006:82-83
------------------------------------------------------------------------------
