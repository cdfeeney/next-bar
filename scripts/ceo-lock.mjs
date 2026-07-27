// Single-writer lock for the CEO cycle.
//
// Three Claude terminals hold git worktrees of this repository at once. They do not share a working
// directory, but they DO share the CEO's durable files when run against the same paths, and two
// cycles interleaving over one state.json would produce a history that never happened.
//
// The clock lives here and nowhere else in the orchestrator. `now` is injected rather than read, so
// the cycle runner stays clock-free and deterministic, and so a stale-lock test does not have to
// wait thirty real minutes to run.
//
// The shape is ported from ~/.claude/lib/file-lock.mjs, which had already solved this properly, and
// the first version here reinvented it badly. Three things it gets right that the naive version did
// not, all found by independent review:
//
//  1. BREAKING A STALE LOCK IS NOT remove-then-create. Two breakers reading the same stale lock both
//     removed and both created, so both believed they had won — the interleaved cycle the lock
//     exists to prevent, arriving exactly when the system had been left alone long enough for two
//     people to come back to it. The break happens under a separate exclusive mutex file.
//  2. RELEASE CHECKS A NONCE, NOT A PID, AND RUNS UNDER THE SAME MUTEX. Verifying the pid and then
//     removing is a read-then-write race: a breaker can install a successor in between, and the
//     departing holder deletes the newcomer's lock, admitting a third writer.
//  3. STALENESS IS AGE **AND** DEATH. Age alone declares a live thirty-minute cycle abandoned and
//     hands its files to a second writer.

import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** After this, a lock MAY be stale — but only if its holder is also gone. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

/** A break mutex older than this was left by a crash mid-break and may be cleared. */
const MUTEX_STALE_MS = 60 * 1000;

export const LOCK_RESULTS = Object.freeze({
  ACQUIRED: 'acquired',
  BROKE_STALE: 'broke_stale',
  REENTERED: 'reentered',
  HELD: 'held',
  UNREADABLE: 'unreadable',
  CONTENDED: 'contended',
});

function assertNow(now) {
  if (!Number.isFinite(now)) {
    throw new TypeError(
      `[ceo-lock] now must be a finite epoch-millisecond number; got ${JSON.stringify(now ?? null)}. ` +
        'A lock with no clock can never go stale, so it would wedge the cycle forever.',
    );
  }
}

/**
 * Is this process still running?
 *
 * `kill(pid, 0)` sends no signal and only asks. EPERM means it exists and belongs to someone else,
 * which still answers the question being asked. Only a pid on THIS host can be checked, so a lock
 * from another machine falls back to the age test alone.
 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readRecord(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return { __corrupt: true };
  }
}

function writeExclusive(filePath, payload) {
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
}

/**
 * Run `fn` while holding an exclusive break mutex, or return `null` if another process holds it.
 *
 * Deliberately does not queue or retry: the caller's answer to "someone else is mid-break" is the
 * ordinary CONTENDED result, and a cycle that waits its turn to break a lock is a cycle two people
 * are running at once anyway.
 */
function withBreakMutex(lockPath, now, fn) {
  const mutex = `${lockPath}.mx`;
  const nonce = randomUUID();

  try {
    writeExclusive(mutex, { pid: process.pid, at: now, nonce });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;

    // A mutex left behind by a crash mid-break must not wedge the lock forever. Only clear one that
    // is BOTH old and owned by a dead process, and clear it by rename so two clearers cannot both
    // proceed — the same discipline the mutex itself exists to enforce.
    const held = readRecord(mutex);
    const holderGone = !held || held.__corrupt || !pidAlive(held.pid);
    const aged = !held || held.__corrupt || !Number.isFinite(held.at) || now - held.at > MUTEX_STALE_MS;
    if (!(holderGone && aged)) return null;

    const tomb = `${mutex}.dead-${process.pid}-${nonce}`;
    try {
      renameSync(mutex, tomb);
      rmSync(tomb, { force: true });
    } catch (renameError) {
      if (renameError?.code !== 'ENOENT') throw renameError;
      return null; // someone else cleared it first; let them have the turn
    }
    try {
      writeExclusive(mutex, { pid: process.pid, at: now, nonce });
    } catch (retryError) {
      if (retryError?.code !== 'EEXIST') throw retryError;
      return null;
    }
  }

  try {
    return fn();
  } finally {
    // Only ever remove OUR mutex. Anything else is deleting a successor's.
    const current = readRecord(mutex);
    if (current && !current.__corrupt && current.nonce === nonce) {
      rmSync(mutex, { force: true });
    }
  }
}

/**
 * Try to take the lock.
 *
 * Returns a result rather than throwing, because "someone else is running a cycle" is an ordinary
 * outcome the CLI should report calmly, not a crash.
 *
 * `now` is annotated optional so the signature stays callable, and required in practice by
 * assertNow — a lock with no clock can never go stale, so it would wedge the cycle forever.
 *
 * @param {string} lockPath
 * @param {{ now?: number, pid?: number, host?: string }} [options]
 */
export function acquireCycleLock(lockPath, { now, pid = process.pid, host = 'unknown' } = {}) {
  assertNow(now);
  const nonce = randomUUID();
  const holder = { pid, host, at: now, nonce };

  try {
    writeExclusive(lockPath, holder);
    return { result: LOCK_RESULTS.ACQUIRED, ok: true, holder, detail: `Lock taken by pid ${pid}.` };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  const existing = readRecord(lockPath);

  if (existing === null) {
    // It vanished between the failed create and the read — a release landed in the gap. One retry;
    // if that loses too, report contention rather than looping in a cycle runner.
    try {
      writeExclusive(lockPath, holder);
      return { result: LOCK_RESULTS.ACQUIRED, ok: true, holder, detail: `Lock taken by pid ${pid}.` };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      return {
        result: LOCK_RESULTS.CONTENDED,
        ok: false,
        holder: null,
        detail: 'Another cycle took the lock while this one was starting. Not running.',
      };
    }
  }

  if (existing.__corrupt) {
    // A lock we cannot read is not a lock we may ignore. It could be a peer mid-write; refusing
    // costs one manual delete, and guessing costs an interleaved cycle.
    return {
      result: LOCK_RESULTS.UNREADABLE,
      ok: false,
      holder: null,
      detail: `Lock file at ${lockPath} exists but could not be read. Delete it by hand once you are sure no cycle is running.`,
    };
  }

  if (existing.pid === pid) {
    return {
      result: LOCK_RESULTS.REENTERED,
      ok: true,
      holder: existing,
      detail: `Lock already held by this process (pid ${pid}).`,
    };
  }

  const age = now - (Number.isFinite(existing.at) ? existing.at : now);
  const aged = age > STALE_AFTER_MS;
  const holderGone = !pidAlive(existing.pid);

  // Age alone is not abandonment. A cycle that has legitimately run past the staleness window is
  // still a running cycle, and handing its files to a second writer is the failure this prevents.
  if (!aged || !holderGone) {
    return {
      result: LOCK_RESULTS.HELD,
      ok: false,
      holder: existing,
      detail:
        `Another cycle holds the lock: pid ${existing.pid ?? '?'} on ${existing.host ?? '?'}, ` +
        `${Math.round(age / 1000)}s old${aged ? ' (aged, but the process is still alive)' : ''}. Not running.`,
    };
  }

  const broke = withBreakMutex(lockPath, now, () => {
    // Re-read INSIDE the mutex. The lock may have been released, broken, or refreshed while we were
    // deciding, and acting on the stale read is the whole bug this mutex exists to prevent.
    const current = readRecord(lockPath);
    if (current === null) {
      try {
        writeExclusive(lockPath, holder);
        return { ok: true, replaced: null };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        return { ok: false };
      }
    }
    if (current.__corrupt) return { ok: false };
    if (current.nonce !== existing.nonce) return { ok: false }; // a different holder now
    if (!(now - (Number.isFinite(current.at) ? current.at : now) > STALE_AFTER_MS)) return { ok: false };
    if (pidAlive(current.pid)) return { ok: false };

    const tomb = `${lockPath}.dead-${process.pid}-${nonce}`;
    renameSync(lockPath, tomb);
    rmSync(tomb, { force: true });
    writeExclusive(lockPath, holder);
    return { ok: true, replaced: current };
  });

  if (broke === null || broke.ok !== true) {
    return {
      result: LOCK_RESULTS.CONTENDED,
      ok: false,
      holder: readRecord(lockPath),
      detail: 'Lost the race to break a stale lock; another cycle is taking it. Not running.',
    };
  }

  // Loud on purpose: breaking someone else's lock is a thing the operator should see happen.
  return {
    result: LOCK_RESULTS.BROKE_STALE,
    ok: true,
    holder,
    detail:
      `Broke a stale lock: pid ${broke.replaced?.pid ?? '?'} on ${broke.replaced?.host ?? '?'} held it ` +
      `for ${Math.round(age / 60000)} minutes and that process is gone ` +
      `(stale after ${STALE_AFTER_MS / 60000} minutes AND death).`,
  };
}

/**
 * Release only our own lock.
 *
 * Matches on NONCE, not pid, and does the check-and-remove under the break mutex. Pid equality is
 * not identity — pids are reused, and more importantly a breaker can install a successor between a
 * bare check and the removal, at which point the departing holder deletes the newcomer's lock and
 * a third writer walks in.
 *
 * @param {string} lockPath
 * @param {{ nonce?: string, pid?: number, now?: number }} [options]
 */
export function releaseCycleLock(lockPath, { nonce, pid = process.pid, now = Date.now() } = {}) {
  const result = withBreakMutex(lockPath, now, () => {
    const current = readRecord(lockPath);
    if (!current || current.__corrupt) return false;

    // A nonce identifies one acquisition. Fall back to pid only when the caller has none, which is
    // the CLI's own exit path where the lock was written by this very process.
    const ours = nonce === undefined ? current.pid === pid : current.nonce === nonce;
    if (!ours) return false;

    rmSync(lockPath, { force: true });
    return true;
  });

  return result === true;
}
