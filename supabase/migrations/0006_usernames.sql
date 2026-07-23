-- Next Bar — 0006 unique usernames (B2)
--
-- What this does:
--   1. profiles.handle_normalized — generated column lower(handle) with a
--      UNIQUE index, so uniqueness is case-insensitive while the stored
--      `handle` keeps the casing the user typed (display casing).
--   2. handle_claim_attempts — tiny counter table backing the claim rate
--      cap (max 10 claim attempts per user per day). RLS on, no policies:
--      only the SECURITY DEFINER function below touches it.
--   3. claim_handle(desired) RPC — atomic, rate-capped username claim.
--      NO RENAMES in v1: the claim succeeds only when the caller's handle
--      is currently NULL or already equals the normalized form (which
--      permits fixing display casing, e.g. "connorf" -> "ConnorF").
--      Unique-violation (lost race / already taken) returns NULL — the
--      caller treats NULL as "taken, try another".
--   4. search_handles(query) RPC — the ONLY public read surface over
--      profiles (there is deliberately no table-level public SELECT
--      policy — enumeration guard). Returns handle + display_name only,
--      public (is_private = false) rows only, prefix match, LIMIT 10.
--   5. is_private default flips true -> false (operator decision recorded
--      in BLUEPRINT-beta-enterprise-2026-07-23 §B2: discoverable handle /
--      display name by default; content visibility stays separately gated
--      by ratings RLS). Existing rows are flipped ONLY when still at true
--      AND handle IS NULL — those accounts predate any privacy choice
--      (the old `true` was just the default; there was no handle/privacy
--      UI), so they inherit the new default. The backfill runs once,
--      guarded by "column default is still true", because this runner
--      re-applies every migration file on each db:migrate.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. Case-insensitive uniqueness
------------------------------------------------------------------------------

alter table public.profiles
  add column if not exists handle_normalized text
    generated always as (lower(handle)) stored;

create unique index if not exists profiles_handle_normalized_key
  on public.profiles (handle_normalized);

------------------------------------------------------------------------------
-- 2. Claim-attempt counter (rate cap backing store)
------------------------------------------------------------------------------

create table if not exists public.handle_claim_attempts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);

-- RLS with no policies: unreachable from client roles; only the
-- SECURITY DEFINER claim function (owner) reads/writes it. Also revoke
-- from PUBLIC (DeepSeek review): a future blanket GRANT ... TO PUBLIC
-- must not silently re-expose the rate-cap backing store.
alter table public.handle_claim_attempts enable row level security;
revoke all on table public.handle_claim_attempts from public, anon, authenticated;

-- Search-attempt counter (DeepSeek review): without a cap, an authenticated
-- account could walk prefixes and scrape the whole public directory.
create table if not exists public.handle_search_attempts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);
alter table public.handle_search_attempts enable row level security;
revoke all on table public.handle_search_attempts from public, anon, authenticated;

------------------------------------------------------------------------------
-- 2b. Handle writes go through claim_handle ONLY (Opus review critical):
-- Supabase's default grants give `authenticated` table-level UPDATE on
-- profiles, and the 0001 owner-update RLS policy only checks the row —
-- so a signed-in user could PATCH profiles.handle directly, bypassing the
-- rate cap and the no-renames rule. Replace the table-level grant with
-- column-level UPDATE on the columns users may legitimately edit.
-- (handle_normalized is GENERATED — never directly writable anyway.)
------------------------------------------------------------------------------

revoke update on table public.profiles from public, anon, authenticated;
grant update (display_name, is_private) on table public.profiles to authenticated;

------------------------------------------------------------------------------
-- 3. claim_handle(desired) — atomic claim, rate-capped, no renames
------------------------------------------------------------------------------

create or replace function public.claim_handle(desired text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_cap constant integer := 10;  -- attempts per user per day
  uid uuid := auth.uid();
  normalized text := lower(desired);
  attempts integer;
begin
  if uid is null then
    return null;
  end if;

  -- Validate the NORMALIZED form: mixed-case input is fine, it just
  -- normalizes; anything outside [a-z0-9_]{3,20} after lowering is out.
  if normalized is null or normalized !~ '^[a-z0-9_]{3,20}$' then
    return null;
  end if;

  -- Rate cap: bump-then-check so every attempt (including rejected ones)
  -- counts. Old rows are tiny (1/user/day) — no cleanup needed yet.
  insert into public.handle_claim_attempts as a (user_id, day, count)
  values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = a.count + 1
  returning count into attempts;

  if attempts > claim_cap then
    return null;
  end if;

  -- Inner block so a unique_violation rolls back ONLY the update — the
  -- attempt bump above must survive (otherwise hammering a taken name
  -- would never consume the cap).
  begin
    update public.profiles
       set handle = desired
     where id = uid
       and (handle is null or lower(handle) = normalized);

    if not found then
      -- Caller already owns a DIFFERENT handle — renames are v1-excluded.
      return null;
    end if;
  exception
    when unique_violation then
      -- Taken (or lost the race). Caller treats null as "taken".
      return null;
    when others then
      -- ANY other failure (timeout, future trigger, deadlock) must not
      -- refund the attempt bump by escaping the function and rolling the
      -- whole transaction back (DeepSeek review).
      return null;
  end;

  return desired;
end;
$$;

revoke all on function public.claim_handle(text) from public, anon;
grant execute on function public.claim_handle(text) to authenticated;

------------------------------------------------------------------------------
-- 4. search_handles(query) — the only public read surface on profiles
------------------------------------------------------------------------------

-- Charset guard doubles as LIKE-injection guard: only [a-z0-9_] passes,
-- and `_` (a LIKE single-char wildcard, but a legal handle char) is
-- escaped so "a_c" can't match "abc". `%` never passes the guard.
-- Rate-capped (DeepSeek review): 500 searches/user/day — generous for a
-- human, hostile to directory scraping. plpgsql+volatile because the
-- bump writes.
create or replace function public.search_handles(query text)
returns table (handle text, display_name text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  search_cap constant integer := 500;  -- searches per user per day
  uid uuid := auth.uid();
  attempts integer;
begin
  if uid is null then
    return;
  end if;
  if lower(coalesce(query, '')) !~ '^[a-z0-9_]{1,20}$' then
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
  select p.handle, p.display_name
    from public.profiles p
   where p.is_private = false
     and p.handle_normalized like replace(lower(query), '_', '\_') || '%' escape '\'
   order by p.handle_normalized
   limit 10;
end;
$$;

revoke all on function public.search_handles(text) from public, anon;
grant execute on function public.search_handles(text) to authenticated;

------------------------------------------------------------------------------
-- 5. is_private default flip (backfill first, one-shot; then the default)
------------------------------------------------------------------------------

do $$
declare
  current_default text;
begin
  select column_default into current_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'profiles'
     and column_name = 'is_private';

  -- Only on the FIRST application (default still true): re-runs must not
  -- flip a user who later chose private back to public. Matching is over
  -- the textual default's variants (DeepSeek review) — and a non-match
  -- fails SAFE: the backfill is skipped, never re-run.
  if lower(replace(replace(coalesce(current_default, ''), '(', ''), ')', '')) = 'true' then
    update public.profiles
       set is_private = false
     where is_private = true
       and handle is null;
  end if;
end;
$$;

alter table public.profiles alter column is_private set default false;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   grant update on table public.profiles to authenticated;  -- restore default grant
--   drop table if exists public.handle_search_attempts;
--   alter table public.profiles alter column is_private set default true;
--   revoke all on function public.search_handles(text) from authenticated;
--   drop function if exists public.search_handles(text);
--   revoke all on function public.claim_handle(text) from authenticated;
--   drop function if exists public.claim_handle(text);
--   drop table if exists public.handle_claim_attempts;
--   drop index if exists public.profiles_handle_normalized_key;
--   alter table public.profiles drop column if exists handle_normalized;
------------------------------------------------------------------------------
