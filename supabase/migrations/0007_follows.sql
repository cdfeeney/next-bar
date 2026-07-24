-- Next Bar — 0007 real social graph (B3)
--
-- ONE migration ships the table + EVERY dependent policy/RPC/view together
-- (blueprint rule: no half-landed social schema).
--
-- What this does:
--   1. follows — directed (follower_id, followee_id) edges between profiles.
--      RLS: follower may insert/delete own edges, both parties may read
--      edges they're in — kept as defense-in-depth, but table-level
--      INSERT/UPDATE/DELETE grants are REVOKED from client roles (0006
--      claim_handle lesson: an in-policy direct write would bypass the rate
--      cap), so the SECURITY DEFINER RPCs below are the ONLY write path.
--   2. follow_attempts — counter table backing the follow-rate cap
--      (100 follow attempts per user per day). RLS on, no policies; revoked
--      from PUBLIC (0006 pattern) so only the definer RPC touches it.
--   3. follow_user(target) / unfollow_user(target) RPCs — edge writes.
--      follow_user is bump-then-check rate-capped; every attempt (including
--      rejected ones) consumes the cap. unfollow_user is uncapped (it only
--      deletes the caller's own edges — bounded by rows that exist).
--   4. get_profile_by_handle(h) — exact-handle profile resolution
--      (id + handle + display_name). Exact match resolves PRIVATE profiles
--      too: the B2 decision keeps private users addable by exact handle
--      only, while prefix search (search_handles) never lists them. Shares
--      the handle_search_attempts counter with search_handles — exact-match
--      guessing is the same enumeration surface as prefix scraping.
--   5. get_following() — the caller's circle, handle-resolved (profiles has
--      no public SELECT policy, so followee handles are unreachable from
--      the client without this definer read).
--   6. friend_ratings VIEW — owner-bypass (SECURITY DEFINER semantics) view
--      over ratings exposing user_id, bar_id, tier, rated_at ONLY for rows
--      whose owner the caller follows. The `score` column is deliberately
--      ABSENT and must NEVER be added (blueprint hard rule / DeepSeek
--      side-channel: score stays owner-only; tier is the friend signal).
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. follows — the social graph edges
------------------------------------------------------------------------------

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- Reverse lookup ("who follows me") + the friend_ratings EXISTS probe.
create index if not exists follows_followee_idx on public.follows (followee_id);

alter table public.follows enable row level security;

drop policy if exists "follows: parties can read own edges" on public.follows;
create policy "follows: parties can read own edges"
  on public.follows for select
  using (auth.uid() = follower_id or auth.uid() = followee_id);

drop policy if exists "follows: follower can insert own" on public.follows;
create policy "follows: follower can insert own"
  on public.follows for insert
  with check (auth.uid() = follower_id);

drop policy if exists "follows: follower can delete own" on public.follows;
create policy "follows: follower can delete own"
  on public.follows for delete
  using (auth.uid() = follower_id);

-- Grants: SELECT only. Direct INSERT/UPDATE/DELETE are revoked so the
-- rate-capped RPCs are the only write path (the policies above become
-- defense-in-depth should a blanket grant ever return — 0006 lesson).
revoke all on table public.follows from public, anon, authenticated;
grant select on table public.follows to authenticated;

------------------------------------------------------------------------------
-- 2. follow_attempts — rate-cap backing store (0006 pattern)
------------------------------------------------------------------------------

create table if not exists public.follow_attempts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);

-- RLS with no policies: unreachable from client roles; only the SECURITY
-- DEFINER function (owner) reads/writes it. Revoked from PUBLIC so a future
-- blanket GRANT cannot silently re-expose it.
alter table public.follow_attempts enable row level security;
revoke all on table public.follow_attempts from public, anon, authenticated;

------------------------------------------------------------------------------
-- 3a. follow_user(target) — the only way to create a follow edge
------------------------------------------------------------------------------

-- DROP first (added 2026-07-25): 0008 replaces this function with a TEXT
-- return type, and CREATE OR REPLACE cannot change a return type — without
-- the drop, RE-RUNNING the sequence on a post-0008 database fails here.
-- Within a full run this window is safe: 0008 recreates the text version
-- (and its grants) moments later in the same session.
drop function if exists public.follow_user(uuid);
create function public.follow_user(target uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  follow_cap constant integer := 100;  -- follow attempts per user per day
  uid uuid := auth.uid();
  attempts integer;
begin
  if uid is null or target is null or target = uid then
    return false;
  end if;

  -- Rate cap: bump-then-check so every attempt (including rejected ones)
  -- counts. Old rows are tiny (1/user/day) — no cleanup needed yet.
  insert into public.follow_attempts as a (user_id, day, count)
  values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = a.count + 1
  returning count into attempts;

  if attempts > follow_cap then
    return false;
  end if;

  -- Inner block so a failure rolls back ONLY the insert — the attempt bump
  -- above must survive (hammering a bad target must consume the cap; 0006).
  begin
    insert into public.follows (follower_id, followee_id)
    values (uid, target)
    on conflict (follower_id, followee_id) do nothing;
  exception
    when foreign_key_violation then
      -- target profile doesn't exist.
      return false;
    when others then
      -- ANY other failure must not refund the attempt bump by escaping the
      -- function and rolling the whole transaction back.
      return false;
  end;

  -- Already-following lands here too (ON CONFLICT DO NOTHING): idempotent
  -- success — the caller's desired state ("I follow target") holds.
  return true;
end;
$$;

revoke all on function public.follow_user(uuid) from public, anon;
grant execute on function public.follow_user(uuid) to authenticated;

------------------------------------------------------------------------------
-- 3b. unfollow_user(target) — remove the caller's own edge
------------------------------------------------------------------------------

create or replace function public.unfollow_user(target uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or target is null then
    return false;
  end if;

  delete from public.follows
   where follower_id = uid
     and followee_id = target;

  -- True only when an edge actually existed — the client uses this to
  -- decide whether an optimistic removal must be rolled back.
  return found;
end;
$$;

revoke all on function public.unfollow_user(uuid) from public, anon;
grant execute on function public.unfollow_user(uuid) to authenticated;

------------------------------------------------------------------------------
-- 4. get_profile_by_handle(h) — exact-handle resolution (id included)
------------------------------------------------------------------------------

-- search_handles (0006) returns handle + display_name only and hides
-- private rows; this RPC additionally returns the profile id (needed to
-- follow / read friend ratings) and resolves EXACT matches regardless of
-- is_private — the B2 decision: private users are addable by exact handle
-- only. Rate-capped against the SAME counter as search_handles: exact-match
-- guessing is the same enumeration surface (500 shared lookups/user/day).
create or replace function public.get_profile_by_handle(h text)
returns table (id uuid, handle text, display_name text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  search_cap constant integer := 500;  -- shared with search_handles
  uid uuid := auth.uid();
  attempts integer;
begin
  if uid is null then
    return;
  end if;
  if lower(coalesce(h, '')) !~ '^[a-z0-9_]{3,20}$' then
    return;
  end if;

  insert into public.handle_search_attempts as a (user_id, day, count)
  values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = a.count + 1
  returning count into attempts;

  if attempts > search_cap then
    return;
  end if;

  return query
  select p.id, p.handle, p.display_name
    from public.profiles p
   where p.handle_normalized = lower(h);
end;
$$;

revoke all on function public.get_profile_by_handle(text) from public, anon;
grant execute on function public.get_profile_by_handle(text) to authenticated;

------------------------------------------------------------------------------
-- 5. get_following() — the caller's circle, handle-resolved
------------------------------------------------------------------------------

-- profiles has NO public SELECT policy (enumeration guard, 0006), so the
-- client cannot join follows→profiles itself. This definer read returns
-- only rows the caller created (their own follow edges) — not an
-- enumeration surface, hence no rate cap.
--
-- ⚠ HARD SECURITY BOUNDARY (DeepSeek review): because profiles has no
-- SELECT policy, the WHERE f.follower_id = auth.uid() below is the ONLY
-- thing standing between this definer function and full-directory
-- exposure. A one-character regression (e.g. followee_id) would silently
-- return every profile. Never edit this predicate without a test.
create or replace function public.get_following()
returns table (id uuid, handle text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.handle, p.display_name
    from public.follows f
    join public.profiles p on p.id = f.followee_id
   where f.follower_id = auth.uid()
   order by lower(coalesce(p.handle, '')) asc;
$$;

revoke all on function public.get_following() from public, anon;
grant execute on function public.get_following() to authenticated;

------------------------------------------------------------------------------
-- 6. friend_ratings — tier-only friend read on ratings (NEVER score)
------------------------------------------------------------------------------

-- SECURITY DEFINER function with a MATERIALIZED fence, not a view (DeepSeek
-- review): PostgreSQL marks uuid `=` LEAKPROOF, so a security_barrier view
-- still lets the planner push a caller's WHERE user_id = X below the EXISTS
-- gate — a timing side-channel probing whether an UNFOLLOWED user has
-- ratings. `with ... as materialized` forces the gated set to fully
-- evaluate before any outer predicate applies.
--
-- HARD RULE: the `score` column must NEVER be added here (side-channel —
-- scores stay owner-only; tier is the friend-visible signal).
drop view if exists public.friend_ratings;

create or replace function public.get_friend_ratings()
returns table (user_id uuid, bar_id text, tier text, rated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with gated as materialized (
    select r.user_id, r.bar_id, r.tier::text, r.rated_at
      from public.ratings r
     where exists (
       select 1
         from public.follows f
        where f.follower_id = auth.uid()
          and f.followee_id = r.user_id
     )
  )
  select * from gated;
$$;

revoke all on function public.get_friend_ratings() from public, anon;
grant execute on function public.get_friend_ratings() to authenticated;

-- Defense-in-depth re-REVOKE (DeepSeek review): get_profile_by_handle
-- shares 0006's search counter; a future blanket GRANT must not let a
-- client reset its own enumeration cap even if 0006's revoke is dropped.
revoke all on table public.handle_search_attempts from public, anon, authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   drop view if exists public.friend_ratings;
--   revoke all on function public.get_following() from authenticated;
--   drop function if exists public.get_following();
--   revoke all on function public.get_profile_by_handle(text) from authenticated;
--   drop function if exists public.get_profile_by_handle(text);
--   revoke all on function public.unfollow_user(uuid) from authenticated;
--   drop function if exists public.unfollow_user(uuid);
--   revoke all on function public.follow_user(uuid) from authenticated;
--   drop function if exists public.follow_user(uuid);
--   drop table if exists public.follow_attempts;
--   drop table if exists public.follows;
------------------------------------------------------------------------------
