import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Guards for migration 0034 (revoke-first grants — C3 audit F3 + F5).
 *
 * Static assertions against the SQL text, same as 0033: there is no test
 * database, and this file is authored-but-UNAPPLIED. The failure modes pinned
 * here are the ones that would either re-open a privilege the project
 * deliberately closed, or silently erase a grant by ordering it before its
 * own revoke — both invisible until something breaks in production.
 */

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/0034_revoke_first_grants.sql'),
  'utf8',
);

/** The statement bodies only — comments carry prose that would false-match. */
const STATEMENTS = SQL.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

const TABLES = ['profiles', 'ratings', 'pairwise_comparisons'] as const;

describe('migration 0034 — revoke-first ordering', () => {
  test.each(TABLES)('%s is revoked from public, anon AND authenticated', (table) => {
    expect(STATEMENTS).toMatch(
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`),
    );
  });

  test.each(TABLES)('%s revokes BEFORE it grants (order is load-bearing)', (table) => {
    // A grant written above its own revoke is silently wiped by that revoke.
    // The file would still apply cleanly and the app would then fail closed.
    const revokeAt = STATEMENTS.indexOf(`revoke all on table public.${table}`);
    const grantAt = STATEMENTS.search(
      new RegExp(`grant [^;]*on table public\\.${table}`),
    );
    expect(revokeAt).toBeGreaterThanOrEqual(0);
    expect(grantAt).toBeGreaterThanOrEqual(0);
    expect(revokeAt).toBeLessThan(grantAt);
  });
});

describe('migration 0034 — profiles (F5: the opt-in must be reachable)', () => {
  test('the update grant now includes shares_list_publicly', () => {
    // The finding: 0015 added the column, 0006's column-scoped grant never
    // learned about it, and no RPC sets it — so the owner of a profile could
    // not switch on their own public shared list and get_public_ratings was
    // permanently empty.
    expect(STATEMENTS).toMatch(
      /grant update \(display_name, is_private, shares_list_publicly\)\s*on table public\.profiles to authenticated;/,
    );
  });

  test('the update grant still EXCLUDES handle — 0006 no-renames survives', () => {
    // 0006 dropped table-level UPDATE precisely so handles could not be
    // PATCHed around claim_handle's rate cap. Re-granting the table (or
    // adding `handle` to the column list) would undo that silently.
    const grant = STATEMENTS.match(/grant update \(([^)]*)\)\s*on table public\.profiles/s);
    expect(grant).not.toBeNull();
    const columns = (grant?.[1] ?? '').split(',').map((c) => c.trim());
    expect(columns).toEqual(['display_name', 'is_private', 'shares_list_publicly']);
    expect(columns).not.toContain('handle');
    expect(columns).not.toContain('id');
  });

  test('profiles gets no unscoped UPDATE and no DELETE', () => {
    // Deletion runs service-role through /api/account/delete and cascades
    // from auth.users; there is no owner-delete policy either.
    expect(STATEMENTS).not.toMatch(/grant [^(;]*update[^(;]*on table public\.profiles/);
    expect(STATEMENTS).not.toMatch(/grant [^;]*delete[^;]*on table public\.profiles/);
  });
});

describe('migration 0034 — verbs match each table’s policy set', () => {
  test('ratings gets exactly select, insert, update, delete', () => {
    expect(STATEMENTS).toMatch(
      /grant select, insert, update, delete on table public\.ratings to authenticated;/,
    );
  });

  test('pairwise_comparisons gets NO update — comparisons are immutable (0002:55)', () => {
    expect(STATEMENTS).toMatch(
      /grant select, insert, delete on table public\.pairwise_comparisons to authenticated;/,
    );
    expect(STATEMENTS).not.toMatch(
      /grant [^;]*update[^;]*on table public\.pairwise_comparisons/,
    );
  });
});

describe('migration 0034 — blast radius', () => {
  test('grants go to authenticated ONLY, never anon or public', () => {
    const grants = [...STATEMENTS.matchAll(/grant [^;]+;/g)].map((m) => m[0]);
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant).toMatch(/to authenticated;/);
      expect(grant).not.toMatch(/\bto [^;]*\banon\b/);
      expect(grant).not.toMatch(/\bto [^;]*\bpublic\b/);
    }
  });

  test('service_role is never revoked from — the delete route must keep working', () => {
    expect(STATEMENTS).not.toMatch(/revoke[^;]*service_role/);
  });

  test('carries NO DDL: privileges only, so re-running cannot alter shape', () => {
    expect(STATEMENTS).not.toMatch(/create table|alter table|drop table|create policy/);
  });

  test('documents its rollback, per repository convention', () => {
    expect(SQL).toMatch(/Rollback \(in comments, per convention\)/);
    // The rollback must restore 0006's column grant, not just re-open the table.
    expect(SQL).toMatch(/grant update \(display_name, is_private\) on table public\.profiles/);
  });
});

describe('migration 0033 — the fourth table is fixed in place, not here', () => {
  test('vibe_profiles is revoke-first inside its own (unapplied) migration', () => {
    const sql0033 = readFileSync(
      join(process.cwd(), 'supabase/migrations/0033_vibe_profiles.sql'),
      'utf8',
    );
    expect(sql0033).toMatch(
      /revoke all on table public\.vibe_profiles from public, anon, authenticated;/,
    );
    expect(sql0033).toMatch(
      /grant select, insert, update, delete\s*on table public\.vibe_profiles to authenticated;/,
    );
    // And 0034 must NOT also touch it — two files granting the same table is
    // how the applied schema and the migration history start to disagree.
    expect(STATEMENTS).not.toMatch(/public\.vibe_profiles/);
  });
});
