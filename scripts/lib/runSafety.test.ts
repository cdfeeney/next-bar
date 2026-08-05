import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireRunLock,
  releaseRunLock,
  completeOnce,
  validateRunIdentity,
} from './runSafety';

/**
 * Continuation safety primitives (goal g-d494ba90): identity validation
 * (same semantics as the census checkpoint contract), idempotent steps,
 * and concurrent-run refusal.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runsafety-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('validateRunIdentity', () => {
  const identity = { version: 1, configHash: 'cfg', codeSha: 'sha' };

  it('accepts a matching identity and refuses each stale component with a typed reason', () => {
    expect(validateRunIdentity(identity, identity)).toEqual({ ok: true });
    expect(
      validateRunIdentity({ ...identity, configHash: 'other' }, identity),
    ).toEqual({ ok: false, reason: 'config_hash' });
    expect(
      validateRunIdentity({ ...identity, codeSha: 'other' }, identity),
    ).toEqual({ ok: false, reason: 'code_sha' });
    expect(
      validateRunIdentity({ ...identity, version: 2 }, identity),
    ).toEqual({ ok: false, reason: 'version' });
  });
});

describe('completeOnce (idempotency)', () => {
  it('runs the step once; re-running is a recorded no-op', async () => {
    let runs = 0;
    const first = await completeOnce(dir, 'step-a', async () => {
      runs += 1;
    });
    expect(first).toEqual({ executed: true });
    const second = await completeOnce(dir, 'step-a', async () => {
      runs += 1;
    });
    expect(second.executed).toBe(false);
    if (!second.executed) expect(second.completedAt).toBeTruthy();
    expect(runs).toBe(1);
  });

  it("distinct step ids that slug identically do NOT alias ('a/b' vs 'a-b')", async () => {
    let runs = 0;
    await completeOnce(dir, 'a/b', async () => {
      runs += 1;
    });
    const second = await completeOnce(dir, 'a-b', async () => {
      runs += 1;
    });
    expect(second).toEqual({ executed: true }); // different step, must run
    expect(runs).toBe(2);
  });

  it('a step that throws leaves NO completion marker (retryable)', async () => {
    await expect(
      completeOnce(dir, 'step-b', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    let runs = 0;
    const retry = await completeOnce(dir, 'step-b', async () => {
      runs += 1;
    });
    expect(retry).toEqual({ executed: true });
    expect(runs).toBe(1);
  });
});

describe('acquireRunLock (concurrent-run refusal)', () => {
  it('non-EEXIST filesystem failures THROW instead of masquerading as stale', () => {
    // A path that cannot exist: NUL byte is invalid on every platform.
    expect(() => acquireRunLock('\0invalid/run.lock', 'run-X')).toThrow();
  });

  it('second acquisition against a live lock REFUSES with the holder named', () => {
    const lock = join(dir, 'run.lock');
    const a = acquireRunLock(lock, 'run-A');
    expect(a).toEqual({ ok: true });
    const b = acquireRunLock(lock, 'run-B');
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.reason).toBe('held');
      expect(b.holder?.runId).toBe('run-A');
    }
    releaseRunLock(lock);
    expect(existsSync(lock)).toBe(false);
    // After release, acquisition succeeds again.
    expect(acquireRunLock(lock, 'run-B')).toEqual({ ok: true });
  });

  it('a DEAD holder is a STALE refusal — never an automatic takeover', () => {
    const lock = join(dir, 'run.lock');
    // Forge a lock held by a certainly-dead pid.
    writeFileSync(
      lock,
      JSON.stringify({ runId: 'run-dead', pid: 999999999, acquiredAt: '2026-08-01T00:00:00Z' }),
    );
    const refused = acquireRunLock(lock, 'run-C');
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe('stale');
      expect(refused.holder?.runId).toBe('run-dead'); // operator sees who died
    }
    // Recovery is EXPLICIT and attended: releaseRunLock, then reacquire.
    // (Santa rounds proved every automatic file-based takeover reopens a
    // multi-contender race; refusal is the contract, recovery is manual.)
    releaseRunLock(lock);
    expect(acquireRunLock(lock, 'run-C')).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(lock, 'utf8')).runId).toBe('run-C');
  });
});
