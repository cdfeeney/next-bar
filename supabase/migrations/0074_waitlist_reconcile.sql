-- 0074_waitlist_reconcile.sql
--
-- BRING public.waitlist INTO THE MIGRATION CHAIN. It has never been in it.
--
-- The table was created by the pre-migration `supabase/schema.sql` (b2cb06a, May 2026) and no
-- numbered migration has ever created it. 0000_reconcile_v01_schema.sql says so in its own header:
-- the live database "only ever had the v0.1 schema.sql tables (bars, profiles, saves, visits,
-- waitlist)", and 0000 deliberately renamed the other legacy tables out of the way while leaving
-- this one alone, because unlike the others it was NOT empty and `/api/waitlist` still used it.
--
-- The consequence went unnoticed until staging was rebuilt from migrations alone on 2026-08-29:
-- production has the table, a database built from the chain does not, and the app breaks on it —
-- `src/app/api/waitlist/route.ts`, `src/components/WaitlistForm.tsx`, the join and privacy pages,
-- `src/app/api/event/route.ts`, and `src/app/api/account/delete/route.ts`, which deletes the user's
-- waitlist row and therefore errors outright where the table is missing.
--
-- IDEMPOTENT BY CONSTRUCTION, so it is a no-op against production, which already has all of this:
-- `create table if not exists`, `enable row level security` (repeatable), and `drop policy if
-- exists` before each `create policy`.
--
-- PROVENANCE OF THE SHAPE. Column names were read from the production dump taken 2026-08-28
-- (`public.waitlist`, one row); the types, defaults and constraints are the original DDL from
-- b2cb06a, reproduced verbatim below. NO PRODUCTION CONNECTION WAS MADE to write this. The two
-- sources agree on all seven columns: id, email, vibe_profile, neighborhood, age_range, source,
-- created_at. Phase C's read-only pre-check should confirm the live shape before this is applied
-- there; if production has drifted from b2cb06a since May, `create table if not exists` will not
-- correct it, and the drift would need its own migration.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  vibe_profile jsonb,
  neighborhood text,
  age_range text,
  source text,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- waitlist: anyone can insert; only service role reads.
-- Reproduced from b2cb06a. The insert policy is deliberately open — the whole point of the table is
-- a signup form for people who do not have accounts — and reads are service-role only because the
-- rows are email addresses.
drop policy if exists "waitlist anyone insert" on public.waitlist;
create policy "waitlist anyone insert"
  on public.waitlist
  for insert
  with check (true);

drop policy if exists "waitlist service role select" on public.waitlist;
create policy "waitlist service role select"
  on public.waitlist
  for select
  using (auth.role() = 'service_role');
