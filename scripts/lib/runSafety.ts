import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Continuation safety primitives (goal g-d494ba90). Same identity
 * semantics as the census checkpoint contract (scripts/census/checkpoint.ts
 * keeps its own copy deliberately — it was independently reviewed and this
 * module must stay dependency-free for other tooling to adopt).
 */

export interface RunIdentity {
  version: number;
  configHash: string;
  codeSha: string;
}

export type IdentityRefusal = 'version' | 'config_hash' | 'code_sha';

export function validateRunIdentity(
  stored: RunIdentity,
  expected: RunIdentity,
): { ok: true } | { ok: false; reason: IdentityRefusal } {
  if (stored.version !== expected.version) return { ok: false, reason: 'version' };
  if (stored.configHash !== expected.configHash) return { ok: false, reason: 'config_hash' };
  if (stored.codeSha !== expected.codeSha) return { ok: false, reason: 'code_sha' };
  return { ok: true };
}

/**
 * Idempotent step: the completion marker is written ONLY after fn resolves
 * (atomic temp+rename), so a thrown step leaves no marker and stays
 * retryable, and a completed step is a recorded no-op forever after.
 *
 * CALLER CONTRACT (santa review): this primitive guards crash-then-retry
 * within ONE serialized runner — it is NOT concurrency-safe on its own
 * (the existsSync check and the marker write are separate). Hold the run
 * lock (acquireRunLock) around any runner that uses completeOnce; two
 * unlocked concurrent callers of the same step can both execute fn.
 */
export async function completeOnce(
  markerDir: string,
  stepId: string,
  fn: () => Promise<void>,
): Promise<{ executed: true } | { executed: false; completedAt: string }> {
  // Slug + CONTENT-HASH suffix (Codex review): slugging alone aliases
  // distinct steps ('a/b' vs 'a-b') onto one marker, silently skipping the
  // second step's work. 16 hex chars = 64 bits — accidental collision
  // across any realistic step count is ~n²/2⁶⁵ (Codex confirm pass judged
  // 32 bits birthday-searchable for adversarial ids).
  const idHash = createHash('sha256').update(stepId).digest('hex').slice(0, 16);
  const marker = join(
    markerDir,
    `${stepId.replace(/[^a-zA-Z0-9_-]+/g, '-')}.${idHash}.done.json`,
  );
  if (existsSync(marker)) {
    const prior = JSON.parse(readFileSync(marker, 'utf8')) as { completedAt: string };
    return { executed: false, completedAt: prior.completedAt };
  }
  await fn();
  mkdirSync(dirname(marker), { recursive: true });
  const tmp = `${marker}.tmp`;
  writeFileSync(tmp, JSON.stringify({ stepId, completedAt: new Date().toISOString() }));
  renameSync(tmp, marker);
  return { executed: true };
}

export interface LockHolder {
  runId: string;
  pid: number;
  acquiredAt: string;
}

export type LockResult =
  | { ok: true }
  | { ok: false; reason: 'held' | 'stale'; holder?: LockHolder };

/**
 * KNOWN LIMIT (santa review, both routed lanes): pid liveness proves SOME
 * process holds that pid, not that it is the original holder — Windows
 * recycles pids fast, so a reused pid reads as a live holder and the lock
 * stays stuck until manual cleanup. That failure direction is SAFE (the
 * run refuses instead of double-running); a start-time cross-check is the
 * documented hardening if stuck locks become a real nuisance.
 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Concurrent-run refusal. Exclusive-create ('wx') is the acquisition —
 * there is no read-then-write race — and there is deliberately NO
 * automatic takeover of any kind (santa rounds: three successive
 * takeover designs each reopened a smaller multi-contender race; plain
 * files cannot provide bulletproof crash-recovery takeover, and the goal
 * requires REFUSAL, not recovery). A dead holder is reported 'stale' with
 * the holder named; recovery is the explicit, attended releaseRunLock —
 * never something two racing processes can do to each other.
 */
export function acquireRunLock(lockFile: string, runId: string): LockResult {
  const payload = JSON.stringify({
    runId,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  } satisfies LockHolder);
  try {
    mkdirSync(dirname(lockFile), { recursive: true });
    writeFileSync(lockFile, payload, { flag: 'wx' });
    return { ok: true };
  } catch (err) {
    // ONLY an existing lock is a refusal; every other failure (EACCES,
    // ENOSPC, bad path) is a real error and must surface as one — calling
    // it 'stale' would invite a manual release of a lock that never
    // existed (Codex confirm pass).
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    // Lock exists — inspect and refuse with the most useful typed reason.
    let holder: LockHolder | undefined;
    try {
      holder = JSON.parse(readFileSync(lockFile, 'utf8')) as LockHolder;
    } catch {
      holder = undefined;
    }
    const alive = holder ? pidAlive(holder.pid) : false;
    return { ok: false, reason: alive ? 'held' : 'stale', holder };
  }
}

export function releaseRunLock(lockFile: string): void {
  rmSync(lockFile, { force: true });
}
