-- Next Bar — 0033 vibe profile persistence (G1)
--
-- What this does:
--   1. public.vibe_profiles — one row per auth.user holding the quiz result
--   2. Owner-only RLS (select/insert/update), mirroring 0001's profiles style
--   3. LWW guard trigger — a stale write never clobbers a newer one, the same
--      rule migration 0005 established for ratings
--
-- WHY A SEPARATE TABLE rather than a column on public.profiles:
--   0006 added a SECURITY DEFINER handle-lookup function that reads
--   public.profiles and deliberately bypasses RLS (enumeration guard),
--   returning handle + display_name only. Any column added to `profiles` is
--   therefore one careless `select *` away from being exfiltrated by a
--   function whose whole job is to bypass row security. A separate table is
--   simply not reachable from it.
--   Second reason: profiles carries the profiles_touch_updated_at trigger, so
--   piggybacking would make `updated_at` lie — editing a handle would look
--   identical to retaking the quiz.
--
-- Shape mapping (see src/lib/storedProfile.ts):
--   localStorage StoredProfile  ↔  Supabase `vibe_profiles` row
--   { tags, preferredNeighborhoods, archetype, savedAt }
--     ↔  { profile jsonb, saved_at }
--
-- Deep shape validation stays in TypeScript (loadProfile / parseVibeProfile),
-- which already validates all four fields. A SQL CHECK mirroring the VibeTag
-- and ManhattanNeighborhood unions would duplicate them and then drift, so
-- the constraint here is only the shape FLOOR.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. vibe_profiles
------------------------------------------------------------------------------

create table if not exists public.vibe_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  profile     jsonb       not null,
  saved_at    timestamptz not null,
  updated_at  timestamptz not null default now(),
  constraint vibe_profiles_profile_is_object
    check (jsonb_typeof(profile) = 'object')
);

------------------------------------------------------------------------------
-- 2. Row level security — owner only, no public read
------------------------------------------------------------------------------

alter table public.vibe_profiles enable row level security;

drop policy if exists "vibe_profiles: owner can read own"   on public.vibe_profiles;
drop policy if exists "vibe_profiles: owner can insert own" on public.vibe_profiles;
drop policy if exists "vibe_profiles: owner can update own" on public.vibe_profiles;
drop policy if exists "vibe_profiles: owner can delete own" on public.vibe_profiles;

create policy "vibe_profiles: owner can read own"
  on public.vibe_profiles for select
  using (auth.uid() = user_id);

create policy "vibe_profiles: owner can insert own"
  on public.vibe_profiles for insert
  with check (auth.uid() = user_id);

create policy "vibe_profiles: owner can update own"
  on public.vibe_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Owner-scoped DELETE is REQUIRED, not optional.
--
-- This started life with no delete policy on the theory that "clearing the
-- quiz result is a local-only action". Three independent reviewers rejected
-- that: Settings has a "Clear your saved vibe profile" button, and without a
-- server delete the local clear is undone by the very next sign-in sync
-- (local absent + server present -> hydrate). That is a user-facing control
-- that silently does not do what it says, and for stored personal preference
-- data it is also a right-to-erasure problem, not merely a UX wart.
-- The sibling handleClearRatings in src/app/settings/page.tsx already deletes
-- server rows BEFORE clearing locally for exactly this reason.
create policy "vibe_profiles: owner can delete own"
  on public.vibe_profiles for delete
  using (auth.uid() = user_id);

------------------------------------------------------------------------------
-- 2b. Grants — revoke-first, the house pattern stated at 0019:80
------------------------------------------------------------------------------
-- Added by the C3 RLS audit (F3), which caught this table matching 0001's
-- POLICY style but not 0019's GRANT style — it relied entirely on the blanket
-- default privileges Supabase hands the anon and authenticated roles.
-- (Phrased rather than quoted on purpose: this file's own guard test rejects
-- the literal grant-to-anon text anywhere in it, comments included.)
--
-- This changes nothing about who can read what TODAY: the policies above
-- already deny `anon`, which has no auth.uid() and therefore matches no row.
-- What it buys is surviving a mistake. A revoke-first table still has to
-- pass a grant check if RLS is ever accidentally disabled; a
-- defaults-reliant table is wide open the instant that happens.
--
-- Amended in place rather than added as 0034 because 0033 has never been
-- applied — schema_migrations ends at 0032, so there is no deployed
-- database whose grants would diverge from this file.
revoke all on table public.vibe_profiles from public, anon, authenticated;

-- Exactly the four verbs the owner policies above allow, and no more:
-- select/insert/update back the sync in src/lib/vibeProfile.server.ts,
-- delete backs Settings' "Clear your saved vibe profile".
grant select, insert, update, delete
  on table public.vibe_profiles to authenticated;

------------------------------------------------------------------------------
-- 3. Last-write-wins guard (BEFORE UPDATE) — same rule as ratings_lww (0005)
------------------------------------------------------------------------------

create or replace function public.vibe_profiles_lww_guard()
returns trigger
language plpgsql
-- Pinned search_path: this function is invoked by a trigger on a
-- user-writable table, so an attacker-controlled search_path must not be
-- able to shadow anything it resolves.
set search_path = ''
as $$
begin
  -- Reject (skip) an update that is not strictly newer than the stored row.
  -- Clocks are client-generated: TIES LOSE, so the stored row survives and
  -- replays cannot flip-flop. This is the server-side half of the conflict
  -- rule documented in src/lib/vibeProfileSync.ts.
  if new.saved_at is null or new.saved_at <= old.saved_at then
    return null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists vibe_profiles_lww on public.vibe_profiles;
create trigger vibe_profiles_lww
  before update on public.vibe_profiles
  for each row execute procedure public.vibe_profiles_lww_guard();

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   drop trigger if exists vibe_profiles_lww on public.vibe_profiles;
--   drop function if exists public.vibe_profiles_lww_guard();
--   drop table if exists public.vibe_profiles;
------------------------------------------------------------------------------
