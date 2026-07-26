import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { LOCK_RESULTS, STALE_AFTER_MS, acquireCycleLock, releaseCycleLock } from '../scripts/ceo-lock.mjs';
import { writeFileAtomic } from '../scripts/ceo-cycle.mjs';

let dir: string;
let lockPath: string;

const NOW = 1_785_000_000_000;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ceo-lock-'));
  lockPath = path.join(dir, '.cycle.lock');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('single-writer lock', () => {
  it('acquires a free lock', () => {
    const result = acquireCycleLock(lockPath, { now: NOW, pid: 111, host: 'a' });

    expect(result.ok).toBe(true);
    expect(result.result).toBe(LOCK_RESULTS.ACQUIRED);
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(111);
  });

  it('refuses while another live process holds it', () => {
    acquireCycleLock(lockPath, { now: NOW, pid: 111, host: 'a' });
    const second = acquireCycleLock(lockPath, { now: NOW + 60_000, pid: 222, host: 'b' });

    expect(second.ok).toBe(false);
    expect(second.result).toBe(LOCK_RESULTS.HELD);
    expect(second.detail).toMatch(/pid 111/);
  });

  it('lets the same process re-enter', () => {
    acquireCycleLock(lockPath, { now: NOW, pid: 111, host: 'a' });
    const again = acquireCycleLock(lockPath, { now: NOW + 5, pid: 111, host: 'a' });

    expect(again.ok).toBe(true);
    expect(again.result).toBe(LOCK_RESULTS.REENTERED);
  });

  it('breaks a stale lock, loudly', () => {
    acquireCycleLock(lockPath, { now: NOW, pid: 111, host: 'a' });
    const later = acquireCycleLock(lockPath, { now: NOW + STALE_AFTER_MS + 1, pid: 222, host: 'b' });

    expect(later.ok).toBe(true);
    expect(later.result).toBe(LOCK_RESULTS.BROKE_STALE);
    expect(later.detail).toMatch(/stale/i);
  });

  it('does not break a lock one millisecond before it goes stale', () => {
    acquireCycleLock(lockPath, { now: NOW, pid: 111, host: 'a' });
    const later = acquireCycleLock(lockPath, { now: NOW + STALE_AFTER_MS, pid: 222, host: 'b' });

    expect(later.ok).toBe(false);
  });

  it('refuses an unreadable lock rather than assuming it is junk', () => {
    // Could be a peer mid-write. Refusing costs one manual delete; guessing costs an interleaved
    // cycle whose history never happened.
    writeFileSync(lockPath, 'not json at all', 'utf8');
    const result = acquireCycleLock(lockPath, { now: NOW, pid: 222 });

    expect(result.ok).toBe(false);
    expect(result.result).toBe(LOCK_RESULTS.UNREADABLE);
  });

  it('fails closed when given no clock', () => {
    expect(() => acquireCycleLock(lockPath, { now: undefined as unknown as number })).toThrow(/clock|now/i);
  });

  it('releases only its own lock', () => {
    acquireCycleLock(lockPath, { now: NOW, pid: 111, host: 'a' });

    expect(releaseCycleLock(lockPath, { pid: 222 })).toBe(false);
    expect(releaseCycleLock(lockPath, { pid: 111 })).toBe(true);
    expect(acquireCycleLock(lockPath, { now: NOW + 1, pid: 222 }).ok).toBe(true);
  });
});

describe('the CLI releases its lock even when the cycle refuses to run', () => {
  // Found by running it. Every refusal in ceo-cycle goes through abort() -> process.exit, which
  // unwinds nothing — so the `finally` never fired and a cycle that halted for a perfectly good
  // reason locked the operator out for the full thirty-minute staleness window.
  it('leaves no lock behind after a discovery-floor abort', () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), 'ceo-cli-'));
    const statePath = path.join(stateDir, 'state.json');
    const measurementPath = path.join(stateDir, 'measurement.json');

    const state = JSON.parse(readFileSync(path.join(__dirname, 'state.json'), 'utf8'));
    writeFileSync(statePath, JSON.stringify(state), 'utf8');
    writeFileSync(
      measurementPath,
      JSON.stringify({
        measurement: { at: '2026-07-26', source: 'manual_count', metrics: state.metrics },
      }),
      'utf8',
    );

    const run = spawnSync(
      process.execPath,
      [
        path.join(__dirname, '..', 'scripts', 'ceo-cycle.mjs'),
        '--state', statePath,
        '--measurement', measurementPath,
        '--candidates', path.join(__dirname, 'fixtures', 'candidates.json'),
        '--reports', path.join(stateDir, 'reports'),
      ],
      { encoding: 'utf8' },
    );

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/DISCOVERY FLOOR/);
    expect(existsSync(path.join(stateDir, '.cycle.lock'))).toBe(false);

    rmSync(stateDir, { recursive: true, force: true });
  });
});

describe('atomic writes', () => {
  it('replaces a file without leaving a truncated window', () => {
    const target = path.join(dir, 'state.json');
    writeFileSync(target, '{"cycle":1}\n', 'utf8');
    writeFileAtomic(target, '{"cycle":2}\n');

    expect(readFileSync(target, 'utf8')).toBe('{"cycle":2}\n');
  });

  it('leaves no temp file behind', () => {
    const target = path.join(dir, 'state.json');
    writeFileAtomic(target, 'x');

    expect(() => readFileSync(`${target}.tmp-${process.pid}`, 'utf8')).toThrow();
  });
});
