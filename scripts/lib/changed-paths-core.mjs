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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './tier-classify-core.mjs';
import { normalizePath } from './tier-glob.mjs';

/** Split NUL-separated git output. */
function splitZ(out) {
  return out === null ? [] : out.split('\0').filter((p) => p.length > 0);
}

/**
 * Parse `git diff --name-status -z` into `{status, path}` entries.
 *
 * The format is a flat NUL-separated field stream, not one record per field:
 * an ordinary change is `STATUS\0PATH`, but a rename or copy is
 * `R100\0OLD\0NEW` — three fields. Reading it as pairs would desynchronise the
 * whole stream after the first rename and mislabel every entry that follows, so
 * the arity is decided per record.
 *
 * A RENAME yields both halves: the old path is a deletion (its content is gone
 * from that location) and the new path is an addition. A COPY does NOT — its
 * source is still there, untouched. Emitting `D(source)` for a copy would put a
 * file nobody changed into the change set, and for a copy of a baked-T0 path
 * (`C100 AGENTS.md docs/AGENTS-copy.md`) that fires the full T0 panel on a file
 * the commit never touched.
 *
 * @returns {{entries: Array<{status:string, path:string}>, malformed: number}}
 */
export function parseNameStatusZ(out) {
  const fields = splitZ(out);
  const entries = [];
  let malformed = 0;
  for (let i = 0; i < fields.length; ) {
    const status = fields[i];
    const isRename = /^R/.test(status);
    const isCopy = /^C/.test(status);
    const arity = isRename || isCopy ? 3 : 2;
    if (i + arity > fields.length) {
      // A truncated final record means we cannot say what changed. Counted, not
      // ignored: the caller turns this into a failure, because a partially
      // parsed change set that looks complete is exactly how a gate goes green
      // having inspected the wrong files.
      malformed += 1;
      break;
    }
    if (isRename) {
      entries.push({ status: 'D', path: fields[i + 1] });
      entries.push({ status: 'A', path: fields[i + 2] });
    } else if (isCopy) {
      entries.push({ status: 'A', path: fields[i + 2] });
    } else {
      entries.push({ status: status[0], path: fields[i + 1] });
    }
    i += arity;
  }
  return { entries, malformed };
}

/**
 * Collect changed paths.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.base] explicit base ref; falls back to
 *   `GITHUB_BASE_REF`, then `origin/HEAD|main|master`
 * @param {string} [opts.repoRoot]
 * @returns {{paths: string[], deleted: string[], failures: string[], base: string|null}}
 *   `failures` non-empty means the set may be INCOMPLETE — callers must treat
 *   that as an error, never as "no changes". `deleted` lists the paths git
 *   reports as removed (including the old half of a rename) that are also
 *   absent from the working tree, so they can be classified from their
 *   pre-deletion content instead of failing closed as unanalyzable.
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
  const deletedCandidates = new Set();

  /** Run a name-status diff and fold it into the path/deletion sets. */
  function addDiff(args, label) {
    const { entries, malformed } = parseNameStatusZ(git(args, label));
    if (malformed > 0) {
      failures.push(`git ${label} produced ${malformed} unparseable --name-status record(s)`);
    }
    for (const { status, path } of entries) {
      paths.add(path);
      if (status === 'D') deletedCandidates.add(path);
    }
  }

  addDiff(['diff', '--name-status', '-z', 'HEAD'], 'diff HEAD');
  for (const p of splitZ(git(['ls-files', '--others', '--exclude-standard', '-z'], 'ls-files --others'))) {
    paths.add(p);
  }

  const base = resolveBase();
  if (base) {
    // Three-dot: everything HEAD changed since it diverged from the base.
    addDiff(['diff', '--name-status', '-z', `${base}...HEAD`], `diff ${base}...HEAD`);
  } else {
    failures.push(
      'no base ref resolved — only working-tree and untracked changes are included, ' +
        'so committed work on this branch is NOT classified',
    );
  }

  // EVERY path git reports as deleted is kept, including one that exists on disk
  // again. Filtering these by on-disk presence was a fail-open a reviewer
  // reproduced: stage the deletion of a destructive script, recreate the path
  // with harmless content, and the `D` record was discarded — so the dangerous
  // version left the change set entirely and the change graded T1. Git's status
  // is provenance; the working tree cannot erase it. `recoverDeletedContents`
  // grades such a path on BOTH versions.
  const deleted = [...deletedCandidates];

  return { paths: [...paths].sort(), deleted: deleted.sort(), failures, base };
}

/**
 * Resolve the revisions a deleted path's prior content may live in.
 *
 * Three, not one, and every one is consulted:
 *   - `HEAD`        the file as it was before an uncommitted deletion
 *   - the merge base what the branch actually diverged from — `base...HEAD`
 *                   measures against this, so `git show <base tip>:<path>` and
 *                   the diff could otherwise disagree about what "base" means
 *   - the base tip  the branch this change targets
 *
 * @returns {string[]} deduped, in the order they should be reported
 */
export function resolveRecoveryRevisions(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const revisions = ['HEAD'];
  const base = opts.base;
  if (typeof base === 'string' && base.length > 0) {
    try {
      const mergeBase = execFileSync('git', ['merge-base', base, 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (mergeBase) revisions.push(mergeBase);
    } catch {
      // No merge base (unrelated histories, shallow clone) — the base tip below
      // is still tried, and an unrecoverable path still fails closed.
    }
    revisions.push(base);
  }
  return [...new Set(revisions)];
}

/** Read one path at one revision, but ONLY if it is a blob. */
function readBlobAtRevision(repoRoot, rev, path) {
  let type;
  try {
    type = execFileSync('git', ['cat-file', '-t', `${rev}:${path}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null; // the path did not exist at that revision
  }
  // `git show HEAD:scripts` SUCCEEDS on a directory and prints a tree listing —
  // text with no capability signature in it, which would grade the removal of a
  // whole subtree as T1. A gitlink resolves to a commit object the same way.
  // Only a blob is file content.
  if (type !== 'blob') return null;
  let buf;
  try {
    buf = execFileSync('git', ['show', `${rev}:${path}`], {
      cwd: repoRoot,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  // A NUL byte in the first 8 KB means binary; text signatures are meaningless
  // there, and decoding it would feed garbage to the scanner.
  if (buf.subarray(0, 8192).includes(0)) return null;
  return buf.toString('utf8').replace(/\r\n/g, '\n');
}

/**
 * Recover the pre-deletion content of removed paths from a git revision.
 *
 * WHY: a deleted file has no content on disk, so capability analysis could not
 * establish that it lacked a high-risk capability and every deleted runtime path
 * classified AMBIGUOUS — therefore T0 and escalated. That is a continuous
 * false-positive channel: routine cleanup of five ordinary components fired the
 * full five-family T0 panel. It went unnoticed because the full-repository sweep
 * only ever fed it files that exist.
 *
 * The evidence git already holds fixes it. `git show <rev>:<path>` returns what
 * the file CONTAINED before it was removed, so a deletion is classified by what
 * was actually deleted: removing a purge script still earns its T0 floor,
 * removing a plain component does not. Recovery failure is NOT downgraded — the
 * path stays unanalyzable and keeps failing closed.
 *
 * EVERY VERSION IS GRADED, NOT THE FIRST ONE FOUND. Taking the first hit across
 * `[HEAD, base]` let a two-step change launder itself: commit a harmless rewrite
 * of a dangerous file, then delete it, and the gate graded the harmless HEAD
 * version. Reviewers found the mirror image too — for a deletion committed on the
 * branch, the base tip can hold a staler version than the one actually removed.
 * Both disappear if no single revision is trusted to be *the* prior content. The
 * recovered versions are concatenated, and because capability detection is a
 * union over the text, that is exactly "the highest tier any version earns".
 *
 * The CURRENT working-tree file is included when the path exists again, so a
 * delete-then-recreate is graded on both halves rather than on the replacement
 * alone.
 *
 * @param {string[]} paths deleted repo-relative paths
 * @param {object} [opts] `{repoRoot, revisions}`
 * @returns {{contents: Record<string,string|null>, recovered: string[], unrecoverable: string[]}}
 */
export function recoverDeletedContents(paths, opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const revisions = [
    ...new Set((opts.revisions ?? ['HEAD']).filter((r) => typeof r === 'string' && r.length > 0)),
  ];
  const contents = {};
  const recovered = [];
  const unrecoverable = [];

  for (const raw of Array.isArray(paths) ? paths : []) {
    const path = normalizePath(raw);
    const versions = [];
    for (const rev of revisions) {
      const text = readBlobAtRevision(repoRoot, rev, path);
      if (text !== null) versions.push(`// tier-classify: version of ${path} at ${rev}\n${text}`);
    }
    const absolute = join(repoRoot, path);
    if (existsSync(absolute)) {
      try {
        const buf = readFileSync(absolute);
        if (!buf.subarray(0, 8192).includes(0)) {
          versions.push(
            `// tier-classify: current working-tree version of ${path}\n${buf
              .toString('utf8')
              .replace(/\r\n/g, '\n')}`,
          );
        }
      } catch {
        // Unreadable on disk; the recovered revisions above still stand.
      }
    }

    contents[path] = versions.length > 0 ? versions.join('\n') : null;
    (versions.length > 0 ? recovered : unrecoverable).push(path);
  }

  return { contents, recovered, unrecoverable };
}
