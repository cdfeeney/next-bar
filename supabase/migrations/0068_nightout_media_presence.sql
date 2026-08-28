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
--  3. There is no block model to gate on. This branch contains no blocks table
--     and no block relationship in any migration. A gate written here would
--     have to invent the model the decision is supposedly about.
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
-- THE SCHEDULED START OF A NIGHT OUT IS THE START OF THE NIGHT IT IS SCHEDULED
-- FOR, and that instant is already defined: `public.night_outs` schedules a plan
-- against a `night date`, never against a time, and section 1 fixes when a night
-- begins — 4:00 AM America/New_York, DST-aware (V8-R-PRE-005 / D-C-39).
--
-- This is the only reading available that invents no number. The alternatives
-- were weighed and are recorded so nobody re-opens this by accident:
--   * `night_outs.created_at` — when the plan was MADE. A plan made three days
--     ahead would have a window that closed before the night started.
--   * a chosen evening hour (8pm, say) — a product decision this lane has no
--     authority to mint, and the contract names no hour.
--
-- ⚠ ATTENDED DECISION FLAGGED, NOT SILENTLY SETTLED. Under this derivation a
-- photo taken at 11pm is readable until 4:00 AM — about five hours, not
-- twenty-four — because the night it belongs to started nineteen hours earlier.
-- The arithmetic is exactly "24 hours from the scheduled start"; it is the
-- SCHEDULE that is coarse, because the schema has no start time to be precise
-- with. If the product wants a longer tail, the fix is a real `starts_at` on
-- `night_outs` and this function reading it — one function, one call site. The
-- direction this errs in is the safe one for a privacy-bearing photo surface.

create or replace function public.night_out_media_expires_at(p_night date)
returns timestamptz
language sql
immutable
as $$
  select ((p_night + interval '4 hours') at time zone 'America/New_York')
         + interval '24 hours'
$$;

comment on function public.night_out_media_expires_at(date) is
  'V8-R-NO-008. When Night Out media for this night stops being served: the '
  'night''s own 4:00 AM America/New_York start plus 24 hours. Measured from the '
  'SCHEDULED START, never from capture or publication. The single definition — '
  'add_night_out_media, get_night_out_media and media_read_window all call it.';

revoke all on function public.night_out_media_expires_at(date) from public, anon, authenticated;
grant execute on function public.night_out_media_expires_at(date) to authenticated;

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
  if now() >= public.night_out_media_expires_at(v_night) then
    raise exception 'the night out media window has closed' using errcode = '22023';
  end if;

  -- OWN BYTES ONLY. Without this any member could attach another account's
  -- object by id and hand the whole plan a read window over it.
  if not exists (
    select 1 from public.media_objects m
     where m.id = p_media
       and m.owner_id = v_uid
       and m.bytes_removed_at is null
  ) then
    raise exception 'that media is not yours' using errcode = '42501';
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
         public.night_out_media_expires_at(n.night)
    from public.media_destinations d
    join public.night_outs n on n.id::text = d.ref_id
    join public.media_objects m on m.id = d.media_id
   where d.kind = 'night_out'
     and d.removed_at is null
     and n.id = p_night_out
     and m.bytes_removed_at is null
     and public.night_out_role(p_night_out) is not null
     and now() < public.night_out_media_expires_at(n.night)
   order by d.created_at asc
$$;

comment on function public.get_night_out_media(uuid) is
  'V8-R-NO-008. Live Night Out media for an ACCEPTED member, empty once the '
  '24-hour window from the scheduled start has closed. The window is applied '
  'here, not reported for the client to honour.';

revoke all on function public.get_night_out_media(uuid) from public, anon;
grant execute on function public.get_night_out_media(uuid) to authenticated;


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
-- 6a. archive_night_out — the private archive action
------------------------------------------------------------------------------
-- "A failed archive must not report success, and must not consume the window."
-- Everything below happens in ONE transaction: the saved night, its ordered
-- media list and the retention holds all commit together or not at all, so a
-- partial archive cannot exist to be reported as a whole one.
--
-- Only media that is LIVE RIGHT NOW is archived — get_night_out_media's own
-- window applies. Archiving after the window has closed archives nothing and
-- says so by returning a zero photo count rather than by pretending.

create or replace function public.archive_night_out(p_night_out uuid)
returns table (saved_night_id uuid, photo_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_night date;
  v_title text;
  v_bars  integer;
  v_saved uuid;
  v_count integer;
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

  -- THE ORDERED LIST. `sort_order` is the attachment order, so the archive
  -- opens in the order the night actually happened.
  insert into public.saved_night_media (saved_night_id, media_id, sort_order)
  select v_saved,
         live.media_id,
         (row_number() over (order by live.created_at))::integer
    from public.get_night_out_media(p_night_out) live
  on conflict on constraint saved_night_media_pkey do nothing;

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
  'retention hold per object. Idempotent: re-archiving tops the same card up.';

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
  select max(public.night_out_media_expires_at(n.night))
    into v_expiry
    from public.media_destinations d
    join public.media_objects m on m.id = d.media_id
    join public.night_outs n on n.id::text = d.ref_id
   where d.kind = 'night_out'
     and d.removed_at is null
     and m.storage_path = p_name
     and m.bytes_removed_at is null
     and public.night_out_role(n.id) is not null
     and now() < public.night_out_media_expires_at(n.night);

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
--   8. SAVED NIGHTS OUT (V8-R-NO-009 / V8-R-ACC-002): archive_night_out as a
--      member returns a photo_count matching the live media; get_saved_nights
--      returns that card for the archiver and NOTHING for anyone else;
--      get_saved_night(id) as another account returns zero rows. Call
--      delete_media_everywhere on an archived object as its author →
--      remaining_references is non-zero and the bytes are NOT reclaimable, and
--      the archiver can still read it through media_read_window. Re-run
--      archive_night_out → the same saved night id, no duplicate card.
--   9. media_read_window: as an accepted member on a live night-out path →
--      (true, the window); the same call after the window closes → falls through
--      to the story/owner branches and does not authorise on night-out grounds.
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
--   * Saved Nights Out: drop saved_night_media, then saved_nights. Destructive —
--     and it drops the retention holds keeping archived bytes alive, so a sweep
--     afterwards will reclaim photos accounts deliberately kept.
------------------------------------------------------------------------------
