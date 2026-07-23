-- Next Bar — 0000 reconcile v0.1 schema (runs before 0001 by lexical order)
--
-- Discovery 2026-07-23: the live DB only ever had the v0.1 `schema.sql` tables
-- (bars, profiles[email/vibe_profile shape], saves, visits, waitlist) —
-- migration 0001 was never applied, so `ratings` never existed and the v0.5
-- profiles shape (handle/display_name/is_private) conflicts with the legacy
-- `profiles` table. All legacy tables were verified EMPTY except waitlist
-- (which this migration does not touch; /api/waitlist still uses it).
--
-- This migration renames the empty legacy tables out of the way so 0001's
-- CREATE TABLE IF NOT EXISTS creates the correct v0.5 shapes. Rename (not
-- drop) so nothing is destroyed even if this assumption is ever wrong.
--
-- Idempotent: guarded on the legacy column shape / table existence.

do $$
begin
  -- legacy profiles has `email` and no `handle`; v0.5 profiles must not match
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'email'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'handle'
  ) then
    alter table public.profiles rename to profiles_v01_legacy;
  end if;

  if to_regclass('public.saves') is not null
     and to_regclass('public.saves_v01_legacy') is null then
    alter table public.saves rename to saves_v01_legacy;
  end if;

  if to_regclass('public.visits') is not null
     and to_regclass('public.visits_v01_legacy') is null then
    alter table public.visits rename to visits_v01_legacy;
  end if;

  if to_regclass('public.bars') is not null
     and to_regclass('public.bars_v01_legacy') is null then
    alter table public.bars rename to bars_v01_legacy;
  end if;
end $$;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   alter table public.profiles_v01_legacy rename to profiles;
--   alter table public.saves_v01_legacy rename to saves;
--   alter table public.visits_v01_legacy rename to visits;
--   alter table public.bars_v01_legacy rename to bars;
------------------------------------------------------------------------------
