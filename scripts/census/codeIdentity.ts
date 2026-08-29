import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

/**
 * Code identity for checkpoints and the apply sidecar. HEAD alone is blind
 * to UNCOMMITTED edits of the generation logic (santa round-3): a tweaked
 * tiles.ts or dedupe.ts would pass every code_sha/code_drift check while
 * silently changing resume arithmetic and filtering. Dirt in the
 * generation-relevant paths therefore taints the SHA with a CONTENT hash
 * of those files — not a bare '-dirty' marker, which would let two
 * different uncommitted states masquerade as the same code (Codex
 * round-3). Identical uncommitted state still matches itself, so
 * iterating without committing works; any edit changes the identity.
 *
 * Extracted from run-census.mts (Codex T0 review of f5d1579, HIGH): the
 * old inline version ran `.trim()` on the WHOLE porcelain output before
 * splitting, which ate the leading status char of the FIRST line — its
 * `slice(3)` then produced a mangled path ('cripts/…'), readFileSync
 * threw, and that file's content collapsed to the constant '<deleted>'.
 * The first-sorted dirty file could change without changing the identity:
 * exactly the fail-open this function exists to prevent. Parsing is now
 * per-line and unit-tested.
 */

export function dirtyPathsFromPorcelain(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    // A porcelain line is `XY <path>` — two status chars + space. Never
    // trim the line first; that is the Codex-H1 first-line mangler.
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim())
    .filter((p) => p && !p.startsWith('scripts/census/out'))
    .sort();
}

export function currentCodeSha(): string {
  const head = execSync('git rev-parse HEAD').toString().trim();
  // -uall is load-bearing (Codex confirm pass): without it an UNTRACKED
  // directory prints as one `?? scripts/census/` line, readFileSync on the
  // directory throws, and the "content hash" collapses to a constant —
  // exactly the fail-open this function exists to prevent.
  const porcelain = execSync(
    'git status --porcelain -uall -- scripts/census src/lib/catalogServer.ts',
  ).toString();
  const files = dirtyPathsFromPorcelain(porcelain);
  if (files.length === 0) return head;
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f);
    try {
      hash.update(fs.readFileSync(f));
    } catch {
      hash.update('<deleted>');
    }
  }
  return `${head}-dirty-${hash.digest('hex').slice(0, 12)}`;
}
