// Single-writer lock for the CEO cycle.
//
// Three Claude terminals hold git worktrees of this repository at once. They do not share a
// working directory, but they DO share the CEO's durable files when run against the same paths,
// and two cycles interleaving over one state.json would produce a history that never happened.
//
// The clock lives here and nowhere else in the orchestrator. `now` is injected rather than read,
// so the cycle runner stays clock-free and deterministic, and so a stale-lock test does not have
// to wait thirty real minutes to run.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';

/** After this, a lock is assumed to belong to a process that died without releasing it. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

export const LOCK_RESULTS = Object.freeze({
  ACQUIRED: 'acquired',
  BROKE_STALE: 'broke_stale',
  REENTERED: 'reentered',
  HELD: 'held',
  UNREADABLE: 'unreadable',
});

function assertNow(now) {
  if (!Number.isFinite(now)) {
    throw new TypeError(
      `[ceo-lock] now must be a finite epoch-millisecond number; got ${JSON.stringify(now ?? null)}. ` +
        'A lock with no clock can never go stale, so it would wedge the cycle forever.',
    );
  }
}

function writeLock(lockPath, holder, { exclusive }) {
  writeFileSync(lockPath, JSON.stringify(holder, null, 2) + '\n', {
    encoding: 'utf8',
    // 'wx' fails if the file already exists. Checking existence and then writing is a race two
    // terminals can both win; letting the filesystem do the check is the whole point.
    ...(exclusive ? { flag: 'wx' } : {}),
  });
}

/**
 * Try to take the lock.
 *
 * Returns a result rather than throwing, because "someone else is running a cycle" is an ordinary
 * outcome the CLI should report calmly, not a crash.
 */
export function acquireCycleLock(lockPath, { now, pid = process.pid, host = 'unknown' } = {}) {
  assertNow(now);
  const holder = { pid, host, at: now };

  try {
    writeLock(lockPath, holder, { exclusive: true });
    return { result: LOCK_RESULTS.ACQUIRED, ok: true, holder, detail: `Lock taken by pid ${pid}.` };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  let existing;
  try {
    existing = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    // A lock we cannot read is not a lock we may ignore. It could be a peer mid-write; refusing
    // costs one manual delete, and guessing costs an interleaved cycle.
    return {
      result: LOCK_RESULTS.UNREADABLE,
      ok: false,
      holder: null,
      detail: `Lock file at ${lockPath} exists but could not be read. Delete it by hand once you are sure no cycle is running.`,
    };
  }

  if (existing?.pid === pid) {
    return {
      result: LOCK_RESULTS.REENTERED,
      ok: true,
      holder: existing,
      detail: `Lock already held by this process (pid ${pid}).`,
    };
  }

  const age = now - (Number.isFinite(existing?.at) ? existing.at : now);
  if (age > STALE_AFTER_MS) {
    // Loud on purpose: breaking someone else's lock is a thing the operator should see happen.
    writeLock(lockPath, holder, { exclusive: false });
    return {
      result: LOCK_RESULTS.BROKE_STALE,
      ok: true,
      holder,
      detail:
        `Broke a stale lock: pid ${existing?.pid ?? '?'} on ${existing?.host ?? '?'} held it for ` +
        `${Math.round(age / 60000)} minutes (stale after ${STALE_AFTER_MS / 60000}).`,
    };
  }

  return {
    result: LOCK_RESULTS.HELD,
    ok: false,
    holder: existing,
    detail:
      `Another cycle holds the lock: pid ${existing?.pid ?? '?'} on ${existing?.host ?? '?'}, ` +
      `${Math.round(age / 1000)}s old. Not running.`,
  };
}

/** Release only our own lock. Releasing someone else's is how two writers both think they won. */
export function releaseCycleLock(lockPath, { pid = process.pid } = {}) {
  let existing;
  try {
    existing = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return false;
  }

  if (existing?.pid !== pid) return false;
  rmSync(lockPath, { force: true });
  return true;
}
