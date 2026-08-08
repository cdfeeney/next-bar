#!/usr/bin/env node
/**
 * Print the changed repo-relative paths for the tier gate, NUL-separated.
 *
 * The collection logic lives in `lib/changed-paths-core.mjs`. Prefer
 * `node scripts/tier-classify.mjs --changed`, which calls that library
 * in-process: piping this script into the classifier discards its exit status
 * (a shell pipeline reports its LAST command's status), so a detected failure
 * would be silently converted into "no changed paths" and a reassuring default
 * tier.
 *
 * This CLI remains for inspection and for callers that genuinely want the raw
 * list. It exits 1 whenever the set may be incomplete — check that status.
 *
 * Usage:
 *   node scripts/changed-paths.mjs [--base <ref>]
 *
 * Zero runtime dependencies — Node built-ins only.
 */

import { collectChangedPaths } from './lib/changed-paths-core.mjs';

function argValue(flag) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

const { paths, failures, base } = collectChangedPaths({ base: argValue('--base') });

process.stdout.write(paths.length > 0 ? `${paths.join('\0')}\0` : '');

// Never exit quietly on a partial result. An empty set is a legitimate answer
// for a clean tree, but the caller must be able to tell that apart from a
// broken invocation, because both otherwise render as a reassuring default tier.
if (failures.length > 0) {
  process.stderr.write('changed-paths: INCOMPLETE — the changed set may be missing files.\n');
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}
if (paths.length === 0) {
  process.stderr.write(
    'changed-paths: no changes found (all git commands succeeded; working tree clean and ' +
      `${base ? `no commits since ${base}` : 'no base ref configured'}).\n`,
  );
}
