-- Next Bar — 0037 census run, checkpoint, and source-evidence storage
--
-- DRAFT GATE: this migration is drafted under goal g-4914f4e9 and is NEVER
-- applied unattended. Application to any environment (Local, Staging,
-- Production) is a separate attended operator action through the ledgered
-- runner (npm run db:migrate). Nothing in this session applied it anywhere.
--
-- Purpose. The offline census runner (scripts/census/runner.ts) currently
-- persists its resume state as files under outDir/<runId>/ using the
-- operator-locked checkpoint contract in scripts/census/checkpoint.ts
-- (version, run id, provider, coverage unit, cursor, call count, config
-- hash, code SHA, data version, last successful unit). This migration gives
-- that contract a durable, queryable home so multi-session census runs can
-- resume across machines and their provenance can be audited later:
--
--   census_runs         one row per run: status, config_hash, code_sha,
--                       data_version, budget, calls_used, last successful
--                       unit, writer lease, revision, timestamps.
--   census_checkpoints  one row per (run, provider, coverage unit):
--                       cursor, call_count, saturation, revision.
--   census_evidence     one row per (run, evidence id): provider, source
--                       identifier, evidence URL, observation date,
--                       retrieval time, reviewer/adjudication conclusion.
--
-- NO RAW PROVIDER CONTENT. census_evidence stores POINTERS ONLY — provider
-- name, provider-scoped source identifier, evidence URL, observation date,
-- retrieval timestamp. Response bodies, cached pages, snippets, or any
-- other restricted provider content must never be persisted here (Google
-- compliance posture: display vs persist). There are deliberately no
-- jsonb/bytea/xml columns in this migration.
--
-- Idempotency. CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP TRIGGER IF EXISTS before CREATE TRIGGER, and re-runnable ENABLE
-- RLS / REVOKE — the whole file is safe to replay, and a fresh environment
-- replays it from scratch by design (ledger is per-database).
--
-- Concurrent-writer protection, three layers (documented contract for the
-- runner; the schema enforces the invariants):
--   1. Writer lease on census_runs: a runner claims a run with
--        begin;
--        set local lock_timeout = '2s';
--        update public.census_runs
--           set writer_id = $2,
--               writer_lease_expires_at = now() + interval '15 minutes'
--         where run_id = $1
--           and (writer_id is null
--                or writer_id = $2
--                or writer_lease_expires_at < now());
--        commit;
--      Zero rows updated = another live writer holds the run; a
--      lock_timeout error = a (possibly dead) holder still owns the row
--      lock — back off and retry. Either way: do not write.
--      A crashed writer's lease expires on its own — no manual repair.
--   2. Compare-and-set revisions: census_runs and census_checkpoints carry
--      a revision that the census_touch trigger bumps on every UPDATE.
--      Writers update with `... where ... and revision = $expected`; zero
--      rows updated = a lost race — reload, revalidate, retry. INSERTs are
--      idempotent by primary key (run_id / run_id+provider+coverage_unit /
--      run_id+evidence_id), so a crash-and-retry cannot duplicate rows.
--   3. Checkpoint writes re-verify the lease IN THE SAME TRANSACTION by
--      LOCKING the run row first (review: DeepSeek found the stale-holder
--      window — writer A reads a checkpoint, its lease expires, writer B
--      claims the run, A's CAS still lands on any row B has not yet
--      touched; review: Codex established that a joined WHERE clause is
--      NOT a fence under READ COMMITTED — EvalPlanQual re-evaluates only
--      when the TARGET row was concurrently modified, and an unlocked
--      joined census_runs row is read at statement snapshot, so a stale
--      holder's write could still land). Every checkpoint UPDATE/INSERT
--      therefore runs inside a transaction that first takes the run's
--      row lock while asserting holdership:
--        begin;
--        set local lock_timeout = '2s';
--        select 1 from public.census_runs
--         where run_id = $1
--           and writer_id = $me and writer_lease_expires_at > now()
--           for update;
--        -- zero rows = the lease is gone: rollback, re-claim, reload.
--        update public.census_checkpoints
--           set ...
--         where run_id = $1 and provider = $2 and coverage_unit = $3
--           and revision = $expected;  -- zero rows = lost race: rollback
--        commit;
--      FOR UPDATE follows the run row to its latest committed version, so
--      a concurrent lease-steal either commits first (the SELECT sees the
--      new holder and returns zero rows) or blocks behind this lock until
--      commit — the two writers serialize on the run row and cannot
--      interleave checkpoint writes. now() is transaction-stable, which
--      only errs toward treating a just-expired lease as still held;
--      safety comes from the row-lock serialization, expiry provides
--      liveness (a crashed holder's lock is gone, its expiry lets the
--      next claim through). The claim transaction sets the same
--      `set local lock_timeout = '2s'` (review: DeepSeek — a writer that
--      dies BETWEEN its FOR UPDATE and its commit leaves a row lock held
--      until the server reaps the dead connection; the timeout converts
--      "block indefinitely behind a dead holder" into a fast error the
--      claimer retries with backoff, without touching the safety
--      argument above).
--
-- Checkpoint-contract mapping (checkpoint.ts version 1): configHash,
-- codeSha, and dataVersion live on census_runs — a checkpoint row joins to
-- its run for validation, so the resume rule "refuse any checkpoint whose
-- config hash / code SHA does not match the current invocation" compares
-- against ONE authoritative copy instead of a duplicated-per-row value
-- that could drift. The contract's `version` field lives on each
-- checkpoint row, CHECK-pinned to 1 — the DB-side mirror of
-- validateCheckpoint's version refusal. lastSuccessfulUnit keeps its
-- contract name on both tables.
--
-- Cascade note. The FKs cascade on run deletion for referential
-- cleanliness, and that is in deliberate tension with the audit purpose:
-- deleting a census_runs row destroys its checkpoint and evidence trail.
-- No code path deletes runs, and none may be added casually — pruning
-- old runs is an attended operator decision that knowingly discards that
-- run's provenance (review: Claude — recorded before any cleanup script
-- exists, not after).
--
-- RLS/grant analysis. All three tables are runner/curation-internal. No
-- application read or write path exists (repository search: src/ has no
-- census table reference), so like 0036's schema_migrations posture they
-- get RLS ENABLED, REVOKE ALL from public/anon/authenticated, and NO
-- browser policies — the browser surface for these tables is zero. The
-- service_role is deliberately untouched (BYPASSRLS in Supabase) and the
-- table owner retains access for the attended runner. census_touch is a
-- plain SECURITY INVOKER trigger function with a pinned empty search_path;
-- EXECUTE is revoked from browser roles for depth even though they cannot
-- reach the DML that would fire it.
--
-- Compatibility. Additive only: no existing table, column, policy, grant,
-- function, or row is modified. Old and new web/mobile clients are
-- unaffected because no app client references these tables. Migrations
-- 0000–0036 are preserved byte-for-byte (pinned by
-- src/lib/migration0037.test.ts).
--
-- Recovery. Down-migrating destroys checkpoint and evidence provenance;
-- there is no data-preserving rollback. If an attended emergency requires
-- removal, the statements are in the Rollback section at the end of this
-- file — they drop the three tables and the trigger function outright.

create table if not exists public.census_runs (
  run_id text primary key,
  status text not null default 'running'
    check (status in ('running', 'complete', 'budget_exhausted', 'incomplete_units', 'failed')),
  config_hash text not null,
  code_sha text not null,
  data_version text not null,
  budget integer not null check (budget >= 0),
  calls_used integer not null default 0 check (calls_used >= 0),
  -- Same name as the checkpoint contract's lastSuccessfulUnit and the
  -- census_checkpoints column — one concept, one name (review: Claude).
  last_successful_unit text,
  writer_id text,
  writer_lease_expires_at timestamptz,
  -- A lease is claimed and released as a PAIR (review: Codex — a writer_id
  -- with a NULL expiry would satisfy no claim predicate and wedge the run).
  constraint census_runs_lease_pair
    check ((writer_id is null) = (writer_lease_expires_at is null)),
  revision bigint not null default 1,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  -- A run that is still running has no finish time; a finished run has one.
  check ((status = 'running') = (finished_at is null))
);

create table if not exists public.census_checkpoints (
  run_id text not null references public.census_runs (run_id) on delete cascade,
  provider text not null,
  coverage_unit text not null,
  -- Checkpoint-contract version (checkpoint.ts `version: 1`). Pinned by a
  -- CHECK so a future incompatible format needs its own migration — the
  -- DB-side mirror of validateCheckpoint's version refusal (review: Codex).
  version integer not null default 1 check (version = 1),
  cursor text,
  call_count integer not null default 0 check (call_count >= 0),
  saturated boolean not null default false,
  last_successful_unit text,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (run_id, provider, coverage_unit)
);

create table if not exists public.census_evidence (
  run_id text not null references public.census_runs (run_id) on delete cascade,
  -- `${provider}:${externalId}` — the stable join key candidates carry.
  evidence_id text not null,
  provider text not null,
  -- Provider-scoped source identifier (maps from Evidence.externalId,
  -- which the contract marks OPTIONAL — so nullable here; the required
  -- evidence_id above remains the stable join key either way (review:
  -- Codex — a not-null column the contract cannot always populate would
  -- reject valid provider results).
  source_id text,
  url text not null,
  -- The date the underlying fact was observed at the source, WHEN the
  -- source states one. Evidence (types.ts) carries only retrievedAt, so
  -- this is nullable; apply-time staleness gates fall back to
  -- retrieved_at when observed_at is absent (review: Codex — a not-null
  -- observation date would force fabricated values).
  observed_at date,
  -- When we retrieved the pointer; the always-present freshness signal.
  retrieved_at timestamptz not null,
  adjudication text not null default 'pending'
    check (adjudication in ('pending', 'accepted', 'rejected')),
  adjudicated_by text,
  adjudicated_at timestamptz,
  adjudication_note text,
  primary key (run_id, evidence_id),
  -- Pending rows carry no adjudication stamp; concluded rows must carry one.
  check ((adjudication = 'pending') = (adjudicated_at is null))
);

-- Revision bump + touch for optimistic concurrency (layer 2 above).
-- SECURITY INVOKER (the default — no DEFINER anywhere in this migration)
-- with an empty pinned search_path.
create or replace function public.census_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;

drop trigger if exists census_runs_touch on public.census_runs;
create trigger census_runs_touch
  before update on public.census_runs
  for each row execute function public.census_touch();

drop trigger if exists census_checkpoints_touch on public.census_checkpoints;
create trigger census_checkpoints_touch
  before update on public.census_checkpoints
  for each row execute function public.census_touch();

alter table public.census_runs enable row level security;
alter table public.census_checkpoints enable row level security;
alter table public.census_evidence enable row level security;

revoke all on table public.census_runs
  from public, anon, authenticated;
revoke all on table public.census_checkpoints
  from public, anon, authenticated;
revoke all on table public.census_evidence
  from public, anon, authenticated;

revoke all on function public.census_touch()
  from public, anon, authenticated;

comment on table public.census_runs is
  'Census run registry: status, config hash, code SHA, data version, budget/call counts, writer lease. Runner-internal; browser roles have no access and no policies exist. Concurrency: writer lease + trigger-bumped revision CAS.';

comment on table public.census_checkpoints is
  'Per (run, provider, coverage unit) resume state: cursor, call count, saturation. Runner-internal; browser roles have no access. Config/code/data identity lives on census_runs — validate a checkpoint by joining its run.';

comment on table public.census_evidence is
  'Source-evidence POINTERS only: provider, source id, URL, observation date, retrieval time, adjudication conclusion. Never store raw provider content (no response bodies, pages, or snippets) - compliance depends on this staying pointer-only.';

------------------------------------------------------------------------------
-- Rollback (emergency only; destroys checkpoint and evidence provenance):
--   drop trigger if exists census_checkpoints_touch on public.census_checkpoints;
--   drop trigger if exists census_runs_touch on public.census_runs;
--   drop function if exists public.census_touch();
--   drop table if exists public.census_evidence;
--   drop table if exists public.census_checkpoints;
--   drop table if exists public.census_runs;
------------------------------------------------------------------------------
