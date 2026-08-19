-- Next Bar — account-owned persistence for lists and night history.
--
-- One row per user and state domain keeps unrelated writes independent: saving
-- a list cannot overwrite a night written by another device. The browser keeps
-- its existing synchronous localStorage stores; this table is their durable,
-- cross-device write-through copy.
--
-- 0037–0041 are deliberately absent from the Beta 1 RC. This migration is 0042
-- because those numbers already belong to census/social work on other branches;
-- migration identity must never be reused for different SQL. 0042 has NO
-- dependency on any of 0037–0041 — it applies cleanly directly after 0036,
-- and the gap must not be "filled" retroactively.
--
-- Durable shared-token privacy disclosure: the 'shared_nights' domain's
-- payload carries the account's bearer share tokens (nightKey → token). They
-- are stored durably server-side so a reinstalled/new device can still manage
-- its links. They are protected by owner-only RLS, revocable at any time via
-- unshare_night(p_night) (which kills the public link), and are never exposed
-- by any anonymous read path (get_shared_night is token-keyed only).
--
-- Re-runnable for the intended schema inside the ledgered migration transaction.

create table if not exists public.account_content_state (
  user_id           uuid        not null references auth.users(id) on delete cascade,
  state_key         text        not null,
  payload           jsonb       not null,
  client_updated_at timestamptz not null,
  updated_at        timestamptz not null default now(),

  constraint account_content_state_pkey primary key (user_id, state_key),
  constraint account_content_state_key_check check (
    state_key in ('lists', 'night_log', 'night_archive', 'shared_nights')
  ),
  constraint account_content_state_payload_object check (
    jsonb_typeof(payload) = 'object' and payload ? 'data'
  ),
  -- The largest bounded domain is 60 archived nights. Refuse an accidentally
  -- unbounded or hostile browser payload before it becomes account storage.
  constraint account_content_state_payload_size check (
    octet_length(payload::text) <= 262144
  )
);

alter table public.account_content_state enable row level security;

drop policy if exists "account_content_state: owner can read own"
  on public.account_content_state;
drop policy if exists "account_content_state: owner can insert own"
  on public.account_content_state;
drop policy if exists "account_content_state: owner can update own"
  on public.account_content_state;
drop policy if exists "account_content_state: owner can delete own"
  on public.account_content_state;

create policy "account_content_state: owner can read own"
  on public.account_content_state for select
  using ((select auth.uid()) = user_id);

create policy "account_content_state: owner can insert own"
  on public.account_content_state for insert
  with check ((select auth.uid()) = user_id);

create policy "account_content_state: owner can update own"
  on public.account_content_state for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "account_content_state: owner can delete own"
  on public.account_content_state for delete
  using ((select auth.uid()) = user_id);

-- Revoke-first: a future RLS mistake must not make account history public.
revoke all on table public.account_content_state from public, anon, authenticated;
grant select, insert, update, delete
  on table public.account_content_state to authenticated;

-- Clock range guard (v2.1), INSERT and UPDATE: a bogus client clock (before
-- the product existed, or far-future) must never enter the LWW ordering,
-- where it would permanently win or permanently lose every later conflict.
-- Out-of-range RAISES — and the message carries ONLY the clock and the
-- state_key, never payload data (payloads are private account content and
-- must not leak into logs via error messages).
create or replace function public.account_content_state_clock_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_updated_at is null
     or new.client_updated_at < timestamptz '2026-01-01T00:00:00Z'
     or new.client_updated_at > now() + interval '1 day' then
    raise exception 'account_content_state: client_updated_at out of range (% for state_key %)',
      new.client_updated_at, new.state_key
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists account_content_state_clock
  on public.account_content_state;
create trigger account_content_state_clock
  before insert or update on public.account_content_state
  for each row execute procedure public.account_content_state_clock_guard();

create or replace function public.account_content_state_lww_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Client timestamps are the conflict clock. Ties lose, so a replay or two
  -- devices writing in the same millisecond cannot flip-flop the stored row.
  -- A STALE but in-range update returns null (silent LWW loss, no error) —
  -- the client detects it through the read-back confirmation contract, not
  -- through an exception. Range violations raise in the clock guard above.
  if new.client_updated_at is null
     or new.client_updated_at <= old.client_updated_at then
    return null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists account_content_state_lww
  on public.account_content_state;
create trigger account_content_state_lww
  before update on public.account_content_state
  for each row execute procedure public.account_content_state_lww_guard();

-- Rollback (data-destructive; use only under a separately reviewed recovery):
--   drop trigger if exists account_content_state_lww on public.account_content_state;
--   drop trigger if exists account_content_state_clock on public.account_content_state;
--   drop function if exists public.account_content_state_lww_guard();
--   drop function if exists public.account_content_state_clock_guard();
--   drop table if exists public.account_content_state;
