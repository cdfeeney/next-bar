'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The shared operational-state surface (V8-R-OPS-001, V8-R-OPS-007).
 *
 * Approved canvas `next-bar-operational-states-v1`. Every degraded state in
 * the app renders through this one component so the four rules the requirement
 * actually cares about are enforced in ONE place instead of being re-argued on
 * every screen:
 *
 *   1. IT RETAINS ITS SURROUNDING CONTEXT. `children` is whatever the surface
 *      already had and is rendered FIRST, always. A degraded state never
 *      blanks the screen — that is what `stale` is for: saved data stays
 *      visible with a small label rather than disappearing.
 *   2. IT STATES PLAINLY WHAT IS TRUE. `message` is required and is the whole
 *      of what the user is told. `assertNamesTheFailure` refuses the vague
 *      "an error occurred" that V8-R-OPS-007 excludes by name.
 *   3. AT MOST ONE PRIMARY RECOVERY. `recovery` is a single optional object,
 *      not a list. The type is the enforcement: there is no way to render two.
 *   4. IT NEVER PRESENTS A FALLBACK AS A SUCCESS. There is no "ok" or
 *      "resolved" kind — this component only ever renders a degraded state,
 *      and the caller stops rendering it when the real thing arrives.
 *
 * Accessibility: focus moves to the recovery action when the state CHANGES to
 * one that has it — not on first paint, where nothing has swapped and stealing
 * focus would be the bug. Focus is taken with `preventScroll` so the content
 * the user was reading is not auto-scrolled out from under them.
 */

/** The seven states the canvas draws. */
export type OperationalStateKind =
  | 'loading'
  | 'empty'
  | 'denied'
  | 'failed'
  | 'offline'
  | 'queued'
  | 'stale';

export type OperationalRecovery = {
  label: string;
  onAction: () => void;
};

/**
 * The exclusion V8-R-OPS-007 states outright: no vague "an error occurred".
 * A message that says only that names nothing the user can act on, and the
 * requirement's accessibility line is "the message names what specifically
 * went wrong".
 *
 * This is a development-time guard, not a runtime filter: it throws in tests
 * and in the dev server so the copy is fixed at the source, and it never
 * blanks a real screen in production over a wording problem.
 */
const VAGUE_MESSAGE =
  /^\s*(an?\s+)?(unexpected\s+|unknown\s+)?error\s+(has\s+)?occurred[.!\s]*$/i;

function assertNamesTheFailure(message: string): void {
  if (process.env.NODE_ENV === 'production') return;
  if (VAGUE_MESSAGE.test(message)) {
    throw new Error(
      'OperationalState: V8-R-OPS-007 excludes a vague "an error occurred". '
        + 'Say what specifically went wrong.',
    );
  }
}

/** `stale` is the one kind that labels retained content instead of replacing
 *  it — the label is small, and the content above it is untouched. */
const LABEL: Record<OperationalStateKind, string> = {
  loading: 'Loading',
  empty: 'Nothing here yet',
  denied: 'Permission needed',
  failed: 'Something went wrong',
  offline: 'Offline',
  queued: 'Queued',
  stale: 'Showing saved data',
};

export function OperationalState({
  kind,
  message,
  recovery,
  children,
}: {
  kind: OperationalStateKind;
  /** What is TRUE, in words the user can act on. */
  message: string;
  /** AT MOST ONE. The type is the enforcement. */
  recovery?: OperationalRecovery;
  /** The surrounding context, retained rather than blanked. */
  children?: ReactNode;
}): JSX.Element {
  assertNamesTheFailure(message);

  const action = useRef<HTMLButtonElement>(null);
  const previousKind = useRef<OperationalStateKind | null>(null);

  useEffect(() => {
    const previous = previousKind.current;
    previousKind.current = kind;
    // First paint swaps nothing, so it steals nothing.
    if (previous === null || previous === kind) return;
    action.current?.focus({ preventScroll: true });
  }, [kind]);

  return (
    <>
      {children}
      <div
        data-testid="operational-state"
        data-state={kind}
        // `status`, not `alert`: these are conditions, not interruptions, and
        // an assertive live region would talk over the content above.
        role="status"
        aria-live="polite"
        className={[
          'bg-surface border border-border rounded-2xl px-4 py-3',
          children ? 'mt-3' : '',
        ].join(' ')}
      >
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
          {LABEL[kind]}
        </p>
        <p className="text-sm text-text leading-relaxed mt-1">{message}</p>
        {recovery ? (
          <button
            ref={action}
            type="button"
            onClick={recovery.onAction}
            className="mt-3 inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-2 rounded-full min-h-[44px] touch-manipulation"
          >
            {recovery.label}
          </button>
        ) : null}
      </div>
    </>
  );
}

export default OperationalState;
