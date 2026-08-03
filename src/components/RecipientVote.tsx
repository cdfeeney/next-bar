'use client';

import Link from 'next/link';
import { useRatings } from '@/hooks/useRatings';
import type { Rating } from '@/types/ratings';

/**
 * RecipientVote — the signed-out recipient's first act (goal acceptance 6).
 *
 * Someone was just texted a bar. That is the highest-intent moment this
 * product ever gets with a stranger, and until now the page spent it asking
 * them to go install something. This lets them rate the bar RIGHT THERE,
 * before any account exists: the vote IS the onboarding.
 *
 * Two rules, both load-bearing and both asserted in e2e:
 *
 *  1. Casting NEVER routes to /auth. A signup wall in front of the one
 *     moment of intent the share bought is how the loop stayed open.
 *  2. It writes through `useRatings`, which in signed-out mode is already
 *     localStorage-backed (`next-bar:ratings:v1`). No account, no migration,
 *     no server round-trip — and when the recipient does sign up later,
 *     the existing merge-on-sign-in path carries the vote up with them.
 *     That merge is why this is worth persisting rather than faking.
 */

const CHOICES: ReadonlyArray<{ rating: Rating; label: string; hint: string }> = [
  { rating: 'loved', label: 'Loved it', hint: 'Would go back tonight' },
  { rating: 'liked', label: 'Liked it', hint: 'Solid, no notes' },
  { rating: 'pass', label: 'Pass', hint: 'Not for me' },
];

const BASE =
  'flex-1 min-h-[44px] touch-manipulation px-3 py-2.5 rounded-full font-display text-sm border transition-colors';
const SELECTED = 'bg-accent border-accent text-bg';
const UNSELECTED = 'bg-transparent border-border text-muted hover:text-text';

export default function RecipientVote({
  barId,
  barName,
}: {
  barId: string;
  barName: string;
}): JSX.Element {
  const { getRating, setRating } = useRatings();
  const current = getRating(barId);

  return (
    <section
      // The bar name lives on the region label, NOT in the heading: an <h2>
      // containing it collided with the pick card's <h1> under
      // getByRole('heading', { name: /<bar>/ }), breaking an existing spec.
      // Screen readers still get the name; the visible copy sits directly
      // under the card, where "here" is unambiguous.
      aria-label={`Rate ${barName}`}
      className="mt-6 rounded-3xl border border-border bg-surface/60 p-5"
    >
      <h2 className="font-display text-lg text-center mb-1">
        {current ? 'Rated.' : 'Been here?'}
      </h2>
      {/* role="status" so the confirmation is ANNOUNCED, not merely shown
          (review Q4): the heading swapping to "Rated." is silent for anyone
          navigating by headings, which is most of the point of confirming. */}
      <p role="status" className="text-muted text-xs text-center mb-4">
        {current
          ? 'That is your list started — no account needed.'
          : 'Rate it now. No signup, no email.'}
      </p>

      {/* role="group", not radiogroup (review Q4). These ARE mutually
          exclusive, so `radio` would be the more precise role — but radio
          semantics promise arrow-key navigation with a roving tabindex, and
          announcing a keyboard contract the component does not honour is
          worse than a correctly-announced set of toggles. aria-pressed
          buttons are valid and read correctly; the group just needed a name
          so they stop being announced as three unrelated controls. */}
      <div role="group" aria-label="Your rating" className="flex gap-2">
        {CHOICES.map(({ rating, label, hint }) => (
          <button
            key={rating}
            type="button"
            aria-pressed={current === rating}
            aria-label={`${label} — ${hint}`}
            onClick={() => setRating(barId, rating)}
            className={[BASE, current === rating ? SELECTED : UNSELECTED].join(
              ' ',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {current ? (
        // Deliberately /rankings, not /auth. The reward for voting is seeing
        // the thing you just made, not a form. OUTLINE, not accent-filled:
        // the page already has one accent primary and the selected chip is
        // accent-filled too — three stacked accents violated R2
        // (g-b83d1c77 audit).
        <p className="text-center mt-4">
          <Link
            href="/rankings"
            className="inline-flex items-center justify-center border border-accent text-accent font-display text-sm px-5 py-2.5 rounded-full min-h-[44px] touch-manipulation hover:bg-accent hover:text-bg transition-colors"
          >
            See your list →
          </Link>
        </p>
      ) : null}
    </section>
  );
}
