/**
 * revert-migration.test.ts — the revert runner's file-shape guard.
 *
 * The TARGET guards it uses (`resolveTarget`, `authorizeMigrationTarget`) are the
 * applier's own and are covered by lib/migration-target-guard.test.ts and
 * apply-migration-target-guard.test.ts. Testing them again here would be testing
 * a copy that does not exist, which is the point of sharing them.
 *
 * What IS new in this runner is the refusal to hand the server a file that is
 * not a single explicit transaction, or that carries psql client syntax. Both
 * failures already happened in this repository: a revert opening with
 * `\set ON_ERROR_STOP on` could not be sent by any non-psql client, and a
 * rollback that is not one transaction is the ledger-vs-database split every
 * revert file here exists to prevent.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { checkRevertFile } from './revert-migration';

const REVERT_DIR = join(process.cwd(), 'supabase', 'migrations', 'revert');
const WELL_FORMED = ['BEGIN READ WRITE;', "DROP FUNCTION IF EXISTS public.x();", 'COMMIT;'].join('\n');

describe('checkRevertFile', () => {
  it('accepts a single explicit transaction', () => {
    expect(checkRevertFile(WELL_FORMED)).toBeNull();
  });

  it('accepts plain BEGIN as well as BEGIN READ WRITE', () => {
    expect(checkRevertFile(WELL_FORMED.replace('BEGIN READ WRITE;', 'BEGIN;'))).toBeNull();
  });

  it('refuses a psql metacommand, naming the line', () => {
    const problem = checkRevertFile(`\\set ON_ERROR_STOP on\n${WELL_FORMED}`);
    expect(problem).toMatch(/line 1 is a psql metacommand/);
  });

  it('refuses a metacommand that appears further down the file', () => {
    const problem = checkRevertFile(`BEGIN READ WRITE;\n\\ir other.sql\nCOMMIT;`);
    expect(problem).toMatch(/line 2 is a psql metacommand/);
  });

  it('refuses a file that opens no transaction', () => {
    expect(checkRevertFile('DROP FUNCTION IF EXISTS public.x();\n')).toMatch(/opens no explicit transaction/);
  });

  it('refuses a file that never commits', () => {
    expect(checkRevertFile('BEGIN READ WRITE;\nDROP FUNCTION IF EXISTS public.x();\n')).toMatch(/never COMMITs/);
  });

  it('does not mistake the word begin inside a comment for a transaction', () => {
    expect(checkRevertFile('-- BEGIN; here is a comment\nCOMMIT;\n')).toMatch(/opens no explicit transaction/);
  });

  // Round-1 panel of the fresh cycle, Codex, HIGH. The first version of this
  // guard looked for a line containing BEGIN and another containing COMMIT,
  // which is not the same thing as "one transaction and nothing else".
  it('refuses a statement AFTER the commit, which would commit on its own', () => {
    const problem = checkRevertFile('BEGIN;\nCOMMIT;\nDELETE FROM public.schema_migrations;\n');
    expect(problem).toMatch(/follows COMMIT/);
  });

  it('refuses more than one transaction', () => {
    expect(checkRevertFile('BEGIN;\nCOMMIT;\nBEGIN;\nCOMMIT;\n')).toMatch(/transactions|COMMITs 2 times/);
  });

  it('refuses a statement BEFORE the transaction opens', () => {
    expect(checkRevertFile('DELETE FROM public.schema_migrations;\nBEGIN;\nCOMMIT;\n'))
      .toMatch(/first statement is not BEGIN/);
  });

  it('does not count BEGIN inside a dollar-quoted body as a transaction', () => {
    // A DO block's plpgsql BEGIN/END is not a transaction control statement, and
    // every revert file in this repository contains one.
    const sql = 'DO $$\nBEGIN\n  RAISE NOTICE \'hi\';\nEND\n$$;\n';
    expect(checkRevertFile(sql)).toMatch(/opens no explicit transaction/);
  });

  it('accepts a real transaction that contains a DO block with its own BEGIN', () => {
    const sql = [
      'BEGIN READ WRITE;',
      "SET LOCAL lock_timeout = '10s';",
      'DO $$',
      'BEGIN',
      "  IF NOT EXISTS (SELECT 1) THEN RAISE EXCEPTION 'no';",
      '  END IF;',
      'END',
      '$$;',
      'COMMIT;',
    ].join('\n');
    expect(checkRevertFile(sql)).toBeNull();
  });

  it('does not count BEGIN inside a string literal', () => {
    expect(checkRevertFile("BEGIN;\nSELECT 'BEGIN; COMMIT;';\nCOMMIT;\n")).toBeNull();
  });

  it('refuses a file containing ROLLBACK, whose outcome depends on a branch', () => {
    expect(checkRevertFile('BEGIN;\nROLLBACK;\nCOMMIT;\n')).toMatch(/ROLLBACK/);
  });
});

/**
 * Which shipped revert files the runner can execute, and which it must refuse.
 *
 * NOT every revert file is runnable through it, and that is the correct
 * outcome rather than a gap to paper over. `revert-0059-transaction.sql`
 * includes `REVERT-0059-staging-20260817.sql` with `\ir`, which only psql
 * resolves — the include is load-bearing, so sending that file over any other
 * client would execute a transaction with its body restore missing. The runner
 * refuses it up front instead, and 0059 keeps psql as its path of record with
 * the connection-layer guards enforced by hand.
 *
 * Listed explicitly so that adding a revert file is a deliberate choice about
 * which path it takes, not something a glob silently decides.
 */
describe('the revert files this repository ships', () => {
  const RUNNABLE = ['revert-0064-transaction.sql'];
  const PSQL_ONLY = ['revert-0059-transaction.sql'];

  it('covers every revert transaction file that exists', () => {
    const found = readdirSync(REVERT_DIR).filter((n) => /^revert-\d{4}-transaction\.sql$/.test(n));
    expect(
      [...RUNNABLE, ...PSQL_ONLY].sort(),
      'a revert file was added without deciding whether the guarded runner can execute it',
    ).toEqual(found.sort());
  });

  for (const name of RUNNABLE) {
    it(`${name} passes the shape guard, so the runner can execute it`, () => {
      expect(checkRevertFile(readFileSync(join(REVERT_DIR, name), 'utf8'))).toBeNull();
    });
  }

  for (const name of PSQL_ONLY) {
    it(`${name} is refused by the runner, because psql must resolve its includes`, () => {
      expect(checkRevertFile(readFileSync(join(REVERT_DIR, name), 'utf8'))).toMatch(/psql metacommand/);
    });
  }
});
