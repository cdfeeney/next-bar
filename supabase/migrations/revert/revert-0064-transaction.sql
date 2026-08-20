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

\set ON_ERROR_STOP on

BEGIN;

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
