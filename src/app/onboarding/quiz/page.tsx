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

/**
 * Illustrative only — the real questions live in VibeQuiz. These are genuine
 * VibeTag values rendered through displayTag(), not hand-typed labels: the
 * display vocabulary has exactly one source.
 */
const SAMPLE_TAGS: VibeTag[] = ['dive', 'cocktail', 'live'];

/** The approved Next Bar? home. There is no second home. */
const HOME = '/';

/**
 * The identity step (display name + @username) is still required of every
 * account and is NOT part of this canvas. A signed-in account that has no
 * handle yet is sent through it on the way home, because otherwise
 * OnboardingGate yanks it off the home it just landed on, one render later.
 * `/onboarding` bounces straight to HOME when the handle already exists, so
 * this costs an onboarded account nothing.
 *
 * `?next=` names HOME explicitly rather than leaning on `returnDestination()`
 * defaulting to `/`. The destination is stated by the step that owns where the
 * sequence ends, on the same parameter OnboardingGate uses, instead of being
 * an implicit fallback in another file that a future edit could change without
 * touching this one.
 */
function completionPath(isSignedIn: boolean): string {
  return isSignedIn ? `/onboarding?next=${encodeURIComponent(HOME)}` : HOME;
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

  const finish = (): void => {
    router.push(completionPath(auth.status === 'signed-in'));
  };

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
