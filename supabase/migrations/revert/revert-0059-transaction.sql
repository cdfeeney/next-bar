-- Runnable, atomic rollback of migration 0059. This is THE rollback path.
--
-- One file rather than a shell recipe, deliberately: the operator works on
-- Windows/PowerShell, and the previous README documented a bash heredoc with
-- $VAR expansion that PowerShell cannot parse — a rollback command that does not
-- run in the shell it will be run from is not a rollback path. A psql -f script
-- is shell-agnostic, so the same single line works in PowerShell, cmd and bash.
--
-- RUN IT FROM THE REPOSITORY ROOT:
--
--   psql "<connection-string>" -v ON_ERROR_STOP=1 -f supabase/migrations/revert/revert-0059-transaction.sql
--
-- ...or pass an absolute path from anywhere:
--
--   psql "<connection-string>" -v ON_ERROR_STOP=1 -f <repo>/supabase/migrations/revert/revert-0059-transaction.sql
--
-- An earlier version of this comment claimed the command "works from anywhere".
-- It does not, and a reviewer caught it: psql resolves the -f argument against
-- the CALLER's working directory. Only \ir below is relative to this file, and
-- that governs the nested include, not how psql found this script.
--
-- Restoring the bodies and unrecording the migration MUST be one transaction. If
-- they come apart, the ledger claims 0059 while 0058's bodies are installed, and
-- every ledger-aware tool then acts on a false picture.
--
-- Read README.md in this directory BEFORE running this. It is the single source
-- for what this revert costs — in particular that it discards every stored
-- revision, and why re-applying 0059 afterwards is not safe.

\set ON_ERROR_STOP on

BEGIN;

-- PRECONDITION, checked before anything is touched.
--
-- A reviewer found the earlier version asserted only that no 0059 row REMAINS
-- afterwards — which is trivially true on a database that never had one. The
-- DELETE would affect zero rows and the script would still commit a body
-- downgrade. The reachable cases of that are benign (they leave a consistent
-- 0058 state), but the guard was weaker than its own comment claimed, and on a
-- ledger that has moved PAST 0059 it would silently clobber a later definition.
--
-- So: refuse unless 0059 is actually the thing being undone.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.schema_migrations
     WHERE name = '0059_night_outs_respond_revision.sql'
  ) THEN
    RAISE EXCEPTION
      '0059 is not in the ledger, so there is nothing here to revert — wrong target, already reverted, or a ledger that has moved on. Refusing.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.schema_migrations
     WHERE name > '0059_night_outs_respond_revision.sql'
  ) THEN
    RAISE EXCEPTION
      'the ledger contains migrations AFTER 0059; reverting it now could clobber a later definition. Revert those first.';
  END IF;
END
$$;

\ir REVERT-0059-staging-20260817.sql

DELETE FROM public.schema_migrations
 WHERE name = '0059_night_outs_respond_revision.sql';

-- Postcondition: the row is gone and 0058 — whose bodies are now installed — is
-- still recorded. Any failure aborts the whole transaction, bodies included.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.schema_migrations
     WHERE name = '0059_night_outs_respond_revision.sql'
  ) THEN
    RAISE EXCEPTION 'ledger row for 0059 survived the delete; rolling back';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.schema_migrations
     WHERE name = '0058_night_outs_respond_expected_status_atomic.sql'
  ) THEN
    RAISE EXCEPTION '0058 is not in the ledger, so 0058 bodies would be installed unrecorded; rolling back';
  END IF;
END
$$;

COMMIT;
