-- Next Bar — 0043 durable rate limits (Item 10)
--
-- AUTHORED but **DO NOT APPLY overnight** (standing rule, same as 0018).
-- Applying this is an attended operation.
--
-- WHY THIS EXISTS. Every limiter in the app was a module-scoped Map inside a
-- serverless function, so the effective global cap was `limit x warm
-- instances` and a cold start reset it. That is fine for damping a dumb
-- flood and not fine for `POST /api/account/delete`, whose quota guards an
-- irreversible action. This table is the shared counter that makes the cap
-- global.
--
-- COUNTER MODEL, not an event log: one row per (bucket, key_hash,
-- window_start) holding a count. Rows are BOUNDED by expiry, not by
-- retention policy — see the cleanup notes below.
--
-- PRIVACY. `key_hash` is a salted SHA-256 truncated to 128 bits, computed in
-- the application (src/lib/rateLimiter.ts hashKey). A raw client IP is NEVER
-- stored. This matters more here than it did in memory: the in-memory map was
-- ephemeral, a table is durable, and durable IPs are a data-retention
-- question this app should not take on for a counter. The salt lives in
-- RATE_LIMIT_KEY_SALT and is a SECRET; rotating it invalidates every live
-- window, which is a brief harmless reset.
--
-- The ONLY writer is the service role via consume_rate_limit(). anon and
-- authenticated get NOTHING (zero grants + RLS default-deny, no policies on
-- purpose), so there is no client-side RLS surface: a client cannot read
-- another key's counter, forge one, or clear its own.
--
-- Idempotent: safe to re-run.

create table if not exists public.rate_limits (
  -- Consumer name, e.g. 'waitlist' / 'event' / 'account-delete'. Part of the
  -- key so two consumers can never share a counter by accident.
  bucket text not null,
  -- Salted hash of the client key (IP or verified user id). Never raw.
  key_hash text not null,
  -- Fixed-window start, computed SERVER-side. A client-supplied window would
  -- let a caller pick a fresh one on every request.
  window_start timestamptz not null,
  count integer not null default 0,
  expires_at timestamptz not null,
  -- Named explicitly (0017/0018 lesson): consume_rate_limit's ON CONSTRAINT
  -- reference must survive any future refactor of this DDL.
  constraint rate_limits_pkey primary key (bucket, key_hash, window_start)
);

-- Storage is bounded by DELETING expired rows, and this index is what makes
-- that cheap. Without it the opportunistic cleanup below degrades into a
-- sequential scan on every write, which is how a rate limiter becomes the
-- thing that takes the database down.
create index if not exists rate_limits_expires_at_idx
  on public.rate_limits (expires_at);

alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from public, anon, authenticated;

------------------------------------------------------------------------------
-- consume_rate_limit(...) — atomic increment + verdict, service-role only
------------------------------------------------------------------------------
--
-- Returns TRUE when this hit is within budget. The increment and the read are
-- ONE statement: a read-then-write pair would let two concurrent requests
-- both observe count = limit - 1 and both proceed, which on the account
-- deletion path is precisely the failure the durable counter exists to stop.
--
-- The window is derived by flooring epoch-milliseconds to the window size, so
-- every instance computes the same boundary for the same instant without
-- coordinating.

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_window_ms bigint,
  p_limit integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_window_start timestamptz :=
    to_timestamp(((v_now_ms / p_window_ms) * p_window_ms) / 1000.0);
  v_count integer;
begin
  if p_window_ms <= 0 or p_limit < 0 then
    raise exception 'consume_rate_limit: window_ms must be > 0 and limit >= 0';
  end if;

  insert into public.rate_limits (bucket, key_hash, window_start, count, expires_at)
  values (
    p_bucket,
    p_key_hash,
    v_window_start,
    1,
    v_window_start + make_interval(secs => (p_window_ms / 1000.0) * 2)
  )
  on conflict on constraint rate_limits_pkey
  do update set count = public.rate_limits.count + 1
  returning count into v_count;

  -- Opportunistic cleanup, cheap and self-limiting: at most 100 dead rows per
  -- call, only on ~1% of calls. This keeps the table bounded WITHOUT
  -- requiring pg_cron, whose enablement is a platform-level attended
  -- decision. If pg_cron is ever turned on, a scheduled
  --   delete from public.rate_limits where expires_at < now()
  -- is strictly better and this branch can go.
  if random() < 0.01 then
    delete from public.rate_limits
    where ctid in (
      select ctid from public.rate_limits
      where expires_at < now()
      limit 100
    );
  end if;

  return v_count <= p_limit;
end;
$$;

-- Grant EXECUTE explicitly to service_role and to nobody else. Function
-- EXECUTE is grant-based, not RLS — BYPASSRLS does not cover it, and relying
-- on Supabase's default privileges is fragile (0034 lesson).
revoke all on function public.consume_rate_limit(text, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, bigint, integer)
  to service_role;
grant insert, update, select, delete on table public.rate_limits to service_role;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   drop function if exists public.consume_rate_limit(text, text, bigint, integer);
--   drop index if exists public.rate_limits_expires_at_idx;
--   drop table if exists public.rate_limits;
--
-- ROLLOUT ORDER — SALT BEFORE CODE. Each step is independently reversible:
--   1. apply this migration (table + index + function) — inert until used;
--   2. set RATE_LIMIT_KEY_SALT in the production environment. This is SAFE
--      to do before the code ships, because the currently-deployed code does
--      not read the variable at all;
--   3. deploy the code;
--   4. optionally move cleanup to pg_cron.
--
-- WHY THAT ORDER AND NOT THE OBVIOUS ONE. RATE_LIMIT_KEY_SALT is the
-- activation switch: the app builds its durable counter only when
-- NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY *and* the salt are all
-- present, and the first two already exist in production. Combined with
-- `requireDurable` on /api/account/delete (production default), the two
-- wrong orders both hurt:
--
--   * code deployed BEFORE the salt is set -> durableCounterFromEnv() returns
--     null, requireDurable refuses, and EVERY account deletion returns 429
--     until the salt lands. On Vercel an env-var change only takes effect on
--     the next deploy, so that window is two deployments long, not minutes.
--   * salt set BEFORE this migration is applied -> every consume_rate_limit
--     call errors with 42883 (undefined_function). Harmless for the three
--     fail-OPEN consumers; for the fail-CLOSED delete route it is again a
--     blanket 429. `route.failclosed.test.ts` asserts exactly that 429.
--
-- Applying the migration first and setting the salt second means the code
-- deploy arrives into an already-working configuration, and neither window
-- exists. `REQUIRE_DURABLE_RATE_LIMIT=0` is the escape hatch if a deploy ever
-- does land in the bad state.
--
-- IF THE SALT IS NEVER SET IN PRODUCTION: account deletion hard-refuses (it
-- does NOT quietly fall back to per-instance counting), and two alarms fire —
-- the partial-configuration error from durableCounterFromEnv and the route's
-- own refusal log. An earlier draft of this note said the opposite on both
-- counts; it predated the `requireDurable` behaviour added later in this same
-- change, and is corrected here rather than left as a comfortable half-truth.
