-- Next Bar — 0011 bar suggestions ("Where should we go?" nominations)
--
-- Operator request 2026-07-24: people should be able to SUGGEST specific
-- bars into the consensus flow, not just receive algorithmic consensus.
--
-- Model: a suggestion is night-scoped ("tonight I propose X") — keyed by a
-- client-computed NYC night date (6am rollover, computed in
-- src/lib/nightKey.ts; the server treats it as an opaque date key and only
-- bounds it to ±2 days of now() so a bad clock can't seed far-future rows).
--
--   1. bar_suggestions — (user_id, bar_id, night) rows. bar_id is a
--      catalog id (catalog lives in code — no FK; unknown ids are simply
--      never rendered). RLS: own-row DELETE only; INSERT goes through the
--      cap-enforcing RPC; SELECT goes through the circle-scoped definer
--      read (no table-level SELECT — same enumeration stance as profiles).
--
--   2. suggest_bar(bar, night) RPC — capped at 3 live suggestions per
--      user per night (idempotent re-suggest doesn't spend the cap).
--
--   3. get_circle_suggestions(night) — definer read returning the
--      caller's own suggestions + those of people the CALLER FOLLOWS
--      (same edge direction get_friend_ratings gates on).
--
--      ⚠ HARD SECURITY BOUNDARY (0007/0010 lesson): the WHERE below —
--      own rows OR follower_id = auth.uid() edges — is the ONLY thing
--      between this definer join and a public suggestions firehose.
--      Never edit the predicate without a test.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. Table
------------------------------------------------------------------------------

create table if not exists public.bar_suggestions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  bar_id text not null,
  night date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, bar_id, night)
);

create index if not exists bar_suggestions_night_idx
  on public.bar_suggestions (night, user_id);

alter table public.bar_suggestions enable row level security;
revoke all on table public.bar_suggestions from public, anon, authenticated;

-- Own-row delete ("un-suggest") is the only direct table access.
grant delete on table public.bar_suggestions to authenticated;
drop policy if exists bar_suggestions_delete_own on public.bar_suggestions;
create policy bar_suggestions_delete_own on public.bar_suggestions
  for delete to authenticated
  using (user_id = auth.uid());

------------------------------------------------------------------------------
-- 2. suggest_bar(bar, night) — capped insert
------------------------------------------------------------------------------

create or replace function public.suggest_bar(bar text, night date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  suggestion_cap constant integer := 3;  -- live suggestions per night
  uid uuid := auth.uid();
  live integer;
begin
  if uid is null or bar is null or night is null then
    return false;
  end if;
  -- Opaque-key sanity bound: a suggestion is for tonight-ish, never a
  -- far-future or ancient date (client clock skew tolerance: ±2 days).
  if night < (current_date - 2) or night > (current_date + 2) then
    return false;
  end if;
  -- Catalog ids are kebab-case; bound length + charset so the table can't
  -- accumulate junk keys.
  if bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;

  -- Idempotent re-suggest: never spends the cap.
  if exists (
    select 1 from public.bar_suggestions
     where user_id = uid and bar_id = bar and bar_suggestions.night = suggest_bar.night
  ) then
    return true;
  end if;

  -- Per-user serialization (Opus + DeepSeek 0011 reviews): the count/
  -- insert pair below is check-then-act, so without this two PARALLEL
  -- suggests for different bars could race past the cap (3 → 4). The
  -- xact-scoped advisory lock serializes one user's suggests without
  -- touching anyone else's throughput; released automatically at commit.
  perform pg_advisory_xact_lock(hashtextextended('bar_suggestions:' || uid::text, 0));

  select count(*) into live
    from public.bar_suggestions s
   where s.user_id = uid and s.night = suggest_bar.night;
  if live >= suggestion_cap then
    return false;
  end if;

  insert into public.bar_suggestions (user_id, bar_id, night)
  values (uid, bar, night)
  -- ON CONSTRAINT, not a column list (2026-07-25 prod fix): plpgsql
  -- parses a conflict-target column list as expressions over the table,
  -- where `night` is BOTH a column and this function's parameter →
  -- 42702 "column reference night is ambiguous" at first execution.
  -- Broke every suggest in prod; invisible to the stubbed e2e suite.
  on conflict on constraint bar_suggestions_pkey do nothing;
  return true;
end;
$$;

revoke all on function public.suggest_bar(text, date) from public, anon;
grant execute on function public.suggest_bar(text, date) to authenticated;

------------------------------------------------------------------------------
-- 3. get_circle_suggestions(night) — own + followed users' suggestions
------------------------------------------------------------------------------

create or replace function public.get_circle_suggestions(night date)
returns table (user_id uuid, handle text, display_name text, bar_id text)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, p.handle, p.display_name, s.bar_id
    from public.bar_suggestions s
    join public.profiles p on p.id = s.user_id
   where s.night = get_circle_suggestions.night
     and (
       s.user_id = auth.uid()
       or s.user_id in (
         select f.followee_id from public.follows f
          where f.follower_id = auth.uid()
       )
     )
   order by s.created_at asc;
$$;

revoke all on function public.get_circle_suggestions(date) from public, anon;
grant execute on function public.get_circle_suggestions(date) to authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   revoke all on function public.get_circle_suggestions(date) from authenticated;
--   drop function if exists public.get_circle_suggestions(date);
--   revoke all on function public.suggest_bar(text, date) from authenticated;
--   drop function if exists public.suggest_bar(text, date);
--   drop policy if exists bar_suggestions_delete_own on public.bar_suggestions;
--   drop table if exists public.bar_suggestions;
------------------------------------------------------------------------------
