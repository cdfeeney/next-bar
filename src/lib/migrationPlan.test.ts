import { describe, expect, test } from 'vitest';
import {
  checkBaselinePremise,
  checksum,
  expectedTablesFromMigrations,
  planMigrations,
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
