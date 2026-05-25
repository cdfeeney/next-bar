-- Next Bar — v0.5.1 schema (pairwise comparisons)
-- Run this in Supabase SQL Editor: https://app.supabase.com/project/<id>/sql/new
--
-- What this does:
--   1. Creates `pairwise_comparisons` table — one row per "A > B" user answer
--   2. Enables Row Level Security with owner-only policies
--   3. Adds a check constraint so winner != loser (cheap sanity rail)
--
-- The `ratings.score numeric(3,1)` column already exists from 0001; v0.5.1
-- starts populating it from the comparison graph computed in this table.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. pairwise_comparisons — sparse table, only what the user answered
------------------------------------------------------------------------------

create table if not exists public.pairwise_comparisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  winner_bar_id text not null,
  loser_bar_id text not null,
  compared_at timestamptz not null default now(),
  check (winner_bar_id <> loser_bar_id)
);

create index if not exists pairwise_user_idx
  on public.pairwise_comparisons (user_id);

create index if not exists pairwise_user_time_idx
  on public.pairwise_comparisons (user_id, compared_at desc);

------------------------------------------------------------------------------
-- 2. Row Level Security — owner-only (consistent with ratings policies)
------------------------------------------------------------------------------

alter table public.pairwise_comparisons enable row level security;

drop policy if exists "pairwise: owner can read own"   on public.pairwise_comparisons;
drop policy if exists "pairwise: owner can write own"  on public.pairwise_comparisons;
drop policy if exists "pairwise: owner can delete own" on public.pairwise_comparisons;

create policy "pairwise: owner can read own"
  on public.pairwise_comparisons for select
  using (auth.uid() = user_id);

create policy "pairwise: owner can write own"
  on public.pairwise_comparisons for insert
  with check (auth.uid() = user_id);

create policy "pairwise: owner can delete own"
  on public.pairwise_comparisons for delete
  using (auth.uid() = user_id);

-- No UPDATE policy: comparisons are immutable. Users redo a judgment by
-- inserting a new row; the score computation reads the latest state.

------------------------------------------------------------------------------
-- Verification (run manually):
--   select * from public.pairwise_comparisons where user_id = auth.uid();
--   -- after answering a sheet, you should see a row appear
------------------------------------------------------------------------------
