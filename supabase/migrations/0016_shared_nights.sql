-- Next Bar — 0016 shared nights (E4.4: the public night page's server surface)
--
-- Why: the E4.2 recap is local-only. Sharing a night must be an EXPLICIT,
-- per-night act (epic Q2: default private) — tapping "Share last night"
-- publishes THAT night's route, and only then. An unshared night has no
-- server row and the public page 404s.
--
-- BEARER-CAPABILITY DESIGN (DeepSeek adversarial review of the first
-- draft): the original (handle, date) lookup was an anon-facing handle-
-- enumeration oracle (empty-vs-nonempty result discrimination needs no
-- column pushdown), was brute-forceable over guessable two-tuples, and
-- quietly exposed is_private profiles to date-guessers. The fix that
-- kills all three at once: the share row carries an UNGUESSABLE
-- share_token (uuid), the anon read is keyed on the token ALONE, and the
-- link the owner sends is /u/[handle]/night/[token]. Knowing a handle
-- and a date now gets you nothing; holding the link the owner sent gets
-- you exactly what they sent. Re-sharing the same night keeps its token
-- (links stay alive); unsharing deletes the row (links die); sharing
-- again mints a fresh token.
--
-- WHAT LEAVES THE SERVER: bar ids in route order + which one was loved +
-- the display identity (handle, display name) + the night date. No
-- tiers, no scores, no per-visit timestamps. Scores remain owner-only
-- everywhere (0015 hard rule inherited).
--
-- Not needed here, and why (review finding 5): the upsert is single-row,
-- owner-scoped, last-write-wins over the same user's own intent — the
-- 0011 advisory-lock pattern exists for CAP COUNTING, which this has
-- none of. The conflict path never touches share_token, so a concurrent
-- double-share cannot rotate an already-sent link.
--
-- APPLY GATE (attended): `npm run db:migrate` + the behavioral RPC cycle
-- (share → anon get by token → unshare → gone) — function existence ≠
-- function works (the 42702 lesson).
--
-- Idempotent: create table/index if not exists + create or replace +
-- revoke-first grants. Safe to re-run.

------------------------------------------------------------------------------
-- 1. The table — one row per (owner, night); the row IS the share.
------------------------------------------------------------------------------

create table if not exists public.shared_nights (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  night        date        not null,
  -- Route order preserved; capped in the RPC (nobody hits 20 bars).
  bar_ids      text[]      not null,
  loved_bar_id text        null,
  share_token  uuid        not null default gen_random_uuid(),
  shared_at    timestamptz not null default now(),
  constraint shared_nights_pkey primary key (user_id, night)
);

create unique index if not exists shared_nights_token_key
  on public.shared_nights (share_token);

comment on table public.shared_nights is
  'Explicitly shared night routes (E4.4). Row existence = the owner''s '
  'per-night consent; share_token is the bearer capability the link '
  'carries. No tiers/scores here, ever. Direct table grants are forbidden '
  '— the RPCs are the entire surface.';

-- RLS on, and NO direct table grants to anon/authenticated: the RPCs below
-- are the entire surface (0015 pattern — a table grant would bypass the
-- validation and the token gate).
alter table public.shared_nights enable row level security;
revoke all on table public.shared_nights from public, anon, authenticated;

------------------------------------------------------------------------------
-- 2. share_night — owner upsert, validated; returns the link token
------------------------------------------------------------------------------

-- Params carry the p_ prefix so no name can ever collide with a
-- conflict-target column, and the upsert targets the CONSTRAINT anyway —
-- both halves of the 0011/0012 42702 rule.
create or replace function public.share_night(
  p_night date,
  p_bar_ids text[],
  p_loved_bar_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_token uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_night is null then
    raise exception 'night required' using errcode = '22004';
  end if;
  -- The route must be real: 1..20 non-empty ids.
  if p_bar_ids is null
     or array_length(p_bar_ids, 1) is null
     or array_length(p_bar_ids, 1) > 20 then
    raise exception 'route must have 1-20 bars' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_bar_ids) as b(id)
     where b.id is null or length(trim(b.id)) = 0 or length(b.id) > 100
  ) then
    raise exception 'invalid bar id in route' using errcode = '22023';
  end if;
  -- The E4.2 client rule ("Loved must be ON the route") enforced at the
  -- boundary, because a direct RPC caller is not the client.
  if p_loved_bar_id is not null
     and array_position(p_bar_ids, p_loved_bar_id) is null then
    raise exception 'loved bar must be on the route' using errcode = '22023';
  end if;

  insert into public.shared_nights (user_id, night, bar_ids, loved_bar_id)
  values (v_uid, p_night, p_bar_ids, p_loved_bar_id)
  on conflict on constraint shared_nights_pkey
  do update set
    bar_ids      = excluded.bar_ids,
    loved_bar_id = excluded.loved_bar_id,
    shared_at    = now()
    -- share_token deliberately untouched: re-sharing must not kill
    -- links already sent.
  returning share_token into v_token;
  return v_token;
end;
$$;

------------------------------------------------------------------------------
-- 3. unshare_night — owner delete (the consent is revocable; links die)
------------------------------------------------------------------------------

create or replace function public.unshare_night(p_night date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  delete from public.shared_nights
   where user_id = v_uid and night = p_night;
end;
$$;

------------------------------------------------------------------------------
-- 4. get_shared_night — the ONE anon read, keyed on the token alone
------------------------------------------------------------------------------

-- SECURITY DEFINER with the MATERIALIZED fence (0007/0015 rationale) as
-- belt-and-braces; with a 128-bit token as the sole predicate there is
-- nothing enumerable, but the fence costs nothing and keeps this surface
-- uniform with every other definer read.
create or replace function public.get_shared_night(p_token uuid)
returns table (
  handle text,
  display_name text,
  night date,
  bar_ids text[],
  loved_bar_id text,
  shared_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with gated as materialized (
    select p.handle::text,
           p.display_name::text,
           sn.night,
           sn.bar_ids,
           sn.loved_bar_id,
           sn.shared_at
      from public.shared_nights sn
      join public.profiles p on p.id = sn.user_id
     where sn.share_token = p_token
     limit 1
  )
  select * from gated;
$$;

------------------------------------------------------------------------------
-- 5. Grants — revoke-first so re-runs cannot accumulate
------------------------------------------------------------------------------

revoke all on function public.share_night(date, text[], text) from public, anon, authenticated;
grant execute on function public.share_night(date, text[], text) to authenticated;

revoke all on function public.unshare_night(date) from public, anon, authenticated;
grant execute on function public.unshare_night(date) to authenticated;

-- The second function in this schema deliberately granted to anon (after
-- 0015's get_public_ratings): holding the token IS the authorization.
revoke all on function public.get_shared_night(uuid) from public, anon, authenticated;
grant execute on function public.get_shared_night(uuid) to anon, authenticated;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   revoke all on function public.get_shared_night(uuid) from anon, authenticated;
--   drop function if exists public.get_shared_night(uuid);
--   drop function if exists public.unshare_night(date);
--   drop function if exists public.share_night(date, text[], text);
--   drop table if exists public.shared_nights;
------------------------------------------------------------------------------
