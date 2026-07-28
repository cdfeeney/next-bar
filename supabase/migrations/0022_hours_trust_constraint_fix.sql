-- Next Bar — 0022: close the NULL hole in bars_google_hours_never_trusted
--
-- 0021 added this constraint:
--
--   check (hours_source is distinct from 'google'
--          or hours_confidence is not distinct from 'unverified')
--
-- It only fires when hours_source is exactly 'google'. A row with
-- hours_source IS NULL and hours_confidence = 'verified' PASSES, because
-- `NULL is distinct from 'google'` evaluates TRUE.
--
-- That is not academic. src/lib/catalogServer.ts maps an absent hours_source
-- to 'google' on read:
--
--   hoursSource: HOURS_SOURCES.has(row.hours_source ?? '') ? row.hours_source : 'google'
--
-- So a NULL-source row marked 'verified' comes back to the application as
-- Google-derived hours that hasTrustworthyHours() will TRUST — the exact
-- invariant 0021 set out to make unforgettable. 73 of 1,265 rows currently
-- have hours_source IS NULL, so the hole is reachable, not hypothetical.
--
-- This is a NEW file rather than an edit to 0021 because 0021 is already
-- applied. Editing an applied migration makes the file and the database
-- disagree silently and forever; scripts/apply-migrations.ts now refuses to
-- run when it detects that, and this migration follows its own rule.
--
-- Verified before writing: `select count(*) from public.bars where not
-- (<new predicate>)` returns 0, so ADD CONSTRAINT cannot fail validation.
-- The table is ~1,265 rows, so the ACCESS EXCLUSIVE lock is momentary and
-- NOT VALID + VALIDATE CONSTRAINT is not warranted.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- Replace the weak predicate with one that keys off the CLAIM, not the source
------------------------------------------------------------------------------
-- Drop-then-add, deliberately. An `if not exists` guard (which is what 0021
-- used) would see the existing weak constraint and leave it in place, so the
-- fix would silently do nothing on every database that already ran 0021.

alter table public.bars
  drop constraint if exists bars_google_hours_never_trusted;

alter table public.bars add constraint bars_google_hours_never_trusted
  check (
    -- No trust is being claimed: always allowed.
    hours_confidence is null
    or hours_confidence = 'unverified'
    -- Claiming 'reported' or 'verified' REQUIRES a known, non-Google source.
    or (hours_source is not null and hours_source <> 'google')
  );

-- Resulting truth table:
--   (google,        unverified) -> allowed
--   (NULL,          NULL)       -> allowed
--   (NULL,          unverified) -> allowed
--   (venue|nextbar|user|official_site, verified|reported) -> allowed
--   (google,        verified)   -> REJECTED
--   (google,        reported)   -> REJECTED
--   (NULL,          verified)   -> REJECTED   <-- the hole 0021 left open
--   (NULL,          reported)   -> REJECTED   <-- likewise

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   alter table public.bars drop constraint if exists bars_google_hours_never_trusted;
--   -- then re-add 0021's weaker predicate if you truly need it back.
------------------------------------------------------------------------------
