------------------------------------------------------------------------------
-- REVERT-0059-staging-20260817.sql
-- Rollback half of the T0 gate for migration 0059
------------------------------------------------------------------------------
-- Restores respond_night_out to its 3-argument 0058 body, get_night_out to its
-- 0045 shape, get_my_night_outs to its 0053 shape, drops the revision trigger
-- and its function, and drops the response_revision column.
--
-- PROVENANCE: every definition below is the VERBATIM text of the migration that
-- last defined that object before 0059 — 0058 for respond_night_out, 0045 for
-- get_night_out, 0053 for get_my_night_outs — which is the same text that
-- produced the definition 0059 replaced.
--
-- APPLYING THIS REINSTATES THE ABA HOLE. A delayed duplicate accept can again
-- reverse a later decline (repro-aba-cases-20260817.mjs cases 1 and 2 go RED).
-- It exists so the deploy is reversible in one step, not because 0058 is
-- correct.
--
-- DATA LOSS: dropping response_revision discards every stored revision. Re-
-- applying 0059 afterwards re-adds the column at 0 for every row, so any
-- in-flight request holding a pre-revert revision would match again. Do not
-- revert and re-apply while responses are in flight.
--
-- ORDER: nothing applied after 0059 may depend on the column or on the 4-arg
-- overload. Check the ledger head before running this.
--
-- The CODE half of the revert point is recorded in
-- REVERT-POINT-0059-20260817.md.
--
-- To revert: run this file, then
--   delete from public.schema_migrations where name = '0059_night_outs_respond_revision.sql';
-- (apply-single-migration.mjs <file> revert does both in one transaction.)
------------------------------------------------------------------------------

-- 1. respond_night_out — back to 0058's 3-argument form ----------------------

create or replace function public.respond_night_out(
  p_night_out uuid,
  p_accept boolean,
  p_expected_status text
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
  if p_expected_status is null
     or p_expected_status not in ('pending', 'accepted', 'declined') then
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

  -- Read the current state under the lock when accepting, and plainly when
  -- declining. The expected-state check happens HERE, before any write: a call
  -- carrying a stale view of the world is refused rather than applied.
  select m.invite_status into v_current
    from public.night_out_members m
   where m.night_out_id = p_night_out and m.user_id = v_uid;

  if v_current is null then
    return false;  -- not a member; nothing to respond to
  end if;
  if v_current <> p_expected_status then
    -- The caller acted on a state that is no longer true. This is the replay
    -- case, and it is also a stale UI: either way the honest answer is no.
    return false;
  end if;

  if p_accept and v_current = 'declined'
     and public.night_out_seat_count(p_night_out) >= public.night_out_member_cap() then
    return false;  -- rejoining is taking a seat, and there is none
  end if;

  update public.night_out_members m
     set invite_status = v_new, responded_at = now()
   where m.night_out_id = p_night_out
     and m.user_id = v_uid
     and m.role <> 'owner'          -- the owner cannot decline their own plan
     and m.invite_status = p_expected_status  -- the guard belongs in the WRITE, not only the read
     and m.invite_status <> v_new;
  v_changed := found;
  if v_changed and p_accept then
    insert into public.night_out_events (night_out_id, actor_id, kind)
    values (p_night_out, v_uid, 'accepted');
  end if;
  -- true when the row ends at the requested state (changed OR already there);
  -- false only for nonmembers and an owner trying to decline their own plan.
  return v_changed or exists (
    select 1 from public.night_out_members m
     where m.night_out_id = p_night_out
       and m.user_id = v_uid
       and m.invite_status = v_new
  );
end;
$$;

drop function if exists public.respond_night_out(uuid, boolean, text, integer);

revoke all on function public.respond_night_out(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.respond_night_out(uuid, boolean, text) to authenticated;

-- 2. get_night_out — back to 0045's shape ------------------------------------

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

revoke all on function public.get_night_out(uuid) from public, anon, authenticated;
grant execute on function public.get_night_out(uuid) to authenticated;

-- 3. get_my_night_outs — back to 0053's shape --------------------------------

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
  is_past boolean
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
    n.night < public.nyc_night_key()
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

-- 4. The trigger and the column ----------------------------------------------
--
-- Drop the trigger BEFORE the column: the trigger function references
-- response_revision and would fail on the next update if the column went first.

drop trigger if exists night_out_members_revision on public.night_out_members;
drop function if exists public.night_out_members_bump_revision();

alter table public.night_out_members drop column if exists response_revision;
