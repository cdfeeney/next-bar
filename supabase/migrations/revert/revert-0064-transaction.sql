-- Runnable, atomic rollback of migration 0064. This is THE rollback path.
--
-- HOW TO RUN IT: see README.md in this directory, which is the single source
-- for the command and for what the revert costs. It is not restated here — an
-- earlier version of this header claimed the command worked "from anywhere"
-- while passing a working-directory-relative `-f` path, and that stale twin is
-- exactly what the README's one-statement-one-place rule exists to prevent.
--
-- Restoring 0007's tier-only body and unrecording the migration MUST be one
-- transaction. If they come apart, the ledger claims 0064 while the friend read
-- returns no score, and every ledger-aware tool then acts on a false picture.

-- No `\set ON_ERROR_STOP on` here, deliberately. It is a psql CLIENT metacommand:
-- Postgres rejects it as a syntax error the moment this file is sent over the wire
-- by anything other than psql, which made the pg-driver path README.md documents
-- unrunnable as written. The documented psql command already passes
-- `-v ON_ERROR_STOP=1`, and every statement below lives in the one transaction, so
-- any failure aborts the whole thing regardless of client. Keeping this file pure
-- SQL is what lets BOTH clients run it verbatim.

BEGIN READ WRITE;

-- SET LOCAL, inside this transaction, on purpose. A caller cannot set these
-- for us: the transaction is opened HERE, so a SET LOCAL outside it belongs
-- to no transaction and is discarded, and a session-level SET would both
-- LEAK onto the Supabase pooler's pinned backend for whatever session is
-- assigned it next, and not be reliably inherited in transaction mode
-- anyway. Unbounded, a blocked DROP FUNCTION waits on the lock while HOLDING
-- this transaction open; bounded, it aborts and the whole revert rolls back.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '300s';

-- PRECONDITION, checked before anything is touched: refuse unless 0064 is
-- actually the thing being undone, and unless it is the NEWEST migration —
-- reverting it under a later one could clobber that one's definition.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.schema_migrations WHERE name = '0064_friend_ratings_score.sql'
  ) THEN
    RAISE EXCEPTION
      '0064 is not in the ledger, so there is nothing here to revert — wrong target, already reverted, or a ledger that has moved on. Refusing.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.schema_migrations WHERE name > '0064_friend_ratings_score.sql'
  ) THEN
    RAISE EXCEPTION
      'the ledger contains migrations AFTER 0064; reverting it now could clobber a later definition. Revert those first.';
  END IF;
  -- A row NAMED 0064 is not proof this is the database that ran THIS 0064. Any
  -- database whose ledger head happens to carry that name passed the two checks
  -- above, so a mistyped connection string could downgrade an unintended target
  -- and delete its ledger row. The recorded checksum identifies the content, and
  -- is the strongest target check available from inside SQL.
  IF NOT EXISTS (
    SELECT 1 FROM public.schema_migrations
     WHERE name = '0064_friend_ratings_score.sql'
       AND checksum = 'aedad98164668b055bf7f185150cd6b28d66818bd9733f8dcc6c8cc46866b8a4'
  ) THEN
    RAISE EXCEPTION
      'the ledger row for 0064 does not carry this migration''s checksum, so this is either a different database or a different 0064. Refusing.';
  END IF;
  -- And the ledger is a claim, not the installed state. Restoring 0007's body over
  -- a function that is ALREADY tier-only would silently "succeed" while unrecording
  -- a migration whose effect was never there.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      CROSS JOIN LATERAL unnest(p.proargnames, p.proargmodes) AS a(name, mode)
     WHERE p.oid = 'public.get_friend_ratings()'::regprocedure
       AND a.mode IN ('o', 'b', 't')
       AND a.name = 'score'
  ) THEN
    RAISE EXCEPTION
      'the live get_friend_ratings() already returns no score column, so 0064 is not installed here whatever the ledger says. Refusing.';
  END IF;
END
$$;

-- 0007's definition, verbatim: tier only, no score. The signature narrows, so
-- `create or replace` cannot do it — the same reason 0064 drops first.
DROP FUNCTION IF EXISTS public.get_friend_ratings();

CREATE OR REPLACE FUNCTION public.get_friend_ratings()
RETURNS TABLE (user_id uuid, bar_id text, tier text, rated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  with gated as materialized (
    select r.user_id, r.bar_id, r.tier::text, r.rated_at
      from public.ratings r
     where exists (
       select 1
         from public.follows f
        where f.follower_id = auth.uid()
          and f.followee_id = r.user_id
     )
  )
  select * from gated;
$fn$;

COMMENT ON FUNCTION public.get_friend_ratings() IS NULL;

REVOKE ALL ON FUNCTION public.get_friend_ratings() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_friend_ratings() TO authenticated;

DELETE FROM public.schema_migrations WHERE name = '0064_friend_ratings_score.sql';

-- Postcondition: the row is gone, the restored function returns no `score`
-- column, and it is still revoked from anon. Any failure aborts the whole
-- transaction, the body included.
DO $$
DECLARE
  cols text[];
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.schema_migrations WHERE name = '0064_friend_ratings_score.sql'
  ) THEN
    RAISE EXCEPTION 'the 0064 ledger row survived the delete';
  END IF;
  SELECT array_agg(a.name) INTO cols
    FROM pg_proc p
    CROSS JOIN LATERAL unnest(p.proargnames, p.proargmodes) AS a(name, mode)
   WHERE p.oid = 'public.get_friend_ratings()'::regprocedure
     AND a.mode IN ('o', 'b', 't');
  IF 'score' = ANY(cols) THEN
    RAISE EXCEPTION 'get_friend_ratings still returns a score after the restore';
  END IF;
  IF has_function_privilege('anon', 'public.get_friend_ratings()', 'execute') THEN
    RAISE EXCEPTION 'anon holds EXECUTE on the restored get_friend_ratings';
  END IF;
END
$$;

COMMIT;
