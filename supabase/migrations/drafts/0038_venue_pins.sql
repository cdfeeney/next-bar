-- Next Bar — 0038 venue pins ("Pin where I am" — g-31f36bf8) — DRAFT
--
-- ⚠ NEVER-APPLIED DRAFT (overnight 2026-08-04). Lives in drafts/ — the
-- migration runner reads only top-level supabase/migrations/*.sql, so
-- this file is inert until an ATTENDED session promotes it one directory
-- up under the number assigned by
-- docs/MIGRATION-PLAN-RECONCILIATION-2026-08-04.md (0038 = venue pins;
-- 0039 = social Phase B list_my_shared_nights + close friends;
-- 0040 = night photos). Do not apply anywhere tonight.
--
-- WHY A NEW TABLE, NOT bar_rsvps (criterion 18 audit):
--   bar_rsvps reads go through get_circle_rsvps (0012), whose audience
--   is "own rows OR any user the caller FOLLOWS" — one-directional.
--   A pin is live presence ("I am physically AT this bar"), a strictly
--   more sensitive signal than an RSVP plan, and its audience must be
--   MUTUAL follows only (criteria 14–15). Widening/reusing the RSVP
--   surface would either leak presence to non-mutual followers or
--   silently change RSVP visibility. Additive hardening instead: a new
--   table + mutual-scoped definer read; NOTHING in 0012–0014 changes.
--
-- PRIVACY INVARIANTS (criteria 4–5):
--   - NO coordinate columns exist. The client may use on-device
--     geolocation to RANK nearby catalog bars, but the only thing that
--     ever reaches the server is a catalog bar_id + night key.
--   - Presence expires at 6:00 AM America/New_York (the canonical
--     social-night end — src/lib/socialNight.ts) and the definer read
--     enforces the expiry SERVER-side: an old night's rows are
--     unreadable even if a client asks for them.
--
--   1. venue_pins — (user_id, night) PK: ONE active pin per user/night
--      declaratively (criterion 7); pinning elsewhere MOVES the pin
--      (criterion 8) via upsert. on delete cascade from profiles keeps
--      account deletion complete (criterion 17).
--
--   2. pin_venue(bar, night) / unpin_venue(night) RPCs — the ONLY write
--      paths (no table grants at all). Advisory-lock serialized per user
--      (0012/0013 lesson) so cross-tab pin/unpin cannot interleave.
--
--   3. get_friend_pins(night) — definer read: own pin + MUTUAL friends'
--      pins, expiry-bounded.
--
--      ⚠ HARD SECURITY BOUNDARY (0007/0011/0012 lesson): the WHERE
--      below — own rows OR a BIDIRECTIONAL follows edge — is the ONLY
--      thing between this definer join and a public presence firehose.
--      Never edit the predicate without a test. The gated CTE is
--      MATERIALIZED (0007 get_friend_ratings lesson: leakproof-operator
--      pushdown would otherwise open a timing side-channel probing
--      whether an unfollowed user has a pin).
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. Table
------------------------------------------------------------------------------

create table if not exists public.venue_pins (
  user_id uuid not null references public.profiles(id) on delete cascade,
  bar_id text not null,
  night date not null,
  pinned_at timestamptz not null default now(),
  primary key (user_id, night)
);

create index if not exists venue_pins_night_idx
  on public.venue_pins (night, user_id);

alter table public.venue_pins enable row level security;
-- NO table grants for client roles at all: reads go through the mutual
-- definer, writes through the two RPCs. (bar_rsvps needed a transitional
-- own-row DELETE grant; pins launch RPC-only from day one.)
revoke all on table public.venue_pins from public, anon, authenticated;

------------------------------------------------------------------------------
-- 2a. pin_venue(bar, night) — upsert-move, serialized per user
------------------------------------------------------------------------------

create or replace function public.pin_venue(bar text, night date)
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
  -- Same ±2-day sanity bound as rsvp_bar (0012): the client computes the
  -- NYC night key; the server only bounds it.
  if night < (current_date - 2) or night > (current_date + 2) then
    return false;
  end if;
  if bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;
  -- A pin for an ALREADY-ENDED night must not be creatable: 6:00 AM
  -- America/New_York on the morning after `night` is the expiry instant
  -- (criterion 10; mirrors the read-side bound in get_friend_pins).
  if now() >= timezone('America/New_York',
               (night + 1)::timestamp + interval '6 hours') then
    return false;
  end if;

  -- Serialize this user's pin writes (0012/0013 pattern): without it,
  -- parallel pin/unpin calls interleave and the last TAP no longer wins.
  perform pg_advisory_xact_lock(hashtextextended('venue_pins:' || uid::text, 0));

  -- MOVE semantics (criterion 8): (user_id, night) is the PK, so pinning
  -- a different bar the same night REPLACES the row; re-pinning the same
  -- bar refreshes pinned_at (harmless, keeps freshness honest).
  insert into public.venue_pins (user_id, bar_id, night)
  values (uid, bar, night)
  -- ON CONSTRAINT, not a column list (0011/0012 lesson: 42702 `night`
  -- param/column ambiguity).
  on conflict on constraint venue_pins_pkey
  do update set bar_id = excluded.bar_id, pinned_at = now();
  return true;
end;
$$;

revoke all on function public.pin_venue(text, date) from public, anon;
grant execute on function public.pin_venue(text, date) to authenticated;

------------------------------------------------------------------------------
-- 2b. unpin_venue(night) — serialized withdrawal
------------------------------------------------------------------------------

create or replace function public.unpin_venue(night date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or night is null then
    return false;
  end if;
  if night < (current_date - 2) or night > (current_date + 2) then
    return false;
  end if;

  -- Same lock key as pin_venue: every pin write for a user serializes
  -- through one advisory lock (0013 lesson — an unserialized delete
  -- races the upsert across tabs).
  perform pg_advisory_xact_lock(hashtextextended('venue_pins:' || uid::text, 0));

  delete from public.venue_pins v
   where v.user_id = uid
     and v.night = unpin_venue.night;

  -- True even when no row matched: "unpin" of an absent pin is a
  -- satisfied request (0013 convention — false is a SHOWN client error).
  return true;
end;
$$;

revoke all on function public.unpin_venue(date) from public, anon;
grant execute on function public.unpin_venue(date) to authenticated;

------------------------------------------------------------------------------
-- 3. get_friend_pins(night) — own + MUTUAL friends' pins, expiry-bounded
------------------------------------------------------------------------------

create or replace function public.get_friend_pins(night date)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  bar_id text,
  pinned_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with gated as materialized (
    select v.user_id, v.bar_id, v.night, v.pinned_at
      from public.venue_pins v
     where v.night = get_friend_pins.night
       -- SERVER-side 6:00 AM America/New_York expiry (criterion 10):
       -- once the night has ended, its pins are unreadable no matter
       -- what night value the client asks for.
       and now() < timezone('America/New_York',
                     (v.night + 1)::timestamp + interval '6 hours')
       and (
         v.user_id = auth.uid()
         -- MUTUAL edge required (criteria 14–15): BOTH directions must
         -- exist. A one-way follower — the get_circle_rsvps audience —
         -- is NOT enough for live presence.
         or (
           exists (
             select 1 from public.follows f
              where f.follower_id = auth.uid()
                and f.followee_id = v.user_id
           )
           and exists (
             select 1 from public.follows f2
              where f2.follower_id = v.user_id
                and f2.followee_id = auth.uid()
           )
         )
       )
  )
  select g.user_id, p.handle, p.display_name, g.bar_id, g.pinned_at
    from gated g
    join public.profiles p on p.id = g.user_id
   order by g.pinned_at desc;
$$;

revoke all on function public.get_friend_pins(date) from public, anon;
grant execute on function public.get_friend_pins(date) to authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   revoke all on function public.get_friend_pins(date) from authenticated;
--   drop function if exists public.get_friend_pins(date);
--   revoke all on function public.unpin_venue(date) from authenticated;
--   drop function if exists public.unpin_venue(date);
--   revoke all on function public.pin_venue(text, date) from authenticated;
--   drop function if exists public.pin_venue(text, date);
--   drop table if exists public.venue_pins;
------------------------------------------------------------------------------
