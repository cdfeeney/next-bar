import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANON_EXECUTABLE_FUNCTIONS,
  ANON_READABLE_TABLES,
  DEFINERS_WITHOUT_AUTH_UID,
  FUNCTIONS_WITHOUT_PUBLIC_REVOKE,
  expectedPublicTables,
  functionsDefined,
  functionsWithoutPublicRevoke,
  liveFunctions,
  netColumnPrivileges,
  netTablePrivileges,
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

/**
 * Find the Check 3 matrix row for a table and return its three role cells.
 *
 * The matrix is `| \`table\` | anon | authenticated | service_role |`. Parsing
 * it — rather than substring-matching a rendered row — is what lets the test
 * catch a cell that claims a privilege the derivation does not, which is the
 * defect that shipped.
 */
function checkSection(heading: string, nextHeading: string): string {
  const from = doc.indexOf(heading);
  if (from === -1) throw new Error(`runbook is missing section: ${heading}`);
  const to = doc.indexOf(nextHeading, from + heading.length);
  return doc.slice(from, to === -1 ? undefined : to);
}

/** Only the Check 3 grant matrix — other checks also have per-table tables. */
const CHECK3 = checkSection(
  '## Check 3 — Grants match the design',
  '### Check 3b',
);

function docRow(table: string): { cells: string[] } | null {
  const line = CHECK3
    .split('\n')
    .find((l) => l.trimStart().startsWith(`| \`${table}\` |`));
  if (!line) return null;
  const cells = line
    .split('|')
    .slice(2, 4)
    .map((c) => c.trim().replace(/\*\*/g, ''));
  return { cells };
}

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

  it('names every expected table in Check 1 ITSELF', () => {
    // The check an operator actually runs lists table names; a table added by
    // a migration and never added here is a table they will not notice is
    // missing from the database either.
    //
    // Scoped to the Check 1 section on purpose: a doc-wide search passes even
    // if a name is deleted from this list, because almost every table name also
    // appears in Check 2 or Check 3.
    const check1 = checkSection(
      '## Check 1 — RLS is enabled on every table',
      '## Check 1b',
    );
    for (const table of expectedPublicTables(files)) {
      expect(check1, `Check 1 does not list ${table}`).toContain(table);
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

    // And names every one of them, IN CHECK 4 ITSELF: an operator comparing the
    // deployed list to this document can only spot an EXTRA definer function if
    // the expected list is complete. A doc-wide search would pass with a name
    // deleted from the list, since most also appear in Checks 5 and 6.
    const check4 = checkSection(
      '## Check 4 — `SECURITY DEFINER` functions pin `search_path`',
      '## Check 5',
    );
    for (const name of definers) {
      expect(check4, `Check 4 does not list ${name}`).toContain(name);
    }
  });

  it('names the functions expected to carry a PUBLIC execute grant', () => {
    // Postgres grants EXECUTE to PUBLIC by default. Eight trigger functions
    // here were never revoked from it, so a healthy database shows eight PUBLIC
    // rows. Claiming "any PUBLIC row is a finding" would cry wolf eight times
    // on every run of the check whose entire job is spotting anonymous entry
    // points.
    const derived = functionsWithoutPublicRevoke(files);
    expect(derived).toEqual([...FUNCTIONS_WITHOUT_PUBLIC_REVOKE].sort());
    const check5 = checkSection(
      '## Check 5 — Anonymous entry points',
      '## Check 6',
    );
    for (const name of derived) {
      expect(check5, `Check 5 does not list ${name}`).toContain(name);
    }
  });

  it('does not readmit pending_change_count as an ungated definer', () => {
    // 0021 dropped the ungated 0020 version and recreated it gated on
    // auth.uid(). Listing it as a reviewed exception would licence a rollback
    // to the exact defect 0021 fixed.
    expect(DEFINERS_WITHOUT_AUTH_UID).not.toContain('pending_change_count');
    expect(doc).toContain('`pending_change_count` is **not** on this list');
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
      `**Expected:** exactly ${ANON_EXECUTABLE_FUNCTIONS.length} rows, both \`anon\``,
    );
  });

  it('binds the Check 3 grant matrix to the derivation, row by row', () => {
    // This binding did not exist, and its absence let a hand-transcribed row
    // ship: the doc claimed `bar_rsvps | — | delete | —` when 0014 revoked that
    // grant, so a healthy database produced a false mismatch AND a database
    // missing 0014 passed silently. The matrix is the largest transcribed table
    // in the document; it needs the tightest binding.
    const net = netTablePrivileges(files);
    expect(net.size).toBeGreaterThan(10);

    // The matrix covers the two CLIENT roles only. `service_role` is excluded
    // by design: Supabase grants it everything on `public` by default and the
    // migrations revoke only from public/anon/authenticated, so a healthy
    // database shows service_role on all 22 tables. Listing "—" for it would
    // falsify the matrix on every correct deployment.
    const ROLE_ORDER = ['anon', 'authenticated'];
    for (const [table, byRole] of net) {
      const cells = ROLE_ORDER.map((role) => {
        const privs = byRole.get(role);
        if (!privs) return '—';
        // The doc writes privileges in SQL verb order, not alphabetical.
        return [...privs].sort().join('|');
      });
      // Assert the row exists and its non-empty cells name exactly the derived
      // privileges — order-insensitively, so prose formatting stays free.
      const row = docRow(table);
      expect(row, `Check 3 has no row for ${table}`).toBeTruthy();
      ROLE_ORDER.forEach((role, i) => {
        const privs = byRole.get(role);
        const cell = row!.cells[i] ?? '';
        if (!privs) {
          expect(
            cell.replace(/[\s—-]/g, ''),
            `${table}/${role} should be empty in the doc`,
          ).toBe('');
        } else {
          for (const p of privs) {
            expect(cell, `${table}/${role} missing ${p}`).toContain(p);
          }
          const claimed = cell.split(',').map((c) => c.trim()).filter(Boolean).length;
          expect(claimed, `${table}/${role} lists extra privileges`).toBe(privs.length);
        }
      });
      void cells;
    }
  });

  it('lists every table with NO net grant, and puts none of them in the matrix', () => {
    // The other direction: a table that grants nothing must be named in the
    // grants-nothing sentence and must NOT appear as a matrix row, or the
    // operator expects a row their query will never return.
    const net = netTablePrivileges(files);
    const noGrant = expectedPublicTables(files).filter((t) => !net.has(t)).sort();
    expect(noGrant).toContain('bar_rsvps');
    for (const table of noGrant) {
      expect(doc).toContain(`\`${table}\``);
      expect(docRow(table), `${table} grants nothing but has a Check 3 row`).toBeFalsy();
    }
  });

  it('sends column-scoped grants to role_column_grants, not role_table_grants', () => {
    // profiles' UPDATE is column-scoped, so `role_table_grants` cannot return
    // it. Promising it in Check 3 guarantees a false mismatch on every healthy
    // database.
    const cols = netColumnPrivileges(files);
    const profileCols = cols.get('profiles')?.get('authenticated') ?? [];
    expect(profileCols).toEqual(['display_name', 'is_private', 'shares_list_publicly']);
    expect(doc).toContain('role_column_grants');
    for (const column of profileCols) expect(doc).toContain(column);
    // And the table-level row must NOT claim update.
    const row = docRow('profiles');
    expect(row?.cells[1]).not.toContain('update');
  });

  it('names the definer functions that legitimately lack an auth.uid() gate', () => {
    // liveFunctions, not functionsDefined: the deployed database holds the LAST
    // definition, and reading every definition ever written reports a dropped
    // predecessor's properties as current.
    const derived = [
      ...new Set(
        liveFunctions(files)
          .filter((f) => f.isSecurityDefiner && !f.usesAuthUid)
          .map((f) => f.name),
      ),
    ].sort();
    expect(derived).toEqual([...DEFINERS_WITHOUT_AUTH_UID].sort());
    for (const name of derived) expect(doc).toContain(`\`${name}\``);

    // The doc states the split as a ratio; bind it so a new exception cannot
    // be added to the table without the headline number moving with it.
    const liveDefiners = new Set(
      liveFunctions(files).filter((f) => f.isSecurityDefiner).map((f) => f.name),
    );
    const gated = liveDefiners.size - derived.length;
    expect(doc).toContain(`**${gated} of the ${liveDefiners.size} definer functions reference`);
  });

  it('tells the operator to run the ledger check before the others', () => {
    // Without this, a legitimately-behind Staging reports every not-yet-applied
    // migration's tables and policies as drift.
    expect(doc).toContain('Run Check 7 (ledger parity) FIRST');
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
