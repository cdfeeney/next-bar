------------------------------------------------------------------------------
-- 0060_nyc_night_key_sweep.sql — the LAST five `current_date ± 2` guards
------------------------------------------------------------------------------
-- Additive correction, and AUTHOR-ONLY: this branch does not apply it. Numbered
-- above the highest file here (0059) per CLAUDE.md.
--
-- ⚠ PREREQUISITE: 0053 MUST BE LIVE. Every body below calls
-- `public.nyc_night_key(timestamptz)`, which nothing before 0053 creates. Apply
-- this file to a database that never received 0053 and all five RPCs start
-- failing at their FIRST call with errcode 42883 (undefined_function) — a
-- working guard replaced by a broken one. Confirm the function exists before
-- applying, not after.
--
-- ⚠ READ THE LEDGER BEFORE APPLYING. This file cannot tell you which of its
-- five predecessors are live, and the repository disagrees with itself about
-- that: `public.schema_migrations` (created by 0036) is the only authority, and
-- CLAUDE.md records that eleven of this branch's 0000-0010 files no longer match
-- the checksums recorded there. 0035's own header states "NOT APPLIED. The live
-- ledger ends at 0032; 0033, 0034 and now 0035 are authored and reviewed only",
-- and 0044 is likewise marked author-only.
--
-- That has a consequence this file must not hide. If 0035 was never applied, the
-- live `share_night` is 0016's body, which has NO date validation at all — so
-- for that ONE function this file does not swap a guard, it introduces 0035's
-- ±2 bound for the first time, and a share_night call outside the window that
-- used to return a token starts raising errcode 22023. That is 0035's intended
-- change (it is an anti-amplification bound, see its header), but an operator
-- applying this file must know they are landing it. The other four functions
-- (0011, 0012, 0013, 0017) are pure swaps — given the prerequisite above, and
-- given that their own files are the live definitions.
--
-- (Round-1 panel, BOTH lanes: Codex medium + Claude/OPUS medium) 0053 swept
-- `current_date` out of the two places it appeared in a night_outs definition
-- (0052 get_my_night_outs, 0044 create_night_out) and declared "every
-- `current_date` that meant which night is it is replaced". It was not: the
-- ±2-day sanity window in the FIVE older night-scoped writers was never in that
-- sweep and still resolves against the UTC date.
--
--   suggest_bar     (0011)  current_date ± 2
--   rsvp_bar        (0012)  current_date ± 2
--   unrsvp_bar      (0013)  current_date ± 2   <- named in this goal's spec
--   cast_vibe_vote  (0017)  current_date ± 2
--   share_night     (0035)  current_date ± 2
--
-- The failure is the same one 0053 was written for, one window narrower. NYC is
-- UTC-4 in summer, so from 20:00 NYC the UTC date has already advanced. At
-- Friday 9pm EDT `public.nyc_night_key()` is Friday while `current_date` is
-- already Saturday, so the accepted window has silently slid one day forward:
-- the authoritative lower bound (Wednesday) is REJECTED and an out-of-range
-- upper bound (next Monday) is ADMITTED. RSVP and un-RSVP share the bound, so
-- the same evening a user can RSVP to a night they can no longer un-RSVP from
-- once the window slides — which is why all five move together rather than only
-- the one the goal spec named.
--
-- Each body below is the definition in THIS REPOSITORY verbatim, with the
-- guard's two `current_date` references replaced by `public.nyc_night_key()`
-- (0053) and the surrounding comment corrected. Relative to those files nothing
-- else changes: no signature, no grant, no lock key, no conflict target.
-- `create or replace function` is idempotent. Relative to a DATABASE that never
-- received 0035, see the share_night note above.
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. suggest_bar (0011) — the suggestion window is an NYC night
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
  -- far-future or ancient date (client clock skew tolerance: ±2 NYC nights).
  if night < (public.nyc_night_key() - 2) or night > (public.nyc_night_key() + 2) then
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
-- 2. rsvp_bar (0012) — same window, same definition
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
  if night < (public.nyc_night_key() - 2) or night > (public.nyc_night_key() + 2) then
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
-- 3. unrsvp_bar (0013) — RSVP and un-RSVP must accept the SAME nights
------------------------------------------------------------------------------

create or replace function public.unrsvp_bar(bar text, night date)
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
  if night < (public.nyc_night_key() - 2) or night > (public.nyc_night_key() + 2) then
    return false;
  end if;
  if bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;

  -- Same lock key as rsvp_bar (0012): all of a user's RSVP writes are
  -- serialized through one advisory lock, closing the cross-tab race.
  perform pg_advisory_xact_lock(hashtextextended('bar_rsvps:' || uid::text, 0));

  delete from public.bar_rsvps r
   where r.user_id = uid
     and r.bar_id = unrsvp_bar.bar
     and r.night = unrsvp_bar.night;

  -- True even when no row matched: "I'm out" of a bar you're not in is
  -- a satisfied request, and the client treats false as a shown error.
  return true;
end;
$$;

revoke all on function public.unrsvp_bar(text, date) from public, anon;
grant execute on function public.unrsvp_bar(text, date) to authenticated;

------------------------------------------------------------------------------
-- 4. cast_vibe_vote (0017) — the vote window is an NYC night
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
  -- Opaque-key sanity bound: tonight-ish only (client clock skew ±2 NYC nights).
  if p_night < (public.nyc_night_key() - 2) or p_night > (public.nyc_night_key() + 2) then
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
-- 5. share_night (0035) — the anti-amplification window is an NYC night
------------------------------------------------------------------------------

create or replace function public.share_night(
  p_night date,
  p_bar_ids text[],
  p_loved_bar_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_token uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_night is null then
    raise exception 'night required' using errcode = '22004';
  end if;
  -- C4 F1: tonight-ish only (client clock skew ±2 NYC nights), the same bound
  -- suggest_bar/rsvp_bar/cast_vibe_vote already enforce. Without it the
  -- (user_id, night) primary key turns every distinct date into a new row.
  if p_night < (public.nyc_night_key() - 2) or p_night > (public.nyc_night_key() + 2) then
    raise exception 'night must be within 2 days of today' using errcode = '22023';
  end if;
  -- The route must be real: 1..20 non-empty ids.
  if p_bar_ids is null
     or array_length(p_bar_ids, 1) is null
     or array_length(p_bar_ids, 1) > 20 then
    raise exception 'route must have 1-20 bars' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_bar_ids) as b(id)
     where b.id is null or length(trim(b.id)) = 0 or length(b.id) > 100
  ) then
    raise exception 'invalid bar id in route' using errcode = '22023';
  end if;
  -- The E4.2 client rule ("Loved must be ON the route") enforced at the
  -- boundary, because a direct RPC caller is not the client.
  if p_loved_bar_id is not null
     and array_position(p_bar_ids, p_loved_bar_id) is null then
    raise exception 'loved bar must be on the route' using errcode = '22023';
  end if;

  insert into public.shared_nights (user_id, night, bar_ids, loved_bar_id)
  values (v_uid, p_night, p_bar_ids, p_loved_bar_id)
  on conflict on constraint shared_nights_pkey
  do update set
    bar_ids      = excluded.bar_ids,
    loved_bar_id = excluded.loved_bar_id,
    shared_at    = now()
    -- share_token deliberately untouched: re-sharing must not kill
    -- links already sent.
  returning share_token into v_token;
  return v_token;
end;
$$;

revoke all on function public.share_night(date, text[], text) from public, anon, authenticated;
grant execute on function public.share_night(date, text[], text) to authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention): re-apply each function body from its
-- source file above (0011, 0012, 0013, 0017, 0035). That restores the UTC
-- `current_date` window, i.e. reintroduces the defect — only do it to unblock a
-- deploy, never as a fix.
------------------------------------------------------------------------------
