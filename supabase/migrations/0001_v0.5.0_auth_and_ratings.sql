-- Next Bar — v0.5.0 schema (auth + ratings sync)
-- Run this in Supabase SQL Editor: https://app.supabase.com/project/<id>/sql/new
--
-- What this does:
--   1. Creates `profiles` table — one row per auth.user, holds display state
--   2. Creates `ratings` table — server-side bar ratings (replaces localStorage)
--   3. Auto-creates a profile row when a new auth.user is inserted (signup trigger)
--   4. Enables Row Level Security on both, with policies that ONLY let a user
--      read/write their own data. Other users' data is inaccessible until the
--      v0.5.3 follows table + public-profile policies land.
--
-- Idempotent: safe to re-run. Drops & recreates policies and trigger; leaves
-- existing row data intact (CREATE TABLE IF NOT EXISTS, no DROP TABLE).

------------------------------------------------------------------------------
-- 1. profiles — one per auth.user
------------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique,                       -- nullable until user picks one (v0.5.2)
  display_name text,
  is_private boolean not null default true, -- private by default per PRD-v0.5 D5
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_handle_idx on public.profiles (handle);

------------------------------------------------------------------------------
-- 2. ratings — server-side, replaces localStorage on sign-in
------------------------------------------------------------------------------

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bar_id text not null,                     -- references src/lib/bars.ts id (in-code dataset)
  tier text not null check (tier in ('loved','liked','pass')),
  score numeric(3,1),                       -- 0.0–10.0; NULL until v0.5.1 pairwise runs
  rated_at timestamptz not null default now(),
  unique (user_id, bar_id)
);

create index if not exists ratings_user_idx on public.ratings (user_id);
create index if not exists ratings_user_tier_idx on public.ratings (user_id, tier);

------------------------------------------------------------------------------
-- 3. Auto-create profile row on new auth.user
------------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

------------------------------------------------------------------------------
-- 4. Row Level Security — owner-only for v0.5.0
--    (Public-profile / friend-visible policies land with v0.5.3 follows table)
------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.ratings  enable row level security;

-- profiles ---------------------------------------------------------------

drop policy if exists "profiles: owner can read own"    on public.profiles;
drop policy if exists "profiles: owner can update own"  on public.profiles;
drop policy if exists "profiles: owner can insert own"  on public.profiles;

create policy "profiles: owner can read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: owner can update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles: owner can insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ratings ----------------------------------------------------------------

drop policy if exists "ratings: owner can read own"    on public.ratings;
drop policy if exists "ratings: owner can write own"   on public.ratings;
drop policy if exists "ratings: owner can update own"  on public.ratings;
drop policy if exists "ratings: owner can delete own"  on public.ratings;

create policy "ratings: owner can read own"
  on public.ratings for select
  using (auth.uid() = user_id);

create policy "ratings: owner can write own"
  on public.ratings for insert
  with check (auth.uid() = user_id);

create policy "ratings: owner can update own"
  on public.ratings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "ratings: owner can delete own"
  on public.ratings for delete
  using (auth.uid() = user_id);

------------------------------------------------------------------------------
-- 5. updated_at touch trigger on profiles
------------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute procedure public.touch_updated_at();

------------------------------------------------------------------------------
-- Verification queries (run manually to sanity-check):
--   select * from public.profiles;
--   select * from public.ratings;
--   -- after signing up via the app, you should see a profile row appear
------------------------------------------------------------------------------
