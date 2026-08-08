#!/usr/bin/env node
/**
 * Print the set of changed repo-relative paths for the tier gate,
 * NUL-separated (like `git ls-files -z`).
 *
 * THREE SOURCES, UNIONED — each covers a hole the others leave open:
 *
 * 1. `git diff --name-only -z HEAD` — staged + unstaged edits to tracked files.
 * 2. `git ls-files --others --exclude-standard -z` — files git does not track
 *    yet. Without this a brand-new `scripts/purge-everything.mjs` sitting in the
 *    working tree is invisible, and a newly-added destructive script is exactly
 *    the case the capability classifier exists to catch.
 * 3. `git diff --name-only -z <base>...HEAD` — everything this branch changes
 *    relative to its merge base.
 *
 * Source 3 is not optional, and leaving it out was a real defect. Sources 1 and
 * 2 both describe the WORKING TREE, so the moment you commit, both go empty:
 * `npm run tier-changed` then reported "no changed paths given" and a
 * reassuring default T1 — a gate that inspected nothing while looking green. It
 * failed the same way in CI, where a fresh checkout has no working-tree
 * changes at all, so CI could never classify a pull request's files.
 *
 * Base resolution, first hit wins:
 *   --base <ref>            explicit (CI passes this)
 *   $GITHUB_BASE_REF        GitHub Actions sets this on pull_request
 *   origin/HEAD or origin/main
 * If none resolves (no remote, fresh repo), sources 1 and 2 still apply and a
 * note is written to stderr — never a silent empty result.
 *
 * Zero runtime dependencies — Node built-ins only.
 */

import { execFileSync } from 'node:child_process';

import { REPO_ROOT } from './lib/tier-classify-core.mjs';

/** Run a git command in the repo root. Returns null when git itself fails. */
function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Split NUL-separated git output. `-z` is used everywhere on purpose: without
 * it git applies `core.quotePath`, wrapping any non-ASCII path in quotes and
 * C-escaping the bytes (`"caf\303\251.txt"`). That mangled string matches no
 * glob, so the file would be misclassified — and this project imports venue
 * data with accented names.
 */
function splitZ(out) {
  return out === null ? [] : out.split('\0').filter((p) => p.length > 0);
}

function argValue(flag) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

/** Resolve a ref to compare against, or null when none is available. */
function resolveBase() {
  const explicit = argValue('--base');
  if (explicit) return explicit;
  const prBase = process.env.GITHUB_BASE_REF;
  if (prBase && prBase.trim()) return `origin/${prBase.trim()}`;
  for (const candidate of ['origin/HEAD', 'origin/main', 'origin/master']) {
    if (git(['rev-parse', '--verify', '--quiet', candidate])) return candidate;
  }
  return null;
}

const paths = new Set();

for (const p of splitZ(git(['diff', '--name-only', '-z', 'HEAD']))) paths.add(p);
for (const p of splitZ(git(['ls-files', '--others', '--exclude-standard', '-z']))) paths.add(p);

const base = resolveBase();
if (base) {
  // Three-dot: everything HEAD changed since it diverged from the base, which
  // is what a reviewer of this branch actually sees.
  for (const p of splitZ(git(['diff', '--name-only', '-z', `${base}...HEAD`]))) paths.add(p);
} else {
  process.stderr.write(
    'changed-paths: no base ref resolved (no --base, no GITHUB_BASE_REF, no origin/*).\n' +
      '  Only working-tree and untracked changes are included; committed work on this\n' +
      '  branch is NOT classified.\n',
  );
}

const all = [...paths].sort();
process.stdout.write(all.length > 0 ? `${all.join('\0')}\0` : '');
