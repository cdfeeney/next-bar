-- 0033_a_reconcile_profiles_shares_flag.sql
--
-- A REPAIR OF DRIFT, NOT A PRODUCT CHANGE. It re-adds one inert, default-false boolean that
-- production's own ledger says it should already have.
--
-- WHAT HAPPENED. `0034_revoke_first_grants.sql` does
--   grant update (display_name, is_private, shares_list_publicly) on public.profiles ...
-- and on 2026-08-31 that failed against production with `column "shares_list_publicly" of relation
-- "profiles" does not exist`, rolling the whole 32-file set back. `0015_public_shared_list.sql:37`
-- adds that column, production's `public.schema_migrations` records 0015 as applied on
-- 2026-07-28, and the live `public.profiles` has seven columns and not that one. The ledger and
-- the schema disagree, and nothing in the migration set removes the column: 0066 retires the
-- FUNCTION (`drop function if exists public.get_public_ratings(text)`) and never touches it.
--
-- Two explanations fit, and THE REPAIR IS THE SAME EITHER WAY, which is why this file does not
-- try to decide between them:
--   (a) 0015 ran, and someone later hand-ran the rollback documented in its own footer
--       (`alter table public.profiles drop column if exists shares_list_publicly;`), or
--   (b) 0015's ledger row was backfilled without the SQL ever executing.
-- A checksum match proves a FILE hashes to a recorded value. It does not prove that file ran.
--
-- WHY THIS NUMBER. `apply-migration-set.ts` enforces two rules that together fix the name: every
-- entry must sort ABOVE the ledger head (0032), and the given set must be in LEXICAL ORDER, which
-- it refuses to silently correct. So a repair 0034 depends on cannot be numbered 0075 and passed
-- first. `migration-ledger-guard.ts` additionally requires a four-digit `NNNN_` prefix, ruling out
-- `0033a`. `0033_a_` satisfies all three: above 0032, sorts before both `0033_vibe_profiles.sql`
-- and 0034, four digits, underscore.
--
-- ON A FRESH REPLAY THIS IS A NO-OP. 0015 runs first and adds the column; `if not exists` then
-- does nothing. Staging, rebuilt from all 65 files, already has the column, so this brings
-- production to the same end state rather than inventing a new one.
--
-- The column stays INERT. 0015's contract is opt-in and default false, and 0066 retired the only
-- reader (`get_public_ratings`). Nothing here sets the flag for any user, and no code path in V8
-- reads it. It exists so 0034's grant has a column to name.
--
-- Idempotent: `add column if not exists`. Safe to re-run.
--
-- Rollback (in comments, per convention):
--   alter table public.profiles drop column if exists shares_list_publicly;

alter table public.profiles
  add column if not exists shares_list_publicly boolean not null default false;

-- Byte-for-byte the comment 0015 sets, so a database repaired by this file is indistinguishable
-- from one that applied 0015 normally. It describes a surface 0066 later retires; that is equally
-- true on staging, and the schema comment 0066 writes is what records the retirement.
comment on column public.profiles.shares_list_publicly is
  'Owner opt-in: allow ANONYMOUS read of this profile''s rating tiers via '
  'get_public_ratings(). Default false. Never set this on a user''s behalf.';
