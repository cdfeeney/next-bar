------------------------------------------------------------------------------
-- 0070_ratings_server_ownership.sql — the server, not the client, decides
--                                     which rating write wins
------------------------------------------------------------------------------
-- V8 contract 3.1.0, V8-R-RNK-001: "Scores are server-owned and the conflict
-- rule is last server-committed write", trust boundary "server-owned; the
-- client is not the authority". Additive and idempotent. Numbered 0070, above
-- the highest file on this branch (0064) and assigned to this lane by the run.
--
-- WHAT IS ALREADY TRUE, and is deliberately NOT re-stated here:
--   * RLS is on and owner-scoped (0001:76-119) — a user reads and writes only
--     their own rows.
--   * `unique (user_id, bar_id)` (0001:41) — one score per bar per account, so
--     "a bar carries the same number everywhere" holds by construction.
--   * `score numeric(3,1)` (0001:39) — the column itself is what makes a score
--     ONE DECIMAL; no separate check is needed for that half of RNK-001.
--   * `ratings_score_range` (0061) — 1.0-10.0.
--   * `ratings_lww` BEFORE UPDATE (0005:40-43) — the last-write-wins ordering.
--
-- THE HOLE THIS CLOSES. `ratings_lww_guard()` orders writes by a CLIENT-SUPPLIED
-- `updated_at` and skips anything not strictly newer. That is the right rule for
-- an offline write replayed late, and this migration keeps it. But nothing bounds
-- the stamp from ABOVE: a client whose clock is wrong — or which simply says so —
-- can commit `updated_at` far in the future and then win every subsequent race
-- forever. Every later edit, from that device or any other, is skipped by the
-- trigger, and a skipping BEFORE trigger raises no error: PostgREST returns
-- success and `upsertServerRating` (src/lib/ratings.server.ts:122) reads
-- `error === null` as an acknowledgement. The row is frozen and every client
-- reports the save as having worked.
--
-- That is precisely "the client is the authority", so it is the one thing worth
-- fixing to make RNK-001's trust boundary true. It is ALSO what makes RNK-006's
-- failure clause ("the failed row reverts to its prior value until retried")
-- reachable at all: a client cannot revert on a failure the server never reports.
--
-- WHAT IT DELIBERATELY DOES NOT DO. It does not move ordering to server time.
-- Stamping every write with now() would make an offline write replayed later
-- beat the newer edit it should lose to, and 0061's header records the same
-- hazard from the other direction. PAST stamps keep behaving exactly as they do
-- today; only a stamp that claims the FUTURE is corrected.
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. No write may claim a time the server has not reached
------------------------------------------------------------------------------
-- Clamp, not reject. A rejection would turn a mildly skewed phone clock into a
-- user-visible save failure, and the honest reading of a future stamp is "as
-- new as possible", which is what now() means. Skew in the PAST is left alone:
-- that is the offline-replay case the LWW rule exists to order.
--
-- INSERT is covered as well as UPDATE. `ratings_lww` is UPDATE-only, so a
-- future stamp that arrives on the very first insert for a bar is stored
-- verbatim and freezes the row before any update is ever attempted — the same
-- defect one step earlier.

create or replace function public.ratings_clamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- `updated_at` is NOT NULL (0005:19-20), so a null here can only come from a
  -- caller that omitted it on insert and let the column default fill in; the
  -- coalesce keeps this function total either way.
  if new.updated_at is null or new.updated_at > now() then
    new.updated_at := now();
  end if;

  -- `rated_at` is the value the product SHOWS ("rated 3 days ago") and the key
  -- `mergeFreshest` (src/hooks/useRatings.ts:41-53) picks a winner by on the
  -- hydrate path. A future stamp there wins that merge forever and pins a
  -- stale local row over the server's, so it is bounded the same way.
  if new.rated_at is null or new.rated_at > now() then
    new.rated_at := now();
  end if;

  return new;
end;
$$;

-- Trigger NAME matters, not just its timing. Postgres fires same-timing
-- triggers in NAME order, and this one has to run BEFORE `ratings_lww` or the
-- guard compares the unclamped future stamp and skips the row anyway.
-- 'ratings_clamp_updated_at' < 'ratings_lww'; keep it that way if either is
-- ever renamed.
drop trigger if exists ratings_clamp_updated_at on public.ratings;
create trigger ratings_clamp_updated_at
  before insert or update on public.ratings
  for each row execute procedure public.ratings_clamp_updated_at();

------------------------------------------------------------------------------
-- 2. Repair rows a pre-clamp client already froze
------------------------------------------------------------------------------
-- Idempotent by construction: after this runs, no row is in the future, so a
-- re-run matches nothing. It cannot be done by the trigger, which only sees
-- rows as they are written.
--
-- The UPDATE below is itself subject to `ratings_lww`, whose guard skips any
-- row where `new.updated_at <= old.updated_at` — which is exactly what pulling
-- a stamp BACKWARDS does. So the guard is disabled for the length of this one
-- statement rather than worked around, and re-enabled unconditionally.
-- `alter table ... disable trigger` takes an ACCESS EXCLUSIVE lock; see the
-- promotion note below before running this on a hot production table.

alter table public.ratings disable trigger ratings_lww;

update public.ratings
   set updated_at = least(updated_at, now()),
       rated_at   = least(rated_at, now())
 where updated_at > now()
    or rated_at > now();

alter table public.ratings enable trigger ratings_lww;

------------------------------------------------------------------------------
-- 3. Prove it landed
------------------------------------------------------------------------------
-- 0061 records this project's own false-green: a backfill silently skipped by
-- the LWW trigger while the tool printed "ok". The repair above is skipped by
-- that same trigger if step 2's disable/enable is ever edited out, so it gets
-- the same assertion rather than the same trust.

do $$
declare
  future_rows bigint;
begin
  select count(*) into future_rows
    from public.ratings
   where updated_at > now() or rated_at > now();

  if future_rows > 0 then
    raise exception
      'ratings server-ownership repair did not land: % row(s) still carry a '
      'timestamp in the future. Check that the ratings_lww trigger was actually '
      'disabled for the UPDATE in step 2 — it skips any row whose updated_at '
      'moves backwards, and it does so without raising.',
      future_rows;
  end if;
end
$$;

------------------------------------------------------------------------------
-- PROMOTION NOTES — read before running this against production
------------------------------------------------------------------------------
-- 1. NOT APPLIED BY THIS LANE. This repository's `db:migrate` is ledger-blind
--    (CLAUDE.md); a migration file is not applied anywhere until the target
--    project's `public.schema_migrations` says so. Apply with the ledger-aware
--    runner, and read the ledger head before deciding anything.
-- 2. LOCK. Step 2's `disable trigger` / `enable trigger` pair takes an ACCESS
--    EXCLUSIVE lock on `ratings`, and the runner holds one transaction for the
--    whole set, so it is held until commit. On staging's ~18 rows that is
--    nothing. If production's ratings table is large or hot, run step 2 in its
--    own short transaction during a quiet window.
-- 3. CLOCK SOURCE. `now()` is the transaction timestamp in the DATABASE's zone
--    and is what every comparison here uses, deliberately: the whole point is
--    that the server's clock, not the client's, bounds the ordering.
------------------------------------------------------------------------------
