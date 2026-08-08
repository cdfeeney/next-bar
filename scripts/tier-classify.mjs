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

import { classifyPaths, loadTierMap, validateTierMap, REPO_ROOT } from './lib/tier-classify-core.mjs';

/** Read all of stdin as UTF-8. Returns '' when stdin is a TTY (no input piped). */
async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** Split piped input into paths. Tolerates CRLF, blank lines and quoting. */
function parsePaths(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^"(.*)"$/, '$1'))
    .filter((line) => line.length > 0);
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

  const input = parsePaths(await readStdin());

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

  const result = classifyPaths(input, map, { repoRoot: REPO_ROOT });
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
