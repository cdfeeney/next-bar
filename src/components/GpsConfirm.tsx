'use client';

import { useEffect } from 'react';
import type { AccuracyBand, Bar, Coords } from '@/types';
import { haversineMiles } from '@/lib/distance';
import { GPS_CONFIRM_MILES } from '@/lib/constants';

type GpsConfirmProps = {
  seedBar: Bar;
  userCoords: Coords | null;
  accuracyBand: AccuracyBand;
  onProceed: () => void;
  onPickDifferent: () => void;
};

const PRIMARY_BTN =
  'min-h-[44px] touch-manipulation rounded-full px-6 py-3 font-display text-lg bg-accent text-bg';
const SECONDARY_BTN =
  'min-h-[44px] touch-manipulation rounded-full px-6 py-3 font-display text-lg bg-surface border border-border text-text';

export default function GpsConfirm({
  seedBar,
  userCoords,
  accuracyBand,
  onProceed,
  onPickDifferent,
}: GpsConfirmProps) {
  const hasPreciseFix = userCoords !== null && accuracyBand === 'precise';
  const distanceMiles = hasPreciseFix
    ? haversineMiles(userCoords, { lat: seedBar.lat, lng: seedBar.lng })
    : null;
  const isMismatch =
    hasPreciseFix && distanceMiles !== null && distanceMiles > GPS_CONFIRM_MILES;
  const shouldAutoProceed = hasPreciseFix && !isMismatch;

  useEffect(() => {
    if (shouldAutoProceed) {
      onProceed();
    }
  }, [shouldAutoProceed, onProceed]);

  if (shouldAutoProceed) {
    return (
      <section
        className="max-w-2xl mx-auto px-6 py-12 text-center"
        aria-live="polite"
      >
        <p className="text-muted text-sm">Confirming location…</p>
      </section>
    );
  }

  if (!hasPreciseFix) {
    return (
      <section className="max-w-2xl mx-auto px-6 py-12 text-center">
        <h2 className="font-display text-2xl md:text-3xl mb-4">
          We can&rsquo;t confirm where you are &mdash; proceed from {seedBar.name}?
        </h2>
        <div className="flex flex-col md:flex-row gap-3 justify-center items-center mt-8">
          <button type="button" onClick={onProceed} className={PRIMARY_BTN}>
            Continue
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-2xl mx-auto px-6 py-12 text-center">
      <h2 className="font-display text-2xl md:text-3xl mb-4">
        We&rsquo;re showing bars near {seedBar.name} &mdash; looks like
        you&rsquo;re elsewhere?
      </h2>
      <div className="flex flex-col md:flex-row gap-3 justify-center items-center mt-8">
        <button type="button" onClick={onProceed} className={PRIMARY_BTN}>
          Proceed anyway
        </button>
        <button
          type="button"
          onClick={onPickDifferent}
          className={SECONDARY_BTN}
        >
          Pick a different bar
        </button>
      </div>
    </section>
  );
}
