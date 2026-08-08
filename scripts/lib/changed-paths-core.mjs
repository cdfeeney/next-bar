/**
 * Collect the set of changed repo-relative paths for the tier gate.
 *
 * This lives in a library, not in the CLI, for one specific reason: the CLI
 * used to be consumed as `node scripts/changed-paths.mjs | node
 * scripts/tier-classify.mjs`, and **a shell pipeline exits with the status of
 * its LAST command**. The feeder could detect a broken git invocation, print a
 * loud diagnostic and exit 1, and the pipe would throw that status away — the
 * classifier read empty stdin, reported "no changed paths given" and a
 * reassuring default tier, and the whole step went green having inspected
 * nothing. Every call site had that hole: the CI step, `tier-changed` and
 * `verify:changed` (bare `|` under `sh` and `cmd.exe`, neither of which has
 * pipefail; GitHub Actions only enables it when `shell: bash` is written
 * explicitly).
 *
 * Exposing this as a function lets `tier-classify.mjs --changed` call it
 * in-process and fail on the spot, so correctness no longer depends on the
 * shell's pipeline semantics.
 *
 * THREE SOURCES, UNIONED — each covers a hole the others leave open:
 *   1. `git diff --name-only -z HEAD`                  staged + unstaged edits
 *   2. `git ls-files --others --exclude-standard -z`   new, untracked files
 *   3. `git diff --name-only -z <base>...HEAD`         everything this branch changed
 *
 * Source 3 is not optional. Sources 1 and 2 describe the WORKING TREE, so both
 * go empty the moment work is committed, and a fresh CI checkout has no
 * working-tree changes at all.
 *
 * Zero runtime dependencies — Node built-ins only.
 */

import { execFileSync } from 'node:child_process';

import { REPO_ROOT } from './tier-classify-core.mjs';

/** Split NUL-separated git output. */
function splitZ(out) {
  return out === null ? [] : out.split('\0').filter((p) => p.length > 0);
}

/**
 * Collect changed paths.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.base] explicit base ref; falls back to
 *   `GITHUB_BASE_REF`, then `origin/HEAD|main|master`
 * @param {string} [opts.repoRoot]
 * @returns {{paths: string[], failures: string[], base: string|null}}
 *   `failures` non-empty means the set may be INCOMPLETE — callers must treat
 *   that as an error, never as "no changes".
 */
export function collectChangedPaths(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const failures = [];

  /**
   * Run git. Returns null on FAILURE, which is deliberately distinct from ''
   * when git succeeds and finds nothing — collapsing those two is what made a
   * broken command indistinguishable from a clean tree.
   */
  function git(args, label, { optional = false } = {}) {
    try {
      return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      if (!optional) {
        const message = (err && err.message ? err.message : String(err)).split('\n')[0];
        failures.push(`git ${label} failed: ${message}`);
      }
      return null;
    }
  }

  const refExists = (ref) =>
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], `rev-parse ${ref}`, { optional: true }) !==
    null;

  /**
   * An explicit base or `GITHUB_BASE_REF` is VERIFIED, not trusted. Returning
   * them unchecked meant a typo or an unfetched ref made the diff fail, the
   * failure was swallowed, and — because the base looked truthy — even the
   * "committed work is NOT classified" warning was skipped.
   */
  function resolveBase() {
    if (opts.base) {
      if (refExists(opts.base)) return opts.base;
      failures.push(`base "${opts.base}" does not resolve to a commit in this repository`);
      return null;
    }
    const prBase = process.env.GITHUB_BASE_REF;
    if (prBase && prBase.trim()) {
      const ref = `origin/${prBase.trim()}`;
      if (refExists(ref)) return ref;
      failures.push(`GITHUB_BASE_REF "${prBase.trim()}" gave ${ref}, which does not resolve (shallow clone?)`);
      return null;
    }
    for (const candidate of ['origin/HEAD', 'origin/main', 'origin/master']) {
      if (refExists(candidate)) return candidate;
    }
    return null;
  }

  const paths = new Set();
  for (const p of splitZ(git(['diff', '--name-only', '-z', 'HEAD'], 'diff HEAD'))) paths.add(p);
  for (const p of splitZ(git(['ls-files', '--others', '--exclude-standard', '-z'], 'ls-files --others'))) {
    paths.add(p);
  }

  const base = resolveBase();
  if (base) {
    // Three-dot: everything HEAD changed since it diverged from the base.
    for (const p of splitZ(git(['diff', '--name-only', '-z', `${base}...HEAD`], `diff ${base}...HEAD`))) {
      paths.add(p);
    }
  } else {
    failures.push(
      'no base ref resolved — only working-tree and untracked changes are included, ' +
        'so committed work on this branch is NOT classified',
    );
  }

  return { paths: [...paths].sort(), failures, base };
}
