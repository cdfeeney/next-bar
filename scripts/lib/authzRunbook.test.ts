import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { checksum } from '../../src/lib/migrationPlan';
import { describe, expect, it } from 'vitest';
import {
  ANON_EXECUTABLE_FUNCTIONS,
  ANON_READABLE_TABLES,
  LEGACY_SCHEMA_FILE,
  TRUE_PREDICATE_POLICIES,
  TRUE_PREDICATE_POLICIES_V01,
  legacySchemaPolicies,
  legacySchemaTables,
  DEFINERS_WITHOUT_AUTH_UID,
  FUNCTIONS_WITHOUT_PUBLIC_REVOKE,
  RUNNER_MANAGED_TABLES,
  anonTableGrants,
  expectedPublicTables,
  functionsDefined,
  functionsWithoutPublicRevoke,
  liveFunctions,
  netColumnPrivileges,
  netTablePrivileges,
  policiesByTable,
  policyLessTables,
  readMigrations,
  tablesCreated,
  tablesRelyingOnDefaultGrants,
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

/**
 * The identifier tokens inside a section's ``` fenced block(s).
 *
 * The runbook lists expected table and function names in fenced blocks; pulling
 * them out lets a test assert set-EQUALITY with the derivation instead of mere
 * containment, which is what catches a name left behind after a migration
 * removed it.
 */
function fencedNames(section: string): string[] {
  // Pair fences by language tag, then keep only the UNTAGGED blocks — those are
  // the plain name lists. Matching bare ``` would start at the closing fence of
  // a ```sql block and swallow the prose that follows it.
  const blocks = [...section.matchAll(/```([a-z]*)\n([\s\S]*?)```/g)]
    .filter((m) => m[1] === '')
    .map((m) => m[2]);
  return [
    ...new Set(
      blocks
        .join(' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => /^[a-z][a-z0-9_]*$/.test(t)),
    ),
  ];
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

  it('lists EXACTLY the expected tables in Check 1 — no missing, no stale', () => {
    // Scoped to the Check 1 section on purpose: a doc-wide search passes even
    // if a name is deleted from this list, because almost every table name also
    // appears in Check 2 or Check 3.
    //
    // Set-EQUALITY, not containment. Containment alone catches a table added by
    // a migration and never documented, but not a table REMOVED by a migration
    // and left in the list — and the operator reads that stale name's absence
    // from the database as "migrations not fully applied", which Check 1's own
    // guidance escalates.
    // Check 1 legitimately lists TWO sets: the 22 a migrations-only database
    // holds, and the 5 extra a v0.1-derived one holds. Assert their union
    // exactly — that binds both lists at once and still fails on a name the
    // migrations no longer create.
    const check1 = checkSection(
      '## Check 1 — RLS is enabled on every table',
      '## Check 1b',
    );
    const schemaSql = readFileSync(LEGACY_SCHEMA_FILE, 'utf8');
    const expected = [
      ...expectedPublicTables(files),
      ...legacySchemaTables(schemaSql, files),
    ].sort();
    expect(fencedNames(check1).sort()).toEqual(expected);
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

    // And lists EXACTLY them in Check 4 itself. An operator comparing the
    // deployed list to this document can only spot an EXTRA definer function if
    // the expected list is complete, and only avoid chasing a phantom if the
    // list carries nothing stale. A doc-wide search would pass with a name
    // deleted, since most also appear in Checks 5 and 6.
    const check4 = checkSection(
      '## Check 4 — `SECURITY DEFINER` functions pin `search_path`',
      '## Check 5',
    );
    expect(fencedNames(check4).sort()).toEqual([...definers].sort());
  });

  it('documents the v0.1 legacy tables and their policy counts', () => {
    // Migration 0000 renames the v0.1 tables instead of dropping them and
    // leaves `waitlist` live, so a Production-lineage database holds five
    // tables and fifteen policies the migrations never create. Without them
    // documented, Checks 1-3 manufacture stop-and-escalate incidents on a
    // healthy Production — the worst defect this artifact can have.
    const schemaSql = readFileSync(LEGACY_SCHEMA_FILE, 'utf8');
    const legacy = legacySchemaTables(schemaSql, files);
    const policies = legacySchemaPolicies(schemaSql, files);
    const legacyTotal = [...policies.values()].reduce((n, names) => n + names.length, 0);
    const freshTables = expectedPublicTables(files).length;
    const freshPolicies = [...policiesByTable(files).values()].flat().length;
    const freshPolicyTables = [...policiesByTable(files).entries()].filter(
      ([, names]) => names.length,
    ).length;

    for (const table of legacy) expect(doc).toContain(table);
    expect(doc).toContain(`holds **${freshTables + legacy.length}**`);
    expect(doc).toContain(
      `**${freshPolicies + legacyTotal} policies across ${freshPolicyTables + policies.size} tables**`,
    );
    for (const [table, names] of policies) {
      expect(doc, `legacy policy count missing for ${table}`).toContain(
        `| \`${table}\` | ${names.length} |`,
      );
    }
    // And the classification that keeps them from being raised as incidents.
    expect(doc).toContain('record-and-confirm, not stop-and-escalate');
  });

  it('binds EVERY row of the headline summary table to the derivation', () => {
    // Round-1 review, corroborated by the Claude and GLM lanes. Only two rows of
    // this table were bound. The rest restate the same counts in a DIFFERENT
    // format from the bound check-section strings — `| Policies | 29, across 13
    // tables |` against `**29 policies across 13 tables**` — so a migration that
    // changed the surface forced the check sections to be regenerated while the
    // summary at the top of the document silently kept the old numbers.
    //
    // That is exactly the drift acceptance criterion 6 exists to prevent, and it
    // is the most-read table in the document: an operator calibrates against the
    // summary before running a single query.
    const byTable = policiesByTable(files);
    const withPolicies = [...byTable.entries()].filter(([, names]) => names.length);
    const policyTotal = withPolicies.reduce((sum, [, names]) => sum + names.length, 0);
    const created = tablesCreated(files);
    const definers = new Set(
      functionsDefined(files).filter((f) => f.isSecurityDefiner).map((f) => f.name),
    );
    const unpinned = functionsDefined(files)
      .filter((f) => f.isSecurityDefiner && !f.pinsSearchPath);
    const anonTables = anonTableGrants(files);
    const defaultGrantTables = tablesRelyingOnDefaultGrants(files);
    const prefixes = files.map((f) => f.prefix).sort();

    for (const row of [
      `| Migrations | ${files.length} files, \`${prefixes[0]}\`..\`${prefixes[prefixes.length - 1]}\` |`,
      `| Tables created by migrations | ${created.length} |`,
      `| Tables created by the migration runner | ${RUNNER_MANAGED_TABLES.length} (\`${RUNNER_MANAGED_TABLES[0]}\`) |`,
      `| **Tables in a healthy \`public\` schema** | **${expectedPublicTables(files).length}** |`,
      `| Policies | ${policyTotal}, across ${withPolicies.length} tables |`,
      `| Tables with RLS and zero policies (default-deny, deliberate) | ${policyLessTables(files).length} |`,
      `| Functions parsed | ${functionsDefined(files).length} |`,
      `| \`SECURITY DEFINER\` functions | ${definers.size} |`,
      `| Definer functions missing a pinned \`search_path\` | **${unpinned.length}** |`,
      `| Functions executable by \`anon\` | ${ANON_EXECUTABLE_FUNCTIONS.length} (\`${ANON_EXECUTABLE_FUNCTIONS[0]}\`, \`${ANON_EXECUTABLE_FUNCTIONS[1]}\`) |`,
      `| Tables relying on Supabase default grants | **${defaultGrantTables.length}** — all ${created.length} are revoke-first |`,
    ]) {
      expect(doc, `summary row drifted from the derivation: ${row}`).toContain(row);
    }

    // The anon-grant row names its tables, so bind the count and both names.
    expect(anonTables).toHaveLength(2);
    expect(doc).toContain(`| Tables granting anything to \`anon\` | ${anonTables.length} (`);
    for (const grant of anonTables) {
      expect(doc).toContain(`\`${grant.table}\``);
    }
  });

  it('binds the revoke-first prose, not just the grant matrix', () => {
    // GLM lane: "all 21 migration-created tables are revoke-first" was pure
    // prose. A table added WITHOUT the revoke-first pattern would leave the
    // per-table matrix passing while this sentence became false — and the
    // sentence is the one an operator actually reads before deciding the grant
    // surface is safe. Bind it to the same derivation the row above uses.
    const created = tablesCreated(files).length;
    expect(tablesRelyingOnDefaultGrants(files)).toEqual([]);
    expect(doc).toContain(`the ${created} migration-created tables is *revoke-first*`);
  });

  it('binds the NARRATIVE counts too, not only the summary table', () => {
    // Round-2 review, GLM lane: binding the table alone still lets prose
    // elsewhere in the document state a contradicting number. An operator reads
    // whichever sentence they reach first, so a document that disagrees with
    // itself is worse than one that is merely stale.
    const migrations = files.length;
    const healthy = expectedPublicTables(files).length;
    const anonTables = anonTableGrants(files).length;

    expect(doc).toContain(`derived from all ${migrations} local migrations`);
    expect(doc).toContain(`database with all ${migrations} applied`);
    expect(doc).toContain(`privileges on all ${healthy} tables on a healthy database`);
    expect(doc).toContain(`**\`anon\` appears exactly ${anonTables} times in that table`);
  });

  it('gives Check 7 a real local-checksum command and warns off raw hashes', () => {
    // Claude lane. Check 7 classifies "checksums differ" as stop-and-escalate
    // but gave the operator no way to compute the local side. The ledger hashes
    // CRLF-normalised, trailing-whitespace-stripped content, so a raw sha256sum
    // on this Windows/autocrlf checkout mismatches EVERY file — the runbook's
    // own rule then manufactures a mass-tampering incident on a healthy database.
    const check7 = checkSection('## Check 7 — Migration ledger parity', '## After the run');
    expect(check7).toContain('npx tsx scripts/migration-checksums.mts');
    expect(check7).toContain('Do not use `sha256sum`');
    expect(check7).toContain('core.autocrlf');

    // The command must actually exist, or the instruction is worse than none.
    expect(
      existsSync(path.resolve(process.cwd(), 'scripts', 'migration-checksums.mts')),
    ).toBe(true);

    // And it must hash what the ledger hashes.
    const sample = 'select 1;\r\n\r\n';
    expect(checksum(sample)).toBe(
      createHash('sha256').update('select 1;', 'utf8').digest('hex'),
    );
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
    expect(fencedNames(check5).sort()).toEqual([...derived].sort());
    expect(check5).toContain(`**${derived.length} functions** in this corpus have no`);
  });

  it('filters trigger functions out of the Check 5 query', () => {
    // Without this clause the check returns ~10 rows against an expectation of
    // 2 and demands stop-and-escalate on every extra one, on a healthy
    // database: the 8 unrevoked functions show a PUBLIC row, and Supabase's
    // default privileges add anon rows too. The filter is what makes
    // "exactly 2" true rather than aspirational — so it is asserted, not
    // trusted to survive the next edit.
    const check5 = checkSection(
      '## Check 5 — Anonymous entry points',
      '## Check 6',
    );
    expect(check5).toContain(`p.prorettype <> 'trigger'::regtype`);
    expect(check5).toContain('**Expected:** exactly 2 rows, both `anon`');
  });

  it('sends the operator to the LEDGER check for unapplied migrations', () => {
    // Check 6 is definer bodies; ledger parity is Check 7. A 2am operator
    // chasing a missing table must not be routed to the wrong procedure.
    const check1 = checkSection(
      '## Check 1 — RLS is enabled on every table',
      '## Check 1b',
    );
    expect(check1).toContain('**Check 7** (ledger parity)');
    expect(check1).not.toMatch(/Compare against Check 6/);
  });

  it('tells the operator to compare policy NAMES, not just counts', () => {
    // A policy dropped and replaced by a differently-named one leaves the count
    // unchanged and would otherwise pass in silence.
    const check2 = checkSection(
      '## Check 2 — Policies exist where they are relied upon',
      '### Check 2b',
    );
    expect(check2).toContain('Compare the NAMES, not only the counts');
    expect(check2).toContain('name mismatch with a matching count is stop-and-escalate');
  });

  it('warns that Check 3 must run as a role that can see the grants', () => {
    // role_table_grants shows only rows whose grantor/grantee the current user
    // is a member of; the read-only role the runbook suggests sees nothing, and
    // an empty result read through the "missing grant" rule invents 15 bugs.
    const check3 = checkSection(
      '## Check 3 — Grants match the design',
      '### Check 3b',
    );
    expect(check3).toContain('Run this as the table owner');
    expect(check3).toContain('empty result');
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

  it('denies a passing ledger check any evidentiary weight', () => {
    // Two reviewers disagreed on ordering: run-first avoids crying wolf on a
    // behind-but-healthy database, but the ledger lives INSIDE the database an
    // attacker would control, so a pass proves nothing. Keeping the ordering
    // and denying the pass evidentiary weight serves both.
    expect(doc).toContain('carries no evidentiary weight');
    expect(doc).toContain('signature of a *forged ledger*');
  });

  it('checks role MEMBERSHIP, not only role attributes', () => {
    // `grant service_role to anon` leaves anon's own rolbypassrls false while
    // giving it everything service_role has — invisible to an attribute check.
    const check1b = checkSection(
      '## Check 1b — No unexpected role can bypass RLS',
      '## Check 2 —',
    );
    expect(check1b).toContain('pg_auth_members');
    expect(check1b).toContain('role MEMBERSHIP');
  });

  it('gives mechanical policy red flags, not only "compare the meaning"', () => {
    // Eyeballing predicates at 2am is the weakest link; these three checks do
    // not depend on the operator's judgement.
    const check2b = checkSection('### Check 2b — policy EXPRESSIONS', '---');
    expect(check2b).toContain('not named in the expected\n   predicate');
    expect(check2b).toContain('auth.uid() is not null');
    // ...and names the legitimate literal-true exceptions, or the rule fires on
    // every healthy run: the public bar catalog IS `using (true)`.
    expect(check2b).toContain('EXCEPT where that literal is');
    for (const p of TRUE_PREDICATE_POLICIES) expect(check2b).toContain(p);
    for (const p of TRUE_PREDICATE_POLICIES_V01) expect(check2b).toContain(p);
    expect(check2b).toContain('`with_check` that is NULL');
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
