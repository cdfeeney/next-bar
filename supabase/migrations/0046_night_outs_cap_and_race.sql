------------------------------------------------------------------------------
-- 0046_night_outs_cap_and_race.sql — V8-3 round-2 panel fixes
------------------------------------------------------------------------------
-- A THIRD file for one feature, and the reason is the same as last time:
-- 0045_night_outs_accept_race.sql is applied to staging and recorded in
-- public.schema_migrations with its checksum. Applied migrations are immutable;
-- corrections are additive. Everything here is `create or replace function`.
--
-- APPLY NOTE FOR THE PRODUCTION GATE: 0045 and 0046 must be applied in the SAME
-- transaction. 0045's definitions carry the defects fixed below, so on a
-- database that has neither, applying them together means the intermediate
-- state is never observable.
--
-- Round 2 found that 0045 fixed the reported symptom and introduced three new
-- problems plus left the original defect alive at the boundary. All four, and
-- both remaining findings, are closed here.
--
-- 1. (Codex HIGH) The lost-accept race SURVIVED at the cap boundary. 0045 fixed
--    the INSERT half of a check-then-act pair and left the COUNT half standing
--    in front of it: with 19 non-declined members, a racing invite makes the
--    count 20, and join returns null at the cap check BEFORE ever reaching the
--    pending→accepted upsert. The accept is lost exactly as before.
--    Root cause, stated plainly: converting YOUR OWN pending invite is not a
--    new seat, so it must not be behind the cap check at all. 0045 asked the
--    capacity question before knowing whether it was even taking capacity.
-- 2. (Codex + Claude, independently) Excluding declined rows from the cap left
--    respond_night_out's declined→accepted path with no cap check and no lock,
--    so accepted membership can be driven past 20 by cycling decline/rejoin.
--    Under 0044 that path was implicitly safe because a declined row still
--    occupied a counted seat; 0045 removed the protection standing in for the
--    check without adding the check.
-- 3. (Codex) decline_night_out_by_token refused at capacity, so a link
--    recipient could not say "Not tonight" on a full plan — incoherent once
--    declined rows no longer occupy capacity.
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. join by token — decide "is this a new seat?" BEFORE asking about capacity
------------------------------------------------------------------------------
-- The shape that fixes the whole class: take the lock, THEN re-read your own
-- membership. Inside the lock the row set is stable, so the racing invite has
-- either landed (convert it — no new seat, no cap question) or it has not
-- (genuinely new member — cap applies). The pre-lock fast path stays as a
-- cheap short-circuit for the common already-a-member case; it is now only an
-- optimisation, and correctness no longer depends on it.

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

  -- Fast path (optimisation only): a PENDING invite accepts, because tapping
  -- the link is what accepting means. A DECLINED member merely VISITING is
  -- NOT silently re-accepted — visiting is not consenting, and the plan page
  -- offers an explicit control that goes through respond_night_out. An
  -- accepted member just lands on the plan.
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

  -- Genuinely a new member: now capacity is the right question. Declined rows
  -- do not occupy a seat.
  select count(*) into v_count
    from public.night_out_members m
   where m.night_out_id = v_id
     and m.invite_status <> 'declined';
  if v_count >= member_cap then
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

------------------------------------------------------------------------------
-- 2. decline by token — declining never consumes capacity, so never cap it
------------------------------------------------------------------------------
-- 0045 left the cap check in front of the declined insert, which meant a link
-- recipient hit "the link may have expired" when trying to opt OUT of a full
-- plan. Saying no cannot be rationed by the size of the thing you are saying
-- no to.

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

  -- Still serialised per plan so a concurrent invite cannot be lost, but with
  -- no cap check: a declined row occupies no seat.
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

------------------------------------------------------------------------------
-- 3. respond_night_out — the actual cap hole
------------------------------------------------------------------------------
-- declined→accepted moves a row back INTO the counted set, and this function
-- had neither a cap check nor the per-plan advisory lock. Every other insert
-- path defends the 20-member invariant with that lock; this one walked around
-- it. pending→accepted needs no check (pending already counts) and
-- accepted→declined only ever frees a seat.

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
  member_cap constant integer := 20;
  v_uid uuid := auth.uid();
  v_new text := case when p_accept then 'accepted' else 'declined' end;
  v_current text;
  v_count integer;
  v_changed boolean;
begin
  if v_uid is null or p_night_out is null or p_accept is null then
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
    select m.invite_status into v_current
      from public.night_out_members m
     where m.night_out_id = p_night_out and m.user_id = v_uid;
    if v_current = 'declined' then
      select count(*) into v_count
        from public.night_out_members m
       where m.night_out_id = p_night_out
         and m.invite_status <> 'declined';
      if v_count >= member_cap then
        return false;  -- rejoining is taking a seat, and there is none
      end if;
    end if;
  end if;

  -- Same-state repeat is an idempotent no-op (criterion 8); a real transition
  -- (incl. declined→accepted "changed my mind" — an EXPLICIT respond call,
  -- never a mere link visit — and accepted→declined "Not tonight" after
  -- accepting) always applies.
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
