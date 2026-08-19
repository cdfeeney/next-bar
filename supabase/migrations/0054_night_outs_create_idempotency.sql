------------------------------------------------------------------------------
-- 0054_night_outs_create_idempotency.sql — an ambiguous create is not a retry
------------------------------------------------------------------------------
-- Eleventh file. 0044-0053 are applied and checksum-recorded, so they are
-- immutable and corrections are additive.
--
-- (Cold panel, Codex, medium) `create_night_out` has no idempotency key, so a
-- client that does not learn the outcome cannot safely retry. A dropped
-- connection after COMMIT looks exactly like a failure: the plan exists, the
-- caller sees null, and the honest-looking response is to try again — which
-- creates a SECOND plan for the same night. The owner then has two plans nobody
-- can tell apart, invitees split between them, and the per-owner cap counts
-- both.
--
-- The retry has to be identifiable as the same attempt, so the client mints a
-- key BEFORE the first call and reuses it. A key that has already produced a
-- plan returns that plan instead of making another.
--
-- Scoped per owner, not globally: the key is a client-generated uuid and one
-- account must not be able to probe or collide with another's by guessing.
------------------------------------------------------------------------------

alter table public.night_outs
  add column if not exists idempotency_key uuid null;

-- Partial and per-owner: existing rows have no key and must stay legal, and two
-- different owners reusing a value is not a conflict.
create unique index if not exists night_outs_owner_idempotency_idx
  on public.night_outs (owner_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.night_outs.idempotency_key is
  'Client-minted key for the create attempt. A retry carrying the same key '
  'returns the existing plan rather than creating a second one. Null for rows '
  'created before 0054 and for callers that pass none.';

-- Body is 0053''s, unchanged apart from the key handling. The NYC night
-- comparisons stay exactly as 0053 set them.
create or replace function public.create_night_out(
  p_night date,
  p_title text default null,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_cap constant integer := 10;  -- live (non-cancelled, current) plans per owner
  v_uid uuid := auth.uid();
  v_id uuid;
  v_live integer;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_night is null
     or p_night < (public.nyc_night_key() - 2)
     or p_night > (public.nyc_night_key() + 60) then
    raise exception 'night out of range' using errcode = '22023';
  end if;
  if p_title is not null and char_length(trim(p_title)) not between 1 and 80 then
    raise exception 'invalid title' using errcode = '22023';
  end if;

  -- The same key from the same owner is the SAME attempt. Answer it before
  -- doing anything else, including the cap: a retry is not a new plan, so it
  -- must not consume capacity or be refused once the owner is at the cap.
  if p_idempotency_key is not null then
    select n.id into v_id
      from public.night_outs n
     where n.owner_id = v_uid
       and n.idempotency_key = p_idempotency_key;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('night_outs:' || v_uid::text, 0));

  -- Re-read under the lock: two concurrent retries of the same attempt both
  -- miss the check above, and without this the loser would violate the unique
  -- index instead of returning the winner's plan. Same shape as every other
  -- check-then-act pair in this feature.
  if p_idempotency_key is not null then
    select n.id into v_id
      from public.night_outs n
     where n.owner_id = v_uid
       and n.idempotency_key = p_idempotency_key;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  select count(*) into v_live
    from public.night_outs n
   where n.owner_id = v_uid
     and n.status <> 'cancelled'
     and n.night >= (public.nyc_night_key() - 2);
  if v_live >= plan_cap then
    raise exception 'too many open night outs' using errcode = '54000';
  end if;

  insert into public.night_outs (owner_id, night, title, idempotency_key)
  values (v_uid, p_night, nullif(trim(p_title), ''), p_idempotency_key)
  returning id into v_id;

  insert into public.night_out_members
    (night_out_id, user_id, role, invite_status, responded_at)
  values (v_id, v_uid, 'owner', 'accepted', now())
  on conflict on constraint night_out_members_pkey do nothing;

  return v_id;
end;
$$;

-- The two-argument signature from 0044/0053 still exists as a separate overload
-- and would silently keep serving callers that omit the key. Drop it so there
-- is one create path and no way to accidentally use the unprotected one.
drop function if exists public.create_night_out(date, text);

revoke all on function public.create_night_out(date, text, uuid) from public, anon, authenticated;
grant execute on function public.create_night_out(date, text, uuid) to authenticated;
