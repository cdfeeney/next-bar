import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANON_EXECUTABLE_FUNCTIONS,
  ANON_READABLE_TABLES,
  expectedPublicTables,
  functionsDefined,
  policiesByTable,
  policyLessTables,
  readMigrations,
} from './authzSurface';

/**
 * Keep `docs/SUPABASE-AUTHZ-VERIFICATION-RUNBOOK.md` from drifting away from
 * the migrations it tells an operator to verify against.
 *
 * Acceptance criterion 6 of the mission: "the runbook's expected-state tables
 * are generated from or cross-checked against the migrations, so it cannot
 * silently drift from the schema." This file is the cross-check. It fails when
 * a migration changes the derived surface and nobody regenerated the document
 * — which is the exact failure that made the first version of the runbook
 * wrong about eight tables.
 *
 * These assertions are deliberately about the load-bearing NUMBERS and NAMES,
 * not about prose. A doc test that pins wording just gets deleted the first
 * time someone edits a sentence.
 *
 * Read-only and offline: it reads two local files.
 */

const RUNBOOK = path.resolve(
  process.cwd(),
  'docs',
  'SUPABASE-AUTHZ-VERIFICATION-RUNBOOK.md',
);

const doc = readFileSync(RUNBOOK, 'utf8');
const files = readMigrations();

describe('runbook / migration cross-check', () => {
  it('reads the runbook at all', () => {
    // Non-vacuity: every `toContain` below passes trivially against an empty
    // string only if this fails first.
    expect(doc.length).toBeGreaterThan(2000);
    expect(doc).toContain('## Check 1 — RLS is enabled on every table');
  });

  it('states the ATTENDED-authorization and Staging-first banner', () => {
    // Acceptance criterion 3. This is prose, but it is the one piece of prose
    // whose removal changes what the document authorizes.
    expect(doc).toContain('REQUIRES SEPARATE ATTENDED AUTHORIZATION');
    expect(doc).toContain('**Staging first, Production second, never in parallel.**');
  });

  it('states the derived table count', () => {
    const expected = expectedPublicTables(files).length;
    expect(expected).toBe(22);
    expect(doc).toContain(`**${expected}**`);
    expect(doc).toContain(`Tables with RLS enabled | ${expected} of ${expected}`);
    expect(doc).toContain(`**Expected:** **${expected} rows**`);
  });

  it('names every expected table in Check 1', () => {
    // The check an operator actually runs lists table names; a table added by
    // a migration and never added here is a table they will not notice is
    // missing from the database either.
    for (const table of expectedPublicTables(files)) {
      expect(doc).toContain(table);
    }
  });

  it('states the derived policy counts', () => {
    const byTable = policiesByTable(files);
    const withPolicies = [...byTable.entries()].filter(([, names]) => names.length);
    const total = withPolicies.reduce((sum, [, names]) => sum + names.length, 0);
    expect(total).toBe(29);
    expect(withPolicies).toHaveLength(13);
    expect(doc).toContain(`**${total} policies across ${withPolicies.length} tables**`);

    // Every table with policies appears in the Check 2 table with its count.
    for (const [table, names] of withPolicies) {
      expect(doc).toContain(`| \`${table}\` | ${names.length} |`);
    }
  });

  it('lists every policy-less table, and only those', () => {
    const policyLess = policyLessTables(files);
    expect(doc).toContain(`**These ${policyLess.length} tables must have ZERO policies.**`);
    for (const table of policyLess) {
      expect(doc).toContain(`| \`${table}\` |`);
    }
    // A table that HAS policies must not be described as policy-less.
    const withPolicies = [...policiesByTable(files).entries()]
      .filter(([, names]) => names.length)
      .map(([table]) => table);
    for (const table of withPolicies) {
      expect(policyLess).not.toContain(table);
    }
  });

  it('states the derived definer-function count', () => {
    const definers = new Set(
      functionsDefined(files).filter((f) => f.isSecurityDefiner).map((f) => f.name),
    );
    expect(definers.size).toBe(29);
    expect(doc).toContain(`**Expected:** ${definers.size} distinct definer function names`);

    // And names every one of them: an operator comparing the deployed list to
    // this document can only spot an EXTRA definer function if the expected
    // list is complete. The count alone would not catch a swap.
    for (const name of definers) {
      expect(doc).toContain(name);
    }
  });

  it('names exactly the anon-readable tables and anon-executable functions', () => {
    for (const table of ANON_READABLE_TABLES) {
      expect(doc).toContain(`\`${table}\``);
    }
    for (const fn of ANON_EXECUTABLE_FUNCTIONS) {
      expect(doc).toContain(`\`${fn}\``);
    }
    expect(doc).toContain(
      `**\`anon\` appears exactly ${ANON_READABLE_TABLES.length} times`,
    );
    expect(doc).toContain(
      `**Expected:** exactly ${ANON_EXECUTABLE_FUNCTIONS.length} functions`,
    );
  });

  it('states the migration count used by the ledger check', () => {
    expect(files).toHaveLength(39);
    expect(doc).toContain(`**Compare against** the ${files.length} local files`);
  });

  it('carries no credential-shaped material', () => {
    // The mission forbids connection strings, project refs and keys in this
    // document. Env-var NAMES are fine and deliberately used instead.
    expect(doc).not.toMatch(/postgres(?:ql)?:\/\/[^\s`]*:[^\s`]*@/i);
    expect(doc).not.toMatch(/\beyJ[A-Za-z0-9_-]{20,}/); // JWT
    expect(doc).not.toMatch(/\bsb[ps]_[A-Za-z0-9]{20,}/); // Supabase key prefixes
    expect(doc).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/i); // project ref
  });
});
