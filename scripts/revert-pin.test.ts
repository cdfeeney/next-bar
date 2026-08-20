/**
 * revert-pin.test.ts — the pinned checksum in a revert script must equal the
 * migration it reverts.
 *
 * WHY. revert-0064-transaction.sql refuses unless the ledger row for 0064
 * carries that migration's checksum, which is the strongest target check
 * available from inside SQL. The cost of that strength is a constant that has to
 * be kept true by hand, and the next legitimate edit to 0064 strands it silently.
 * The revert then fails CLOSED — no wrong-database downgrade — but the refusal
 * surfaces mid-incident, which is the worst possible moment to be debugging a
 * stale constant.
 *
 * This is not a hypothetical. The same drift class landed twice inside the
 * candidate that introduced the pin: once in the revert-point document, which
 * kept quoting the pre-edit checksum, and once in the pin itself when 0064's
 * rollback comment was corrected. Both were caught by review rather than by a
 * test, and review is not run before an emergency rollback.
 *
 * Deliberately generic: it discovers every `revert-NNNN-transaction.sql` and
 * checks any that pin a checksum, so a future revert script inherits the guard
 * by existing rather than by someone remembering to extend this file.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { checksumOfSql } from '../src/lib/effectiveMigration';

const REVERT_DIR = join(process.cwd(), 'supabase', 'migrations', 'revert');
const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const REVERT_FILE = /^revert-(\d{4})-transaction\.sql$/;
/** The pin as the scripts write it: `AND checksum = '<64 hex>'`. */
const PIN = /AND\s+checksum\s*=\s*'([0-9a-f]{64})'/i;

function revertScripts(): { file: string; number: string; sql: string }[] {
  return readdirSync(REVERT_DIR)
    .map((name) => ({ name, match: REVERT_FILE.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .map(({ name, match }) => ({
      file: name,
      number: match[1],
      sql: readFileSync(join(REVERT_DIR, name), 'utf8'),
    }));
}

function migrationFor(number: string): string | null {
  const found = readdirSync(MIGRATIONS_DIR).find((name) => name.startsWith(`${number}_`) && name.endsWith('.sql'));
  return found ? join(MIGRATIONS_DIR, found) : null;
}

describe('revert scripts that pin a migration checksum', () => {
  const scripts = revertScripts();

  it('finds the revert scripts to check', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  for (const script of scripts) {
    const pinned = PIN.exec(script.sql)?.[1];
    if (!pinned) {
      // Not every revert pins a checksum — 0059's does not. Nothing to check,
      // and a missing pin is a design choice rather than a defect.
      continue;
    }

    it(`${script.file} pins the checksum of the migration it reverts`, () => {
      const migration = migrationFor(script.number);
      expect(migration, `no migration file found for ${script.number}`).not.toBeNull();
      const actual = checksumOfSql(readFileSync(migration as string, 'utf8'));
      expect(
        pinned,
        `${script.file} pins ${pinned} but ${script.number}'s file checksums to ${actual}. `
        + 'Editing an applied migration also means reverting and reapplying it so the ledger '
        + 'matches; update this pin in the same commit.',
      ).toBe(actual);
    });
  }
});
