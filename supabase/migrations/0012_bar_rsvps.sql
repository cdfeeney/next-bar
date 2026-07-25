-- Next Bar — 0012 RSVPs ("I'm in" on tonight's suggestions)
--
-- Operator request 2026-07-24: circle members signal they're IN for a
-- suggested bar tonight. Night-scoped like 0011's suggestions (client
-- computes the NYC 6am-rollover night key; server bounds it to ±2 days).
--
-- MOVE SEMANTICS (product decision): you are only ever "in" at ONE bar
-- per night — rsvp_bar deletes the caller's other RSVPs for that night
-- before inserting, so tapping "I'm in" elsewhere moves you. Tapping
-- again on your current bar toggles you out via the own-row DELETE.
--
--   1. bar_rsvps — (user_id, bar_id, night). Same RLS stance as 0011:
--      own-row DELETE only; INSERT via the RPC; NO table-level SELECT
--      (reads go through the circle-scoped definer).
--
--   2. rsvp_bar(bar, night) RPC — advisory-lock serialized per user
--      (0011 pattern), delete-then-insert move.
--
--   3. get_circle_rsvps(night) — definer read: own + followed users.
--
--      ⚠ HARD SECURITY BOUNDARY (0007/0010/0011 lesson): the WHERE below
--      — own rows OR follower_id = auth.uid() edges — is the ONLY thing
--      between this definer join and a public RSVP firehose. Never edit
--      the predicate without a test.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. Table
------------------------------------------------------------------------------

create table if not exists public.bar_rsvps (
  user_id uuid not null references public.profiles(id) on delete cascade,
  bar_id text not null,
  night date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, bar_id, night)
);

create index if not exists bar_rsvps_night_idx
  on public.bar_rsvps (night, user_id);

-- The single-RSVP-per-night product rule, DECLARATIVELY (Opus 0012
-- review): rsvp_bar's advisory lock + delete-then-insert enforce it
-- procedurally, but only this unique index makes a future second write
-- path fail LOUDLY instead of silently leaving a user in at two bars.
create unique index if not exists bar_rsvps_one_per_night
  on public.bar_rsvps (user_id, night);

alter table public.bar_rsvps enable row level security;
revoke all on table public.bar_rsvps from public, anon, authenticated;

grant delete on table public.bar_rsvps to authenticated;
drop policy if exists bar_rsvps_delete_own on public.bar_rsvps;
create policy bar_rsvps_delete_own on public.bar_rsvps
  for delete to authenticated
  using (user_id = auth.uid());

------------------------------------------------------------------------------
-- 2. rsvp_bar(bar, night) — single-RSVP move
------------------------------------------------------------------------------

create or replace function public.rsvp_bar(bar text, night date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or bar is null or night is null then
    return false;
  end if;
  if night < (current_date - 2) or night > (current_date + 2) then
    return false;
  end if;
  if bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;

  -- Serialize this user's RSVP writes (0011 pattern): without it, two
  -- parallel rsvp calls could each delete-the-others then both insert,
  -- leaving the user "in" at two bars.
  perform pg_advisory_xact_lock(hashtextextended('bar_rsvps:' || uid::text, 0));

  -- MOVE: one RSVP per night. Deleting first also makes re-tapping the
  -- same bar idempotent (delete own row, re-insert it).
  delete from public.bar_rsvps r
   where r.user_id = uid
     and r.night = rsvp_bar.night;

  insert into public.bar_rsvps (user_id, bar_id, night)
  values (uid, bar, night)
  -- ON CONSTRAINT, not a column list (2026-07-25 prod fix — same 42702
  -- `night` param/column ambiguity as 0011's suggest_bar; see there).
  on conflict on constraint bar_rsvps_pkey do nothing;
  return true;
end;
$$;

revoke all on function public.rsvp_bar(text, date) from public, anon;
grant execute on function public.rsvp_bar(text, date) to authenticated;

------------------------------------------------------------------------------
-- 3. get_circle_rsvps(night) — own + followed users' RSVPs
------------------------------------------------------------------------------

create or replace function public.get_circle_rsvps(night date)
returns table (user_id uuid, handle text, display_name text, bar_id text)
language sql
stable
security definer
set search_path = public
as $$
  select r.user_id, p.handle, p.display_name, r.bar_id
    from public.bar_rsvps r
    join public.profiles p on p.id = r.user_id
   where r.night = get_circle_rsvps.night
     and (
       r.user_id = auth.uid()
       or r.user_id in (
         select f.followee_id from public.follows f
          where f.follower_id = auth.uid()
       )
     )
   order by r.created_at asc;
$$;

revoke all on function public.get_circle_rsvps(date) from public, anon;
grant execute on function public.get_circle_rsvps(date) to authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   revoke all on function public.get_circle_rsvps(date) from authenticated;
--   drop function if exists public.get_circle_rsvps(date);
--   revoke all on function public.rsvp_bar(text, date) from authenticated;
--   drop function if exists public.rsvp_bar(text, date);
--   drop policy if exists bar_rsvps_delete_own on public.bar_rsvps;
--   drop index if exists public.bar_rsvps_one_per_night;
--   drop table if exists public.bar_rsvps;
------------------------------------------------------------------------------
