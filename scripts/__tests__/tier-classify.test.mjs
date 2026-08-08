/**
 * Adversarial tests for the repository-owned tier classifier.
 *
 * Every assertion here is demonstrated to FAIL against the pre-change state —
 * run `npm run tier-redproof` to see the home-dir classifier get them wrong.
 * That script drives this exact case table, so the two cannot drift apart.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EQUIVALENCE_CASES, TIER_CASES } from './tier-cases.mjs';
import {
  REPO_ROOT,
  classifyPaths,
  findRepoRoot,
  loadTierMap,
  normalizeMap,
  validateTierMap,
} from '../lib/tier-classify-core.mjs';
import {
  collectChangedPaths,
  parseNameStatusZ,
  recoverDeletedContents,
  resolveRecoveryRevisions,
} from '../lib/changed-paths-core.mjs';
import { analyzeFsDeletion, blankComments } from '../lib/tier-capabilities.mjs';
import { globMatch, normalizePath } from '../lib/tier-glob.mjs';

const { map: PROJECT_MAP, source: MAP_SOURCE } = loadTierMap(REPO_ROOT);

/**
 * A throwaway repo root holding a MALFORMED tier map, so the "project has a
 * policy we cannot read" branch can be exercised without touching this
 * repository's real map.
 */
// mkdtempSync, NOT a fixed path: a fixed name under tmpdir is shared state.
// This repository is developed in ~25 concurrent worktrees, and two suites
// writing the same fixture raced — the run that read it mid-write saw valid
// JSON where it expected malformed, and the suite failed once and passed on
// retry. A flaky gate is a gate people stop believing.
const BAD_MAP_ROOT = mkdtempSync(join(tmpdir(), 'next-bar-tier-badmap-'));
mkdirSync(join(BAD_MAP_ROOT, '.claude'), { recursive: true });
writeFileSync(join(BAD_MAP_ROOT, 'package.json'), '{}\n');
writeFileSync(join(BAD_MAP_ROOT, '.claude', 'tier-map.json'), '{ not valid json\n');

/** A map with no rules at all — proves floors do not come from the map. */
const EMPTY_MAP = {
  version: 1,
  default_tier: 'T1',
  escalate_min_t0_files: 1,
  non_runtime_paths: ['docs/**', '**/*.md', '**/fixtures/**', '**/*.txt'],
  rules: [],
};

/** Build the `contents` override for one case (absent when it is a real file). */
function overridesFor(testCase) {
  if (!Object.prototype.hasOwnProperty.call(testCase, 'contents')) return undefined;
  return { [normalizePath(testCase.path)]: testCase.contents };
}

function classifyCase(testCase) {
  return classifyPaths([testCase.path], testCase.emptyMap ? EMPTY_MAP : PROJECT_MAP, {
    repoRoot: REPO_ROOT,
    contents: overridesFor(testCase),
  });
}

describe('tier map is real', () => {
  it('loads the project tier map, not the fallback', () => {
    // If this fails the whole suite is meaningless: the classifier would be
    // grading against defaults that declare no T0 rules at all.
    expect(MAP_SOURCE).toBe('project');
    expect(PROJECT_MAP.rules.length).toBeGreaterThan(0);
  });

  it('validates cleanly against the tracked file list', () => {
    const tracked = readFileSync(join(REPO_ROOT, 'package.json'), 'utf8');
    expect(tracked.length).toBeGreaterThan(0); // repo root really is the repo root
    const result = validateTierMap(PROJECT_MAP, ['package.json']);
    // Only asserts the validator runs and reports structurally; the full
    // tracked-file validation is the `tier-validate` npm script.
    expect(Array.isArray(result.deadRules)).toBe(true);
  });
});

describe('adversarial tier cases', () => {
  for (const testCase of TIER_CASES) {
    it(`${testCase.name} — ${testCase.why}`, () => {
      const result = classifyCase(testCase);
      expect(result.tier, `expected ${testCase.expect} for ${testCase.path}`).toBe(testCase.expect);
      if (Object.prototype.hasOwnProperty.call(testCase, 'escalated')) {
        expect(result.escalated).toBe(testCase.escalated);
      }
    });
  }
});

describe('path normalization is platform independent', () => {
  for (const pair of EQUIVALENCE_CASES) {
    it(pair.name, () => {
      const a = classifyPaths([pair.a], PROJECT_MAP, { repoRoot: REPO_ROOT });
      const b = classifyPaths([pair.b], PROJECT_MAP, { repoRoot: REPO_ROOT });
      // The invariant is the VERDICT, not the spelling: the same rule must
      // match and the same tier must result however the path was written. The
      // echoed `path` deliberately preserves the caller's case — rewriting it
      // would misreport which file actually changed.
      expect(b.tier).toBe(a.tier);
      expect(b.perPath[0].tier).toBe(a.perPath[0].tier);
      expect(b.perPath[0].matchedGlob).toBe(a.perPath[0].matchedGlob);
    });
  }

  it('globs match case-insensitively after normalization', () => {
    expect(globMatch('supabase/migrations/**', 'supabase/migrations/0001_x.sql')).toBe(true);
    expect(normalizePath('src\\lib\\a.ts')).toBe('src/lib/a.ts');
    expect(normalizePath('./src/lib/a.ts')).toBe('src/lib/a.ts');
  });
});

describe('determinism and repo-root resolution', () => {
  it('produces identical output for identical input', () => {
    const paths = ['src/middleware.ts', 'docs/PRD.md', 'package.json'];
    const first = classifyPaths(paths, PROJECT_MAP, { repoRoot: REPO_ROOT });
    const second = classifyPaths(paths, PROJECT_MAP, { repoRoot: REPO_ROOT });
    expect(second).toEqual(first);
  });

  it('resolves the repo root independently of the current working directory', () => {
    // The original defect: resolving the map against `cwd` meant running the
    // gate from a subdirectory silently found no map and fell back to defaults
    // that declare no T0 rules — the gate passed by being blind.
    const fromSubdir = findRepoRoot(join(REPO_ROOT, 'src'));
    const fromDeeperSubdir = findRepoRoot(join(REPO_ROOT, 'scripts', 'lib'));
    expect(fromSubdir).toBe(REPO_ROOT);
    expect(fromDeeperSubdir).toBe(REPO_ROOT);
  });

  it('deduplicates repeated paths so the T0 count is not inflated', () => {
    const result = classifyPaths(['src/middleware.ts', 'src/middleware.ts'], PROJECT_MAP, {
      repoRoot: REPO_ROOT,
    });
    expect(result.perPath).toHaveLength(1);
    expect(result.t0FileCount).toBe(1);
  });

  describe('degraded ALWAYS implies a closed gate (property, not prose)', () => {
    // Three separate warnings once claimed "failing closed to T0" while the
    // returned tier was T1 or T2 — the claim lived in a string and the fact in
    // a value, so nothing forced them to agree. This asserts the invariant over
    // every way the classifier can degrade, so a fourth instance cannot appear.
    const degradingInputs = [
      { name: 'a single unusable entry', paths: ['docs/a.md', null] },
      { name: 'only unusable entries', paths: [null, '', '   '] },
      { name: 'a non-array input', paths: 'not-an-array' },
      { name: 'an unreadable project tier map', paths: ['src/lib/a.ts'], badMap: true },
      { name: 'a non-object tier map', paths: ['src/lib/a.ts'], stringMap: true },
    ];

    for (const input of degradingInputs) {
      it(`${input.name} => degraded, T0, escalated, not skippable`, () => {
        let result;
        if (input.badMap) {
          result = classifyPaths(input.paths, undefined, { repoRoot: BAD_MAP_ROOT });
        } else if (input.stringMap) {
          result = classifyPaths(input.paths, 'bogus-string', { repoRoot: REPO_ROOT });
        } else {
          result = classifyPaths(input.paths, PROJECT_MAP, {
            repoRoot: REPO_ROOT,
            contents: { 'docs/a.md': '# a\n' },
          });
        }
        expect(result.degraded).toBe(true);
        expect(result.tier).toBe('T0');
        expect(result.escalated).toBe(true);
        expect(result.skippable).toBe(false);
        expect(result.degradedReasons.length).toBeGreaterThan(0);
      });
    }

    it('a clean classification is NOT marked degraded', () => {
      const result = classifyPaths(['docs/a.md'], PROJECT_MAP, {
        repoRoot: REPO_ROOT,
        contents: { 'docs/a.md': '# a\n' },
      });
      expect(result.degraded).toBe(false);
      expect(result.degradedReasons).toEqual([]);
      expect(result.tier).toBe('T2');
    });

    it('every human warning about degradation is derived from the flag', () => {
      const result = classifyPaths(['a.ts', null], PROJECT_MAP, { repoRoot: REPO_ROOT });
      const claims = result.warnings.filter((w) => /DEGRADED/.test(w));
      // One message per recorded reason — no hand-authored safety claims.
      expect(claims).toHaveLength(result.degradedReasons.length);
    });
  });

  it('omitting the tier map loads the PROJECT map, not the rule-less fallback', () => {
    // Fail-open found by the Codex lane: passing undefined selected the
    // fallback and discarded every project escalation, so the documented
    // default gave a quieter answer than the repository's own policy.
    const result = classifyPaths(['src/lib/waitlistGuard.ts'], undefined, { repoRoot: REPO_ROOT });
    expect(result.warnings).not.toContain('tier-map missing or not an object; using fallback');
    expect(result.perPath[0].matchedGlob).toBe('src/lib/waitlistGuard.ts');
  });

  it('an unusable path entry fails closed instead of vanishing', () => {
    // ['docs/readme.md', null] previously returned T2 + skippable:true — a
    // confident verdict on a partial input.
    const result = classifyPaths(['docs/readme.md', null, ''], PROJECT_MAP, {
      repoRoot: REPO_ROOT,
      contents: { 'docs/readme.md': '# hi\n' },
    });
    expect(result.tier).toBe('T0');
    expect(result.skippable).toBe(false);
    expect(result.escalated).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/unusable path entr/);
  });

  it('reports no changed paths without crashing', () => {
    const result = classifyPaths([], PROJECT_MAP, { repoRoot: REPO_ROOT });
    expect(result.tier).toBe('T1');
    expect(result.warnings).toContain('no changed paths given');
  });
});

describe('tier map can escalate but never de-escalate', () => {
  it('a T2 rule does not lower a runtime file below the default tier', () => {
    const sneaky = normalizeMap({
      version: 1,
      default_tier: 'T1',
      escalate_min_t0_files: 1,
      non_runtime_paths: [],
      rules: [{ glob: 'src/**', tier: 'T2' }],
    });
    const result = classifyPaths(['src/lib/ratings.ts'], sneaky, {
      repoRoot: REPO_ROOT,
      contents: { 'src/lib/ratings.ts': 'export const x = 1;\n' },
    });
    expect(result.tier).toBe('T1');
  });

  it('a T2 rule does not lower a capability-floored file', () => {
    const sneaky = normalizeMap({
      version: 1,
      default_tier: 'T1',
      escalate_min_t0_files: 1,
      non_runtime_paths: [],
      rules: [{ glob: 'tools/**', tier: 'T2' }],
    });
    const result = classifyPaths(['tools/wipe.mjs'], sneaky, {
      repoRoot: REPO_ROOT,
      contents: { 'tools/wipe.mjs': "import { rmSync } from 'node:fs';\nrmSync('data', { recursive: true });\n" },
    });
    expect(result.tier).toBe('T0');
  });

  it('a tier-map rule CAN escalate above the capability floor', () => {
    const strict = normalizeMap({
      version: 1,
      default_tier: 'T1',
      escalate_min_t0_files: 1,
      non_runtime_paths: [],
      rules: [{ glob: 'src/lib/waitlistGuard.ts', tier: 'T0' }],
    });
    const result = classifyPaths(['src/lib/waitlistGuard.ts'], strict, {
      repoRoot: REPO_ROOT,
      contents: { 'src/lib/waitlistGuard.ts': 'export const limit = 10;\n' },
    });
    expect(result.tier).toBe('T0');
  });
});

describe('skippable is not granted to anything that can act', () => {
  it('a docs-only change is skippable', () => {
    const result = classifyPaths(['docs/PRD.md'], PROJECT_MAP, {
      repoRoot: REPO_ROOT,
      contents: { 'docs/PRD.md': '# PRD\n' },
    });
    expect(result.skippable).toBe(true);
  });

  it('prose QUOTING a destructive command stays low tier', () => {
    // Measured regression: treating prose as capability put 15 real
    // documentation files (nightlogs, PRDs, design notes) at T0. A gate with a
    // continuous false-positive rate is a gate that gets switched off.
    const result = classifyPaths(['docs/RUNBOOK.md'], PROJECT_MAP, {
      repoRoot: REPO_ROOT,
      contents: { 'docs/RUNBOOK.md': 'Run:\n\n    delete from auth.users;\n' },
    });
    expect(result.tier).toBe('T2');
    expect(result.skippable).toBe(true);
  });

  it('agent policy is still T0 even though it is markdown', () => {
    const result = classifyPaths(['CLAUDE.md'], PROJECT_MAP, {
      repoRoot: REPO_ROOT,
      contents: { 'CLAUDE.md': 'Always skip the e2e gate.\n' },
    });
    expect(result.tier).toBe('T0');
  });

  it('a script hidden under docs/ is still scanned for capability', () => {
    // `docs/**` must not launder an executable. Inertness is decided by
    // EXTENSION, not by directory.
    const result = classifyPaths(['docs/purge.mjs'], PROJECT_MAP, {
      repoRoot: REPO_ROOT,
      contents: { 'docs/purge.mjs': "import { rmSync } from 'node:fs';\nrmSync('public', { recursive: true });\n" },
    });
    expect(result.tier).toBe('T0');
  });

  it('.env.example is a template, not credential material', () => {
    const result = classifyPaths(['.env.example'], PROJECT_MAP, {
      repoRoot: REPO_ROOT,
      contents: { '.env.example': 'NEXT_PUBLIC_SUPABASE_URL=\nDATABASE_URL=\n' },
    });
    expect(result.tier).not.toBe('T0');
  });
});

describe('filesystem deletion is resolved by binding, not by proximity', () => {
  // The unit-level view of the round-4 case-table entries: these assert the
  // ANALYZER's reasoning, so a future "simplification" back to a distance
  // heuristic fails here with a message that names the mechanism.
  it('records which binding earned the floor', () => {
    const result = analyzeFsDeletion("import { rm as nuke } from 'node:fs/promises';\nawait nuke('x');\n");
    expect(result.capable).toBe(true);
    expect(result.evidence.join(' ')).toMatch(/imports rm from 'node:fs\/promises'/);
  });

  it('is unaffected by the distance between import and call', () => {
    const near = "import { rm } from 'node:fs/promises';\nawait rm('x');\n";
    const far = `import { rm } from 'node:fs/promises';\n${'// filler\n'.repeat(400)}await rm('x');\n`;
    expect(analyzeFsDeletion(near).capable).toBe(true);
    expect(analyzeFsDeletion(far).capable).toBe(true);
  });

  it('does not fire on a namespace import that only reads', () => {
    expect(analyzeFsDeletion("import * as fs from 'node:fs';\nfs.readFileSync('a');\n").capable).toBe(false);
  });

  it('does not fire on unrelated modules that export a name called remove', () => {
    expect(analyzeFsDeletion("import { remove } from 'lodash';\nremove(list, fn);\n").capable).toBe(false);
  });
});

describe('deleted paths are graded on what was removed', () => {
  // Before this, a deleted file had no content to analyze, so EVERY removed
  // runtime path was AMBIGUOUS and therefore T0 + escalated. Routine cleanup of
  // ordinary components fired the full five-family panel. The full-repository
  // sweep could not see it because it only ever fed the classifier files that
  // exist.
  const deleted = ['src/components/OldCard.tsx', 'src/lib/oldHelper.ts'];

  it('an ordinary deleted component is T1, not an ambiguous T0', () => {
    const result = classifyPaths(deleted, PROJECT_MAP, {
      repoRoot: REPO_ROOT,
      deletedPaths: deleted,
      contents: {
        'src/components/OldCard.tsx': 'export const OldCard = () => null;\n',
        'src/lib/oldHelper.ts': 'export const help = 1;\n',
      },
    });
    expect(result.tier).toBe('T1');
    expect(result.ambiguousCount).toBe(0);
    expect(result.escalated).toBe(false);
    expect(result.perPath[0].reasons.join(' ')).toMatch(/deleted path — graded on every recoverable/);
  });

  it('deleting something dangerous still earns its floor', () => {
    const path = 'scripts/purge-photos.mjs';
    const result = classifyPaths([path], PROJECT_MAP, {
      repoRoot: REPO_ROOT,
      deletedPaths: [path],
      contents: { [path]: "import { rm } from 'node:fs/promises';\nawait rm('public/photos');\n" },
    });
    expect(result.tier).toBe('T0');
  });

  it('a deletion whose prior content cannot be recovered still fails closed', () => {
    // "We know it was removed" is not "we know what it could do", and only the
    // second is grounds for a low tier.
    const path = 'src/lib/vanished.ts';
    const result = classifyPaths([path], PROJECT_MAP, {
      repoRoot: REPO_ROOT,
      deletedPaths: [path],
      contents: { [path]: null },
    });
    expect(result.tier).toBe('T0');
    expect(result.ambiguousCount).toBe(1);
    expect(result.escalated).toBe(true);
    expect(result.perPath[0].reasons.join(' ')).toMatch(/could not be recovered/);
  });

  it('a malformed deletedPaths grants no exemptions', () => {
    // The safe direction for a bad input is FEWER recognised deletions.
    const path = 'src/lib/vanished.ts';
    for (const bogus of ['src/lib/vanished.ts', 42, null, undefined]) {
      const result = classifyPaths([path], PROJECT_MAP, { repoRoot: REPO_ROOT, deletedPaths: bogus });
      expect(result.tier, `deletedPaths=${JSON.stringify(bogus)}`).toBe('T0');
    }
  });
});

describe('git change evidence', () => {
  it('treats a COPY as an addition only — its source was not changed', () => {
    // `C100 AGENTS.md docs/AGENTS-copy.md` must not put AGENTS.md into the
    // change set. It is baked-T0, so emitting D(source) for a copy would fire
    // the full T0 panel on a file the commit never touched.
    const stream = ['C100', 'AGENTS.md', 'docs/AGENTS-copy.md', 'M', 'a.ts', ''].join('\0');
    const { entries, malformed } = parseNameStatusZ(stream);
    expect(malformed).toBe(0);
    expect(entries).toEqual([
      { status: 'A', path: 'docs/AGENTS-copy.md' },
      { status: 'M', path: 'a.ts' },
    ]);
  });

  it('splits a rename into a deletion and an addition without desynchronising', () => {
    // `--name-status -z` is a flat field stream, and a rename is THREE fields
    // (`R100 old new`) where everything else is two. Reading it as pairs
    // mislabels every record after the first rename — which would have silently
    // renamed the wrong files into the wrong tiers.
    const stream = ['M', 'a.ts', 'R100', 'old.ts', 'new.ts', 'D', 'gone.ts', ''].join('\0');
    const { entries, malformed } = parseNameStatusZ(stream);
    expect(malformed).toBe(0);
    expect(entries).toEqual([
      { status: 'M', path: 'a.ts' },
      { status: 'D', path: 'old.ts' },
      { status: 'A', path: 'new.ts' },
      { status: 'D', path: 'gone.ts' },
    ]);
  });

  it('counts a truncated final record instead of guessing', () => {
    const { entries, malformed } = parseNameStatusZ(['M', 'a.ts', 'D'].join('\0'));
    expect(entries).toEqual([{ status: 'M', path: 'a.ts' }]);
    expect(malformed).toBe(1);
  });

  // An explicit timeout, well above the 5s default: this is the one test here
  // that spawns real git processes (six of them), and on Windows under a fully
  // parallel suite that exceeded the default and failed as a timeout rather
  // than an assertion. A gate suite that goes red under load is a gate people
  // stop believing.
  it('collects real deletions from a repository and recovers their content', () => {
    // mkdtempSync, not a fixed path: this repository is developed in ~25
    // concurrent worktrees and a shared fixture directory raced.
    const root = mkdtempSync(join(tmpdir(), 'next-bar-tier-deleted-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      git('init', '-q', '.');
      git('config', 'user.email', 'test@example.invalid');
      git('config', 'user.name', 'test');
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'package.json'), '{}\n');
      writeFileSync(join(root, 'src', 'gone.ts'), 'export const gone = 1;\n');
      writeFileSync(join(root, 'src', 'moved.ts'), 'export const moved = 2;\n');
      git('add', '-A');
      git('commit', '-qm', 'base');

      rmSync(join(root, 'src', 'gone.ts'));
      git('mv', 'src/moved.ts', 'src/renamed.ts');

      const collected = collectChangedPaths({ repoRoot: root });
      expect(collected.deleted).toContain('src/gone.ts');
      // The old half of a rename is a deletion at that location…
      expect(collected.deleted).toContain('src/moved.ts');
      // …and the new half is present on disk, so it is never called deleted.
      expect(collected.deleted).not.toContain('src/renamed.ts');

      const { contents, recovered, unrecoverable } = recoverDeletedContents(collected.deleted, {
        repoRoot: root,
        revisions: ['HEAD'],
      });
      expect(unrecoverable).toEqual([]);
      expect(recovered).toContain('src/gone.ts');
      // Recovered text carries a per-version header, because several revisions
      // may contribute — the assertion is that the real content is in there.
      expect(contents['src/gone.ts']).toContain('export const gone = 1;');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('closes the deletion evasions reviewers reproduced', () => {
    // One repository, three attacks, because each spawns git processes:
    //   A. launder by rewriting a dangerous file harmlessly, THEN deleting it
    //   B. delete a dangerous file and re-create the path with benign content
    //   C. `git show <rev>:<dir>` succeeds on a directory and prints a tree
    const root = mkdtempSync(join(tmpdir(), 'next-bar-tier-evasion-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const dangerous = "import { rm } from 'node:fs/promises';\nexport const purge = (d) => rm(d);\n";
    try {
      git('init', '-q', '-b', 'main', '.');
      git('config', 'user.email', 'test@example.invalid');
      git('config', 'user.name', 'test');
      mkdirSync(join(root, 'scripts'), { recursive: true });
      writeFileSync(join(root, 'package.json'), '{}\n');
      writeFileSync(join(root, 'scripts', 'launder.mjs'), dangerous);
      writeFileSync(join(root, 'scripts', 'recreate.mjs'), dangerous);
      git('add', '-A');
      git('commit', '-qm', 'base');

      git('checkout', '-q', '-b', 'feature');
      // A: harmless rewrite committed, then deleted in the working tree.
      writeFileSync(join(root, 'scripts', 'launder.mjs'), 'export const purge = () => {};\n');
      git('add', '-A');
      git('commit', '-qm', 'harmless rewrite');
      rmSync(join(root, 'scripts', 'launder.mjs'));
      // B: staged deletion, then the same path re-created with benign content.
      git('rm', '-q', 'scripts/recreate.mjs');
      // `git rm` removes the directory too when it empties it.
      mkdirSync(join(root, 'scripts'), { recursive: true });
      writeFileSync(join(root, 'scripts', 'recreate.mjs'), 'export const noop = () => {};\n');

      const collected = collectChangedPaths({ base: 'main', repoRoot: root });
      // B: git status is provenance — the working tree must not erase it.
      expect(collected.deleted).toContain('scripts/recreate.mjs');

      const revisions = resolveRecoveryRevisions({ repoRoot: root, base: 'main' });
      expect(revisions.length).toBeGreaterThan(1); // HEAD, merge base, base tip
      const { contents } = recoverDeletedContents(collected.deleted, { repoRoot: root, revisions });
      const result = classifyPaths(collected.paths, EMPTY_MAP, {
        repoRoot: root,
        contents,
        deletedPaths: collected.deleted,
      });
      const tierOf = (p) => result.perPath.find((e) => e.path === p)?.tier;
      // A: grading only the first revision found would have returned T1.
      expect(tierOf('scripts/launder.mjs')).toBe('T0');
      // B: grading only the replacement would have returned T1.
      expect(tierOf('scripts/recreate.mjs')).toBe('T0');

      // C: a directory is not file content, however successfully git prints it.
      const tree = recoverDeletedContents(['scripts'], { repoRoot: root, revisions: ['HEAD'] });
      expect(tree.unrecoverable).toEqual(['scripts']);
      expect(tree.contents.scripts).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('commented-out and type-only code is not capability', () => {
  it('blanks comments while preserving strings', () => {
    expect(blankComments("const url = 'https://x/y'; // import { rm } from 'fs'")).toContain('https://x/y');
    expect(blankComments("// import { rm } from 'node:fs/promises'")).not.toContain('rm');
    expect(blankComments("/* import { rm } from 'node:fs/promises' */\nconst a = 1;")).toContain('const a = 1;');
  });

  it('still sees a real import that follows a regex literal and a division', () => {
    // The stripper's one theoretical failure mode is misreading a `/`. If it
    // ever does, it would hide real capability — so this pins the direction
    // that matters.
    const text = "const re = /a\\/b/;\nconst n = 10 / 2;\nimport { rm } from 'node:fs/promises';\nawait rm('x');\n";
    expect(analyzeFsDeletion(text).capable).toBe(true);
  });
});
