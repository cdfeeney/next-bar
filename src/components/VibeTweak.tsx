'use client';

import { useMemo, useState } from 'react';
import type { VibeTag } from '@/types';

type VibeTweakProps = {
  initialTags: VibeTag[];
  onApply: (tags: VibeTag[]) => void;
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

export default function VibeTweak({
  initialTags,
  onApply,
  onCancel,
}: VibeTweakProps) {
  const [active, setActive] = useState<Set<VibeTag>>(
    () => new Set(initialTags),
  );

  const seedTags = useMemo(() => {
    const seen = new Set<VibeTag>();
    const ordered: VibeTag[] = [];
    for (const tag of initialTags) {
      if (!seen.has(tag)) {
        seen.add(tag);
        ordered.push(tag);
      }
    }
    return ordered;
  }, [initialTags]);

  const extraSuggestions = useMemo(
    () => SUGGESTED_TAGS.filter((t) => !seedTags.includes(t)),
    [seedTags],
  );

  const toggle = (tag: VibeTag) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const handleApply = () => {
    onApply(Array.from(active));
  };

  return (
    <section className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="font-display text-2xl mb-2 text-center">
        Tweak the vibe
      </h2>
      <p className="text-muted text-sm text-center mb-6">
        Remove what you don&rsquo;t want. Add what you do.
      </p>

      {seedTags.length > 0 ? (
        <div
          role="group"
          aria-label="Seed vibe tags"
          className="flex flex-wrap gap-2 justify-center mb-6"
        >
          {seedTags.map((tag) => {
            const isActive = active.has(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={isActive}
                onClick={() => toggle(tag)}
                className={[
                  CHIP_BASE,
                  isActive ? CHIP_ACTIVE : CHIP_INACTIVE,
                ].join(' ')}
              >
                {tag}
                {isActive ? ' ×' : ''}
              </button>
            );
          })}
        </div>
      ) : null}

      {extraSuggestions.length > 0 ? (
        <>
          <p className="text-muted text-sm text-center mb-3">Add a vibe</p>
          <div
            role="group"
            aria-label="Additional vibe suggestions"
            className="flex flex-wrap gap-2 justify-center"
          >
            {extraSuggestions.map((tag) => {
              const isActive = active.has(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => toggle(tag)}
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
        </>
      ) : null}

      <div className="flex flex-col md:flex-row gap-3 justify-center items-center mt-8">
        <button type="button" onClick={handleApply} className={PRIMARY_BTN}>
          Apply
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BTN}>
          Cancel
        </button>
      </div>
    </section>
  );
}
