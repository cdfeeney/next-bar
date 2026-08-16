------------------------------------------------------------------------------
-- 0049_night_outs_invite_uses_cap_helpers.sql — finish what 0048 started
------------------------------------------------------------------------------
-- Sixth file, same rule: 0044-0048 are applied and checksum-recorded, so they
-- are immutable and corrections are additive. Apply the run in ONE transaction
-- on a database that has none of them.
--
-- (Fresh-cycle round-2 MEDIUM, Codex) 0048 claimed to give the member cap a
-- single definition and did not finish the job: it re-stated join, decline,
-- respond and the fullness read, and left `invite_to_night_out` where it was in
-- 0045, still carrying `member_cap constant integer := 20` and its own inline
-- `invite_status <> 'declined'` count.
--
-- That is worse than the four-copy state it replaced, because it LOOKS solved.
-- Change the cap in 0048's helper and owner invitations would keep enforcing 20
-- while bearer joins, rejoins and the "this night out is full" message all move
-- — the two capacities silently disagreeing is exactly the drift the helpers
-- exist to prevent, and the owner-invite path is the one most likely to hit it.
--
-- The body below is 0045's, unchanged apart from replacing the constant and the
-- count query with the helper calls. Nothing else.
------------------------------------------------------------------------------

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
  v_uid uuid := auth.uid();
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

  if public.night_out_seat_count(p_night_out) >= public.night_out_member_cap() then
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

revoke all on function public.invite_to_night_out(uuid, uuid) from public, anon, authenticated;
grant execute on function public.invite_to_night_out(uuid, uuid) to authenticated;
