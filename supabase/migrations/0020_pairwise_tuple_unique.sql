-- 0020: make the pairwise transcript import database-idempotent (V8-2 round-4
-- panel, Codex): two tabs signing in concurrently both fetch the server
-- transcript, both see the same local rows as missing, and both insert them —
-- duplicate tuples in an append-only table skew rank-order replay. The client
-- dedupes best-effort, but only a unique constraint closes the race.
--
-- Additive and idempotent (V8-2 criterion 7). NULL session_id rows are fine:
-- the tuple below excludes session_id on purpose — identical
-- (user, winner, loser, compared_at) IS the duplicate, whichever session
-- wrote it. Intentional re-answers always carry fresh timestamps, so they are
-- never blocked.
--
-- After this is applied (attended, via npm run db:migrate), a concurrent
-- duplicate import fails its batch insert; the losing tab's merge returns
-- null, does not latch, and the next sign-in dedupes against the now-complete
-- server transcript and converges with nothing left to insert.
CREATE UNIQUE INDEX IF NOT EXISTS pairwise_comparisons_tuple_uniq
  ON pairwise_comparisons (user_id, winner_bar_id, loser_bar_id, compared_at);
