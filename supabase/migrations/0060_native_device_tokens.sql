-- Next Bar — 0060 native APNs device tokens + notification preferences (V8-4)
--
-- ⚠ COMMITTED UNAPPLIED. Applying to staging is an ATTENDED action and is not
-- performed by this goal. Numbered ABOVE every ordinal the trunk has minted
-- (0059 is the highest) per CLAUDE.md — the earlier 0051/0052 and 0055/0056
-- numbers sorted BELOW migrations already applied to the serving database,
-- which a ledger-aware runner refuses. Do NOT run this worktree's
-- ledger-blind `npm run db:migrate` against a shared database.
--
-- This is the NATIVE iOS push store. It is deliberately SEPARATE from
-- 0009_push_subscriptions (Web Push / VAPID), which stays dark: the PRD is
-- explicit that web push is not the TestFlight implementation. Nothing here
-- reads, writes, enables or references a VAPID key.
--
-- Pattern copied from 0009: RLS on, direct client table writes REVOKEd,
-- SECURITY DEFINER RPCs as the only write path, per-user device cap enforced
-- INSIDE the RPC under a transaction advisory lock so it cannot be raced or
-- bypassed by a direct insert.
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. native_device_tokens
------------------------------------------------------------------------------

create table if not exists public.native_device_tokens (
  id              uuid        not null default gen_random_uuid(),
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  -- The APNs device token, hex. Apple's token is 32 bytes today but the
  -- length is explicitly not contractual, so this is a bound on junk rather
  -- than an exact-length assertion.
  token           text        not null,
  platform        text        not null default 'ios',
  -- Client-generated, per-INSTALL identity (see src/lib/nativePush.ts). This
  -- is what makes token ROTATION an update instead of a second row, and what
  -- sign-out revokes: "this installation", not "every device I own".
  installation_id text        not null,
  -- Revocation flag AND its timestamp. Rows are kept, not deleted, so a
  -- later re-registration on the same installation is an update and the
  -- sender can tell "never registered" from "deliberately revoked".
  revoked_at      timestamptz null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint native_device_tokens_pkey primary key (id),
  -- One row per (user, installation): the rotation path.
  constraint native_device_tokens_installation_key
    unique (user_id, installation_id),
  constraint native_device_tokens_platform_check
    check (platform in ('ios')),
  constraint native_device_tokens_token_check
    check (token ~ '^[0-9a-fA-F]{32,512}$'),
  constraint native_device_tokens_installation_check
    check (installation_id ~ '^[0-9a-zA-Z-]{8,64}$')
);

-- ONE OWNER PER PHYSICAL DEVICE TOKEN (the 0009 shared-device lesson): APNs
-- issues the token to the APP on the DEVICE, not to the account. Account B
-- registering on account A's phone gets the SAME token. Without this index
-- both rows coexist and the phone receives both accounts' notifications. The
-- save RPC transfers ownership explicitly instead of failing the insert.
create unique index if not exists native_device_tokens_token_key
  on public.native_device_tokens (token);

-- The sender's read path: "live tokens for this recipient".
create index if not exists native_device_tokens_live_idx
  on public.native_device_tokens (user_id)
  where revoked_at is null;

alter table public.native_device_tokens enable row level security;

-- Owner-read only (defense in depth; the sender runs with the service role,
-- which bypasses RLS). There is deliberately NO insert/update/delete policy:
-- writes go through the definer RPCs below.
drop policy if exists "native_device_tokens: owner can read" on public.native_device_tokens;
create policy "native_device_tokens: owner can read"
  on public.native_device_tokens for select
  using (auth.uid() = user_id);

revoke all on table public.native_device_tokens from public, anon, authenticated;
grant select on table public.native_device_tokens to authenticated;

------------------------------------------------------------------------------
-- 2. notification_preferences — per-event opt-outs
------------------------------------------------------------------------------

create table if not exists public.notification_preferences (
  user_id       uuid        not null references public.profiles(id) on delete cascade,
  -- Column names match public.night_out_events.kind exactly, so there is one
  -- vocabulary for the four PRD event types across the schema, the sender and
  -- the client.
  invited       boolean     not null default true,
  accepted      boolean     not null default true,
  bar_suggested boolean     not null default true,
  plan_changed  boolean     not null default true,
  updated_at    timestamptz not null default now(),
  constraint notification_preferences_pkey primary key (user_id)
);

alter table public.notification_preferences enable row level security;

drop policy if exists "notification_preferences: owner can read" on public.notification_preferences;
create policy "notification_preferences: owner can read"
  on public.notification_preferences for select
  using (auth.uid() = user_id);

revoke all on table public.notification_preferences from public, anon, authenticated;
grant select on table public.notification_preferences to authenticated;

------------------------------------------------------------------------------
-- 3. save_native_device_token — register or rotate the caller's token
------------------------------------------------------------------------------

create or replace function public.save_native_device_token(
  p_token text,
  p_platform text,
  p_installation text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  device_cap constant integer := 10;  -- live tokens per user
  uid uuid := auth.uid();
  existing integer;
begin
  if uid is null
     or p_token is null or p_token !~ '^[0-9a-fA-F]{32,512}$'
     or p_platform is null or p_platform not in ('ios')
     or p_installation is null or p_installation !~ '^[0-9a-zA-Z-]{8,64}$'
  then
    return false;
  end if;

  -- Serialize per user, exactly as 0009 does: two concurrent registrations
  -- could otherwise both read count = cap-1 and land cap+1 live rows.
  perform pg_advisory_xact_lock(hashtext('native_device_token:' || uid::text));

  -- Ownership transfer / reinstall. Both are the same physical token showing
  -- up somewhere it is no longer valid:
  --   * a DIFFERENT account on this phone — the token now belongs to us;
  --   * the SAME account after a reinstall — new installation identity, same
  --     token, so the stale installation row must go or the unique token
  --     index rejects the insert.
  delete from public.native_device_tokens t
   where t.token = p_token
     and (t.user_id <> uid or t.installation_id <> p_installation);

  -- Re-registering an installation we already hold must ALWAYS work, so the
  -- cap counts only OTHER live installations.
  select count(*) into existing
    from public.native_device_tokens t
   where t.user_id = uid
     and t.revoked_at is null
     and t.installation_id <> p_installation;

  if existing >= device_cap then
    return false;
  end if;

  insert into public.native_device_tokens as t
    (user_id, token, platform, installation_id)
  values (uid, p_token, p_platform, p_installation)
  on conflict on constraint native_device_tokens_installation_key
  do update set
    token = excluded.token,
    platform = excluded.platform,
    -- Re-registering un-revokes: the user granted permission again.
    revoked_at = null,
    updated_at = now();

  return true;
end;
$$;

revoke all on function public.save_native_device_token(text, text, text) from public, anon;
grant execute on function public.save_native_device_token(text, text, text) to authenticated;

------------------------------------------------------------------------------
-- 4. revoke_native_device_token — sign-out revokes THIS installation
------------------------------------------------------------------------------

create or replace function public.revoke_native_device_token(p_installation text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or p_installation is null then
    return false;
  end if;

  update public.native_device_tokens
     set revoked_at = now(), updated_at = now()
   where user_id = uid
     and installation_id = p_installation
     and revoked_at is null;

  return found;
end;
$$;

revoke all on function public.revoke_native_device_token(text) from public, anon;
grant execute on function public.revoke_native_device_token(text) to authenticated;

------------------------------------------------------------------------------
-- 5. revoke_all_native_device_tokens — account deletion / "stop everywhere"
------------------------------------------------------------------------------

create or replace function public.revoke_all_native_device_tokens()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  revoked integer;
begin
  if uid is null then
    return 0;
  end if;

  with updated as (
    update public.native_device_tokens
       set revoked_at = now(), updated_at = now()
     where user_id = uid
       and revoked_at is null
    returning 1
  )
  select count(*) into revoked from updated;

  return revoked;
end;
$$;

revoke all on function public.revoke_all_native_device_tokens() from public, anon;
grant execute on function public.revoke_all_native_device_tokens() to authenticated;

------------------------------------------------------------------------------
-- 6. set_notification_preferences — per-event opt-outs, caller's row only
------------------------------------------------------------------------------

create or replace function public.set_notification_preferences(
  p_invited boolean,
  p_accepted boolean,
  p_bar_suggested boolean,
  p_plan_changed boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null
     or p_invited is null or p_accepted is null
     or p_bar_suggested is null or p_plan_changed is null
  then
    return false;
  end if;

  insert into public.notification_preferences as p
    (user_id, invited, accepted, bar_suggested, plan_changed)
  values (uid, p_invited, p_accepted, p_bar_suggested, p_plan_changed)
  on conflict on constraint notification_preferences_pkey
  do update set
    invited = excluded.invited,
    accepted = excluded.accepted,
    bar_suggested = excluded.bar_suggested,
    plan_changed = excluded.plan_changed,
    updated_at = now();

  return true;
end;
$$;

revoke all on function public.set_notification_preferences(boolean, boolean, boolean, boolean)
  from public, anon;
grant execute on function public.set_notification_preferences(boolean, boolean, boolean, boolean)
  to authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   revoke all on function public.set_notification_preferences(boolean, boolean, boolean, boolean) from authenticated;
--   drop function if exists public.set_notification_preferences(boolean, boolean, boolean, boolean);
--   revoke all on function public.revoke_all_native_device_tokens() from authenticated;
--   drop function if exists public.revoke_all_native_device_tokens();
--   revoke all on function public.revoke_native_device_token(text) from authenticated;
--   drop function if exists public.revoke_native_device_token(text);
--   revoke all on function public.save_native_device_token(text, text, text) from authenticated;
--   drop function if exists public.save_native_device_token(text, text, text);
--   drop table if exists public.notification_preferences;
--   drop index if exists public.native_device_tokens_live_idx;
--   drop index if exists public.native_device_tokens_token_key;
--   drop table if exists public.native_device_tokens;
------------------------------------------------------------------------------
