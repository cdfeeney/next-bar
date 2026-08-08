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

import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
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
]);

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

process.stdout.write('\nRED proof holds: every new-capability case fails before the change.\n');
process.exit(0);
