'use client';

import Link from 'next/link';
import type { StoriesStatus } from './storyStore';

/**
 * The three states that are NOT a rail, kept distinct on purpose.
 *
 * Cycle 1 had none of these: it seeded a demo reel so the surface always looked
 * populated, which meant a signed-out visitor, an unreachable backend and a
 * genuinely empty circle were indistinguishable — all three rendered as
 * "friends with stories". Collapsing them is the failure this component exists
 * to prevent, so each says exactly what is true.
 */
export default function StoriesEmptyState({
  status,
  onRetry,
}: {
  status: StoriesStatus;
  onRetry: () => void;
}): JSX.Element | null {
  if (status === 'loading') {
    return (
      <section data-testid="stories-loading" aria-busy="true" className="min-h-[92px]">
        <h2 className="font-label text-xs uppercase tracking-[0.25em] text-muted mb-3">
          Stories
        </h2>
        <p className="text-muted text-sm">Loading…</p>
      </section>
    );
  }

  if (status === 'signed-out') {
    return (
      <Shell testId="stories-signed-out">
        <p className="text-sm leading-relaxed">
          Stories are for you and the friends who follow you back. Sign in to see
          theirs and add your own.
        </p>
        <Link
          href="/auth"
          data-testid="stories-sign-in"
          className="mt-3 inline-flex items-center justify-center min-h-[44px] px-4 rounded-2xl border border-accent text-xs font-label uppercase tracking-widest touch-manipulation hover:bg-accent hover:text-bg transition-colors"
        >
          Sign in
        </Link>
      </Shell>
    );
  }

  if (status === 'unavailable') {
    return (
      <Shell testId="stories-unavailable">
        {/* NOT "no stories". An unreachable backend that renders as an empty
            feed is the silent failure this whole surface was rebuilt to stop. */}
        <p role="alert" className="text-sm leading-relaxed">
          Stories couldn&apos;t be loaded. This isn&apos;t an empty feed — we
          couldn&apos;t reach the server, so nothing here is up to date.
        </p>
        <button
          type="button"
          data-testid="stories-retry"
          onClick={onRetry}
          className="mt-3 inline-flex items-center justify-center min-h-[44px] px-4 rounded-2xl border border-border text-xs font-label uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
        >
          Try again
        </button>
      </Shell>
    );
  }

  return null;
}

function Shell({
  testId,
  children,
}: {
  testId: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section data-testid={testId} aria-labelledby="stories-heading">
      <h2
        id="stories-heading"
        className="font-label text-xs uppercase tracking-[0.25em] text-muted mb-3"
      >
        Stories
      </h2>
      <div className="rounded-2xl border border-border bg-surface p-5">
        {children}
      </div>
    </section>
  );
}
