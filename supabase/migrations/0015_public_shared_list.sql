-- Next Bar — 0015 public shared list (anon read of an OPTED-IN profile's tiers)
--
-- Why: /share/[barId] should show the SENDER's ranked list to a signed-out
-- recipient (goal acceptance 6). Today there is no anon read surface over
-- ratings at all — get_friend_ratings is friends-only and granted to
-- `authenticated`, and even search_handles is revoked from anon. The client
-- half of the recipient landing shipped without this (the recipient's own
-- vote is localStorage-only and needs no server); the sender's list does not
-- exist without a public read path.
--
-- APPLY GATE (attended, and NOT merely "run the migration"):
--   1. This is the first anon-readable surface over user content in the
--      product. /privacy must be updated in the SAME PR — it currently
--      describes no such surface.
--   2. The settings UI must expose the opt-in before the flag means anything
--      to a user. Shipping the column without the control leaves an invisible
--      privacy setting, which is worse than no setting.
--   3. Authored under LOOP_UNATTENDED=1; NOT applied. `npm run db:migrate` is
--      an attended step and scripts/loop-guard.mjs hard-aborts it anyway.
--
-- SAFETY PROPERTY THAT MADE THIS AUTHORABLE UNATTENDED: applying it exposes
-- NOTHING. The gate is a new per-profile opt-in defaulting to FALSE, not the
-- existing `is_private = false`. Reusing is_private would have turned every
-- non-private profile's rating list anon-readable the instant it applied —
-- a silent widening of what "public profile" has meant, for people who chose
-- that setting when it only governed handle search. Opt-in means the
-- migration is inert until a human flips their own flag.
--
-- Idempotent: add column if not exists + create or replace + drop policy if
-- exists. Safe to re-run.

------------------------------------------------------------------------------
-- 1. The opt-in flag
------------------------------------------------------------------------------

alter table public.profiles
  add column if not exists shares_list_publicly boolean not null default false;

comment on column public.profiles.shares_list_publicly is
  'Owner opt-in: allow ANONYMOUS read of this profile''s rating tiers via '
  'get_public_ratings(). Default false. Never set this on a user''s behalf.';

------------------------------------------------------------------------------
-- 2. get_public_ratings(handle) — tier-only, opted-in-only, anon-readable
------------------------------------------------------------------------------

-- SECURITY DEFINER with a MATERIALIZED fence, exactly as get_friend_ratings
-- (0007) — and for the same reason, which bites harder here because the
-- caller is unauthenticated. PostgreSQL marks uuid/text `=` LEAKPROOF, so
-- without the fence the planner can push a caller-supplied predicate below
-- the opt-in gate, turning this into a timing oracle over profiles that never
-- opted in. `as materialized` forces the gated set to evaluate first.
--
-- HARD RULE, inherited and strengthened: the `score` column must NEVER appear
-- here. Scores stay owner-only. Tier is the only signal that leaves, and this
-- is the widest audience any rating data has ever had.
--
-- LIMIT is a scraping blunt: an anon caller has no auth.uid(), so the
-- per-user daily cap used by search_handles cannot apply. Capping rows keeps
-- a single call from being a bulk export. It is not rate limiting — a
-- determined scraper still walks handles. That is an accepted cost of the
-- feature and belongs in the operator's decision, not hidden in SQL.
create or replace function public.get_public_ratings(handle_query text)
returns table (bar_id text, tier text, rated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with gated as materialized (
    select r.bar_id, r.tier::text, r.rated_at
      from public.ratings r
      join public.profiles p on p.id = r.user_id
     where p.shares_list_publicly = true
       and p.handle_normalized = lower(coalesce(handle_query, ''))
       -- Belt and braces: a private profile is never publicly listable even
       -- if the opt-in got set before is_private was flipped on.
       and p.is_private = false
     order by r.rated_at desc
     limit 50
  )
  select * from gated;
$$;

-- The one function in this schema deliberately granted to anon. Everything
-- else stays revoked; `revoke all` first so a re-run cannot accumulate grants.
revoke all on function public.get_public_ratings(text) from public, anon, authenticated;
grant execute on function public.get_public_ratings(text) to anon, authenticated;

------------------------------------------------------------------------------
-- 3. No new table grants
------------------------------------------------------------------------------

-- Explicitly NOT granting anon any direct select on ratings or profiles. The
-- RPC is the entire surface; a table grant would bypass the opt-in gate.
revoke all on table public.ratings from anon;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   revoke all on function public.get_public_ratings(text) from anon, authenticated;
--   drop function if exists public.get_public_ratings(text);
--   alter table public.profiles drop column if exists shares_list_publicly;
------------------------------------------------------------------------------
