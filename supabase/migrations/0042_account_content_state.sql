-- Next Bar — account-owned persistence for lists and night history.
--
-- One row per user and state domain keeps unrelated writes independent: saving
-- a list cannot overwrite a night written by another device. The browser keeps
-- its existing synchronous localStorage stores; this table is their durable,
-- cross-device write-through copy.
--
-- 0037–0041 are deliberately absent from the Beta 1 RC. This migration is 0042
-- because those numbers already belong to census/social work on other branches;
-- migration identity must never be reused for different SQL.
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

create or replace function public.account_content_state_lww_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Client timestamps are the conflict clock. Ties lose, so a replay or two
  -- devices writing in the same millisecond cannot flip-flop the stored row.
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
--   drop function if exists public.account_content_state_lww_guard();
--   drop table if exists public.account_content_state;
