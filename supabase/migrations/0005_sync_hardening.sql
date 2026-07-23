-- Next Bar — 0005 sync hardening (B0.3)
--
-- What this does:
--   1. ratings.updated_at — client-supplied last-write timestamp
--   2. LWW guard trigger — a concurrent stale write (older updated_at) is
--      silently skipped instead of clobbering a newer one. Enforced
--      server-side because supabase-js .upsert() cannot express
--      ON CONFLICT ... DO UPDATE ... WHERE.
--   3. pairwise_comparisons.session_id — tags each comparison with the
--      client session that produced it, so a future reconcile flow can
--      detect two devices ranking against different base orderings.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. ratings.updated_at
------------------------------------------------------------------------------

alter table public.ratings
  add column if not exists updated_at timestamptz not null default now();

------------------------------------------------------------------------------
-- 2. Last-write-wins guard (BEFORE UPDATE)
------------------------------------------------------------------------------

create or replace function public.ratings_lww_guard()
returns trigger
language plpgsql
as $$
begin
  -- Reject (skip) an update that is not strictly newer than the stored row.
  -- Clocks are client-generated: ties lose so replays can't flip-flop.
  if new.updated_at is null or new.updated_at <= old.updated_at then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists ratings_lww on public.ratings;
create trigger ratings_lww
  before update on public.ratings
  for each row execute procedure public.ratings_lww_guard();

------------------------------------------------------------------------------
-- 3. pairwise_comparisons.session_id
------------------------------------------------------------------------------

alter table public.pairwise_comparisons
  add column if not exists session_id uuid;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   drop trigger if exists ratings_lww on public.ratings;
--   drop function if exists public.ratings_lww_guard();
--   alter table public.ratings drop column if exists updated_at;
--   alter table public.pairwise_comparisons drop column if exists session_id;
------------------------------------------------------------------------------
