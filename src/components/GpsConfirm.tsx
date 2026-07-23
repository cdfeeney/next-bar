'use client';

import { useEffect } from 'react';
import type { AccuracyBand, Bar, Coords, GeoState } from '@/types';
import { haversineMiles } from '@/lib/distance';
import { GPS_CONFIRM_MILES } from '@/lib/constants';

type GpsConfirmProps = {
  seedBar: Bar;
  userCoords: Coords | null;
  accuracyBand: AccuracyBand;
  geoStatus: GeoState['status'];
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
  geoStatus,
  onProceed,
  onPickDifferent,
}: GpsConfirmProps) {
  // 'idle' counts as in-flight too: the parent flow fires geo.request() in an
  // effect right after we mount, so an idle status here is a request that is
  // about to start — showing the no-fix UI for that frame would let the user
  // Continue (or auto-proceed) on a fix that hasn't resolved yet.
  const isLocating = geoStatus === 'idle' || geoStatus === 'requesting';
  const hasPreciseFix = userCoords !== null && accuracyBand === 'precise';
  const distanceMiles = hasPreciseFix
    ? haversineMiles(userCoords, { lat: seedBar.lat, lng: seedBar.lng })
    : null;
  const isMismatch =
    hasPreciseFix && distanceMiles !== null && distanceMiles > GPS_CONFIRM_MILES;
  const shouldAutoProceed = !isLocating && hasPreciseFix && !isMismatch;

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

  if (isLocating) {
    return (
      <section
        className="max-w-2xl mx-auto px-6 py-12 flex flex-col items-center text-center"
        aria-live="polite"
      >
        <div
          role="status"
          aria-label="Locating you"
          className="h-10 w-10 rounded-full border-2 border-border border-t-accent animate-spin mb-6"
        />
        <p className="text-muted text-sm">Locating you…</p>
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
