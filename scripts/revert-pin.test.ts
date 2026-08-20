/**
 * revert-pin.test.ts — the two checksums the revert runner verifies before it
 * opens a database connection.
 *
 * WHY PINNING REPLACED PARSING. The runner used to prove, by lexing the SQL,
 * that a revert file was one transaction and nothing else. Four consecutive
 * review rounds each found a different way past that: a statement after COMMIT,
 * an indented ROLLBACK, ABORT and END as synonyms, an apostrophe inside a
 * double-quoted identifier, a non-ASCII dollar-quote tag, BEGIN ATOMIC routine
 * bodies. Statically validating arbitrary SQL needs a real parser, and a safety
 * check that is itself a homemade parser is a liability on a T0 rollback path.
 *
 * So the runner stopped asking what a file MEANS and started asking whether it
 * is the file a human reviewed. That makes every lexical edge case irrelevant:
 * a reviewed file cannot change under the reviewers, and an unreviewed file
 * cannot run at all.
 *
 * Two checksums, two different questions:
 *   - the REVERT pin  — is this the file that was reviewed?
 *   - the MIGRATION pin — does this revert still describe the migration it
 *     claims to undo? (The revert refuses in-database on the same value; this
 *     catches it before a connection exists.)
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { checkPinned } from './revert-migration';
import { checksumOfSql } from '../src/lib/effectiveMigration';

const REVERT_DIR = join(process.cwd(), 'supabase', 'migrations', 'revert');
const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const PINNED = 'revert-0064-transaction.sql';

const revertSql = readFileSync(join(REVERT_DIR, PINNED), 'utf8');

/** The same lookup the runner uses, against the real migrations directory. */
const readMigration = (number: string): string | null => {
  const found = readdirSync(MIGRATIONS_DIR)
    .find((name) => name.startsWith(`${number}_`) && name.endsWith('.sql'));
  return found ? readFileSync(join(MIGRATIONS_DIR, found), 'utf8') : null;
};

describe('checkPinned', () => {
  it('accepts the shipped revert file unchanged', () => {
    expect(checkPinned(PINNED, revertSql, readMigration)).toBeNull();
  });

  // THE REGRESSION THIS DESIGN EXISTS FOR. One byte is the whole point: the pin
  // is what lets the runner skip parsing, so if a single character can slip
  // through, nothing else here is load-bearing.
  it('rejects a ONE-BYTE change to the revert file', () => {
    const tampered = revertSql.replace('DROP FUNCTION', 'DROP  FUNCTION');
    expect(tampered).not.toBe(revertSql);
    expect(checkPinned(PINNED, tampered, readMigration)).toMatch(/does not match its pinned content/);
  });

  it('rejects a one-byte change even inside a comment', () => {
    // Comments are content. A reviewer read them, and an instruction changed
    // after review is exactly the drift that started this whole cycle.
    const tampered = revertSql.replace('-- Runnable, atomic rollback', '-- Runnable, atomic rollbacks');
    expect(tampered).not.toBe(revertSql);
    expect(checkPinned(PINNED, tampered, readMigration)).toMatch(/does not match its pinned content/);
  });

  it('refuses a revert file that is not pinned at all', () => {
    const problem = checkPinned('revert-0059-transaction.sql', revertSql, readMigration);
    expect(problem).toMatch(/not a pinned revert file/);
  });

  it('refuses when the revert no longer describes its migration', () => {
    // The migration was edited without repinning. The revert's own in-database
    // precondition would refuse too, but this says so before a connection exists.
    // Pinned to its OWN content so the first check passes and the migration
    // comparison is the one under test.
    const stale = revertSql.replace(
      /AND\s+checksum\s*=\s*'[0-9a-f]{64}'/i,
      `AND checksum = '${'0'.repeat(64)}'`,
    );
    expect(stale).not.toBe(revertSql);
    const problem = checkPinned(PINNED, stale, readMigration, {
      [PINNED]: checksumOfSql(stale),
    });
    expect(problem).toMatch(/no longer describes it/);
  });

  it('refuses a revert that pins no migration checksum at all', () => {
    const unpinned = revertSql.replace(/AND\s+checksum\s*=\s*'[0-9a-f]{64}'/i, 'AND true');
    expect(unpinned).not.toBe(revertSql);
    expect(checkPinned(PINNED, unpinned, readMigration, {
      [PINNED]: checksumOfSql(unpinned),
    })).toMatch(/pins no migration checksum/);
  });

  it('the pinned constant equals the shipped file, so the runner is not pinned to a stale copy', () => {
    // If this fails, the pin in revert-migration.ts was not updated in the same
    // commit as the file - the exact drift class that produced the stale
    // revert-point document earlier in this goal.
    expect(checkPinned(PINNED, revertSql, readMigration)).toBeNull();
  });
});
