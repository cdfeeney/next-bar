import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * Checkpoint contract (operator-locked): version, run ID, provider, coverage
 * unit, cursor, call count, config hash, code SHA, data version, last
 * successful unit. Saved atomically after each completed unit; a resume
 * REFUSES any checkpoint whose version/config-hash/code-SHA does not match
 * the current invocation — stale checkpoints are never "probably fine".
 *
 * Accepted drift, documented: a crash between a unit completing and its
 * checkpoint save re-runs that ONE unit on resume. Unit output files are
 * overwritten (never appended), so the only cost is one unit's worth of
 * re-spent budget — bounded and honest, per design review.
 */

export interface Checkpoint {
  version: 1;
  runId: string;
  provider: string;
  coverageUnit: string;
  cursor: string | null;
  callCount: number;
  configHash: string;
  codeSha: string;
  dataVersion: string;
  lastSuccessfulUnit: string | null;
}

export type CheckpointValidation =
  | { ok: true }
  | { ok: false; reason: 'version' | 'config_hash' | 'code_sha' };

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function configHashOf(config: unknown): string {
  return createHash('sha256').update(stableStringify(config)).digest('hex');
}

export function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Atomic write: temp file in the same directory, then rename. */
export function writeFileAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
}

export function saveCheckpoint(file: string, cp: Checkpoint): void {
  writeFileAtomic(file, JSON.stringify(cp, null, 2));
}

export function loadCheckpoint(file: string): Checkpoint {
  return JSON.parse(readFileSync(file, 'utf8')) as Checkpoint;
}

export function validateCheckpoint(
  cp: Checkpoint,
  expected: { configHash: string; codeSha: string },
): CheckpointValidation {
  if (cp.version !== 1) return { ok: false, reason: 'version' };
  if (cp.configHash !== expected.configHash) return { ok: false, reason: 'config_hash' };
  if (cp.codeSha !== expected.codeSha) return { ok: false, reason: 'code_sha' };
  return { ok: true };
}
