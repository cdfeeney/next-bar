-- Next Bar — 0017 vibe votes ("what's tonight's vibe?" nightly poll)
--
-- UX-E (operator, 2026-07-26): circle members vote on tonight's vibe on
-- the Plan Night Out board; the winning vibe seeds Group Favorites
-- (client-side boost). Design: docs/UXE-VIBE-VOTE-DESIGN.md.
--
-- Model: ONE vote per user per night — PK (user_id, night) backs that
-- declaratively (0012 lesson: procedural invariants need a constraint
-- backstop). A re-vote is an upsert MOVE; rescind is an own-row DELETE.
-- `night` is the client-computed NYC night key (6am rollover,
-- src/lib/nightKey.ts); the server treats it as opaque and bounds it to
-- ±2 days of now() (0011/0012 precedent).
--
-- The vote is a lowercase tag-shaped text (regex-bounded, no FK — the
-- vibe vocabulary lives in code; unknown tags are display-filtered
-- client-side, 0008 tolerance precedent).
--
-- House style (0016): p_ prefixed params (42702 lesson — a param must
-- never share a name with a column it can collide with), revoke-first
-- grants, definer reads behind a materialized fence.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. Table
------------------------------------------------------------------------------

create table if not exists public.vibe_votes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  night date not null,
  tag text not null,
  created_at timestamptz not null default now(),
  -- Named explicitly (DeepSeek review): cast_vibe_vote's ON CONSTRAINT
  -- reference must survive any future refactor of this DDL.
  constraint vibe_votes_pkey primary key (user_id, night)
);

create index if not exists vibe_votes_night_idx
  on public.vibe_votes (night, user_id);

alter table public.vibe_votes enable row level security;
revoke all on table public.vibe_votes from public, anon, authenticated;

-- Own-row delete ("rescind my vote") is the only direct table access.
grant delete on table public.vibe_votes to authenticated;
drop policy if exists vibe_votes_delete_own on public.vibe_votes;
create policy vibe_votes_delete_own on public.vibe_votes
  for delete to authenticated
  using (user_id = auth.uid());

------------------------------------------------------------------------------
-- 2. cast_vibe_vote(p_night, p_tag) — upsert MOVE (one vote per night)
------------------------------------------------------------------------------

create or replace function public.cast_vibe_vote(p_night date, p_tag text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night is null or p_tag is null then
    return false;
  end if;
  -- Opaque-key sanity bound: tonight-ish only (client clock skew ±2 days).
  if p_night < (current_date - 2) or p_night > (current_date + 2) then
    return false;
  end if;
  -- Vibe tags are short lowercase kebab words (e.g. 'dance', 'old-nyc').
  -- ASCII-only backstop (DeepSeek review): [a-z] ranges follow the
  -- cluster collation, which on glibc locales can admit accented
  -- letters — reject any multi-byte input outright.
  if p_tag !~ '^[a-z][a-z-]{1,23}$'
     or octet_length(p_tag) <> char_length(p_tag) then
    return false;
  end if;

  insert into public.vibe_votes (user_id, night, tag)
  values (v_uid, p_night, p_tag)
  -- ON CONSTRAINT, never a column list (42702 prod lesson from 0011/0012).
  on conflict on constraint vibe_votes_pkey
  -- No-op when the tag is unchanged (DeepSeek review): a repeated cast of
  -- the same vibe must not reset created_at (it anchors the winner
  -- tie-break — "who settled on this vibe first") nor churn WAL.
  do update set tag = excluded.tag, created_at = now()
  where vibe_votes.tag is distinct from excluded.tag;
  return true;
end;
$$;

revoke all on function public.cast_vibe_vote(date, text) from public, anon, authenticated;
grant execute on function public.cast_vibe_vote(date, text) to authenticated;

------------------------------------------------------------------------------
-- 3. get_circle_vibe_votes(p_night) — own + followed users' votes
------------------------------------------------------------------------------

create or replace function public.get_circle_vibe_votes(p_night date)
returns table (user_id uuid, handle text, display_name text, tag text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  -- ⚠ HARD SECURITY BOUNDARY (0007/0010 lesson): the predicate inside the
  -- fence — own rows OR the caller's follow edges — is the ONLY thing
  -- between this definer join and a public vote firehose. Never edit it
  -- without a test. MATERIALIZED fence (0016 lesson): stops the planner
  -- pushing an outer predicate under the auth filter (LEAKPROOF timing
  -- channel).
  with gated as materialized (
    select v.user_id, v.tag, v.created_at
      from public.vibe_votes v
     where v.night = p_night
       -- Null-uid short-circuit (DeepSeek review): a session with no
       -- resolvable uid gets zero work, not a full-scan-to-empty.
       and auth.uid() is not null
       and (
         v.user_id = auth.uid()
         or v.user_id in (
           select f.followee_id from public.follows f
            where f.follower_id = auth.uid()
         )
       )
  )
  select g.user_id, p.handle, p.display_name, g.tag, g.created_at
    from gated g
    join public.profiles p on p.id = g.user_id
   order by g.created_at asc;
$$;

revoke all on function public.get_circle_vibe_votes(date) from public, anon, authenticated;
grant execute on function public.get_circle_vibe_votes(date) to authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   revoke all on function public.get_circle_vibe_votes(date) from authenticated;
--   drop function if exists public.get_circle_vibe_votes(date);
--   revoke all on function public.cast_vibe_vote(date, text) from authenticated;
--   drop function if exists public.cast_vibe_vote(date, text);
--   drop policy if exists vibe_votes_delete_own on public.vibe_votes;
--   drop table if exists public.vibe_votes;
------------------------------------------------------------------------------
