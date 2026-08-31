import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { normalisedSql } from '../src/lib/effectiveMigration';

/**
 * THE BOOTSTRAP RUNNER MUST EXECUTE THE SAME TEXT THE REPOSITORY COMMITS.
 *
 * `apply-migrations.ts` read the raw file buffer and executed it. On a `core.autocrlf=true`
 * checkout — which this repository is — that means the SERVER STORES CRLF while git stores LF.
 * Postgres does not care, but `pg_proc.prosrc` then differs from the committed text for every
 * function the run creates, and that comparison is the applied-versus-committed evidence
 * `nightOutsRls.live.test.ts` carries as an acceptance criterion.
 *
 * It failed after B3 on exactly five night-out functions, and the arithmetic named the cause with
 * no ambiguity: `respond_night_out` 3352 applied vs 3269 committed, `join_night_out_by_token`
 * 2392/2323, `decline_night_out_by_token` 1542/1489, `night_out_seat_count` 146/141 — every delta
 * equal to that function's newline count, one `\r` per line, first divergence at character 0.
 *
 * `apply-migration-set.ts` learned this in its round-9 review ("hash and execute the same string").
 * The bootstrap runner never did, so the two appliers produced databases that could not be compared
 * byte for byte.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE. The end-to-end claim — a CRLF migration file yields an LF
 * `prosrc` — needs a live database, so it belongs to the live suite and is verified at the next
 * staging reset. What is provable here is the whole of the offline half: that the normaliser does
 * the conversion, and that the runner passes its file read THROUGH the normaliser rather than
 * around it. The second is a source assertion deliberately, because the runner calls `main()` at
 * import time and opens a connection; a test that imported it would connect to whatever the
 * ambient environment names.
 */
const RUNNER = path.join(process.cwd(), 'scripts', 'apply-migrations.ts');

describe('the bootstrap runner executes LF, whatever the checkout stores', () => {
  it('normalisedSql converts CRLF to LF and leaves LF alone', () => {
    const crlf = 'create or replace function f()\r\nreturns void\r\nas $$\r\nbegin\r\nend;\r\n$$;';
    const lf = 'create or replace function f()\nreturns void\nas $$\nbegin\nend;\n$$;';
    expect(normalisedSql(crlf)).toBe(lf);
    expect(normalisedSql(lf)).toBe(lf);
  });

  it('the length it removes is exactly one character per line — the signature of the B3 failure', () => {
    const crlf = 'a\r\nb\r\nc\r\nd';
    expect(crlf.length - normalisedSql(crlf).length).toBe(3);
  });

  it('the runner passes its migration read THROUGH normalisedSql', () => {
    const source = readFileSync(RUNNER, 'utf8');
    expect(source).toContain("import { normalisedSql } from '../src/lib/effectiveMigration'");
    expect(
      source,
      'apply-migrations.ts must normalise the file it is about to execute, not the raw buffer',
    ).toMatch(/sql:\s*normalisedSql\(readFileSync\(join\(migrationsDir, name\), 'utf-8'\)\)/);
  });

  it('and does not execute a raw read anywhere in the migration loop', () => {
    const source = readFileSync(RUNNER, 'utf8');
    expect(source).not.toMatch(/sql:\s*readFileSync\(join\(migrationsDir, name\), 'utf-8'\)/);
  });
});
