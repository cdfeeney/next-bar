------------------------------------------------------------------------------
-- 0059 — a status is not a version: monotonic revision CAS on the response
------------------------------------------------------------------------------
-- 0057 added an expected-status argument so a caller acting on a stale view is
-- refused. 0058 moved that guard into the UPDATE's own predicate so EvalPlanQual
-- re-checks it under the row lock, closing the CONCURRENCY route.
--
-- Neither closes the REPLAY route, because the thing being compared is a status,
-- and a status is not a version. A row can return to a status it already held,
-- and a delayed duplicate carrying that status matches again:
--
--     1 decline (expected 'pending')  -> declined
--     2 accept  (expected 'declined') -> accepted     <- this request is replayed
--     3 decline (expected 'accepted') -> declined     <- the user's LAST decision
--     4 REPLAY  (expected 'declined') -> accepted     <- overwrites it
--
-- Reproduced against this database on 2026-08-17 (repro-aba-cases-20260817.mjs,
-- cases 1 and 2 RED). Codex filed it as a HIGH on two successive candidates.
--
-- The fix is a counter, not a timestamp. `responded_at` is already on the row
-- and already returned, which makes it tempting, but it is a clock value: equal
-- timestamps and backwards adjustments both break the comparison. A counter is
-- boring and cannot drift.
--
-- WHERE THE INCREMENT LIVES, and why it is not in respond_night_out.
--
-- The invariant that makes this work is "response_revision increases on every
-- change of invite_status". respond_night_out is not the only writer:
-- join_night_out_by_token and decline_night_out_by_token (0048) also write the
-- column. Today both act only on a PENDING row, and nothing ever sets a row back
-- to 'pending', so a (status, revision) pair provably cannot repeat and those
-- two need no change.
--
-- But that argument rests on a property nothing enforces, and the next migration
-- to add a writer would silently break it. So the increment lives in a BEFORE
-- UPDATE trigger on the table instead: every writer inherits it, including
-- writers that do not exist yet. respond_night_out therefore does NOT set the
-- column itself — see night_out_members_bump_revision below.
--
-- Numbered above the live ledger head (0058) per CLAUDE.md. 0055/0056 are taken
-- by the V8-4 branch and are applied nowhere; 0059 is unused on every branch.
-- Revert: REVERT-0059-staging-20260817.sql.
------------------------------------------------------------------------------

-- 1. The counter ------------------------------------------------------------
--
-- not null default 0: every existing row gets 0 and the first response moves it
-- to 1. No backfill, no nullable branch, no "revision unknown" state for a
-- caller to have to reason about.

alter table public.night_out_members
  add column if not exists response_revision integer not null default 0;

comment on column public.night_out_members.response_revision is
  'Monotonic version of this membership''s response. Incremented by the '
  'night_out_members_revision trigger on every change of invite_status, and '
  'compared by respond_night_out so a replayed request carrying an older '
  'revision cannot apply. Never decreases.';

-- 2. The invariant, enforced rather than assumed -----------------------------

create or replace function public.night_out_members_bump_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only a real status change counts. An UPDATE that rewrites the row without
  -- moving invite_status (a responded_at touch, a role change) leaves the
  -- revision alone, so a caller holding the current view stays valid.
  if new.invite_status is distinct from old.invite_status then
    new.response_revision := old.response_revision + 1;
  end if;
  return new;
end;
$$;

revoke all on function public.night_out_members_bump_revision() from public, anon, authenticated;

drop trigger if exists night_out_members_revision on public.night_out_members;
create trigger night_out_members_revision
  before update on public.night_out_members
  for each row execute function public.night_out_members_bump_revision();

-- 3. respond_night_out — the compare-and-swap --------------------------------
--
-- Body is 0058's, with the revision joining the status in BOTH the pre-read
-- refusal and the write predicate. 0058's lesson holds: the guard belongs in the
-- WRITE, not only the read.

create or replace function public.respond_night_out(
  p_night_out uuid,
  p_accept boolean,
  p_expected_status text,
  p_expected_revision integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new text := case when p_accept then 'accepted' else 'declined' end;
  v_current text;
  v_revision integer;
  v_changed boolean;
begin
  if v_uid is null or p_night_out is null or p_accept is null then
    return false;
  end if;
  if p_expected_status is null
     or p_expected_status not in ('pending', 'accepted', 'declined') then
    return false;
  end if;
  -- A revision is required and cannot be negative. There is deliberately no
  -- "null means do not check" escape: that is how 0057's 2-argument overload
  -- became a problem, and the 3-argument form is dropped below for the same
  -- reason.
  if p_expected_revision is null or p_expected_revision < 0 then
    return false;
  end if;
  -- A cancelled plan takes no further responses.
  if not exists (
    select 1 from public.night_outs n
     where n.id = p_night_out and n.status <> 'cancelled'
  ) then
    return false;
  end if;

  if p_accept then
    -- Same lock every other membership-count decision takes, held for the
    -- read-then-write below so two rejoins cannot both see room for one seat.
    perform pg_advisory_xact_lock(
      hashtextextended('night_out_members:' || p_night_out::text, 0));
  end if;

  select m.invite_status, m.response_revision
    into v_current, v_revision
    from public.night_out_members m
   where m.night_out_id = p_night_out and m.user_id = v_uid;

  if v_current is null then
    return false;  -- not a member; nothing to respond to
  end if;
  if v_current <> p_expected_status or v_revision <> p_expected_revision then
    -- The caller acted on a state that is no longer true. Comparing the
    -- REVISION as well as the status is the whole point: a status can come
    -- back, a revision cannot. Equality, not >= and not <>, so a revision from
    -- the future is refused too.
    return false;
  end if;

  if p_accept and v_current = 'declined'
     and public.night_out_seat_count(p_night_out) >= public.night_out_member_cap() then
    return false;  -- rejoining is taking a seat, and there is none
  end if;

  -- response_revision is NOT set here: the night_out_members_revision trigger
  -- owns the increment so that every writer of invite_status gets it.
  update public.night_out_members m
     set invite_status = v_new, responded_at = now()
   where m.night_out_id = p_night_out
     and m.user_id = v_uid
     and m.role <> 'owner'                    -- the owner cannot decline their own plan
     and m.invite_status = p_expected_status  -- the guard belongs in the WRITE, not only the read
     and m.response_revision = p_expected_revision
     and m.invite_status <> v_new;
  v_changed := found;
  if v_changed and p_accept then
    insert into public.night_out_events (night_out_id, actor_id, kind)
    values (p_night_out, v_uid, 'accepted');
  end if;
  -- true when the row ends at the requested state (changed OR already there).
  -- "Already there" is only reachable now by a caller whose revision MATCHED,
  -- i.e. a genuine double-tap on a current view — a replay was refused above.
  return v_changed or exists (
    select 1 from public.night_out_members m
     where m.night_out_id = p_night_out
       and m.user_id = v_uid
       and m.invite_status = v_new
  );
end;
$$;

-- The 3-argument form goes, exactly as 0057 dropped the 2-argument one. This is
-- the enforcement, not cleanup: leaving it would let any caller opt out of the
-- revision check by omission. Safe to drop — verified 2026-08-17 that the
-- deployed build (sha 6ec5e5d, 2026-08-04) contains no night-out surface and
-- never calls it.
drop function if exists public.respond_night_out(uuid, boolean, text);

revoke all on function public.respond_night_out(uuid, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.respond_night_out(uuid, boolean, text, integer) to authenticated;

-- 4. The two reads that feed the two response surfaces -----------------------
--
-- A revision the UI never renders cannot be passed back, so a caller would have
-- to re-read at click time — which re-creates the ABA window inside the client.
-- Both readers return it; both callers pass what they rendered.
--
-- These are DROPPED and recreated rather than replaced: PostgreSQL cannot
-- `create or replace` a function whose RETURNS TABLE gains a column. Dropping
-- resets the ACL, so the revoke/grant is re-issued for each.

drop function if exists public.get_night_out(uuid);

create function public.get_night_out(p_night_out uuid)
returns table (
  id uuid,
  night date,
  title text,
  status text,
  decided_bar_id text,
  owner_handle text,
  owner_display_name text,
  share_token uuid,
  caller_role text,
  caller_status text,
  caller_revision integer
)
language sql
stable
security definer
set search_path = public
as $$
  with me as materialized (
    select m.role, m.invite_status, m.response_revision
      from public.night_out_members m
     where m.night_out_id = p_night_out and m.user_id = auth.uid()
     limit 1
  )
  select n.id, n.night, n.title, n.status, n.decided_bar_id,
         p.handle::text, p.display_name::text,
         case when me.invite_status = 'accepted' then n.share_token end,
         me.role, me.invite_status, me.response_revision
    from public.night_outs n
    join public.profiles p on p.id = n.owner_id
    cross join me           -- no member row → zero rows (criterion 3)
   where n.id = p_night_out;
$$;

revoke all on function public.get_night_out(uuid) from public, anon, authenticated;
grant execute on function public.get_night_out(uuid) to authenticated;

drop function if exists public.get_my_night_outs();

create function public.get_my_night_outs()
returns table (
  night_out_id uuid,
  night date,
  title text,
  status text,
  owner_handle text,
  owner_display_name text,
  my_status text,
  responded_at timestamptz,
  accepted_count integer,
  share_token uuid,
  plan_updated boolean,
  is_past boolean,
  my_revision integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    n.id,
    n.night,
    n.title,
    n.status,
    p.handle::text,
    p.display_name::text,
    me.invite_status,
    me.responded_at,
    (select count(*)::integer
       from public.night_out_members a
      where a.night_out_id = n.id and a.invite_status = 'accepted'),
    case when me.invite_status = 'accepted' then n.share_token end,
    exists (
      select 1 from public.night_out_events e
       where e.night_out_id = n.id
         and e.kind = 'plan_changed'
         and me.responded_at is not null
         and e.created_at > me.responded_at
    ),
    n.night < public.nyc_night_key(),
    me.response_revision
  from public.night_out_members me
  join public.night_outs n on n.id = me.night_out_id
  join public.profiles p on p.id = n.owner_id
  where me.user_id = auth.uid()
    and n.owner_id <> auth.uid()   -- invitations, not your own plans
    and n.status <> 'cancelled'
  order by
    case when me.invite_status = 'pending' then 0 else 1 end,
    -- SOONEST first. 0052 said "soonest" in its comment and sorted DESC; the
    -- comment was right and the code was wrong (cold panel, Claude, medium).
    n.night asc,
    n.id desc
$$;

revoke all on function public.get_my_night_outs() from public, anon, authenticated;
grant execute on function public.get_my_night_outs() to authenticated;
