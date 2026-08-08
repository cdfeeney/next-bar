#!/usr/bin/env node
/**
 * Print the set of changed repo-relative paths, one per line, for the tier gate.
 *
 * WHY THIS IS NOT JUST `git diff --name-only HEAD`
 * ------------------------------------------------
 * That command lists only paths git already TRACKS. A brand-new file is
 * untracked until it is staged, so a fresh `scripts/purge-everything.mjs`
 * sitting in the working tree would be invisible to the gate — and a
 * newly-added destructive script is precisely the evasion the capability
 * classifier exists to catch. The gate would have reported a reassuring T2 on
 * the exact change that warranted T0.
 *
 * So the changed set is the union of:
 *   - `git diff --name-only HEAD`            staged + unstaged edits to tracked files
 *   - `git ls-files --others --exclude-standard`  new files git does not track yet
 *
 * `--exclude-standard` honours .gitignore, so build output and node_modules do
 * not flood the result.
 *
 * Zero runtime dependencies — Node built-ins only.
 */

import { execFileSync } from 'node:child_process';

import { REPO_ROOT } from './lib/tier-classify-core.mjs';

/** Run a git command in the repo root, returning [] instead of throwing. */
function git(args) {
  try {
    const out = execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
    return out.split(/\r?\n/).filter((line) => line.trim().length > 0);
  } catch (err) {
    process.stderr.write(`changed-paths: git ${args.join(' ')} failed: ${err && err.message}\n`);
    return [];
  }
}

// `git diff HEAD` covers staged AND unstaged edits in one call. On a repository
// with no commits yet HEAD does not resolve; the untracked list still applies.
const tracked = git(['diff', '--name-only', 'HEAD']);
const untracked = git(['ls-files', '--others', '--exclude-standard']);

const all = [...new Set([...tracked, ...untracked])].sort();
process.stdout.write(all.length > 0 ? `${all.join('\n')}\n` : '');
