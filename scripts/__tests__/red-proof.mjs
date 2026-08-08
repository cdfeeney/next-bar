#!/usr/bin/env node
/**
 * RED proof for the repository-owned tier classifier (acceptance criterion 12).
 *
 * Runs the SAME adversarial case table as `tier-classify.test.mjs` through the
 * PRE-CHANGE classifier — the harness one at `~/.claude/lib/tier-classify.mjs`
 * that this repository used to depend on — and reports which cases it gets
 * wrong.
 *
 * This exists because "we added tests and they pass" proves nothing on its own.
 * A test that would also have passed before the change is coverage theater. The
 * cases marked `expectLegacyFail` are the ones that encode NEW capability; if
 * any of them passes against the old classifier, this script exits non-zero,
 * because that means the case was not actually testing the new behaviour.
 *
 * Both classifiers are given the SAME project tier map, so this compares the
 * CLASSIFIER, not the map.
 *
 * Usage: npm run tier-redproof
 * Exit:  0 = RED proof holds   1 = a supposedly-new case already passed
 *        3 = the legacy classifier is not available on this machine
 */

import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { TIER_CASES } from './tier-cases.mjs';
import { REPO_ROOT, loadTierMap } from '../lib/tier-classify-core.mjs';

const LEGACY = join(homedir(), '.claude', 'lib', 'tier-classify.mjs');

if (!existsSync(LEGACY)) {
  process.stderr.write(
    `red-proof: the pre-change classifier is not present at ${LEGACY}.\n` +
      'It lives outside the repository (which is the defect this item fixes), so this\n' +
      'proof can only be reproduced on a machine that still has the harness installed.\n',
  );
  process.exit(3);
}

const legacy = await import(pathToFileURL(LEGACY).href);
const { map: PROJECT_MAP } = loadTierMap(REPO_ROOT);

const EMPTY_MAP = {
  version: 1,
  default_tier: 'T1',
  escalate_min_t0_files: 1,
  non_runtime_paths: ['docs/**', '**/*.md', '**/fixtures/**', '**/*.txt'],
  rules: [],
};

/**
 * Cases that encode capability the pre-change classifier did not have, so each
 * MUST fail against it. Kept here rather than as a flag in the case table: the
 * table states required behaviour, this states history.
 *
 * The cases deliberately NOT listed are ones the old path map already got right
 * (a real migration, the tier-map self-edit guard, an ordinary UI file). They
 * are regression guards, and claiming they were "new" would be exactly the
 * coverage theater this proof exists to prevent.
 */
const NEW_CAPABILITY_CASES = new Set([
  'destructive script in an unfamiliar namespace is T0',
  'auth.users delete in a brand-new script is T0',
  'new admin purge route is T0',
  'new CI workflow is T0',
  'release/deploy script is T0',
  'dependency manifest is T0',
  'lockfile is T0',
  'AGENTS.md is T0 despite the .md extension',
  'the classifier itself is T0',
  'the enforcement tests are T0',
  'the RED proof is T0',
  'the changed-paths feeder is T0',
  'capability floor survives a tier map with NO rules at all',
  'new destructive script is T0 even with an empty tier map',
  'unanalyzable runtime file is T0 and escalated',
  'demonstrably inert NEW fixture stays low tier',
  // Round 2 — each found by an independent reviewer and reproduced before fixing.
  'executable under docs/ keeps the runtime baseline',
  'TRUNCATE without the optional TABLE keyword is T0',
  'ORM delete with a table argument is T0',
  'arrow-form DELETE route handler is T0',
  'renamed deploy script is still T0 by mechanism',
  'destructured credential access is T0',
  'bracket credential access is T0',
  'snapshot embedding a credentialed URI is T0',
  'the vitest config is T0',
  'async fs/promises rm is T0',
  'Kysely deleteFrom is T0',
  'destructured non-DATABASE_URL credential is T0',
  // Round 4 — the home-dir classifier never had any of this either.
  'async rm called far below its import is T0',
  'aliased async rm is T0',
  'fs/promises namespace deletion is T0',
  'CJS destructured unlink is T0',
  'fs-extra remove is T0',
  'a deletion function passed as a value is T0',
  'a nested AGENTS.md is T0',
  'a nested CLAUDE.md is T0',
]);

/**
 * The repository revision immediately BEFORE the round-4 fixes.
 *
 * The proof above compares against the home-dir classifier, which is the right
 * baseline for the original port but far too weak a bar for a later round: a
 * case can fail against a classifier from two rounds ago while changing nothing
 * about the one shipped last night. So round 4 is proved against its own
 * immediate predecessor. A fixed historical SHA is stable by construction; if it
 * is unreachable (a shallow clone), the proof reports SKIPPED rather than
 * inventing a pass.
 */
const PRE_ROUND4_REV = 'dcb8f2f';

/** Cases that MUST fail against `PRE_ROUND4_REV` — they encode round-4 capability. */
const ROUND4_CASES = new Set([
  'async rm called far below its import is T0',
  'aliased async rm is T0',
  'fs/promises namespace deletion is T0',
  'CJS destructured unlink is T0',
  'fs-extra remove is T0',
  'a deletion function passed as a value is T0',
  'a nested AGENTS.md is T0',
  'a nested CLAUDE.md is T0',
]);

/** The classifier module graph, so a revision can be materialized and imported. */
const CLASSIFIER_SOURCES = [
  'scripts/lib/tier-glob.mjs',
  'scripts/lib/tier-capabilities.mjs',
  'scripts/lib/tier-classify-core.mjs',
];

const rows = [];
let unexpectedlyPassed = 0;
let legacyWrong = 0;

for (const testCase of TIER_CASES) {
  const result = legacy.classifyPaths([testCase.path], testCase.emptyMap ? EMPTY_MAP : PROJECT_MAP);
  const tierOk = result.tier === testCase.expect;
  const escalationOk =
    !Object.prototype.hasOwnProperty.call(testCase, 'escalated') || result.escalated === testCase.escalated;
  const legacyPasses = tierOk && escalationOk;
  if (!legacyPasses) legacyWrong += 1;
  const isNew = NEW_CAPABILITY_CASES.has(testCase.name);
  if (isNew && legacyPasses) unexpectedlyPassed += 1;
  rows.push({
    verdict: legacyPasses ? 'passes' : 'FAILS',
    expected: testCase.expect,
    got: result.tier,
    newCapability: isNew,
    name: testCase.name,
  });
}

const width = Math.max(...rows.map((r) => r.name.length));
process.stdout.write('\nPRE-CHANGE classifier vs the adversarial case table\n');
process.stdout.write(`  legacy classifier: ${LEGACY}\n`);
process.stdout.write(`  tier map:          ${join(REPO_ROOT, '.claude', 'tier-map.json')}\n\n`);
for (const row of rows) {
  const flag = row.newCapability ? '*' : ' ';
  process.stdout.write(
    `  ${flag} ${row.verdict.padEnd(6)} expected ${row.expected}  got ${row.got}  ${row.name.padEnd(width)}\n`,
  );
}
process.stdout.write(
  `\n  ${legacyWrong}/${rows.length} cases are classified WRONG by the pre-change classifier.\n` +
    '  (* = case encodes new capability and MUST fail before the change)\n',
);

if (unexpectedlyPassed > 0) {
  process.stderr.write(
    `\nred-proof FAILED: ${unexpectedlyPassed} case(s) marked as new capability already ` +
      'passed against the old classifier — those assertions are not testing anything new.\n',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Round-4 proof: against this repository's own immediately-preceding revision.
// ---------------------------------------------------------------------------

/**
 * Materialize the classifier from a git revision into a throwaway directory and
 * import it. Returns null when the revision is not reachable.
 */
function loadClassifierAtRevision(rev) {
  const root = mkdtempSync(join(tmpdir(), 'next-bar-tier-redproof-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    for (const source of CLASSIFIER_SOURCES) {
      const text = execFileSync('git', ['show', `${rev}:${source}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
      });
      writeFileSync(join(root, source.split('/').pop()), text);
    }
    return { root, entry: join(root, 'tier-classify-core.mjs') };
  } catch {
    rmSync(root, { recursive: true, force: true });
    return null;
  }
}

const materialized = loadClassifierAtRevision(PRE_ROUND4_REV);
if (!materialized) {
  process.stdout.write(
    `\nround-4 proof SKIPPED: revision ${PRE_ROUND4_REV} is not reachable ` +
      '(shallow clone?), so the pre-change classifier cannot be materialized.\n',
  );
  process.stdout.write('\nRED proof holds: every new-capability case fails before the change.\n');
  process.exit(0);
}

const previous = await import(pathToFileURL(materialized.entry).href);
let round4Passed = 0;
process.stdout.write(`\nPRE-ROUND-4 classifier (${PRE_ROUND4_REV}) vs the round-4 cases\n\n`);

for (const testCase of TIER_CASES) {
  if (!ROUND4_CASES.has(testCase.name)) continue;
  const contents = Object.prototype.hasOwnProperty.call(testCase, 'contents')
    ? { [testCase.path]: testCase.contents }
    : undefined;
  const result = previous.classifyPaths([testCase.path], testCase.emptyMap ? EMPTY_MAP : PROJECT_MAP, {
    repoRoot: REPO_ROOT,
    contents,
  });
  const passes = result.tier === testCase.expect;
  if (passes) round4Passed += 1;
  process.stdout.write(
    `  ${passes ? 'passes' : 'FAILS '} expected ${testCase.expect}  got ${result.tier}  ${testCase.name}\n`,
  );
}

rmSync(materialized.root, { recursive: true, force: true });

if (round4Passed > 0) {
  process.stderr.write(
    `\nred-proof FAILED: ${round4Passed} round-4 case(s) already passed at ${PRE_ROUND4_REV}. ` +
      'Those assertions do not test the round-4 change.\n',
  );
  process.exit(1);
}

process.stdout.write(
  `\n  ${ROUND4_CASES.size}/${ROUND4_CASES.size} round-4 cases fail at ${PRE_ROUND4_REV}, as required.\n`,
);
process.stdout.write('\nRED proof holds: every new-capability case fails before the change.\n');
process.exit(0);
