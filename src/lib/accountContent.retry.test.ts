import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ACCOUNT_CONTENT_MAX_RETRY_ATTEMPTS,
  ACCOUNT_CONTENT_RETRY_DELAYS_S,
  AccountContentRetryScheduler,
  retryDelayMs,
  retryableOutcome,
} from '@/lib/accountContent.retry';
import {
  getAccountContentCapability,
  noteAccountContentServerResult,
  resetAccountContentCapability,
} from '@/lib/accountContent.capability';

beforeEach(() => {
  vi.useFakeTimers();
  resetAccountContentCapability();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('retryDelayMs — locked schedule with ±20% jitter', () => {
  test('base delays follow 1,2,4,8,16,32,60s and cap at 60', () => {
    const noJitter = () => 0.5; // random 0.5 → jitter 0
    expect(retryDelayMs(1, noJitter)).toBe(1000);
    expect(retryDelayMs(2, noJitter)).toBe(2000);
    expect(retryDelayMs(3, noJitter)).toBe(4000);
    expect(retryDelayMs(4, noJitter)).toBe(8000);
    expect(retryDelayMs(5, noJitter)).toBe(16000);
    expect(retryDelayMs(6, noJitter)).toBe(32000);
    expect(retryDelayMs(7, noJitter)).toBe(60000);
    expect(retryDelayMs(99, noJitter)).toBe(60000);
  });

  test('jitter bounds are ±20%', () => {
    expect(retryDelayMs(1, () => 0)).toBe(800);
    expect(retryDelayMs(1, () => 1)).toBe(1200);
  });
});

describe('AccountContentRetryScheduler', () => {
  test('runs at most six attempts per epoch, then refuses', () => {
    const scheduler = new AccountContentRetryScheduler(() => 0.5);
    let runs = 0;
    for (let i = 1; i <= ACCOUNT_CONTENT_MAX_RETRY_ATTEMPTS; i += 1) {
      expect(scheduler.schedule('lists', () => { runs += 1; })).toBe(i);
      vi.advanceTimersByTime(ACCOUNT_CONTENT_RETRY_DELAYS_S[i - 1] * 1000 + 1);
    }
    expect(runs).toBe(6);
    expect(scheduler.schedule('lists', () => { runs += 1; })).toBeNull();
    vi.advanceTimersByTime(120_000);
    expect(runs).toBe(6);
  });

  test('resetAttempts (online/visible/auth/new mutation) restarts the ladder', () => {
    const scheduler = new AccountContentRetryScheduler(() => 0.5);
    for (let i = 0; i < ACCOUNT_CONTENT_MAX_RETRY_ATTEMPTS; i += 1) {
      scheduler.schedule('lists', () => {});
      vi.advanceTimersByTime(60_000);
    }
    expect(scheduler.schedule('lists', () => {})).toBeNull();
    scheduler.resetAttempts('lists');
    expect(scheduler.schedule('lists', () => {})).toBe(1);
  });

  test('cancelAll (unmount/epoch change) silences every pending timer', () => {
    const scheduler = new AccountContentRetryScheduler(() => 0.5);
    let ran = false;
    scheduler.schedule('lists', () => { ran = true; });
    scheduler.schedule('night_log', () => { ran = true; });
    scheduler.cancelAll();
    vi.advanceTimersByTime(120_000);
    expect(ran).toBe(false);
  });

  test('per-key independence: night_log retries do not consume lists attempts', () => {
    const scheduler = new AccountContentRetryScheduler(() => 0.5);
    scheduler.schedule('night_log', () => {});
    expect(scheduler.attemptsFor('lists')).toBe(0);
    expect(scheduler.attemptsFor('night_log')).toBe(1);
  });
});

describe('retryableOutcome — never retry too-large or unavailable', () => {
  test.each([
    ['fetch-failed', true],
    ['upload-failed', true],
    ['uploaded-unconfirmed', true],
    ['too-large', false],
    ['unavailable', false],
    ['auth-rejected', false],
    ['in-sync', false],
  ])('%s → %s', (outcome, expected) => {
    expect(retryableOutcome(outcome)).toBe(expected);
  });
});

describe('capability state machine', () => {
  test('unknown until proven; ok → available; missing table → unavailable', () => {
    expect(getAccountContentCapability()).toBe('unknown');
    noteAccountContentServerResult('ok');
    expect(getAccountContentCapability()).toBe('available');
    noteAccountContentServerResult('unavailable');
    expect(getAccountContentCapability()).toBe('unavailable');
  });

  test('network failure never flips the verdict (offline stays retryable, not unavailable)', () => {
    noteAccountContentServerResult('failed');
    expect(getAccountContentCapability()).toBe('unknown');
    noteAccountContentServerResult('ok');
    noteAccountContentServerResult('failed');
    expect(getAccountContentCapability()).toBe('available');
  });

  test('auth rejection does not change capability — it is surfaced, not retried into', () => {
    noteAccountContentServerResult('ok');
    noteAccountContentServerResult('auth-rejected');
    expect(getAccountContentCapability()).toBe('available');
  });
});
