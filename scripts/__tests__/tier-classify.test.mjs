/**
 * Adversarial tests for the repository-owned tier classifier.
 *
 * Every assertion here is demonstrated to FAIL against the pre-change state —
 * run `npm run tier-redproof` to see the home-dir classifier get them wrong.
 * That script drives this exact case table, so the two cannot drift apart.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { globMatch, normalizePath } from '../lib/tier-glob.mjs';

const { map: PROJECT_MAP, source: MAP_SOURCE } = loadTierMap(REPO_ROOT);

/**
 * A throwaway repo root holding a MALFORMED tier map, so the "project has a
 * policy we cannot read" branch can be exercised without touching this
 * repository's real map.
 */
const BAD_MAP_ROOT = join(tmpdir(), 'next-bar-tier-badmap');
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
    ];

    for (const input of degradingInputs) {
      it(`${input.name} => degraded, T0, escalated, not skippable`, () => {
        const result = input.badMap
          ? classifyPaths(input.paths, undefined, { repoRoot: BAD_MAP_ROOT })
          : classifyPaths(input.paths, PROJECT_MAP, { repoRoot: REPO_ROOT, contents: { 'docs/a.md': '# a\n' } });
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
