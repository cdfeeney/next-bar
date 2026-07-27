-- Next Bar — 0018 analytics events (N4 skeleton — privacy-light counts)
--
-- Design: docs/ANALYTICS-DESIGN.md. AUTHORED night-5 (2026-07-27),
-- **DO NOT APPLY overnight** (standing rule).
--
-- COUNTER MODEL (security review H1 + SCALE-PLAN Finding F): a row is
-- (name, night, count) — an atomic upsert-increment, NOT an event log.
-- The table is bounded at 4 rows per night forever, so there is no
-- retention job to run and no flood-driven storage growth: an abuse
-- flood can inflate counters (data poisoning, accepted for an anonymous
-- counter) but cannot bloat the database.
--
-- Deliberately NO user id, session id, IP, or payload. The ONLY writer
-- is the /api/event route using the service role via
-- bump_analytics_event(); anon/authenticated get NOTHING (zero grants +
-- RLS default-deny — no policies on purpose), so there is no client RLS
-- surface to reason about.
--
-- Idempotent: safe to re-run.

create table if not exists public.analytics_events (
  name text not null
    constraint analytics_events_name_check
    check (name in ('search', 'share', 'save', 'visit')),
  night date not null,
  count integer not null default 0,
  -- Named explicitly (0017 lesson): bump_analytics_event's ON CONSTRAINT
  -- reference must survive any future refactor of this DDL.
  constraint analytics_events_pkey primary key (name, night)
);

alter table public.analytics_events enable row level security;
revoke all on table public.analytics_events from public, anon, authenticated;

------------------------------------------------------------------------------
-- bump_analytics_event(p_name, p_night) — atomic increment, service-role only
------------------------------------------------------------------------------

create or replace function public.bump_analytics_event(p_name text, p_night date)
returns void
language sql
set search_path = public
as $$
  insert into public.analytics_events (name, night, count)
  values (p_name, p_night, 1)
  on conflict on constraint analytics_events_pkey
  do update set count = analytics_events.count + 1;
$$;

-- Revoke everyone else explicitly so a future blanket grant can't open a
-- client-side counter-inflation path; grant service_role EXPLICITLY
-- (function EXECUTE is grant-based, not RLS — BYPASSRLS doesn't cover it,
-- and relying on Supabase's default privileges is fragile).
revoke all on function public.bump_analytics_event(text, date) from public, anon, authenticated;
grant execute on function public.bump_analytics_event(text, date) to service_role;
grant insert, update, select on table public.analytics_events to service_role;

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   drop function if exists public.bump_analytics_event(text, date);
--   drop table if exists public.analytics_events;
------------------------------------------------------------------------------
