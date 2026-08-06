/**
 * accountContent.retry — per-key bounded backoff for account-content sync
 * (v2.1).
 *
 * Schedule per the locked spec: 1, 2, 4, 8, 16, 32, 60 seconds with ±20%
 * jitter and AT MOST SIX attempts per epoch (attempts 1–6 draw delays
 * 1…32s; the 60s entry is the schedule's terminal cap, reachable only if
 * the attempt cap is ever raised). Attempt counters reset on: coming back
 * online, the tab becoming visible, an auth change, or a NEW local
 * mutation of that key. Everything cancels on unmount or epoch change.
 *
 * The scheduler never decides WHAT to retry — 'too-large' and 'unavailable'
 * outcomes must not be scheduled at all (caller-enforced and asserted here
 * via `retryableOutcome`).
 */

export const ACCOUNT_CONTENT_RETRY_DELAYS_S = [1, 2, 4, 8, 16, 32, 60] as const;
export const ACCOUNT_CONTENT_MAX_RETRY_ATTEMPTS = 6;
export const ACCOUNT_CONTENT_RETRY_JITTER = 0.2;

/** Outcomes that may re-enter the schedule. */
export function retryableOutcome(outcome: string): boolean {
  return (
    outcome === 'fetch-failed' ||
    outcome === 'upload-failed' ||
    outcome === 'uploaded-unconfirmed'
  );
}

/** Delay before retry `attempt` (1-based), jittered ±20%. */
export function retryDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const index = Math.min(
    Math.max(attempt, 1) - 1,
    ACCOUNT_CONTENT_RETRY_DELAYS_S.length - 1,
  );
  const base = ACCOUNT_CONTENT_RETRY_DELAYS_S[index] * 1000;
  const jitter = (random() * 2 - 1) * ACCOUNT_CONTENT_RETRY_JITTER;
  return Math.round(base * (1 + jitter));
}

type Entry = {
  timer: ReturnType<typeof setTimeout>;
  attempt: number;
};

export class AccountContentRetryScheduler {
  private entries = new Map<string, Entry>();

  private attempts = new Map<string, number>();

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * Schedule the next retry for a key. Returns the attempt number scheduled,
   * or null when the per-epoch cap is exhausted.
   */
  schedule(key: string, fn: () => void): number | null {
    this.cancel(key);
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    if (attempt > ACCOUNT_CONTENT_MAX_RETRY_ATTEMPTS) return null;
    this.attempts.set(key, attempt);
    const timer = setTimeout(() => {
      this.entries.delete(key);
      fn();
    }, retryDelayMs(attempt, this.random));
    this.entries.set(key, { timer, attempt });
    return attempt;
  }

  /** A fresh signal (online/visible/auth/new mutation) restarts the ladder. */
  resetAttempts(key?: string): void {
    if (key === undefined) {
      this.attempts.clear();
      return;
    }
    this.attempts.delete(key);
  }

  cancel(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      this.entries.delete(key);
    }
  }

  /** Unmount / epoch change: nothing may fire afterwards. */
  cancelAll(): void {
    for (const [, entry] of this.entries) clearTimeout(entry.timer);
    this.entries.clear();
    this.attempts.clear();
  }

  attemptsFor(key: string): number {
    return this.attempts.get(key) ?? 0;
  }

  pending(key: string): boolean {
    return this.entries.has(key);
  }
}
