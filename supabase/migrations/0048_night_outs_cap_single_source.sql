------------------------------------------------------------------------------
-- 0048_night_outs_cap_single_source.sql — one definition of "a seat"
------------------------------------------------------------------------------
-- Fifth file, same rule: 0044-0047 are applied and checksum-recorded, so they
-- are immutable and corrections are additive. Apply the run in ONE transaction
-- on a database that has none of them.
--
-- (Fresh-cycle round-1 MEDIUM, Claude) The member cap (20) and the rule for
-- what occupies a seat (`invite_status <> 'declined'`) were written out four
-- times across two files that can never be edited again — 0046's join, decline
-- and respond, and 0047's night_out_is_full_by_token. Four copies of a rule
-- that MUST agree, in files nobody can go back and change together, is a drift
-- bug with a delivery date: the next person to change the cap edits the one
-- they found and ships a UI that says "full" at a number the RPCs do not
-- enforce, or worse, the reverse.
--
-- This file introduces the two helpers and re-states the four functions to
-- call them. The bodies are otherwise UNCHANGED — this is a mechanical
-- substitution of two expressions, deliberately not an opportunity to improve
-- anything else.
------------------------------------------------------------------------------

-- The cap. IMMUTABLE so the planner can fold it; no table access.
create or replace function public.night_out_member_cap()
returns integer
language sql
immutable
as $$ select 20 $$;

-- What occupies a seat. A declined member does not: they opted out, and
-- holding capacity against them let 20 "Not tonight" taps brick a plan.
create or replace function public.night_out_seat_count(p_night_out uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.night_out_members m
   where m.night_out_id = p_night_out
     and m.invite_status <> 'declined'
$$;

-- Internal helpers: only the SECURITY DEFINER RPCs call them, and those run as
-- the owner. No client role needs execute.
revoke all on function public.night_out_member_cap() from public, anon, authenticated;
revoke all on function public.night_out_seat_count(uuid) from public, anon, authenticated;

------------------------------------------------------------------------------
-- The four callers, re-stated with the literals replaced. Nothing else changed.
------------------------------------------------------------------------------

create or replace function public.join_night_out_by_token(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
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

  -- Fast path (optimisation only): a PENDING invite accepts, because tapping
  -- the link is what accepting means. A DECLINED member merely VISITING is
  -- NOT silently re-accepted. An accepted member just lands on the plan.
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

  -- Re-read under the lock. A row here is the racing invite that committed
  -- between the fast path and the lock. Converting it consumes no capacity,
  -- so this returns BEFORE the cap check — that ordering is the fix.
  update public.night_out_members m
     set invite_status = 'accepted', responded_at = now()
   where m.night_out_id = v_id
     and m.user_id = v_uid
     and m.invite_status = 'pending';
  if found then
    insert into public.night_out_events (night_out_id, actor_id, kind)
    values (v_id, v_uid, 'accepted');
    return v_id;
  end if;
  if exists (
    select 1 from public.night_out_members m
     where m.night_out_id = v_id and m.user_id = v_uid
  ) then
    return v_id;  -- already accepted, or declined and not to be re-accepted here
  end if;

  if public.night_out_seat_count(v_id) >= public.night_out_member_cap() then
    return null;
  end if;

  insert into public.night_out_members
    (night_out_id, user_id, invite_status, responded_at)
  values (v_id, v_uid, 'accepted', now());
  insert into public.night_out_events (night_out_id, actor_id, kind)
  values (v_id, v_uid, 'accepted');
  return v_id;
end;
$$;

create or replace function public.decline_night_out_by_token(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
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

  -- Serialised so a concurrent invite cannot be lost, with NO cap check: a
  -- declined row occupies no seat, so declining is never rationed.
  perform pg_advisory_xact_lock(
    hashtextextended('night_out_members:' || v_id::text, 0));

  update public.night_out_members m
     set invite_status = 'declined', responded_at = now()
   where m.night_out_id = v_id
     and m.user_id = v_uid
     and m.invite_status = 'pending';
  if found then
    return v_id;
  end if;
  if exists (
    select 1 from public.night_out_members m
     where m.night_out_id = v_id and m.user_id = v_uid
  ) then
    return v_id;
  end if;

  insert into public.night_out_members
    (night_out_id, user_id, invite_status, responded_at)
  values (v_id, v_uid, 'declined', now());
  return v_id;
end;
$$;

create or replace function public.respond_night_out(
  p_night_out uuid,
  p_accept boolean
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
  v_changed boolean;
begin
  if v_uid is null or p_night_out is null or p_accept is null then
    return false;
  end if;
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
    select m.invite_status into v_current
      from public.night_out_members m
     where m.night_out_id = p_night_out and m.user_id = v_uid;
    if v_current = 'declined'
       and public.night_out_seat_count(p_night_out) >= public.night_out_member_cap() then
      return false;  -- rejoining is taking a seat, and there is none
    end if;
  end if;

  update public.night_out_members m
     set invite_status = v_new, responded_at = now()
   where m.night_out_id = p_night_out
     and m.user_id = v_uid
     and m.role <> 'owner'          -- the owner cannot decline their own plan
     and m.invite_status <> v_new;
  v_changed := found;
  if v_changed and p_accept then
    insert into public.night_out_events (night_out_id, actor_id, kind)
    values (p_night_out, v_uid, 'accepted');
  end if;
  return v_changed or exists (
    select 1 from public.night_out_members m
     where m.night_out_id = p_night_out
       and m.user_id = v_uid
       and m.invite_status = v_new
  );
end;
$$;

create or replace function public.night_out_is_full_by_token(p_token uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or p_token is null then
    return false;
  end if;
  select n.id into v_id
    from public.night_outs n
   where n.share_token = p_token
     and n.status in ('draft', 'open', 'decided');
  if v_id is null then
    return false;  -- an unresolvable token is not "full", it is unavailable
  end if;
  -- The SAME question the RPCs ask, now literally the same code path: this is
  -- what stops the UI reporting a threshold the database does not enforce.
  return public.night_out_seat_count(v_id) >= public.night_out_member_cap();
end;
$$;

revoke all on function public.night_out_is_full_by_token(uuid) from public, anon, authenticated;
grant execute on function public.night_out_is_full_by_token(uuid) to authenticated;
revoke all on function public.join_night_out_by_token(uuid) from public, anon, authenticated;
grant execute on function public.join_night_out_by_token(uuid) to authenticated;
revoke all on function public.decline_night_out_by_token(uuid) from public, anon, authenticated;
grant execute on function public.decline_night_out_by_token(uuid) to authenticated;
revoke all on function public.respond_night_out(uuid, boolean) from public, anon, authenticated;
grant execute on function public.respond_night_out(uuid, boolean) to authenticated;
