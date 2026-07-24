-- Next Bar — 0010 followers + follower count (B3c)
--
-- Operator request 2026-07-25: a real friends list. Two definer reads:
--
--   1. get_followers() — the caller's OWN followers, handle-resolved
--      (profiles has no client SELECT — 0006 enumeration guard). Mirror of
--      get_following(); no rate cap (own rows only).
--
--      ⚠ HARD SECURITY BOUNDARY (0007 lesson): the WHERE
--      f.followee_id = auth.uid() below is the ONLY thing between this
--      definer join and full-directory exposure. Never edit the predicate
--      without a test.
--
--   2. get_follower_count(profile_id) — ONE integer, for any profile.
--      Counts are safe where lists are not (blueprint B3c privacy note),
--      but a uuid-probe loop is still the enumeration surface, so it
--      shares the handle_search_attempts counter (0006/0007 pattern:
--      500/user/day across handle resolution + this).
--      Visibility rule enforced HERE, not client-side: returns the count
--      for PUBLIC profiles and for private profiles the CALLER FOLLOWS;
--      other private profiles (and unknown uuids) return NULL —
--      indistinguishable, so the count endpoint is not a privacy oracle
--      beyond what follow_user already exposes (accepted surface, 0008).
--
--      GROWTH TUNING NOTE (DeepSeek 0010 review, accepted for beta): the
--      shared 500/day cap means heavy legitimate profile-browsing spends
--      the same budget as handle search (~2 units per /u view). At scale,
--      either give counts their own higher counter or stop re-spending
--      when the caller just resolved the same profile. The ±1 concurrent
--      overshoot and the sub-noise timing delta between unknown/hidden
--      paths are accepted (both below the follow_user surface).
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. get_followers()
------------------------------------------------------------------------------

create or replace function public.get_followers()
returns table (id uuid, handle text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.handle, p.display_name
    from public.follows f
    join public.profiles p on p.id = f.follower_id
   where f.followee_id = auth.uid()
   order by lower(coalesce(p.handle, '')) asc;
$$;

revoke all on function public.get_followers() from public, anon;
grant execute on function public.get_followers() to authenticated;

------------------------------------------------------------------------------
-- 2. get_follower_count(profile_id)
------------------------------------------------------------------------------

create or replace function public.get_follower_count(profile_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  search_cap constant integer := 500;  -- shared with handle search (0006/0007)
  uid uuid := auth.uid();
  attempts integer;
  target_private boolean;
begin
  if uid is null or profile_id is null then
    return null;
  end if;

  -- Own count is free (no cap spend, no visibility gate).
  if profile_id = uid then
    return (
      select count(*)::integer from public.follows f
       where f.followee_id = uid
    );
  end if;

  insert into public.handle_search_attempts as a (user_id, day, count)
  values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = a.count + 1
  returning count into attempts;

  if attempts > search_cap then
    return null;
  end if;

  select p.is_private into target_private
    from public.profiles p
   where p.id = profile_id;

  -- Unknown profile and hidden private profile are the SAME null.
  if target_private is null then
    return null;
  end if;
  if target_private and not exists (
    select 1 from public.follows f
     where f.follower_id = uid and f.followee_id = profile_id
  ) then
    return null;
  end if;

  return (
    select count(*)::integer from public.follows f
     where f.followee_id = profile_id
  );
end;
$$;

revoke all on function public.get_follower_count(uuid) from public, anon;
grant execute on function public.get_follower_count(uuid) to authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   revoke all on function public.get_follower_count(uuid) from authenticated;
--   drop function if exists public.get_follower_count(uuid);
--   revoke all on function public.get_followers() from authenticated;
--   drop function if exists public.get_followers();
------------------------------------------------------------------------------
