-- Next Bar — 0036 protect the migration ledger from browser roles
--
-- Supabase Security Advisor found public.schema_migrations with RLS disabled.
-- A staging probe then confirmed the impact rather than assuming it:
-- `anon` and `authenticated` both had SELECT and write table privileges from
-- Supabase's default grants. A browser caller could therefore read checksums or
-- falsify the ledger that decides which database changes are still pending.
--
-- This table is runner-internal. Repository search found no application read or
-- write path, so it needs no browser policy and no browser grant. The migration
-- owner remains able to insert the 0036 ledger row after these statements; the
-- service_role is deliberately untouched and has BYPASSRLS in Supabase.
--
-- Existing databases need this numbered migration. Fresh databases are also
-- protected immediately by MIGRATION_LEDGER_DDL in apply-migrations.ts, before
-- the runner reads or writes its first ledger row. Keeping both controls is
-- deliberate: the runner closes the creation-time window; this migration makes
-- the state portable, reviewable, and repairable on already-created projects.
--
-- Compatibility: old and new web/mobile clients are unaffected because no app
-- client uses schema_migrations. The only consumer is the privileged migration
-- runner. No user or catalog data is read, rewritten, or deleted.
--
-- Recovery: no application rollback is expected or useful. If an emergency
-- operator must restore the insecure prior state, they can disable RLS and
-- re-grant privileges, but doing so reopens the finding and must not be used as
-- a routine rollback.
--
-- Idempotent: ENABLE RLS and REVOKE ALL are safe to re-run.
--
-- On a FRESH database this file therefore runs against a table the runner has
-- already hardened, and re-applies the same two statements. That overlap is
-- intentional, not redundancy to clean up: the runner's copy is what protects a
-- database created before this file is reached, and this file is what repairs a
-- database created before the runner had that copy. Removing either one reopens
-- a real window.

alter table public.schema_migrations enable row level security;

revoke all on table public.schema_migrations
  from public, anon, authenticated;

comment on table public.schema_migrations is
  'Internal migration ledger. Browser roles have no direct access; maintained by the privileged migration runner. Do not re-open anon/authenticated access to restore visibility - read it as the owner or through a security-definer function, or the no-browser-path invariant erodes one privilege at a time.';

------------------------------------------------------------------------------
-- Rollback (emergency only; restores the insecure state this migration fixes):
--   alter table public.schema_migrations disable row level security;
--   grant all on table public.schema_migrations to anon, authenticated;
------------------------------------------------------------------------------
