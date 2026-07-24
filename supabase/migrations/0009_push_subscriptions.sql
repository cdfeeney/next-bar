-- Next Bar — 0009 push subscriptions (P1, ships dark)
--
-- ⚠ AUTHOR-ONLY OVERNIGHT: committed unapplied; attended apply via
-- `npm run db:migrate` is in the morning escalation queue.
--
-- Storage for Web Push subscriptions. The feature ships DARK: no VAPID
-- keys exist yet (escalated, D2), NEXT_PUBLIC_PUSH_ENABLED is unset, and
-- no UI calls the client yet. This migration is purely additive so the
-- schema is ready the moment the operator turns the lights on.
--
-- Pattern: 0006/0007/0008 — RLS on, client table-writes revoked, SECURITY
-- DEFINER RPCs are the only write path (per-user subscription cap lives in
-- the RPC and must not be bypassable by a direct insert).
--
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- 1. push_subscriptions
------------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- The browser-issued push endpoint URL uniquely identifies a
  -- subscription; one row per (user, endpoint) — a user can have several
  -- devices.
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint),
  -- Push endpoints are long URLs but not unbounded — cap junk. 2048 not
  -- 1024 (Opus review): some push services emit endpoints past 1k.
  check (char_length(endpoint) between 1 and 2048),
  check (char_length(p256dh) between 1 and 256),
  check (char_length(auth) between 1 and 256)
);

-- ONE OWNER PER ENDPOINT (DeepSeek review): browser subscriptions are
-- scoped to origin+SW, not to the signed-in user — on a shared device,
-- account B re-subscribing returns the SAME endpoint as account A. Without
-- this index both rows coexist and the device receives pushes cross-wired
-- between accounts. The save RPC transfers ownership explicitly.
create unique index if not exists push_subscriptions_endpoint_key
  on public.push_subscriptions (endpoint);

alter table public.push_subscriptions enable row level security;

-- Owner-read only (defense-in-depth; the sender runs with service role).
drop policy if exists "push_subscriptions: owner can read" on public.push_subscriptions;
create policy "push_subscriptions: owner can read"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select on table public.push_subscriptions to authenticated;

------------------------------------------------------------------------------
-- 2. save_push_subscription — upsert the caller's subscription
------------------------------------------------------------------------------

create or replace function public.save_push_subscription(
  sub_endpoint text,
  sub_p256dh text,
  sub_auth text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  device_cap constant integer := 10;  -- subscriptions per user
  uid uuid := auth.uid();
  existing integer;
begin
  if uid is null
     or sub_endpoint is null or char_length(sub_endpoint) not between 1 and 2048
     or sub_p256dh is null or char_length(sub_p256dh) not between 1 and 256
     or sub_auth is null or char_length(sub_auth) not between 1 and 256
  then
    return false;
  end if;

  -- Serialize per-user (DeepSeek review): two concurrent saves could both
  -- read count=9 and land 11 rows. A transaction-scoped advisory lock
  -- makes read-count → insert atomic per user; released at commit.
  perform pg_advisory_xact_lock(hashtext('push_sub:' || uid::text));

  -- Ownership transfer (shared device): the endpoint may currently belong
  -- to a DIFFERENT account — the browser hands the same endpoint to
  -- whoever is signed in. The unique endpoint index makes coexistence
  -- impossible; deleting the other account's row here makes the transfer
  -- explicit rather than an insert failure.
  delete from public.push_subscriptions s
   where s.endpoint = sub_endpoint
     and s.user_id <> uid;

  -- Re-subscribing an existing endpoint (key rotation) must always work,
  -- so the cap only counts OTHER endpoints.
  select count(*) into existing
    from public.push_subscriptions s
   where s.user_id = uid
     and s.endpoint <> sub_endpoint;

  if existing >= device_cap then
    return false;
  end if;

  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth)
  values (uid, sub_endpoint, sub_p256dh, sub_auth)
  on conflict (user_id, endpoint)
  do update set p256dh = excluded.p256dh, auth = excluded.auth;

  return true;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

------------------------------------------------------------------------------
-- 3. delete_push_subscription — remove the caller's own subscription
------------------------------------------------------------------------------

create or replace function public.delete_push_subscription(sub_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or sub_endpoint is null then
    return false;
  end if;

  delete from public.push_subscriptions
   where user_id = uid
     and endpoint = sub_endpoint;

  return found;
end;
$$;

revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   revoke all on function public.delete_push_subscription(text) from authenticated;
--   drop function if exists public.delete_push_subscription(text);
--   revoke all on function public.save_push_subscription(text, text, text) from authenticated;
--   drop function if exists public.save_push_subscription(text, text, text);
--   drop index if exists public.push_subscriptions_endpoint_key;
--   drop table if exists public.push_subscriptions;
------------------------------------------------------------------------------
