-- Next Bar — 0061 server-owned notification outbox (V8-4)
--
-- ⚠ COMMITTED UNAPPLIED. Applying to staging is an ATTENDED action and is not
-- performed by this goal. Numbered ABOVE every ordinal the trunk has minted
-- (0059 is the highest) per CLAUDE.md, together with 0060 - the earlier
-- 0052 and 0056 numbers sorted BELOW migrations already applied to the
-- serving database, which a ledger-aware runner refuses.
--
-- Generates EXACTLY the four PRD event types — invited, accepted,
-- bar_suggested, plan_changed — into a server-owned outbox. The vocabulary is
-- the one 0044 already uses for public.night_out_events.kind; this migration
-- introduces no fifth type and no new name for an existing one.
--
-- WHY TRIGGERS AND NOT EDITED RPCs: the invite/accept RPCs were hardened
-- across 0045–0050 (accept race, cap boundary, invite re-check ordering).
-- `create or replace` on them here would mean restating those bodies and
-- risking a silent regression of that work. Triggers on the underlying tables
-- are purely additive, and they capture the event whichever RPC path caused
-- it — including paths added later.
--
-- OWNERSHIP: both tables are server-only. RLS is on and there are NO grants
-- and NO policies for anon/authenticated, so the only reader/writer is the
-- service-role sender. Clients never see the outbox.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. notification_outbox
------------------------------------------------------------------------------

create table if not exists public.notification_outbox (
  id                bigint      generated always as identity primary key,
  event_type        text        not null,
  night_out_id      uuid        not null references public.night_outs(id) on delete cascade,
  recipient_user_id uuid        not null references public.profiles(id) on delete cascade,
  actor_id          uuid        null references public.profiles(id) on delete set null,
  bar_id            text        null,
  -- IDEMPOTENCY (criterion 3). Every key ends in a per-OCCURRENCE
  -- discriminator — the member row's timestamp, the suggested bar, the plan
  -- revision — so re-running the same occurrence is a no-op while a genuine
  -- LATER event of the same type to the same person still enqueues.
  dedupe_key        text        not null,
  status            text        not null default 'pending',
  attempts          integer     not null default 0,
  last_error        text        null,
  processed_at      timestamptz null,
  -- WHEN THIS ROW WAS ADMITTED THROUGH THE RATE LIMIT, set once and never
  -- moved. This is the budget's unit of account, and it is stamped by
  -- admit_notification_send in the same statement that decides - see the
  -- function at the foot of this file for why counting after the fact could
  -- not be made correct.
  admitted_at       timestamptz null,
  -- LEASE. A drain must CLAIM rows before sending, or two overlapping drains
  -- both read the same pending rows and both send — the user gets the same
  -- notification twice (cold panel, both lanes, HIGH). A timestamp rather than
  -- a boolean so a drain that dies mid-batch does not strand its rows: the
  -- claim expires and they become claimable again.
  claimed_at        timestamptz null,
  -- OWNERSHIP FENCE. claimed_at alone says a claim EXISTS, never WHOSE it is:
  -- once a lease expired, a second drain could claim the row while the first
  -- was still sending, and the first drain's later status write would land on
  -- work it no longer owned. Every drain write is now conditioned on the token
  -- it was handed at claim time, so a superseded worker's update matches no row
  -- and is discarded instead of clobbering the live claim.
  claim_token       uuid        null,
  created_at        timestamptz not null default now(),
  constraint notification_outbox_dedupe_key unique (dedupe_key),
  constraint notification_outbox_event_check
    check (event_type in ('invited', 'accepted', 'bar_suggested', 'plan_changed')),
  constraint notification_outbox_status_check
    check (status in ('pending', 'sent', 'failed', 'suppressed')),
  constraint notification_outbox_bar_check
    check (bar_id is null or bar_id ~ '^[a-z0-9-]{1,60}$')
);

-- Additive for an already-created table (this migration is re-runnable).
alter table public.notification_outbox
  add column if not exists claimed_at timestamptz null;
alter table public.notification_outbox
  add column if not exists claim_token uuid null;
alter table public.notification_outbox
  add column if not exists admitted_at timestamptz null;

-- The drain query: oldest pending first.
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (created_at, id)
  where status = 'pending';

-- The rate-limit window read, issued inside admit_notification_send: recipient
-- + admitted_at. The pending index above cannot serve it, so without this
-- every drained row scanned the settled portion of the outbox, up to a hundred
-- times per batch.
--
-- Recreated rather than added, twice now: the first version keyed on
-- (recipient, processed_at) over status = 'sent', which missed a row still
-- pending for a second device's retry, and the second keyed on delivered_at,
-- which was stamped after the decision and so could not bound it.
drop index if exists public.notification_outbox_recent_sends_idx;
create index if not exists notification_outbox_recent_sends_idx
  on public.notification_outbox (recipient_user_id, admitted_at)
  where admitted_at is not null;

alter table public.notification_outbox enable row level security;
revoke all on table public.notification_outbox from public, anon, authenticated;

------------------------------------------------------------------------------
-- 2. notification_deliveries — one row per (outbox row, device)
------------------------------------------------------------------------------

create table if not exists public.notification_deliveries (
  id              bigint      generated always as identity primary key,
  outbox_id       bigint      not null references public.notification_outbox(id) on delete cascade,
  device_token_id uuid        not null references public.native_device_tokens(id) on delete cascade,
  status          text        not null,
  apns_status     integer     null,
  apns_reason     text        null,
  -- WHICH outbox claim reserved this row. The claim fence on the outbox row
  -- stops a superseded drain writing a STATUS, but nothing stopped it writing
  -- a DELIVERY: a stalled sender that resumed after its lease expired could
  -- overwrite a `sent` row this drain had already settled with its own stale
  -- `failed`, which handed the outbox a retry that was not owed. Recording the
  -- claim here lets the delivery write be fenced the same way.
  claim_token     uuid        null,
  created_at      timestamptz not null default now(),
  -- This is the (event, recipient, device) half of criterion 3. The unique
  -- key alone only deduplicates the AUDIT ROW, which is written after APNs has
  -- already been called - it cannot stop a second SEND. The sender therefore
  -- RESERVES this row with status 'pending' BEFORE calling APNs.
  --
  -- What that buys, precisely: a device recorded 'sent' or 'invalid_token' is
  -- SETTLED and is never sent to again, so a re-drained outbox row cannot
  -- repeat a delivery that already happened. A row still 'pending' or 'failed'
  -- is retakeable, because only an outbox claim that has already EXPIRED can
  -- present one to a second drain - the claim fence gives one drain at a time
  -- the right to touch the row. So the residual duplicate window is a sender
  -- wedged past the whole lease, and the alternative - refusing to retake a
  -- 'pending' row - silently drops the notification whenever a worker dies
  -- between reserving and calling Apple. A collapse-id is set on every push,
  -- so Apple folds a repeat of the same Night Out together anyway.
  constraint notification_deliveries_once unique (outbox_id, device_token_id),
  constraint notification_deliveries_status_check
    check (status in ('pending', 'sent', 'failed', 'invalid_token'))
);

-- Additive for an already-created table (this migration is re-runnable).
alter table public.notification_deliveries
  add column if not exists claim_token uuid null;

-- Re-runnable widening for an already-created table.
alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status in ('pending', 'sent', 'failed', 'invalid_token'));

-- Per-device delivery history: the audit read, and the lookup reserveDelivery
-- does on every send. NOT the rate-limit read - that one is on the outbox and
-- has its own index below. This comment used to claim it was, which sent a
-- reader looking for a query that does not exist.
create index if not exists notification_deliveries_recent_idx
  on public.notification_deliveries (device_token_id, created_at);

alter table public.notification_deliveries enable row level security;
revoke all on table public.notification_deliveries from public, anon, authenticated;

------------------------------------------------------------------------------
-- 3. night_outs.plan_revision — the plan_changed occurrence discriminator
------------------------------------------------------------------------------
-- Additive column with a default, bumped only when a field a guest would
-- care about actually changes. Without it, a plan edited A → B → A would
-- dedupe the second A against the first and silently drop a real change.

alter table public.night_outs
  add column if not exists plan_revision integer not null default 0;

create or replace function public.night_outs_bump_plan_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.night is distinct from old.night
     or new.title is distinct from old.title
     or new.status is distinct from old.status
     or new.decided_bar_id is distinct from old.decided_bar_id
  then
    new.plan_revision := old.plan_revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists night_outs_bump_plan_revision on public.night_outs;
create trigger night_outs_bump_plan_revision
  before update on public.night_outs
  for each row execute function public.night_outs_bump_plan_revision();

------------------------------------------------------------------------------
-- 4. enqueue helper
------------------------------------------------------------------------------
-- `on conflict do nothing` is the whole idempotency contract: a duplicate
-- occurrence is a silent no-op and never raises, so it can never fail the
-- user-facing RPC that triggered it.

create or replace function public.enqueue_notification(
  p_event_type text,
  p_night_out uuid,
  p_recipient uuid,
  p_actor uuid,
  p_bar_id text,
  p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never notify someone about their own action.
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;

  insert into public.notification_outbox
    (event_type, night_out_id, recipient_user_id, actor_id, bar_id, dedupe_key)
  values
    (p_event_type, p_night_out, p_recipient, p_actor, p_bar_id, p_dedupe_key)
  on conflict on constraint notification_outbox_dedupe_key do nothing;
end;
$$;

revoke all on function public.enqueue_notification(text, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;

------------------------------------------------------------------------------
-- 5. membership triggers — 'invited' and 'accepted'
------------------------------------------------------------------------------

create or replace function public.night_out_members_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  -- The plan creator's own 'owner'/'accepted' seed row is not an invitation
  -- and not an acceptance.
  if new.role = 'owner' then
    return null;
  end if;

  select o.owner_id into v_owner
    from public.night_outs o
   where o.id = new.night_out_id;

  if tg_op = 'INSERT' and new.invite_status = 'pending' then
    -- Someone was invited. Recipient is the invitee.
    perform public.enqueue_notification(
      'invited', new.night_out_id, new.user_id, new.invited_by, null,
      'invited:' || new.night_out_id::text || ':' || new.user_id::text || ':' ||
        extract(epoch from new.created_at)::text);
    return null;
  end if;

  -- An acceptance: either a direct token join (INSERT already 'accepted') or
  -- a pending invitation converting (UPDATE). The host is the one who wants
  -- to know. A decline produces no notification — the PRD has four types.
  if new.invite_status = 'accepted'
     and (tg_op = 'INSERT' or old.invite_status is distinct from 'accepted')
  then
    perform public.enqueue_notification(
      'accepted', new.night_out_id, v_owner, new.user_id, null,
      'accepted:' || new.night_out_id::text || ':' || new.user_id::text || ':' ||
        extract(epoch from coalesce(new.responded_at, new.created_at))::text);
  end if;

  return null;
end;
$$;

drop trigger if exists night_out_members_notify on public.night_out_members;
create trigger night_out_members_notify
  after insert or update on public.night_out_members
  for each row execute function public.night_out_members_notify();

------------------------------------------------------------------------------
-- 6. suggestion trigger — 'bar_suggested'
------------------------------------------------------------------------------

create or replace function public.night_out_suggestions_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member record;
begin
  -- Everyone actually going, minus whoever suggested it.
  for v_member in
    select m.user_id
      from public.night_out_members m
     where m.night_out_id = new.night_out_id
       and m.invite_status = 'accepted'
       and m.user_id <> new.suggested_by
  loop
    perform public.enqueue_notification(
      'bar_suggested', new.night_out_id, v_member.user_id, new.suggested_by,
      new.bar_id,
      'bar_suggested:' || new.night_out_id::text || ':' || new.bar_id || ':' ||
        v_member.user_id::text);
  end loop;

  return null;
end;
$$;

drop trigger if exists night_out_suggestions_notify on public.night_out_suggestions;
create trigger night_out_suggestions_notify
  after insert on public.night_out_suggestions
  for each row execute function public.night_out_suggestions_notify();

------------------------------------------------------------------------------
-- 7. plan trigger — 'plan_changed'
------------------------------------------------------------------------------

create or replace function public.night_outs_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_member record;
begin
  -- No bump means nothing a guest would notice changed (the BEFORE trigger in
  -- section 3 is the single decision point for that).
  if new.plan_revision = old.plan_revision then
    return null;
  end if;

  for v_member in
    select m.user_id
      from public.night_out_members m
     where m.night_out_id = new.id
       and m.invite_status = 'accepted'
  loop
    perform public.enqueue_notification(
      'plan_changed', new.id, v_member.user_id, v_actor, new.decided_bar_id,
      'plan_changed:' || new.id::text || ':' || new.plan_revision::text || ':' ||
        v_member.user_id::text);
  end loop;

  return null;
end;
$$;

drop trigger if exists night_outs_notify on public.night_outs;
create trigger night_outs_notify
  after update on public.night_outs
  for each row execute function public.night_outs_notify();

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   drop trigger if exists night_outs_notify on public.night_outs;
--   drop function if exists public.night_outs_notify();
--   drop trigger if exists night_out_suggestions_notify on public.night_out_suggestions;
--   drop function if exists public.night_out_suggestions_notify();
--   drop trigger if exists night_out_members_notify on public.night_out_members;
--   drop function if exists public.night_out_members_notify();
--   drop function if exists public.enqueue_notification(text, uuid, uuid, uuid, text, text);
--   drop trigger if exists night_outs_bump_plan_revision on public.night_outs;
--   drop function if exists public.night_outs_bump_plan_revision();
--   alter table public.night_outs drop column if exists plan_revision;
--   drop table if exists public.notification_deliveries;
--   drop function if exists public.admit_notification_send(bigint, uuid, integer, integer);
--   drop function if exists public.claim_notification_outbox(integer, integer, integer);
--   drop table if exists public.notification_outbox;
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- Atomic claim — the only supported way to take work off this outbox
------------------------------------------------------------------------------
-- `for update skip locked` inside the CTE is what makes concurrent drains take
-- DISJOINT sets rather than the same one: a row another drain has locked is
-- skipped rather than waited for. Selecting and then updating in two statements
-- cannot achieve this — that is the race the drain shipped with.
--
-- Rows whose claim has expired are re-claimable, so a drain that crashes
-- between claiming and sending delays those notifications by the lease rather
-- than losing them.
--
-- The claim also CONSUMES AN ATTEMPT and stamps a fresh ownership token.
-- Counting attempts only on a graceful defer meant a worker that DIED after
-- claiming left the counter untouched, so a row that killed its drain every
-- time was re-claimed forever and never reached MAX_ATTEMPTS. Charging the
-- attempt at claim time makes the retry budget cover crashes as well as
-- refusals, and it is a single statement so it cannot be lost.
--
-- AND THE BUDGET IS ENFORCED HERE, not only by the caller. Charging the
-- attempt was not enough on its own: a worker killed between the claim
-- committing and the sender reading `attempts` never ran the caller's ceiling
-- check, so the counter climbed forever while the row kept being handed out.
-- The `retired` CTE retires an exhausted row and `claimable` refuses to return
-- one, so the loop terminates in SQL whatever the caller does. The two CTEs
-- touch disjoint rows - `attempts >= p_max_attempts` versus `<` - so no row is
-- updated twice in the one statement.
--
-- The two-argument signature is dropped first: `create or replace` with an
-- extra defaulted parameter OVERLOADS rather than replaces, which would leave
-- the old unbounded version callable.
drop function if exists public.claim_notification_outbox(integer, integer);

create or replace function public.claim_notification_outbox(
  p_limit integer default 100,
  p_lease_seconds integer default 300,
  p_max_attempts integer default 5
)
returns setof public.notification_outbox
language sql
security definer
set search_path = public
as $$
  with retired as (
    update public.notification_outbox o
       set status       = 'failed',
           last_error   = coalesce(o.last_error, 'max_attempts'),
           processed_at = now()
     where o.status = 'pending'
       and o.attempts >= p_max_attempts
       -- Only once the claim is gone. A row on its LAST legitimate attempt is
       -- live work: retiring it out from under the drain holding it would
       -- discard a send that is still in flight.
       and (o.claimed_at is null
            or o.claimed_at < now() - make_interval(secs => p_lease_seconds))
    returning o.id
  ),
  claimable as (
    select o.id
      from public.notification_outbox o
     where o.status = 'pending'
       and o.attempts < p_max_attempts
       and (o.claimed_at is null
            or o.claimed_at < now() - make_interval(secs => p_lease_seconds))
     order by o.created_at, o.id
     limit greatest(p_limit, 0)
     for update skip locked
  )
  update public.notification_outbox o
     set claimed_at  = now(),
         claim_token = gen_random_uuid(),
         attempts    = o.attempts + 1
    from claimable c
   where o.id = c.id
  returning o.*
$$;

-- Service-role only. This hands out sendable work; no client role may call it.
revoke all on function public.claim_notification_outbox(integer, integer, integer)
  from public, anon, authenticated;

------------------------------------------------------------------------------
-- Rate-limit admission (criterion 7) - decide and record in one statement
------------------------------------------------------------------------------
-- Counting recent sends in the sender and then deciding cannot be made
-- correct, and three review rounds are the evidence:
--
--   * Counting rows marked 'sent' missed a row still pending because a SECOND
--     device needed a retry - the recipient's phone had already buzzed.
--   * Counting a delivery timestamp written AFTER the decision let a row
--     count against itself on its own retry, and let a worker that died
--     between the send and the write leave a real delivery uncounted.
--   * Any read-then-decide, however it counts, lets two concurrent drains
--     holding DIFFERENT rows for the same recipient both read the same total
--     and both send.
--
-- So the count and the stamp happen together, under a per-recipient advisory
-- lock held for the transaction - the same device-cap pattern 0060 uses. The
-- lock is taken on the RECIPIENT, so drains working on different people never
-- wait for each other.
--
-- Admission is charged BEFORE the send, not after it: a row admitted whose
-- sends then fail still spent its slot for the window. That errs toward
-- suppressing, which is the right direction for a phone that buzzes.
-- `coalesce` means a retry of an already-admitted row keeps its original
-- stamp, so a deferred row neither drifts its own window forward nor counts
-- against itself (it is excluded by id anyway).
create or replace function public.admit_notification_send(
  p_id bigint,
  p_claim_token uuid,
  p_window_seconds integer,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_recent    integer;
begin
  -- Fenced on the claim: a drain whose lease expired may not spend budget.
  select o.recipient_user_id into v_recipient
    from public.notification_outbox o
   where o.id = p_id
     and o.claim_token = p_claim_token;
  if v_recipient is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('nb:notify:admit'), hashtext(v_recipient::text));

  select count(*) into v_recent
    from public.notification_outbox r
   where r.recipient_user_id = v_recipient
     and r.id <> p_id
     and r.admitted_at >= now() - make_interval(secs => greatest(p_window_seconds, 0));
  if v_recent >= p_limit then
    return false;
  end if;

  update public.notification_outbox o
     set admitted_at = coalesce(o.admitted_at, now())
   where o.id = p_id
     and o.claim_token = p_claim_token;
  return true;
end;
$$;

-- Service-role only. This spends a recipient's notification budget.
revoke all on function public.admit_notification_send(bigint, uuid, integer, integer)
  from public, anon, authenticated;
