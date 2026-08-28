------------------------------------------------------------------------------
-- 0067_groups.sql — WP6: the Group backend.
--
-- Requirements discharged here (V8 contract 3.1.0):
--   V8-R-GRP-001  a Group is a PERSISTENT NAMED GROUP CHAT; exactly ONE
--                 administrator, with D-C-38 succession.
--   V8-R-GRP-002  members send TEXT and PHOTOS.
--   V8-R-GRP-003  ANY member may reuse the CURRENT membership to invite the
--                 group to a Night Out, without altering the group.
--   V8-R-GRP-004  creating a named group makes the creator the initial
--                 administrator.
--   V8-R-GRP-005  the administrator may rename, and add or remove MUTUAL
--                 FRIENDS.
--   V8-R-GRP-006  any member may leave; administrator succession; the group is
--                 DELETED when no member remains.
--   V8-R-GRP-007  the sender may delete their own message for everyone; an
--                 administrator may remove any message.
--   V8-R-GRP-008  in-app unread state. THIS FILE SENDS NO PUSH, and that
--                 omission is the requirement, not an oversight.
--   V8-R-FEED-010 (EXTENSION ONLY) the 'group_message' subject kind — see EC-03
--                 below. The story case established by 0066 is preserved.
--
-- Idempotent throughout: create ... if not exists, drop policy if exists, drop
-- constraint if exists before add.
--
-- This file is WRITTEN ONLY. Applying it is a separate attended step against a
-- ledger-aware runner; a migration file in the repository is not applied
-- anywhere until the target project's ledger says so.
--
-- EC-03, AND IT IS THE ORGANISING RULE OF SECTION 7.
--
-- V8-R-FEED-010 is CROSS-LANE. 0066 owns the foundation and the 'story' case;
-- THIS migration adds 'group_message'; WP5's 0069 adds 'feed_post' and
-- 'comment'. 0066 states the invariant and this file obeys it: THE CHECK
-- CONSTRAINT AND THE FUNCTION WIDEN TOGETHER, in one migration, never one
-- without the other. A constraint admitting a kind the function refuses, or a
-- function accepting a kind the constraint rejects, is the exact defect EC-03
-- exists to prevent.
--
-- `supabase/migrations/0066_media_boundary.sql` is NOT edited. It is WP1's
-- exclusive file; everything here extends it from the outside.
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. The group, and its single administrator
------------------------------------------------------------------------------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  -- BOUNDED IN THE DATABASE, not only in the client. Every write verb below is
  -- granted to `authenticated` and so is callable directly over PostgREST; a
  -- length rule that lives only in TypeScript bounds this product's own UI and
  -- nothing else.
  name text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);

comment on table public.groups is
  'V8-R-GRP-001. A persistent named group chat. It carries no admin column BY DESIGN — see public.group_members.is_admin.';

-- THE ADMINISTRATOR IS A MEMBERSHIP FACT, NOT A COLUMN ON `groups`, and the
-- choice is load bearing rather than stylistic.
--
-- The obvious shape is `groups.admin_id references profiles(id)`. Every
-- available referential action on it is wrong under D-C-38:
--
--   * `on delete cascade` DELETES THE GROUP when the administrator deletes their
--     account. D-C-38 says administration TRANSFERS to the longest-standing
--     remaining member; deleting a group full of other people's messages because
--     one person left is data loss dressed as referential integrity.
--   * `on delete restrict` makes an ordinary account deletion FAIL for as long
--     as that account administers any group.
--   * `on delete set null` contradicts `not null`, and a nullable administrator
--     is precisely the administrator-less state V8-R-GRP-006 fails closed to
--     avoid.
--
-- Any of those could be papered over with a trigger that races the cascade —
-- foreign-key actions are themselves AFTER triggers, fired in name order, so
-- "my trigger reassigns admin_id before the groups FK is checked" is an ordering
-- accident, not a guarantee.
--
-- Carrying the administrator ON THE MEMBERSHIP ROW removes the second foreign
-- key entirely. An account deletion cascades to exactly one place — this table —
-- and the AFTER DELETE trigger in section 3 then applies succession or deletes
-- the emptied group. One edge, one path, no ordering to reason about.
create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_admin boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

-- EXACTLY ONE ADMINISTRATOR (D-C-38), enforced by the database rather than by
-- the care of every verb that touches membership.
create unique index if not exists group_members_one_admin
  on public.group_members (group_id)
  where is_admin;

create index if not exists group_members_profile_idx
  on public.group_members (profile_id);

-- The succession read path: longest-standing first, lowest profile id to break
-- a tie. Indexed in exactly that order so the tie-break is a scan, not a sort.
create index if not exists group_members_seniority_idx
  on public.group_members (group_id, joined_at, profile_id);

comment on column public.group_members.is_admin is
  'D-C-38: exactly ONE administrator per group, enforced by group_members_one_admin. Succession is applied by group_members_succession_trigger, never by a caller.';

------------------------------------------------------------------------------
-- 2. Messages, and the read state that replaces a push (V8-R-GRP-008)
------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- CROSS-LANE CONTRACT — WP5 (feed) reads this schema. Recorded here so the other
-- lane can cite it instead of guessing at table shapes it cannot see.
--
-- WP5's decision D-C-37 requires a group-audience post to deliver to exactly
-- (the selected group INTERSECTED WITH the poster's mutual friends), computed
-- server-side. The two things it needs from this file:
--
--   public.is_group_member(p_group uuid, p_profile uuid) -> boolean
--     SECURITY DEFINER, STABLE, granted to `authenticated`. IT CARRIES A PARTY
--     GUARD: it returns false unless the caller IS p_profile, or the caller is
--     themselves a member of p_group -- deliberate, so it cannot enumerate a
--     group the caller is not in. SECURITY DEFINER does NOT change auth.uid(),
--     so the guard still applies with the poster as caller. For D-C-37 that
--     answers correctly, because a poster is a member of the group they post to.
--
--   public.group_members (group_id, profile_id, is_admin, joined_at)
--     PRIMARY KEY (group_id, profile_id). THERE IS NO accepted / pending /
--     invite_status COLUMN -- MEMBERSHIP IS THE ROW'S EXISTENCE. Unlike
--     night_out_members, there is no status to filter on, and looking for one
--     finds no column. Direct selects are RLS-gated by is_group_member, so they
--     return rows only for groups the caller belongs to.
--
-- This lane owns 0067 and does not write WP5's migration; the note is a contract
-- statement, not a dependency.
create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  -- SET NULL, AND THE CASCADE THAT WAS HERE CONTRADICTED THE CONTRACT.
  --
  -- This column read `not null ... on delete cascade`, defended as "the erasure
  -- expectation account deletion already sets elsewhere in this schema". That
  -- was an INFERENCE, and V8-R-GRP-007 is explicit against it:
  --
  --   behavior:  "MESSAGES PERSIST UNTIL REMOVED OR THE GROUP IS DELETED."
  --   states:    present | deleted by sender for everyone |
  --              removed by administrator | removed with the group
  --   retention: "messages persist until removed or the group is deleted;
  --              there is no automatic expiry"
  --
  -- Three removal causes are enumerated and "the sender deleted their account"
  -- is not among them. V8-R-GRP-006 closes it from the other side: its retention
  -- clause is "leaving does not delete the member's prior messages; those follow
  -- V8-R-GRP-007", and its behavior treats "leaves OR DELETES THEIR ACCOUNT" as
  -- the same departure. So a departing account is a departure, and a departure
  -- explicitly preserves the messages.
  --
  -- The cascade also silently deleted OTHER PEOPLE'S conversation history: every
  -- remaining member lost half a thread they were party to, with no record that
  -- anything had been removed.
  --
  -- Null sender means "a departed member" and is rendered as such. Every read
  -- path below treats a null sender explicitly rather than leaning on SQL's
  -- three-valued logic — see delete_group_message, group_message_is_visible and
  -- group_unread_counts, where `<>` against NULL would otherwise have silently
  -- changed each answer.
  sender_id uuid references public.profiles(id) on delete set null,
  body text check (body is null or length(body) <= 2000),
  -- The photo half of V8-R-GRP-002, and it is a REGISTRY REFERENCE rather than a
  -- storage path. A path is a string a client can invent; a media_objects id is
  -- a row the upload route created after decoding the bytes it describes, which
  -- is what makes "group photos cross the WP1 boundary" true rather than stated.
  media_id uuid references public.media_objects(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  -- ROUND 6. WHEN THIS MESSAGE'S PHOTO WENT AWAY, and why the column has to exist.
  --
  -- `media_id` is `on delete set null`, and WP1's `media_objects.owner_id` is `on delete cascade`
  -- to profiles (0066_media_boundary.sql:39). Before X5 the sender cascade deleted this row first,
  -- so the sequence never arose. Now the message SURVIVES its author: the media cascade nulls
  -- `media_id` on a row with no body, the content CHECK below is violated, and THE WHOLE ACCOUNT
  -- DELETION TRANSACTION ABORTS. That is not a wrong answer, it is a failed delete-my-account —
  -- found independently by both review families at round 5, HIGH from each.
  --
  -- The row is kept rather than removed, because V8-R-GRP-007 enumerates the removal causes and
  -- "its photo was deleted" is not one of them. The thread keeps its shape and renders a tombstone.
  media_removed_at timestamptz,
  -- A message is text, or a photo, or a photo that has since been removed — never nothing that
  -- was never anything. The third arm is what lets the media cascade succeed; it can only become
  -- true through the BEFORE trigger below, which fires only on a real non-null -> null transition,
  -- so an INSERT still cannot create an empty message.
  constraint group_messages_has_content check (
    (body is not null and length(btrim(body)) > 0)
    or media_id is not null
    or media_removed_at is not null
  ),
  -- The two halves of a deletion agree or the row is refused. A `deleted_by`
  -- with no `deleted_at` reads as an un-deleted message somebody deleted.
  -- ROUND-3 FIX. This used to demand deleted_by whenever deleted_at was set, which collided head
  -- on with `deleted_by ... on delete set null` above: when the DELETER's account was removed the
  -- FK nulled deleted_by, the check then failed, and the ACCOUNT DELETION ITSELF errored out. A
  -- user could be unable to delete their account because they had once deleted a group message.
  --
  -- Losing the attribution must not unmake the deletion. The half that was actually worth
  -- forbidding is the OTHER one — a deleted_by with no deleted_at, which is a half-recorded
  -- deletion nobody can explain — and that stays forbidden. A deleted_at with a null deleted_by
  -- now means exactly what it should: deleted, by an account that no longer exists.
  constraint group_messages_deletion_is_whole check (
    deleted_by is null or deleted_at is not null
  )
);

-- The thread read path: one group, newest last, live rows only.
create index if not exists group_messages_thread_idx
  on public.group_messages (group_id, created_at)
  where deleted_at is null;

create index if not exists group_messages_media_idx
  on public.group_messages (media_id)
  where media_id is not null and deleted_at is null;

comment on table public.group_messages is
  'V8-R-GRP-002 / V8-R-GRP-007. Soft-deleted so a removal is instant for every reader without destroying the operator record a report may point at.';

-- IN-APP UNREAD STATE — THE WHOLE OF V8-R-GRP-008's MECHANISM.
--
-- The requirement's exclusion is blunt: "NO push notification per ordinary group
-- message". So unread is a fact each member can READ, not an event the server
-- PUSHES. There is deliberately no notification table, no queue, and no call to
-- any sender anywhere in this file; `group_unread_counts` in section 6 is the
-- entire delivery mechanism.
-- ---------------------------------------------------------------------------
-- X5 idempotency: `create table if not exists` is a NO-OP on a database that
-- already has this table, so the column change above would never reach one. An
-- existing deployment keeps `not null` + `on delete cascade` unless it is
-- altered explicitly, and would go on deleting departed members' messages while
-- this file claims otherwise -- a migration that is true only of a fresh
-- database is the worst of the two states, because the text stops describing
-- the deployment.
--
-- Both statements are guarded, so this is safe to re-run and safe on a fresh
-- database where the table was just created in the shape it wants.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'group_messages'
       and column_name = 'sender_id' and is_nullable = 'NO'
  ) then
    alter table public.group_messages alter column sender_id drop not null;
  end if;
end
$$;

do $$
declare
  v_constraint text;
  v_rule char;
begin
  select c.conname, c.confdeltype
    into v_constraint, v_rule
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'group_messages'
     and c.contype = 'f'
     and c.conkey = array[
       (select a.attnum from pg_attribute a
         where a.attrelid = t.oid and a.attname = 'sender_id')
     ]::smallint[];

  -- 'n' is SET NULL, 'c' is CASCADE. Only rewrite when it is not already right.
  if v_constraint is not null and v_rule is distinct from 'n' then
    execute format(
      'alter table public.group_messages drop constraint %I', v_constraint);
    execute
      'alter table public.group_messages
         add constraint group_messages_sender_id_fkey
         foreign key (sender_id) references public.profiles(id)
         on delete set null';
  end if;
end
$$;

-- ROUND 6 idempotency, same reason as X5's: `create table if not exists` is a no-op on a
-- database that already has this table, so neither the new column nor the relaxed CHECK would
-- reach one, and account deletion would go on aborting there while this file claims otherwise.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'group_messages'
       and column_name = 'media_removed_at'
  ) then
    alter table public.group_messages add column media_removed_at timestamptz;
  end if;
end
$$;

do $$
begin
  -- Rewrite the content constraint only when it does not already admit the third arm.
  if exists (
    select 1 from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'group_messages'
      and c.conname = 'group_messages_has_content'
      and pg_get_constraintdef(c.oid) not like '%media_removed_at%'
  ) then
    alter table public.group_messages drop constraint group_messages_has_content;
    alter table public.group_messages add constraint group_messages_has_content check (
      (body is not null and length(btrim(body)) > 0)
      or media_id is not null
      or media_removed_at is not null
    );
  end if;
end
$$;

-- The stamp itself. BEFORE, deliberately: a row-level BEFORE trigger runs ahead of CHECK
-- validation for the same statement, so the constraint sees `media_removed_at` already set. An
-- AFTER trigger would be too late and the cascade would still abort.
create or replace function public.group_message_mark_media_removed()
returns trigger
language plpgsql
as $$
begin
  -- Only a real non-null -> null transition, which is what the media cascade does. This must never
  -- fire for an ordinary edit, or it would license an empty message.
  if new.media_id is null and old.media_id is not null and new.media_removed_at is null then
    new.media_removed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists group_messages_media_removed on public.group_messages;
create trigger group_messages_media_removed
  before update of media_id on public.group_messages
  for each row
  execute function public.group_message_mark_media_removed();

comment on function public.group_message_mark_media_removed() is
  'V8-R-GRP-007 / round 6. Stamps media_removed_at when WP1 media cascade nulls media_id, so a photo-only message survives its author instead of aborting account deletion on the content CHECK.';

create table if not exists public.group_reads (
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

comment on table public.group_reads is
  'V8-R-GRP-008. In-app unread state. This file sends NO push notification for an ordinary group message — that omission IS the requirement.';

------------------------------------------------------------------------------
-- 3. Membership predicates and D-C-38 succession
------------------------------------------------------------------------------

-- THE MEMBERSHIP PREDICATE, and every policy below asks through it.
--
-- SECURITY DEFINER because the policies on `group_members` cannot ask
-- `group_members` directly: a policy whose USING expression selects from the
-- table it protects closes a cycle and PostgreSQL refuses the whole table with
-- an infinite-recursion error. 0066 records the same trap for story_audience and
-- solves it the same way.
--
-- PARTY GUARD, for the same reason 0066 puts one on `is_story_live`. Definer
-- means this sees rows the caller cannot, so ungated it is an oracle: anyone
-- holding a group uuid could poll whether a named profile belongs to it and
-- watch the answer flip as people join and leave — membership is exactly the
-- audience metadata this file's trust boundary protects.
--
-- The guard is an ANSWER restriction rather than a revoke, because RLS policy
-- expressions are evaluated as the querying role and withdrawing EXECUTE from
-- `authenticated` would break the policies that depend on it. A caller may ask
-- about ITSELF anywhere, or about ANYONE in a group it already belongs to.
-- Anyone else gets false, which is the safe direction for a predicate that gates
-- reads.
create or replace function public.is_group_member(p_group uuid, p_profile uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null or p_group is null or p_profile is null then
    return false;
  end if;

  if v_caller <> p_profile and not exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = v_caller
  ) then
    return false;
  end if;

  return exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = p_profile
  );
end;
$$;

comment on function public.is_group_member(uuid, uuid) is
  'V8-R-GRP-001. Server-enforced membership. Answers about the caller, or about anyone in a group the caller already belongs to; false for everybody else, so it cannot be used to enumerate a group the caller is not in.';

revoke all on function public.is_group_member(uuid, uuid) from public, anon;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;

create or replace function public.is_group_admin(p_group uuid, p_profile uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null or p_group is null or p_profile is null then
    return false;
  end if;

  if v_caller <> p_profile and not exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = v_caller
  ) then
    return false;
  end if;

  return exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = p_profile
       and m.is_admin
  );
end;
$$;

comment on function public.is_group_admin(uuid, uuid) is
  'V8-R-GRP-005. The single administrator test, carrying the same party guard as is_group_member.';

revoke all on function public.is_group_admin(uuid, uuid) from public, anon;
grant execute on function public.is_group_admin(uuid, uuid) to authenticated;

-- D-C-38 SUCCESSION, IN ONE PLACE.
--
-- "If that administrator leaves or deletes their account, administration
-- transfers to the LONGEST-STANDING REMAINING MEMBER; where membership
-- timestamps tie, the deterministic stable tie-break is the lowest member
-- profile id. If no member remains, the Group is DELETED."
--
-- Written once and called from the trigger below rather than from each verb,
-- because "leaves" and "deletes their account" reach this table by different
-- routes — an explicit `leave_group`, an administrator removing a member, and a
-- `profiles` cascade — and a rule restated at three call sites is a rule that
-- drifts at two of them.
--
-- IT RUNS AS THE TABLE OWNER, not as the caller. The member who just left has,
-- by definition, no membership row any more, so a caller-scoped update could not
-- see the group it has to fix.
create or replace function public.group_apply_succession(p_group uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_successor uuid;
  v_promoted  integer;
  v_attempts  integer := 0;
begin
  if p_group is null then
    return;
  end if;

  -- THE CONCURRENCY CEILING, STATED AS A CEILING AND NOT AS SAFETY.
  --
  -- Two departure routes reach succession and they acquire locks in OPPOSITE orders.
  -- `leave_group` takes the per-group advisory lock and THEN deletes (advisory -> row). The
  -- `profiles ON DELETE CASCADE` route holds the row lock first and reaches the advisory request
  -- only afterwards (row -> advisory). So: T1 holds advisory and blocks on T2's row lock while
  -- promoting a successor; T2 holds that row lock and blocks on T1's advisory. PostgreSQL detects
  -- the cycle and aborts one transaction with SQLSTATE 40P01.
  --
  -- ROUND 2 TRIED TO REMOVE THIS AND COULD NOT. It added a BEFORE DELETE row trigger that took
  -- the advisory lock, on the theory that a BEFORE trigger runs before the row lock. IT DOES NOT:
  -- ExecDelete -> ExecBRDeleteTriggers -> GetTupleForTrigger locks the tuple with
  -- LockTupleExclusive BEFORE any BEFORE-ROW trigger body executes, precisely so the trigger sees
  -- a stable OLD. The trigger therefore acquired row-then-advisory exactly like the AFTER trigger
  -- it was meant to correct. It has been REMOVED rather than left as decoration, and the comment
  -- asserting that no such cycle could arise has been removed with it, because a false safety claim is
  -- worse than a named limit: it stops the next reader from designing around the real behaviour.
  --
  -- A trigger on this table can never fix it. The row lock is already held whenever any trigger on
  -- group_members runs, so advisory-before-row is unreachable from here by construction.
  --
  -- WHAT SHIPS INSTEAD: 40P01 is ACCEPTED as the fail-closed ceiling and retried at the caller
  -- (see leaveGroup in src/lib/groups.server.ts). Nothing is corrupted when it fires — Postgres
  -- rolls one transaction back whole, no group is left administrator-less, and the retry succeeds
  -- because the competing transaction has finished by then. A SECOND, PRE-EXISTING case has the
  -- same ceiling and the same answer: two concurrent profile-deletion cascades that share two or
  -- more groups take per-group advisory locks in unordered per-row scan order and can deadlock
  -- advisory-against-advisory. That predates round 2 and is not introduced here.
  --
  -- SERIALIZED PER GROUP, ON THE SAME KEY `leave_group` TAKES.
  --
  -- Round-1 finding: `leave_group` held this lock, but succession itself did not — and the
  -- `profiles ON DELETE CASCADE` route reaches succession through
  -- `group_members_succession_trigger` WITHOUT ever passing through `leave_group`. So the two
  -- departure routes were not serialized against each other. A cascade could read a membership
  -- row a concurrent `leave_group` had deleted but not yet committed, pick that departing member
  -- as successor, and then have its promotion UPDATE match ZERO rows once the delete committed
  -- (EvalPlanQual finds the tuple dead). The function returned happily and the group was left
  -- administrator-less, with `rename_group`, `add_group_member` and `remove_group_member` all
  -- frozen because each requires an existing admin row.
  --
  -- Advisory transaction locks are re-entrant within one transaction, so `leave_group` taking it
  -- first and the trigger taking it again is free; what it buys is that the CASCADE route now
  -- takes it too.
  perform pg_advisory_xact_lock(
    hashtextextended('group_members:' || p_group::text, 0)
  );

  -- RE-READ UNDER THE LOCK. Whoever held it before us may already have promoted an
  -- administrator or deleted the group, so the pre-lock answer is not worth acting on.
  if exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.is_admin
  ) then
    return;
  end if;

  -- LONGEST-STANDING, THEN LOWEST ID. Both terms are required: `joined_at` alone
  -- is not deterministic, because two members added in the same statement share
  -- a timestamp — `now()` is the transaction's clock, not the wall clock — and
  -- an arbitrary winner there means two replicas of the same history can
  -- disagree about who administers the group.
  --
  -- LOOPED, because choosing a successor and promoting them are two statements and the row can
  -- die in between. A zero-row UPDATE is the signal to choose again, not to give up: giving up
  -- silently is precisely what left a group with no administrator.
  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      -- Cannot happen under the lock in READ COMMITTED, where each statement takes a fresh
      -- snapshot and a dead row stops being selected. Bounded anyway: a succession that cannot
      -- converge must fail loudly rather than spin holding a per-group lock.
      raise exception 'group_apply_succession: could not converge on a successor for %', p_group
        using errcode = '55000';
    end if;

    select m.profile_id into v_successor
      from public.group_members m
     where m.group_id = p_group
     order by m.joined_at, m.profile_id
     limit 1;

    if v_successor is null then
      -- NO MEMBER REMAINS, so the group is DELETED. Messages and read state follow
      -- through their own cascades.
      --
      -- Reached from inside the loop deliberately: in the last-two-out variant the old code
      -- selected a successor, updated zero rows, and returned with v_successor non-null — so it
      -- skipped this branch too and left an EMPTY, undeleted group, violating V8-R-GRP-006's
      -- "DELETED when no member remains".
      delete from public.groups g where g.id = p_group;
      return;
    end if;

    update public.group_members m
       set is_admin = true
     where m.group_id = p_group
       and m.profile_id = v_successor;

    get diagnostics v_promoted = row_count;

    -- ONE ROW IS THE ONLY ACCEPTABLE OUTCOME. Zero means the successor we chose is already
    -- gone; go round again and choose from what is actually left.
    exit when v_promoted = 1;
  end loop;
end;
$$;

comment on function public.group_apply_succession(uuid) is
  'D-C-38. Transfers administration to the longest-standing remaining member (lowest profile id breaks a tie), or DELETES the group when no member remains. The single definition; every departure route reaches it through group_members_succession_trigger.';

-- NOT GRANTED TO ANY APPLICATION ROLE. Succession is a consequence of a
-- departure, never an action a member may invoke: a caller who could run this
-- directly would wait for an administrator's row to be momentarily absent, or
-- simply call it on a group whose administrator is intact and — because the
-- early return protects that case — learn nothing, but the shape would still be
-- a member-triggered write on a group's control structure. The trigger is the
-- only caller.
revoke all on function public.group_apply_succession(uuid) from public, anon, authenticated;

create or replace function public.group_members_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The group itself may already be gone (a `groups` delete cascades here), in
  -- which case there is nothing to succeed to and the lookup inside
  -- group_apply_succession simply finds no rows.
  perform public.group_apply_succession(old.group_id);
  return null;
end;
$$;

drop trigger if exists group_members_succession_trigger on public.group_members;
create trigger group_members_succession_trigger
  after delete on public.group_members
  for each row
  execute function public.group_members_after_delete();

------------------------------------------------------------------------------
-- 4. The administration verbs (V8-R-GRP-004, V8-R-GRP-005, V8-R-GRP-006)
------------------------------------------------------------------------------

-- V8-R-GRP-004: "Creating a named group makes THE CREATOR THE INITIAL
-- ADMINISTRATOR."
create or replace function public.create_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group uuid;
begin
  if v_caller is null then
    raise exception 'create_group: not authenticated' using errcode = '28000';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'create_group: a group needs a name' using errcode = '22023';
  end if;
  if length(btrim(p_name)) > 60 then
    raise exception 'create_group: that name is too long' using errcode = '22001';
  end if;

  insert into public.groups (name) values (btrim(p_name)) returning id into v_group;

  insert into public.group_members (group_id, profile_id, is_admin)
  values (v_group, v_caller, true);

  return v_group;
end;
$$;

comment on function public.create_group(text) is
  'V8-R-GRP-004. The creator becomes the initial administrator in the same transaction as the group, so a group never exists administrator-less.';

revoke all on function public.create_group(text) from public, anon;
grant execute on function public.create_group(text) to authenticated;

-- V8-R-GRP-005: "ADMINISTRATORS MAY RENAME the group".
create or replace function public.rename_group(p_group uuid, p_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'rename_group: not authenticated' using errcode = '28000';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'rename_group: a group needs a name' using errcode = '22023';
  end if;
  if length(btrim(p_name)) > 60 then
    raise exception 'rename_group: that name is too long' using errcode = '22001';
  end if;

  -- THE ADMINISTRATOR TEST IS READ FROM THE TABLE, not from is_group_admin.
  -- The helper carries a party guard written for READ paths; a write verb must
  -- assert the caller's own authority directly, so that a future relaxation of
  -- the guard can never silently widen who may rename a group.
  if not exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = v_caller
       and m.is_admin
  ) then
    -- "a failed administrative write must not report success."
    raise exception 'rename_group: only the group administrator may rename it'
      using errcode = '42501';
  end if;

  update public.groups g set name = btrim(p_name) where g.id = p_group;
  return found;
end;
$$;

comment on function public.rename_group(uuid, text) is
  'V8-R-GRP-005. Administrator only, server-enforced; raises rather than returning false so a failed rename can never read as success.';

revoke all on function public.rename_group(uuid, text) from public, anon;
grant execute on function public.rename_group(uuid, text) to authenticated;

-- V8-R-GRP-005: "ADD OR REMOVE MUTUAL FRIENDS. Only mutual friends may be
-- added." Its exclusions name the two refusals explicitly: a non-mutual-friend
-- cannot be added, and a blocked user cannot be added to a new shared group
-- (V8-R-FEED-009).
--
-- THE BLOCK IS INHERITED, NOT RESTATED. 0066 moved `is_blocked_between` INSIDE
-- `is_mutual_friend` precisely so that every site asking about friendship gets
-- the block for free and no later call site can forget it. Adding a second
-- explicit block test here would be a second definition of the same rule.
--
-- The mutuality is measured against THE ADMINISTRATOR, who is the caller — which
-- is also what keeps `is_mutual_friend`'s own party guard satisfied: that
-- function raises for a caller who is neither party, so it can only ever be
-- asked about a pair the caller is in.
create or replace function public.add_group_member(p_group uuid, p_profile uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'add_group_member: not authenticated' using errcode = '28000';
  end if;
  if p_profile is null then
    raise exception 'add_group_member: a profile is required' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = v_caller
       and m.is_admin
  ) then
    raise exception 'add_group_member: only the group administrator may add members'
      using errcode = '42501';
  end if;

  -- Already a member: idempotent, and NOT an error. Re-adding must not disturb
  -- `joined_at`, because that column is the succession order.
  if exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = p_profile
  ) then
    return true;
  end if;

  if not public.is_mutual_friend(v_caller, p_profile) then
    raise exception 'add_group_member: only mutual friends may be added'
      using errcode = '42501';
  end if;

  insert into public.group_members (group_id, profile_id, is_admin)
  values (p_group, p_profile, false)
  on conflict (group_id, profile_id) do nothing;

  return true;
end;
$$;

comment on function public.add_group_member(uuid, uuid) is
  'V8-R-GRP-005 / V8-R-FEED-009. Administrator only, and only mutual friends of that administrator — the block is inherited through is_mutual_friend rather than restated, so this site cannot drift from the others that ask it.';

revoke all on function public.add_group_member(uuid, uuid) from public, anon;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;

create or replace function public.remove_group_member(p_group uuid, p_profile uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'remove_group_member: not authenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = v_caller
       and m.is_admin
  ) then
    raise exception 'remove_group_member: only the group administrator may remove members'
      using errcode = '42501';
  end if;

  -- REMOVING YOURSELF IS LEAVING, AND LEAVING IS ITS OWN VERB.
  --
  -- Allowed here, this would run succession through the trigger while the
  -- caller still believed they had performed an administrative action on someone
  -- else. V8-R-GRP-006 gives leaving its own consequence statement ("the action
  -- states its consequence before it is taken"), which an administrative remove
  -- does not show.
  if p_profile = v_caller then
    raise exception 'remove_group_member: use leave_group to leave a group yourself'
      using errcode = '22023';
  end if;

  delete from public.group_members m
   where m.group_id = p_group
     and m.profile_id = p_profile;

  -- "a failed administrative write must not report success" — a delete that
  -- matched nothing removed nobody.
  return found;
end;
$$;

comment on function public.remove_group_member(uuid, uuid) is
  'V8-R-GRP-005. Administrator only. Returns false when nothing was removed, so a no-op never reads as a removal.';

revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

-- V8-R-GRP-006: "ANY MEMBER MAY LEAVE, including an administrator."
--
-- FAILS CLOSED, and the requirement says so in as many words: "if succession
-- cannot be computed the leave FAILS CLOSED rather than leaving the group
-- administrator-less". The post-condition is therefore ASSERTED here rather than
-- assumed of the trigger: after the delete, either the group is gone or it has
-- exactly one administrator. Anything else raises, and the transaction — the
-- delete included — is rolled back, so the member is still in a group that still
-- has an administrator.
create or replace function public.leave_group(p_group uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_admins integer;
  v_exists boolean;
begin
  if v_caller is null then
    raise exception 'leave_group: not authenticated' using errcode = '28000';
  end if;

  -- SERIALIZED PER GROUP. Two members leaving at once each read a membership
  -- that still contains the other, and succession would then be computed twice
  -- against two stale pictures — the classic last-two-out race, whose outcome is
  -- a group with no administrator or one whose administrator has also left.
  perform pg_advisory_xact_lock(
    hashtextextended('group_members:' || p_group::text, 0)
  );

  delete from public.group_members m
   where m.group_id = p_group
     and m.profile_id = v_caller;

  if not found then
    return false;  -- not a member; nothing happened, and nothing is reported
  end if;

  -- The trigger has already run succession by here. Verify its post-condition.
  select exists (select 1 from public.groups g where g.id = p_group) into v_exists;

  if v_exists then
    select count(*) into v_admins
      from public.group_members m
     where m.group_id = p_group
       and m.is_admin;

    if v_admins <> 1 then
      raise exception 'leave_group: succession failed; the group would be left administrator-less'
        using errcode = '55000';
    end if;
  end if;

  return true;
end;
$$;

comment on function public.leave_group(uuid) is
  'V8-R-GRP-006 / D-C-38. Any member may leave. Succession runs in the trigger; this verb ASSERTS the post-condition and fails closed, rolling the leave back rather than leaving a group administrator-less.';

revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;

------------------------------------------------------------------------------
-- 5. Sending and deleting messages (V8-R-GRP-002, V8-R-GRP-007)
------------------------------------------------------------------------------

-- V8-R-GRP-002: "Any member may send TEXT and PHOTOS into the persistent
-- thread."
--
-- THE PHOTO CROSSES THE WP1 BOUNDARY, AND THIS FUNCTION IS WHERE THAT BECOMES
-- TRUE. `p_media_id` names a `media_objects` row, which only
-- `/api/media/upload` mints and only after decoding and re-encoding the bytes it
-- describes. A storage PATH parameter would have been a string a modified client
-- could invent, and V8-R-STO-014's whole point is that a client-declared fact is
-- not a trust boundary.
--
-- IT TAKES THE SAME LOCKS `publish_story` TAKES, for the same reason, and the
-- reasoning is 0066's rather than new. A media object can be claimed for byte
-- removal at any moment; existence is a fact about the past. So:
--
--   * the PATH advisory lock first, because `for update` locks NOTHING when the
--     registry row does not exist — which is exactly the orphan sweep's
--     population — and the sweep adopts a path inside its own transaction;
--   * then `for update` on the registry row, which is the row
--     `claim_media_for_removal` recounts and stamps under;
--   * then the claim test, so a message can never appear against bytes already
--     committed to deletion.
--
-- AND IT WRITES THE SPINE ROW. `media_destinations (kind='group', ref_id=<message
-- id>)` is what makes `media_live_reference_count` see this message, which is
-- what keeps the sweep from reclaiming a photo a live thread is still showing.
-- Omitting it would leave a group photo counted by nothing at all — 0066's
-- second, story-only fallback term does not cover this kind — and the first
-- sweep past the 24-hour grace window would destroy it.
create or replace function public.send_group_message(
  p_group uuid,
  p_body text default null,
  p_media_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_path text;
  v_message uuid;
begin
  if v_caller is null then
    raise exception 'send_group_message: not authenticated' using errcode = '28000';
  end if;

  -- SERVER-ENFORCED MEMBERSHIP, read from the table rather than through the
  -- party-guarded helper, for the same reason the administrative verbs do.
  if not exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = v_caller
  ) then
    raise exception 'send_group_message: you are not a member of that group'
      using errcode = '42501';
  end if;

  if v_body is null and p_media_id is null then
    raise exception 'send_group_message: a message needs text or a photo'
      using errcode = '22023';
  end if;
  if v_body is not null and length(v_body) > 2000 then
    raise exception 'send_group_message: that message is too long'
      using errcode = '22001';
  end if;

  if p_media_id is not null then
    -- OWNERSHIP FIRST. The sender must own the object they are attaching;
    -- otherwise any member could name somebody else's media id and mint a live
    -- reference to bytes they were never shown, holding them off reclamation.
    select m.storage_path into v_path
      from public.media_objects m
     where m.id = p_media_id
       and m.owner_id = v_caller;

    if v_path is null then
      raise exception 'send_group_message: those bytes are not yours to send'
        using errcode = '42501';
    end if;

    -- OWNERSHIP IS NOT EVIDENCE. Round-3 finding: this checked that the caller OWNS the
    -- media_objects row and that its bytes had not been reclaimed, and stopped there — so a row
    -- the upload route never vouched for could still be attached to a group thread.
    -- `server_verified` is exactly the distinction 0066 draws, and it defaults to FALSE: it is
    -- true only for bytes the server decoded and accepted. Requiring it here is what makes "group
    -- photos cross the WP1 boundary" a fact rather than a sentence in a comment.
    if not exists (
      select 1
        from public.media_objects m
       where m.id = p_media_id
         and m.server_verified
    ) then
      raise exception 'send_group_message: those bytes were never verified by the upload route'
        using errcode = '42501';
    end if;

    -- AND IN THE RIGHT BUCKET. The path lock below is taken on 'story-media'; if the object does
    -- not actually live there, the lock guards nothing and the destination row points somewhere
    -- the reclamation sweep does not look.
    if not exists (
      select 1
        from storage.objects o
       where o.bucket_id = 'story-media'
         and o.name = v_path
    ) then
      raise exception 'send_group_message: that object is not in the story-media bucket'
        using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(public.media_path_lock_key('story-media', v_path));

    perform 1 from public.media_objects m where m.id = p_media_id for update;

    if exists (
      select 1
        from public.media_objects m
       where m.id = p_media_id
         and m.bytes_removed_at is not null
    ) then
      raise exception 'send_group_message: those bytes have already been reclaimed'
        using errcode = '22023';
    end if;
  end if;

  insert into public.group_messages (group_id, sender_id, body, media_id)
  values (p_group, v_caller, v_body, p_media_id)
  returning id into v_message;

  if p_media_id is not null then
    insert into public.media_destinations (media_id, kind, ref_id)
    values (p_media_id, 'group', v_message::text)
    on conflict do nothing;
  end if;

  return v_message;
end;
$$;

comment on function public.send_group_message(uuid, text, uuid) is
  'V8-R-GRP-002. Member-only send. A photo is a media_objects id (the WP1 boundary), attached under the same path lock, row lock and claim test publish_story uses, and it writes the kind=''group'' spine row that keeps the reclamation sweep off a live thread''s photo.';

revoke all on function public.send_group_message(uuid, text, uuid) from public, anon;
grant execute on function public.send_group_message(uuid, text, uuid) to authenticated;

-- V8-R-GRP-007: "SENDERS MAY DELETE THEIR OWN MESSAGES FOR EVERYONE.
-- ADMINISTRATORS MAY REMOVE messages from the group."
--
-- SOFT DELETE, and the reference is retired with it. Leaving the
-- `media_destinations` row live would hold the photo's bytes off reclamation
-- forever behind a message no one can read — the reference count would never
-- reach zero, exactly the "delete that cannot complete" 0066 describes for
-- stories.
--
-- The bytes themselves are NOT removed here. That is `claim_media_for_removal`'s
-- job, under the row lock that makes it safe; a byte removal issued from inside
-- this transaction would be the check-then-delete race 0066 exists to close.
create or replace function public.delete_group_message(p_message uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group uuid;
  v_sender uuid;
  v_media uuid;
begin
  if v_caller is null then
    raise exception 'delete_group_message: not authenticated' using errcode = '28000';
  end if;

  select g.group_id, g.sender_id, g.media_id
    into v_group, v_sender, v_media
    from public.group_messages g
   where g.id = p_message
     and g.deleted_at is null
   for update;

  if v_group is null then
    return false;  -- gone, or already deleted; not a fresh deletion
  end if;

  -- ONLY THE SENDER OR THE ADMINISTRATOR. Read from the table, not through the
  -- party-guarded helper, because this is a write authorization.
  -- `IS DISTINCT FROM`, NOT `<>`. With a departed sender (null) `v_sender <> v_caller`
  -- evaluates to NULL, and `NULL and true` is NULL, so this IF would not fire and the
  -- raise would be skipped -- handing any member of the group the right to delete a
  -- departed member's messages. `is distinct from` is true against NULL, so a null
  -- sender falls through to the administrator check, which is the correct authority:
  -- with no sender left, only an administrator may remove the message.
  if v_sender is distinct from v_caller and not exists (
    select 1
      from public.group_members m
     where m.group_id = v_group
       and m.profile_id = v_caller
       and m.is_admin
  ) then
    raise exception 'delete_group_message: that message is not yours to delete'
      using errcode = '42501';
  end if;

  update public.group_messages g
     set deleted_at = now(),
         deleted_by = v_caller
   where g.id = p_message
     and g.deleted_at is null;

  if not found then
    return false;  -- somebody else deleted it while we held the row
  end if;

  if v_media is not null then
    update public.media_destinations d
       set removed_at = now()
     where d.media_id = v_media
       and d.kind = 'group'
       and d.ref_id = p_message::text
       and d.removed_at is null;
  end if;

  return true;
end;
$$;

comment on function public.delete_group_message(uuid) is
  'V8-R-GRP-007. Sender or administrator only. Soft-deletes and retires the media destination in the same transaction, so a removed photo stops holding its bytes off reclamation.';

revoke all on function public.delete_group_message(uuid) from public, anon;
grant execute on function public.delete_group_message(uuid) to authenticated;

------------------------------------------------------------------------------
-- 5b. Retiring a photo destination when the MESSAGE ITSELF dies
------------------------------------------------------------------------------
--
-- `delete_group_message` above retires the destination, but it is only the SOFT-delete verb.
-- Two hard-delete routes bypass it entirely, and both are ordinary:
--
--   * the group is deleted (succession's no-member-remains branch, or a group cascade), which
--     cascades `group_messages` away;
--   * (X5 REMOVED THE SECOND ROUTE.) This used to read "the SENDER's profile is deleted,
--     which cascades their `group_messages` rows away". `sender_id` is now `on delete set
--     null`, because V8-R-GRP-007 enumerates removal causes and account deletion is not one
--     of them -- so a departing sender no longer destroys the message OR its destination.
--     The trigger stays exactly as it is: the group-deletion route above is still a hard
--     delete, and it is still the only place both remaining cascade paths pass through.
--
-- In both, the message row disappears while its `media_destinations` row with `kind='group'`
-- and `ref_id=<message id>` stays LIVE. WP1's reclamation counts every live non-story
-- destination, so those bytes are held off reclamation permanently by a reference to a message
-- that no longer exists — unreclaimable and unexplainable, because nothing is left to point at.
--
-- Put on the TABLE rather than in the verb precisely because the verb is the one path that was
-- already correct. A trigger is the only place both cascade routes pass through.
create or replace function public.group_message_retire_destination()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.media_id is not null then
    update public.media_destinations d
       set removed_at = now()
     where d.media_id = old.media_id
       and d.kind = 'group'
       and d.ref_id = old.id::text
       and d.removed_at is null;
  end if;
  return old;
end;
$$;

comment on function public.group_message_retire_destination() is
  'Retires the kind=''group'' media destination when a group_messages row is HARD-deleted (the group cascade). delete_group_message covers only the soft-delete verb. The sender-profile cascade route named here previously no longer exists: sender_id is ON DELETE SET NULL, because V8-R-GRP-007 does not list account deletion among its removal causes.';

revoke all on function public.group_message_retire_destination() from public, anon, authenticated;

drop trigger if exists group_messages_retire_destination_trigger on public.group_messages;
create trigger group_messages_retire_destination_trigger
  after delete on public.group_messages
  for each row
  execute function public.group_message_retire_destination();

------------------------------------------------------------------------------
-- 6. Reading the thread, and unread state (V8-R-GRP-008)
------------------------------------------------------------------------------

-- WHAT THIS VIEWER MAY SEE IN A THREAD, IN ONE PLACE.
--
-- Written once and consulted by the RLS policy, the unread count and
-- `media_read_window`'s group branch alike, because the same rule stated three
-- times is a rule that disagrees with itself twice. 0066 records exactly that
-- failure: `story_media_is_dead` and `media_read_window` each carried their own
-- version of the report rule and the two did not match.
--
-- THREE TERMS, and each one is a requirement rather than a precaution:
--
--   * membership — V8-R-GRP-001's trust boundary, "a non-member must not read
--     the thread or its media";
--   * the reporter's hide — V8-R-FEED-010, "reporting IMMEDIATELY HIDES the
--     reported content FOR THE REPORTER";
--   * the block — V8-R-FEED-009, "blocking prevents VISIBILITY and interaction
--     BETWEEN the affected users". The requirement's exclusion says a block does
--     not retroactively dissolve an existing shared group, and this honours that
--     exactly: the GROUP survives, the blocked party's MESSAGES do not show.
--     Reading the exclusion as "a block does nothing inside a shared group"
--     would make a shared group the one surface where a block is unenforced.
--
-- A member always sees their OWN message: `is_blocked_between` would otherwise
-- be asked about a caller and themselves.
create or replace function public.group_message_is_visible(p_message uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group uuid;
  v_sender uuid;
begin
  if v_caller is null or p_message is null then
    return false;
  end if;

  select g.group_id, g.sender_id
    into v_group, v_sender
    from public.group_messages g
   where g.id = p_message
     and g.deleted_at is null;

  if v_group is null then
    return false;
  end if;

  if not exists (
    select 1
      from public.group_members m
     where m.group_id = v_group
       and m.profile_id = v_caller
  ) then
    return false;
  end if;

  if exists (
    select 1
      from public.content_reports cr
     where cr.reporter_id = v_caller
       and cr.subject_kind = 'group_message'
       and cr.subject_ref = p_message::text
  ) then
    return false;
  end if;

  -- A departed sender (null) has no account left to be blocked, so no block applies and the
  -- message stays visible. Stated explicitly rather than relying on `NULL <> caller` being NULL:
  -- the same expression one function down decided a COUNT rather than a branch, and got it wrong.
  if v_sender is not null and v_sender <> v_caller
     and public.is_blocked_between(v_caller, v_sender) then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.group_message_is_visible(uuid) is
  'V8-R-GRP-001 / V8-R-FEED-009 / V8-R-FEED-010. The single definition of "this caller may see this group message": member, not reported by them, not from a blocked counterpart. The thread policy, the unread count and media_read_window''s group branch all ask THIS.';

revoke all on function public.group_message_is_visible(uuid) from public, anon;
grant execute on function public.group_message_is_visible(uuid) to authenticated;

-- V8-R-GRP-008. Reading is a caller-scoped write of one timestamp — the entire
-- alternative to a push per message.
create or replace function public.mark_group_read(p_group uuid, p_through timestamptz default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'mark_group_read: not authenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = v_caller
  ) then
    return false;
  end if;

  -- THE WATERMARK, NOT THE CLOCK.
  --
  -- Round-3 finding: this stamped now(), so read state advanced past any message that arrived
  -- between the thread fetch and this call — messages the viewer never saw, marked read and gone
  -- from the unread badge with no way back. The boundary must be the newest message the caller
  -- was actually SHOWN, which only the caller knows, so the caller passes it.
  --
  -- coalesce keeps the old behaviour when nothing is supplied (an empty thread has no newest
  -- message), and least() refuses a watermark from the future: neither a skewed client clock nor
  -- a hand-made call may mark unseen messages read.
  insert into public.group_reads (group_id, profile_id, last_read_at)
  values (p_group, v_caller, least(coalesce(p_through, now()), now()))
  on conflict (group_id, profile_id) do update
     -- NEVER BACKWARDS. Two tabs marking the same thread read can arrive out of
     -- order, and an older timestamp landing last would resurrect unread
     -- messages the member has already seen.
     set last_read_at = greatest(public.group_reads.last_read_at, excluded.last_read_at);

  return true;
end;
$$;

comment on function public.mark_group_read(uuid, timestamptz) is
  'V8-R-GRP-008. In-app read state, monotonic so an out-of-order write cannot resurrect read messages.';

revoke all on function public.mark_group_read(uuid, timestamptz) from public, anon;
grant execute on function public.mark_group_read(uuid, timestamptz) to authenticated;

-- THE DELIVERY MECHANISM, and it is a READ. There is no push here and no sender
-- anywhere in this file; V8-R-GRP-008's exclusion is "NO push notification per
-- ordinary group message", so unread is something the app ASKS FOR.
--
-- A member's own messages never count as unread to themselves, and neither does
-- anything `group_message_is_visible` hides — a reported message that still
-- incremented a badge would be a hide that announces itself.
create or replace function public.group_unread_counts()
returns table (group_id uuid, unread_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return;
  end if;

  return query
    select m.group_id,
           (select count(*)::int
              from public.group_messages msg
             where msg.group_id = m.group_id
               and msg.deleted_at is null
               -- `IS DISTINCT FROM` so a departed member's message still counts as
               -- unread. `msg.sender_id <> v_caller` is NULL for a null sender, which
               -- drops the row from the count -- the thread would show unread messages
               -- the badge refused to count.
               and msg.sender_id is distinct from v_caller
               and msg.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
               and public.group_message_is_visible(msg.id))
      from public.group_members m
      left join public.group_reads r
        on r.group_id = m.group_id
       and r.profile_id = v_caller
     where m.profile_id = v_caller;
end;
$$;

comment on function public.group_unread_counts() is
  'V8-R-GRP-008. Caller-scoped in-app unread state — the whole of this file''s notification mechanism. No push is sent for an ordinary group message.';

revoke all on function public.group_unread_counts() from public, anon;
grant execute on function public.group_unread_counts() to authenticated;

-- THE ROSTER AND THE THREAD ARE READ THROUGH DEFINER RPCs, AND THAT IS FORCED.
--
-- `public.profiles` HAS NO CLIENT SELECT POLICY — 0006's handle-enumeration
-- guard, restated in 0010: "profiles has no client SELECT". So a PostgREST
-- embed (`group_members?select=...,profiles(handle,display_name)`) resolves the
-- membership rows and then returns NULL for every embedded profile. The roster
-- renders nameless and the thread renders unattributed, with no error anywhere —
-- the surface simply looks broken.
--
-- 0010 hit this first and settled the shape: a SECURITY DEFINER function that
-- joins `profiles` itself and returns exactly the two display columns, nothing
-- more. These two follow it. They do NOT relax the enumeration guard: a caller
-- learns a handle only for people who share a group with them, which is a set
-- they can already see.
--
-- The RLS policies in section 10 stay regardless. They are what stops a direct
-- table read leaking a thread; these functions are how the product reads it.
create or replace function public.get_group_members(p_group uuid)
returns table (
  profile_id uuid,
  handle text,
  display_name text,
  is_admin boolean,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null or p_group is null then
    return;
  end if;

  -- MEMBERS ONLY. Definer means this sees rows RLS would have refused, so the
  -- membership test that policy would have applied is applied here instead.
  if not exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = v_caller
  ) then
    return;
  end if;

  return query
    select m.profile_id, p.handle, p.display_name, m.is_admin, m.joined_at
      from public.group_members m
      join public.profiles p on p.id = m.profile_id
     where m.group_id = p_group
     -- SUCCESSION ORDER, so the surface naming the administrator and the rule
     -- that would choose the next one agree about who is longest-standing.
     order by m.joined_at, m.profile_id;
end;
$$;

comment on function public.get_group_members(uuid) is
  'V8-R-GRP-001. The roster, in D-C-38 succession order. A definer join because public.profiles carries no client SELECT (0006 enumeration guard); membership is re-tested here because definer bypasses the policy that would have done it.';

revoke all on function public.get_group_members(uuid) from public, anon;
grant execute on function public.get_group_members(uuid) to authenticated;

create or replace function public.get_group_thread(
  p_group uuid,
  p_limit integer default 200
)
returns table (
  id uuid,
  sender_id uuid,
  sender_handle text,
  sender_display_name text,
  body text,
  media_id uuid,
  -- Round 6: null media plus a non-null stamp is "the photo is gone", which the UI renders as a
  -- tombstone. Without it the client cannot tell that case from a text-only message.
  media_removed_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if v_caller is null or p_group is null then
    return;
  end if;

  if not exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = v_caller
  ) then
    return;
  end if;

  -- NEWEST FIRST INSIDE THE LIMIT, OLDEST FIRST OUT. Ordering ascending and
  -- then limiting returns the OLDEST rows of a long thread and calls them the
  -- conversation.
  --
  -- THE VISIBILITY RULE IS `group_message_is_visible`, the same function the
  -- SELECT policy and the unread count ask. Restating it here is what would let
  -- the three answers drift.
  return query
    select t.id, t.sender_id, t.sender_handle, t.sender_display_name,
           t.body, t.media_id, t.media_removed_at, t.created_at
      from (
        select msg.id,
               msg.sender_id,
               p.handle as sender_handle,
               p.display_name as sender_display_name,
               msg.body,
               msg.media_id,
               msg.media_removed_at,
               msg.created_at
          from public.group_messages msg
          -- LEFT JOIN: an inner join drops every message whose sender has departed, which
          -- would delete the thread history this change exists to preserve. A null handle
          -- and display name are what the UI renders as "a departed member".
          left join public.profiles p on p.id = msg.sender_id
         where msg.group_id = p_group
           and msg.deleted_at is null
           and public.group_message_is_visible(msg.id)
         order by msg.created_at desc, msg.id desc
         limit v_limit
      ) t
     order by t.created_at, t.id;
end;
$$;

comment on function public.get_group_thread(uuid, integer) is
  'V8-R-GRP-002 / V8-R-FEED-009 / V8-R-FEED-010. The thread a member may actually see, attributed. Visibility is group_message_is_visible — the same definition the SELECT policy and the unread count use.';

revoke all on function public.get_group_thread(uuid, integer) from public, anon;
grant execute on function public.get_group_thread(uuid, integer) to authenticated;

------------------------------------------------------------------------------
-- 7. EC-03 — the 'group_message' report kind
--    THE CHECK CONSTRAINT AND THE FUNCTION WIDEN TOGETHER, IN THIS MIGRATION
------------------------------------------------------------------------------

-- HALF ONE: the constraint. Dropped and re-added rather than altered, because a
-- CHECK cannot be widened in place. The pair is idempotent: the drop tolerates
-- an absent constraint and the add always follows it in the same file.
--
-- The name is PostgreSQL's own for 0066's inline check on this column. Naming it
-- explicitly here is what lets WP5's 0069 widen the same constraint again
-- without guessing.
alter table public.content_reports
  drop constraint if exists content_reports_subject_kind_check;

alter table public.content_reports
  add constraint content_reports_subject_kind_check
  check (subject_kind in ('story', 'group_message'));

-- HALF TWO: the function, in the SAME migration.
--
-- 0066's body is preserved VERBATIM apart from the group branch marked below —
-- the bounds, the id-shape check, the per-reporter advisory lock, the daily cap,
-- the normalization to lower case, and the `do update set reason = <itself>`
-- idempotency are all 0066's and are not this lane's to reconsider. The story
-- case in particular is preserved EXACTLY as it stands, which EC-03 requires in
-- as many words.
--
-- What changes is the kind gate. 0066 raised for every kind other than 'story'
-- because no other subject had a table to resolve against. `group_messages` now
-- exists, so 'group_message' gets its existence-and-visibility branch and the
-- gate widens to the two kinds this schema can actually resolve.
--
-- THE VISIBILITY TEST IS `group_message_is_visible`, not a fresh subquery.
-- "The reporter must be able to actually see the message, evaluated server-side,
-- honouring blocks" is the same question the thread policy asks, and asking it
-- through the same function is what stops the two answers diverging.
create or replace function public.report_content(
  p_subject_kind text,
  p_subject_ref text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'report_content: not authenticated' using errcode = '28000';
  end if;

  if p_subject_ref is null or length(btrim(p_subject_ref)) = 0 then
    raise exception 'report_content: subject_ref is required'
      using errcode = '22023';
  end if;
  if length(p_subject_ref) > 200 then
    raise exception 'report_content: subject_ref is too long'
      using errcode = '22001';
  end if;
  if p_reason is not null and length(p_reason) > 1000 then
    raise exception 'report_content: reason is too long'
      using errcode = '22001';
  end if;

  if btrim(p_subject_ref) !~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'report_content: subject_ref is not an id'
      using errcode = '22023';
  end if;

  -- A KIND THIS SCHEMA CANNOT RESOLVE IS STILL REFUSED. 0066's reasoning is
  -- unchanged and still correct — 'feed_post' and 'comment' have no table until
  -- WP5's 0069, and an unverifiable claim walks straight past the
  -- one-report-per-subject index. Only the set of resolvable kinds grew.
  if p_subject_kind not in ('story', 'group_message') then
    raise exception 'report_content: % has no reportable subject in this schema yet',
      p_subject_kind
      using errcode = '22023';
  end if;

  if p_subject_kind = 'story' then
    -- 0066'S STORY CASE, PRESERVED EXACTLY.
    if not exists (
      select 1
        from public.stories s
       where s.id = btrim(p_subject_ref)::uuid
         and s.deleted_at is null
         and s.expires_at > now()
         and (
           s.author_id = auth.uid()
           or (
             public.is_mutual_friend(auth.uid(), s.author_id)
             and (
               s.audience = 'friends'
               or public.is_story_recipient(s.id, auth.uid())
             )
           )
         )
    ) then
      raise exception 'report_content: that story is not yours to report'
        using errcode = '42501';
    end if;
  else
    -- THE GROUP-MESSAGE BRANCH — this migration's half of EC-03.
    --
    -- `group_message_is_visible` is the trusted existence-and-visibility check:
    -- the message is live, the reporter is a member of its group, and the sender
    -- is not blocked from them. It also excludes a message this caller has
    -- ALREADY reported, which is exactly right — a re-report is idempotent below
    -- and must keep returning the standing row rather than being refused here.
    if not public.group_message_is_visible(btrim(p_subject_ref)::uuid)
       and not exists (
         select 1
           from public.content_reports cr
          where cr.reporter_id = auth.uid()
            and cr.subject_kind = 'group_message'
            and cr.subject_ref = lower(btrim(p_subject_ref))
       ) then
      raise exception 'report_content: that message is not yours to report'
        using errcode = '42501';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('report_cap:' || auth.uid()::text, 0)
  );

  if not exists (
    select 1
      from public.content_reports cr
     where cr.reporter_id = auth.uid()
       and cr.subject_kind = p_subject_kind
       and cr.subject_ref = lower(btrim(p_subject_ref))
  ) and (
    select count(*)
      from public.content_reports cr
     where cr.reporter_id = auth.uid()
       and cr.created_at > now() - interval '24 hours'
  ) >= 50 then
    raise exception 'report_content: too many reports from this account today'
      using errcode = '54000';
  end if;

  insert into public.content_reports (reporter_id, subject_kind, subject_ref, reason)
  values (auth.uid(), p_subject_kind, lower(btrim(p_subject_ref)), p_reason)
  on conflict (reporter_id, subject_kind, subject_ref) do update
     set reason = public.content_reports.reason
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.report_content(text, text, text) is
  'V8-R-FEED-010, EC-03. 0066''s report verb widened to ''group_message'' in the same migration that widens the CHECK constraint. The story case is 0066''s, verbatim.';

revoke all on function public.report_content(text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text) to authenticated;

------------------------------------------------------------------------------
-- 8. Group photos are readable by the group (V8-R-GRP-001, V8-R-GRP-002)
------------------------------------------------------------------------------

-- WHY THIS FUNCTION IS REPLACED HERE AT ALL.
--
-- `media_read_window` is the ONE authorization `/api/media/:id/url` asks before
-- it mints a signed URL with service role. 0066 wrote it against `public.stories`
-- because a story was the only destination that existed: its viewer branch
-- authorizes through a readable story, and nothing else.
--
-- So without this replacement a group photo is readable by ITS SENDER ONLY —
-- the owner branch matches on the path prefix — and every OTHER member of the
-- group gets a 404 for a photo sitting in their own thread. V8-R-GRP-002 would
-- be "members send photos nobody can see", and V8-R-GRP-001's trust boundary
-- ("a non-member must not read the thread OR ITS MEDIA") would be half a rule:
-- the non-member half enforced, the member half impossible.
--
-- 0066's body is preserved verbatim; the group branch is ADDED, and 0066's file
-- is not touched. The two branches are ordered story-then-group and combined
-- with `greatest`, so a photo that is somehow both keeps the longer window it is
-- entitled to rather than whichever branch happened to run last.
--
-- THE GROUP WINDOW IS NULL, AND NULL IS CORRECT. A group message does not
-- expire — V8-R-GRP-007's retention is "messages persist until removed or the
-- group is deleted; there is no automatic expiry" — so there is no timestamp to
-- clamp against and `serverTtlSeconds` applies the 300-second ceiling on its
-- own. Inventing an expiry here would be inventing product policy.
--
-- Which makes the ORDER of the final decision load bearing: readability is a
-- boolean of its own, never `expiry is not null`, because for a group photo the
-- window is legitimately null while the answer is legitimately yes.
create or replace function public.media_read_window(p_name text)
returns table (readable boolean, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_expiry timestamptz;
  v_group_readable boolean := false;
begin
  if v_caller is null or p_name is null then
    return query select false, null::timestamptz;
    return;
  end if;

  -- IS THIS PATH SHOWN BY A GROUP MESSAGE THIS CALLER MAY SEE?
  --
  -- Computed for BOTH branches, because it is the answer for a member who is not
  -- the owner AND the reason an owner's own group photo must stay readable to
  -- them even when no story accounts for it.
  --
  -- Joined through `media_objects`, which is what a group message references —
  -- `group_messages.media_id` is a registry id, never a path, precisely so a
  -- client cannot name arbitrary bytes.
  select exists (
    select 1
      from public.group_messages msg
      join public.media_objects mo on mo.id = msg.media_id
     where mo.storage_path = p_name
       and mo.bucket_id = 'story-media'
       and msg.deleted_at is null
       and public.group_message_is_visible(msg.id)
  ) into v_group_readable;

  -- THE OWNER, on their own prefix. 0066's branch, unchanged.
  if (storage.foldername(p_name))[1] = v_caller::text then
    if public.story_media_is_dead(p_name) then
      -- A GROUP MESSAGE IS STILL A LIVE DESTINATION. `story_media_is_dead`
      -- knows only about stories, so for a photo whose only destination is a
      -- group message it answers "dead" — and the sender would lose their own
      -- photo out of their own thread. The group term is the current fact and
      -- wins over a story-only verdict.
      if v_group_readable then
        return query select true, null::timestamptz;
        return;
      end if;
      return query select false, null::timestamptz;
      return;
    end if;

    v_expiry := public.media_path_unreported_live_expiry(p_name);

    if v_expiry is null and exists (
      select 1
        from public.stories s
       where (s.media_path = p_name or s.inset_path = p_name)
         and s.deleted_at is null
         and s.expires_at > now()
    ) then
      -- Every live story on this path is one the caller reported. That hide is
      -- 0066's and it stands — but it says nothing about a group message, which
      -- is a different destination with its own visibility rule.
      if v_group_readable then
        return query select true, null::timestamptz;
        return;
      end if;
      return query select false, null::timestamptz;
      return;
    end if;

    return query select true, v_expiry;
    return;
  end if;

  -- A VIEWER. 0066's story branch, unchanged.
  select max(s.expires_at) into v_expiry
    from public.stories s
   where (s.media_path = p_name or s.inset_path = p_name)
     and s.deleted_at is null
     and s.expires_at > now()
     and public.is_mutual_friend(v_caller, s.author_id)
     and not exists (
       select 1
         from public.content_reports cr
        where cr.reporter_id = v_caller
          and cr.subject_kind = 'story'
          and cr.subject_ref = s.id::text
     )
     and (
       s.audience = 'friends'
       or public.is_story_recipient(s.id, v_caller)
     );

  -- READABILITY IS A BOOLEAN, NOT `expiry is not null`. A group photo authorises
  -- a read with NO expiry of its own, so deriving the answer from the timestamp
  -- would refuse exactly the case this section exists to allow.
  return query select (v_expiry is not null) or v_group_readable, v_expiry;
end;
$$;

comment on function public.media_read_window(text) is
  'V8-R-STO-015 / V8-R-FEED-009 / V8-R-GRP-002. 0066''s read decision, extended with the group-message destination so a member can see a photo in their own thread. A group photo has no expiry of its own, so its window is null and only the signed-URL ceiling applies.';

revoke all on function public.media_read_window(text) from public, anon;
grant execute on function public.media_read_window(text) to authenticated;

------------------------------------------------------------------------------
-- 9. Reusing the membership for a Night Out (V8-R-GRP-003)
------------------------------------------------------------------------------

-- "ANY MEMBER — not only an administrator — may reuse the CURRENT group
-- membership to invite the group to a Night Out. The group keeps its own
-- membership and is untouched by the invitation."
--
-- IT DELEGATES TO `invite_to_night_out` RATHER THAN INSERTING MEMBERS ITSELF,
-- and that is the whole design. The plan side owns its own rules — the caller
-- must hold a role on the plan, the plan must be draft or open, the seat cap,
-- the per-plan advisory lock, the invite event — and 0044/0045/0049/0050 have
-- rewritten them four times. Restating any of that here would be a fifth copy
-- that starts drifting on the next night-outs migration. `invite_to_night_out`
-- is SECURITY DEFINER and `auth.uid()` survives the call, so the caller's own
-- authority on the plan is what is checked, exactly as it would be one at a
-- time.
--
-- PER PERSON, AND PARTIAL SUCCESS IS REPORTED HONESTLY. The requirement's
-- failure clause is "a failed invite shows a per-person Resend invite; other
-- successful invites are unaffected", so this returns one row per member with
-- what actually happened rather than a single boolean that would have to lie
-- about a mixed outcome.
--
-- THE GROUP IS NOT TOUCHED. There is no write to `group_members` anywhere in
-- this function; the exclusion "inviting never alters the group's own
-- membership" is satisfied by construction rather than by care.
------------------------------------------------------------------------------
-- 8b. V8-R-GRP-008, the half that was never built — INVITATION NOTIFICATIONS
------------------------------------------------------------------------------
--
-- The requirement reads: "V8 PROVIDES IN-APP UNREAD STATE **and NIGHT OUT INVITATION
-- NOTIFICATIONS**. V8 DOES NOT SEND A PUSH NOTIFICATION FOR EVERY ORDINARY GROUP MESSAGE."
-- Its states include "invitation notification sent".
--
-- This file shipped only the first half. The exclusion ("no push per ordinary group message")
-- was implemented as ABSENCE — correctly — but the inclusion was read as if it were part of the
-- same exclusion, so nothing was built. Round-1 finding: an invitee became a plan member and was
-- never told.
--
-- WHY `night_out_events` IS NOT ALREADY THIS. `invite_to_night_out` does insert
-- `night_out_events (kind='invited')`, but that table has no recipient column and is revoked
-- from `authenticated`: it is plan ACTIVITY, addressed to nobody and readable by nobody. A
-- notification has to name who it is for and be readable by them.
--
-- SCOPE, stated so the boundary is not mistaken for an omission. This lane owns 0067 and cannot
-- write a sender: APNs credentials, device tokens and the delivery worker are not in its write
-- scope, and GRP-008 puts the preference surface in `src/app/settings/preferences/page.tsx`,
-- which another lane owns. What belongs HERE is the durable, recipient-addressed record that a
-- sender consumes and the in-app surface reads — `delivered_at` is the seam that sender writes.
-- Building the record is what turns "entirely absent" into "present and addressable".
create table if not exists public.night_out_invitation_notifications (
  id            bigint      generated always as identity primary key,
  night_out_id  uuid        not null references public.night_outs(id)  on delete cascade,
  recipient_id  uuid        not null references public.profiles(id)    on delete cascade,
  -- The group the invitation came THROUGH, kept so the surface can say "via <group>". Nullable
  -- and ON DELETE SET NULL: deleting the group must not delete the invitation you received.
  group_id      uuid        null references public.groups(id)          on delete set null,
  invited_by    uuid        null references public.profiles(id)        on delete set null,
  created_at    timestamptz not null default now(),
  -- Written by the sender, not by this file. NULL means "not yet delivered to the OS surface".
  delivered_at  timestamptz,
  read_at       timestamptz,
  -- ONE notification per plan per recipient. A re-invite, a retry, or a second group containing
  -- the same person must not produce a second row: notification volume is the whole subject of
  -- this requirement.
  constraint night_out_invitation_notifications_unique unique (night_out_id, recipient_id)
);

create index if not exists night_out_invitation_notifications_recipient_idx
  on public.night_out_invitation_notifications (recipient_id, created_at desc);

alter table public.night_out_invitation_notifications enable row level security;
revoke all on table public.night_out_invitation_notifications from public, anon, authenticated;

-- SELECT ONLY, AND ONLY YOUR OWN. Every write goes through the definer functions below, exactly
-- as the four group tables do.
grant select on table public.night_out_invitation_notifications to authenticated;

drop policy if exists night_out_invitation_notifications_own_select
  on public.night_out_invitation_notifications;
create policy night_out_invitation_notifications_own_select
  on public.night_out_invitation_notifications
  for select
  to authenticated
  using (recipient_id = auth.uid());

comment on table public.night_out_invitation_notifications is
  'V8-R-GRP-008. The recipient-addressed Night Out invitation notification. Distinct from night_out_events, which is plan activity with no recipient and no reader. One row per (plan, recipient); delivered_at is written by the sender, not by this file.';

-- The recipient's own list. Zero-argument and auth-scoped, the same shape as
-- get_my_night_outs: a notification nobody can query is not a notification.
create or replace function public.get_my_night_out_invitation_notifications()
returns table (
  id            bigint,
  night_out_id  uuid,
  night         date,
  title         text,
  group_id      uuid,
  group_name    text,
  invited_by    uuid,
  created_at    timestamptz,
  read_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.night_out_id, o.night, o.title, n.group_id, g.name,
         n.invited_by, n.created_at, n.read_at
    from public.night_out_invitation_notifications n
    join public.night_outs o on o.id = n.night_out_id
    left join public.groups g on g.id = n.group_id
   where n.recipient_id = auth.uid()
     and o.status <> 'cancelled'
   order by n.created_at desc, n.id desc;
$$;

comment on function public.get_my_night_out_invitation_notifications() is
  'V8-R-GRP-008. The caller''s own Night Out invitation notifications. Cancelled plans are excluded, matching get_my_night_outs.';

-- ---------------------------------------------------------------------------
-- get_my_invitable_night_outs: the plans this caller may actually invite TO.
--
-- V8-R-GRP-003 needs a PICKER, and the group-invite surface previously made the
-- member type a raw plan uuid into a text box. A uuid is not a choice a person
-- can make.
--
-- WHY NOT `get_my_night_outs()`. That function exists and is the obvious reach,
-- and it is the wrong set twice over. 0053 deliberately narrowed it to
-- INVITATIONS -- `n.owner_id <> auth.uid()`, commented "invitations, not your
-- own plans" -- so the plans you HOST, the ones a member most often invites a
-- group to, are exactly the ones it hides. It also returns `decided` and past
-- plans, which `invite_to_night_out` refuses. Wrapping it would have offered a
-- list whose most useful entries were missing and whose visible entries could
-- fail.
--
-- THIS PREDICATE IS THE INVITE DOOR'S PREDICATE, deliberately identical. The
-- door admits when `night_out_role(id) is not null` -- an ACCEPTED member row,
-- owner rows being created accepted -- and the plan's status is 'draft' or
-- 'open'. The member join below is what `night_out_role` does, inlined for one
-- query instead of one call per row. Same shape as the EC-03 rule one layer
-- out: the list a surface OFFERS and the check the door APPLIES must agree, or
-- the UI advertises failures.
--
-- No date filter, for that same reason. Past nights whose status is still open
-- are invitable, and hiding them here while the door accepts them would be the
-- divergence this comment exists to prevent.
create or replace function public.get_my_invitable_night_outs()
returns table (
  night_out_id uuid,
  night        date,
  title        text,
  status       text,
  my_role      text
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.night, n.title, n.status, m.role::text
    from public.night_out_members m
    join public.night_outs n on n.id = m.night_out_id
   where m.user_id = auth.uid()
     and m.invite_status = 'accepted'
     and n.status in ('draft', 'open')
   order by n.night asc, n.id desc;
$$;

comment on function public.get_my_invitable_night_outs() is
  'V8-R-GRP-003. The caller''s Night Out plans that invite_to_night_out would accept: accepted membership (owner included) and status draft or open. Deliberately NOT get_my_night_outs, which excludes plans the caller owns and includes decided and past ones.';

revoke all on function public.get_my_invitable_night_outs() from public, anon;
grant execute on function public.get_my_invitable_night_outs() to authenticated;

revoke all on function public.get_my_night_out_invitation_notifications() from public, anon;
grant execute on function public.get_my_night_out_invitation_notifications() to authenticated;

create or replace function public.mark_night_out_invitation_notification_read(p_id bigint)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'mark_night_out_invitation_notification_read: not authenticated'
      using errcode = '28000';
  end if;

  update public.night_out_invitation_notifications n
     set read_at = now()
   where n.id = p_id
     and n.recipient_id = v_caller
     and n.read_at is null;

  return found;
end;
$$;

revoke all on function public.mark_night_out_invitation_notification_read(bigint) from public, anon;
grant execute on function public.mark_night_out_invitation_notification_read(bigint) to authenticated;

-- THE SINGLE DOOR EVERY NIGHT-OUT INVITE FROM THIS FILE GOES THROUGH.
--
-- Round-2 finding, raised independently by both review lanes: round 1 put the notification insert
-- inside invite_group_to_night_out, and then the per-person Resend added in the same round called
-- invite_to_night_out DIRECTLY — so the members whose first invite FAILED, the exact people the
-- Resend exists for, joined the plan with no invitation notification. The fix for one finding
-- reintroduced another on the narrower path.
--
-- Fixing that at the Resend caller would have left the same hole open for the next caller. This is
-- the door instead: newness decided, invite performed, notification recorded, in ONE place that
-- both paths call. A third caller gets the behaviour for free; a third caller that bypasses this
-- is the thing to catch in review, and it is now a single grep.
create or replace function public.invite_one_to_night_out(
  p_night_out uuid,
  p_user uuid,
  p_group uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_was_member boolean;
  v_invited boolean;
begin
  if v_caller is null then
    raise exception 'invite_one_to_night_out: not authenticated' using errcode = '28000';
  end if;

  -- THE ATTRIBUTION MUST BE EARNED, NOT ASSERTED.
  --
  -- Round-2 finding: this is granted to `authenticated` and took an arbitrary p_group with no
  -- check at all. Any caller holding a group's uuid could create their own night_out, invite a
  -- second account "via" that group, and the recipient's
  -- get_my_night_out_invitation_notifications would return that group's NAME — a disclosure to
  -- someone in neither the group nor the plan, and a forged provenance on a real notification.
  -- invite_group_to_night_out already verified caller membership before passing p_group; this
  -- door did not, which is exactly the gap a shared door is supposed to close rather than open.
  if p_group is not null and not exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = v_caller
  ) then
    raise exception 'invite_one_to_night_out: you are not a member of that group'
      using errcode = '42501';
  end if;

  -- AND THE RECIPIENT MUST BE IN IT TOO. Round-4 finding: round 3 checked the CALLER's membership
  -- and stopped, so a member could still attach their group — and its NAME, which
  -- get_my_night_out_invitation_notifications returns — to an invitation for an arbitrary
  -- outsider. Half a check on a two-sided claim is not a check: "via <group>" asserts something
  -- about BOTH parties, so both are verified.
  if p_group is not null and not exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = p_user
  ) then
    raise exception 'invite_one_to_night_out: that person is not a member of that group'
      using errcode = '42501';
  end if;

  -- BLOCKS ARE NOT NEGOTIABLE, and this door is where the group path can honour them.
  --
  -- Round-4 finding: the inherited invite_to_night_out (0050) carries no is_blocked_between check,
  -- so a group invite could reach someone the caller has blocked or been blocked by, which the
  -- group contract prohibits. 0050 is another lane's file and not this lane's to change; this door
  -- is wp6's, both group paths go through it, and refusing here closes the route this lane owns.
  -- The gap in the DIRECT invite path remains real and is recorded against HFX-R-103.
  if public.is_blocked_between(v_caller, p_user) then
    raise exception 'invite_one_to_night_out: that invitation cannot be sent'
      using errcode = '42501';
  end if;

  -- NEWNESS IS DECIDED BEFORE THE INVITE. invite_to_night_out returns true both for "newly
  -- invited" and for "was already on the plan" — deliberately, so a duplicate invite is not
  -- reported as a failure — which makes its return value useless for deciding whether to NOTIFY.
  -- Notifying on it would tell people already going that they had just been invited, and
  -- V8-R-GRP-008 is a notification-VOLUME requirement.
  v_was_member := exists (
    select 1
      from public.night_out_members nm
     where nm.night_out_id = p_night_out
       and nm.user_id = p_user
  );

  v_invited := public.invite_to_night_out(p_night_out, p_user);

  if v_invited and not v_was_member then
    insert into public.night_out_invitation_notifications
      (night_out_id, recipient_id, group_id, invited_by)
    values (p_night_out, p_user, p_group, v_caller)
    on conflict on constraint night_out_invitation_notifications_unique do nothing;
  end if;

  return v_invited;
end;
$$;

comment on function public.invite_one_to_night_out(uuid, uuid, uuid) is
  'V8-R-GRP-003 + V8-R-GRP-008. The single door: invites ONE person and records the invitation notification for a genuinely new invitee. Both the whole-group invite and the per-person Resend go through it, so neither can drift from the other.';

revoke all on function public.invite_one_to_night_out(uuid, uuid, uuid) from public, anon;
grant execute on function public.invite_one_to_night_out(uuid, uuid, uuid) to authenticated;

create or replace function public.invite_group_to_night_out(
  p_night_out uuid,
  p_group uuid
)
returns table (profile_id uuid, invited boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  r record;
  v_was_member boolean;
begin
  if v_caller is null then
    raise exception 'invite_group_to_night_out: not authenticated'
      using errcode = '28000';
  end if;

  -- ANY MEMBER, not only the administrator.
  if not exists (
    select 1
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id = v_caller
  ) then
    raise exception 'invite_group_to_night_out: you are not a member of that group'
      using errcode = '42501';
  end if;

  -- THE CURRENT MEMBERSHIP, read now. "server-enforced membership AT THE MOMENT
  -- OF INVITATION" — a list captured by the client when the sheet opened could
  -- name someone who has since been removed.
  --
  -- Ordered so a retry invites in the same sequence and a partial result is
  -- comparable with the one before it.
  for r in
    select m.profile_id as id
      from public.group_members m
     where m.group_id = p_group
       and m.profile_id <> v_caller
     order by m.joined_at, m.profile_id
  loop
    profile_id := r.id;

    -- ONE DOOR. Newness, the invite and the notification all live in invite_one_to_night_out, so
    -- this path and the per-person Resend cannot drift apart — which is exactly what happened in
    -- round 1, when this function held a private copy of the insert and the Resend did not.
    --
    -- ONE DOOR, TWO CALLERS, OPPOSITE NEEDS — and round 4 satisfied only one of them.
    --
    -- The door RAISES on a refusal, because the single-person Resend needs a refusal to surface
    -- rather than be swallowed into a false success. But this caller is a LOOP whose entire
    -- purpose is per-person outcomes: V8-R-GRP-003 says "a failed invite shows a per-person
    -- Resend invite; OTHER SUCCESSFUL INVITES ARE UNAFFECTED". Round 4 added the block check as a
    -- bare raise and let it propagate through here, so a single blocked member aborted the whole
    -- group invite, rolled back every earlier iteration, and returned NO outcomes at all — the
    -- exact whole-group failure the requirement forbids, reintroduced by the fix for another one.
    --
    -- A block between two members does NOT dissolve their shared group (this file's own design),
    -- so a group containing a blocked pair is an ordinary, reachable state, not an edge case.
    --
    -- So the refusal is caught HERE, at the caller that needs it as data, and left to propagate at
    -- the caller that needs it as an error. insufficient_privilege is exactly the class the door
    -- raises for every refusal it owns — not a member of the group, recipient not a member, or
    -- blocked — and each of those means the same thing to this loop: that person was not invited.
    begin
      invited := public.invite_one_to_night_out(p_night_out, r.id, p_group);
    exception
      when insufficient_privilege then
        invited := false;
    end;

    return next;
  end loop;
end;
$$;

comment on function public.invite_group_to_night_out(uuid, uuid) is
  'V8-R-GRP-003. ANY member may invite the group''s CURRENT membership to a Night Out. Delegates per person to invite_to_night_out so the plan''s own authorization, seat cap and events stay in one place, and reports per-person outcomes so a partial success is never rounded up.';

revoke all on function public.invite_group_to_night_out(uuid, uuid) from public, anon;
grant execute on function public.invite_group_to_night_out(uuid, uuid) to authenticated;

------------------------------------------------------------------------------
-- 10. Row level security
------------------------------------------------------------------------------

alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.group_messages enable row level security;
alter table public.group_reads    enable row level security;

-- EVERY WRITE IS A DEFINER VERB, so no table below carries an INSERT, UPDATE or
-- DELETE policy. That is the same shape 0044 uses for night_outs and it is what
-- makes the authorization above the only way in: a member cannot rename a group,
-- promote themselves, forge a message or un-delete one by writing the table
-- directly over PostgREST, because there is no policy that would let them.

drop policy if exists "groups: members read" on public.groups;
create policy "groups: members read"
  on public.groups for select
  to authenticated
  using (public.is_group_member(id, auth.uid()));

drop policy if exists "group_members: members read the roster" on public.group_members;
create policy "group_members: members read the roster"
  on public.group_members for select
  to authenticated
  using (public.is_group_member(group_id, auth.uid()));

-- THE THREAD READ RULE IS `group_message_is_visible`, THE SAME FUNCTION THE
-- UNREAD COUNT AND THE MEDIA WINDOW ASK. Membership, the reporter's hide and the
-- block all arrive together, and a later change to any of the three reaches all
-- three call sites at once.
drop policy if exists "group_messages: visible to the group" on public.group_messages;
create policy "group_messages: visible to the group"
  on public.group_messages for select
  to authenticated
  using (deleted_at is null and public.group_message_is_visible(id));

drop policy if exists "group_reads: own row" on public.group_reads;
create policy "group_reads: own row"
  on public.group_reads for select
  to authenticated
  using (profile_id = auth.uid());

revoke all on public.groups         from public, anon;
revoke all on public.group_members  from public, anon;
revoke all on public.group_messages from public, anon;
revoke all on public.group_reads    from public, anon;

-- SELECT ONLY. The verbs above hold every write.
grant select on public.groups         to authenticated;
grant select on public.group_members  to authenticated;
grant select on public.group_messages to authenticated;
grant select on public.group_reads    to authenticated;
