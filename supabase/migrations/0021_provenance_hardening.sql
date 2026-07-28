-- Next Bar — 0021 provenance hardening (review findings on 0020)
--
-- Two defects found in independent review of 0020, both cheap to close:
--
--  1. pending_change_count(p_user) is SECURITY DEFINER, executable by any
--     authenticated user, and took an ARBITRARY user id — so any signed-in
--     user could ask how many pending corrections any other user had. Low
--     severity (a count keyed by a uuid), but a definer function that reads
--     another user's rows on request is exactly the shape that becomes a
--     real leak the moment someone adds a column to it. The caller is
--     always auth.uid() anyway, so the parameter was pure attack surface.
--
--  2. The "don't trust Google hours" rule lived in ONE place in the
--     application (hasTrustworthyHours). Any future direct write could set
--     hours_source='google' with hours_confidence='verified' and silently
--     pass the gate. Encode the invariant in the schema instead, where it
--     cannot be forgotten.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. pending_change_count: derive the user internally, no parameter
------------------------------------------------------------------------------

drop policy if exists bar_change_queue_insert_own on public.bar_change_queue;
drop function if exists public.pending_change_count(uuid);

create or replace function public.pending_change_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.bar_change_queue q
   where q.submitted_by = auth.uid()
     and q.status = 'pending';
$$;

revoke all on function public.pending_change_count() from public, anon, authenticated;
grant execute on function public.pending_change_count() to authenticated;

create policy bar_change_queue_insert_own on public.bar_change_queue
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and status = 'pending'
    -- Soft cap. Deliberately not a hard guarantee: two concurrent inserts
    -- can both observe 19 and both land. That is acceptable for a
    -- moderation queue — the cap exists to stop one account flooding it,
    -- not to enforce an exact ceiling.
    and public.pending_change_count() < 20
  );

------------------------------------------------------------------------------
-- 2. Google hours can never be marked verified
------------------------------------------------------------------------------
-- Defense in depth for the whole point of 0020: we may DISPLAY Google
-- hours live, we may not persist them and treat them as authoritative.
-- 'reported' is likewise wrong for Google — nobody reported it to us.

-- Drop-then-add rather than an `if not exists` guard. An earlier version of
-- this file created a WEAKER predicate, and a guard would leave that weaker
-- constraint in place forever on any database where it already ran. Dropping
-- first makes the file self-healing as well as idempotent.
alter table public.bars
  drop constraint if exists bars_google_hours_never_trusted;

alter table public.bars add constraint bars_google_hours_never_trusted
  check (
    -- No trust is being claimed: always allowed.
    hours_confidence is null
    or hours_confidence = 'unverified'
    -- Claiming 'reported' or 'verified' REQUIRES a known, non-Google source.
    --
    -- The previous predicate was
    --   hours_source is distinct from 'google'
    --     or hours_confidence is not distinct from 'unverified'
    -- which only fired when hours_source was exactly 'google'. A row with
    -- hours_source IS NULL and hours_confidence = 'verified' therefore PASSED,
    -- because NULL is distinct from 'google' evaluates true. That mattered
    -- because catalogServer.ts maps an absent hours_source to 'google' on read,
    -- so such a row came back as Google-derived hours the app would trust --
    -- precisely the invariant this constraint exists to make unforgettable.
    or (hours_source is not null and hours_source <> 'google')
  );

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   alter table public.bars drop constraint if exists bars_google_hours_never_trusted;
--   drop policy if exists bar_change_queue_insert_own on public.bar_change_queue;
--   drop function if exists public.pending_change_count();
--   -- then re-create the 0020 parameterized function + policy if needed.
------------------------------------------------------------------------------
