import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

/**
 * Static pins for migration 0037 (goal g-4914f4e9): census run, checkpoint,
 * and source-evidence storage. DRAFT ONLY — nothing here touches a
 * database; these tests read the SQL text, like the 0028–0036 suites.
 *
 * The file uses dollar-quoted function bodies, which migration0036's
 * quote-aware splitter deliberately refuses — so assertions here run
 * against comment-stripped text with targeted regexes instead of
 * statement lists.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const SQL = readFileSync(
  join(MIGRATIONS_DIR, '0037_census_provenance.sql'),
  'utf8',
);
/** Executable text only: `--` comment lines stripped, whitespace collapsed. */
const STATEMENTS = SQL.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ');

const TABLES = [
  'census_runs',
  'census_checkpoints',
  'census_evidence',
] as const;

/** Split a create-table body on commas at paren depth 0 only. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

describe('migration 0037 — structure', () => {
  test('creates exactly the three census tables, idempotently', () => {
    for (const table of TABLES) {
      expect(STATEMENTS).toMatch(
        new RegExp(`create table if not exists public\\.${table} \\(`),
      );
    }
    expect(STATEMENTS.match(/create table/gi)).toHaveLength(TABLES.length);
  });

  test('census_runs carries the full checkpoint-contract identity and budget fields', () => {
    const runs = /create table if not exists public\.census_runs \((.*?)\);/.exec(
      STATEMENTS,
    );
    expect(runs).not.toBeNull();
    const body = runs![1];
    for (const column of [
      'run_id text primary key',
      'config_hash text not null',
      'code_sha text not null',
      'data_version text not null',
      'budget integer not null',
      'calls_used integer not null',
      'last_successful_unit text',
      'writer_id text',
      'writer_lease_expires_at timestamptz',
      'revision bigint not null default 1',
    ]) {
      expect(body).toContain(column);
    }
    expect(body).toMatch(
      /check \(status in \('running', 'complete', 'budget_exhausted', 'incomplete_units', 'failed'\)\)/,
    );
    expect(body).toMatch(/check \(budget >= 0\)/);
    expect(body).toMatch(/check \(calls_used >= 0\)/);
    expect(body).toMatch(/check \(\(status = 'running'\) = \(finished_at is null\)\)/);
    // A lease is claimed/released as a pair — writer_id with a NULL expiry
    // would satisfy no claim predicate and wedge the run (santa: Codex).
    expect(body).toMatch(
      /check \(\(writer_id is null\) = \(writer_lease_expires_at is null\)\)/,
    );
  });

  test('census_checkpoints keys on (run, provider, coverage unit) and cascades from its run', () => {
    const cps = /create table if not exists public\.census_checkpoints \((.*?)\);/.exec(
      STATEMENTS,
    );
    expect(cps).not.toBeNull();
    const body = cps![1];
    expect(body).toContain(
      'references public.census_runs (run_id) on delete cascade',
    );
    expect(body).toContain('primary key (run_id, provider, coverage_unit)');
    for (const column of [
      // The contract's version field, CHECK-pinned to 1 (santa: Codex —
      // rows must be distinguishable from a future incompatible format).
      'version integer not null default 1 check (version = 1)',
      'cursor text',
      'call_count integer not null',
      'saturated boolean not null default false',
      'last_successful_unit text',
      'revision bigint not null default 1',
    ]) {
      expect(body).toContain(column);
    }
    expect(body).toMatch(/check \(call_count >= 0\)/);
  });

  test('census_evidence stores pointer fields, freshness, and adjudication', () => {
    const ev = /create table if not exists public\.census_evidence \((.*?)\);/.exec(
      STATEMENTS,
    );
    expect(ev).not.toBeNull();
    const body = ev![1];
    for (const column of [
      'evidence_id text not null',
      'provider text not null',
      'url text not null',
      'retrieved_at timestamptz not null',
      'adjudicated_by text',
      'adjudicated_at timestamptz',
      'adjudication_note text',
    ]) {
      expect(body).toContain(column);
    }
    // Contract fidelity (santa: Codex): Evidence.externalId is optional and
    // Evidence has no observation date, so these two are nullable — a
    // NOT NULL here would reject valid provider results or force
    // fabricated values.
    expect(body).toMatch(/source_id text,/);
    expect(body).toMatch(/observed_at date,/);
    expect(body).toContain(
      'references public.census_runs (run_id) on delete cascade',
    );
    expect(body).toContain('primary key (run_id, evidence_id)');
    expect(body).toMatch(
      /check \(adjudication in \('pending', 'accepted', 'rejected'\)\)/,
    );
    expect(body).toMatch(
      /check \(\(adjudication = 'pending'\) = \(adjudicated_at is null\)\)/,
    );
  });

  test('stores no raw provider content — pointer columns only', () => {
    // The compliance posture is pointers-only (URL + identifiers + dates).
    // No column type capable of holding a response body or page snapshot.
    expect(STATEMENTS).not.toMatch(/\b(?:jsonb?|bytea|xml)\b/i);
    expect(SQL).toMatch(/NO RAW PROVIDER CONTENT/);
  });

  test('census_evidence columns are exactly the allow-listed pointer set', () => {
    // A type ban alone would let `response_body text` slip through
    // (santa: Codex) — so pin the exact column names. Any addition to this
    // table must be argued past this list and its compliance comment.
    const ev = /create table if not exists public\.census_evidence \((.*?)\);/.exec(
      STATEMENTS,
    );
    const segments = splitTopLevel(ev![1]);
    const columnNames = segments
      .map((s) => s.trim())
      .filter(
        (s) => !/^(?:primary key|check|constraint|foreign key|unique)\b/i.test(s),
      )
      .map((s) => s.split(/\s+/)[0]);
    expect(columnNames.sort()).toEqual(
      [
        'run_id',
        'evidence_id',
        'provider',
        'source_id',
        'url',
        'observed_at',
        'retrieved_at',
        'adjudication',
        'adjudicated_by',
        'adjudicated_at',
        'adjudication_note',
      ].sort(),
    );
  });
});

describe('migration 0037 — RLS and grants (0036 posture)', () => {
  test('enables RLS on all three tables', () => {
    for (const table of TABLES) {
      expect(STATEMENTS).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security;`),
      );
    }
  });

  test('revokes every table privilege from PUBLIC, anon, and authenticated', () => {
    for (const table of TABLES) {
      expect(STATEMENTS).toMatch(
        new RegExp(
          `revoke all on table public\\.${table} from public, anon, authenticated;`,
        ),
      );
    }
  });

  test('creates no browser policy, no grant, no FORCE RLS, and leaves service_role alone', () => {
    expect(STATEMENTS).not.toMatch(/create\s+policy/i);
    expect(STATEMENTS).not.toMatch(/\bgrant\b/i);
    expect(STATEMENTS).not.toMatch(/force\s+row\s+level\s+security/i);
    expect(STATEMENTS).not.toMatch(/revoke[^;]*service_role/i);
  });

  test('the trigger function is SECURITY INVOKER with a pinned empty search_path, EXECUTE revoked', () => {
    expect(STATEMENTS).not.toMatch(/security\s+definer/i);
    expect(STATEMENTS).toMatch(/set search_path = ''/);
    expect(STATEMENTS).toMatch(
      /revoke all on function public\.census_touch\(\) from public, anon, authenticated;/,
    );
  });

  test('modifies nothing outside the three census tables and their trigger function', () => {
    // Additive-only: every ALTER/REVOKE/COMMENT targets an object this
    // migration itself creates. No DML, no drops of pre-existing objects.
    // (Statement-shaped patterns — `before update on` in the trigger
    // definitions is DDL, not DML.)
    expect(STATEMENTS).not.toMatch(/insert\s+into\b/i);
    expect(STATEMENTS).not.toMatch(/update\s+public\.\w+\s+set\b/i);
    expect(STATEMENTS).not.toMatch(/delete\s+from\b/i);
    expect(STATEMENTS).not.toMatch(/\btruncate\b/i);
    const altered = [...STATEMENTS.matchAll(/alter table public\.(\w+)/g)].map(
      (m) => m[1],
    );
    expect(new Set(altered)).toEqual(new Set(TABLES));
    const dropped = [...STATEMENTS.matchAll(/drop trigger if exists (\w+) on public\.(\w+)/g)];
    for (const [, , table] of dropped) {
      expect(TABLES).toContain(table as (typeof TABLES)[number]);
    }
    expect(STATEMENTS).not.toMatch(/drop\s+(?:table|function)/i);
  });
});

describe('migration 0037 — concurrency and documentation', () => {
  test('census_touch bumps revision and updated_at on every update of both writer tables', () => {
    expect(STATEMENTS).toMatch(/new\.updated_at := now\(\);/);
    expect(STATEMENTS).toMatch(/new\.revision := old\.revision \+ 1;/);
    for (const table of ['census_runs', 'census_checkpoints']) {
      expect(STATEMENTS).toMatch(
        new RegExp(
          `create trigger ${table}_touch before update on public\\.${table} for each row execute function public\\.census_touch\\(\\);`,
        ),
      );
    }
  });

  test('documents the writer-lease claim, CAS contract, rollback, and compatibility', () => {
    expect(SQL).toMatch(/writer_lease_expires_at < now\(\)/);
    expect(SQL).toMatch(/revision = \$expected/);
    // Layer 3 (review: DeepSeek found the stale-holder window; Codex
    // established a joined WHERE is not a fence under READ COMMITTED):
    // checkpoint writes lock the run row FOR UPDATE while asserting
    // holdership, in the same transaction as the CAS write.
    expect(SQL).toMatch(/writer_id = \$me and writer_lease_expires_at > now\(\)/);
    expect(SQL).toMatch(/for update;/);
    expect(SQL).toMatch(/IN THE SAME TRANSACTION/);
    expect(SQL).toMatch(/serialize on the run row/);
    // Liveness (review: DeepSeek round 2): a dead holder's row lock must
    // not block the next claimer until connection reaping — lock_timeout
    // turns that into a fast retryable error. BOTH documented
    // transactions carry it literally (santa: Codex round 3 — one
    // occurrence would let the claim-side copy vanish unnoticed).
    expect(SQL.match(/set local lock_timeout = '2s';/g)).toHaveLength(2);
    expect(SQL).toMatch(/Rollback \(emergency only/);
    expect(SQL).toMatch(/Compatibility\./);
    expect(SQL).toMatch(/Recovery\./);
    // Wrapped across comment lines in the header, so match the two halves.
    expect(SQL).toMatch(/is NEVER\b/);
    expect(SQL).toMatch(/applied unattended/);
  });
});

describe('migration 0037 — replay idempotency and ordering', () => {
  // The ledger is per-database, so a fresh environment replays this file —
  // and 0036's own header requires re-runnable statements. Presence checks
  // alone would keep passing if the idempotent forms regressed
  // (santa: Codex) or if statements were reordered into a sequence that
  // fails at apply time (santa: Claude).
  test('the function is CREATE OR REPLACE and each trigger is dropped before creation', () => {
    expect(STATEMENTS).toMatch(/create or replace function public\.census_touch\(\)/);
    for (const trigger of ['census_runs_touch', 'census_checkpoints_touch']) {
      const dropAt = STATEMENTS.indexOf(`drop trigger if exists ${trigger}`);
      const createAt = STATEMENTS.indexOf(`create trigger ${trigger}`);
      expect(dropAt).toBeGreaterThanOrEqual(0);
      expect(createAt).toBeGreaterThan(dropAt);
    }
  });

  test('exactly one DDL statement per object — a duplicate would fail at apply time', () => {
    // indexOf-based ordering checks see only first occurrences
    // (santa: Codex): a stray second `create trigger census_runs_touch`
    // passes them all yet fails the real apply with "already exists".
    // Case-insensitive (santa: Codex round 2 — SQL keywords are
    // case-insensitive to Postgres, so `CREATE TRIGGER` is the same
    // duplicate).
    expect(STATEMENTS.match(/create trigger/gi)).toHaveLength(2);
    expect(STATEMENTS.match(/drop trigger if exists/gi)).toHaveLength(2);
    expect(STATEMENTS.match(/create (?:or replace )?function/gi)).toHaveLength(1);
    for (const trigger of ['census_runs_touch', 'census_checkpoints_touch']) {
      expect(
        STATEMENTS.match(new RegExp(`create trigger ${trigger}\\b`, 'gi')),
      ).toHaveLength(1);
    }
    expect(STATEMENTS.match(/enable row level security/gi)).toHaveLength(3);
    expect(STATEMENTS.match(/revoke all on table/gi)).toHaveLength(3);
    expect(STATEMENTS.match(/comment on table/gi)).toHaveLength(3);
  });

  test('objects are created before they are referenced or hardened', () => {
    const tableAt = (t: string) =>
      STATEMENTS.indexOf(`create table if not exists public.${t}`);
    const functionAt = STATEMENTS.indexOf('create or replace function public.census_touch');
    // Function exists before any trigger executes it…
    expect(functionAt).toBeGreaterThan(tableAt('census_evidence'));
    expect(STATEMENTS.indexOf('create trigger census_runs_touch')).toBeGreaterThan(functionAt);
    // …and its REVOKE follows its creation.
    expect(
      STATEMENTS.indexOf('revoke all on function public.census_touch()'),
    ).toBeGreaterThan(functionAt);
    for (const table of TABLES) {
      expect(
        STATEMENTS.indexOf(`alter table public.${table} enable row level security`),
      ).toBeGreaterThan(tableAt(table));
      expect(
        STATEMENTS.indexOf(`revoke all on table public.${table}`),
      ).toBeGreaterThan(tableAt(table));
    }
  });
});

describe('migrations 0000–0036 are preserved byte-for-byte', () => {
  // The Phase 6 gate: drafting 0037 must not touch any prior migration.
  // Content is LF-normalized so the pin is identical on Windows checkouts.
  // If this test ever fails, a frozen migration was edited — that is a
  // defect in the edit, not in this pin; migrations are append-only.
  test('aggregate content hash of the 37 prior files is unchanged', () => {
    const priorFiles = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && f < '0037')
      .sort();
    expect(priorFiles).toHaveLength(37);
    const lines = priorFiles.map((f) => {
      const content = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(
        /\r\n/g,
        '\n',
      );
      return `${f}:${createHash('sha256').update(content).digest('hex')}`;
    });
    const aggregate = createHash('sha256')
      .update(lines.join('\n'))
      .digest('hex');
    expect(aggregate).toBe(
      'e2fb94ff55653479d471818784c42fb08166a084044a2244aea99c843036dea2',
    );
  });
});
