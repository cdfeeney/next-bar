'use client';

/**
 * Onboarding step 3 — location (V8-R-ONB-004).
 *
 * Approved canvas `next-bar-onboarding-v1`, screen 3 plus its "Location denied"
 * branch state.
 *
 * The step offers Use my location / Choose a neighborhood / Not now, and a
 * denial routes to the neighborhood choice. It NEVER fakes a fix — every
 * coordinate comes from `useGeolocation`, and a denied, unavailable, or
 * too-coarse-to-pin result falls through to the picker rather than inventing a
 * position. Coarse is a denial of PRECISION, so it lands on the picker too.
 *
 * A picked neighborhood is merged into the stored vibe profile (the same field
 * the quiz writes and the home reads), so the choice actually powers the five
 * recommendations instead of being collected and dropped. "Not now" and "Show
 * anywhere" persist nothing.
 *
 * WHILE THE PERMISSION PROMPT IS OPEN THE STEP KEEPS ITS ESCAPE HATCHES: an
 * earlier full-screen spinner replaced every control, and getCurrentPosition's
 * 10s timeout does not run while a browser prompt sits unanswered — a user who
 * never answered had nothing left to tap. The request now reports itself on
 * the button it came from, and Choose a neighborhood / Not now stay reachable
 * throughout.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NeighborhoodPicker from '@/components/NeighborhoodPicker';
import { useGeolocation } from '@/hooks/useGeolocation';
import { deriveArchetype } from '@/lib/quiz';
import { loadProfile, saveProfile } from '@/lib/storedProfile';
import type { ManhattanNeighborhood } from '@/types';

const NEXT_STEP = '/onboarding/quiz';

/** Show the picker on top of whatever the permission state is. */
type View = 'auto' | 'picker';

/** Which of the three screens is on show — the focus target changes with it. */
type Screen = 'ask' | 'no-fix' | 'picker';

export default function OnboardingLocationPage(): JSX.Element {
  const router = useRouter();
  const { state, request } = useGeolocation();
  const [view, setView] = useState<View>('auto');
  const region = useRef<HTMLElement>(null);
  const previousScreen = useRef<Screen | null>(null);

  // A usable fix is the whole point of the step — take it and move on. The
  // browser permission is what persists; nothing is written here.
  useEffect(() => {
    if (state.status === 'granted_precise' || state.status === 'granted_snapped') {
      router.push(NEXT_STEP);
    }
  }, [state.status, router]);

  const isLocating = state.status === 'requesting';
  // Denied, unavailable, or granted-but-too-coarse-to-pin: the canvas's
  // "Location denied" branch. No fix is invented for any of them.
  const hasNoFix =
    state.status === 'denied'
    || state.status === 'unavailable'
    || state.status === 'granted_coarse';
  const screen: Screen = view === 'picker' ? 'picker' : hasNoFix ? 'no-fix' : 'ask';

  // Swapping the screen unmounts the control that was focused, dropping focus
  // to <body> with nothing announced. Move it to the new region instead — but
  // never on first paint, where the page has not swapped anything yet.
  useEffect(() => {
    const previous = previousScreen.current;
    previousScreen.current = screen;
    if (previous !== null && previous !== screen) region.current?.focus();
  }, [screen]);

  const chooseNeighborhood = (next: ManhattanNeighborhood[]): void => {
    const picked = next[0];
    if (!picked) return;
    const prev = loadProfile();
    saveProfile({
      tags: prev?.tags ?? [],
      archetype: prev?.archetype ?? deriveArchetype([]),
      preferredNeighborhoods: [picked],
    });
    router.push(NEXT_STEP);
  };

  if (screen === 'picker') {
    return (
      <main
        ref={region}
        tabIndex={-1}
        className="min-h-screen px-6 py-10 outline-none"
      >
        <div className="max-w-md mx-auto">
          <NeighborhoodPicker
            selected={[]}
            onChange={chooseNeighborhood}
            multi={false}
            title="Choose a neighborhood"
            helper="We'll find bars around there."
          />
          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={() => router.push(NEXT_STEP)}
              className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
            >
              Show anywhere
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (screen === 'no-fix') {
    return (
      <main
        ref={region}
        tabIndex={-1}
        className="min-h-screen flex items-center justify-center px-6 outline-none"
      >
        <div className="max-w-sm w-full text-center">
          <div
            aria-hidden="true"
            className="w-20 h-20 rounded-3xl bg-surface border border-border mx-auto mb-8"
          />
          <h1 className="font-display text-2xl md:text-3xl mb-3 leading-snug">
            No problem — pick a neighborhood instead
          </h1>
          {/* Only a code-1 failure is a denial. A timeout, a device with no
              geolocation, and a fix too coarse to pin are not, and telling
              someone who granted access that they denied it is a lie about
              their own setting. */}
          <p className="text-muted text-sm leading-relaxed mb-8">
            {state.status === 'denied'
              ? 'Location access was denied.'
              : 'We could not get a precise location.'}{' '}
            We never fake your location.
          </p>
          <button
            type="button"
            onClick={() => setView('picker')}
            className="w-full bg-accent hover:bg-accentDim transition-colors text-bg font-display text-base py-3 rounded-full min-h-[44px] touch-manipulation"
          >
            Choose a neighborhood
          </button>
          <button
            type="button"
            onClick={() => router.push(NEXT_STEP)}
            className="block mx-auto mt-4 text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
          >
            Show anywhere
          </button>
        </div>
      </main>
    );
  }

  return (
    <main
      ref={region}
      tabIndex={-1}
      className="min-h-screen flex items-center justify-center px-6 outline-none"
    >
      <div className="max-w-sm w-full text-center">
        <div
          aria-hidden="true"
          className="w-20 h-20 rounded-3xl bg-surface border border-border mx-auto mb-8"
        />
        <h1 className="font-display text-2xl md:text-3xl mb-3 leading-snug">
          So we can find bars near you tonight
        </h1>
        <p className="text-muted text-sm leading-relaxed mb-8">
          Location powers your five recommendations. You can change this
          anytime in Settings.
        </p>
        <button
          type="button"
          // aria-disabled, not disabled: this button holds focus when the tap
          // lands, and a focused control that becomes `disabled` drops focus
          // to <body> (same rule as BarLightbox's carousel arrows).
          aria-disabled={isLocating}
          onClick={() => {
            if (!isLocating) request();
          }}
          className="w-full bg-accent hover:bg-accentDim transition-colors text-bg font-display text-base py-3 rounded-full min-h-[44px] touch-manipulation aria-disabled:opacity-60"
        >
          {isLocating ? 'Locating you…' : 'Use my location'}
        </button>
        {isLocating ? (
          <p role="status" className="text-muted text-sm mt-3">
            Locating you…
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setView('picker')}
          className="w-full mt-3 bg-surface border border-border font-display text-base py-3 rounded-full min-h-[44px] touch-manipulation"
        >
          Choose a neighborhood
        </button>
        <button
          type="button"
          onClick={() => router.push(NEXT_STEP)}
          className="block mx-auto mt-4 text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
        >
          Not now
        </button>
      </div>
    </main>
  );
}
