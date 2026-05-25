'use client';

import { useState } from 'react';
import type { Bar, ManhattanNeighborhood, VibeTag } from '@/types';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import NeighborhoodPicker from '@/components/NeighborhoodPicker';

type FreeTextSeedProps = {
  onSubmit: (synthetic: Bar) => void;
  onCancel: () => void;
};

const SUGGESTED_TAGS: VibeTag[] = [
  'chill',
  'buzzy',
  'cocktail',
  'dive',
  'live',
  'date',
  'cheap',
  'pricey',
];

const PRIMARY_BTN =
  'min-h-[44px] touch-manipulation rounded-full px-6 py-3 font-display text-lg bg-accent text-bg';
const SECONDARY_BTN =
  'min-h-[44px] touch-manipulation rounded-full px-6 py-3 font-display text-lg bg-surface border border-border text-text';

const CHIP_BASE =
  'min-h-[44px] touch-manipulation px-4 py-2 rounded-full font-display text-sm border transition-colors';
const CHIP_ACTIVE = 'bg-accent text-bg border-accent';
const CHIP_INACTIVE = 'bg-surface border-border text-muted';

export default function FreeTextSeed({
  onSubmit,
  onCancel,
}: FreeTextSeedProps) {
  const [name, setName] = useState('');
  const [neighborhood, setNeighborhood] = useState<ManhattanNeighborhood | null>(
    null,
  );
  const [tags, setTags] = useState<Set<VibeTag>>(() => new Set<VibeTag>());
  const [showNeighborhoodWarning, setShowNeighborhoodWarning] = useState(false);

  const toggleTag = (tag: VibeTag) => {
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const handleNeighborhoodChange = (arr: ManhattanNeighborhood[]) => {
    const picked = arr[0] ?? null;
    setNeighborhood(picked);
    if (picked) {
      setShowNeighborhoodWarning(false);
    }
  };

  const tagsArray = Array.from(tags);
  const isValid = neighborhood !== null && tagsArray.length > 0;

  const handleSubmit = () => {
    if (!neighborhood) {
      setShowNeighborhoodWarning(true);
      return;
    }
    if (tagsArray.length === 0) {
      return;
    }

    const synthetic: Bar = {
      id: `synthetic:${Date.now()}`,
      name: name.trim() || 'Your spot',
      neighborhood,
      address: '',
      lat: NEIGHBORHOOD_CENTROIDS[neighborhood].lat,
      lng: NEIGHBORHOOD_CENTROIDS[neighborhood].lng,
      priceTier: 2,
      tags: tagsArray,
      blurb: '',
      lastVerified: new Date().toISOString().split('T')[0],
    };
    onSubmit(synthetic);
  };

  return (
    <section className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="font-display text-2xl md:text-3xl text-center mb-2">
        Where are you?
      </h1>
      <p className="text-muted text-sm text-center mb-6">
        Tell us about your spot, we&rsquo;ll find your next one.
      </p>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Bar name (optional)"
        aria-label="Bar name"
        className="w-full bg-surface border border-border rounded-2xl px-4 py-3 focus:border-accent outline-none text-base mb-4"
      />

      <div className="mb-2">
        <NeighborhoodPicker
          multi={false}
          selected={neighborhood ? [neighborhood] : []}
          onChange={handleNeighborhoodChange}
          title="Which neighborhood?"
        />
      </div>
      {showNeighborhoodWarning && !neighborhood ? (
        <p className="text-red-400 text-xs text-center mb-4">
          Pick a neighborhood to continue.
        </p>
      ) : null}

      <p className="text-muted text-sm mb-3 text-center mt-6">
        What&rsquo;s the vibe?
      </p>
      <div
        role="group"
        aria-label="Vibe tags"
        className="flex flex-wrap gap-2 justify-center"
      >
        {SUGGESTED_TAGS.map((tag) => {
          const isActive = tags.has(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={isActive}
              onClick={() => toggleTag(tag)}
              className={[
                CHIP_BASE,
                isActive ? CHIP_ACTIVE : CHIP_INACTIVE,
              ].join(' ')}
            >
              {tag}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col md:flex-row gap-3 justify-center items-center mt-8">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isValid}
          className={`${PRIMARY_BTN} ${!isValid ? 'opacity-50' : ''}`}
        >
          Find next bars
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BTN}>
          Back
        </button>
      </div>
    </section>
  );
}
