------------------------------------------------------------------------------
-- 0068_nightout_media_presence.sql — the 4:00 AM night, manual presence pins,
--                                    and the retirement of the legacy Shared
--                                    Night surface
------------------------------------------------------------------------------
-- ⚠ AUTHOR-ONLY. Committed unapplied. A migration file in this repository is
-- NOT applied anywhere until the target project's `public.schema_migrations`
-- ledger says so, and this branch's `npm run db:migrate` is ledger-BLIND. Do
-- not run it against a shared database.
--
-- Additive and forward-only. Nothing here rewrites an applied file: 0011,
-- 0012, 0016, 0017, 0053 and 0060 keep their bodies and their comments as the
-- historical record of what actually happened.
--
-- Idempotent: create table / index if not exists + create or replace +
-- drop policy if exists + drop function if exists + revoke-first grants.
-- Safe to re-run.
--
-- ============================================================================
-- SECTION 1 — the night boundary is 4:00 AM AMERICA/NEW_YORK
-- SECTION 2 — retire the legacy Shared Night surface (EC-04)
-- SECTION 3 — night_presence: manual, bar-level, no GPS, expires at 4:00 AM
-- SECTION 4 — recorded product decision: preview_night_out and blocks (EC-05)
-- ============================================================================


------------------------------------------------------------------------------
-- 1. public.nyc_night_key — 6 hours becomes 4 hours
------------------------------------------------------------------------------
-- V8 contract 3.1.0, V8-R-PRE-005 (decision D-C-39): "The 4:00 AM boundary is
-- evaluated in AMERICA/NEW_YORK using the existing DST-aware night-key
-- convention, never in UTC." V8-R-PRE-001 and V8-R-PRE-004 hold a presence pin
-- until 4:00 AM.
--
-- 0053 created this function with a SIX-hour offset. That sweep was right about
-- the ZONE — it replaced a UTC `current_date` comparison that marked tonight's
-- invitation expired from 8pm onward — and the hour it happened to carry was
-- later resolved by the founder to 4:00 AM. 0053 is NOT edited: it stays as the
-- record of the zone fix, and this file supersedes the function body.
--
-- Replacing the body is sufficient for the entire database side. 0054, 0059 and
-- 0060 all CALL public.nyc_night_key() rather than inlining the arithmetic, so
-- none of them needs editing and none may be rewritten.
--
-- `at time zone` resolves DST correctly, so the boundary is 08:00Z in EDT and
-- 09:00Z in EST — the two instants the client suite pins to the minute.
-- Signature, return type and volatility are unchanged, so `create or replace`
-- is legal; the revoke/grant pair is re-issued to match the house convention
-- and keep the file re-runnable.

create or replace function public.nyc_night_key(p_at timestamptz default now())
returns date
language sql
immutable
as $$
  select (((p_at at time zone 'America/New_York') - interval '4 hours'))::date
$$;

comment on function public.nyc_night_key(timestamptz) is
  'The current NYC night as a date, with a 4:00 AM rollover (V8 contract '
  '3.1.0, V8-R-PRE-005 / D-C-39). Mirrors nycNightKey() in '
  'src/lib/nightKey.ts, which exports NIGHT_ROLLOVER_HOUR = 4. Any comparison '
  'meaning "which night is it" uses this, never current_date, which is UTC and '
  'rolls over mid-evening in New York. Superseded 0053''s 6-hour body; neither '
  '5:00 nor 6:00 is authoritative anywhere any more.';

revoke all on function public.nyc_night_key(timestamptz) from public, anon, authenticated;
grant execute on function public.nyc_night_key(timestamptz) to authenticated;


------------------------------------------------------------------------------
-- 2. Retire the legacy Shared Night surface (EC-04, founder decision)
------------------------------------------------------------------------------
-- `public.get_shared_night(p_token uuid)` is a SECURITY DEFINER function with a
-- LIVE **anon** EXECUTE grant (0016) that returns another account's `handle`,
-- `display_name` and a `loved_bar_id` — the legacy Loved / Liked / Pass tier.
--
-- The founder-approved 3.1.0 ledger contains ZERO occurrences of
-- `shared_night`, `share_night`, `loved_bar_id` or "share token" as a product
-- concept, and V8-R-RNK-001 excludes tiers from the V8 model as "legacy
-- implementation concepts". No replacement — tier or numeric — is approved.
-- The surface is retired rather than migrated.
--
-- DO NOT CONFLATE THIS WITH TWO THINGS THAT STAY:
--   * Saved Nights Out (V8-R-NO-009, V8-R-ACC-002) is an approved PRIVATE
--     in-app archive. It is not a public share link and shares no code path
--     with this function.
--   * public.preview_night_out (0044) is the approved bearer-token invite
--     preview (V8-R-INV-001/002). It is anon-executable BY DESIGN. See
--     section 4.
--
-- Forward retirement, the way WP1's 0066 retired get_public_ratings. DROP is
-- the whole act: dropping a function removes its grants with it, so there is no
-- revoke-first step to perform here — the revoke-first convention exists to
-- preserve ACLs across `create or replace`, which is the opposite of this.
-- `drop function if exists` makes the file re-runnable; a second run is a
-- no-op rather than a 42883.
--
-- The `public.shared_nights` TABLE is deliberately left in place. Dropping it
-- destroys rows, and a destructive decision belongs to an attended window, not
-- to a lane migration. With every RPC gone and direct grants already revoked by
-- 0016, the table is unreachable from anon and authenticated alike: retiring
-- the surface does not require deleting the data.

drop function if exists public.get_shared_night(uuid);
drop function if exists public.share_night(date, text[], text);
drop function if exists public.unshare_night(date);

-- Guarded so this file is re-runnable against a database that never applied
-- 0016: `comment on` has no IF EXISTS form and would abort the migration.
do $$
begin
  if to_regclass('public.shared_nights') is not null then
    comment on table public.shared_nights is
      'RETIRED (0068, EC-04). The legacy Shared Night link is not part of the '
      'V8 product model: its read RPC was anon-executable and returned another '
      'account''s handle, display name and legacy loved_bar_id tier. '
      'share_night, unshare_night and get_shared_night are dropped; no RPC '
      'reaches this table and no direct grant exists. Rows are retained '
      'deliberately — deleting them is a destructive decision for an attended '
      'window. Do NOT add a new reader.';
  end if;
end
$$;


------------------------------------------------------------------------------
-- 3. night_presence — manual, bar-level, no GPS, expires at 4:00 AM
------------------------------------------------------------------------------
-- V8-R-PRE-001: "A presence pin is manual, bar-level, has no GPS, and expires
-- at 4:00 AM." V8-R-PRE-004: presence is exactly Going out / Maybe later / Not
-- going out, and a pin sets Going out. V8-R-PRE-002: the pinner chooses who
-- sees it. V8-R-SOC-001: every status is manual and attributed to a PERSON,
-- never to a device, and nobody is described by an invented venue.
--
-- EXPIRY IS STRUCTURAL, NOT SCHEDULED. Every row is keyed on the night it
-- belongs to and every read filters `night = public.nyc_night_key()`. When the
-- clock passes 4:00 AM New York the key changes and last night's rows stop
-- matching — no cron, no sweeper, and nothing that can fall behind and leak a
-- stale pin. It also means the expiry cannot drift away from the client's: both
-- sides resolve the same boundary from the same definition.
--
-- NO GPS, structurally: there is no latitude, longitude, accuracy or device
-- column here, and bar_id is a catalog id the user picked. The schema cannot
-- store a device-derived location, so "manual" is not a convention a later
-- writer can quietly break.
--
-- Pattern is 0044's, deliberately: RLS on, direct grants revoked, SECURITY
-- DEFINER RPCs as the entire surface, p_-prefixed params, ON CONFLICT ON
-- CONSTRAINT, and a MATERIALIZED fence on the definer read.

create table if not exists public.night_presence (
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  night      date        not null,
  status     text        not null,
  bar_id     text        null,
  audience   text        not null default 'friends',
  updated_at timestamptz not null default now(),
  constraint night_presence_pkey primary key (user_id, night),
  constraint night_presence_status_check
    check (status in ('going', 'maybe', 'not-going')),
  constraint night_presence_audience_check
    check (audience in ('friends', 'close')),
  constraint night_presence_bar_check
    check (bar_id is null or bar_id ~ '^[a-z0-9-]{1,60}$'),
  -- V8-R-PRE-004: a pin sets Going out. The pair is enforced here rather than
  -- in the RPC alone, so no future writer can record "at a bar, not going out".
  constraint night_presence_pin_implies_going
    check (bar_id is null or status = 'going')
);

create index if not exists night_presence_night_idx
  on public.night_presence (night);

comment on table public.night_presence is
  'Manual, bar-level presence for ONE night (V8-R-PRE-001..005). No GPS: there '
  'is no location column and bar_id is a user-picked catalog id. Expiry is '
  'structural — rows are keyed on the night and every read filters on '
  'public.nyc_night_key(), so a pin stops being visible at 4:00 AM '
  'America/New_York with no scheduled job. Direct table grants are forbidden; '
  'the RPCs below are the entire surface.';

alter table public.night_presence enable row level security;
revoke all on table public.night_presence from public, anon, authenticated;

-- Own-row policy only. Reads by other accounts go through the definer RPC,
-- which applies the audience rule; no policy on this table reads follows, so
-- there is no policy cycle.
drop policy if exists night_presence_own_row on public.night_presence;
create policy night_presence_own_row on public.night_presence
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

------------------------------------------------------------------------------
-- 3a. set_night_presence — the only writer
------------------------------------------------------------------------------
-- Writes TONIGHT's row and no other. The night is resolved server-side from
-- public.nyc_night_key(), never taken from the caller: a client clock that is
-- wrong (or lying) must not be able to write a pin into a different night.

create or replace function public.set_night_presence(
  p_status   text,
  p_bar_id   text default null,
  p_audience text default 'friends'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_status is null or p_status not in ('going', 'maybe', 'not-going') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_audience is null or p_audience not in ('friends', 'close') then
    raise exception 'invalid audience' using errcode = '22023';
  end if;
  -- A pin is only meaningful alongside Going out (V8-R-PRE-004). Rejected at
  -- the boundary rather than silently coerced, because a caller that asked for
  -- "maybe, at this bar" has a bug and should be told.
  if p_bar_id is not null and p_status <> 'going' then
    raise exception 'a pinned bar requires status going' using errcode = '22023';
  end if;
  if p_bar_id is not null and p_bar_id !~ '^[a-z0-9-]{1,60}$' then
    raise exception 'invalid bar id' using errcode = '22023';
  end if;

  insert into public.night_presence (user_id, night, status, bar_id, audience)
  values (v_uid, public.nyc_night_key(), p_status, p_bar_id, p_audience)
  on conflict on constraint night_presence_pkey
  do update set
    status     = excluded.status,
    bar_id     = excluded.bar_id,
    audience   = excluded.audience,
    updated_at = now();

  return true;
end;
$$;

revoke all on function public.set_night_presence(text, text, text) from public, anon, authenticated;
grant execute on function public.set_night_presence(text, text, text) to authenticated;

------------------------------------------------------------------------------
-- 3b. clear_night_presence — tapping the pinned row again to clear it
------------------------------------------------------------------------------
-- V8-R-PRE-005: "Tapping the row again re-enters the same sequence to change or
-- clear the pin." Clearing removes tonight's row entirely rather than writing a
-- tombstone — an absent row is exactly "no status tonight", which is also what
-- the 4:00 AM boundary produces.

create or replace function public.clear_night_presence()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  delete from public.night_presence
   where user_id = v_uid
     and night = public.nyc_night_key();
  return true;
end;
$$;

revoke all on function public.clear_night_presence() from public, anon, authenticated;
grant execute on function public.clear_night_presence() to authenticated;

------------------------------------------------------------------------------
-- 3c. get_circle_presence — the audience rule, enforced on the server
------------------------------------------------------------------------------
-- V8-R-SOC-001: the Tonight list is "server-enforced per pin". The audience is
-- applied HERE, not in the client, because a client-side filter is a display
-- convention and this is an access rule.
--
--   'friends' — visible to anyone the pinner is followed BY (the pinner's
--               followers are the people who asked to see their nights).
--   'close'   — visible only on a MUTUAL follow.
--
-- Never returns the caller's own row: the caller already has it, and mixing it
-- into "who else is out" is how a surface ends up telling you about yourself.
--
-- MATERIALIZED fence (0007/0015 rationale): without it the planner may inline a
-- cheap caller-supplied predicate ahead of the audience check on a definer
-- read. There is no caller-supplied predicate here today, and the fence is what
-- keeps that true if one is ever added.

create or replace function public.get_circle_presence()
returns table (
  -- PROFILE ID IS PART OF THE CONTRACT. The Stories rail keys its cells on the profile
  -- id and asks `pinnedIds.includes(id)`; a handle cannot answer that without a second
  -- lookup. Projecting it here is what lets the pin badge read presence — the founder
  -- decision of 2026-08-24 — instead of the suggestions table, whose audience model is
  -- weaker and whose night is client-supplied.
  user_id      uuid,
  handle       text,
  display_name text,
  status       text,
  bar_id       text,
  updated_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with visible as materialized (
    select np.user_id, np.status, np.bar_id, np.updated_at
      from public.night_presence np
     where np.night = public.nyc_night_key()
       and np.user_id <> auth.uid()
       -- The caller follows the pinner…
       and exists (
         select 1 from public.follows f
          where f.follower_id = auth.uid()
            and f.followee_id = np.user_id
       )
       -- …and 'close' additionally requires the follow to be mutual.
       and (
         np.audience = 'friends'
         or exists (
           select 1 from public.follows f2
            where f2.follower_id = np.user_id
              and f2.followee_id = auth.uid()
         )
       )
  )
  select v.user_id,
         p.handle::text,
         p.display_name::text,
         v.status,
         v.bar_id,
         v.updated_at
    from visible v
    join public.profiles p on p.id = v.user_id
   order by v.updated_at desc
$$;

revoke all on function public.get_circle_presence() from public, anon, authenticated;
grant execute on function public.get_circle_presence() to authenticated;


------------------------------------------------------------------------------
-- 4. RECORDED PRODUCT DECISION — preview_night_out and blocked accounts
------------------------------------------------------------------------------
-- A round-3 Codex review of WP1 candidate 2f032d20 found that
-- `public.preview_night_out(p_token uuid)` is not block-gated: an account the
-- owner has blocked, holding an invite token, can still read the owner's
-- handle, display name, night, title, status and accepted count.
--
-- DECISION (WP7, this file): **preview_night_out is NOT block-gated. Blocking
-- does not revoke a live invite token. Revoking the invite does.**
--
-- Three reasons, recorded so the next reader does not re-open it:
--
--  1. It would not enforce anything. preview_night_out is anon-executable BY
--     DESIGN — V8-R-INV-001 and V8-R-INV-002 require a token-scoped recipient
--     WITHOUT the app to view the plan and RSVP. A gate on the authenticated
--     path is defence in depth at best: the blocked account signs out and reads
--     the identical rows through the identical anon grant. Shipping it would
--     produce the APPEARANCE of enforcement with none of the substance, which
--     is the precise move that preserved a dead surface in WP1 and cost two
--     review rounds.
--
--  2. The invitation, not the relationship, is the capability. The token is a
--     bearer credential the owner handed out. The approved way to withdraw it
--     already exists in the contract: V8-R-INV-006 requires a `revoked`
--     invitation-card state ("Dev removed this invite"). Withdrawal is an
--     explicit owner action on the membership — auditable, reversible, and
--     visible to the recipient — whereas silently voiding links as a side
--     effect of a block is neither.
--
--  3. There is no block model to gate on. This branch contains no blocks table
--     and no block relationship in any migration. A gate written here would
--     have to invent the model the decision is supposedly about.
--
-- The finding is therefore ANSWERED, not silently closed: the behaviour it
-- describes is intended, and the enforcement path is invite revocation.
------------------------------------------------------------------------------


------------------------------------------------------------------------------
-- APPLY GATE (attended — the behavioral half a committed-unapplied migration
-- cannot prove; run after the ledger-aware runner applies this file):
--   1. select public.nyc_night_key('2026-07-25T07:59:00Z') → 2026-07-24
--      select public.nyc_night_key('2026-07-25T08:00:00Z') → 2026-07-25
--      select public.nyc_night_key('2026-01-24T08:59:00Z') → 2026-01-23
--      select public.nyc_night_key('2026-01-24T09:00:00Z') → 2026-01-24
--      …and each must equal nycNightKey() in src/lib/nightKey.ts at the same
--      instant (src/lib/nightOutsRls.live.test.ts asserts exactly this).
--   2. As anon: select public.get_shared_night(gen_random_uuid()) → the
--      function no longer exists (42883), not "zero rows".
--   3. As anon: select from public.night_presence → permission denied; call
--      set_night_presence / clear_night_presence / get_circle_presence →
--      permission denied.
--   4. Two accounts, A follows B: B sets 'friends' → A sees it; B sets 'close'
--      → A does NOT see it until A is also followed by B. Neither ever sees
--      their own row.
--   5. Roll the clock past 4:00 AM New York (or write a row with an older
--      night): get_circle_presence returns nothing for it, with no sweeper run.
--
-- Rollback (in comments, per convention):
--   * nyc_night_key: re-apply 0053's body (interval '6 hours'). Note this
--     re-introduces a boundary the approved contract does not permit.
--   * shared-night RPCs: re-apply 0016's share_night/unshare_night/
--     get_shared_night bodies and 0035's share_night. Note this restores a
--     live anon grant over another account's handle and legacy tier.
--   * night_presence: drop the three RPCs, then the table. Destructive.
------------------------------------------------------------------------------
