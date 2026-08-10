#!/usr/bin/env node
/**
 * Repository-owned tier classifier — CLI.
 *
 * Replaces the harness classifier at `~/.claude/bin/tier-classify.mjs`, which
 * lives OUTSIDE this repository. CI could not invoke that file, so there was
 * effectively no tier validation in CI at all. This one ships with the repo.
 *
 * Usage:
 *   git diff --name-only HEAD | node scripts/tier-classify.mjs
 *   git ls-files              | node scripts/tier-classify.mjs --validate
 *   node scripts/tier-classify.mjs --json < paths.txt
 *
 * Exit codes:
 *   0  classified (or validated) successfully
 *   2  the project tier map is unreadable/malformed, or validation found a dead
 *      rule — fail closed, because a policy we cannot read is not a policy
 *
 * Classifying never exits non-zero for a T0 result: T0 is an answer, not an
 * error. The caller decides what to do with it.
 *
 * Zero runtime dependencies — Node built-ins only.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { classifyPaths, loadTierMap, validateTierMap, REPO_ROOT } from './lib/tier-classify-core.mjs';
import {
  collectChangedPaths,
  recoverDeletedContents,
  refExists,
  resolveRecoveryRevisions,
} from './lib/changed-paths-core.mjs';
import { normalizePath } from './lib/tier-glob.mjs';

/** Read all of stdin as UTF-8. Returns '' when stdin is a TTY (no input piped). */
async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Split piped input into paths.
 *
 * Prefers NUL separation (`git ls-files -z`, `changed-paths.mjs`) because it is
 * the only form git never mangles. Falls back to newlines for a hand-typed or
 * legacy pipe, and there undoes `core.quotePath`: git wraps any path with
 * non-ASCII or special characters in quotes and C-escapes the bytes
 * (`"caf\303\251.txt"`). Left as-is that string matches no glob and the file is
 * misclassified, so the escapes are decoded back to real bytes.
 */
function parsePaths(raw) {
  if (raw.includes('\0')) return raw.split('\0').filter((p) => p.length > 0);
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(unquoteGitPath);
}

/** Decode one `core.quotePath` entry back to its real path. */
function unquoteGitPath(line) {
  if (!(line.startsWith('"') && line.endsWith('"') && line.length >= 2)) return line;
  const body = line.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') {
      bytes.push(body.charCodeAt(i));
      continue;
    }
    const next = body[i + 1];
    const simple = { n: 10, t: 9, r: 13, '"': 34, '\\': 92 };
    if (next in simple) {
      bytes.push(simple[next]);
      i += 1;
    } else if (/[0-7]/.test(next)) {
      // Three-digit octal escape for a raw byte, e.g. \303\251 for "é".
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(body.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function printHuman(result, source) {
  const lines = [];
  lines.push(`tier: ${result.tier}   (tier-map source: ${source})`);
  lines.push(
    `files: ${result.perPath.length}   T0: ${result.t0FileCount}   ` +
      `escalated: ${result.escalated}   ambiguous: ${result.ambiguousCount}   skippable: ${result.skippable}`,
  );
  for (const entry of result.perPath) {
    lines.push(`  ${entry.tier.padEnd(3)} ${entry.path}`);
    for (const reason of entry.reasons) lines.push(`        ${reason}`);
  }
  for (const warning of result.warnings) lines.push(`  ! ${warning}`);
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const validate = argv.includes('--validate');
  // `--summary` classifies every path it is given and prints only the tier
  // counts. It exists because acceptance criterion 8 requires `verify:full` to
  // perform "classification of all tracked files", and `--validate` does NOT
  // classify anything — it only reports tier-map rules that match no file. Two
  // lanes reported that gap independently. Printing 3,866 per-file records in a
  // gate is unreadable, so the sweep reports the distribution, which is also the
  // growth signal the architecture lane asked for: a T0 count that climbs is
  // visible in every full verification run.
  const summary = argv.includes('--summary');

  const { map, source, error } = loadTierMap(REPO_ROOT);
  if (source === 'error') {
    // Fail closed. Falling back to defaults here would silently drop every
    // declared T0 rule and let a live change through an apparently green gate.
    process.stderr.write(`tier-classify: ${error}\n`);
    process.exit(2);
  }

  // `--changed` collects the changed set IN-PROCESS rather than reading a pipe.
  // Piping the feeder in discarded its exit status (a shell pipeline reports
  // its last command's status), so a git failure became "no changed paths given"
  // and a reassuring default tier — a green gate that inspected nothing.
  const baseIndex = argv.indexOf('--base');
  // A trailing `--base` with no value silently became "no base at all", so
  // `… --changed --base` reported a confident tier against a base the caller
  // believed they had supplied. Asking for a base and not giving one is an
  // error, not a default.
  if (baseIndex >= 0 && baseIndex + 1 >= argv.length) {
    process.stderr.write('tier-classify: --base requires a ref argument.\n');
    process.exit(2);
  }
  const requestedBase = baseIndex >= 0 ? argv[baseIndex + 1] : null;

  let input;
  let deletedPaths = [];
  let base = null;
  let stdinDeletionWarning = null;
  const changedMode = argv.includes('--changed');
  if (changedMode) {
    const collected = collectChangedPaths({ base: requestedBase, repoRoot: REPO_ROOT });
    if (collected.failures.length > 0) {
      process.stderr.write('tier-classify: cannot determine the changed set — refusing to report a tier.\n');
      for (const failure of collected.failures) process.stderr.write(`  - ${failure}\n`);
      process.exit(2);
    }
    input = collected.paths;
    deletedPaths = collected.deleted;
    base = collected.base;
    if (input.length === 0) {
      process.stderr.write(
        `tier-classify: no changes found (working tree clean; ${
          collected.base ? `no commits since ${collected.base}` : 'no base ref configured'
        }).\n`,
      );
    }
  } else {
    input = parsePaths(await readStdin());
    // A path that is absent from the working tree AND present in a reachable
    // revision is an evidenced deletion.
    const absentFromDisk = input.filter((p) => !existsSync(join(REPO_ROOT, normalizePath(p))));
    // THAT IS NOT ENOUGH ON ITS OWN, and the gap was reproduced by two lanes.
    // Deleting a dangerous file and RE-CREATING the same path with harmless
    // content leaves the path present on disk, so the on-disk test alone did not
    // call it a deletion and it graded on the replacement: the identical change
    // returned T0 through `--changed` and T1 here. A reviewer reproducing a CI
    // result by piping paths in would have seen a number CI never produced, and
    // in the quieter direction.
    //
    // So git's `D` records are consulted here too, exactly as `--changed` does,
    // and the two sets are unioned. Collection failure is NOT silent: it degrades
    // to the on-disk test and says so, because a fail-open that reports nothing
    // is the failure mode this whole file exists to avoid.
    let evidencedDeletions = [];
    const collected = collectChangedPaths({ base: requestedBase, repoRoot: REPO_ROOT });
    if (collected.failures.length > 0) {
      stdinDeletionWarning =
        'stdin mode could not read git deletion records, so a deleted-then-recreated path may be ' +
        `graded on its replacement: ${collected.failures.join('; ')}`;
      process.stderr.write(`tier-classify: ${stdinDeletionWarning}\n`);
    } else {
      const declared = new Set(input.map((p) => normalizePath(p)));
      evidencedDeletions = collected.deleted.filter((p) => declared.has(normalizePath(p)));
    }
    deletedPaths = [...new Set([...absentFromDisk, ...evidencedDeletions])];
    // `--base` is honoured here too. Without this the stdin path searched only
    // HEAD while `--changed` searched HEAD and the base, so the SAME deletion
    // graded T1 through one entry point and an ambiguous T0 through the other —
    // and a reviewer reproducing a CI result by piping paths in would see a
    // number CI never produced.
    //
    // It is VERIFIED, not trusted, exactly as `--changed` verifies it. An
    // unresolvable base (a typo, an unfetched ref) would otherwise degrade
    // silently to HEAD-only recovery and reopen that same divergence for the
    // one case where the reviewer least expects it.
    if (requestedBase !== null && !refExists(requestedBase, { repoRoot: REPO_ROOT })) {
      process.stderr.write(
        `tier-classify: base "${requestedBase}" does not resolve to a commit in this repository — ` +
          'refusing to report a tier against a base that does not exist.\n',
      );
      process.exit(2);
    }
    base = requestedBase;
  }

  if (validate) {
    const result = validateTierMap(map, input);
    const payload = { ...result, tierMapSource: source, repoRoot: REPO_ROOT, fileCount: input.length };
    if (asJson) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write(
        `tier-map: ${source}   rules checked against ${input.length} tracked files\n` +
          (result.ok
            ? 'OK — every rule matches at least one tracked file\n'
            : `${result.deadRules.length} dead rule(s):\n${result.warnings.map((w) => `  ! ${w}`).join('\n')}\n`),
      );
    }
    process.exit(result.ok ? 0 : 2);
  }

  // Deleted files have no content on disk, so without this every removed runtime
  // path classified AMBIGUOUS and therefore T0 — a continuous false-positive
  // channel fired by routine cleanup. `git show <rev>:<path>` supplies what the
  // file CONTAINED, so the deletion is graded on what was actually removed.
  // Recovery failures are not downgraded: they stay absent and still fail closed.
  const { contents, recovered, unrecoverable } = recoverDeletedContents(deletedPaths, {
    repoRoot: REPO_ROOT,
    revisions: resolveRecoveryRevisions({ repoRoot: REPO_ROOT, base }),
  });

  // ALL deleted paths are declared, not just the recovered ones, so an
  // unrecoverable deletion reports why it is unanalyzable instead of looking
  // like a file that mysteriously went missing.
  const result = classifyPaths(input, map, { repoRoot: REPO_ROOT, contents, deletedPaths });
  if (stdinDeletionWarning) result.warnings.push(stdinDeletionWarning);
  if (recovered.length > 0) {
    result.warnings.push(
      `${recovered.length} deleted path(s) classified from pre-deletion content in the base revision`,
    );
  }
  if (unrecoverable.length > 0) {
    result.warnings.push(
      `${unrecoverable.length} deleted path(s) had no recoverable pre-deletion content — still failing closed`,
    );
  }
  if (summary) {
    const counts = { T0: 0, T1: 0, T2: 0 };
    for (const entry of result.perPath) counts[entry.tier] += 1;
    const ambiguous = result.perPath.filter((entry) => entry.ambiguous).length;
    if (asJson) {
      process.stdout.write(
        `${JSON.stringify({ counts, ambiguous, fileCount: result.perPath.length, tierMapSource: source }, null, 2)}\n`,
      );
    } else {
      process.stdout.write(
        `tier-sweep: ${result.perPath.length} path(s) classified (tier-map source: ${source})\n` +
          `  T0 ${counts.T0}   T1 ${counts.T1}   T2 ${counts.T2}   ambiguous ${ambiguous}\n`,
      );
    }
    process.exit(0);
  }
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ...result, tierMapSource: source }, null, 2)}\n`);
  } else {
    process.stdout.write(`${printHuman(result, source)}\n`);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`tier-classify: ${err && err.stack ? err.stack : err}\n`);
  process.exit(2);
});
