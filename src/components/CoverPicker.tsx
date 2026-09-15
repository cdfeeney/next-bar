'use client';

import Sheet from '@/components/story/Sheet';
import { COVER_TEMPLATES, templateCoverValue } from '@/lib/nightOutCovers';

/**
 * S-06b — the cover sheet: the six bundled templates in a two-column grid.
 *
 * "Choose from library" is NOT here yet, deliberately: a library upload has to
 * be readable through `media_read_window` and kept out of `claim_orphan_paths`,
 * which is a change to the media boundary (0066/0077) that needs its own
 * authorised migration. A row that opened a picker whose result the server
 * refuses would be a dead end, and the README rules those out.
 */
export default function CoverPicker({
  value,
  onPick,
  onClose,
}: {
  /** The current `cover` value, or null. */
  value: string | null;
  /** Called with the new value (or null to clear); the caller closes the sheet. */
  onPick: (cover: string | null) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Sheet label="Cover photo" testId="cover-picker" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">
        Pick a cover for the invite. You can change it until the plan is locked.
      </p>
      <div className="grid grid-cols-2 gap-3" role="group" aria-label="Cover templates">
        {COVER_TEMPLATES.map((t) => {
          const on = value === templateCoverValue(t.key);
          return (
            <button
              type="button"
              key={t.key}
              aria-pressed={on}
              aria-label={`${t.label} cover`}
              data-testid={`cover-template-${t.key}`}
              onClick={() => onPick(templateCoverValue(t.key))}
              className={[
                'relative aspect-[8/5] min-h-[44px] overflow-hidden rounded-2xl border text-left touch-manipulation',
                on ? 'border-accent ring-2 ring-accent/40' : 'border-border',
              ].join(' ')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.src} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute bottom-2 left-2 rounded-full bg-text/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-bg">
                {t.label}
              </span>
              {on ? (
                <span aria-hidden="true" className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs text-bg">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {value !== null ? (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="mt-4 w-full min-h-[44px] rounded-full border border-border text-sm text-muted touch-manipulation"
        >
          Remove the cover
        </button>
      ) : null}
    </Sheet>
  );
}
