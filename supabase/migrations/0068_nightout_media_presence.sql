------------------------------------------------------------------------------
-- 0068_nightout_media_presence.sql — the 4:00 AM night, manual presence pins,
--                                    Night Out media and its private archive,
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
-- SECTION 5 — Night Out media: a 24-hour window from the scheduled start
-- SECTION 6 — Saved Nights Out: the private archive
-- SECTION 7 — media_read_window learns the two new grounds to read
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
  -- V8-R-PRE-002 / D-C-37 names THREE top-level choices: Friends, one named
  -- Group, or specific Other people. 'people' is the persisted form of the
  -- third; its recipient list lives in night_presence_recipients below, because
  -- an audience the database cannot represent is an audience the server cannot
  -- enforce — which was the whole of round-1 finding 3.
  --
  -- 'close' is KEPT rather than folded in. It is not one of the contract's three
  -- top-level choices; it is the mutual-follow narrowing this branch already
  -- shipped and reviewed, and dropping it would silently widen every pin that
  -- currently carries it. It is reported as a fourth stored value, not a fourth
  -- product choice.
  --
  -- THE NAMED-GROUP CHOICE IS NOT REPRESENTED HERE, and deliberately not faked.
  -- There is no groups model on this branch — no groups table, no group
  -- membership, no public.invite_one_to_night_out — so a 'group' audience value
  -- would name a set nothing can resolve, and D-C-37's "SELECTED GROUP
  -- INTERSECTED WITH the pinner's mutual friends" could not be computed at all.
  -- Inventing the schema here would collide with the lane that owns groups.
  -- Recorded as the one unbuildable third of V8-R-PRE-002; see the note in
  -- section 3c.
  constraint night_presence_audience_check
    check (audience in ('friends', 'close', 'people')),
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
-- 3-bis. night_presence_recipients — who "specific people" actually means
------------------------------------------------------------------------------
-- One row per (pinner, night, recipient) while the pin's audience is 'people'.
-- Rows are REPLACED wholesale by set_night_presence and cascade away with the
-- pin, so a stale recipient cannot outlive the audience that named them.
--
-- The intersection rule of D-C-37 is enforced on the WRITE side (the RPC keeps
-- only mutual friends) AND re-checked on the READ side (get_circle_presence
-- re-asserts the mutual follow). Storing the intersection alone would leave the
-- pin delivering to somebody who has since unfollowed; re-checking at read time
-- is what makes the audience track the relationship.

create table if not exists public.night_presence_recipients (
  user_id      uuid not null,
  night        date not null,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  constraint night_presence_recipients_pkey
    primary key (user_id, night, recipient_id),
  -- Cascades with the pin itself: clearing the pin clears its audience.
  constraint night_presence_recipients_pin_fkey
    foreign key (user_id, night) references public.night_presence(user_id, night)
    on delete cascade,
  -- A pin is never addressed to its own author.
  constraint night_presence_recipients_not_self check (recipient_id <> user_id)
);

create index if not exists night_presence_recipients_recipient_idx
  on public.night_presence_recipients (recipient_id, night);

comment on table public.night_presence_recipients is
  'The recipient list for a pin whose audience is ''people'' (V8-R-PRE-002 / '
  'D-C-37). Written only by set_night_presence, which keeps only the pinner''s '
  'mutual friends; get_circle_presence re-checks the mutual follow at read time '
  'so an unfollow narrows the audience immediately. Cascades with the pin.';

alter table public.night_presence_recipients enable row level security;
revoke all on table public.night_presence_recipients from public, anon, authenticated;

drop policy if exists night_presence_recipients_own_row on public.night_presence_recipients;
create policy night_presence_recipients_own_row on public.night_presence_recipients
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

------------------------------------------------------------------------------
-- 3a. set_night_presence — the only writer
------------------------------------------------------------------------------
-- Writes TONIGHT's row and no other. The night is resolved server-side from
-- public.nyc_night_key(), never taken from the caller: a client clock that is
-- wrong (or lying) must not be able to write a pin into a different night.

-- p_recipient_ids is meaningful ONLY for audience 'people'. It is intersected
-- with the pinner's mutual friends before anything is stored (D-C-37: "a client
-- may not widen a named-group audience beyond the pinner's mutual friends"),
-- and an intersection that comes back EMPTY fails the whole pin rather than
-- writing a 'people' row nobody can read — V8-R-PRE-002's "a failed audience
-- write fails the pin rather than silently widening it", failing CLOSED.
create or replace function public.set_night_presence(
  p_status        text,
  p_bar_id        text default null,
  p_audience      text default 'friends',
  p_recipient_ids uuid[] default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_night date;
  v_kept  uuid[];
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_status is null or p_status not in ('going', 'maybe', 'not-going') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_audience is null or p_audience not in ('friends', 'close', 'people') then
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

  -- THE INTERSECTION IS COMPUTED HERE, SERVER-SIDE, and the client's list is
  -- only ever a request. D-C-37: recipients are the selection INTERSECTED WITH
  -- the pinner's own mutual friends, so a person who is not a mutual friend is
  -- not a recipient however the caller asked.
  if p_audience = 'people' then
    select coalesce(array_agg(distinct r), '{}'::uuid[])
      into v_kept
      from unnest(coalesce(p_recipient_ids, '{}'::uuid[])) as r
     where r <> v_uid
       and exists (
         select 1 from public.follows f
          where f.follower_id = v_uid and f.followee_id = r
       )
       and exists (
         select 1 from public.follows f2
          where f2.follower_id = r and f2.followee_id = v_uid
       );

    -- FAIL CLOSED. An empty intersection is not "send it to nobody" and it is
    -- certainly not "fall back to friends": it means the audience the user
    -- chose cannot be resolved, so the pin does not happen.
    if v_kept is null or cardinality(v_kept) = 0 then
      raise exception 'no resolvable recipients for a people audience'
        using errcode = '22023';
    end if;
  end if;

  v_night := public.nyc_night_key();

  insert into public.night_presence (user_id, night, status, bar_id, audience)
  values (v_uid, v_night, p_status, p_bar_id, p_audience)
  on conflict on constraint night_presence_pkey
  do update set
    status     = excluded.status,
    bar_id     = excluded.bar_id,
    audience   = excluded.audience,
    updated_at = now();

  -- REPLACED WHOLESALE, on every write, for every audience. Switching from
  -- 'people' back to 'friends' has to drop the old list: leaving it would park
  -- a recipient set behind an audience that no longer reads it, and the next
  -- switch back to 'people' would silently restore a selection the user never
  -- re-made.
  delete from public.night_presence_recipients
   where user_id = v_uid and night = v_night;

  if p_audience = 'people' then
    insert into public.night_presence_recipients (user_id, night, recipient_id)
    select v_uid, v_night, r from unnest(v_kept) as r;
  end if;

  return true;
end;
$$;

-- The three-argument form must not survive as an overload. Leaving it would let
-- a caller reach a signature that cannot express 'people' at all, and PostgREST
-- would pick it by argument name — so a client that meant to send recipients and
-- got the name wrong would land on the old function and write a pin with no
-- audience list instead of failing.
drop function if exists public.set_night_presence(text, text, text);

revoke all on function public.set_night_presence(text, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.set_night_presence(text, text, text, uuid[]) to authenticated;

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
--   'people'  — visible only to a named recipient who is ALSO a mutual follow
--               (V8-R-PRE-002 / D-C-37). Both terms are required at READ time,
--               not just at write time: the recipient row records who was
--               chosen, and the live mutual-follow check is what makes an
--               unfollow narrow the audience immediately rather than at the
--               next pin.
--
-- THE THIRD CONTRACT CHOICE — a single named GROUP — IS NOT SERVED HERE, and
-- this is the honest statement of that gap rather than a silent omission.
-- D-C-37 resolves a group selection to "that group INTERSECTED WITH the
-- pinner's mutual friends", and this branch has no groups model to intersect:
-- no groups table, no membership table, nothing to name. The intersection
-- machinery a group would need is exactly what 'people' above already is, so
-- serving groups later is a resolution step in front of this branch, not a
-- second audience model. Recorded for the lane that owns groups.
--
-- RE-STATED IN ROUND 2, because the gate raised it again as a HIGH and the
-- answer has to be checkable rather than asserted. Measured on this branch at
-- the round-2 candidate: no migration here creates a groups or group-membership
-- table (`0044`, `0064`, `0065`, `0066` and this file are the only ones that
-- mention the word "group", and every one of them means either the
-- `media_destinations.kind = 'group'` VALUE or an English sentence), and
-- `public.invite_one_to_night_out` — the shared door WP6 builds alongside its
-- groups model in `0067` — does not exist here either. The groups model arrives
-- with that lane's migration, which this lane does not own and may not mint.
--
-- So the choice is: ship a 'group' audience whose membership resolves against
-- nothing, or record the gap. A fourth `check` value with no table behind it
-- would let a pin claim an audience the server cannot enforce, which is the one
-- failure mode this whole section exists to prevent. The gap is recorded.
-- CROSS-LANE, not descoped: V8-R-PRE-002's group third needs `0067`'s groups
-- model on the same branch, and is a one-value extension of this `check` plus a
-- membership intersection in `get_circle_presence` once it is there.
--
-- Never returns the caller's own row: the caller already has it, and mixing it
-- into "who else is out" is how a surface ends up telling you about yourself.
--
-- MATERIALIZED fence (0007/0015 rationale): without it the planner may inline a
-- cheap caller-supplied predicate ahead of the audience check on a definer
-- read. There is no caller-supplied predicate here today, and the fence is what
-- keeps that true if one is ever added.

-- THE CALLER'S OWN ROW, THROUGH AN RPC, BECAUSE THE TABLE IS CLOSED.
--
-- `revoke all on table public.night_presence` above is correct and stays: direct table
-- grants are forbidden here and the RPCs are the entire surface. The consequence is easy
-- to miss and cost this lane a HIGH: application code was reading the table directly to
-- get its own row, reasoning that the own-row RLS policy would scope it. It never ran.
-- Revoking the table privilege means RLS IS NEVER CONSULTED — the query is denied at the
-- PERMISSION layer before any policy is evaluated — so the read failed 42501 for every
-- caller, no pill ever activated, and the row could not be cleared by tapping again.
--
-- It takes NO parameters by design. The caller's identity comes from auth.uid() and the
-- night from the server-side boundary, so this cannot be asked about anybody else and
-- cannot be pointed at another night. That is the same rule that removed the viewer
-- parameter from media_path_unreported_live_expiry after it became a cross-user oracle.
-- RETURN TYPE CHANGED (recipient_ids added), so the old body is dropped rather
-- than replaced: `create or replace` cannot widen an OUT-column list, and the
-- error it raises instead would abort the migration.
drop function if exists public.get_my_presence();

create or replace function public.get_my_presence()
returns table (
  status        text,
  bar_id        text,
  audience      text,
  updated_at    timestamptz,
  -- The caller's own 'people' selection, so the audience step can re-open
  -- showing what they actually chose rather than an empty picker. Always the
  -- caller's own row, so this discloses nothing they did not write.
  recipient_ids uuid[]
)
language sql
stable
security definer
set search_path = public
as $$
  select np.status,
         np.bar_id,
         np.audience,
         np.updated_at,
         coalesce(
           (select array_agg(npr.recipient_id order by npr.recipient_id)
              from public.night_presence_recipients npr
             where npr.user_id = np.user_id
               and npr.night = np.night),
           '{}'::uuid[]
         )
    from public.night_presence np
   where np.user_id = auth.uid()
     and np.night = public.nyc_night_key()
$$;

comment on function public.get_my_presence() is
  'V8-R-PRE-001..005. The caller''s own presence for tonight, or no row. Takes no arguments: identity is auth.uid() and the night is public.nyc_night_key(), so it can neither be asked about another account nor pointed at another night. night_presence grants no direct table privilege to any application role, so this RPC is how a client reads its own row. recipient_ids is the caller''s own ''people'' audience selection.';

revoke all on function public.get_my_presence() from public, anon;
grant execute on function public.get_my_presence() to authenticated;

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
       -- …and every audience narrower than 'friends' adds its own term.
       and (
         np.audience = 'friends'
         or (
           -- Both 'close' and 'people' require the follow to be MUTUAL.
           exists (
             select 1 from public.follows f2
              where f2.follower_id = np.user_id
                and f2.followee_id = auth.uid()
           )
           and (
             np.audience = 'close'
             or exists (
               select 1
                 from public.night_presence_recipients npr
                where npr.user_id = np.user_id
                  and npr.night = np.night
                  and npr.recipient_id = auth.uid()
             )
           )
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
--  3. The block model EXISTS and still cannot be applied here. CORRECTION,
--     round 2 (Claude/FABLE gate): this reason previously asserted that "this
--     branch contains no blocks table and no block relationship in any
--     migration". That was FALSE when it was written — 0066, on this same
--     branch, creates `public.profile_blocks` (line ~1583) and
--     `public.is_blocked_between(uuid, uuid)` (line ~1616), and the Feed
--     consumes them for V8-R-FEED-009. A later lane reading the old sentence
--     would have concluded there is no block model and skipped block-gating on
--     a false premise, so it is corrected rather than left standing.
--
--     The decision is UNCHANGED, because it never rested on this reason.
--     `is_blocked_between` refuses a caller asking about a pair it is not part
--     of, and `preview_night_out` executes for ANON — there is no caller
--     identity to ask about. The existing block model therefore cannot gate the
--     anonymous path at all, which is reason 1 again by a truer route.
--
-- The finding is therefore ANSWERED, not silently closed: the behaviour it
-- describes is intended, and the enforcement path is invite revocation.
------------------------------------------------------------------------------


------------------------------------------------------------------------------
-- 5. Night Out media — a 24-hour window measured from the scheduled start
------------------------------------------------------------------------------
-- V8-R-NO-008: "Night Out media lives for 24 hours measured from the SCHEDULED
-- NIGHT OUT START — not from capture, and not from publication. This is a third
-- and distinct lifetime alongside the Story (24h from capture) and the Feed post
-- (until author deletion)." Trust boundary: "server-enforced window".
--
-- NO NEW SPINE. 0066 already models "one media object, many destination
-- references", says in its own comment that `ref_id` is text "so one spine
-- serves surfaces whose keys are not all uuids", and derives the reference count
-- — the thing that decides whether bytes may be reclaimed — from live rows in
-- that one table. A separate night_out_media table would be a second reference
-- the count does not see, and an uncounted reference is exactly how live photos
-- get their bytes swept. So a Night Out attachment is a `media_destinations` row
-- with kind 'night_out', and it inherits reference counting, "remove from this
-- destination" and "delete everywhere" for free.
--
-- THE KIND LIST IS EXTENDED, NOT REPLACED. 0066 owns the base vocabulary
-- ('story', 'feed', 'group', 'archive'); this adds one value to it, forward, the
-- same way section 1 supersedes 0053's function body. Guarded twice: it is a
-- no-op if the extension is already present, and a no-op if 0066 has not been
-- applied at all.

do $$
declare
  v_old text;
begin
  if to_regclass('public.media_destinations') is null then
    return;
  end if;

  -- Already extended — nothing to do. This is what makes the file re-runnable.
  if exists (
    select 1
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'media_destinations'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%night_out%'
  ) then
    return;
  end if;

  -- Found by DEFINITION rather than by name. 0066 declares the check inline on
  -- the column, so its name is whatever PostgreSQL generated; matching on the
  -- literal 'archive' finds the right constraint without depending on that.
  select con.conname
    into v_old
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
   where ns.nspname = 'public'
     and rel.relname = 'media_destinations'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%''archive''%'
   limit 1;

  if v_old is not null then
    execute format(
      'alter table public.media_destinations drop constraint %I', v_old
    );
  end if;

  alter table public.media_destinations
    add constraint media_destinations_kind_check
    check (kind in ('story', 'feed', 'group', 'archive', 'night_out'));
end
$$;

------------------------------------------------------------------------------
-- 5a. The window itself — ONE definition, derived from the approved boundary
------------------------------------------------------------------------------
-- THE SCHEDULED START IS 9:00 PM AMERICA/NEW_YORK ON THE PLAN'S NIGHT.
--
-- CORRECTED IN ROUND 2 (Codex gate, HIGH). This previously read the scheduled
-- start as the START OF THE NIGHT — 4:00 AM America/New_York — because
-- `public.night_outs` schedules against a `night date` and carries no start
-- time, and the note here claimed no hour was available to use without minting
-- a product decision. That claim was wrong: V8-R-NO-002 states the When row
-- "Defaults to the most likely context — Tonight, 9:00 PM". The contract names
-- the hour. Using it invents nothing, and the old reading produced an expiry
-- SEVEN hours after the scheduled start rather than twenty-four — a photo taken
-- at 11:00 PM died at 4:00 AM the same night.
--
-- 9:00 PM on the plan's night, plus 24 hours, therefore closes at 9:00 PM the
-- following evening: the whole night and the day after it, which is what
-- V8-R-NO-008's "24 hours measured from the SCHEDULED NIGHT OUT START" asks for.
--
-- Still rejected, and recorded so nobody re-opens it:
--   * `night_outs.created_at` — when the plan was MADE. A plan made three days
--     ahead would have a window that closed before the night began.
--   * the night's 4:00 AM boundary — that is when the NIGHT KEY rolls over
--     (V8-R-PRE-005 / D-C-39), not when a plan is scheduled to start. The two
--     are different questions and conflating them is the defect above.
--
-- WHEN A REAL START TIME ARRIVES: `night_outs` gains a `starts_at`, and this
-- function reads it instead of the 9:00 PM default. One function, and every
-- caller — add_night_out_media, get_night_out_media, night_out_media_window,
-- archive_night_out and media_read_window — follows without edit.

-- THE WINDOW HAS TWO ENDS (round-3 panel, Codex, HIGH). Round 2 wrote the
-- scheduled start down and then used it for ONE thing: an expiry anchor. Every
-- gate asked `now() < expires_at` and nothing asked whether the window had
-- OPENED, so a plan created at 10:00 AM served and accepted media immediately
-- and went on doing it until 9:00 PM the following evening — about 35 hours,
-- starting eleven hours before the start it claims to measure from. "24 hours
-- measured from the scheduled start" is an interval, not a deadline, and an
-- interval needs both of its ends enforced.
--
-- So the start is its own function and every gate now asks for the half-open
-- interval [opens_at, expires_at).
--
-- CONSEQUENCE, STATED RATHER THAN BURIED: a member who reaches the bar at 8:30
-- PM cannot attach a photo until 9:00 PM. That is what the requirement's own
-- arithmetic says, and the alternative — an open-ended lower bound — is the
-- defect above. When `night_outs` gains a real `starts_at`, THIS function reads
-- it and both ends move together.

-- ONE NAME FOR THE INSTANT, because two surfaces now need it. The media window
-- opens at the plan's scheduled start, and V8-R-INV-002's bearer preview has to
-- state "time" for the same plan. Calling it `night_out_media_opens_at` in the
-- second place would be a lie about what it is, and defining a second 9:00 PM
-- somewhere else is how the two drift. The media window is one CONSUMER of the
-- scheduled start, not its owner.
create or replace function public.night_out_scheduled_start(p_night date)
returns timestamptz
language sql
immutable
as $$
  select (p_night + interval '21 hours') at time zone 'America/New_York'
$$;

comment on function public.night_out_scheduled_start(date) is
  'V8-R-NO-002. When a Night Out on this night is scheduled to start: 9:00 PM '
  'America/New_York, the default the contract names, DST-aware because the cast '
  'resolves the offset at that date. The single definition — the media window '
  'measures its 24 hours from here and the bearer preview states it as the '
  'plan''s time. When night_outs gains a real starts_at column, this function '
  'reads it and every consumer follows without edit.';

revoke all on function public.night_out_scheduled_start(date) from public, anon, authenticated;
grant execute on function public.night_out_scheduled_start(date) to anon, authenticated;

-- THE PLAN'S OWN START, WHICH IS NOT ALWAYS THE DEFAULT (round-3 panel, Codex,
-- HIGH). V8-R-NO-002 is "Change When (defaults to Tonight, 9:00 PM)" — the
-- 9:00 PM is a DEFAULT that is "editable in place", and a function taking only
-- a date cannot represent an edited one. A plan created for 10:00 PM still
-- opened its media window at 9:00 and still told its bearer 9:00.
--
-- So `night_outs` gains the column the round-2 note said it was missing, the
-- date-taking function above becomes the DEFAULT rather than the answer, and
-- every consumer asks the PLAN.
--
-- Nullable, and null means "the default": a backfill would invent a decision
-- for every existing plan, and coalescing is the same answer without the claim.
alter table public.night_outs
  add column if not exists starts_at timestamptz;

comment on column public.night_outs.starts_at is
  'V8-R-NO-002. The plan''s scheduled start when the owner edited it. NULL '
  'means the default — 9:00 PM America/New_York on `night` — which '
  'night_out_scheduled_start(uuid) resolves; nothing reads this column '
  'directly.';

create or replace function public.night_out_scheduled_start(p_night_out uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(n.starts_at, public.night_out_scheduled_start(n.night))
    from public.night_outs n
   where n.id = p_night_out;
$$;

comment on function public.night_out_scheduled_start(uuid) is
  'V8-R-NO-002. When THIS plan is scheduled to start: the owner''s edited '
  'starts_at, or the 9:00 PM America/New_York default for its night. The single '
  'answer every consumer asks — the media window measures its 24 hours from '
  'here and the bearer preview states it as the plan''s time.';

-- NO DIRECT GRANT (round-4 panel, Claude gate). This is SECURITY DEFINER with
-- no membership, token or status gate in its body — it answers about any plan
-- whose uuid you can name. `night_out_media_window(uuid)` gates on
-- `night_out_role` precisely because "when someone else's plan ends is not
-- theirs to know", and granting the ungated primitive next to it hands out the
-- same fact through a side door: a declined or revoked invitee (V8-R-INV-006),
-- or anon with a guessed uuid, could read a plan's exact start.
--
-- Nothing needs the grant. Every caller is either another SECURITY DEFINER
-- function in this file — which executes as the owner and needs no grant — or
-- a gated RPC that returns the value on the caller's behalf.
revoke all on function public.night_out_scheduled_start(uuid) from public, anon, authenticated;

-- The same two derived answers, asked of the PLAN rather than of its date.
create or replace function public.night_out_media_expires_at(p_night_out uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select public.night_out_scheduled_start(p_night_out) + interval '24 hours'
$$;

-- Ungated primitive, same as above: no direct grant.
revoke all on function public.night_out_media_expires_at(uuid) from public, anon, authenticated;

create or replace function public.night_out_media_window_open(p_night_out uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select now() >= public.night_out_scheduled_start(p_night_out)
     and now() <  public.night_out_media_expires_at(p_night_out)
$$;

comment on function public.night_out_media_window_open(uuid) is
  'V8-R-NO-008 for ONE plan, honouring an edited start (V8-R-NO-002). The '
  'predicate every media gate asks; the date-taking overload computes the '
  'default a plan falls back to.';

-- Ungated primitive, same as above: no direct grant. `night_out_media_window`
-- is the gated way to ask this question.
revoke all on function public.night_out_media_window_open(uuid) from public, anon, authenticated;

------------------------------------------------------------------------------
-- set_night_out_start — the owner edits When (V8-R-NO-002, server half)
------------------------------------------------------------------------------
-- The CONTROL for this lives in the Start a Night Out form's When row, in
-- `src/components/StartNightOutButton.tsx`, which this lane may not touch. What
-- was missing and IS this lane's to fix is that the server could not hold the
-- value at all — so the column, the resolution and this writer exist, and the
-- owner-facing editor is the one piece left to another owner.
--
-- Bounded to the plan's own night so an edited start cannot wander into a
-- different night than the one the plan is filed under, which would put its
-- media window and its night key in different days.

create or replace function public.set_night_out_start(
  p_night_out uuid,
  p_starts_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_night date;
begin
  if v_uid is null or p_night_out is null then
    return false;
  end if;

  -- Owner only, and only while the plan is still being planned.
  select n.night into v_night
    from public.night_outs n
   where n.id = p_night_out
     and n.owner_id = v_uid
     and n.status in ('draft', 'open');
  if v_night is null then
    return false;
  end if;

  -- Null CLEARS the edit and returns the plan to the default, which is a real
  -- thing an owner may want and is not the same as failing to set one.
  if p_starts_at is not null then
    if public.nyc_night_key(p_starts_at) <> v_night then
      return false;
    end if;
  end if;

  update public.night_outs
     set starts_at = p_starts_at
   where id = p_night_out
     and owner_id = v_uid
     and status in ('draft', 'open');
  return found;
end;
$$;

comment on function public.set_night_out_start(uuid, timestamptz) is
  'V8-R-NO-002 server half. The plan OWNER edits When, or clears it back to the '
  '9:00 PM default with null. Refused for anyone else, for a settled plan, and '
  'for an instant whose night key is not the plan''s own night.';

revoke all on function public.set_night_out_start(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.set_night_out_start(uuid, timestamptz) to authenticated;

------------------------------------------------------------------------------
-- AREA (V8-R-NO-003 server half) and THE VOTING DEADLINE (V8-R-NO-005)
------------------------------------------------------------------------------
-- ROUND-4 PANEL (Codex, two HIGHs). The same shape as `starts_at` above, and
-- found the same way: the Start a Night Out form has three editable rows — When,
-- Area and Voting closes — and the plan could hold none of them. The rows
-- themselves live in `src/components/StartNightOutButton.tsx`, which this lane
-- may not touch; what IS this lane's, and what was missing, is a model that can
-- carry the values and gates that honour them.
--
-- AREA IS NOT THE DECIDED BAR. Round 3 answered V8-R-INV-002's "area" with
-- `decided_bar_id`, which is a later and different decision: it is null for
-- exactly as long as the plan is still choosing, which is when a recipient most
-- needs to know roughly where. V8-R-NO-003 is an optional free-text area
-- "reused from Tonight", editable, and it can coexist with a decided bar.
alter table public.night_outs
  add column if not exists area text;

alter table public.night_outs
  drop constraint if exists night_outs_area_check;
alter table public.night_outs
  add constraint night_outs_area_check
  check (area is null or char_length(area) between 1 and 60);

comment on column public.night_outs.area is
  'V8-R-NO-003. The plan''s optional area, as the owner set it. NULL means '
  'unset, which is one of the requirement''s own three states and not a '
  'failure to answer.';

-- THE DEADLINE. "Only the owner sets, edits or clears it, and only while voting
-- is open"; NULL is the default, "No deadline", and is a real state rather than
-- an absent one.
alter table public.night_outs
  add column if not exists voting_closes_at timestamptz;

comment on column public.night_outs.voting_closes_at is
  'V8-R-NO-005. When voting closes, or NULL for "No deadline" — the default. '
  'Enforced by night_out_voting_open(), which every suggest, vote, and removal '
  'asks; it is not merely displayed.';

create or replace function public.set_night_out_area(
  p_night_out uuid,
  p_area      text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night_out is null then
    return false;
  end if;
  -- An empty string is the same intent as clearing it, and storing one would
  -- put a value that renders as nothing into a column whose NULL means unset.
  if p_area is not null and char_length(btrim(p_area)) = 0 then
    p_area := null;
  end if;
  if p_area is not null and char_length(btrim(p_area)) > 60 then
    return false;
  end if;

  update public.night_outs
     set area = btrim(p_area)
   where id = p_night_out
     and owner_id = v_uid
     and status in ('draft', 'open');
  return found;
end;
$$;

comment on function public.set_night_out_area(uuid, text) is
  'V8-R-NO-003 server half. The plan OWNER sets, edits or clears the optional '
  'Area. Refused for anyone else and for a settled plan. The editor row itself '
  'is in the Start a Night Out form, outside this lane.';

revoke all on function public.set_night_out_area(uuid, text) from public, anon, authenticated;
grant execute on function public.set_night_out_area(uuid, text) to authenticated;

create or replace function public.set_night_out_voting_deadline(
  p_night_out uuid,
  p_closes_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night_out is null then
    return false;
  end if;

  -- THE SHARED SHORTLIST LOCK, FIRST (round-6 panel, Codex, MEDIUM). Closing
  -- voting is a shortlist writer like any other: without this key, a suggestion
  -- or a vote that had already passed `night_out_voting_open` could commit
  -- AFTER the deadline was set to now, which is precisely the interleaving the
  -- other four writers take this lock to prevent. Same key, same position —
  -- ahead of every check it protects — so the five cannot deadlock.
  perform pg_advisory_xact_lock(
    hashtextextended('night_out_shortlist:' || p_night_out::text, 0));

  -- "ONLY WHILE VOTING IS OPEN." Setting a deadline on a plan whose voting has
  -- already closed — by an earlier deadline or by a lock — would re-open it,
  -- which is a different action from setting one.
  if not exists (
    select 1 from public.night_outs n
     where n.id = p_night_out
       and n.owner_id = v_uid
       and n.status in ('draft', 'open')
  ) then
    return false;
  end if;
  if not public.night_out_voting_open(p_night_out) then
    return false;
  end if;

  update public.night_outs
     set voting_closes_at = p_closes_at
   where id = p_night_out
     and owner_id = v_uid
     and status in ('draft', 'open');
  return found;
end;
$$;

comment on function public.set_night_out_voting_deadline(uuid, timestamptz) is
  'V8-R-NO-005 server half. The plan OWNER sets, edits or clears the voting '
  'deadline (NULL = "No deadline"), and only while voting is still open. '
  'Participants can read it and cannot change it.';

revoke all on function public.set_night_out_voting_deadline(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.set_night_out_voting_deadline(uuid, timestamptz) to authenticated;

-- THE PREDICATE THE DEADLINE IS FOR. A deadline that is only displayed is not a
-- deadline: V8-R-NO-005's states include one where voting has closed and
-- participants have a READ-ONLY plan, so the gate has to be in the writers.
create or replace function public.night_out_voting_open(p_night_out uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select n.status in ('draft', 'open')
     and (n.voting_closes_at is null or now() < n.voting_closes_at)
    from public.night_outs n
   where n.id = p_night_out;
$$;

comment on function public.night_out_voting_open(uuid) is
  'V8-R-NO-005. Is this plan still taking suggestions and votes: an open status '
  'AND either no deadline or a deadline that has not passed. The single '
  'predicate suggest_night_out_bar, vote_night_out_bar, '
  'remove_night_out_suggestion and lock_night_out share.';

-- Ungated primitive; the plan reads expose it through get_night_out.
revoke all on function public.night_out_voting_open(uuid) from public, anon, authenticated;

------------------------------------------------------------------------------
-- THE INVITATION'S OWN LIFETIME (V8-R-INV-001/002 "expired")
------------------------------------------------------------------------------
-- ROUND-4 PANEL (Codex, HIGH). Every bearer gate accepted any draft/open/decided
-- plan regardless of its night, so a token kept serving a plan's attendees and
-- shortlist — and accepting new RSVPs — indefinitely after the night was over.
-- V8-R-INV-001 and V8-R-INV-002 both name an EXPIRED state and require the
-- surface to say so; nothing could ever reach it.
--
-- The horizon is the one the plan already has: an invitation is live until the
-- night's media window closes, 24 hours after its scheduled start. Reusing that
-- instant rather than minting a second lifetime is deliberate — two independent
-- "when is this over" answers is exactly how a surface ends up contradicting
-- itself, and this one already moves with an edited When.
create or replace function public.night_out_invite_live(p_night_out uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select n.cancelled_at is null
     and n.status in ('draft', 'open', 'decided')
     and now() < public.night_out_media_expires_at(n.id)
    from public.night_outs n
   where n.id = p_night_out;
$$;

comment on function public.night_out_invite_live(uuid) is
  'V8-R-INV-001/002. Is this invitation still live: not cancelled, not a dead '
  'status, and before the night''s own horizon (the media window''s close, 24 '
  'hours after the scheduled start). Every bearer read and the anonymous RSVP '
  'write ask it, so an old link reaches the expired state instead of serving '
  'plan facts forever.';

revoke all on function public.night_out_invite_live(uuid) from public, anon, authenticated;

-- The MEMBER-facing reader of the anonymous RSVPs lives at the end of section
-- 8, after the table it reads. A `language sql` body is validated at CREATE, so
-- a function that names a table defined later in the same file cannot be
-- created here — that is the exact defect 0066 shipped and this file will not
-- repeat.

create or replace function public.night_out_media_expires_at(p_night date)
returns timestamptz
language sql
immutable
as $$
  select public.night_out_scheduled_start(p_night) + interval '24 hours'
$$;

comment on function public.night_out_media_expires_at(date) is
  'V8-R-NO-008. When Night Out media for this night stops being served: the '
  'scheduled start (night_out_scheduled_start) plus 24 hours. Measured from the '
  'SCHEDULED START, never from capture or publication. The single definition: '
  'add_night_out_media, get_night_out_media, night_out_media_window, '
  'archive_night_out and media_read_window all call it — and all of them ask '
  'for the half-open interval [opens_at, expires_at), never the deadline alone.';

revoke all on function public.night_out_media_expires_at(date) from public, anon, authenticated;
grant execute on function public.night_out_media_expires_at(date) to authenticated;

-- THE PREDICATE ITSELF, once. Five call sites asked `now() < expires_at`, and
-- adding a second end to the interval in five places is how four of them end up
-- right and one of them drifts. `stable`, not `immutable`: it reads now().
create or replace function public.night_out_media_window_open(p_night date)
returns boolean
language sql
stable
as $$
  select now() >= public.night_out_scheduled_start(p_night)
     and now() <  public.night_out_media_expires_at(p_night)
$$;

comment on function public.night_out_media_window_open(date) is
  'V8-R-NO-008. Is this night''s media window open RIGHT NOW, on the DATABASE''s '
  'clock — the half-open interval [scheduled start, +24h). The single predicate '
  'add_night_out_media, get_night_out_media, night_out_media_window, '
  'archive_night_out and media_read_window all share, so the two ends of the '
  'window cannot drift apart between them.';

revoke all on function public.night_out_media_window_open(date) from public, anon, authenticated;
grant execute on function public.night_out_media_window_open(date) to authenticated;

------------------------------------------------------------------------------
-- 5b. add_night_out_media — attach one object to a Night Out
------------------------------------------------------------------------------
-- Three gates, all server-side: the caller is an ACCEPTED member of the plan,
-- the caller OWNS the bytes, and the window is still open. A closed window
-- refuses the write rather than accepting an attachment nothing will serve.

create or replace function public.add_night_out_media(
  p_night_out uuid,
  p_media     uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_night date;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if public.night_out_role(p_night_out) is null then
    raise exception 'not a member of that night out' using errcode = '42501';
  end if;

  select n.night into v_night
    from public.night_outs n
   where n.id = p_night_out
     and n.cancelled_at is null;
  if v_night is null then
    raise exception 'no such night out' using errcode = '42501';
  end if;
  -- BOTH ENDS (round-3 panel, Codex, HIGH). Before the scheduled start is as
  -- much "outside the window" as after the deadline; the message names the
  -- window rather than which side of it the caller is on, because that is the
  -- same information the surface already gets from night_out_media_window.
  --
  -- Asked of the PLAN, not of its date, so an owner who edited When moves both
  -- ends of the window with it (V8-R-NO-002, round-3 panel).
  if not public.night_out_media_window_open(p_night_out) then
    raise exception 'the night out media window is not open' using errcode = '22023';
  end if;

  -- OWN BYTES ONLY. Without this any member could attach another account's
  -- object by id and hand the whole plan a read window over it.
  --
  -- LOCKED, NOT MERELY READ (round-6 panel, Codex, HIGH). This was a plain
  -- `exists` on `bytes_removed_at is null`, which is a fact about the caller's
  -- snapshot rather than about the row. `claim_media_for_removal` takes the
  -- object `for update`, recounts its live references under that lock, and
  -- stamps the row — so an attach whose snapshot predated that commit read
  -- "still live", inserted its destination, and handed the plan a photo whose
  -- bytes were already committed to deletion. `publish_story` takes the same
  -- row lock for exactly this reason; the Night Out publisher was the one that
  -- did not.
  --
  -- The sweep uses `skip locked`, so holding this lock does not block it: it
  -- passes the row by, and its next pass recounts and finds our destination.
  perform 1
     from public.media_objects m
    where m.id = p_media
      and m.owner_id = v_uid
    for update;
  if not found then
    raise exception 'that media is not yours' using errcode = '42501';
  end if;

  -- A SEPARATE STATEMENT, and that is the point: under READ COMMITTED it takes
  -- a new snapshot, so it sees the claim that committed while we waited for the
  -- lock above. Same refusal `publish_story` raises, for the same reason.
  if exists (
    select 1 from public.media_objects m
     where m.id = p_media
       and m.bytes_removed_at is not null
  ) then
    raise exception 'those bytes have already been reclaimed' using errcode = '22023';
  end if;

  insert into public.media_destinations (media_id, kind, ref_id)
  values (p_media, 'night_out', p_night_out::text)
  on conflict do nothing
  returning id into v_id;

  -- Already attached: idempotent, and it returns the existing row's id rather
  -- than null so a retry after a lost response is indistinguishable from the
  -- first call.
  if v_id is null then
    select d.id into v_id
      from public.media_destinations d
     where d.media_id = p_media
       and d.kind = 'night_out'
       and d.ref_id = p_night_out::text
       and d.removed_at is null;
  end if;

  return v_id;
end;
$$;

revoke all on function public.add_night_out_media(uuid, uuid) from public, anon, authenticated;
grant execute on function public.add_night_out_media(uuid, uuid) to authenticated;

------------------------------------------------------------------------------
-- 5c. get_night_out_media — what a member may see, and until when
------------------------------------------------------------------------------
-- Returns NOTHING once the window has closed. The expiry is applied in the
-- WHERE clause rather than reported for the client to honour, because
-- V8-R-NO-008's failure-recovery clause is "a skewed device clock must not hide
-- media the server still serves" — and its mirror, that a skewed clock must not
-- SHOW media the server has stopped serving, is only true if the server is the
-- one filtering.

create or replace function public.get_night_out_media(p_night_out uuid)
returns table (
  destination_id uuid,
  media_id       uuid,
  author_id      uuid,
  storage_path   text,
  created_at     timestamptz,
  expires_at     timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id,
         m.id,
         m.owner_id,
         m.storage_path,
         d.created_at,
         public.night_out_media_expires_at(n.id)
    from public.media_destinations d
    join public.night_outs n on n.id::text = d.ref_id
    join public.media_objects m on m.id = d.media_id
   where d.kind = 'night_out'
     and d.removed_at is null
     and n.id = p_night_out
     and m.bytes_removed_at is null
     and public.night_out_role(p_night_out) is not null
     and public.night_out_media_window_open(n.id)
   order by d.created_at asc
$$;

comment on function public.get_night_out_media(uuid) is
  'V8-R-NO-008. Live Night Out media for an ACCEPTED member, empty outside the '
  '24-hour window that runs FROM the scheduled start — before it has opened as '
  'well as after it has closed. The window is applied here, not reported for '
  'the client to honour.';

revoke all on function public.get_night_out_media(uuid) from public, anon;
grant execute on function public.get_night_out_media(uuid) to authenticated;

------------------------------------------------------------------------------
-- 5d. night_out_media_window — the window itself, ANSWERED BY THE SERVER
------------------------------------------------------------------------------
-- ADDED IN ROUND 2 (Codex + Claude gates). `get_night_out_media` filters by the
-- window, which is correct, but it can only answer with ROWS — and an empty
-- result means either "no photos yet" or "the window has closed". The recap had
-- no other source, so it recomputed the boundary from the device clock to
-- decide which sentence to show and whether to offer Add-a-photo and Archive.
--
-- That is exactly what V8-R-NO-008's failure clause forbids: "a skewed device
-- clock must not hide media the server still serves". A phone running fast hid
-- two authorized controls while the server would still have honoured them.
--
-- So the server answers the question directly. `is_open` is computed from the
-- DATABASE's `now()` against the same single definition every other caller
-- uses; `expires_at` is returned so the surface can state the window in words
-- (V8-R-NO-008, accessibility) without doing any arithmetic of its own.
--
-- Membership-gated like everything else here: a non-member gets zero rows
-- rather than a window, because when someone else's plan ends is not theirs to
-- know.

-- ROUND 3 (Codex gate, HIGH) ADDS THE OTHER END AND THE WORD FOR IT. Once the
-- window has a lower bound, `is_open = false` means two different things — not
-- yet, or no longer — and a surface that cannot tell them apart either says the
-- wrong sentence or computes the difference from the device clock, which is the
-- thing this function exists to stop. `state` is therefore decided HERE, on the
-- database's clock, and the client only chooses wording from it.
--
-- `opens_at` rides along for the same reason `expires_at` does: so the surface
-- can state the window in words (V8-R-NO-008, accessibility) without doing any
-- arithmetic of its own.
--
-- Return type CHANGED, so this drops forward rather than being replaced — a
-- `create or replace` cannot alter an OUT list. Idempotent via `if exists`.
drop function if exists public.night_out_media_window(uuid);

create or replace function public.night_out_media_window(p_night_out uuid)
returns table (
  opens_at   timestamptz,
  expires_at timestamptz,
  is_open    boolean,
  -- 'before' | 'open' | 'closed' | 'cancelled'. The fourth was added in round 6
  -- so a recap can say why it is not taking photos rather than blaming the
  -- clock for a cancellation.
  state      text
)
language sql
stable
security definer
set search_path = public
as $$
  select public.night_out_scheduled_start(n.id),
         public.night_out_media_expires_at(n.id),
         -- A CANCELLED PLAN TAKES NO MORE PHOTOS (round-5 panel, Claude gate).
         -- `add_night_out_media` refuses one outright, but this function had no
         -- cancellation term, so the recap reported the window OPEN and offered
         -- an enabled Add-a-photo: the file uploaded, the attach was refused,
         -- and the surface blamed a window that was not the reason. The recap
         -- still RENDERS for a cancelled plan on purpose — the night happened
         -- and its archive must survive the cancellation — so the archive
         -- control keeps working off `state`; it is only the write that closes.
         public.night_out_media_window_open(n.id) and n.cancelled_at is null,
         case
           when now() <  public.night_out_scheduled_start(n.id)  then 'before'
           when now() >= public.night_out_media_expires_at(n.id) then 'closed'
           when n.cancelled_at is not null                       then 'cancelled'
           else 'open'
         end
    from public.night_outs n
   where n.id = p_night_out
     and public.night_out_role(p_night_out) is not null
$$;

comment on function public.night_out_media_window(uuid) is
  'V8-R-NO-008. When this Night Out''s media window OPENS and closes, whether it '
  'is open now, and which side of it we are on (''before'' | ''open'' | '
  '''closed''), all decided by the SERVER''s clock. The recap gates its '
  'add-photo and archive controls on this rather than on the device clock, '
  'because "a skewed device clock must not hide media the server still serves". '
  'Zero rows for a non-member.';

revoke all on function public.night_out_media_window(uuid) from public, anon;
grant execute on function public.night_out_media_window(uuid) to authenticated;


------------------------------------------------------------------------------
-- 6. Saved Nights Out — the PRIVATE archive (V8-R-NO-009, V8-R-ACC-002)
------------------------------------------------------------------------------
-- V8-R-NO-009: "A SIGNED-IN PARTICIPANT may privately archive Night Out media to
-- Saved Nights Out before its 24-hour window closes. The archive is private to
-- the archiving account." V8-R-ACC-002: "Each past night is a card leading with
-- photos and one quiet metadata line — name, date, bar count, photo count."
--
-- THIS IS NOT THE RETIRED SHARE LINK. Section 2 retires `get_shared_night`
-- because it was an anon-readable window onto another account's data. This is
-- its opposite in every respect that mattered there: no token, no anon grant, no
-- other account's rows, and no legacy tier. The two are conflated often enough
-- that 0068's own header names the trap.
--
-- THE SNAPSHOT IS THE POINT. "Tapping opens that night's archived recap exactly
-- as it was saved", so the title, night and bar count are COPIED at archive time
-- rather than read back through the live plan — a plan that is later renamed,
-- re-decided or cancelled must not rewrite the archive.

create table if not exists public.saved_nights (
  id           uuid        not null default gen_random_uuid(),
  owner_id     uuid        not null references public.profiles(id) on delete cascade,
  -- SET NULL, not cascade: an archive outlives the plan it came from. Deleting
  -- the plan must not delete the owner's copy of their own night.
  night_out_id uuid        null references public.night_outs(id) on delete set null,
  title        text        null,
  night        date        not null,
  bar_count    integer     not null default 0,
  archived_at  timestamptz not null default now(),
  constraint saved_nights_pkey primary key (id),
  constraint saved_nights_title_check
    check (title is null or char_length(title) between 1 and 80),
  constraint saved_nights_bar_count_check check (bar_count >= 0)
);

-- One archive per account per plan. Re-archiving the same night TOPS UP the
-- existing row instead of minting a second card for the same night.
create unique index if not exists saved_nights_owner_plan_uniq
  on public.saved_nights (owner_id, night_out_id)
  where night_out_id is not null;

create index if not exists saved_nights_owner_idx
  on public.saved_nights (owner_id, night desc);

comment on table public.saved_nights is
  'Saved Nights Out (V8-R-NO-009, V8-R-ACC-002): the account owner''s PRIVATE '
  'archive of a Night Out. Not a share link and not a public surface — no anon '
  'grant reaches it and no RPC returns another account''s rows. Title, night and '
  'bar count are snapshotted at archive time so a later edit to the plan cannot '
  'rewrite the archive.';

alter table public.saved_nights enable row level security;
revoke all on table public.saved_nights from public, anon, authenticated;

drop policy if exists saved_nights_own_row on public.saved_nights;
create policy saved_nights_own_row on public.saved_nights
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create table if not exists public.saved_night_media (
  saved_night_id uuid        not null references public.saved_nights(id) on delete cascade,
  media_id       uuid        not null references public.media_objects(id) on delete cascade,
  -- NOT called `position`: POSITION is a SQL keyword, and an unqualified
  -- reference to it inside a function body parses as the built-in rather than
  -- as this column.
  sort_order     integer     not null default 0,
  created_at     timestamptz not null default now(),
  constraint saved_night_media_pkey primary key (saved_night_id, media_id)
);

comment on table public.saved_night_media is
  'The photos in one saved night. The RETENTION HOLD that keeps their bytes '
  'alive is the matching kind=''archive'' row in media_destinations, which is '
  'what 0066''s reference count and "delete everywhere" already understand — '
  'this table is the ORDERED LIST, not the hold.';

-- KNOWN DEFECT THIS FILE CANNOT CLOSE — recorded, not descoped (round-4 panel,
-- Codex, HIGH).
--
-- V8-R-NO-009 retains an archived photo "indefinitely in Saved Nights Out,
-- until account deletion", meaning the ARCHIVING account's deletion. It does
-- not survive the AUTHOR's: `media_objects.owner_id` references
-- `public.profiles(id) ON DELETE CASCADE` (0066:39), so deleting author B's
-- profile deletes B's media_objects rows, and every path from an archive back
-- to the bytes runs through one — this table's `media_id`, and the
-- kind='archive' row in `media_destinations`. Archiver A's card silently loses
-- the photo while A's account is untouched.
--
-- The fix belongs where the cascade is, which is 0066 and not this lane: the
-- media spine has to stop destroying objects other accounts hold a live
-- retention reference to (a restricted delete, an ownership transfer, or a
-- tombstone that keeps the row and the bytes while any kind='archive' hold is
-- live). Changing only THIS table's foreign key cannot fix it and would make it
-- worse — `on delete restrict` turns the defect into a failed account deletion,
-- and dropping the reference leaves a card pointing at bytes nothing keeps
-- alive, which is the same loss with a row still on screen claiming otherwise.
--
-- So it is written down here rather than half-fixed. Reproduce: A archives an
-- object owned by B, delete B's profile, and read A's saved_night_media.

alter table public.saved_night_media enable row level security;
revoke all on table public.saved_night_media from public, anon, authenticated;

drop policy if exists saved_night_media_own_row on public.saved_night_media;
create policy saved_night_media_own_row on public.saved_night_media
  for all
  using (
    exists (
      select 1 from public.saved_nights sn
       where sn.id = saved_night_id and sn.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.saved_nights sn
       where sn.id = saved_night_id and sn.owner_id = auth.uid()
    )
  );

------------------------------------------------------------------------------
-- 6·5. A saved night that goes away RELEASES ITS RETENTION HOLDS
------------------------------------------------------------------------------
-- ADDED IN ROUND 2 (Codex gate, HIGH). The hold that keeps an archived photo's
-- bytes alive is a `kind='archive'` row in `media_destinations`, and its
-- `ref_id` is TEXT — the shared spine deliberately has no foreign key, because
-- one column serves surfaces whose keys are not all uuids. So nothing retired
-- those rows when the saved night they belong to disappeared:
--
--   account A archives a photo owned by B, then A deletes their account.
--   `saved_nights` cascades from `profiles`, `saved_night_media` cascades from
--   `saved_nights` — and the archive destination survives both, because it is
--   joined by a string nothing enforces. B later deletes the media everywhere,
--   and 0066's reference count still sees A's orphan hold, so the bytes are
--   never reclaimable. The retention V8-R-CMP-016 grants is "until the
--   ARCHIVING ACCOUNT deletes it"; a hold outliving that account is unbounded.
--
-- A TRIGGER, not a step inside a delete RPC, for the same reason the hold has no
-- foreign key to lean on: the deletes arrive by CASCADE from `profiles`, where
-- no application code runs at all. Anything written at a call site would be
-- skipped by the exact path that produced the orphan.
--
-- `removed_at`, never DELETE: 0066 counts LIVE rows and keeps removed ones as
-- the record that this destination once existed. Retiring is what "delete
-- everywhere" already does to every other kind, so the reference count and the
-- byte-reclamation policy need no new concept.
--
-- SECURITY DEFINER because the cascade can run as any role that may delete a
-- profile, and `media_destinations` grants nothing to the application roles.
-- Idempotent: `removed_at is null` means a re-run retires nothing twice.

create or replace function public.release_saved_night_holds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.media_destinations
     set removed_at = now()
   where kind = 'archive'
     and ref_id = old.id::text
     and removed_at is null;
  return old;
end;
$$;

comment on function public.release_saved_night_holds() is
  'V8-R-CMP-016. Retires the kind=''archive'' retention holds of a saved night '
  'that is being deleted — including by cascade from an account deletion, which '
  'is the only path that produced orphans. Bytes become reclaimable exactly when '
  'the archiving account stops holding them.';

drop trigger if exists saved_nights_release_holds on public.saved_nights;
create trigger saved_nights_release_holds
  before delete on public.saved_nights
  for each row execute function public.release_saved_night_holds();

------------------------------------------------------------------------------
-- 6a. archive_night_out — the private archive action
------------------------------------------------------------------------------
-- "A failed archive must not report success, and must not consume the window."
-- Everything below happens in ONE transaction: the saved night, its ordered
-- media list and the retention holds all commit together or not at all, so a
-- partial archive cannot exist to be reported as a whole one.
--
-- BEFORE THE WINDOW CLOSES, AND ONLY BEFORE. V8-R-NO-009 grants the archive to
-- a participant "before its 24-hour window closes", so a late call is REFUSED.
--
-- CORRECTED IN ROUND 2 (Codex gate, HIGH). This function used to have no window
-- guard at all: it created or topped up the `saved_nights` row first and only
-- then selected the window-filtered media, so an archive attempted after expiry
-- SUCCEEDED with `photo_count = 0`. The caller was handed a saved-night id and
-- reported an archived empty night — a permission that had lapsed, answered as
-- a real save. The check is now the first thing after membership, ahead of every
-- write, so a refusal leaves no row behind.
--
-- Zero photos remains a legitimate answer INSIDE the window — a night nobody
-- photographed, or one whose bytes were removed — and that case still returns
-- rather than raising. What it can no longer mean is "you were too late".

create or replace function public.archive_night_out(p_night_out uuid)
returns table (saved_night_id uuid, photo_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_night  date;
  v_title  text;
  v_bars   integer;
  v_saved  uuid;
  v_count  integer;
  v_locked uuid[];
  v_media  uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  -- PARTICIPATION IS REQUIRED, exactly as V8-R-NO-009's trust boundary states:
  -- "authentication and Night Out participation are both required". A
  -- token-scoped recipient without the app is not a member and cannot archive
  -- (D-C-23).
  if public.night_out_role(p_night_out) is null then
    raise exception 'not a member of that night out' using errcode = '42501';
  end if;

  select n.night, n.title into v_night, v_title
    from public.night_outs n
   where n.id = p_night_out;
  if v_night is null then
    raise exception 'no such night out' using errcode = '42501';
  end if;

  -- AHEAD OF EVERY WRITE. Same errcode and same single predicate as
  -- add_night_out_media's own guard, asked of the same PLAN, so both halves of
  -- "you may act on this night's media" open and close at exactly the same two
  -- instants — including when the owner has edited When (V8-R-NO-002).
  if not public.night_out_media_window_open(p_night_out) then
    raise exception 'the night out media window is not open' using errcode = '22023';
  end if;

  select count(distinct s.bar_id)::integer into v_bars
    from public.night_out_suggestions s
   where s.night_out_id = p_night_out;

  insert into public.saved_nights (owner_id, night_out_id, title, night, bar_count)
  values (v_uid, p_night_out, v_title, v_night, coalesce(v_bars, 0))
  on conflict (owner_id, night_out_id) where night_out_id is not null
  do update set
    title      = excluded.title,
    bar_count  = excluded.bar_count,
    archived_at = now()
  returning id into v_saved;

  -- THE ORDERED LIST, in two steps: take in whatever is live, then number the
  -- WHOLE card.
  --
  -- ROUND-3 PANEL (Claude gate). One statement used to do both, numbering with
  -- `row_number()` over the live set and inserting `on conflict do nothing` —
  -- so a row that already existed KEPT the number an earlier pass gave it while
  -- new rows got numbers from a freshly recomputed sequence. Archive A,B,C
  -- (1,2,3); B's destination is removed; attach D and re-archive: the live set
  -- A,C,D numbers 1,2,3, C's insert is skipped and keeps 3, and D arrives as 3
  -- too. `get_saved_night`'s ORDER BY sort_order then returns those two in
  -- whatever order the executor likes, and the archive stops opening "in the
  -- order the night actually happened" — the only promise this column makes.
  --
  -- Renumbering just the live rows does NOT fix it, which is why the numbering
  -- is its own statement over the whole saved night. The archive deliberately
  -- OUTLIVES the live window — a retention hold keeps bytes an author removed
  -- everywhere else (V8-R-CMP-016) — so a card routinely holds rows that are no
  -- longer live, and those rows carry numbers from the pass that added them. B
  -- above is exactly such a row: renumber A,C,D to 1,2,3 and B's stale 2
  -- collides with C.
  --
  -- The key is the MEDIA's own created_at rather than the destination's: it is
  -- the one instant every row on the card has, live or retained, and it is the
  -- order the night happened in. media_id breaks ties so the result is total.
  -- THE BYTES ARE LOCKED BEFORE THEY ARE ARCHIVED (round-6 panel, Codex, HIGH).
  -- `get_night_out_media` filters `bytes_removed_at is null`, but that is a
  -- fact about this transaction's snapshot: a reclamation that committed after
  -- it still left the row in this list, and the archive then took a retention
  -- hold on bytes already claimed for deletion — a saved card that loses its
  -- photo the moment the sweep runs.
  --
  -- Ordered by media id so two participants archiving the same night cannot
  -- deadlock against each other, and the INSERT below reads only the ids we
  -- hold, in its own statement, so its snapshot is taken after every claim we
  -- waited on had committed.
  select coalesce(array_agg(live.media_id order by live.media_id), '{}'::uuid[])
    into v_locked
    from public.get_night_out_media(p_night_out) live;

  foreach v_media in array v_locked loop
    perform 1 from public.media_objects m where m.id = v_media for update;
  end loop;

  insert into public.saved_night_media (saved_night_id, media_id)
  select v_saved, m.id
    from public.media_objects m
   where m.id = any(v_locked)
     and m.bytes_removed_at is null
  on conflict on constraint saved_night_media_pkey do nothing;

  with ordered as (
    select snm.media_id,
           (row_number() over (order by m.created_at, m.id))::integer as n
      from public.saved_night_media snm
      join public.media_objects m on m.id = snm.media_id
     where snm.saved_night_id = v_saved
  )
  update public.saved_night_media snm
     set sort_order = ordered.n
    from ordered
   where snm.saved_night_id = v_saved
     and snm.media_id = ordered.media_id
     and snm.sort_order is distinct from ordered.n;

  -- THE RETENTION HOLD, one per archived object. 0066 already treats a live
  -- kind='archive' row as the thing that keeps bytes from being reclaimed and
  -- that "delete everywhere" must not clear (V8-R-CMP-016) — this is the writer
  -- that table was waiting for, and the reason "indefinite until account
  -- deletion" survives the author deleting the post everywhere else.
  insert into public.media_destinations (media_id, kind, ref_id)
  select snm.media_id, 'archive', v_saved::text
    from public.saved_night_media snm
   where snm.saved_night_id = v_saved
  on conflict do nothing;

  select count(*)::integer into v_count
    from public.saved_night_media snm
   where snm.saved_night_id = v_saved;

  return query select v_saved, v_count;
end;
$$;

comment on function public.archive_night_out(uuid) is
  'V8-R-NO-009. Privately archives the Night Out''s LIVE media to the calling '
  'participant''s Saved Nights Out, in one transaction, with a kind=''archive'' '
  'retention hold per object. REFUSES once the media window has closed — the '
  'grant is "before its 24-hour window closes" — so a late call writes nothing '
  'rather than reporting an empty archive. Idempotent inside the window: '
  're-archiving tops the same card up.';

revoke all on function public.archive_night_out(uuid) from public, anon;
grant execute on function public.archive_night_out(uuid) to authenticated;

------------------------------------------------------------------------------
-- 6b. get_saved_nights / get_saved_night — the archive list and one night
------------------------------------------------------------------------------
-- "audience: the account owner ONLY — a private archive", "trust_boundary:
-- server-enforced; own account only". Both functions filter on auth.uid() in
-- their own body, so neither can be pointed at another account by passing an id.

create or replace function public.get_saved_nights()
returns table (
  id          uuid,
  title       text,
  night       date,
  bar_count   integer,
  photo_count integer,
  archived_at timestamptz,
  -- The card "leads with photos", so the list carries enough to draw one
  -- without a second round trip per row.
  --
  -- MEDIA IDS, NOT STORAGE PATHS. The client resolves a photo through
  -- /api/media/:mediaId/url, which is keyed on the id; returning paths would
  -- make every caller derive an id back out of an object key by string
  -- surgery, and a key whose shape changed would silently produce an id that
  -- belongs to nothing — or, worse, to something else.
  cover_media_ids uuid[]
)
language sql
stable
security definer
set search_path = public
as $$
  select sn.id,
         sn.title,
         sn.night,
         sn.bar_count,
         (select count(*)::integer
            from public.saved_night_media snm
           where snm.saved_night_id = sn.id),
         sn.archived_at,
         coalesce(
           (select array_agg(m.id order by snm.sort_order)
              from public.saved_night_media snm
              join public.media_objects m on m.id = snm.media_id
             where snm.saved_night_id = sn.id
               and m.bytes_removed_at is null),
           '{}'::uuid[]
         )
    from public.saved_nights sn
   where sn.owner_id = auth.uid()
   order by sn.night desc, sn.archived_at desc
$$;

revoke all on function public.get_saved_nights() from public, anon;
grant execute on function public.get_saved_nights() to authenticated;

create or replace function public.get_saved_night(p_id uuid)
returns table (
  id           uuid,
  title        text,
  night        date,
  bar_count    integer,
  archived_at  timestamptz,
  media_id     uuid,
  storage_path text,
  sort_order   integer
)
language sql
stable
security definer
set search_path = public
as $$
  select sn.id,
         sn.title,
         sn.night,
         sn.bar_count,
         sn.archived_at,
         m.id,
         m.storage_path,
         snm.sort_order
    from public.saved_nights sn
    left join public.saved_night_media snm on snm.saved_night_id = sn.id
    left join public.media_objects m
           on m.id = snm.media_id
          and m.bytes_removed_at is null
   where sn.id = p_id
     and sn.owner_id = auth.uid()
   order by snm.sort_order asc
$$;

comment on function public.get_saved_night(uuid) is
  'V8-R-ACC-002. One archived night for its OWNER only. LEFT JOINed on purpose: '
  'a saved night whose photos have all had their bytes removed still returns its '
  'own row, so the surface can say "this night has no photos left" instead of '
  'rendering an empty archive that looks like a failed read.';

revoke all on function public.get_saved_night(uuid) from public, anon;
grant execute on function public.get_saved_night(uuid) to authenticated;


------------------------------------------------------------------------------
-- 7. media_read_window learns the two new grounds to read
------------------------------------------------------------------------------
-- 0066's `media_read_window` is the ONE place `/api/media/:id/url` asks "may
-- this caller read these bytes, and until when?" before minting with service
-- role. It knows about stories and about the owner's own prefix, because those
-- were the only references that existed when it was written. Sections 5 and 6
-- add two more, and a reference the window does not know about is a photo the
-- product shows and the route 404s.
--
-- REPLACED FORWARD, body preserved. Everything 0066 decided is unchanged and
-- reached in the same order; the two new branches are asked FIRST and only ever
-- ADD grounds to read. Asking them first is deliberate rather than convenient:
-- the owner branch below returns early and refuses an author their own media
-- once `story_media_is_dead` holds, and a Night Out's window is its own right —
-- an expired story on the same bytes must not close a Night Out that is still
-- running, and must not close an archive the owner deliberately kept.
--
-- NEITHER NEW BRANCH CAN WIDEN ANYTHING. Both require a row the caller could
-- only have obtained through participation (an accepted membership) or through
-- ownership (their own saved night), and both are evaluated against auth.uid()
-- inside the function rather than against a parameter.
--
-- NOT COVERED, and stated rather than implied: V8-R-FEED-010's reporter-hide has
-- no equivalent here, because nothing in this branch can report Night Out media
-- — `content_reports.subject_kind` has no value for it and no writer creates
-- one. A hide term written now would be dead code that reads like enforcement.

create or replace function public.media_read_window(p_name text)
returns table (readable boolean, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_expiry timestamptz;
begin
  if v_caller is null or p_name is null then
    return query select false, null::timestamptz;
    return;
  end if;

  -- NEW (0068) — THE OWNER OF A SAVED NIGHT, on bytes their own archive holds.
  -- Retention is "indefinite in Saved Nights Out, until account deletion"
  -- (V8-R-NO-009), so the window is unbounded and only the signed-URL ceiling
  -- applies. This is what lets a participant keep a photo whose author later
  -- deleted it everywhere else — the archive hold is precisely the reference
  -- V8-R-CMP-016 refuses to reclaim bytes over.
  if exists (
    select 1
      from public.media_destinations d
      join public.media_objects m on m.id = d.media_id
      join public.saved_nights sn on sn.id::text = d.ref_id
     where d.kind = 'archive'
       and d.removed_at is null
       and m.storage_path = p_name
       and m.bytes_removed_at is null
       and sn.owner_id = v_caller
  ) then
    return query select true, null::timestamptz;
    return;
  end if;

  -- NEW (0068) — AN ACCEPTED MEMBER OF A NIGHT OUT, for as long as that Night
  -- Out's own 24-hour window is open (V8-R-NO-008). The window travels with the
  -- URL: `mintSignedMediaUrl` caps the signed lifetime at the time the media
  -- itself has left, so a URL cannot outlive the window it was granted under.
  select max(public.night_out_media_expires_at(n.id))
    into v_expiry
    from public.media_destinations d
    join public.media_objects m on m.id = d.media_id
    join public.night_outs n on n.id::text = d.ref_id
   where d.kind = 'night_out'
     and d.removed_at is null
     and m.storage_path = p_name
     and m.bytes_removed_at is null
     and public.night_out_role(n.id) is not null
     -- The same half-open interval the rows themselves are served over, so a
     -- URL cannot be minted for a night whose window has not opened yet
     -- (round-3 panel, Codex, HIGH).
     and public.night_out_media_window_open(n.id);

  if v_expiry is not null then
    return query select true, v_expiry;
    return;
  end if;

  -- THE OWNER, on their own prefix. `story_media_is_dead` is 0065's rule that
  -- an author cannot sign their own expired or deleted media, kept rather than
  -- quietly relaxed. It is also what keeps the upload-before-publish window
  -- open: an object no story references at all is not "dead", and its window is
  -- unbounded, so only the signed-URL ceiling applies.
  if (storage.foldername(p_name))[1] = v_caller::text then
    if public.story_media_is_dead(p_name) then
      return query select false, null::timestamptz;
      return;
    end if;
    -- THE HIDE APPLIES TO THE AUTHOR TOO. `report_content` explicitly accepts an
    -- author reporting their own story, and V8-R-FEED-010 says a report hides
    -- the content FOR THE REPORTER — with no exception for the reporter also
    -- being the author. Without this term the self-report succeeded while the
    -- photo went on signing for the person who reported it.
    v_expiry := public.media_path_unreported_live_expiry(p_name);

    -- A null expiry means one of two different things here, and they must not
    -- collapse: no story names these bytes at all (the upload-before-publish
    -- window, unbounded and readable), or every live story that names them is
    -- one this caller reported (hidden).
    if v_expiry is null and exists (
      select 1
        from public.stories s
       where (s.media_path = p_name or s.inset_path = p_name)
         and s.deleted_at is null
         and s.expires_at > now()
    ) then
      return query select false, null::timestamptz;
      return;
    end if;

    return query select true, v_expiry;
    return;
  end if;

  -- A VIEWER, only through a story they can actually read. This is the
  -- predicate the dropped "story-media: audience reads referenced" policy
  -- carried. The block is inherited from is_mutual_friend rather than restated
  -- here, so this site cannot drift from the other four that ask it.
  select max(s.expires_at) into v_expiry
    from public.stories s
   where (s.media_path = p_name or s.inset_path = p_name)
     and s.deleted_at is null
     and s.expires_at > now()
     and public.is_mutual_friend(v_caller, s.author_id)
     -- THE REPORTER'S HIDE APPLIES TO THE BYTES TOO. The stories SELECT policy
     -- excludes a story the caller reported, but this function is SECURITY
     -- DEFINER and reads public.stories directly, so the policy does not run
     -- here: without this clause a viewer could report a story, lose the row,
     -- and still mint a fresh signed URL for its photo with a media id they had
     -- already seen. "Reporting IMMEDIATELY HIDES the reported content" is not
     -- satisfied by hiding the caption while the image still loads.
     and not exists (
       select 1
         from public.content_reports cr
        where cr.reporter_id = v_caller
          and cr.subject_kind = 'story'
          and cr.subject_ref = s.id::text
     )
     and (
       s.audience = 'friends'
       or public.is_story_recipient(s.id, v_caller)
     );

  -- No readable story means no window and no read. Note the difference from the
  -- owner branch: a null expiry here is "nothing authorises you", not
  -- "unbounded".
  return query select v_expiry is not null, v_expiry;
end;
$$;

comment on function public.media_read_window(text) is
  'V8-R-STO-015 / V8-R-FEED-009 / V8-R-NO-008 / V8-R-NO-009. May the CALLER read '
  'this object, and until when? Four grounds, asked in this order: an archive '
  'hold the caller owns (unbounded), an open Night Out the caller is an accepted '
  'member of (the 24-hour window), the caller''s own prefix, and a story they may '
  'read. 0066 owns the last two verbatim; 0068 adds the first two forward.';

revoke all on function public.media_read_window(text) from public, anon;
grant execute on function public.media_read_window(text) to authenticated;


------------------------------------------------------------------------------
-- 8. The bearer invitation contract (V8-R-INV-001 … V8-R-INV-004)
------------------------------------------------------------------------------
-- ADDED IN ROUND 3 (Codex gate, HIGH). 0044 shipped ONE anon grant — a preview
-- carrying the night, the title, the host's display identity and an accepted
-- count — and the surface offered a signed-out visitor nothing but "Sign in to
-- join". The approved contract is larger than that in two specific ways, and
-- both were simply absent:
--
--   V8-R-INV-001 (D-C-23): "A token-scoped recipient may VIEW the associated
--   Night Out and SUBMIT AN RSVP WITHOUT SIGNING UP." D-C-23 explicitly
--   SUPERSEDES the frozen PRD sentence that pre-signup RSVP is not authorized.
--   V8-R-INV-003 (D-C-22): the three choices are Going, Maybe, and Can't make
--   it — not the two-way accept/decline the member surface has.
--   V8-R-INV-002: the bearer view shows "who invited them, the plan name, time
--   and area, who is going, and the shortlist so far".
--
-- WHAT STAYS BEHIND THE AUTH WALL IS UNCHANGED. V8-R-INV-001's exclusions are
-- "no voting, no suggesting, no browsing private application data", and nothing
-- below grants any of the three. The bearer additions are exactly the plan's own
-- shared facts: its scheduled start, the bar it settled on if it settled, the
-- display identities of the people who accepted, and the shortlist with its vote
-- COUNTS. No account ids, no handles-to-ids mapping beyond what 0044's preview
-- already returns for the host, no voter identities, no ratings, no scores, no
-- notification tokens — the trust boundary 0044 wrote down, held.
--
-- WHY THE RSVP NEEDS A TABLE OF ITS OWN: `night_out_members` keys on a profile
-- id, and a recipient without the app has none. Their answer is owned by them
-- ("the recipient owns their RSVP") and identified by a key their own device
-- mints and keeps, so they can change it later without an account and nobody
-- else can read or overwrite it.

create table if not exists public.night_out_anon_rsvps (
  night_out_id uuid        not null references public.night_outs(id) on delete cascade,
  -- CLIENT-MINTED AND CLIENT-HELD. It is the recipient's capability over their
  -- own answer: knowing the share token lets you RSVP, but only this key lets
  -- you read or change the answer already stored under it.
  rsvp_key     uuid        not null,
  response     text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint night_out_anon_rsvps_pkey primary key (night_out_id, rsvp_key),
  -- 'declined' is the stored name for "Can't make it", matching
  -- night_out_members.invite_status so the two vocabularies cannot drift. The
  -- phrase "Not tonight" is deliberately absent — V8-R-INV-003 excludes it by
  -- name (D-C-21, D-C-22).
  constraint night_out_anon_rsvps_response_check
    check (response in ('going', 'maybe', 'declined'))
);

comment on table public.night_out_anon_rsvps is
  'V8-R-INV-001 / V8-R-INV-003 (D-C-23). One RSVP from a token-scoped recipient '
  'who has no account. Identified by a key the recipient''s own device mints and '
  'keeps — never by an account id, because there isn''t one. Direct grants are '
  'forbidden; rsvp_night_out_by_token and get_anon_rsvp_by_token are the entire '
  'surface.';

alter table public.night_out_anon_rsvps enable row level security;
revoke all on table public.night_out_anon_rsvps from public, anon, authenticated;
-- No policy and no grant: with RLS on and every grant revoked the table is
-- unreachable except through the SECURITY DEFINER functions below. That is the
-- same shape 0044 gives every one of its tables.

------------------------------------------------------------------------------
-- 8a. rsvp_night_out_by_token — the anonymous RSVP write
------------------------------------------------------------------------------
-- The ONE anon WRITE grant in this file, and it is as narrow as the read one:
-- holding the token authorizes exactly this, on exactly one plan, and the row
-- it can reach is the one under the caller's own key.
--
-- KNOWN LIMIT OF AN ACCOUNTLESS RSVP — recorded, not closed (round-6 panel,
-- Codex, MEDIUM). `p_key` is minted by the CALLER, because a recipient who has
-- no account and no session has nothing else to be identified by; D-C-23 grants
-- the RSVP to whoever holds a forwardable link. One token-holder can therefore
-- call this 100 times under 100 fresh uuids: the cap fills with rows that are
-- one person, later recipients are refused, and members read counts nobody
-- sent. Nothing available INSIDE the database distinguishes those calls — anon
-- PostgREST requests carry no identity, and a server-minted key would be just
-- as mintable 100 times. The mitigations that work are edge-side (per-IP rate
-- limiting, a challenge in front of the RPC) and belong to the deployment, not
-- to this migration.
--
-- What is closed here is the half that misled the recipient: a refusal is no
-- longer reported as "not sent yet — try again in a moment", a retry that at
-- the cap can never succeed. See InvitePreview's refused branch.

create or replace function public.rsvp_night_out_by_token(
  p_token    uuid,
  p_key      uuid,
  p_response text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  -- A share token is forwardable by design, so an unbounded anon insert is a
  -- write amplification anyone holding a link could aim at the table. The cap
  -- bounds one plan's anonymous replies well above any real guest list; a
  -- recipient CHANGING their answer never spends a slot, because the update
  -- path below runs first.
  anon_rsvp_cap constant integer := 100;
  v_plan  uuid;
  v_count integer;
begin
  if p_token is null or p_key is null or p_response is null
     or p_response not in ('going', 'maybe', 'declined') then
    return false;
  end if;

  -- A cancelled plan takes no more replies; a decided one still does, because
  -- "we settled on a bar" is not "stop telling us whether you're coming".
  -- AND THE INVITATION IS STILL LIVE (round-4 panel, Codex, HIGH). Without the
  -- horizon, a token went on taking new answers for a night that was months
  -- past; V8-R-INV-001's expired state was unreachable.
  select n.id into v_plan
    from public.night_outs n
   where n.share_token = p_token
     and public.night_out_invite_live(n.id)
   limit 1;
  if v_plan is null then
    return false;
  end if;

  -- CHANGING AN ANSWER FIRST, before the cap is ever consulted: an existing
  -- recipient must never be refused because other people filled the table.
  -- This is also what makes a duplicate delivery idempotent, which
  -- V8-R-INV-003's failure clause requires by name.
  update public.night_out_anon_rsvps
     set response = p_response, updated_at = now()
   where night_out_id = v_plan
     and rsvp_key = p_key;
  if found then
    return true;
  end if;

  -- Check-then-act on a count → serialize per plan (the 0011/0044 pattern).
  perform pg_advisory_xact_lock(
    hashtextextended('night_out_anon_rsvps:' || v_plan::text, 0));

  -- INSIDE THE LOCK, TRY THE UPDATE AGAIN FIRST (round-3 panel, Codex,
  -- MEDIUM). The pre-lock update above can miss for a key that a CONCURRENT
  -- call is inserting right now: two duplicate deliveries of the same reply
  -- both miss, the first takes the lock and inserts row 100, and the second
  -- then saw a full table and returned false — reporting as unsent a reply that
  -- is stored under its own key. "Duplicate delivery is idempotent"
  -- (V8-R-INV-003) has to hold at the cap boundary too, so the second look
  -- happens where it can actually see the first call's committed row.
  update public.night_out_anon_rsvps
     set response = p_response, updated_at = now()
   where night_out_id = v_plan
     and rsvp_key = p_key;
  if found then
    return true;
  end if;

  select count(*) into v_count
    from public.night_out_anon_rsvps r
   where r.night_out_id = v_plan;
  if v_count >= anon_rsvp_cap then
    return false;
  end if;

  insert into public.night_out_anon_rsvps (night_out_id, rsvp_key, response)
  values (v_plan, p_key, p_response)
  on conflict on constraint night_out_anon_rsvps_pkey
  do update set response = excluded.response, updated_at = now();
  return true;
end;
$$;

comment on function public.rsvp_night_out_by_token(uuid, uuid, text) is
  'V8-R-INV-001 / V8-R-INV-003 (D-C-23, D-C-22). Records or changes ONE '
  'token-scoped recipient''s RSVP — going | maybe | declined — without an '
  'account. Idempotent: re-sending the same answer under the same key is a '
  'no-op and never spends the per-plan cap. Grants nothing else: voting, '
  'suggesting and every private read still require authentication.';

revoke all on function public.rsvp_night_out_by_token(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rsvp_night_out_by_token(uuid, uuid, text) to anon, authenticated;

create or replace function public.get_anon_rsvp_by_token(p_token uuid, p_key uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  -- BOTH halves are required. The token alone cannot read anybody's answer —
  -- otherwise every holder of a forwarded link could enumerate the replies —
  -- and the key alone names no plan.
  --
  -- AND THE INVITATION MUST STILL BE LIVE (round-5 panel, Claude gate): an
  -- expired link that still returned the recipient's old answer showed it as
  -- current on a surface that can no longer change it.
  select r.response
    from public.night_out_anon_rsvps r
    join public.night_outs n on n.id = r.night_out_id
   where n.share_token = p_token
     and r.rsvp_key = p_key
     and public.night_out_invite_live(n.id)
   limit 1;
$$;

comment on function public.get_anon_rsvp_by_token(uuid, uuid) is
  'V8-R-INV-003. The answer stored under THIS recipient''s own key, so a '
  'returning visitor sees the RSVP they already sent instead of being asked '
  'again. Requires the token AND the key; either alone returns nothing.';

revoke all on function public.get_anon_rsvp_by_token(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_anon_rsvp_by_token(uuid, uuid) to anon, authenticated;

------------------------------------------------------------------------------
-- 8a'. get_night_out_anon_rsvps — the answers reach the people they are for
------------------------------------------------------------------------------
-- ROUND-4 PANEL (Codex, HIGH). The table above had exactly one reader, and it
-- required the recipient's own secret key — so an answer sent from a link was
-- stored and then visible to nobody at all. V8-R-INV-003's audience is "plan
-- members": the whole point of the RSVP is that the host learns whether you are
-- coming.
--
-- COUNTS, NOT IDENTITIES. A token-scoped recipient has no account and gave no
-- name, so how many replies came in and what they were is the honest thing the
-- plan can say. Inventing a display name for them would be worse than the
-- silence this replaces.

create or replace function public.get_night_out_anon_rsvps(p_night_out uuid)
returns table (going integer, maybe integer, declined integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where r.response = 'going')::integer,
    count(*) filter (where r.response = 'maybe')::integer,
    count(*) filter (where r.response = 'declined')::integer
    from public.night_out_anon_rsvps r
   where r.night_out_id = p_night_out
     and public.night_out_role(p_night_out) is not null;
$$;

comment on function public.get_night_out_anon_rsvps(uuid) is
  'V8-R-INV-003. How many people answered this plan from the invitation link, '
  'by choice, for its MEMBERS — the audience the requirement names. Counts '
  'only: a token-scoped recipient has no account and no name to show.';

revoke all on function public.get_night_out_anon_rsvps(uuid) from public, anon;
grant execute on function public.get_night_out_anon_rsvps(uuid) to authenticated;

-- THE DEADLINE, FOR THE PEOPLE IT APPLIES TO. V8-R-NO-005: "participants see it
-- and cannot change it", and once it passes they have a read-only plan. 0044's
-- `get_night_out` predates the column and belongs to another lane, so the plan
-- surface asks for this alongside it rather than through it.
create or replace function public.get_night_out_voting(p_night_out uuid)
returns table (voting_closes_at timestamptz, voting_open boolean)
language sql
stable
security definer
set search_path = public
as $$
  select n.voting_closes_at, public.night_out_voting_open(n.id)
    from public.night_outs n
   where n.id = p_night_out
     and public.night_out_role(p_night_out) is not null;
$$;

comment on function public.get_night_out_voting(uuid) is
  'V8-R-NO-005. This plan''s voting deadline and whether voting is still open, '
  'for its MEMBERS — decided by the server''s clock, so the read-only state '
  'arrives at the same instant the writers start refusing. Zero rows for a '
  'non-member.';

revoke all on function public.get_night_out_voting(uuid) from public, anon;
grant execute on function public.get_night_out_voting(uuid) to authenticated;

------------------------------------------------------------------------------
-- 8a''. preview_night_out — THE read that decides the page's whole shape
------------------------------------------------------------------------------
-- ROUND-5 PANEL, BOTH LANES, HIGH. Round 5 put `night_out_invite_live` on the
-- three bearer functions this file added and on the RSVP write, and left the
-- one 0044 already had — which is the read the page actually gates on.
-- `src/app/night-out/[token]/page.tsx` settles into its 'preview' state
-- whenever `preview_night_out` answers, so past the horizon the recipient got
-- the full invitation surface with live RSVP buttons: every tap refused, every
-- refusal reported as "that hasn't been sent yet — try again in a moment", a
-- retry that could never succeed. The three gated reads returned nothing, and
-- the surface rendered THAT as "couldn't load", so the one state the page could
-- never reach was the true one.
--
-- Worse, this file's own comment claimed otherwise ("an old link reaches the
-- expired state instead of serving plan facts forever") and apply-gate item 20
-- listed `preview_night_out` among the functions that stop answering. Both were
-- false as written. Replacing it forward here — the same pattern this file
-- already uses for `suggest_night_out_bar` and `vote_night_out_bar` — makes
-- them true.
--
-- 0044's body otherwise verbatim: the same six columns, the same materialized
-- fence, the same refusal to expose member identities or account ids.

create or replace function public.preview_night_out(p_token uuid)
returns table (
  night date,
  title text,
  status text,
  owner_handle text,
  owner_display_name text,
  accepted_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with gated as materialized (
    select n.id, n.night, n.title, n.status, n.owner_id
      from public.night_outs n
     where n.share_token = p_token
       and public.night_out_invite_live(n.id)
     limit 1
  )
  select g.night, g.title, g.status,
         p.handle::text, p.display_name::text,
         (select count(*) from public.night_out_members m
           where m.night_out_id = g.id and m.invite_status = 'accepted')
    from gated g
    join public.profiles p on p.id = g.owner_id;
$$;

comment on function public.preview_night_out(uuid) is
  '0044''s anon bearer preview, replaced forward in 0068 to ask '
  'night_out_invite_live instead of a bare status check. It is the read the '
  'plan page gates its whole shape on, so without the horizon an expired link '
  'served the invitation surface — with RSVP controls the server refuses — '
  'forever, and V8-R-INV-001/002''s expired state was unreachable.';

revoke all on function public.preview_night_out(uuid) from public, anon, authenticated;
grant execute on function public.preview_night_out(uuid) to anon, authenticated;

------------------------------------------------------------------------------
-- 8b. The bearer view's missing halves (V8-R-INV-002)
------------------------------------------------------------------------------
-- Three functions rather than a wider `preview_night_out`, for two reasons: its
-- return type cannot be extended by `create or replace`, and it belongs to 0044
-- — replacing another migration's function to add columns is a change every
-- later reader has to reconcile across two files. These are additive and each
-- answers a different cardinality, so they could not have been one function
-- anyway.

-- Return type CHANGED in round 4 (area is its own column now), so this drops
-- forward. Idempotent via `if exists`.
drop function if exists public.preview_night_out_detail(uuid);

create or replace function public.preview_night_out_detail(p_token uuid)
returns table (
  starts_at        timestamptz,
  area             text,
  decided_bar_id   text,
  voting_closes_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with gated as materialized (
    select n.id, n.area, n.decided_bar_id, n.voting_closes_at
      from public.night_outs n
     where n.share_token = p_token
       and public.night_out_invite_live(n.id)
     limit 1
  )
  -- Asked of the PLAN, so a bearer is told the hour the owner actually chose
  -- rather than the default the plan may have moved off (V8-R-NO-002).
  select public.night_out_scheduled_start(g.id),
         g.area,
         g.decided_bar_id,
         g.voting_closes_at
    from gated g;
$$;

comment on function public.preview_night_out_detail(uuid) is
  'V8-R-INV-002''s "time and area" for a bearer. The time is the plan''s '
  'SCHEDULED START from the single definition (night_out_scheduled_start); the '
  'AREA is the plan''s own optional area (V8-R-NO-003) — round 3 substituted '
  'decided_bar_id for it, which is a different and later decision that is null '
  'for exactly as long as the plan is still choosing. The decided bar and the '
  'voting deadline ride along because both are facts about the plan the '
  'recipient was invited to. Zero rows once the invitation has expired.';

revoke all on function public.preview_night_out_detail(uuid) from public, anon, authenticated;
grant execute on function public.preview_night_out_detail(uuid) to anon, authenticated;

create or replace function public.preview_night_out_attendees(p_token uuid)
returns table (display_name text, handle text)
language sql
stable
security definer
set search_path = public
as $$
  with gated as materialized (
    select n.id
      from public.night_outs n
     where n.share_token = p_token
       -- The invitation's own lifetime, not merely a live-ish status
       -- (round-4 panel, Codex, HIGH).
       and public.night_out_invite_live(n.id)
     limit 1
  )
  -- ACCEPTED ONLY, and DISPLAY IDENTITY ONLY. "Who is going" is the people who
  -- said yes; a pending invitation is not a fact about who is coming, and
  -- exposing it would tell a bearer who was asked. No profile ids leave here —
  -- the same line 0044 drew for the host.
  select p.display_name::text, p.handle::text
    from gated g
    join public.night_out_members m
      on m.night_out_id = g.id and m.invite_status = 'accepted'
    join public.profiles p on p.id = m.user_id
   order by m.created_at asc;
$$;

comment on function public.preview_night_out_attendees(uuid) is
  'V8-R-INV-002''s "who is going" for a bearer: the DISPLAY identities of the '
  'accepted members, in the order they joined. Never account ids, never pending '
  'or declined invitations.';

revoke all on function public.preview_night_out_attendees(uuid) from public, anon, authenticated;
grant execute on function public.preview_night_out_attendees(uuid) to anon, authenticated;

create or replace function public.preview_night_out_shortlist(p_token uuid)
returns table (bar_id text, votes bigint)
language sql
stable
security definer
set search_path = public
as $$
  with gated as materialized (
    select n.id
      from public.night_outs n
     where n.share_token = p_token
       -- The invitation's own lifetime, not merely a live-ish status
       -- (round-4 panel, Codex, HIGH).
       and public.night_out_invite_live(n.id)
     limit 1
  )
  -- COUNTS, NOT VOTERS. The shortlist is what the plan is choosing between;
  -- who voted for what is members' business. Ranked the same way lock_night_out
  -- ranks it, so the row a bearer sees on top is the one a lock would take.
  select s.bar_id,
         (select count(*)
            from public.night_out_votes v
           where v.night_out_id = g.id and v.bar_id = s.bar_id)
    from gated g
    join public.night_out_suggestions s on s.night_out_id = g.id
   order by 2 desc, s.created_at asc, s.bar_id asc;
$$;

comment on function public.preview_night_out_shortlist(uuid) is
  'V8-R-INV-002''s "the shortlist so far" for a bearer: the suggested bars with '
  'their VOTE COUNTS, ranked as lock_night_out ranks them. No voter identities '
  'and no suggester identities — a bearer may not vote or suggest '
  '(V8-R-INV-001), and does not need to know who did.';

revoke all on function public.preview_night_out_shortlist(uuid) from public, anon, authenticated;
grant execute on function public.preview_night_out_shortlist(uuid) to anon, authenticated;

------------------------------------------------------------------------------
-- 8c''. suggest_night_out_bar — the third writer on the same lock
------------------------------------------------------------------------------
-- ROUND-4 PANEL (Codex, MEDIUM). Round 3 put the vote writer on the shared
-- shortlist key and left the SUGGESTION writer on 0044's per-(plan, user) lock,
-- which excludes nothing the lock is about: a suggestion could pass its
-- open-plan check, the owner could lock the plan, and the row could then land —
-- a shortlist entry on a decided plan that can be neither voted on nor removed
-- (both of those refuse a settled plan).
--
-- 0044's body, unchanged except for the two locks and the deadline gate. The
-- per-user cap lock is KEPT and taken second: it is a different mutual
-- exclusion — one member racing themselves for cap slots — and dropping it
-- would let a member exceed their three live suggestions.

create or replace function public.suggest_night_out_bar(
  p_night_out uuid,
  p_bar text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  suggestion_cap constant integer := 3;  -- live suggestions per member/plan
  v_uid uuid := auth.uid();
  v_live integer;
begin
  if v_uid is null or p_night_out is null
     or p_bar is null or p_bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;
  if public.night_out_role(p_night_out) is null then
    return false;  -- criterion 10
  end if;

  -- THE SHORTLIST LOCK FIRST, always in this order across all four writers, so
  -- no two of them can deadlock against each other.
  perform pg_advisory_xact_lock(
    hashtextextended('night_out_shortlist:' || p_night_out::text, 0));

  if not public.night_out_voting_open(p_night_out) then
    return false;
  end if;

  -- Idempotent re-suggest never spends the cap (0011 pattern).
  if exists (
    select 1 from public.night_out_suggestions s
     where s.night_out_id = p_night_out and s.bar_id = p_bar
  ) then
    return true;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('night_out_suggestions:' || p_night_out::text || ':' || v_uid::text, 0));

  select count(*) into v_live
    from public.night_out_suggestions s
   where s.night_out_id = p_night_out and s.suggested_by = v_uid;
  if v_live >= suggestion_cap then
    return false;
  end if;

  insert into public.night_out_suggestions (night_out_id, bar_id, suggested_by)
  values (p_night_out, p_bar, v_uid)
  on conflict on constraint night_out_suggestions_pkey do nothing;

  if found then
    insert into public.night_out_events (night_out_id, actor_id, kind, bar_id)
    values (p_night_out, v_uid, 'bar_suggested', p_bar);
  end if;
  return true;
end;
$$;

comment on function public.suggest_night_out_bar(uuid, text) is
  '0044''s suggestion writer, replaced forward in 0068 to take the shared '
  'night_out_shortlist advisory lock FIRST and to honour the voting deadline '
  '(V8-R-NO-005). Its per-member cap lock is kept, taken second, in the one '
  'order all four shortlist writers use.';

revoke all on function public.suggest_night_out_bar(uuid, text) from public, anon, authenticated;
grant execute on function public.suggest_night_out_bar(uuid, text) to authenticated;

------------------------------------------------------------------------------
-- 8c'. vote_night_out_bar — takes the shortlist lock too
------------------------------------------------------------------------------
-- ROUND 3 (Codex gate, HIGH + MEDIUM). `lock_night_out` and
-- `remove_night_out_suggestion` below both take an advisory lock and both were
-- written as if that made them exclusive with voting. It did not: 0044's
-- `vote_night_out_bar` takes NO lock, so an advisory key nobody else holds
-- serializes those two against each other and against nothing else. Two real
-- interleavings came out of that:
--
--   * a vote passes its open-plan check, the owner locks and decides, and the
--     vote INSERTs afterwards — a vote on a decided plan, and possibly a bar
--     that was not the leader at the instant the lock took one;
--   * a vote passes its suggestion-exists check, the suggestion is removed, and
--     the vote INSERTs afterwards — an orphan row that `night_out_votes` has no
--     foreign key to catch, and that counts again if the bar is re-suggested.
--
-- A lock only excludes writers that ASK FOR IT, so the vote writer is replaced
-- forward here to take the same key. The body is 0044's, unchanged except for
-- the lock: this is not a re-specification of voting, it is the missing half of
-- two mutual exclusions this file introduced.
--
-- The key is the plan's shortlist, shared by all three functions.

create or replace function public.vote_night_out_bar(
  p_night_out uuid,
  p_bar text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night_out is null
     or p_bar is null or p_bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;
  if public.night_out_role(p_night_out) is null then
    return false;  -- criterion 10
  end if;

  -- THE SHARED KEY, taken BEFORE the checks it protects. Everything below —
  -- the plan's status, the suggestion's existence, and the insert — is now one
  -- atomic decision with respect to suggest_night_out_bar, lock_night_out and
  -- remove_night_out_suggestion.
  perform pg_advisory_xact_lock(
    hashtextextended('night_out_shortlist:' || p_night_out::text, 0));

  -- No voting on a cancelled or already-decided plan (review round 1), and
  -- none once the DEADLINE has passed (V8-R-NO-005, round-4 panel): a deadline
  -- that is only displayed is not a deadline.
  if not public.night_out_voting_open(p_night_out) then
    return false;
  end if;
  -- Votes attach only to bars actually on the board.
  if not exists (
    select 1 from public.night_out_suggestions s
     where s.night_out_id = p_night_out and s.bar_id = p_bar
  ) then
    return false;
  end if;

  insert into public.night_out_votes (night_out_id, bar_id, user_id)
  values (p_night_out, p_bar, v_uid)
  on conflict on constraint night_out_votes_pkey do nothing;
  return true;
end;
$$;

comment on function public.vote_night_out_bar(uuid, text) is
  '0044''s vote writer, replaced forward in 0068 to take the shared '
  'night_out_shortlist advisory lock. Without it, lock_night_out and '
  'remove_night_out_suggestion serialized against each other and against '
  'nothing else, so a vote could land after the plan was decided or after its '
  'bar was removed.';

revoke all on function public.vote_night_out_bar(uuid, text) from public, anon, authenticated;
grant execute on function public.vote_night_out_bar(uuid, text) to authenticated;

------------------------------------------------------------------------------
-- 8c. lock_night_out — the owner's one primary action (V8-R-SOC-007)
------------------------------------------------------------------------------
-- ADDED IN ROUND 3 (Codex gate, HIGH). The plan page drew a "Pick this" button
-- on EVERY shortlist row and called `decide_night_out` with that row's bar, so
-- the owner's action was "choose any bar" over an unranked board. V8-R-SOC-007
-- is one action with a fixed object: "Closes voting immediately, TAKES THE TOP
-- BAR, and tells everyone."
--
-- The top bar is chosen HERE, not by the client, for the same reason every other
-- gate in this file is: a client that picks the row it believes is on top can be
-- looking at a board one vote out of date, and would then lock a bar that was
-- not the leader at the instant the lock landed.
--
-- `decide_night_out` is left exactly as 0044 wrote it. It is a different verb —
-- the owner naming a specific bar — and other callers may still want it; this
-- function is the contract's action, and the surface offers this one.

create or replace function public.lock_night_out(p_night_out uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bar text;
begin
  if v_uid is null or p_night_out is null then
    return null;
  end if;

  -- OWNER ONLY, server-enforced: "a participant cannot lock". Checked against
  -- night_outs.owner_id rather than night_out_role, which answers 'owner' or
  -- 'member' but is about ACCEPTED membership, not about who owns the plan.
  if not exists (
    select 1 from public.night_outs n
     where n.id = p_night_out
       and n.owner_id = v_uid
       and n.status in ('draft', 'open')
  ) then
    return null;
  end if;

  -- Read the leader and take it in one serialized section, so a vote landing
  -- between the read and the update cannot make the locked bar stale.
  --
  -- THE SAME KEY the vote writer and the removal take (section 8c'). Round 3
  -- (Codex gate, HIGH): this key was `night_out_lock:` and nothing else asked
  -- for it, so the "serialized section" excluded nobody and a vote could still
  -- land between the SELECT below and the UPDATE.
  perform pg_advisory_xact_lock(
    hashtextextended('night_out_shortlist:' || p_night_out::text, 0));

  -- TOTAL ORDER, so "the top bar" is one bar and not a coin flip: most votes,
  -- then the earliest suggestion, then the bar id.
  select s.bar_id into v_bar
    from public.night_out_suggestions s
    left join public.night_out_votes v
      on v.night_out_id = s.night_out_id and v.bar_id = s.bar_id
   where s.night_out_id = p_night_out
   group by s.bar_id, s.created_at
   order by count(v.user_id) desc, s.created_at asc, s.bar_id asc
   limit 1;

  -- "A FAILED LOCK LEAVES VOTING OPEN AND SAYS SO." An empty shortlist has no
  -- top bar to take, so nothing is decided and the caller gets null — the plan
  -- is exactly as open as it was.
  if v_bar is null then
    return null;
  end if;

  update public.night_outs
     set status = 'decided', decided_bar_id = v_bar
   where id = p_night_out
     and owner_id = v_uid
     and status in ('draft', 'open');
  if not found then
    return null;
  end if;

  -- "and tells everyone" — the append-only record every member's plan view
  -- reads. Pushed notification delivery is the shared invite/notify door that
  -- does not exist on this branch (HFX-R-103) and is not minted here.
  insert into public.night_out_events (night_out_id, actor_id, kind, bar_id)
  values (p_night_out, v_uid, 'plan_changed', v_bar);
  return v_bar;
end;
$$;

comment on function public.lock_night_out(uuid) is
  'V8-R-SOC-007. The plan owner closes voting and TAKES THE TOP BAR — chosen '
  'here, by votes then suggestion age then bar id, so the client cannot lock a '
  'bar that was not the leader when the lock landed. Returns the locked bar id, '
  'or null when the caller is not the owner, the plan is not open, or the '
  'shortlist is empty; a null lock changes nothing and leaves voting open.';

revoke all on function public.lock_night_out(uuid) from public, anon, authenticated;
grant execute on function public.lock_night_out(uuid) to authenticated;

------------------------------------------------------------------------------
-- 8d. remove_night_out_suggestion — the overflow's one action (V8-R-SOC-008)
------------------------------------------------------------------------------
-- "Removal is authorized to the entry owner or the plan owner", server-enforced.
-- The votes go with the suggestion: a vote for a bar that is no longer on the
-- shortlist is a row nothing can render and that lock_night_out would still
-- count if the bar came back.

create or replace function public.remove_night_out_suggestion(
  p_night_out uuid,
  p_bar       text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night_out is null
     or p_bar is null or p_bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;
  -- Accepted membership is the floor, exactly as suggest/vote have it.
  if public.night_out_role(p_night_out) is null then
    return false;
  end if;

  -- THE SHARED SHORTLIST LOCK (section 8c'), taken ahead of every check below.
  -- Round 3 (Codex gate, MEDIUM): without the vote writer taking it too, a vote
  -- could pass its suggestion-exists check, this function could delete the
  -- suggestion and its votes, and the vote could then INSERT — leaving a row
  -- attached to a bar that is no longer on the board, which nothing here would
  -- see and which counts again if the bar is re-suggested.
  perform pg_advisory_xact_lock(
    hashtextextended('night_out_shortlist:' || p_night_out::text, 0));

  -- Only while the plan is still choosing — which now includes the deadline
  -- (V8-R-NO-005, round-4 panel): once voting has closed the plan is read-only
  -- for participants. Removing the decided bar from a settled plan would also
  -- leave night_outs.decided_bar_id naming a row nobody can see, and a settled
  -- shortlist is a record of what was chosen from.
  if not public.night_out_voting_open(p_night_out) then
    return false;
  end if;
  -- THE AUTHORIZATION, and it is deliberately one predicate: this row's own
  -- suggester, or the plan's owner. A member cannot remove another member's
  -- suggestion.
  if not exists (
    select 1
      from public.night_out_suggestions s
     where s.night_out_id = p_night_out
       and s.bar_id = p_bar
       and (
         s.suggested_by = v_uid
         or exists (
           select 1 from public.night_outs n
            where n.id = p_night_out and n.owner_id = v_uid
         )
       )
  ) then
    return false;
  end if;

  delete from public.night_out_votes v
   where v.night_out_id = p_night_out and v.bar_id = p_bar;
  delete from public.night_out_suggestions s
   where s.night_out_id = p_night_out and s.bar_id = p_bar;
  if not found then
    return false;
  end if;

  -- 'plan_changed' is the existing kind for "the shortlist is different now";
  -- night_out_events' check constraint holds the four approved kinds and this
  -- file does not widen it.
  insert into public.night_out_events (night_out_id, actor_id, kind, bar_id)
  values (p_night_out, v_uid, 'plan_changed', p_bar);
  return true;
end;
$$;

comment on function public.remove_night_out_suggestion(uuid, text) is
  'V8-R-SOC-008. Removes one shortlist entry and the votes cast for it. '
  'Authorized to the entry''s own suggester or to the plan owner, server-side — '
  'the overflow control only renders where this would succeed, and this is what '
  'decides it. Refused once the plan is decided or cancelled.';

revoke all on function public.remove_night_out_suggestion(uuid, text) from public, anon, authenticated;
grant execute on function public.remove_night_out_suggestion(uuid, text) to authenticated;

------------------------------------------------------------------------------
-- 8e. get_night_out_board — THE BOARD IS RANKED THE WAY THE LOCK RANKS IT
------------------------------------------------------------------------------
-- ROUND-6 PANEL (Codex, MEDIUM). `lock_night_out` takes the top bar by a TOTAL
-- order — votes, then the suggestion's age, then the bar id — and the plan page
-- renders the board with a stable sort by votes alone, trusting the server's
-- order underneath it. 0044's order was `s.created_at asc` and nothing else, so
-- two suggestions sharing a `created_at` came back in whichever order the
-- executor liked, and the row drawn on top was not necessarily the row the lock
-- would take. "Take the top bar" (V8-R-SOC-007) is only a promise the surface
-- can keep if the top row and the locked bar are decided the same way.
--
-- 0044's body, unchanged except for the ORDER BY, which is now character for
-- character the one in section 8c. The board does not return `created_at`, so
-- the client cannot reconstruct this tiebreak itself — the total order has to
-- be the server's, and the client's stable sort by votes then preserves it.

create or replace function public.get_night_out_board(p_night_out uuid)
returns table (bar_id text, suggested_by_handle text, votes bigint, caller_voted boolean)
language sql
stable
security definer
set search_path = public
as $$
  with gate as materialized (
    select 1 from public.night_out_members g
     where g.night_out_id = p_night_out
       and g.user_id = auth.uid()
       and g.invite_status = 'accepted'
     limit 1
  )
  select s.bar_id,
         p.handle::text,
         count(v.user_id)::bigint,
         bool_or(v.user_id = auth.uid())
    from public.night_out_suggestions s
    join public.profiles p on p.id = s.suggested_by
    left join public.night_out_votes v
      on v.night_out_id = s.night_out_id and v.bar_id = s.bar_id
    cross join gate
   where s.night_out_id = p_night_out
   group by s.bar_id, p.handle, s.created_at
   order by count(v.user_id) desc, s.created_at asc, s.bar_id asc;
$$;

comment on function public.get_night_out_board(uuid) is
  '0044''s shortlist read, replaced forward in 0068 with lock_night_out''s '
  'TOTAL order — votes, then suggestion age, then bar id. 0044 ordered by '
  'created_at alone, so tied rows came back in an arbitrary order and the row '
  'the page drew on top was not necessarily the bar a lock would take '
  '(V8-R-SOC-007).';

revoke all on function public.get_night_out_board(uuid) from public, anon, authenticated;
grant execute on function public.get_night_out_board(uuid) to authenticated;


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
--   6. AUDIENCE 'people' (V8-R-PRE-002): B pins with p_audience 'people' and a
--      recipient list containing A (mutual) and C (followed but NOT mutual).
--      night_presence_recipients holds A only — C was dropped by the
--      intersection, not merely hidden. A sees the pin; C does not; D, named by
--      nobody, does not. Then A unfollows B: A stops seeing it on the NEXT read
--      with no write to the pin. Finally B pins 'people' with a list of
--      non-mutuals only → the RPC RAISES and no row is written (fail closed).
--   7. NIGHT OUT MEDIA (V8-R-NO-008): an accepted member attaches an object they
--      own → get_night_out_media returns it with expires_at =
--      night_out_media_expires_at(night). A non-member gets zero rows. A member
--      attaching somebody else's media id is refused 42501. Set the plan's night
--      two days back → get_night_out_media returns ZERO rows and
--      add_night_out_media refuses, with no sweeper run.
--   7a. THE SCHEDULED START IS 9:00 PM (V8-R-NO-002), NOT 4:00 AM:
--      select public.night_out_scheduled_start('2026-07-24') →
--      2026-07-25 01:00:00+00 (9:00 PM EDT on the 24th), and
--      night_out_media_expires_at('2026-07-24') → 2026-07-26 01:00:00+00 (that
--      start plus 24 hours). In EST: night_out_scheduled_start('2026-01-23') →
--      2026-01-24 02:00:00+00, expires 2026-01-25 02:00:00+00. A photo added at
--      11:00 PM on the plan's night must still be returned by
--      get_night_out_media the following afternoon — the round-1 4:00 AM
--      reading expired it five hours after capture.
--   7b. THE WINDOW IS SERVER-ANSWERED: night_out_media_window(plan) as an
--      accepted member returns exactly one row whose is_open agrees with
--      night_out_media_window_open(night), and ZERO rows for a non-member. The
--      client gates its add-photo and archive controls on this and never on its
--      own clock.
--   7c. THE WINDOW HAS A LOWER BOUND (round-3 panel): create a plan whose night
--      is TODAY and call the media path before 9:00 PM New York →
--      night_out_media_window reports state 'before' with is_open false,
--      add_night_out_media raises 22023, archive_night_out raises 22023, and
--      get_night_out_media returns zero rows. media_read_window must not
--      authorise on night-out grounds either. After 9:00 PM the same calls all
--      succeed; two days later state is 'closed'. Before this bound, a plan
--      created at 10:00 AM served media for about 35 hours starting immediately.
--   8. SAVED NIGHTS OUT (V8-R-NO-009 / V8-R-ACC-002): archive_night_out as a
--      member returns a photo_count matching the live media; get_saved_nights
--      returns that card for the archiver and NOTHING for anyone else;
--      get_saved_night(id) as another account returns zero rows. Call
--      delete_media_everywhere on an archived object as its author →
--      remaining_references is non-zero and the bytes are NOT reclaimable, and
--      the archiver can still read it through media_read_window. Re-run
--      archive_night_out → the same saved night id, no duplicate card.
--   8a. A LATE ARCHIVE IS REFUSED, NOT EMPTIED: set the plan's night two days
--      back and call archive_night_out as an accepted member → it RAISES 22023
--      and public.saved_nights gains no row. Before this guard it returned a
--      saved-night id with photo_count 0, which the client reported as a real
--      archive of an empty night.
--   8b. AN ARCHIVE'S RETENTION HOLDS DIE WITH IT: account A archives an object
--      owned by B, then delete A's profile row. The cascade removes A's
--      saved_nights row, and the matching kind='archive' media_destinations row
--      must now have removed_at set. media_reference_count for that object drops
--      accordingly, and delete_media_everywhere by B leaves the bytes
--      reclaimable — previously A's orphan hold held them forever.
--   9. media_read_window: as an accepted member on a live night-out path →
--      (true, the window); the same call after the window closes → falls through
--      to the story/owner branches and does not authorise on night-out grounds.
--   10. ARCHIVE ORDER SURVIVES A TOP-UP (round-3 panel, Claude): archive a night
--      with three photos; remove the middle one's night_out destination; attach
--      a fourth and re-archive. select media_id, sort_order from
--      saved_night_media for that card → four rows with sort_order 1,2,3,4, all
--      distinct, in media_objects.created_at order. Before this, the retained
--      row and a new one both held the same number and get_saved_night's ORDER
--      BY returned them in an unspecified order.
--   11. THE BEARER CONTRACT (V8-R-INV-001…004, D-C-23). As ANON, holding a live
--      share token:
--      a. preview_night_out_detail → one row: starts_at equal to
--         night_out_scheduled_start(night), decided_bar_id null while choosing.
--      b. preview_night_out_attendees → the display identities of ACCEPTED
--         members only; a pending invitee must NOT appear; no profile ids.
--      c. preview_night_out_shortlist → the suggested bars with vote counts,
--         top-ranked first, and NO suggester or voter identity in any column.
--      d. rsvp_night_out_by_token(token, key1, 'maybe') → true; calling it again
--         with 'going' under key1 → true and exactly ONE row for key1.
--         get_anon_rsvp_by_token(token, key1) → 'going';
--         get_anon_rsvp_by_token(token, gen_random_uuid()) → zero rows (the
--         token alone reads nobody's answer). An invalid response → false and
--         no row. A cancelled plan's token → false.
--      e. Still refused as anon: select from night_out_anon_rsvps → permission
--         denied; vote_night_out_bar / suggest_night_out_bar / get_night_out /
--         get_night_out_members / get_night_out_board → permission denied.
--   12. LOCK THE PLAN (V8-R-SOC-007): a plan whose bar A has 5 votes and bar B
--      has 1. lock_night_out as a MEMBER → null and the plan is still open.
--      As the OWNER → returns 'A', night_outs.status is 'decided',
--      decided_bar_id is A, and one 'plan_changed' event names A. Locking an
--      empty shortlist → null and the plan stays open. Locking twice → the
--      second call returns null (the status guard) and changes nothing.
--   13. SHORTLIST REMOVAL (V8-R-SOC-008): member M suggests bar X and another
--      member votes for it. remove_night_out_suggestion as a THIRD member →
--      false and X is still there. As M → true, and both the suggestion and the
--      vote are gone. As the plan OWNER on another member's entry → true. After
--      the plan is decided → false. M's suggestion cap has one slot back.
--   14. THE SHORTLIST LOCK IS SHARED (round-4, Codex HIGH + MEDIUM). In two
--      sessions: BEGIN in A and call vote_night_out_bar (it takes the
--      night_out_shortlist lock and holds it to COMMIT); in B call
--      lock_night_out and, separately, remove_night_out_suggestion. Both must
--      BLOCK until A commits, and the leader B then takes must include A's vote.
--      Before this, B's advisory key was one nobody else asked for and both
--      races were open.
--   15. AN EDITED START MOVES EVERYTHING WITH IT (V8-R-NO-002, round-4, Codex
--      HIGH). set_night_out_start(plan, <10:00 PM on the plan's night>) as the
--      OWNER → true; night_out_scheduled_start(plan) is 10:00 PM,
--      night_out_media_window_open(plan) is false at 9:30 PM and true at 10:01,
--      night_out_media_window reports state 'before' then 'open', and
--      preview_night_out_detail's starts_at is 10:00 PM. As a MEMBER → false.
--      On a decided plan → false. With an instant whose nyc_night_key is a
--      DIFFERENT night → false and starts_at unchanged. Passing null → true and
--      the plan is back on the 9:00 PM default.
--   16. THE ANON RSVP CAP IS IDEMPOTENT AT ITS BOUNDARY (round-4, Codex
--      MEDIUM). Fill a plan to 99 anonymous RSVPs, then deliver the same NEW
--      key twice concurrently. Both calls must return true and exactly one row
--      must exist for that key — the second call re-reads its own key inside
--      the lock rather than seeing a full table and reporting an unsent reply
--      that is in fact stored.
--   17. AREA IS ITS OWN FACT (V8-R-NO-003, round-5). set_night_out_area(plan,
--      'Lower East Side') as the OWNER → true and preview_night_out_detail's
--      `area` carries it WHILE decided_bar_id is still null. As a member →
--      false. Passing '' or '   ' → true and the column is NULL (unset, which
--      is one of the requirement's own three states). A 61-character area →
--      false. On a decided plan → false.
--   18. THE DEADLINE IS ENFORCED, NOT DISPLAYED (V8-R-NO-005, round-5).
--      set_night_out_voting_deadline(plan, now() + '1 minute') as the OWNER →
--      true; as a member → false. Before it passes: suggest_night_out_bar,
--      vote_night_out_bar and remove_night_out_suggestion all succeed and
--      get_night_out_voting reports voting_open true. After it passes: all
--      three return FALSE, get_night_out_voting reports voting_open false, and
--      lock_night_out STILL succeeds — locking is the owner's action "whether
--      or not a deadline is set" (V8-R-SOC-007), and it is how a passed
--      deadline resolves. Setting a deadline on a plan whose voting has already
--      closed → false. Passing null → true and the plan is back to "No
--      deadline".
--   19. THE SUGGESTION WRITER IS ON THE SHARED LOCK (round-5, Codex MEDIUM).
--      BEGIN in session A and call suggest_night_out_bar; concurrently call
--      lock_night_out in B. B must BLOCK until A commits, and the locked bar
--      must be chosen from a shortlist that includes A's row. Before this, a
--      suggestion could land on an already-decided plan, where nothing can vote
--      for it or remove it.
--   20. AN EXPIRED INVITATION STOPS ANSWERING (V8-R-INV-001/002, round-5).
--      Set a plan's night far enough back that night_out_media_expires_at has
--      passed, leave its status 'decided', then as ANON:
--      preview_night_out / _detail / _attendees / _shortlist all return ZERO
--      rows, and rsvp_night_out_by_token returns false with no row written.
--      Move the night forward again → all five answer as before.
--   21. AN ANSWER FROM THE LINK REACHES THE PLAN (V8-R-INV-003, round-5).
--      RSVP 'going' as anon under a fresh key, then call
--      get_night_out_anon_rsvps as a MEMBER → (1, 0, 0). As a NON-member →
--      ONE row of zeros, (0, 0, 0). The member board shows the count and no
--      name, because a token-scoped recipient gave none.
--      CORRECTED IN ROUND 6 (Claude gate, MEDIUM): this said "zero rows" for a
--      non-member, which the function cannot produce — it is an ungrouped
--      aggregate and always returns exactly one row. The role predicate in its
--      WHERE clause is what makes every count zero, so nothing leaks; the gate
--      text was simply false, and a checker running it would have reported a
--      failure that was the checklist's, not the code's.
--   20a. ...AND THE LEGACY PREVIEW IS THE ONE THAT DECIDES (round-5 panel,
--      BOTH lanes, HIGH). Item 20's list was false when written: 0068 gated the
--      three bearer functions it ADDED and left 0044's preview_night_out, which
--      is the read the page settles its whole shape on. Re-run item 20 and
--      confirm preview_night_out ITSELF returns zero rows past the horizon —
--      and that get_anon_rsvp_by_token does too, so an expired surface cannot
--      show a stale answer as current. Before this, an expired link rendered
--      the full invitation with live RSVP buttons whose every tap was refused.
--   20b. A CANCELLED PLAN SAYS SO (round-5 panel, Claude gate). Cancel a plan
--      inside its media window, then as an accepted member:
--      night_out_media_window reports state 'cancelled' with is_open FALSE,
--      add_night_out_media refuses, and archive_night_out STILL succeeds —
--      the archive is what a cancellation must not take away. Before this the
--      window read 'open', the recap offered Add-a-photo, the upload succeeded,
--      the attach was refused, and the notice blamed the window.
--   23. RECLAIMED BYTES CANNOT BE PUBLISHED OR ARCHIVED (round-6, Codex, HIGH).
--      In one session: begin; select public.claim_media_for_removal('<media>');
--      leave it OPEN. In a second session as that object's owner:
--      add_night_out_media('<plan>', '<media>') BLOCKS on the row lock (the
--      first session holds it). Commit the first → the second raises 'those
--      bytes have already been reclaimed' and writes no destination. Reverse
--      the order — attach first, then claim — and the claim's recount finds the
--      new destination and reclaims nothing.
--      Same for archive_night_out: hold a claim on one of the night's photos
--      and archive → that photo is absent from saved_night_media and got no
--      'archive' hold; the night's other photos are archived normally.
--   24. THE DEADLINE SETTER IS A SHORTLIST WRITER (round-6, Codex, MEDIUM).
--      Pause a suggestion after it takes the shortlist lock (e.g. with a second
--      session holding pg_advisory_xact_lock on the same key), call
--      set_night_out_voting_deadline(now()) from a third → it BLOCKS rather
--      than committing underneath the suggestion. Before this it returned true
--      immediately and the suggestion landed after voting had closed.
--   25. THE TOP ROW IS THE BAR THE LOCK TAKES (round-6, Codex, MEDIUM).
--      Insert two suggestions with an identical created_at and no votes, then
--      compare: the first row of get_night_out_board and the return of
--      lock_night_out name the SAME bar (the lower bar_id), repeatably.
--   22. THE UNGATED PRIMITIVES ARE NOT REACHABLE (round-4, Claude gate).
--      As an authenticated NON-member and as anon:
--      select public.night_out_scheduled_start('<plan uuid>'),
--      night_out_media_expires_at('<plan uuid>'),
--      night_out_media_window_open('<plan uuid>'),
--      night_out_voting_open('<plan uuid>') and
--      night_out_invite_live('<plan uuid>') must every one be PERMISSION
--      DENIED. The gated readers — night_out_media_window, get_night_out_voting
--      — are how those facts are asked for.
--
-- Rollback (in comments, per convention):
--   * nyc_night_key: re-apply 0053's body (interval '6 hours'). Note this
--     re-introduces a boundary the approved contract does not permit.
--   * shared-night RPCs: re-apply 0016's share_night/unshare_night/
--     get_shared_night bodies and 0035's share_night. Note this restores a
--     live anon grant over another account's handle and legacy tier.
--   * night_presence: drop the RPCs, then night_presence_recipients, then the
--     table. Destructive.
--   * media_read_window: re-apply 0066's body. Note this makes every Night Out
--     photo and every archived photo unreadable through /api/media/:id/url.
--   * media_destinations kind list: re-adding the 4-value check requires every
--     kind='night_out' row to be gone first, which DESTROYS the attachments.
--   * Saved Nights Out: drop the saved_nights_release_holds trigger and its
--     function, then saved_night_media, then saved_nights. Destructive — and it
--     drops the retention holds keeping archived bytes alive, so a sweep
--     afterwards will reclaim photos accounts deliberately kept.
--   * night_out_media_window: drop the function. Note the recap then has no
--     server answer for "is the window open?" and cannot gate its controls
--     without going back to the device clock this file removed.
--   * the media window's LOWER bound: re-apply the round-2 bodies, i.e. replace
--     every night_out_media_window_open(night) with now() <
--     night_out_media_expires_at(night), then drop night_out_media_window_open
--     and night_out_scheduled_start. Note this re-opens the window from midnight
--     of the plan's night — media served for ~35 hours, starting before the
--     start it measures from.
--   * V8-R-NO-002's editable start: drop set_night_out_start, the uuid
--     overloads of night_out_scheduled_start / night_out_media_expires_at /
--     night_out_media_window_open, point every consumer back at the date-taking
--     ones, then drop night_outs.starts_at. DESTRUCTIVE — it discards every
--     start an owner actually chose, and the surfaces go back to asserting
--     9:00 PM for plans that are not at 9:00 PM.
--   * the shared shortlist lock: re-apply 0044's vote_night_out_bar and
--     suggest_night_out_bar bodies. Note this re-opens the races in items 14
--     and 19 above.
--   * V8-R-NO-003's Area: drop set_night_out_area, restore
--     preview_night_out_detail's 3-column form, then drop night_outs.area.
--     DESTRUCTIVE — it discards every area an owner set.
--   * V8-R-NO-005's deadline: drop set_night_out_voting_deadline and
--     get_night_out_voting, replace night_out_voting_open(plan) with the plain
--     status check in all four shortlist writers, then drop
--     night_outs.voting_closes_at and night_out_voting_open. DESTRUCTIVE, and
--     it makes every set deadline unenforced rather than merely unset.
--   * the invitation's lifetime: replace night_out_invite_live(n.id) with the
--     status-only predicate in the four bearer functions, the anon RSVP writer,
--     get_anon_rsvp_by_token, and 0044's preview_night_out (re-apply 0044:860
--     verbatim for that one), then drop night_out_invite_live. Note an old
--     token then serves the whole invitation surface, with live RSVP controls
--     the server refuses, forever.
--   * the cancelled media state: drop the `and n.cancelled_at is null` term and
--     the 'cancelled' case from night_out_media_window. Note the recap then
--     offers Add-a-photo on a cancelled plan, uploads the bytes, has the attach
--     refused, and blames the window.
--   * the members' view of anonymous RSVPs: drop get_night_out_anon_rsvps.
--     Note the answers are then stored and visible to nobody, which is the
--     defect round 4 found.
--   * the bearer contract: drop remove_night_out_suggestion, lock_night_out,
--     preview_night_out_shortlist, preview_night_out_attendees,
--     preview_night_out_detail, get_anon_rsvp_by_token,
--     rsvp_night_out_by_token, then night_out_anon_rsvps. Destructive — the
--     table holds RSVPs from recipients who have no account and therefore no
--     other copy of their answer. Note the surface then falls back to
--     "Sign in to join", which D-C-23 supersedes.
------------------------------------------------------------------------------
