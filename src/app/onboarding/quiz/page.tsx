'use client';

/**
 * Onboarding step 4 — the optional quiz, and the end of the sequence
 * (V8-R-ONB-005).
 *
 * Approved canvas `next-bar-onboarding-v1`, screen 4 plus its "Quiz skipped —
 * recs" branch state (which IS the home: skipping lands on real
 * recommendations, not a placeholder).
 *
 * Genuinely optional — both "Start" and "Skip — show me bars" end on the
 * approved home, and COMPLETING the quiz lands there too. It used to hand off
 * to the standalone `/quiz` page, which asks for location a second time and
 * then renders its own results in place — the completed-quiz path never
 * reached the home at all. Running the existing `VibeQuiz` here keeps one quiz
 * implementation and lets this step own where the sequence ends.
 *
 * Quiz tags stay a cold-start prior: this writes the same stored vibe profile
 * `/quiz` writes, and nothing here weights or gates anything (CLAUDE.md).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import VibeQuiz from '@/components/VibeQuiz';
import { useAuth } from '@/hooks/useAuth';
import { displayTag } from '@/lib/tagDisplay';
import { loadProfile, saveProfile } from '@/lib/storedProfile';
import type { VibeProfile, VibeTag } from '@/types';
import { identityHref, returnDestination } from '../_sequence';

/**
 * Illustrative only — the real questions live in VibeQuiz. These are genuine
 * VibeTag values rendered through displayTag(), not hand-typed labels: the
 * display vocabulary has exactly one source.
 */
const SAMPLE_TAGS: VibeTag[] = ['dive', 'cocktail', 'live'];

/**
 * The identity step (display name + @username) is still required of every
 * account and is NOT part of this canvas. A signed-in account that has no
 * handle yet is sent through it on the way home, because otherwise
 * OnboardingGate yanks it off the home it just landed on, one render later.
 * `/onboarding` bounces straight to the destination when the handle already
 * exists, so this costs an onboarded account nothing.
 *
 * The destination is whatever entered the sequence — an invite link's plan for
 * a brand-new account, the home otherwise — carried on `?next=` through all
 * four screens. `identityHref` also stamps the sequence marker, without which
 * `/onboarding` would send this visit straight back to the age step and loop.
 *
 * A signed-out visitor has no identity step to take and goes to the
 * destination directly.
 */
function completionPath(isSignedIn: boolean, search: string): string {
  const destination = returnDestination(search);
  return isSignedIn ? identityHref(destination) : destination;
}

export default function OnboardingQuizPage(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const [started, setStarted] = useState(false);
  const quizRegion = useRef<HTMLElement>(null);

  // Starting the quiz unmounts the button that was focused, which drops focus
  // to <body> and announces nothing — the same in-page swap rule the age and
  // location steps already follow. Never on first paint: nothing has swapped
  // yet there.
  useEffect(() => {
    if (started) quizRegion.current?.focus();
  }, [started]);

  /**
   * WAIT FOR AUTH BEFORE CHOOSING THE DESTINATION.
   *
   * `auth.status === 'signed-in'` is false while the status is still
   * `loading`, and this comparison decided whether the sequence ends on the
   * identity step or goes straight to the destination. A signed-in account
   * that skipped or completed the quiz before `useAuth` settled — the common
   * case on a cold load, since the quiz is one tap from arrival — was routed
   * as though it were signed out, and V8-R-ONB-001's identity step was
   * silently dropped from its run.
   *
   * Guessing either way is wrong, so it does not guess: the intent is
   * recorded and the navigation happens once the status is real. The wait is
   * a few milliseconds and there is nothing left on screen to interact with.
   */
  const [finishing, setFinishing] = useState(false);

  const finish = (): void => setFinishing(true);

  useEffect(() => {
    if (!finishing || auth.status === 'loading') return;
    router.push(
      completionPath(auth.status === 'signed-in', window.location.search),
    );
  }, [finishing, auth.status, router]);

  const complete = (profile: VibeProfile): void => {
    // The neighborhood picked in step 3 is not re-asked here, so an empty
    // answer from the quiz's own neighborhood question must not erase it.
    const previous = loadProfile();
    saveProfile({
      ...profile,
      preferredNeighborhoods:
        profile.preferredNeighborhoods.length > 0
          ? profile.preferredNeighborhoods
          : previous?.preferredNeighborhoods ?? [],
    });
    finish();
  };

  if (started) {
    return (
      <main ref={quizRegion} tabIndex={-1} className="outline-none">
        <VibeQuiz onComplete={complete} />
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-sm w-full text-center">
        <p className="text-muted uppercase tracking-[0.25em] text-xs mb-3">
          ~30 seconds
        </p>
        <h1 className="font-display text-2xl md:text-3xl mb-3 leading-snug">
          Tune my picks
        </h1>
        <p className="text-muted text-sm leading-relaxed mb-6">
          A few quick questions about vibe and distance make your five bars
          sharper. Totally optional.
        </p>
        <div aria-hidden="true" className="flex justify-center gap-2 mb-8">
          {SAMPLE_TAGS.map((tag) => (
            <span
              key={tag}
              className="text-muted text-xs border border-border rounded-full px-3 py-1.5"
            >
              {displayTag(tag)}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setStarted(true)}
          className="block w-full bg-accent hover:bg-accentDim transition-colors text-bg font-display text-base py-3 rounded-full min-h-[44px] touch-manipulation"
        >
          Start — ~30 seconds
        </button>
        <button
          type="button"
          onClick={finish}
          className="block mx-auto mt-4 text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
        >
          Skip — show me bars
        </button>
      </div>
    </main>
  );
}
