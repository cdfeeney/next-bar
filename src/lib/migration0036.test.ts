import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { MIGRATION_LEDGER_DDL } from '../../scripts/lib/migrationLedger';

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/0036_protect_schema_migrations.sql'),
  'utf8',
);
const STATEMENTS = SQL.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');
/**
 * Runner source with comments removed. The assertions below are textual, so
 * without this a regression could COMMENT OUT the hardening call and leave its
 * text behind in a `//` line — every assertion would still match while the
 * ledger was read unhardened.
 */
const RUNNER = readFileSync(join(process.cwd(), 'scripts/apply-migrations.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n');

/**
 * Split on statement terminators only. A naive `.split(';')` is wrong for this
 * file: the `comment on table ... is '...'` literal contains prose semicolons,
 * and splitting inside it silently cuts one real statement into fragments.
 */
function splitStatements(sql: string): string[] {
  // Precondition, checked rather than assumed: this splitter understands
  // single-quoted literals only. Dollar-quoting ($$...$$) would hide a
  // semicolon from it and silently mis-split. Neither input uses it today, so
  // guard the precondition instead of growing a second SQL parser.
  if (/\$\$/.test(sql)) {
    throw new Error('splitStatements does not support dollar-quoted strings');
  }

  const out: string[] = [];
  let current = '';
  let inLiteral = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      if (inLiteral && sql[i + 1] === "'") {
        current += "''"; // an escaped quote, not the end of the literal
        i += 1;
        continue;
      }
      inLiteral = !inLiteral;
    } else if (ch === ';' && !inLiteral) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/** Executable statements only: comment lines stripped, split on the terminator. */
function statementsOf(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return splitStatements(withoutComments)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

/** The two controls this migration and the runner DDL must both apply. */
function hardeningOf(sql: string): string[] {
  return statementsOf(sql).filter(
    (s) => /enable row level security/.test(s) || /^revoke\b/.test(s),
  );
}

describe('migration 0036 — existing ledger protection', () => {
  test('enables RLS on schema_migrations', () => {
    expect(STATEMENTS).toMatch(
      /alter table public\.schema_migrations enable row level security;/,
    );
  });

  test('revokes every privilege from PUBLIC, anon, and authenticated', () => {
    expect(STATEMENTS).toMatch(
      /revoke all on table public\.schema_migrations\s+from public, anon, authenticated;/,
    );
    expect(STATEMENTS).not.toMatch(/\bgrant\b/i);
  });

  test('creates no browser-facing policy and does not force RLS on the migration owner', () => {
    expect(STATEMENTS).not.toMatch(/create\s+policy/i);
    expect(STATEMENTS).not.toMatch(/force\s+row\s+level\s+security/i);
  });

  test('does not revoke service_role or modify application data', () => {
    expect(STATEMENTS).not.toMatch(/revoke[^;]*service_role/i);
    expect(STATEMENTS).not.toMatch(/\b(?:insert|update|delete|truncate)\b/i);
    expect(STATEMENTS).not.toMatch(/\b(?:drop|create)\s+table\b/i);
  });

  // The table comment is one statement whose literal contains prose semicolons.
  // Pins the quote-aware splitter: a naive split on ';' cuts it into fragments
  // and every statement-level assertion built on it silently reasons about the
  // wrong text.
  test('parses as exactly three statements despite semicolons inside the comment', () => {
    const statements = statementsOf(SQL);
    expect(statements).toHaveLength(3);
    expect(statements[2]).toMatch(/^comment on table public\.schema_migrations is '.*'$/);
    expect(statements[2]).toContain('no direct access; maintained by');
  });

  test('documents compatibility, recovery, and an emergency-only rollback', () => {
    expect(SQL).toMatch(/Compatibility:/);
    expect(SQL).toMatch(/Recovery:/);
    expect(SQL).toMatch(/Rollback \(emergency only/);
  });
});

describe('fresh-ledger protection in the runner', () => {
  test('creates, enables RLS, and revokes in one ordered SQL batch', () => {
    const createAt = MIGRATION_LEDGER_DDL.indexOf(
      'create table if not exists public.schema_migrations',
    );
    const rlsAt = MIGRATION_LEDGER_DDL.indexOf(
      'alter table public.schema_migrations enable row level security',
    );
    const revokeAt = MIGRATION_LEDGER_DDL.indexOf(
      'revoke all on table public.schema_migrations from public, anon, authenticated',
    );
    expect(createAt).toBeGreaterThanOrEqual(0);
    expect(rlsAt).toBeGreaterThan(createAt);
    expect(revokeAt).toBeGreaterThan(rlsAt);
  });

  test('hardens the ledger before the runner trusts its rows', () => {
    const hardenAt = RUNNER.indexOf('client.query(MIGRATION_LEDGER_DDL)');
    const readAt = RUNNER.indexOf('select name, checksum from public.schema_migrations');
    expect(hardenAt).toBeGreaterThanOrEqual(0);
    expect(readAt).toBeGreaterThan(hardenAt);
  });

  // Assert the absence STRUCTURALLY, not by identifier name: a second copy
  // called anything else would satisfy a `const LEDGER_DDL =` check while
  // reintroducing exactly the drift this suite exists to prevent.
  test('uses the shared reviewed DDL rather than a second inline definition', () => {
    expect(RUNNER).toContain("import { MIGRATION_LEDGER_DDL } from './lib/migrationLedger';");
    expect(RUNNER).not.toMatch(/create\s+table[^;]*public\.schema_migrations/i);
  });
});

describe('no migration re-arms access to the ledger', () => {
  // The two frozen controls only protect the state 0036 leaves behind. A later
  // migration could legitimately pass every other test in this file and still
  // hand the table back to a browser role. Sweep the whole directory so that
  // regression has to be deliberate.
  //
  // A regex sweep, not `splitStatements`: 25 migrations use dollar-quoted
  // function bodies, which that splitter deliberately refuses.
  const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
  const ALL_MIGRATIONS = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .map((name) => ({
      name,
      // Comment lines only — 0036 documents its emergency rollback as a
      // commented-out `grant`, which must not read as a live re-grant.
      sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .replace(/\s+/g, ' '),
    }));

  const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
    ['grants access to the ledger', /grant\s[^;]*\son\s+(?:table\s+)?public\.schema_migrations/i],
    ['disables RLS on the ledger', /alter\s+table\s+public\.schema_migrations\s+disable\s+row\s+level\s+security/i],
    ['reassigns ledger ownership', /alter\s+table\s+public\.schema_migrations\s+owner\s+to/i],
    ['drops the ledger', /drop\s+table\s[^;]*public\.schema_migrations/i],
    // A permissive policy would re-open reads without any GRANT appearing.
    // 0036's design is "no policies at all", so any policy here is a regression.
    ['adds a policy to the ledger', /create\s+policy\s[^;]*\son\s+(?:table\s+)?public\.schema_migrations/i],
    // Renaming the hardened table and creating a fresh one under the old name
    // is the classic way to sidestep a name-keyed invariant.
    ['renames the ledger out from under this guard', /alter\s+table\s+public\.schema_migrations\s+rename\s+to/i],
  ];

  test('sweeps every migration file', () => {
    expect(ALL_MIGRATIONS.length).toBeGreaterThanOrEqual(37);
  });

  test.each(FORBIDDEN)('no migration %s', (_label, pattern) => {
    const offenders = ALL_MIGRATIONS.filter((m) => pattern.test(m.sql)).map((m) => m.name);
    expect(offenders).toEqual([]);
  });
});

describe('the two controls cannot drift apart', () => {
  // The hardening is deliberately duplicated: the numbered migration repairs
  // databases that already exist, the runner DDL closes the creation-time
  // window on fresh ones. Duplication is only safe while the two copies stay
  // identical, so assert that mechanically rather than trusting review.
  test('migration 0036 and MIGRATION_LEDGER_DDL apply the same hardening', () => {
    const fromMigration = hardeningOf(SQL);
    const fromRunner = hardeningOf(MIGRATION_LEDGER_DDL);

    expect(fromMigration).toEqual([
      'alter table public.schema_migrations enable row level security',
      'revoke all on table public.schema_migrations from public, anon, authenticated',
    ]);
    expect(fromRunner).toEqual(fromMigration);
  });

  // A multi-statement parameterless query is executed by PostgreSQL as ONE
  // implicit transaction — but only while the string contains no explicit
  // transaction control of its own. A stray `begin`/`commit` here would split
  // the batch into separately-committing pieces and reopen the very window
  // between CREATE and REVOKE that this DDL exists to close.
  test('the ledger DDL contains no explicit transaction control', () => {
    expect(MIGRATION_LEDGER_DDL).not.toMatch(/\b(?:begin|commit|rollback|start\s+transaction)\b/i);
  });

  // Passing values would switch node-postgres to the extended protocol, which
  // does not wrap the batch in an implicit transaction and rejects multi-
  // statement strings outright. The call must stay parameterless — and must be
  // AWAITED, or a rejected hardening would not reach main().catch and the
  // ledger SELECT would run against an unhardened table.
  test('the runner awaits the ledger DDL as a single parameterless query', () => {
    expect(RUNNER).toMatch(/await client\.query\(MIGRATION_LEDGER_DDL\)/);
    expect(RUNNER).not.toMatch(/client\.query\(MIGRATION_LEDGER_DDL\s*,/);
  });

  // The migration file carries negative assertions; without the same ones here
  // the runner DDL was the weaker half. `hardeningOf` deliberately ignores any
  // statement that is not an enable-RLS or a revoke, so a `grant` or
  // `create policy` appended to this constant would satisfy the drift test and
  // still reopen the table on every freshly-created database. Assert the exact
  // statement set, then name the specific regressions that matter.
  test('the ledger DDL contains exactly the three intended statements', () => {
    expect(statementsOf(MIGRATION_LEDGER_DDL)).toEqual([
      'create table if not exists public.schema_migrations ( name text primary key, '
        + 'checksum text not null, applied_at timestamptz not null default now() )',
      'alter table public.schema_migrations enable row level security',
      'revoke all on table public.schema_migrations from public, anon, authenticated',
    ]);
  });

  test('the ledger DDL introduces no grant, policy, FORCE RLS, or service_role revoke', () => {
    expect(MIGRATION_LEDGER_DDL).not.toMatch(/\bgrant\b/i);
    expect(MIGRATION_LEDGER_DDL).not.toMatch(/create\s+policy/i);
    expect(MIGRATION_LEDGER_DDL).not.toMatch(/force\s+row\s+level\s+security/i);
    expect(MIGRATION_LEDGER_DDL).not.toMatch(/revoke[^;]*service_role/i);
  });
});
