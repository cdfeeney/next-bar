-- Next Bar — 0018 analytics events (N4 skeleton — privacy-light counts)
--
-- Design: docs/ANALYTICS-DESIGN.md. AUTHORED night-5 (2026-07-27),
-- **DO NOT APPLY overnight** (standing rule).
--
-- A row is (name, night, created_at) — deliberately NO user id, session
-- id, IP, or payload. The ONLY writer is the /api/event route using the
-- service role (which bypasses grants entirely); anon/authenticated get
-- NOTHING, so there is no RLS abuse surface to reason about.
--
-- Idempotent: safe to re-run.

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  name text not null
    constraint analytics_events_name_check
    check (name in ('search', 'share', 'save', 'visit')),
  night date not null,
  created_at timestamptz not null default now()
);

-- Count queries slice by (name, night).
create index if not exists analytics_events_name_night_idx
  on public.analytics_events (name, night);

alter table public.analytics_events enable row level security;
revoke all on table public.analytics_events from public, anon, authenticated;
-- No policies on purpose: RLS default-deny + zero grants. The service
-- role (route handler) bypasses both.

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   drop table if exists public.analytics_events;
------------------------------------------------------------------------------
