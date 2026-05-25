'use client';

import { useEffect, useRef, useState } from 'react';
import { useGeolocation } from '@/hooks/useGeolocation';
import NeighborhoodPicker from '@/components/NeighborhoodPicker';
import type { AccuracyBand, Coords, ManhattanNeighborhood } from '@/types';

type LocationPromptProps = {
  onResolved: (
    input:
      | {
          kind: 'coords';
          coords: Coords;
          band: AccuracyBand;
          snappedTo: ManhattanNeighborhood | null;
        }
      | { kind: 'neighborhood'; neighborhood: ManhattanNeighborhood },
  ) => void;
};

export default function LocationPrompt({ onResolved }: LocationPromptProps) {
  const { state, request, coords, snappedNeighborhood } = useGeolocation();

  // When the user explicitly chooses "Or pick a neighborhood" / "Pick exactly"
  // from a non-fallback state, surface the picker without forcing a status flip.
  const [showPickerOverride, setShowPickerOverride] = useState(false);

  // Guard against re-firing onResolved across re-renders for the same fix.
  const resolvedRef = useRef(false);

  // Auto-resolve when geolocation produces usable coords.
  useEffect(() => {
    if (resolvedRef.current) return;

    if (state.status === 'granted_precise' && coords) {
      resolvedRef.current = true;
      onResolved({
        kind: 'coords',
        coords,
        band: 'precise',
        snappedTo: null,
      });
      return;
    }

    if (state.status === 'granted_snapped' && coords && snappedNeighborhood) {
      resolvedRef.current = true;
      onResolved({
        kind: 'coords',
        coords,
        band: 'snapped',
        snappedTo: snappedNeighborhood,
      });
    }
  }, [state.status, coords, snappedNeighborhood, onResolved]);

  const handleNeighborhoodChange = (next: ManhattanNeighborhood[]) => {
    const picked = next[0];
    if (!picked) return;
    onResolved({ kind: 'neighborhood', neighborhood: picked });
  };

  // --- IDLE ---
  if (state.status === 'idle') {
    if (showPickerOverride) {
      return (
        <section className="max-w-2xl mx-auto px-6 py-8">
          <NeighborhoodPicker
            selected={[]}
            onChange={handleNeighborhoodChange}
            multi={false}
            title="Pick a neighborhood"
            helper="We'll find bars around there."
          />
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setShowPickerOverride(false)}
              className="text-accent underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
            >
              Back
            </button>
          </div>
        </section>
      );
    }

    return (
      <section className="max-w-2xl mx-auto px-6 py-8">
        <h2 className="font-display text-2xl md:text-3xl text-center mb-6">
          Where are you right now?
        </h2>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch justify-center">
          <button
            type="button"
            onClick={request}
            className="bg-accent text-bg font-display text-lg px-6 py-3 rounded-full min-h-[44px] touch-manipulation"
          >
            Use my location
          </button>
          <button
            type="button"
            onClick={() => setShowPickerOverride(true)}
            className="text-accent underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
          >
            Or pick a neighborhood
          </button>
        </div>
      </section>
    );
  }

  // --- REQUESTING ---
  if (state.status === 'requesting') {
    return (
      <section className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex flex-col items-center justify-center gap-4">
          <div
            role="status"
            aria-label="Locating you"
            className="h-8 w-8 rounded-full border-2 border-border border-t-accent animate-spin"
          />
          <p className="text-muted text-sm">Locating you…</p>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="bg-accent text-bg font-display text-lg px-6 py-3 rounded-full min-h-[44px] opacity-60 cursor-not-allowed"
          >
            Use my location
          </button>
        </div>
      </section>
    );
  }

  // --- GRANTED PRECISE --- (auto-resolves via effect; render nothing)
  if (state.status === 'granted_precise') {
    return null;
  }

  // --- GRANTED SNAPPED ---
  if (state.status === 'granted_snapped') {
    if (showPickerOverride) {
      return (
        <section className="max-w-2xl mx-auto px-6 py-8">
          <NeighborhoodPicker
            selected={snappedNeighborhood ? [snappedNeighborhood] : []}
            onChange={handleNeighborhoodChange}
            multi={false}
            title="Pick a neighborhood"
            helper="Tap one to use it instead."
          />
        </section>
      );
    }

    return (
      <section className="max-w-2xl mx-auto px-6 py-8">
        <p className="text-muted text-sm text-center mb-2">
          Approximate — based on the {snappedNeighborhood} neighborhood
        </p>
        <p className="text-center mb-4">Locating you…</p>
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowPickerOverride(true)}
            className="text-accent underline-offset-4 hover:underline min-h-[44px] touch-manipulation text-sm"
          >
            Pick exactly
          </button>
        </div>
      </section>
    );
  }

  // --- GRANTED COARSE ---
  if (state.status === 'granted_coarse') {
    return (
      <section className="max-w-2xl mx-auto px-6 py-8">
        <h2 className="font-display text-2xl md:text-3xl text-center mb-6">
          We can't pin your exact location — pick a neighborhood?
        </h2>
        <NeighborhoodPicker
          selected={[]}
          onChange={handleNeighborhoodChange}
          multi={false}
          title="Pick a neighborhood"
        />
      </section>
    );
  }

  // --- DENIED ---
  if (state.status === 'denied') {
    return (
      <section className="max-w-2xl mx-auto px-6 py-8">
        <h2 className="font-display text-2xl md:text-3xl text-center mb-6">
          Location's off. Pick a neighborhood?
        </h2>
        <NeighborhoodPicker
          selected={[]}
          onChange={handleNeighborhoodChange}
          multi={false}
          title="Pick a neighborhood"
        />
      </section>
    );
  }

  // --- UNAVAILABLE ---
  if (state.status === 'unavailable') {
    return (
      <section className="max-w-2xl mx-auto px-6 py-8">
        <h2 className="font-display text-2xl md:text-3xl text-center mb-6">
          Your browser doesn't share location. Pick a neighborhood?
        </h2>
        <NeighborhoodPicker
          selected={[]}
          onChange={handleNeighborhoodChange}
          multi={false}
          title="Pick a neighborhood"
        />
      </section>
    );
  }

  return null;
}
