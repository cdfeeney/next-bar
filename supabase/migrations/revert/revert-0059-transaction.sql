-- Runnable, atomic rollback of migration 0059. This is THE rollback path.
--
-- One file rather than a shell recipe, deliberately: the operator works on
-- Windows/PowerShell, and the previous README documented a bash heredoc with
-- $VAR expansion that PowerShell cannot parse — a rollback command that does not
-- run in the shell it will be run from is not a rollback path. A psql -f script
-- is shell-agnostic, so the same single line works in PowerShell, cmd and bash:
--
--   psql "<connection-string>" -v ON_ERROR_STOP=1 -f supabase/migrations/revert/revert-0059-transaction.sql
--
-- \ir resolves relative to THIS file, not to the caller's working directory, so
-- the command above works from anywhere in the repository.
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

\ir REVERT-0059-staging-20260817.sql

DELETE FROM public.schema_migrations
 WHERE name = '0059_night_outs_respond_revision.sql';

-- Fail rather than commit a half-done rollback: exactly one ledger row must go.
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
