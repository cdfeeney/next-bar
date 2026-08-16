-- Next Bar — 0021 canonical Night Out invitation lifecycle (V8-3)
--
-- ⚠ AUTHOR-ONLY: committed unapplied; attended apply via `npm run db:migrate`
-- is a residual blocker (V8-3 spec, Open Questions).
--
-- NUMBERING NOTE: the V8-3 spec reserved 0020, but V8-2 (its gating goal)
-- shipped 0020_pairwise_tuple_unique.sql first; this migration therefore
-- takes 0021. Additive and idempotent, criterion 11 otherwise unchanged.
--
-- ONE canonical `night_outs` row identifies a plan; membership/invitation,
-- suggestions, votes, and events hang off its id. This deliberately does NOT
-- extend 0011/0012's (night, follow-circle) scoping — the PRD's locked reason
-- is that circle-scoping cannot distinguish two groups planning the same
-- night. Every child row here keys on night_out_id, so two owners on one
-- date are structurally disjoint (criterion 9): no query in this file keys
-- on `night` alone.
--
-- Pattern (0006–0009/0011/0016, copied deliberately):
--   * RLS on + revoke-all table grants; SECURITY DEFINER RPCs are the entire
--     write surface, caps enforced inside the RPC.
--   * p_-prefixed params + ON CONFLICT ON CONSTRAINT (the 0011 42702 rule).
--   * pg_advisory_xact_lock for check-then-act cap counting.
--   * Bearer capability: an unguessable uuid share_token is the anon read's
--     ONLY predicate (0016's enumeration-oracle lesson); the anon preview
--     exposes ONLY explicitly shared plan data — never account ids, private
--     ratings, numeric scores, or notification tokens (criterion 5).
--   * MATERIALIZED fence on definer reads (0007/0015 rationale).
--
-- NON-RECURSION (criterion 4): policies on night_out_members reference ONLY
-- their own row (user_id = auth.uid()) and never read night_outs; the one
-- night_outs policy reads members through that own-row-scoped path only. No
-- policy cycle exists: night_outs → members(own-row) terminates.
--
-- Required states (PRD, locked): night_outs.status ∈ draft|open|decided|
-- cancelled; invite_status ∈ pending|accepted|declined ("Not tonight" is the
-- UI label for declined, not a fourth state). Events: invited, accepted,
-- bar_suggested, plan_changed.
--
-- Idempotent: create table/index if not exists + create or replace +
-- drop policy if exists + revoke-first grants. Safe to re-run.
--
-- APPLY GATE (attended — the behavioral half of criteria 3/6/9/10 that a
-- committed-unapplied migration cannot prove; run after `npm run db:migrate`):
--   1. As anon: select from each of the five tables → expect permission
--      denied; call every RPC except preview_night_out → expect failure;
--      preview_night_out with a random uuid → zero rows, with a real token →
--      exactly the six preview columns.
--   2. As authenticated NON-member: get_night_out / _members / _board on
--      someone else's plan → zero rows; suggest/vote/invite/respond → false.
--   3. Two owners, same date: create both, cross-call every read with each
--      owner → each sees only their own plan's rows (criterion 9).
--   4. Declined member re-opens the share link → still declined (visit ≠
--      consent); explicit respond(true) → accepted.
--   5. Function-works probe per 0016's 42702 lesson: one full create →
--      invite → join-by-token → suggest → vote → decide → cancel cycle.

------------------------------------------------------------------------------
-- 1. night_outs — the canonical plan identity
------------------------------------------------------------------------------

create table if not exists public.night_outs (
  id           uuid        not null default gen_random_uuid(),
  owner_id     uuid        not null references public.profiles(id) on delete cascade,
  night        date        not null,
  title        text        null,
  status       text        not null default 'open',
  decided_bar_id text      null,
  share_token  uuid        not null default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz null,
  constraint night_outs_pkey primary key (id),
  constraint night_outs_status_check
    check (status in ('draft', 'open', 'decided', 'cancelled')),
  constraint night_outs_title_check
    check (title is null or char_length(title) between 1 and 80),
  constraint night_outs_decided_bar_check
    check (decided_bar_id is null or decided_bar_id ~ '^[a-z0-9-]{1,60}$')
);

create unique index if not exists night_outs_token_key
  on public.night_outs (share_token);
create index if not exists night_outs_owner_idx
  on public.night_outs (owner_id, night);

comment on table public.night_outs is
  'Canonical Night Out plan (V8-3). One row per plan; membership, '
  'suggestions, votes and events key on id — never on (night, circle). '
  'share_token is the bearer capability for the anon preview. Direct '
  'table grants are forbidden; the RPCs are the entire surface.';

alter table public.night_outs enable row level security;
revoke all on table public.night_outs from public, anon, authenticated;

------------------------------------------------------------------------------
-- 2. night_out_members — membership IS the invitation record
------------------------------------------------------------------------------

create table if not exists public.night_out_members (
  night_out_id  uuid        not null references public.night_outs(id) on delete cascade,
  user_id       uuid        not null references public.profiles(id) on delete cascade,
  role          text        not null default 'member',
  invite_status text        not null default 'pending',
  invited_by    uuid        null references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  responded_at  timestamptz null,
  -- The PK is what makes a duplicate invite an idempotent no-op
  -- (criterion 8): ON CONFLICT ON CONSTRAINT night_out_members_pkey.
  constraint night_out_members_pkey primary key (night_out_id, user_id),
  constraint night_out_members_role_check check (role in ('owner', 'member')),
  constraint night_out_members_status_check
    check (invite_status in ('pending', 'accepted', 'declined'))
);

create index if not exists night_out_members_user_idx
  on public.night_out_members (user_id);

alter table public.night_out_members enable row level security;
revoke all on table public.night_out_members from public, anon, authenticated;

-- Own-row read only, as defense-in-depth beneath the definer reads. This
-- policy references NO other table — the non-recursion invariant
-- (criterion 4) lives here: members' policies must never read night_outs.
grant select on table public.night_out_members to authenticated;
drop policy if exists night_out_members_select_own on public.night_out_members;
create policy night_out_members_select_own on public.night_out_members
  for select to authenticated
  using (user_id = auth.uid());

-- Belt-and-braces owner/member read on the parent, through the own-row-
-- scoped members path above (terminates; no cycle).
grant select on table public.night_outs to authenticated;
drop policy if exists night_outs_select_member on public.night_outs;
create policy night_outs_select_member on public.night_outs
  for select to authenticated
  using (
    owner_id = auth.uid()
    or id in (
      select m.night_out_id from public.night_out_members m
       where m.user_id = auth.uid()
    )
  );

------------------------------------------------------------------------------
-- 3. night_out_suggestions / night_out_votes — member-scoped board
------------------------------------------------------------------------------

create table if not exists public.night_out_suggestions (
  night_out_id uuid        not null references public.night_outs(id) on delete cascade,
  bar_id       text        not null,
  suggested_by uuid        not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  constraint night_out_suggestions_pkey primary key (night_out_id, bar_id),
  constraint night_out_suggestions_bar_check check (bar_id ~ '^[a-z0-9-]{1,60}$')
);

alter table public.night_out_suggestions enable row level security;
revoke all on table public.night_out_suggestions from public, anon, authenticated;

create table if not exists public.night_out_votes (
  night_out_id uuid        not null references public.night_outs(id) on delete cascade,
  bar_id       text        not null,
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  -- PK makes a duplicate vote an idempotent no-op (criterion 8).
  constraint night_out_votes_pkey primary key (night_out_id, bar_id, user_id)
);

alter table public.night_out_votes enable row level security;
revoke all on table public.night_out_votes from public, anon, authenticated;

------------------------------------------------------------------------------
-- 4. night_out_events — append-only activity record
------------------------------------------------------------------------------

create table if not exists public.night_out_events (
  id           bigint      generated always as identity primary key,
  night_out_id uuid        not null references public.night_outs(id) on delete cascade,
  actor_id     uuid        null references public.profiles(id) on delete set null,
  kind         text        not null,
  bar_id       text        null,
  created_at   timestamptz not null default now(),
  constraint night_out_events_kind_check
    check (kind in ('invited', 'accepted', 'bar_suggested', 'plan_changed'))
);

create index if not exists night_out_events_plan_idx
  on public.night_out_events (night_out_id, id);

alter table public.night_out_events enable row level security;
revoke all on table public.night_out_events from public, anon, authenticated;

------------------------------------------------------------------------------
-- 5. Membership helper — the single accepted-member gate the RPCs share
------------------------------------------------------------------------------

create or replace function public.night_out_role(p_night_out uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  -- 'owner' | 'member' for ACCEPTED members (owner rows are created
  -- accepted), null for everyone else. Definer, so no policy recursion.
  select m.role
    from public.night_out_members m
   where m.night_out_id = p_night_out
     and m.user_id = auth.uid()
     and m.invite_status = 'accepted'
   limit 1;
$$;

revoke all on function public.night_out_role(uuid) from public, anon, authenticated;
-- Internal helper: callable only by the definer RPCs below (owner runs
-- them); no client role may probe membership through it.

------------------------------------------------------------------------------
-- 6. create_night_out — owner create; owner membership row is accepted
------------------------------------------------------------------------------

create or replace function public.create_night_out(
  p_night date,
  p_title text default null
)
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
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_night is null
     or p_night < (current_date - 2) or p_night > (current_date + 60) then
    raise exception 'night out of range' using errcode = '22023';
  end if;
  if p_title is not null and char_length(trim(p_title)) not between 1 and 80 then
    raise exception 'invalid title' using errcode = '22023';
  end if;

  insert into public.night_outs (owner_id, night, title)
  values (v_uid, p_night, nullif(trim(p_title), ''))
  returning id into v_id;

  insert into public.night_out_members
    (night_out_id, user_id, role, invite_status, responded_at)
  values (v_id, v_uid, 'owner', 'accepted', now())
  on conflict on constraint night_out_members_pkey do nothing;

  return v_id;
end;
$$;

------------------------------------------------------------------------------
-- 7. cancel_night_out — owner only
------------------------------------------------------------------------------

create or replace function public.cancel_night_out(p_night_out uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night_out is null then
    return false;
  end if;
  update public.night_outs
     set status = 'cancelled', cancelled_at = now()
   where id = p_night_out
     and owner_id = v_uid
     and status <> 'cancelled';
  if found then
    insert into public.night_out_events (night_out_id, actor_id, kind)
    values (p_night_out, v_uid, 'plan_changed');
  end if;
  return found;
end;
$$;

------------------------------------------------------------------------------
-- 8. decide_night_out — owner picks the bar; plan becomes decided
------------------------------------------------------------------------------

create or replace function public.decide_night_out(
  p_night_out uuid,
  p_bar text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night_out is null
     or p_bar is null or p_bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;
  update public.night_outs
     set status = 'decided', decided_bar_id = p_bar
   where id = p_night_out
     and owner_id = v_uid
     and status in ('draft', 'open', 'decided');
  if found then
    insert into public.night_out_events (night_out_id, actor_id, kind, bar_id)
    values (p_night_out, v_uid, 'plan_changed', p_bar);
  end if;
  return found;
end;
$$;

------------------------------------------------------------------------------
-- 9. invite_to_night_out — accepted members invite; idempotent; capped
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

  -- Cap counting is check-then-act → serialize per plan (0011 pattern).
  perform pg_advisory_xact_lock(
    hashtextextended('night_out_members:' || p_night_out::text, 0));

  select count(*) into v_count
    from public.night_out_members m
   where m.night_out_id = p_night_out;
  if v_count >= member_cap then
    return false;
  end if;

  insert into public.night_out_members
    (night_out_id, user_id, invited_by)
  values (p_night_out, p_user, v_uid)
  on conflict on constraint night_out_members_pkey do nothing;

  -- Event only when a row was actually created (review round 1, Codex):
  -- two concurrent invites both pass the pre-lock exists check; the loser's
  -- conflict-skipped insert must not emit a second 'invited' event.
  if found then
    insert into public.night_out_events (night_out_id, actor_id, kind)
    values (p_night_out, v_uid, 'invited');
  end if;
  return true;
end;
$$;

------------------------------------------------------------------------------
-- 10. respond_night_out — accept / "Not tonight" (declined)
------------------------------------------------------------------------------

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
  v_changed boolean;
begin
  if v_uid is null or p_night_out is null or p_accept is null then
    return false;
  end if;
  -- A cancelled plan takes no further responses (review round 1, Codex:
  -- cancelled plans stayed writable through authenticated RPCs).
  if not exists (
    select 1 from public.night_outs n
     where n.id = p_night_out and n.status <> 'cancelled'
  ) then
    return false;
  end if;
  -- Same-state repeat is an idempotent no-op (criterion 8); a real
  -- transition (incl. declined→accepted "changed my mind" — an EXPLICIT
  -- respond call, never a mere link visit — and accepted→declined "Not
  -- tonight" after accepting) always applies — the no-op never swallows a
  -- later legitimate change.
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
  -- true when the member row exists at the requested state (changed OR
  -- already there); false only for nonmembers/owner-decline.
  return v_changed or exists (
    select 1 from public.night_out_members m
     where m.night_out_id = p_night_out
       and m.user_id = v_uid
       and m.invite_status = v_new
  );
end;
$$;

------------------------------------------------------------------------------
-- 11. join_night_out_by_token — authenticated link recipient becomes accepted
------------------------------------------------------------------------------

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

  -- Existing member: a PENDING invite accepts (that is what tapping the
  -- link means), but a DECLINED member merely VISITING the link must NOT be
  -- silently re-accepted (review round 1, Codex high: visiting is not
  -- consenting — the plan page offers an explicit "count me back in" which
  -- goes through respond_night_out). Accepted members just land on the plan.
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
  select count(*) into v_count
    from public.night_out_members m
   where m.night_out_id = v_id;
  if v_count >= member_cap then
    return null;
  end if;

  insert into public.night_out_members
    (night_out_id, user_id, invite_status, responded_at)
  values (v_id, v_uid, 'accepted', now())
  on conflict on constraint night_out_members_pkey do nothing;

  -- Event only on a real row (concurrent double-join races the pre-lock
  -- exists check; the conflict-skipped loser must not emit a second event).
  if found then
    insert into public.night_out_events (night_out_id, actor_id, kind)
    values (v_id, v_uid, 'accepted');
  end if;
  return v_id;
end;
$$;

------------------------------------------------------------------------------
-- 12. suggest_night_out_bar / vote_night_out_bar — accepted members only
------------------------------------------------------------------------------

create or replace function public.suggest_night_out_bar(
  p_night_out uuid,
  p_bar text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  suggestion_cap constant integer := 3;  -- live suggestions per member/plan
  v_uid uuid := auth.uid();
  v_live integer;
begin
  if v_uid is null or p_night_out is null
     or p_bar is null or p_bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;
  if public.night_out_role(p_night_out) is null then
    return false;  -- criterion 10
  end if;
  if not exists (
    select 1 from public.night_outs n
     where n.id = p_night_out and n.status in ('draft', 'open')
  ) then
    return false;
  end if;

  -- Idempotent re-suggest never spends the cap (0011 pattern).
  if exists (
    select 1 from public.night_out_suggestions s
     where s.night_out_id = p_night_out and s.bar_id = p_bar
  ) then
    return true;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('night_out_suggestions:' || p_night_out::text || ':' || v_uid::text, 0));

  select count(*) into v_live
    from public.night_out_suggestions s
   where s.night_out_id = p_night_out and s.suggested_by = v_uid;
  if v_live >= suggestion_cap then
    return false;
  end if;

  insert into public.night_out_suggestions (night_out_id, bar_id, suggested_by)
  values (p_night_out, p_bar, v_uid)
  on conflict on constraint night_out_suggestions_pkey do nothing;

  insert into public.night_out_events (night_out_id, actor_id, kind, bar_id)
  values (p_night_out, v_uid, 'bar_suggested', p_bar);
  return true;
end;
$$;

create or replace function public.vote_night_out_bar(
  p_night_out uuid,
  p_bar text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night_out is null
     or p_bar is null or p_bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;
  if public.night_out_role(p_night_out) is null then
    return false;  -- criterion 10
  end if;
  -- No voting on a cancelled or already-decided plan (review round 1).
  if not exists (
    select 1 from public.night_outs n
     where n.id = p_night_out and n.status in ('draft', 'open')
  ) then
    return false;
  end if;
  -- Votes attach only to bars actually on the board.
  if not exists (
    select 1 from public.night_out_suggestions s
     where s.night_out_id = p_night_out and s.bar_id = p_bar
  ) then
    return false;
  end if;

  insert into public.night_out_votes (night_out_id, bar_id, user_id)
  values (p_night_out, p_bar, v_uid)
  on conflict on constraint night_out_votes_pkey do nothing;
  return true;
end;
$$;

------------------------------------------------------------------------------
-- 13. Member-scoped reads (MATERIALIZED fence) + the ONE anon preview
------------------------------------------------------------------------------

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
         n.share_token,
         me.role, me.invite_status
    from public.night_outs n
    join public.profiles p on p.id = n.owner_id
    cross join me           -- no member row → zero rows (criterion 3)
   where n.id = p_night_out;
$$;

create or replace function public.get_night_out_members(p_night_out uuid)
returns table (user_id uuid, handle text, display_name text, role text, invite_status text)
language sql
stable
security definer
set search_path = public
as $$
  with gate as materialized (
    select 1 from public.night_out_members g
     where g.night_out_id = p_night_out
       and g.user_id = auth.uid()
       and g.invite_status = 'accepted'
     limit 1
  )
  select m.user_id, p.handle::text, p.display_name::text, m.role, m.invite_status
    from public.night_out_members m
    join public.profiles p on p.id = m.user_id
    cross join gate
   where m.night_out_id = p_night_out
   order by m.created_at asc;
$$;

create or replace function public.get_night_out_board(p_night_out uuid)
returns table (bar_id text, suggested_by_handle text, votes bigint, caller_voted boolean)
language sql
stable
security definer
set search_path = public
as $$
  with gate as materialized (
    select 1 from public.night_out_members g
     where g.night_out_id = p_night_out
       and g.user_id = auth.uid()
       and g.invite_status = 'accepted'
     limit 1
  )
  select s.bar_id,
         p.handle::text,
         count(v.user_id)::bigint,
         bool_or(v.user_id = auth.uid())
    from public.night_out_suggestions s
    join public.profiles p on p.id = s.suggested_by
    left join public.night_out_votes v
      on v.night_out_id = s.night_out_id and v.bar_id = s.bar_id
    cross join gate
   where s.night_out_id = p_night_out
   group by s.bar_id, p.handle, s.created_at
   order by s.created_at asc;
$$;

-- The anon bearer preview (criterion 5): ONLY explicitly shared plan data —
-- night, title, status, the host's display identity, and an accepted-member
-- COUNT. No member identities, no account ids, no bar suggestions, no
-- ratings/scores, no tokens beyond the one the caller already holds.
create or replace function public.preview_night_out(p_token uuid)
returns table (
  night date,
  title text,
  status text,
  owner_handle text,
  owner_display_name text,
  accepted_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with gated as materialized (
    select n.id, n.night, n.title, n.status, n.owner_id
      from public.night_outs n
     where n.share_token = p_token
       and n.status in ('draft', 'open', 'decided')
     limit 1
  )
  select g.night, g.title, g.status,
         p.handle::text, p.display_name::text,
         (select count(*) from public.night_out_members m
           where m.night_out_id = g.id and m.invite_status = 'accepted')
    from gated g
    join public.profiles p on p.id = g.owner_id;
$$;

------------------------------------------------------------------------------
-- 14. Grants — revoke-first so re-runs cannot accumulate
------------------------------------------------------------------------------

revoke all on function public.create_night_out(date, text) from public, anon, authenticated;
grant execute on function public.create_night_out(date, text) to authenticated;

revoke all on function public.cancel_night_out(uuid) from public, anon, authenticated;
grant execute on function public.cancel_night_out(uuid) to authenticated;

revoke all on function public.decide_night_out(uuid, text) from public, anon, authenticated;
grant execute on function public.decide_night_out(uuid, text) to authenticated;

revoke all on function public.invite_to_night_out(uuid, uuid) from public, anon, authenticated;
grant execute on function public.invite_to_night_out(uuid, uuid) to authenticated;

revoke all on function public.respond_night_out(uuid, boolean) from public, anon, authenticated;
grant execute on function public.respond_night_out(uuid, boolean) to authenticated;

revoke all on function public.join_night_out_by_token(uuid) from public, anon, authenticated;
grant execute on function public.join_night_out_by_token(uuid) to authenticated;

revoke all on function public.suggest_night_out_bar(uuid, text) from public, anon, authenticated;
grant execute on function public.suggest_night_out_bar(uuid, text) to authenticated;

revoke all on function public.vote_night_out_bar(uuid, text) from public, anon, authenticated;
grant execute on function public.vote_night_out_bar(uuid, text) to authenticated;

revoke all on function public.get_night_out(uuid) from public, anon, authenticated;
grant execute on function public.get_night_out(uuid) to authenticated;

revoke all on function public.get_night_out_members(uuid) from public, anon, authenticated;
grant execute on function public.get_night_out_members(uuid) to authenticated;

revoke all on function public.get_night_out_board(uuid) from public, anon, authenticated;
grant execute on function public.get_night_out_board(uuid) to authenticated;

-- The ONE anon grant (0016 pattern): holding the token IS the authorization.
revoke all on function public.preview_night_out(uuid) from public, anon, authenticated;
grant execute on function public.preview_night_out(uuid) to anon, authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   revoke + drop function preview_night_out(uuid), get_night_out_board(uuid),
--     get_night_out_members(uuid), get_night_out(uuid),
--     vote_night_out_bar(uuid,text), suggest_night_out_bar(uuid,text),
--     join_night_out_by_token(uuid), respond_night_out(uuid,boolean),
--     invite_to_night_out(uuid,uuid), decide_night_out(uuid,text),
--     cancel_night_out(uuid), create_night_out(date,text),
--     night_out_role(uuid);
--   drop table if exists night_out_events, night_out_votes,
--     night_out_suggestions, night_out_members, night_outs;
------------------------------------------------------------------------------
