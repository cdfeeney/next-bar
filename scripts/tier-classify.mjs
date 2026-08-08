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
  const requestedBase = baseIndex >= 0 && baseIndex + 1 < argv.length ? argv[baseIndex + 1] : null;

  let input;
  let deletedPaths = [];
  let base = null;
  if (argv.includes('--changed')) {
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
    // No `--name-status` evidence on this path, but git still holds the other
    // half of it: a path that is absent from the working tree AND present in a
    // reachable revision is an evidenced deletion. Anything else stays
    // unrecognised and keeps failing closed.
    deletedPaths = input.filter((p) => !existsSync(join(REPO_ROOT, normalizePath(p))));
    // `--base` is honoured here too. Without this the stdin path searched only
    // HEAD while `--changed` searched HEAD and the base, so the SAME deletion
    // graded T1 through one entry point and an ambiguous T0 through the other —
    // and a reviewer reproducing a CI result by piping paths in would see a
    // number CI never produced.
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
