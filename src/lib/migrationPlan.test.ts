import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import {
  checkBaselinePremise,
  checksum,
  expectedTablesFromMigrations,
  planMigrations,
  unwrapMigrationTransaction,
  type AppliedMigration,
  type MigrationFile,
} from '@/lib/migrationPlan';

const f = (name: string, sql: string): MigrationFile => ({ name, sql });
const a = (name: string, sql: string): AppliedMigration => ({
  name,
  checksum: checksum(sql),
});

describe('checksum', () => {
  test('is stable and hex', () => {
    expect(checksum('select 1;')).toMatch(/^[0-9a-f]{64}$/);
    expect(checksum('select 1;')).toBe(checksum('select 1;'));
  });

  test('distinguishes different SQL', () => {
    expect(checksum('select 1;')).not.toBe(checksum('select 2;'));
  });

  // The whole drift guard is worthless if a Windows checkout reports drift
  // against a LF-hashed ledger row.
  test('ignores CRLF vs LF so autocrlf checkouts do not report false drift', () => {
    expect(checksum('create table x;\r\nselect 1;\r\n')).toBe(
      checksum('create table x;\nselect 1;\n'),
    );
  });

  test('ignores trailing whitespace differences', () => {
    expect(checksum('select 1;')).toBe(checksum('select 1;\n\n  '));
  });

  test('does NOT ignore interior whitespace, which can change SQL meaning', () => {
    expect(checksum('select 1;\nselect 2;')).not.toBe(checksum('select 1;select 2;'));
  });
});

describe('planMigrations', () => {
  test('applies everything when the ledger is empty (first run after adopting it)', () => {
    const files = [f('0001_a.sql', 'select 1;'), f('0002_b.sql', 'select 2;')];
    const plan = planMigrations(files, []);
    expect(plan.apply.map((m) => m.name)).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(plan.skip).toEqual([]);
    expect(plan.drift).toEqual([]);
  });

  test('skips already-applied migrations with matching checksums', () => {
    const files = [f('0001_a.sql', 'select 1;'), f('0002_b.sql', 'select 2;')];
    const plan = planMigrations(files, [a('0001_a.sql', 'select 1;')]);
    expect(plan.skip).toEqual(['0001_a.sql']);
    expect(plan.apply.map((m) => m.name)).toEqual(['0002_b.sql']);
  });

  // This is the case that protects 0020: once recorded, it never re-runs, so it
  // can never re-GRANT the function 0021 removed.
  test('an applied migration is never re-applied', () => {
    const files = [f('0020_provenance.sql', 'grant execute on function f;')];
    const plan = planMigrations(files, [a('0020_provenance.sql', 'grant execute on function f;')]);
    expect(plan.apply).toEqual([]);
    expect(plan.skip).toEqual(['0020_provenance.sql']);
  });

  test('preserves lexical order of the files it is given', () => {
    const files = [f('0001.sql', 'a;'), f('0002.sql', 'b;'), f('0003.sql', 'c;')];
    expect(planMigrations(files, []).apply.map((m) => m.name)).toEqual([
      '0001.sql',
      '0002.sql',
      '0003.sql',
    ]);
  });

  test('reports drift when an applied migration was edited', () => {
    const files = [f('0021_hardening.sql', 'select 2;')];
    const plan = planMigrations(files, [a('0021_hardening.sql', 'select 1;')]);
    expect(plan.drift).toHaveLength(1);
    expect(plan.drift[0]?.name).toBe('0021_hardening.sql');
    expect(plan.drift[0]?.recorded).not.toBe(plan.drift[0]?.current);
  });

  // Fail closed. Applying the clean half of a drifted set produces a schema
  // that no single commit describes.
  test('applies NOTHING when any drift is present, even unrelated new files', () => {
    const files = [
      f('0020_applied.sql', 'EDITED;'),
      f('0022_brand_new.sql', 'select 99;'),
    ];
    const plan = planMigrations(files, [a('0020_applied.sql', 'ORIGINAL;')]);
    expect(plan.drift).toHaveLength(1);
    expect(plan.apply).toEqual([]);
  });

  test('a ledger row with no matching file is ignored, not an error', () => {
    // A migration deleted from the tree should not wedge every future run.
    const plan = planMigrations([f('0002.sql', 'b;')], [a('0001_deleted.sql', 'a;')]);
    expect(plan.drift).toEqual([]);
    expect(plan.apply.map((m) => m.name)).toEqual(['0002.sql']);
  });

  test('handles an empty migrations directory', () => {
    expect(planMigrations([], [])).toEqual({ apply: [], skip: [], drift: [] });
  });
});

describe('unwrapMigrationTransaction', () => {
  test('removes one outer transaction so the runner can atomically add its ledger row', () => {
    const input = [
      '-- header',
      'begin;',
      'create temporary table t (id text) on commit drop;',
      "do $$ begin raise notice 'still inside'; end $$;",
      'commit;',
      '-- rollback notes',
    ].join('\n');
    const result = unwrapMigrationTransaction(input);
    expect(result.unwrapped).toBe(true);
    expect(result.sql).not.toMatch(/^\s*begin\s*;/i);
    expect(result.sql).not.toMatch(/commit\s*;\s*$/i);
    expect(result.sql).toContain("do $$ begin raise notice 'still inside'; end $$;");
    expect(result.sql).toContain('on commit drop');
  });

  test('does not mistake PL/pgSQL BEGIN inside a dollar-quoted body for a wrapper', () => {
    const input = `create function f() returns void language plpgsql as $$
begin
  perform 1;
end;
$$;`;
    expect(unwrapMigrationTransaction(input)).toEqual({ sql: input, unwrapped: false });
  });

  test('fails closed on unmatched top-level transaction control', () => {
    expect(() => unwrapMigrationTransaction('begin; select 1;')).toThrow(/unbalanced/i);
    expect(() => unwrapMigrationTransaction('select 1; commit;')).toThrow(/unbalanced/i);
    expect(() => unwrapMigrationTransaction('select 1; begin; select 2; commit; select 3;')).toThrow(
      /unbalanced/i,
    );
  });

  /**
   * Previously these produced ZERO recognized controls, so the file was passed
   * through verbatim: the runner issued its own BEGIN, the migration's ROLLBACK
   * or END silently ended it, and the ledger INSERT then committed on its own in
   * autocommit mode — recording a migration whose work had been discarded.
   * Fail-open is the one outcome this function must never have.
   */
  test.each([
    ['start transaction; select 1; commit;', 'START TRANSACTION'],
    ['begin; select 1; rollback;', 'ROLLBACK'],
    ['begin; select 1; end;', 'END as a COMMIT alias'],
    ['begin; select 1; end transaction;', 'END TRANSACTION'],
    ['begin; savepoint s1; select 1; commit;', 'SAVEPOINT'],
    ['begin; select 1; abort;', 'ABORT'],
    ['begin; set transaction isolation level serializable; select 1; commit;', 'SET TRANSACTION'],
  ])('rejects unsupported top-level transaction control (%s)', (sql) => {
    expect(() => unwrapMigrationTransaction(sql)).toThrow(/unsupported top-level transaction/i);
  });

  /**
   * These reached NEITHER the accepted spellings nor the rejected list, so they
   * returned null and were executed verbatim inside the runner's transaction —
   * fail OPEN. Each must abort. (Codex + DeepSeek round 2, 2026-07-31.)
   */
  test.each([
    'select 1; commit and chain;',
    'select 1; commit work and no chain;',
    'select 1; commit transaction and chain;',
    'begin isolation level serializable; select 1;',
    'begin read write; select 1;',
    'select 1; rollback to savepoint s1;',
  ])('rejects the transaction-control variant %s', (sql) => {
    expect(() => unwrapMigrationTransaction(sql)).toThrow(
      /unsupported top-level transaction|unbalanced/i,
    );
  });

  /**
   * `stripSqlComments` was non-nesting, so the statement text
   * `/* outer /* inner *\/ outer *\/ rollback` was reduced to `outer *\/ rollback`,
   * which no longer matched `^rollback` — the executable ROLLBACK became
   * invisible and was passed straight through. (Codex round 2, 2026-07-31.)
   */
  test.each([
    'create table t(id int); /* outer /* inner */ outer */ rollback;',
    '/* a /* b */ c */ rollback;',
  ])('sees executable transaction control after a NESTED comment: %s', (sql) => {
    expect(() => unwrapMigrationTransaction(sql)).toThrow(/unsupported top-level transaction/i);
  });

  /**
   * Comment kinds must be consumed in ONE pass so whichever opens FIRST wins.
   * Stripping block comments before line comments lets `-- /* not a comment`
   * open a block comment that never closes and swallows the rest of the file,
   * hiding the executable ROLLBACK below it. That fails OPEN.
   */
  test('a /* inside a -- line comment does not open a block comment', () => {
    expect(() =>
      unwrapMigrationTransaction('-- /* not a comment start\nrollback;'),
    ).toThrow(/unsupported top-level transaction/i);
    // ...and the inverse: -- inside a block comment is not a line comment.
    expect(() => unwrapMigrationTransaction('/* a -- b */ rollback;')).toThrow(
      /unsupported top-level transaction/i,
    );
  });

  test('an empty block comment does not hide the statement after it', () => {
    expect(() => unwrapMigrationTransaction('/**/ rollback;')).toThrow(
      /unsupported top-level transaction/i,
    );
  });

  /**
   * Nesting WITHOUT string-awareness is strictly worse than neither: a lone
   * `/*` inside a literal used to self-heal at the first `*\/`, but a depth
   * counter keeps it open forever and hides every later statement from both
   * transactionCommand and expectedTablesFromMigrations. (Codex round 3.)
   */
  test('a /* inside a string literal does not open a block comment', () => {
    expect(() => unwrapMigrationTransaction("select '/* /* */'; rollback;")).toThrow(
      /unsupported top-level transaction/i,
    );
    expect(
      expectedTablesFromMigrations([
        { name: 'x.sql', sql: "select '/* /* */'; create table public.x (id int);" },
      ]),
    ).toEqual(['x']);
  });

  /**
   * `stripSqlComments` and `topLevelStatements` must agree about E-strings.
   * Two lexers over the same text disagreeing is the recurring shape of every
   * bug this area has had. (GLM round 3.)
   */
  test("a backslash-escaped quote inside E'...' does not end the literal", () => {
    expect(() =>
      unwrapMigrationTransaction(String.raw`select E'O\'Brien' as n; rollback;`),
    ).toThrow(/unsupported top-level transaction/i);
    expect(
      expectedTablesFromMigrations([
        {
          name: 'x.sql',
          sql: String.raw`select E'O\'Brien'; create table public.after_estring (id int);`,
        },
      ]),
    ).toEqual(['after_estring']);
  });

  test('rejects SET SESSION CHARACTERISTICS AS TRANSACTION but not ordinary SET', () => {
    expect(() =>
      unwrapMigrationTransaction('set session characteristics as transaction read only;'),
    ).toThrow(/unsupported top-level transaction/i);
    expect(() =>
      unwrapMigrationTransaction("set session my.flag = 'x'; select 1;"),
    ).not.toThrow();
  });

  /**
   * Ending mid-literal or mid-comment means the scanner's view diverged from
   * PostgreSQL's somewhere above, so every boundary after that is a guess.
   * Refuse rather than guess — PostgreSQL rejects these anyway, so this can
   * only over-reject, never fail open. (DeepSeek round 4.)
   */
  test.each([
    ["select 'unterminated;", /unterminated single-quoted literal/i],
    ['select "unterminated;', /unterminated double-quoted literal/i],
    ['create function f() as $$ begin', /unterminated dollar-quoted body/i],
    ['select 1; /* unterminated', /unterminated block comment/i],
  ])('refuses SQL that ends mid-literal or mid-comment: %s', (sql, expected) => {
    expect(() => unwrapMigrationTransaction(sql)).toThrow(expected);
  });

  test('expectedTablesFromMigrations refuses a malformed file instead of silently truncating', () => {
    // Without the guard this returned ['before'] and dropped 'after', handing
    // the baseline premise check a short list.
    expect(() =>
      expectedTablesFromMigrations([
        {
          name: 'x.sql',
          sql: 'create table public.before (id int); /* unterminated\ncreate table public.after (id int);',
        },
      ]),
    ).toThrow(/unterminated block comment/i);
    // ...and still accepts a normal file with trailing rollback comments.
    expect(
      expectedTablesFromMigrations([
        { name: 'y.sql', sql: 'create table public.ok (id int);\n-- rollback: drop table ok;' },
      ]),
    ).toEqual(['ok']);
  });

  test('a trailing -- comment with no newline is legal and must NOT be refused', () => {
    // Every migration in this repo ends with rollback notes in `--` comments.
    const input = 'select 1;\n-- rollback: drop table x;';
    expect(unwrapMigrationTransaction(input)).toEqual({ sql: input, unwrapped: false });
  });

  test('does not mistake $1 positional parameters or $5.00 literals for dollar quotes', () => {
    // A `$` opener that swallowed the rest of the file would hide the ROLLBACK.
    expect(() => unwrapMigrationTransaction('update t set a = $1 where b = $2; rollback;')).toThrow(
      /unsupported top-level transaction/i,
    );
    expect(() => unwrapMigrationTransaction("select '$5.00'; rollback;")).toThrow(
      /unsupported top-level transaction/i,
    );
  });

  /**
   * `$` is legal INSIDE an unquoted identifier, so `foo$tag$` is one identifier
   * — not the alias `foo` followed by a dollar-quote opener. Treating it as an
   * opener swallowed everything to the next `$tag$`, hiding an executable
   * ROLLBACK between them, and separately refused the valid single statement as
   * an unterminated body. Tags also admit non-ASCII letters. (Codex round 4.)
   */
  test('does not open a dollar quote in the middle of an identifier', () => {
    expect(() =>
      unwrapMigrationTransaction('SELECT 1 AS foo$tag$; ROLLBACK; SELECT 2 AS bar$tag$;'),
    ).toThrow(/unsupported top-level transaction/i);
    const valid = 'SELECT 1 AS foo$tag$;';
    expect(unwrapMigrationTransaction(valid)).toEqual({ sql: valid, unwrapped: false });
  });

  /**
   * `sql[i - 1]` is a UTF-16 CODE UNIT. For a non-BMP identifier letter the
   * character before `$` is that letter's lone low surrogate, which is not
   * `\p{L}` — so an index-based guard passed and `foo𐐀$tag$` opened a dollar
   * quote after all, hiding the ROLLBACK between the two tags. Sharing one
   * helper had removed the lexers' disagreement but made both agree on the same
   * wrong parse. (Codex round 5.)
   */
  test('reads the preceding code point, not code unit, before a $ (non-BMP identifiers)', () => {
    const nonBmp = '\u{10400}';
    expect(() =>
      unwrapMigrationTransaction(
        `SELECT 1 AS foo${nonBmp}$tag$; ROLLBACK; SELECT 2 AS bar${nonBmp}$tag$;`,
      ),
    ).toThrow(/unsupported top-level transaction/i);
    const valid = `SELECT 1 AS foo${nonBmp}$tag$;`;
    expect(unwrapMigrationTransaction(valid)).toEqual({ sql: valid, unwrapped: false });
  });

  /**
   * PostgreSQL's lexer defines ident_cont as `[A-Za-z\200-\377_0-9\$]` — EVERY
   * non-ASCII byte is an identifier character, not merely Unicode letters and
   * digits. `foo😀` is a valid identifier, so `foo😀$tag$` must not open a
   * dollar quote. A `\p{L}\p{N}` test missed emoji, symbols, punctuation and
   * combining marks, and each miss hid an executable ROLLBACK between the two
   * apparent tags. (Codex round 6.)
   */
  test.each([
    ['\u{1F600}', 'emoji'],
    ['\u{10400}', 'non-BMP letter'],
    ['é', 'accented letter'],
    ['́', 'combining mark'],
    ['中', 'CJK'],
    ['€', 'currency symbol'],
    ['¿', 'punctuation'],
  ])('treats any non-ASCII char (%s, %s) as an identifier continuation', (char) => {
    expect(() =>
      unwrapMigrationTransaction(
        `SELECT 1 AS foo${char}$tag$; ROLLBACK; SELECT 2 AS bar${char}$tag$;`,
      ),
    ).toThrow(/unsupported top-level transaction/i);
  });

  test('recognises a non-ASCII dollar-quote tag', () => {
    expect(() =>
      unwrapMigrationTransaction("SELECT $é$'$é$; ROLLBACK; SELECT $é$'$é$;"),
    ).toThrow(/unsupported top-level transaction/i);
  });

  test('sees transaction control that FOLLOWS a dollar-quoted body', () => {
    for (const tag of ['$$', '$body$']) {
      expect(() =>
        unwrapMigrationTransaction(
          `create function f() returns void language plpgsql as ${tag} begin perform 1; end ${tag}; rollback;`,
        ),
        tag,
      ).toThrow(/unsupported top-level transaction/i);
    }
  });

  test('line comments still hide their own content', () => {
    expect(unwrapMigrationTransaction('select 1; -- rollback;\n')).toEqual({
      sql: 'select 1; -- rollback;\n',
      unwrapped: false,
    });
  });

  test('does not mistake ordinary SET or PREPARE for transaction control', () => {
    for (const sql of [
      "set search_path = public; select 1;",
      "set local statement_timeout = '5s'; select 1;",
      'prepare my_plan as select 1; select 1;',
    ]) {
      expect(() => unwrapMigrationTransaction(sql), sql).not.toThrow();
    }
  });

  test('accepts COMMIT TRANSACTION as the matching close of an outer wrapper', () => {
    const result = unwrapMigrationTransaction('begin transaction; select 1; commit transaction;');
    expect(result.unwrapped).toBe(true);
    expect(result.sql.trim()).toBe('select 1;');
  });

  test('honours nested block comments so a commented-out COMMIT stays inert', () => {
    const input = '/* outer /* inner */ commit; */ select 1;';
    expect(unwrapMigrationTransaction(input)).toEqual({ sql: input, unwrapped: false });
  });

  test('does not let a backslash-escaped quote in an E-string leak a semicolon', () => {
    const input = String.raw`select E'a\'; commit; --' as v;`;
    expect(unwrapMigrationTransaction(input)).toEqual({ sql: input, unwrapped: false });
  });

  test('treats a type-prefixed literal as an ordinary string, not an E-string', () => {
    const input = String.raw`select date'2026-07-31' as d;`;
    expect(unwrapMigrationTransaction(input)).toEqual({ sql: input, unwrapped: false });
  });

  /**
   * The look-behind reads sql[i-1] and sql[i-2]; at offset 0 the latter is
   * undefined, and `/[A-Za-z0-9_$]/.test(undefined)` is TRUE because the regex
   * matches the coerced string "undefined". Without the `?? ''` guard a leading
   * E-string would be misread as an ordinary literal. (GLM review, 2026-07-31 —
   * raised as a defect, refuted here, pinned by this test.)
   */
  test('handles an E-string that starts at offset 0', () => {
    const input = String.raw`E'a\'; commit; --' ;`;
    expect(unwrapMigrationTransaction(input)).toEqual({ sql: input, unwrapped: false });
  });

  /**
   * PostgreSQL `U&'...'` escapes a quote by DOUBLING it, exactly like an ordinary
   * literal; the backslash only introduces \XXXX unicode escapes. So the closing
   * quote must stay a terminator here — treating `\'` as an escape would swallow
   * it and run the scanner off the end of the statement.
   */
  test("treats U&'...' quotes as ordinary terminators, not backslash-escapable", () => {
    const input = String.raw`select U&'a\0027' as v; select 1;`;
    expect(unwrapMigrationTransaction(input)).toEqual({ sql: input, unwrapped: false });
  });

  test.each([
    '0029_correct_coordinates_from_osm.sql',
    '0030_resource_coordinates_from_osm.sql',
    '0031_diamond_dogs_rocka_rolla_osm.sql',
    '0032_geocode_remaining_from_osm.sql',
  ])('unwraps the real historical wrapper in %s without dropping its temp-table body', (name) => {
    const input = readFileSync(join(process.cwd(), 'supabase', 'migrations', name), 'utf8');
    const result = unwrapMigrationTransaction(input);
    expect(result.unwrapped).toBe(true);
    expect(result.sql).toContain('public.bars');
    expect(result.sql).toMatch(/raise (?:exception|notice)/i);
  });

  test('mechanically validates transaction control in every checked-in migration', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const wrappers: string[] = [];
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) {
      const result = unwrapMigrationTransaction(readFileSync(join(dir, name), 'utf8'));
      if (result.unwrapped) wrappers.push(name);
    }
    expect(wrappers).toEqual([
      '0029_correct_coordinates_from_osm.sql',
      '0030_resource_coordinates_from_osm.sql',
      '0031_diamond_dogs_rocka_rolla_osm.sql',
      '0032_geocode_remaining_from_osm.sql',
    ]);
  });
});

/**
 * H1: `--baseline` records files as applied WITHOUT running them. Pointed at a
 * fresh or partially-migrated database it will happily claim the whole schema
 * exists, then report "up to date" forever. The expectation is derived from the
 * migration files themselves rather than hardcoded, so it cannot go stale as
 * new migrations land.
 */
describe('expectedTablesFromMigrations', () => {
  test('extracts plain and IF NOT EXISTS creates, with or without the schema', () => {
    const files = [
      f('0001.sql', 'create table public.bars (id text primary key);'),
      f('0002.sql', 'CREATE TABLE IF NOT EXISTS public.bar_photos (id uuid);'),
      f('0003.sql', 'create table ratings (id text);'),
    ];
    expect(expectedTablesFromMigrations(files)).toEqual(['bars', 'bar_photos', 'ratings']);
  });

  test('is case-insensitive and tolerates quoted identifiers and odd whitespace', () => {
    const files = [
      f('0001.sql', 'CrEaTe   TABLE\n  IF NOT EXISTS\n  public."bar_claims" (id uuid);'),
    ];
    expect(expectedTablesFromMigrations(files)).toEqual(['bar_claims']);
  });

  test('deduplicates a table created idempotently across several files', () => {
    const files = [
      f('0001.sql', 'create table if not exists public.bars (id text);'),
      f('0002.sql', 'create table if not exists public.bars (id text);'),
    ];
    expect(expectedTablesFromMigrations(files)).toEqual(['bars']);
  });

  // The real migrations carry rollback SQL in trailing comments. Counting those
  // would invent expectations that were never meant to run.
  test('IGNORES creates inside line comments', () => {
    const files = [
      f('0001.sql', 'create table public.real_one (id text);\n-- create table public.rollback_note (id text);'),
    ];
    expect(expectedTablesFromMigrations(files)).toEqual(['real_one']);
  });

  test('IGNORES creates inside block comments', () => {
    const files = [
      f('0001.sql', '/* create table public.commented_out (id text); */\ncreate table public.real_two (id text);'),
    ];
    expect(expectedTablesFromMigrations(files)).toEqual(['real_two']);
  });

  test('IGNORES temporary tables, which never persist', () => {
    const files = [
      f('0001.sql', 'create temp table scratch (id text);\ncreate temporary table scratch2 (id text);\ncreate table public.keeper (id text);'),
    ];
    expect(expectedTablesFromMigrations(files)).toEqual(['keeper']);
  });

  test('returns nothing for migrations that create no tables', () => {
    expect(expectedTablesFromMigrations([f('0022.sql', 'alter table public.bars add constraint c check (true);')])).toEqual([]);
  });
});

describe('checkBaselinePremise', () => {
  const files = [
    f('0001.sql', 'create table public.bars (id text);'),
    f('0002.sql', 'create table if not exists public.bar_photos (id uuid);'),
  ];

  test('a fresh database FAILS the premise — this is the catastrophic case', () => {
    const check = checkBaselinePremise(files, []);
    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(['bars', 'bar_photos']);
  });

  test('a partially-migrated database FAILS and names exactly what is missing', () => {
    const check = checkBaselinePremise(files, ['bars']);
    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(['bar_photos']);
  });

  test('a fully-migrated database PASSES', () => {
    const check = checkBaselinePremise(files, ['bars', 'bar_photos', 'unrelated']);
    expect(check.ok).toBe(true);
    expect(check.missing).toEqual([]);
  });

  test('comparison ignores case so pg_catalog casing cannot cause a false refusal', () => {
    expect(checkBaselinePremise(files, ['BARS', 'Bar_Photos']).ok).toBe(true);
  });

  // Passing vacuously would defeat the guard: no expectation means no evidence,
  // which is not the same as evidence of a migrated database.
  test('a migration set that creates NO tables cannot vacuously pass', () => {
    const check = checkBaselinePremise([f('0022.sql', 'alter table public.bars add constraint c check (true);')], []);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/no expectation|cannot verify/i);
  });
});
