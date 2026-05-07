-- Next Bar — Supabase schema
-- Run this in the Supabase SQL editor for a fresh project.

create extension if not exists "pgcrypto";

-- =========================================================================
-- profiles
-- =========================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  vibe_profile jsonb,
  neighborhood text,
  age_range text,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- bars
-- =========================================================================
create table if not exists public.bars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  neighborhood text not null,
  lat double precision not null,
  lng double precision not null,
  hours jsonb,
  price_tier int not null check (price_tier between 1 and 4),
  hero_photo text,
  ig_handle text,
  google_place_id text unique,
  vibe_tags text[] not null default '{}',
  vibe_vector real[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bars_neighborhood_idx on public.bars (neighborhood);
create index if not exists bars_vibe_tags_idx on public.bars using gin (vibe_tags);

-- =========================================================================
-- visits
-- =========================================================================
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bar_id uuid not null references public.bars(id) on delete cascade,
  rating int check (rating between 1 and 5),
  notes text,
  visited_at timestamptz not null default now(),
  unique (user_id, bar_id)
);

create index if not exists visits_user_idx on public.visits (user_id);
create index if not exists visits_bar_idx on public.visits (bar_id);

-- =========================================================================
-- saves
-- =========================================================================
create table if not exists public.saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bar_id uuid not null references public.bars(id) on delete cascade,
  saved_at timestamptz not null default now(),
  unique (user_id, bar_id)
);

create index if not exists saves_user_idx on public.saves (user_id);
create index if not exists saves_bar_idx on public.saves (bar_id);

-- =========================================================================
-- waitlist
-- =========================================================================
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  vibe_profile jsonb,
  neighborhood text,
  age_range text,
  source text,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- Row Level Security
-- =========================================================================
alter table public.profiles enable row level security;
alter table public.bars enable row level security;
alter table public.visits enable row level security;
alter table public.saves enable row level security;
alter table public.waitlist enable row level security;

-- bars: public read
drop policy if exists "bars are publicly readable" on public.bars;
create policy "bars are publicly readable"
  on public.bars
  for select
  using (true);

-- profiles: own rows only
drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select own"
  on public.profiles
  for select
  using (auth.uid() = id);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own"
  on public.profiles
  for insert
  with check (auth.uid() = id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles delete own" on public.profiles;
create policy "profiles delete own"
  on public.profiles
  for delete
  using (auth.uid() = id);

-- visits: own rows only
drop policy if exists "visits select own" on public.visits;
create policy "visits select own"
  on public.visits
  for select
  using (auth.uid() = user_id);

drop policy if exists "visits insert own" on public.visits;
create policy "visits insert own"
  on public.visits
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "visits update own" on public.visits;
create policy "visits update own"
  on public.visits
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "visits delete own" on public.visits;
create policy "visits delete own"
  on public.visits
  for delete
  using (auth.uid() = user_id);

-- saves: own rows only
drop policy if exists "saves select own" on public.saves;
create policy "saves select own"
  on public.saves
  for select
  using (auth.uid() = user_id);

drop policy if exists "saves insert own" on public.saves;
create policy "saves insert own"
  on public.saves
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "saves update own" on public.saves;
create policy "saves update own"
  on public.saves
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "saves delete own" on public.saves;
create policy "saves delete own"
  on public.saves
  for delete
  using (auth.uid() = user_id);

-- waitlist: anyone can insert; only service role reads
drop policy if exists "waitlist anyone insert" on public.waitlist;
create policy "waitlist anyone insert"
  on public.waitlist
  for insert
  with check (true);

drop policy if exists "waitlist service role select" on public.waitlist;
create policy "waitlist service role select"
  on public.waitlist
  for select
  using (auth.role() = 'service_role');
