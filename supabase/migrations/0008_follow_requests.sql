-- Next Bar — 0008 follow requests for private accounts (B3b)
--
-- Operator decision 2026-07-23: private accounts require CONSENT — following
-- one goes through a request; everyone can flip public/private (the
-- is_private column-grant already exists from 0006).
--
-- ⚠ AUTHOR-ONLY OVERNIGHT (DeepSeek security review 2026-07-24): this file
-- is committed unapplied. Attended apply via `npm run db:migrate` is in the
-- morning escalation queue.
--
-- What this does:
--   1. follow_requests — pending (requester_id, target_id) consent rows.
--      RLS defense-in-depth read for both parties; ALL client writes revoked
--      (0006/0007 lesson: definer RPCs are the ONLY write path so the shared
--      follow-rate cap cannot be bypassed).
--   2. follow_user(target) — REPLACED (return type boolean → text):
--        'followed'  — edge created (or already existed; idempotent)
--        'requested' — target is private; a request row now exists
--                      (or already did; idempotent)
--        'rejected'  — rate-capped / bad target / self-follow
--      Shares follow_attempts: request attempts consume the same 100/day cap
--      as direct follows (one abuse surface, one counter).
--   3. accept_follow_request(requester) / decline_follow_request(requester)
--      — target-side consent. Accept atomically creates the follows edge and
--      deletes the request (one function = one transaction; no half-state).
--   4. cancel_follow_request(target) — requester-side withdrawal, so an
--      accidental request to a stranger is not permanent until they act.
--   5. get_follow_requests() — the target's inbox, handle-resolved.
--      get_outgoing_requests() — the requester's own pending set, so
--      "Requested" button states survive a reload.
--      Both are definer reads over the caller's OWN rows only (get_following
--      pattern — not an enumeration surface, no cap).
--
-- friend_ratings needs NO change: edges only exist post-consent, and the
-- materialized fence in get_friend_ratings gates on follows, not requests.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. follow_requests — pending consent rows
------------------------------------------------------------------------------

create table if not exists public.follow_requests (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_id, target_id),
  check (requester_id <> target_id)
);

-- Inbox lookup ("who wants to follow me").
create index if not exists follow_requests_target_idx
  on public.follow_requests (target_id);

alter table public.follow_requests enable row level security;

-- Defense-in-depth only — table-level grants below stop at SELECT, and the
-- definer RPCs are the sole write path.
drop policy if exists "follow_requests: parties can read own" on public.follow_requests;
create policy "follow_requests: parties can read own"
  on public.follow_requests for select
  using (auth.uid() = requester_id or auth.uid() = target_id);

-- RLS check the spec demands: a PENDING request exposes NOTHING of the
-- target beyond what the requester already knew (the uuid they asked to
-- follow). No profile join exists at table level — profiles has no client
-- SELECT policy (0006), so even a granted SELECT here yields only uuids the
-- caller already holds.
revoke all on table public.follow_requests from public, anon, authenticated;
grant select on table public.follow_requests to authenticated;

------------------------------------------------------------------------------
-- 2. follow_user(target) — REPLACED: boolean → text state machine
------------------------------------------------------------------------------

-- Return type changes, so CREATE OR REPLACE cannot be used (Postgres
-- refuses a return-type change) — drop first. The revoke/grant pair is
-- re-issued because DROP discards the old ACL.
drop function if exists public.follow_user(uuid);

create function public.follow_user(target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  follow_cap constant integer := 100;  -- shared: follows + requests per day
  uid uuid := auth.uid();
  attempts integer;
  target_private boolean;
begin
  if uid is null or target is null or target = uid then
    return 'rejected';
  end if;

  -- Rate cap: bump-then-check so every attempt (including rejected ones)
  -- counts (0007). Requests share the counter — one abuse surface.
  insert into public.follow_attempts as a (user_id, day, count)
  values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = a.count + 1
  returning count into attempts;

  if attempts > follow_cap then
    return 'rejected';
  end if;

  select p.is_private into target_private
    from public.profiles p
   where p.id = target;

  if target_private is null then
    -- Target profile doesn't exist — is_private is NOT NULL since 0001, so
    -- a null here can ONLY mean "no row" (DeepSeek 0008 review: a nullable
    -- column would have made this branch an unfollowable-profile trap).
    -- The attempt bump above still counts.
    return 'rejected';
  end if;

  -- Already following → idempotent success regardless of privacy (flipping
  -- private later must not demote existing followers to "requested").
  if exists (
    select 1 from public.follows f
     where f.follower_id = uid and f.followee_id = target
  ) then
    return 'followed';
  end if;

  -- ACCEPTED SURFACE (DeepSeek 0008 review, verified): the 'followed' vs
  -- 'requested' return distinguishes a public from a private target. That
  -- signal is product-required — the requester's UI must show "Requested" —
  -- and is already inferable from the B2 surfaces (private handles resolve
  -- exactly but never appear in prefix search). Target uuids are only
  -- obtainable in-app via the 500/day-capped handle resolution, and this
  -- function burns the 100/day follow cap per probe.
  if target_private then
    -- Inner block so a failure rolls back ONLY this insert — the attempt
    -- bump must survive (0007 pattern).
    begin
      insert into public.follow_requests (requester_id, target_id)
      values (uid, target)
      on conflict (requester_id, target_id) do nothing;
    exception
      when others then
        return 'rejected';
    end;
    -- Duplicate request lands here too: idempotent 'requested'.
    return 'requested';
  end if;

  begin
    insert into public.follows (follower_id, followee_id)
    values (uid, target)
    on conflict (follower_id, followee_id) do nothing;
  exception
    when others then
      return 'rejected';
  end;

  return 'followed';
end;
$$;

revoke all on function public.follow_user(uuid) from public, anon;
grant execute on function public.follow_user(uuid) to authenticated;

------------------------------------------------------------------------------
-- 3a. accept_follow_request(requester) — target consents
------------------------------------------------------------------------------

create or replace function public.accept_follow_request(requester uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or requester is null then
    return false;
  end if;

  -- ONE savepoint around delete + insert (DeepSeek 0008 review): with the
  -- exception block wrapping only the insert, an FK failure kept the DELETE
  -- — the request silently vanished with no edge created. Wrapping both
  -- means a failed insert rolls the delete back too: either the request
  -- becomes an edge, or the request survives untouched. No half-state.
  begin
    delete from public.follow_requests
     where requester_id = requester
       and target_id = uid;

    if not found then
      -- Nothing pending from this requester — refuse rather than conjure
      -- an edge (accept must never CREATE consent that was not asked for).
      return false;
    end if;

    insert into public.follows (follower_id, followee_id)
    values (requester, uid)
    on conflict (follower_id, followee_id) do nothing;
  exception
    when foreign_key_violation then
      -- Requester's profile vanished mid-accept: delete rolled back; the
      -- cascade from profiles will clear the request row anyway.
      return false;
  end;

  return true;
end;
$$;

revoke all on function public.accept_follow_request(uuid) from public, anon;
grant execute on function public.accept_follow_request(uuid) to authenticated;

------------------------------------------------------------------------------
-- 3b. decline_follow_request(requester) — target refuses
------------------------------------------------------------------------------

create or replace function public.decline_follow_request(requester uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or requester is null then
    return false;
  end if;

  delete from public.follow_requests
   where requester_id = requester
     and target_id = uid;

  return found;
end;
$$;

revoke all on function public.decline_follow_request(uuid) from public, anon;
grant execute on function public.decline_follow_request(uuid) to authenticated;

------------------------------------------------------------------------------
-- 3c. cancel_follow_request(target) — requester withdraws
------------------------------------------------------------------------------

create or replace function public.cancel_follow_request(target uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or target is null then
    return false;
  end if;

  delete from public.follow_requests
   where requester_id = uid
     and target_id = target;

  return found;
end;
$$;

revoke all on function public.cancel_follow_request(uuid) from public, anon;
grant execute on function public.cancel_follow_request(uuid) to authenticated;

------------------------------------------------------------------------------
-- 4a. get_follow_requests() — the target's inbox, handle-resolved
------------------------------------------------------------------------------

-- ⚠ HARD SECURITY BOUNDARY (0007 get_following lesson): profiles has no
-- client SELECT policy, so the WHERE r.target_id = auth.uid() below is the
-- ONLY thing standing between this definer join and directory exposure.
-- Never edit this predicate without a test.
create or replace function public.get_follow_requests()
returns table (id uuid, handle text, display_name text, requested_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.handle, p.display_name, r.created_at
    from public.follow_requests r
    join public.profiles p on p.id = r.requester_id
   where r.target_id = auth.uid()
   order by r.created_at desc;
$$;

revoke all on function public.get_follow_requests() from public, anon;
grant execute on function public.get_follow_requests() to authenticated;

------------------------------------------------------------------------------
-- 4b. get_outgoing_requests() — the requester's own pending set
------------------------------------------------------------------------------

-- ⚠ Same hard boundary: WHERE r.requester_id = auth.uid() is load-bearing.
create or replace function public.get_outgoing_requests()
returns table (id uuid, handle text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.handle, p.display_name
    from public.follow_requests r
    join public.profiles p on p.id = r.target_id
   where r.requester_id = auth.uid()
   order by r.created_at desc;
$$;

revoke all on function public.get_outgoing_requests() from public, anon;
grant execute on function public.get_outgoing_requests() to authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   revoke all on function public.get_outgoing_requests() from authenticated;
--   drop function if exists public.get_outgoing_requests();
--   revoke all on function public.get_follow_requests() from authenticated;
--   drop function if exists public.get_follow_requests();
--   revoke all on function public.cancel_follow_request(uuid) from authenticated;
--   drop function if exists public.cancel_follow_request(uuid);
--   revoke all on function public.decline_follow_request(uuid) from authenticated;
--   drop function if exists public.decline_follow_request(uuid);
--   revoke all on function public.accept_follow_request(uuid) from authenticated;
--   drop function if exists public.accept_follow_request(uuid);
--   drop function if exists public.follow_user(uuid);
--   -- then re-create the 0007 boolean follow_user + its grants
--   drop table if exists public.follow_requests;
------------------------------------------------------------------------------
