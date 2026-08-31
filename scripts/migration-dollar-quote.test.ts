import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Why this exists: on 2026-08-22 a Node helper patched 0065_stories.sql with
// String.prototype.replace, where `$$` in the REPLACEMENT string is an escape that
// collapses to a single `$`. `as $$` became `as $` and `$$;` became `$;`, so the
// migration could not parse and had never been appliable — while typecheck, the full
// vitest run and a 604-test Playwright release gate all stayed green, because none of
// them execute SQL. Both reviewer families caught it; no local gate did. This is that
// missing gate.
//
// Deliberately a plain scan rather than a SQL parser: the failure mode is a lone `$`
// where a `$$` belongs, and that is exactly what a lone-delimiter check catches.

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');

const sqlFiles = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort();

/** Lines that are a dollar-quote delimiter on their own, e.g. `as $$`, `$$;`, `$$`. */
const DELIMITER_LINE = /^\s*(as\s+)?\$+\s*;?\s*$/i;

/** A delimiter line carrying exactly one `$` — the collapsed form. */
export function findLoneDollarDelimiters(sql: string): Array<{ line: number; text: string }> {
  return sql.split(/\r?\n/).flatMap((text, i) => {
    if (!DELIMITER_LINE.test(text)) return [];
    const dollars = (text.match(/\$/g) ?? []).length;
    return dollars === 1 ? [{ line: i + 1, text }] : [];
  });
}

/** `$$` tokens must pair up: an odd count means an unterminated body. */
export function countDollarQuotes(sql: string): number {
  return (sql.match(/\$\$/g) ?? []).length;
}

describe('migration dollar-quoting', () => {
  it('finds every migration file', () => {
    expect(sqlFiles.length).toBeGreaterThan(0);
  });

  it.each(sqlFiles)('%s uses $$ and never a lone $ delimiter', (file) => {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const lone = findLoneDollarDelimiters(sql);
    expect(
      lone,
      `${file} has collapsed dollar-quote delimiter(s): ${lone.map((l) => `line ${l.line} ${JSON.stringify(l.text)}`).join(', ')}`,
    ).toEqual([]);
  });

  it.each(sqlFiles)('%s has balanced $$ delimiters', (file) => {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    expect(countDollarQuotes(sql) % 2, `${file} has an odd number of $$ tokens`).toBe(0);
  });

  // Negative proof: the detector must fail on the exact bytes that shipped, or it is
  // decoration rather than a guard.
  it('rejects the 0065 regression shape', () => {
    const broken = ['create function f()', 'as $', 'begin', 'end;', '$;'].join('\n');
    expect(findLoneDollarDelimiters(broken)).toEqual([
      { line: 2, text: 'as $' },
      { line: 5, text: '$;' },
    ]);
  });

  it('accepts the repaired shape', () => {
    const fixed = ['create function f()', 'as $$', 'begin', 'end;', '$$;'].join('\n');
    expect(findLoneDollarDelimiters(fixed)).toEqual([]);
    expect(countDollarQuotes(fixed) % 2).toBe(0);
  });
});
