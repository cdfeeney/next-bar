'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationalStateKind } from './OperationalState';

/**
 * The retry policy V8-R-OPS-001 and V8-R-OPS-007 both state, in one place.
 *
 * "capped at 3 silent auto-retries, then manual" is a rule about the WHOLE
 * app, and the way it goes wrong is that every surface re-implements it with a
 * different cap, or retries forever, or gives up on the first failure and
 * shows a dead screen. So the cap lives here as a constant and the decision
 * lives here as a pure predicate that a test can pin.
 *
 * The other half of the requirement is that saved data is NEVER blanked: once
 * a load has succeeded, a later failure is `stale`, not `failed`. The last
 * good value is kept and handed back, and the surface keeps rendering it under
 * a small label. `failed` is reserved for a surface that has nothing to show.
 *
 * WHO APPLIES THIS POLICY TODAY, stated because "the app's retry rule lives in
 * one place" is only true to the extent surfaces actually use it:
 *
 *   - `src/app/settings/connections/blocked/page.tsx` uses the hook directly.
 *   - `src/app/settings/_useOwnProfile.ts` imports `shouldAutoRetry` and
 *     applies the same cap by hand. It cannot use the hook itself: the hook
 *     has no "not applicable" state, and signed-out is not a failure —
 *     modelling it as a null load would spend the budget on every signed-out
 *     render. The predicate is shared so the cap still has ONE definition.
 *   - Everything else in `src/` still has its own state machine. The nearest
 *     one, `StoriesEmptyState`, exposes a manual retry on the FIRST failure
 *     instead of retrying silently three times — a real divergence from
 *     V8-R-OPS-001, and one this lane cannot close: `src/components/` outside
 *     `states/` is another lane's write scope. Converting those surfaces is an
 *     integration follow-up, not a lane fix.
 */

/** V8-R-OPS-001 / V8-R-OPS-007: three, then the user asks. */
export const SILENT_AUTO_RETRY_CAP = 3;

/**
 * Should another silent attempt follow, given how many have already failed?
 * Pure, so the boundary is testable without a component or a clock.
 */
export function shouldAutoRetry(failures: number): boolean {
  return failures < SILENT_AUTO_RETRY_CAP;
}

/** What the caller loads. `null` means "it did not work" — no throw, matching
 *  the repo's server-module convention. */
export type OperationalLoader<T> = () => Promise<T | null>;

export type OperationalLoad<T> = {
  /** The kind to hand `OperationalState`, or null once there is nothing to
   *  report — a successful load with live data is not an operational state. */
  state: OperationalStateKind | null;
  /** The last value that actually loaded. Kept across a later failure. */
  value: T | null;
  /** Consecutive failures since the last success. */
  failures: number;
  /** True once the silent budget is spent and the retry is the user's to ask
   *  for. This is what decides whether the surface offers a Retry button. */
  needsManualRetry: boolean;
  /** The manual retry. */
  retry: () => void;
};

/**
 * Load something, applying the operational-state contract to the result.
 *
 * Auto-retries are consecutive and immediate: the requirement caps how many
 * times the app may quietly try again, not how fast. A backoff would be a
 * different promise than the one the contract makes, and a timer here would
 * make every consumer's test wait on a clock.
 */
export function useOperationalLoad<T>(
  load: OperationalLoader<T>,
): OperationalLoad<T> {
  const [value, setValue] = useState<T | null>(null);
  const [failures, setFailures] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [inFlight, setInFlight] = useState(true);
  // The loader is usually an inline closure, so depending on its identity
  // would re-run this on every render. The ref keeps the effect keyed on the
  // ATTEMPT instead, which is the thing that actually means "load again".
  const loader = useRef(load);
  loader.current = load;
  // Mirrors `failures` for the reconnect listener, which is bound once and so
  // cannot close over the state value.
  const failuresNow = useRef(failures);
  failuresNow.current = failures;

  useEffect(() => {
    let cancelled = false;
    setInFlight(true);
    void loader.current().then(
      (next) => {
        if (cancelled) return;
        setInFlight(false);
        if (next === null) {
          setFailures((count) => count + 1);
          return;
        }
        setFailures(0);
        setValue(next);
      },
      () => {
        if (cancelled) return;
        setInFlight(false);
        setFailures((count) => count + 1);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Spending the silent budget is its own effect so the state updater above
  // stays pure — an updater that also schedules work runs twice under React's
  // development double-invoke and would burn two attempts for one failure.
  useEffect(() => {
    if (failures > 0 && shouldAutoRetry(failures - 1)) {
      setAttempt((n) => n + 1);
    }
  }, [failures]);

  const retry = useCallback(() => {
    setFailures(0);
    setAttempt((n) => n + 1);
  }, []);

  /**
   * V8-R-OPS-007's other half: stale content "refreshes in the background on
   * reconnect". Without this the silent budget is spent while the network is
   * down and the degraded card then sits there after connectivity returns,
   * waiting for a tap the user has no reason to know is needed.
   *
   * It fires only when something has actually failed, so a healthy surface is
   * never re-fetched by a passing network blip, and it performs exactly the
   * `retry` transition rather than a second, subtly different one.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onReconnect = (): void => {
      // `failuresNow` rather than a `setFailures` updater that also schedules
      // work: React double-invokes updaters in development, and one that bumps
      // `attempt` would burn two loads for one reconnect — the same trap the
      // silent-budget effect above is written to avoid.
      if (failuresNow.current === 0) return;
      setFailures(0);
      setAttempt((n) => n + 1);
    };
    window.addEventListener('online', onReconnect);
    return () => window.removeEventListener('online', onReconnect);
  }, []);

  const needsManualRetry = failures > 0 && !shouldAutoRetry(failures - 1);

  return {
    state: deriveState(inFlight, needsManualRetry, failures, value),
    value,
    failures,
    needsManualRetry,
    retry,
  };
}

/**
 * The state machine, extracted so it reads as the rule it is:
 *
 *   - a request is in flight, or a silent retry is about to start → loading
 *   - out of silent retries, and we have something to show        → stale
 *   - out of silent retries, and we have nothing                  → failed
 *   - loaded                                                      → null
 *
 * `empty` is deliberately NOT derived here: only the caller knows whether an
 * empty list means "you have not done this yet" or "the filter matched
 * nothing", and inventing one of those would be this hook speaking for a
 * surface it does not own.
 */
function deriveState<T>(
  inFlight: boolean,
  needsManualRetry: boolean,
  failures: number,
  value: T | null,
): OperationalStateKind | null {
  if (inFlight) return 'loading';
  if (failures === 0) return null;
  if (!needsManualRetry) return 'loading';
  return value === null ? 'failed' : 'stale';
}
