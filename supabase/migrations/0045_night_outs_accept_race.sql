------------------------------------------------------------------------------
-- 0045_night_outs_accept_race.sql — V8-3 round-1 panel fixes
------------------------------------------------------------------------------
-- WHY THIS IS A NEW FILE AND NOT AN EDIT TO 0044:
-- 0044_night_outs.sql is APPLIED. `public.schema_migrations` holds its name and
-- its checksum (verified 2026-08-16 against the staging ledger). Editing an
-- applied file changes that checksum and reintroduces exactly the file-vs-
-- ledger divergence that caused the migration fork. Applied migrations are
-- immutable; corrections are additive. Everything below is
-- `create or replace function`, so it is idempotent and carries no DDL on data.
--
-- APPLY GATE — read this, not the checklist inside 0044:
--   * `npm run db:migrate` is LEDGER-BLIND and must never touch a shared
--     database. As of this migration it refuses one outright (see
--     scripts/apply-migrations.ts).
--   * Apply this file with nb-overnight's ledger-aware runner, or by hand
--     after checking `public.schema_migrations` and numbering above its max.
--   * Reverting is re-running 0044's definitions of the four functions below.
--
-- Fixes, in the order the panel raised them:
--   1. (Codex HIGH, criterion 8) An explicit accept or decline made through a
--      bearer link could be silently lost.
--   2. (Claude MEDIUM) member_cap counted declined rows, so people who opted
--      out permanently consumed join capacity.
--   3. (Claude MEDIUM) get_night_out returned share_token to a member of ANY
--      status, so a declined stranger could re-read a rotated token.
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. The lost-accept race (criterion 8)
------------------------------------------------------------------------------
-- Reproduced deterministically on staging 2026-08-16 before this fix:
--   A: invite_to_night_out(plan, U)      -- takes the advisory lock, inserts
--                                        -- 'pending', holds the transaction
--   B: join_night_out_by_token(token)    -- membership check runs BEFORE the
--                                        -- lock, sees no row, blocks on A
--   A: COMMIT                            -- 'pending' becomes visible
--   B: proceeds, INSERT hits the pkey, `on conflict do nothing` swallows it
-- Result: B returned the plan id (success to the caller) while the stored
-- state stayed 'pending' with no 'accepted' event. The user tapped "I'm in"
-- and the database recorded nothing.
--
-- The pre-lock check is not the bug and is not removed — it is the fast path
-- for the overwhelmingly common already-a-member case. The bug is that the
-- post-lock INSERT treats a row that appeared in between as "nothing to do",
-- when it is precisely the row this call was about to write. DO UPDATE resolves
-- it against the same terminal state the fast path would have set.
--
-- The status guard in the WHERE clause is load-bearing and preserves the
-- round-1 finding it was written for: a DECLINED member visiting the link is
-- still NOT silently re-accepted. Only a 'pending' row converts.

create or replace function public.join_night_out_by_token(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  member_cap constant integer := 20;
  v_uid uuid := auth.uid();
  v_id uuid;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';  -- criterion 6
  end if;
  select n.id into v_id
    from public.night_outs n
   where n.share_token = p_token
     and n.status in ('draft', 'open', 'decided');
  if v_id is null then
    return null;
  end if;

  -- Fast path: an existing PENDING invite accepts (that is what tapping the
  -- link means); a DECLINED member merely VISITING must NOT be re-accepted
  -- (visiting is not consenting — the plan page offers an explicit control
  -- that goes through respond_night_out); an accepted member just lands.
  if exists (
    select 1 from public.night_out_members m
     where m.night_out_id = v_id and m.user_id = v_uid
  ) then
    update public.night_out_members m
       set invite_status = 'accepted', responded_at = now()
     where m.night_out_id = v_id
       and m.user_id = v_uid
       and m.invite_status = 'pending';
    if found then
      insert into public.night_out_events (night_out_id, actor_id, kind)
      values (v_id, v_uid, 'accepted');
    end if;
    return v_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('night_out_members:' || v_id::text, 0));
  -- Cap excludes declined rows: someone who said "not tonight" is not
  -- occupying a seat (fix 2).
  select count(*) into v_count
    from public.night_out_members m
   where m.night_out_id = v_id
     and m.invite_status <> 'declined';
  if v_count >= member_cap then
    return null;
  end if;

  -- A row that appeared between the check above and this INSERT is the racing
  -- invite. Converting a 'pending' row here is the same transition the fast
  -- path performs; anything else (already accepted, or declined) is left alone.
  insert into public.night_out_members
    (night_out_id, user_id, invite_status, responded_at)
  values (v_id, v_uid, 'accepted', now())
  on conflict on constraint night_out_members_pkey do update
     set invite_status = 'accepted', responded_at = now()
   where night_out_members.invite_status = 'pending';

  -- Event only on a real insert or a real conversion. A conflict whose WHERE
  -- excluded the row updates nothing, so the loser still emits no event.
  if found then
    insert into public.night_out_events (night_out_id, actor_id, kind)
    values (v_id, v_uid, 'accepted');
  end if;
  return v_id;
end;
$$;

-- decline_night_out_by_token carries the identical shape and therefore the
-- identical defect: a concurrent invite makes an explicit "Not tonight"
-- disappear. Fixing only the join path would have left the sibling broken.
create or replace function public.decline_night_out_by_token(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  member_cap constant integer := 20;
  v_uid uuid := auth.uid();
  v_id uuid;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';  -- criterion 6
  end if;
  select n.id into v_id
    from public.night_outs n
   where n.share_token = p_token
     and n.status in ('draft', 'open', 'decided');
  if v_id is null then
    return null;
  end if;

  -- Only a PENDING invite is turned down here. An accepted member uses
  -- respond_night_out; an already-declined member is a no-op.
  if exists (
    select 1 from public.night_out_members m
     where m.night_out_id = v_id and m.user_id = v_uid
  ) then
    update public.night_out_members m
       set invite_status = 'declined', responded_at = now()
     where m.night_out_id = v_id
       and m.user_id = v_uid
       and m.invite_status = 'pending';
    return v_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('night_out_members:' || v_id::text, 0));
  select count(*) into v_count
    from public.night_out_members m
   where m.night_out_id = v_id
     and m.invite_status <> 'declined';
  if v_count >= member_cap then
    return null;
  end if;

  insert into public.night_out_members
    (night_out_id, user_id, invite_status, responded_at)
  values (v_id, v_uid, 'declined', now())
  on conflict on constraint night_out_members_pkey do update
     set invite_status = 'declined', responded_at = now()
   where night_out_members.invite_status = 'pending';
  return v_id;
end;
$$;

------------------------------------------------------------------------------
-- 2. member_cap no longer counts people who opted out
------------------------------------------------------------------------------
-- invite_to_night_out shares the cap; 20 "Not tonight" taps on a widely shared
-- link used to brick the plan for its actual invitees, with no removal path and
-- no recourse but cancelling.

create or replace function public.invite_to_night_out(
  p_night_out uuid,
  p_user uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  member_cap constant integer := 20;
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null or p_night_out is null or p_user is null then
    return false;
  end if;
  if public.night_out_role(p_night_out) is null then
    return false; -- criterion 3/10: nonmembers cannot act
  end if;
  if not exists (
    select 1 from public.night_outs n
     where n.id = p_night_out and n.status in ('draft', 'open')
  ) then
    return false;
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    return false;
  end if;

  -- Duplicate invite: idempotent no-op that must NOT lose a later state
  -- change (criterion 8) — an existing row of ANY status is left alone.
  if exists (
    select 1 from public.night_out_members m
     where m.night_out_id = p_night_out and m.user_id = p_user
  ) then
    return true;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('night_out_members:' || p_night_out::text, 0));

  select count(*) into v_count
    from public.night_out_members m
   where m.night_out_id = p_night_out
     and m.invite_status <> 'declined';
  if v_count >= member_cap then
    return false;
  end if;

  -- Unchanged: an invite must never overwrite a state the user chose. If a row
  -- appeared in between, the user acted, and their action wins.
  insert into public.night_out_members
    (night_out_id, user_id, invited_by)
  values (p_night_out, p_user, v_uid)
  on conflict on constraint night_out_members_pkey do nothing;

  if found then
    insert into public.night_out_events (night_out_id, actor_id, kind)
    values (p_night_out, v_uid, 'invited');
  end if;
  return true;
end;
$$;

------------------------------------------------------------------------------
-- 3. share_token is for accepted members only
------------------------------------------------------------------------------
-- Previously any member row exposed share_token, so a stranger who tapped
-- "Not tonight" (which creates a 'declined' row and hands their client the
-- plan id) could re-read the token after the owner rotated it — defeating the
-- rotation. Pending invitees do not need it either: they reached the plan
-- through the link they already hold.

create or replace function public.get_night_out(p_night_out uuid)
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
  caller_status text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as materialized (
    select m.role, m.invite_status
      from public.night_out_members m
     where m.night_out_id = p_night_out and m.user_id = auth.uid()
     limit 1
  )
  select n.id, n.night, n.title, n.status, n.decided_bar_id,
         p.handle::text, p.display_name::text,
         case when me.invite_status = 'accepted' then n.share_token end,
         me.role, me.invite_status
    from public.night_outs n
    join public.profiles p on p.id = n.owner_id
    cross join me           -- no member row → zero rows (criterion 3)
   where n.id = p_night_out;
$$;
