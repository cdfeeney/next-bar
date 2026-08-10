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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
 * Per-round proofs against each round's OWN immediate predecessor.
 *
 * The proof above compares against the home-dir classifier, which is the right
 * baseline for the original port but far too weak a bar for a later round: a
 * case can fail against a classifier from two rounds ago while changing nothing
 * about the one shipped last night. So every round names the revision it must
 * beat. Fixed historical SHAs are stable by construction; if one is unreachable
 * (a shallow clone), that stage reports SKIPPED rather than inventing a pass.
 */
const ROUND_PROOFS = [
  {
    label: 'round-4',
    rev: 'dcb8f2f',
    cases: new Set([
      'async rm called far below its import is T0',
      'aliased async rm is T0',
      'fs/promises namespace deletion is T0',
      'CJS destructured unlink is T0',
      'fs-extra remove is T0',
      'a deletion function passed as a value is T0',
      'a nested AGENTS.md is T0',
      'a nested CLAUDE.md is T0',
    ]),
  },
  {
    label: 'round-5',
    rev: 'cb764e6',
    cases: new Set([
      'PowerShell recursive delete is T0',
      'Python shutil.rmtree is T0',
      'Ruby FileUtils.rm_rf is T0',
      'separated shell recursive-force flags are T0',
      'Windows rd /s /q is T0',
      'a namespace deletion member assigned to a variable is T0',
      'a type-only deletion import is NOT capability',
    ]),
  },
  {
    label: 'round-6',
    rev: 'ee75d4d',
    cases: new Set([
      'PowerShell Remove-Item without flags is T0',
      'Python pathlib unlink is T0',
      'Ruby File.unlink is T0',
      'git rm --cached does not delete the working tree',
    ]),
  },
  {
    label: 'round-7',
    rev: 'a830823',
    cases: new Set([
      'lowercase remove-item is T0',
      'the ri alias with a variable is T0',
      'rm -f without -r is T0',
      'double-spaced git rm is still excluded',
      'capitalised Git rm is still excluded',
      'an unlink on a graph is not a filesystem delete',
      'an unreadable version among readable ones fails closed',
    ]),
  },
  {
    label: 'round-14',
    rev: '97e9db7',
    cases: new Set([
      'a nested destructure off require is capability',
      'an object-literal default does not hide a later binding',
      'a computed string key is still an imported name',
      'a spread rest binds the remaining namespace',
      'export star as is a re-export barrel',
      'a CJS property barrel is capability',
      'Object.assign with an intermediate argument is still a barrel',
      'a parenthesized namespace is still the whole right-hand side',
      'a local variable named exports is not a CJS barrel',
      'a namespace guarded by an operator is not the destructured value',
      'a clause is not bound to an unrelated later import',
    ]),
  },
  {
    label: 'round-13',
    rev: '3d4ddc5',
    cases: new Set([
      'an Object.assign CJS barrel is capability',
      'a multiline destructure from a computed import is capability',
      'a default initializer does not hide the imported name',
      'a parenthesized namespace destructure is capability',
      'a trailing comment does not hide a namespace destructure',
      'a second declarator does not hide a namespace destructure',
      'a namespace destructure through promises is capability',
      'an exports property on another object is not a CJS barrel',
    ]),
  },
  {
    label: 'round-12',
    rev: 'fd7b9cf',
    cases: new Set([
      'a CJS re-export barrel of an fs module is capability',
      'an aliased destructure from a computed import is capability',
      'destructuring a deletion function off a namespace is capability',
    ]),
  },
  {
    label: 'round-11',
    rev: 'd779e63',
    cases: new Set([
      'a barrel re-exporting all of fs/promises is capability',
      'a then-continuation written as a function expression is capability',
      'a spawn wrapper taking the command in an array is a deletion',
      'a wrapper that hands a command to a helper still floors',
      'a dynamic specifier beside a mere mention of a deletion word is not capability',
      'a component rendering a shell command over-escalates to T0',
      'help copy quoting a Windows delete over-escalates to T0',
    ]),
  },
  {
    label: 'round-10',
    rev: 'd631d2f',
    // The two shell-context cases that were in this set are gone: round 11
    // REVERSED them when the context gate was removed as a fail-open, so they no
    // longer describe a round-10 improvement. They are proved by the round-11
    // stage above instead.
    cases: new Set([
      'assignment-form require binds a deletion namespace',
      'an optional dependency loaded in try/catch is still capability',
      'a conditionally required module is still capability',
      'a parenthesized await import binds a deletion namespace',
      'destructuring assignment without a keyword is still capability',
      'a then-continuation on a dynamic import is capability',
      'a dynamic module specifier fails closed',
      'argv-form spawn of rm is a deletion',
      'a Cursor rules file is agent policy',
      'a Copilot instructions file is agent policy',
    ]),
  },
  {
    label: 'round-9',
    rev: '5c8355a',
    cases: new Set([
      'a regex literal does not hide a deletion import',
      'rm with a bare filename is T0',
      'invoking a cmdlet resolved by Get-Command is T0',
      'the del alias with a variable is T0',
      'a CSS selector named remove-item is not a deletion',
      'a commented-out deletion import over-escalates to T0',
      'naming a cmdlet over-escalates rather than suppressing an invocation',
    ]),
  },
  {
    label: 'round-8',
    rev: 'a17e99a',
    cases: new Set([
      'a destructive rm after a line ending in git is T0',
      'Remove-Item after a comment mentioning Get-Command is T0',
      'a bare rm with a path argument is T0',
      'remove-item inside an HTML attribute is not a deletion',
    ]),
  },
];

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
// Per-round proofs: each against this repository's own preceding revision.
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

let stagesProved = 0;
/**
 * Stages that could not run. A SKIPPED stage used to `continue` and the script
 * still exited 0 printing "RED proof holds" — so on a shallow clone, where NO
 * predecessor revision is reachable, a run that proved nothing at all reported
 * success. That is the coverage theater this file exists to prevent, one level
 * up. Skips are collected and the exit status accounts for them.
 */
const skippedStages = [];
for (const stage of ROUND_PROOFS) {
  const materialized = loadClassifierAtRevision(stage.rev);
  if (!materialized) {
    process.stdout.write(
      `\n${stage.label} proof SKIPPED: revision ${stage.rev} is not reachable ` +
        '(shallow clone?), so that classifier cannot be materialized.\n',
    );
    skippedStages.push(`${stage.label} (${stage.rev})`);
    continue;
  }

  const previous = await import(pathToFileURL(materialized.entry).href);
  let alreadyPassing = 0;
  process.stdout.write(`\nPRE-${stage.label.toUpperCase()} classifier (${stage.rev}) vs its cases\n\n`);

  for (const testCase of TIER_CASES) {
    if (!stage.cases.has(testCase.name)) continue;
    const contents = Object.prototype.hasOwnProperty.call(testCase, 'contents')
      ? { [testCase.path]: testCase.contents }
      : undefined;
    const result = previous.classifyPaths([testCase.path], testCase.emptyMap ? EMPTY_MAP : PROJECT_MAP, {
      repoRoot: REPO_ROOT,
      contents,
    });
    const passes = result.tier === testCase.expect;
    if (passes) alreadyPassing += 1;
    process.stdout.write(
      `  ${passes ? 'passes' : 'FAILS '} expected ${testCase.expect}  got ${result.tier}  ${testCase.name}\n`,
    );
  }

  rmSync(materialized.root, { recursive: true, force: true });

  if (alreadyPassing > 0) {
    process.stderr.write(
      `\nred-proof FAILED: ${alreadyPassing} ${stage.label} case(s) already passed at ${stage.rev}. ` +
        'Those assertions do not test that round.\n',
    );
    process.exit(1);
  }
  process.stdout.write(
    `\n  ${stage.cases.size}/${stage.cases.size} ${stage.label} cases fail at ${stage.rev}, as required.\n`,
  );
  stagesProved += 1;
}

// ---------------------------------------------------------------------------
// Deletion grading: an INTEGRATION proof, because the case table cannot express
// a deleted path.
//
// A reviewer pointed out that the round-4 proof covered only the capability
// analyzer, so the OTHER half of that change — deletions graded from git
// evidence instead of failing closed — had no fails-before/passes-after
// evidence at all. This drives the real pipeline (collect -> recover ->
// classify) over a throwaway repository at the pre-change revision and at the
// current one, and requires them to disagree.
// ---------------------------------------------------------------------------

const DELETION_PROOF_REV = 'dcb8f2f';

function buildDeletionFixture() {
  const root = mkdtempSync(join(tmpdir(), 'next-bar-tier-delproof-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  mkdirSync(join(root, 'src', 'components'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}\n');
  writeFileSync(join(root, 'src', 'components', 'OldCard.tsx'), 'export const OldCard = () => null;\n');
  git('init', '-q', '.');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  git('add', '-A');
  git('commit', '-qm', 'base');
  rmSync(join(root, 'src', 'components', 'OldCard.tsx'));
  return root;
}

const fixture = buildDeletionFixture();
const currentCore = await import(pathToFileURL(join(REPO_ROOT, 'scripts/lib/tier-classify-core.mjs')).href);
const currentPaths = await import(pathToFileURL(join(REPO_ROOT, 'scripts/lib/changed-paths-core.mjs')).href);

const deletedPath = 'src/components/OldCard.tsx';
const collected = currentPaths.collectChangedPaths({ repoRoot: fixture });
const recovered = currentPaths.recoverDeletedContents(collected.deleted, {
  repoRoot: fixture,
  revisions: currentPaths.resolveRecoveryRevisions({ repoRoot: fixture }),
});
const nowResult = currentCore.classifyPaths([deletedPath], EMPTY_MAP, {
  repoRoot: fixture,
  contents: recovered.contents,
  deletedPaths: collected.deleted,
});

const oldMaterialized = loadClassifierAtRevision(DELETION_PROOF_REV);
let deletionProofVerdict = 'SKIPPED';
if (oldMaterialized) {
  const oldCore = await import(pathToFileURL(oldMaterialized.entry).href);
  // The old classifier has no notion of a deleted path: it reads the working
  // tree, finds nothing, and fails closed.
  const beforeResult = oldCore.classifyPaths([deletedPath], EMPTY_MAP, { repoRoot: fixture });
  rmSync(oldMaterialized.root, { recursive: true, force: true });
  process.stdout.write(
    `\nDeletion grading, real pipeline over a throwaway repository\n\n` +
      `  before (${DELETION_PROOF_REV}): tier ${beforeResult.tier}  ambiguous ${beforeResult.ambiguousCount}  escalated ${beforeResult.escalated}\n` +
      `  after  (working tree): tier ${nowResult.tier}  ambiguous ${nowResult.ambiguousCount}  escalated ${nowResult.escalated}\n`,
  );
  const improved =
    beforeResult.tier === 'T0' &&
    beforeResult.ambiguousCount === 1 &&
    nowResult.tier === 'T1' &&
    nowResult.ambiguousCount === 0;
  if (!improved) {
    rmSync(fixture, { recursive: true, force: true });
    process.stderr.write(
      '\nred-proof FAILED: deleting an ordinary component must be an ambiguous T0 before the ' +
        'change and a non-ambiguous T1 after it. It is not, so the deletion-grading fix is ' +
        'either absent or untested.\n',
    );
    process.exit(1);
  }
  deletionProofVerdict = 'holds';
  stagesProved += 1;
}
rmSync(fixture, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// ROUND-10 PIPELINE PROOF. Two behaviours are about what a CHANGE did, not what
// one file contains, so neither can be expressed as a case-table entry and
// neither is covered by the staged proofs above. They are proved the same way:
// run the real CLI from the pre-change revision against a throwaway repository,
// then the current one, and require them to disagree.
// ---------------------------------------------------------------------------

const PIPELINE_PROOF_REV = 'd631d2f';
const CLI_SOURCES = [
  'scripts/tier-classify.mjs',
  'scripts/lib/tier-classify-core.mjs',
  'scripts/lib/tier-capabilities.mjs',
  'scripts/lib/tier-glob.mjs',
  'scripts/lib/changed-paths-core.mjs',
];
const PURGE_SOURCE = "import { rm } from 'node:fs/promises';\nexport const purge = (d) => rm(d, { recursive: true });\n";

/** A throwaway repo holding the classifier CLI as it stood at `rev`. */
function materializeCli(rev, root) {
  try {
    for (const source of CLI_SOURCES) {
      const text =
        rev === null
          ? readFileSync(join(REPO_ROOT, source), 'utf8')
          : execFileSync('git', ['show', `${rev}:${source}`], {
              cwd: REPO_ROOT,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'pipe'],
              maxBuffer: 16 * 1024 * 1024,
            });
      mkdirSync(join(root, source.slice(0, source.lastIndexOf('/'))), { recursive: true });
      writeFileSync(join(root, source), text);
    }
    return true;
  } catch {
    return false;
  }
}

function runCli(root, args, stdin = '') {
  return JSON.parse(
    execFileSync('node', ['scripts/tier-classify.mjs', ...args, '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      input: stdin,
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
}

/** Build the fixture repo; the classifier itself is written in per revision. */
function buildPipelineFixture() {
  const root = mkdtempSync(join(tmpdir(), 'next-bar-tier-pipeproof-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  // Only what this stage actually queries. `src/lib/purge.ts` and an empty
  // `src/components` used to live here for the new-import escalation half of
  // the proof; that rule was removed, and a fixture no stage reads invites the
  // next contributor to assume it is part of what the proof exercises.
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"redproof"}\n');
  writeFileSync(join(root, 'scripts', 'recreate.mjs'), PURGE_SOURCE);
  git('init', '-q', '-b', 'main', '.');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('checkout', '-q', '-b', 'feature');
  // (a) delete a dangerous script and re-create the path with benign content
  git('rm', '-q', 'scripts/recreate.mjs');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'recreate.mjs'), 'export const noop = () => {};\n');
  return root;
}

/**
 * The two answers this proof compares, from one fixture and one CLI.
 *
 * Only the deleted-then-recreated path is exercised now. The new-import
 * escalation this proof also covered was REMOVED: it made the tier depend on
 * history rather than content, and a brand-new committed file was compared
 * against itself and never escalated.
 */
function pipelineAnswers(root) {
  const piped = runCli(root, ['--base', 'main'], 'scripts/recreate.mjs\n');
  const changed = runCli(root, ['--changed', '--base', 'main']);
  const tierIn = (result, path) => result.perPath.find((e) => e.path === path)?.tier ?? '(absent)';
  return {
    stdinRecreated: tierIn(piped, 'scripts/recreate.mjs'),
    changedRecreated: tierIn(changed, 'scripts/recreate.mjs'),
  };
}

let pipelineProofVerdict = 'SKIPPED';
const beforeRoot = buildPipelineFixture();
const afterRoot = buildPipelineFixture();
try {
  if (materializeCli(PIPELINE_PROOF_REV, beforeRoot) && materializeCli(null, afterRoot)) {
    const before = pipelineAnswers(beforeRoot);
    const after = pipelineAnswers(afterRoot);
    process.stdout.write(
      `\nRound-10 pipeline proof, real CLI over a throwaway repository\n\n` +
        `  deleted-then-recreated via stdin   before (${PIPELINE_PROOF_REV}): ${before.stdinRecreated}` +
        `   after: ${after.stdinRecreated}   (--changed says ${after.changedRecreated})\n`,
    );
    const improved =
      before.stdinRecreated === 'T1' &&
      before.changedRecreated === 'T0' &&
      after.stdinRecreated === 'T0' &&
      after.changedRecreated === 'T0';
    if (!improved) {
      process.stderr.write(
        '\nred-proof FAILED: before this round stdin must under-grade a deleted-then-recreated path ' +
          'that --changed grades T0, and after it both entry points must agree. They do not, so ' +
          'that fix is either absent or untested.\n',
      );
      process.exit(1);
    }
    pipelineProofVerdict = 'holds';
    stagesProved += 1;
  }
} finally {
  rmSync(beforeRoot, { recursive: true, force: true });
  rmSync(afterRoot, { recursive: true, force: true });
}

process.stdout.write(
  `\n  deletion-grading proof: ${deletionProofVerdict}\n` +
    `  round-10 pipeline proof: ${pipelineProofVerdict}\n`,
);

// A skipped stage is an UNKNOWN, not a pass. Reporting "RED proof holds" while
// stages were silently skipped is exactly the shape of coverage theater this
// script exists to detect in the suite it drives.
const unproved = [
  ...skippedStages,
  ...(deletionProofVerdict === 'holds' ? [] : ['deletion-grading']),
  ...(pipelineProofVerdict === 'holds' ? [] : ['round-10 pipeline']),
];
if (unproved.length > 0) {
  process.stderr.write(
    `\nred-proof INCOMPLETE: ${unproved.length} proof(s) did not run — ${unproved.join(', ')}.\n` +
      'These revisions are unreachable here (a shallow clone cannot run this proof). Nothing is\n' +
      'claimed about them, and an incomplete proof is not a passing one.\n',
  );
  process.exit(1);
}

process.stdout.write(
  `\nRED proof holds: ${stagesProved} staged proof(s) passed; every new-capability case fails before its change.\n`,
);
process.exit(0);
